import { aiInfo, complete } from './ai/index.js';
import { kv } from './db.js';
import { itemsForDates } from './push.js';
import { listRecords } from './records.js';
import { addDays, fmtDay, localDateStr, localTimeStr } from './time.js';
import { applyTgActions, normalizeTgActions, parseDurationMin } from './tgactions.js';
import { esc } from './tgapi.js';
import { parseJsonLoose, RefMap } from './util.js';

// Общая «входящая» обработка для ботов Telegram и ВКонтакте:
// текст → нейросеть → задачи, события, еда, холодильник, заметки
// (записи сразу попадают в базу сервера и приезжают в телефон при синхронизации).

export const INBOX_SYSTEM = `Ты — «Входящие» личного планировщика студента. В мессенджере (Telegram или ВКонтакте) тебе пишут или пересылают: задачи, заметки и идеи, договорённости о встречах (часто это пересланные сообщения от репетитора), что съел, что купил домой, вопросы про расписание.
Пойми, что это, и преврати в действия. В конце сообщения есть блок <данные> (JSON): today и now — текущие дата и время, days — расписание на 7 дней (занятые интервалы), goals — цели (с id), tasks — открытые задачи, vars — переменные пользователя (например «репетитор = 1ч»).

Правила:
- Дело без точного времени — задача (add_task); если есть срок («до пятницы») — deadline = эта дата.
- Есть дата И время встречи/занятия — событие (add_event). Для репетитора kind "tutor", длительность из переменной «репетитор», если не указана. Пересланное сообщение с предложением времени («давай в чт в 18») — тоже событие.
- «съел/выпил/на обед…» — log_food: оцени граммы и посчитай КБЖУ на всю порцию.
- «купил/дома есть…» — add_fridge.
- Мысли, идеи, ссылки, всё неоднозначное — add_note. Ничего не теряй: если не уверен — заметка.
- Вопрос про расписание («что у меня завтра?») — ответь в reply по данным days, без действий.
- В одном сообщении может быть несколько действий.
- Оценки задач реалистичные (пользователь ленивый): estimateMin в минутах, complexity 1–5, reward ≈ estimateMin/5 (×1.5 для сложных и неприятных).
- Даты считай от today: «завтра», «в четверг» — ближайший будущий четверг. Формат YYYY-MM-DD и HH:MM.
- Если событие пересекается с занятым временем — коротко предупреди в reply.

Ответ — строго один JSON-объект:
{"reply":"1–2 коротких предложения по-русски","actions":[
 {"type":"add_task","title":"…","category":"study|work|english|sport|home|other","deadline":"YYYY-MM-DD или null","priority":1,"estimateMin":90,"complexity":3,"reward":18,"goal":"id цели или null","context":"детали"},
 {"type":"add_event","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","title":"…","kind":"tutor|work|sport|other","notes":"…"},
 {"type":"log_food","items":[{"name":"…","grams":200,"kcal":220,"p":8,"f":3,"c":40,"meal":"breakfast|lunch|dinner|snack"}]},
 {"type":"add_fridge","items":[{"name":"…","amount":1,"unit":"г|кг|шт|л|мл|уп","expires":null}]},
 {"type":"add_note","title":"коротко","text":"полный текст"}
]}`;

export function helpText(style = 'tg') {
  const cmds =
    style === 'vk'
      ? 'Команды — просто напиши слово: «сегодня», «завтра», «задачи», «помощь».'
      : '/today — план на сегодня, /tomorrow — на завтра, /tasks — открытые задачи';
  return [
    '<b>Что я умею</b>',
    '• Пиши задачи как есть: «реферат по праву до пятницы», «позвонить в деканат»',
    '• Пересылай сообщения репетитора — поставлю занятие в расписание',
    '• «Съел гречку 200 г и котлету» — запишу в дневник питания',
    '• «Купил курицу 1 кг и 10 яиц» — добавлю в холодильник',
    '• Идеи и заметки — сохраню в «Заметки»',
    '• Спрашивай: «что у меня завтра?»',
    '',
    cmds,
    'Под каждым ответом есть кнопка «Отменить».',
  ].join('\n');
}

