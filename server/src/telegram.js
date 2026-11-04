import crypto from 'node:crypto';
import { aiInfo, complete } from './ai/index.js';
import { safeEqual } from './auth.js';
import { kv } from './db.js';
import { itemsForDates } from './push.js';
import { listRecords } from './records.js';
import { addDays, fmtDay, localDateStr, localTimeStr } from './time.js';
import { applyTgActions, normalizeTgActions, parseDurationMin, undoBatch } from './tgactions.js';
import { esc, owner, tg, tgEnabled } from './tgapi.js';
import { parseJsonLoose, RefMap } from './util.js';

export const TG_SYSTEM = `Ты — «Входящие» личного планировщика студента. В Telegram тебе пишут или пересылают: задачи, заметки и идеи, договорённости о встречах (часто это пересланные сообщения от репетитора), что съел, что купил домой, вопросы про расписание.
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

const HELP = [
  '<b>Что я умею</b>',
  '• Пиши задачи как есть: «реферат по праву до пятницы», «позвонить в деканат»',
  '• Пересылай сообщения репетитора — поставлю занятие в расписание',
  '• «Съел гречку 200 г и котлету» — запишу в дневник питания',
  '• «Купил курицу 1 кг и 10 яиц» — добавлю в холодильник',
  '• Идеи и заметки — сохраню в «Заметки»',
  '• Спрашивай: «что у меня завтра?»',
  '',
  '/today — план на сегодня, /tomorrow — на завтра, /tasks — открытые задачи',
  'Под каждым ответом есть кнопка «Отменить».',
].join('\n');

let me = null;
let lastError = null;
let running = false;

export function pairCode() {
  let c = kv.get('tgCode', null);
  if (!c) {
    c = crypto.randomBytes(6).toString('hex');
    kv.set('tgCode', c);
  }
  return c;
}

export function tgStatus() {
  const o = owner();
  return {
    configured: tgEnabled(),
    username: me?.username || null,
    linked: !!o,
    ownerName: o?.name || null,
    startLink: me?.username && !o ? `https://t.me/${me.username}?start=${pairCode()}` : null,
    notify: kv.get('tgNotify', false) === true,
    error: lastError,
  };
}

export function unlinkTelegram() {
  kv.set('tgOwner', null);
  kv.set('tgCode', null);
}

export function setTgNotify(on) {
  kv.set('tgNotify', !!on);
}

const send = (chatId, text, extra = {}) =>
  tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

// ---------- Контекст для нейросети ----------

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

