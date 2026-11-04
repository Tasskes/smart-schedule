import { askSolver, solveTitle, uploadSolvePhoto } from '../ai/solve';
import { toast } from '../components/ui';
import type { Attachment, SolutionRec, SolveMsg } from '../types';
import { createStore, get, patch, put, uid } from './store';

/** Что сейчас происходит с заданиями: загружаемые фото (с локальным превью) и задания, которые решаются */
export const solveUi = createStore<{ uploads: Record<string, { id: string; url: string }[]>; busy: Record<string, boolean> }>({
  uploads: {},
  busy: {},
});

const setBusy = (id: string, v: boolean) => solveUi.set((s) => ({ ...s, busy: { ...s.busy, [id]: v } }));

export function newSolution(): SolutionRec {
  return put('solutions', { title: 'Новое задание', question: '', ocr: '', attachments: [], messages: [], createdAt: Date.now() });
}

/** Загрузить фото задания: по одному, чтобы распознанный текст шёл в том же порядке, что и фото */
export async function addPhotos(solId: string, files: File[]) {
  for (const file of files) {
    const tmp = { id: uid(), url: URL.createObjectURL(file) };
    solveUi.set((s) => ({ ...s, uploads: { ...s.uploads, [solId]: [...(s.uploads[solId] || []), tmp] } }));
    try {
      const r = await uploadSolvePhoto(file);
      const sol = get('solutions', solId);
      if (sol) {
        const att: Attachment = { id: r.fileId, kind: 'image', mime: 'image/jpeg' }; // текст — в поле задания, где его можно поправить
        const ocr = [sol.ocr.trim(), r.text.trim()].filter(Boolean).join('\n\n');
        const attachments = [...(sol.attachments || []), att];
        patch('solutions', solId, { attachments, ocr, title: solveTitle({ ...sol, ocr }) });
      }
      if (r.ocr !== 'ok') toast(r.error || 'Текст на фото не распознан — впиши условие сам', undefined, 6000);
      else if (!r.text.trim()) toast('На фото не нашлось текста — сфотографируй ближе или впиши условие');
    } catch (e) {
      toast(`Фото не загрузилось: ${(e as Error).message}`);
    } finally {
      URL.revokeObjectURL(tmp.url);
      solveUi.set((s) => ({ ...s, uploads: { ...s.uploads, [solId]: (s.uploads[solId] || []).filter((u) => u.id !== tmp.id) } }));
    }
  }
}

/** Решить задание или ответить на уточнение. Возвращает false, если не получилось (текст вопроса стоит оставить) */
export async function solveNow(solId: string, followUp?: string) {
  const sol = get('solutions', solId);
  if (!sol || solveUi.get().busy[solId]) return false;
  setBusy(solId, true);
  const asked: SolveMsg | null = followUp ? { role: 'user', text: followUp, at: Date.now() } : null;
  if (asked) patch('solutions', solId, { messages: [...sol.messages, asked] });
  try {
    const answer = await askSolver(sol, followUp);
    const cur = get('solutions', solId) ?? sol;
    patch('solutions', solId, {
      messages: [...cur.messages, { role: 'assistant', text: answer, at: Date.now() }],
      title: solveTitle(cur),
    });
    return true;
  } catch (e) {
    // вопрос без ответа убираем, чтобы переписка с нейросетью не сбилась
    if (asked) {
      const cur = get('solutions', solId);
      if (cur) patch('solutions', solId, { messages: cur.messages.filter((m) => m.at !== asked.at || m.role !== 'user') });
    }
    toast(`Не получилось: ${(e as Error).message}`, undefined, 6000);
    return false;
  } finally {
    setBusy(solId, false);
  }
}

/** Последний ответ нейросети по заданию */
export const lastAnswer = (sol: SolutionRec) => [...sol.messages].reverse().find((m) => m.role === 'assistant')?.text || '';

export function solutionToTask(sol: SolutionRec) {
  const answer = lastAnswer(sol);
  return put('tasks', {
    title: sol.title,
    category: 'study',
    status: 'todo',
    priority: 2,
    context: [sol.ocr.trim() && `Задание:\n${sol.ocr.trim()}`, answer && `Решение от ИИ:\n${answer}`].filter(Boolean).join('\n\n').slice(0, 4000),
    attachments: sol.attachments,
    createdAt: Date.now(),
  });
}

export function solutionToNote(sol: SolutionRec) {
  const answer = lastAnswer(sol);
  return put('notes', {
    title: sol.title,
    text: [sol.ocr.trim(), answer && `— Решение —\n${answer}`].filter(Boolean).join('\n\n'),
    source: 'app',
    createdAt: Date.now(),
    attachments: sol.attachments,
  });
}
