/**
 * Нижняя панель: уезжает вниз, когда листаешь экран вниз, и возвращается, когда листаешь вверх.
 * У самого верха экрана и на коротких экранах панель видна всегда.
 * Пока открыта клавиатура, панели нет совсем (класс kb-open ставит main.tsx).
 */

const HIDE_AFTER = 14; // столько px вниз подряд — прячем
const SHOW_AFTER = 10; // столько px вверх подряд — показываем
const TOP_ZONE = 48; // ближе к верху не прячем

let hidden = false;
let lastY = 0;
let path = 0; // путь в одну сторону: > 0 вниз, < 0 вверх
let quietUntil = 0;

const now = () => performance.now();

export function isBarHidden() {
  return hidden;
}

export function setBarHidden(v: boolean) {
  if (hidden === v) return;
  hidden = v;
  path = 0;
  // пока панель едет, раскладка чата меняется — эту прокрутку не считаем жестом
  quietUntil = Math.max(quietUntil, now() + 350);
  document.documentElement.classList.toggle('bar-hidden', v);
}

/** Прокрутку, которую делает само приложение (смена экрана, чат к последнему сообщению), не считаем жестом */
export function quietScroll(ms = 700) {
  quietUntil = Math.max(quietUntil, now() + ms);
  path = 0;
}

export function handleMainScroll(el: HTMLElement) {
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  const y = Math.min(Math.max(el.scrollTop, 0), max); // «резинку» iOS у краёв не считаем
  const dy = y - lastY;
  lastY = y;
  if (document.documentElement.classList.contains('kb-open')) {
    path = 0;
    return;
  }
  if (y <= 4 || max < 8) {
    setBarHidden(false);
    return;
  }
  if (now() < quietUntil) {
    path = 0;
    return;
  }
  if (!dy) return;
  path = Math.sign(dy) === Math.sign(path) ? path + dy : dy;
  if (path >= HIDE_AFTER && y > TOP_ZONE) setBarHidden(true);
  else if (path <= -SHOW_AFTER) setBarHidden(false);
}

export function setupTabbarAutoHide() {
  // main.content живёт всё время работы приложения, но может появиться позже (после входа),
  // поэтому ловим прокрутку на уровне документа: событие scroll не всплывает, но ловится при захвате
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target;
      if (el instanceof HTMLElement && el.matches('main.content')) handleMainScroll(el);
    },
    { capture: true, passive: true },
  );
}