export function buildTgContext(refs) {
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

// ---------- Обработка входящих ----------

function describeForward(m) {
  const o = m.forward_origin;
  if (o) {
    if (o.type === 'user') return [o.sender_user?.first_name, o.sender_user?.last_name].filter(Boolean).join(' ') || 'пользователь';
    if (o.type === 'hidden_user') return o.sender_user_name || 'пользователь';
    if (o.type === 'chat') return o.sender_chat?.title || 'чат';
    if (o.type === 'channel') return o.chat?.title || 'канал';
  }
  if (m.forward_from) return [m.forward_from.first_name, m.forward_from.last_name].filter(Boolean).join(' ');
  if (m.forward_sender_name) return m.forward_sender_name;
  return '';
}

function saveAsNote(text, from, reason) {
  const res = applyTgActions([{ type: 'add_note', title: text.split('\n')[0].slice(0, 80), text }], { original: text, from });
  return { text: `📝 ${reason}\n${res.lines.join('\n')}`, batchId: res.batchId };
}

export async function processInbox(text, from = '') {
  if (!aiInfo().configured) return saveAsNote(text, from, 'Нейросеть не настроена — сохранил как заметку.');
  const refs = new RefMap();
  const ctx = buildTgContext(refs);
  const tutorVar = listRecords('variables').find((v) => v.name === 'репетитор');
  const head = from ? `[Переслано от: ${from}]\n` : '';
  let parsed;
  try {
    const out = await complete({
      system: TG_SYSTEM,
      messages: [{ role: 'user', content: `${head}${text}\n\n<данные>\n${JSON.stringify({ mode: 'tg', ...ctx })}\n</данные>` }],
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

function planText(date) {
  const items = dayItems([date]).filter((i) => i.kind !== 'sleep');
  if (!items.length) return `📅 <b>${fmtDay(date)}</b>\nНичего не запланировано.`;
  const lines = items.map((i) => `${i.start}–${i.end} ${i.kind === 'class' ? '🎓 ' : ''}${esc(i.title)}${i.location ? ` <i>(${esc(i.location)})</i>` : ''}`);
  return `📅 <b>${fmtDay(date)}</b>\n${lines.join('\n')}`;
}

function tasksText() {
  const tasks = listRecords('tasks')
    .filter((t) => t.status === 'todo')
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    .slice(0, 15);
  if (!tasks.length) return 'Открытых задач нет 🎉';
  return `<b>Открытые задачи</b>\n${tasks.map((t) => `• ${esc(t.title)}${t.deadline ? ` — до ${fmtDay(t.deadline)}` : ''}`).join('\n')}`;
}

async function handleCommand(chatId, text) {
  const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  if (cmd === '/today') return send(chatId, planText(localDateStr()));
  if (cmd === '/tomorrow') return send(chatId, planText(addDays(localDateStr(), 1)));
  if (cmd === '/tasks') return send(chatId, tasksText());
  return send(chatId, HELP);
}

export async function handleUpdate(u) {
  if (u.callback_query) return handleCallback(u.callback_query);
  const m = u.message;
  if (!m || !m.chat) return;
  const chatId = m.chat.id;
  const text = String(m.text || m.caption || '').trim();
  const o = owner();

  if (!o) {
    const start = /^\/start(?:\s+(\S+))?/.exec(text);
    if (start && start[1] && safeEqual(start[1], pairCode()) && m.chat.type === 'private') {
      const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || 'владелец';
      kv.set('tgOwner', { chatId, userId: m.from?.id ?? null, name, linkedAt: Date.now() });
      kv.set('tgCode', null);
      return send(chatId, `Привет, ${esc(name)}! Бот подключён к твоему «Распорядку» 🎉\n\n${HELP}`);
    }
    return send(chatId, 'Это личный бот «Умного распорядка». Подключить его можно из приложения: Ещё → Настройки → Telegram.');
  }
  if (chatId !== o.chatId) return; // чужие чаты игнорируем

  if (text.startsWith('/')) return handleCommand(chatId, text);
  if (!text) {
    return send(chatId, 'Пока понимаю только текст и подписи к фото. Голосовые сообщения — в планах 🙂', { reply_to_message_id: m.message_id });
  }
  tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
  const res = await processInbox(text, describeForward(m));
  return send(chatId, res.text || 'Готово', {
    reply_to_message_id: m.message_id,
    ...(res.batchId ? { reply_markup: { inline_keyboard: [[{ text: '↩️ Отменить', callback_data: `undo:${res.batchId}` }]] } } : {}),
  });
}

async function handleCallback(q) {
  const o = owner();
  const answer = (text) => tg('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text } : {}) }).catch(() => undefined);
  if (!o || q.message?.chat?.id !== o.chatId) return answer();
  const [kind, id] = String(q.data || '').split(':');
  if (kind === 'undo' && id) {
    const n = undoBatch(id);
    await answer(n ? 'Отменено' : 'Уже отменено');
    await tg('editMessageReplyMarkup', { chat_id: o.chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
    if (n) await send(o.chatId, '↩️ Отменил — из приложения тоже уберётся при синхронизации.', { reply_to_message_id: q.message.message_id });
    return;
  }
  return answer();
}

// ---------- Опрос Telegram ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startTelegramBot() {
  if (!tgEnabled() || running) return;
  running = true;
  try {
    me = await tg('getMe');
    await tg('setMyCommands', {
      commands: [
        { command: 'today', description: 'План на сегодня' },
        { command: 'tomorrow', description: 'План на завтра' },
        { command: 'tasks', description: 'Открытые задачи' },
        { command: 'help', description: 'Что умеет бот' },
      ],
    }).catch(() => undefined);
    console.log(`[tg] бот @${me.username} запущен`);
  } catch (e) {
    lastError = e.message;
    console.warn('[tg] не удалось подключиться к Telegram:', e.message);
  }
  let backoff = 3000;
  for (;;) {
    try {
      const offset = kv.get('tgOffset', 0);
      const updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 65000);
      backoff = 3000;
      lastError = null;
      if (!me) me = await tg('getMe').catch(() => null);
      for (const u of updates) {
        kv.set('tgOffset', u.update_id + 1);
        try {
          await handleUpdate(u);
        } catch (e) {
          console.warn('[tg] ошибка обработки сообщения:', e.message);
        }
      }
    } catch (e) {
      lastError = e.message;
      await sleep(backoff);
      backoff = Math.min(60000, backoff * 2);
    }
  }
}
