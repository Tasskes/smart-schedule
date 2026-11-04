// Тестовая «нейросеть» без интернета и ключей (AI_PROVIDER=mock).
// Нужна для разработки и автотестов: понимает блок <данные> из промпта клиента.

function extractData(text) {
  const m = /<данные>([\s\S]*?)<\/данные>/.exec(text || '');
  if (!m) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
}

const toMin = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
};
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function planFor(data) {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  let ti = 0;
  const days = [];
  for (const day of data.days || []) {
    if (data.targetDays && !data.targetDays.includes(day.date)) continue;
    const items = [];
    let dinner = false;
    for (const [s, e] of day.free || []) {
      let cur = toMin(s);
      const end = toMin(e);
      while (end - cur >= 40) {
        if (!dinner && cur >= 18 * 60) {
          items.push({ s: toTime(cur), e: toTime(cur + 30), t: 'Ужин', k: 'meal', r: 2 });
          cur += 40;
          dinner = true;
          continue;
        }
        const task = tasks.length ? tasks[ti % tasks.length] : null;
        ti += 1;
        const dur = Math.min(90, end - cur - 10, task?.left || 60);
        if (dur < 30) break;
        items.push({
          s: toTime(cur),
          e: toTime(cur + dur),
          t: task ? task.title : 'Отдых',
          k: task ? (task.cat === 'work' ? 'work' : 'study') : 'rest',
          task: task?.id || null,
          r: Math.round(dur / 5),
        });
        cur += dur + 15;
        if (items.length >= 5) break;
      }
      if (items.length >= 5) break;
    }
    days.push({ date: day.date, replace: true, items });
  }
  return days;
}

export async function mockComplete({ messages }) {
  const last = messages[messages.length - 1]?.content || '';
  const data = extractData(last);
  const userText = last.split('<данные>')[0].toLowerCase();
  const mode = data.mode || 'chat';
  let out;

  switch (mode) {
    case 'plan': {
      const days = planFor(data);
      const n = days.reduce((a, d) => a + d.items.length, 0);
      out = { reply: `Тестовый режим: расставил ${n} дел на ${days.length} дн.`, actions: [{ type: 'plan', days }] };
      break;
    }
    case 'tutor': {
      const day = data.days?.[1]?.date || data.today;
      out = {
        reply: 'Добавил занятие с репетитором.',
        actions: [{ type: 'add_event', date: day, start: '18:00', end: '19:00', title: 'Репетитор', kind: 'tutor', fixed: true }],
      };
      break;
    }
    case 'review':
      out = { reply: 'Неплохой день! Держи бонус.', actions: [{ type: 'bonus', amount: 10, reason: 'Итоги дня' }] };
      break;
    case 'estimate':
      out = {
        estimateMin: 60, complexity: 3, reward: 12, splitInto: 1,
        steps: ['Разобраться в задаче', 'Сделать', 'Проверить'],
        explanation: 'Тестовая оценка: средняя задача примерно на час.',
      };
      break;
    case 'food': {
      const items = [];
      const re = /([а-яёa-z][а-яёa-z\s]*?)\s*(\d+)\s*(?:г|гр|грамм)/gi;
      let m;
      while ((m = re.exec(userText))) {
        const grams = Number(m[2]);
        items.push({ name: m[1].trim(), grams, kcal: Math.round(grams * 1.5), p: +(grams * 0.08).toFixed(1), f: +(grams * 0.05).toFixed(1), c: +(grams * 0.18).toFixed(1) });
      }
      if (!items.length) items.push({ name: userText.trim().slice(0, 40) || 'Еда', grams: 200, kcal: 300, p: 15, f: 10, c: 35 });
      out = { items, meal: null, comment: 'Тестовый расчёт' };
      break;
    }
    case 'fridge': {
      const items = userText
        .split(/[,\n;]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const mm = /(.+?)\s+(\d+(?:[.,]\d+)?)\s*(кг|г|шт|л|мл|уп)?$/.exec(s);
          return mm ? { name: mm[1], amount: Number(mm[2].replace(',', '.')), unit: mm[3] || 'шт' } : { name: s, amount: null, unit: '' };
        });
      out = { items };
      break;
    }
    case 'recipes': {
      const names = (data.fridge || []).map((f) => f.name).slice(0, 3);
      out = {
        recipes: [
          {
            title: `Быстрое блюдо из: ${names.join(', ') || 'того, что есть'}`,
            timeMin: 20, servings: 1,
            ingredients: names.map((n) => ({ name: n, amount: '100 г', have: true })),
            steps: ['Нарезать', 'Обжарить 10 минут', 'Подать'],
            perServing: { kcal: 450, p: 30, f: 15, c: 45 },
            why: 'Тестовый рецепт',
          },
        ],
      };
      break;
    }
    case 'tg': {
      const actions = [];
      if (/съел|выпил|на завтрак|на обед|на ужин/.test(userText)) {
        actions.push({ type: 'log_food', items: [{ name: 'гречка', grams: 200, kcal: 220, p: 8, f: 2, c: 42 }] });
      } else if (/купил/.test(userText)) {
        actions.push({ type: 'add_fridge', items: [{ name: 'курица', amount: 1, unit: 'кг' }] });
      } else if (/репетитор|давай в|\d{1,2}:\d{2}/.test(userText)) {
        actions.push({ type: 'add_event', date: data.days?.[1]?.date || data.today, start: '18:00', title: 'Репетитор', kind: 'tutor' });
      } else if (/идея|заметк/.test(userText)) {
        actions.push({ type: 'add_note', title: 'Идея', text: userText.trim() });
      } else if (/что у меня/.test(userText)) {
        out = { reply: `Завтра: ${(data.days?.[1]?.busy || []).join('; ') || 'ничего'}`, actions: [] };
        break;
      } else {
        actions.push({ type: 'add_task', title: userText.trim().slice(0, 60) || 'Задача', category: 'study', estimateMin: 60, complexity: 2 });
      }
      out = { reply: 'Принял!', actions };
      break;
    }
    case 'decompose':
      out = {
        reply: 'Разбил цель на шаги (тест).',
        actions: [
          { type: 'add_goal', ref: 'new1', title: 'Подцель (тест)', horizon: '1m', parentId: data.goal?.id || null },
          { type: 'add_task', title: 'Первый шаг (тест)', category: 'study', estimateMin: 45, complexity: 2, reward: 9, goalId: 'new1' },
        ],
      };
      break;
    default: {
      const actions = [];
      if (userText.includes('переменн')) actions.push({ type: 'set_variable', name: 'обед', expr: '45 мин', description: 'Длительность обеда' });
      if (userText.includes('задач')) actions.push({ type: 'add_task', title: 'Новая задача (тест)', category: 'study', estimateMin: 60, complexity: 2, reward: 10 });
      out = { reply: actions.length ? 'Готово, проверь и примени.' : 'Тестовый ответ: нейросеть в режиме mock.', actions };
    }
  }
  return { text: JSON.stringify(out), usage: { input: Math.round(last.length / 4), output: 200 } };
}