function dayItems(dates) {
  const agenda = kv.get('agenda', null);
  const items = itemsForDates(dates, agenda);
  const seen = new Set(items.map((i) => i.uid));
  const set = new Set(dates);
  for (const e of listRecords('events')) {
    if (!set.has(e.date) || e.status === 'skipped' || seen.has(`event:${e.id}`)) continue;
    items.push({ uid: `event:${e.id}`, date: e.date, start: e.start, end: e.end, title: e.title, kind: e.kind, location: '' });
  }
  return items.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

export function buildInboxContext(refs) {
  const today = localDateStr();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const items = dayItems(dates);
  return {
    today,
    now: localTimeStr(),
    days: dates.map((d) => ({
      date: d,
      day: fmtDay(d),
      busy: items.filter((i) => i.date === d && i.kind !== 'sleep').map((i) => `${i.start}–${i.end} ${i.title}${i.kind === 'class' ? ' (пара)' : ''}`),
    })),
    goals: listRecords('goals')
      .filter((g) => g.status === 'active')
      .slice(0, 20)
      .map((g) => ({ id: refs.ref('g', g.id), title: g.title, horizon: g.horizon })),
    tasks: listRecords('tasks')
      .filter((t) => t.status === 'todo')
      .slice(0, 30)
      .map((t) => ({ title: t.title, deadline: t.deadline || null })),
    vars: listRecords('variables').map((v) => `${v.name} = ${v.expr}`),
  };
}

function saveAsNote(text, from, reason) {
  const res = applyTgActions([{ type: 'add_note', title: text.split('\n')[0].slice(0, 80), text }], { original: text, from });
  return { text: `📝 ${reason}\n${res.lines.join('\n')}`, batchId: res.batchId };
}

export async function processInbox(text, from = '') {
  if (!aiInfo().configured) return saveAsNote(text, from, 'Нейросеть не настроена — сохранил как заметку.');
  const refs = new RefMap();
  const ctx = buildInboxContext(refs);
  const tutorVar = listRecords('variables').find((v) => v.name === 'репетитор');
  const head = from ? `[Переслано от: ${from}]\n` : '';
  let parsed;
  try {
    const out = await complete({
      system: INBOX_SYSTEM,
      messages: [{ role: 'user', content: `${head}${text}\n\n<данные>\n${JSON.stringify({ mode: 'inbox', ...ctx })}\n</данные>` }],
      json: true,
      tier: 'smart',
      temperature: 0.2,
      maxTokens: 1500,
    });
    parsed = parseJsonLoose(out.text);
  } catch (e) {
    return saveAsNote(text, from, `Нейросеть сейчас недоступна (${e.message}). Сохранил как заметку — разберёшь в приложении.`);
  }
  const actions = normalizeTgActions(parsed?.actions, refs, { tutorMin: parseDurationMin(tutorVar?.expr, 60) });
  const reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
  if (!actions.length) {
    if (reply) return { text: esc(reply), batchId: null };
    return saveAsNote(text, from, 'Не понял, что с этим сделать, — сохранил как заметку.');
  }
  const res = applyTgActions(actions, { original: text, from });
  return { text: [reply ? esc(reply) : null, ...res.lines].filter(Boolean).join('\n'), batchId: res.batchId };
}

export function planText(date) {
  const items = dayItems([date]).filter((i) => i.kind !== 'sleep');
  if (!items.length) return `📅 <b>${fmtDay(date)}</b>\nНичего не запланировано.`;
  const lines = items.map((i) => `${i.start}–${i.end} ${i.kind === 'class' ? '🎓 ' : ''}${esc(i.title)}${i.location ? ` <i>(${esc(i.location)})</i>` : ''}`);
  return `📅 <b>${fmtDay(date)}</b>\n${lines.join('\n')}`;
}

export function tasksText() {
  const tasks = listRecords('tasks')
    .filter((t) => t.status === 'todo')
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    .slice(0, 15);
  if (!tasks.length) return 'Открытых задач нет 🎉';
  return `<b>Открытые задачи</b>\n${tasks.map((t) => `• ${esc(t.title)}${t.deadline ? ` — до ${fmtDay(t.deadline)}` : ''}`).join('\n')}`;
}

/** ВКонтакте не понимает HTML — превращаем ответ в обычный текст */
export function htmlToPlain(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}
