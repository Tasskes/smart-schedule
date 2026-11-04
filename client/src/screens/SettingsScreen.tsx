import { useEffect, useState } from 'react';
import { api, authStore, hasServer, isLocalMode, loadStatus, statusStore } from '../api';
import { Field, NumInput, toast } from '../components/ui';
import { idbClearAll, metaSet } from '../db/idb';
import { refreshSchedule, useSchedule } from '../db/schedule';
import { exportAll, get, importAll, patch, useRecord } from '../db/store';
import { disablePush, enablePush, isIOS, isStandalone, pushState } from '../push';
import { syncNow, syncStore } from '../sync';
import { ACCENTS, applyAppearance, DEFAULT_APPEARANCE, THEMES } from '../theme';
import { Seg, Toggle } from '../components/ui';
import type { Appearance, ThemeMode } from '../types';

function AppearanceCard() {
  const settings = useRecord('settings', 'main');
  const ap: Appearance = { ...DEFAULT_APPEARANCE, ...(settings?.appearance || {}) };
  const set = (next: Partial<Appearance>) => {
    const value = { ...ap, ...next };
    applyAppearance(value);
    patch('settings', 'main', { appearance: value });
  };
  return (
    <div className="card">
      <div className="theme-tiles">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-tile ${ap.theme === t.id ? 'active' : ''}`} onClick={() => set({ theme: t.id })}>
            <div className="pv" style={{ background: t.preview.bg }}>
              <i style={{ background: t.preview.card, width: '100%', height: 18 }} />
              <i style={{ background: t.preview.accent, width: '70%' }} />
              <i style={{ background: t.preview.text, opacity: 0.25, width: '45%' }} />
            </div>
            <b>{t.title}</b>
            <span className="tiny muted">{t.hint}</span>
          </button>
        ))}
      </div>
      <div className="label" style={{ margin: '14px 0 6px' }}>Режим</div>
      {ap.theme === 'neon' ? (
        <div className="tiny muted">Неон всегда тёмный</div>
      ) : (
        <Seg<ThemeMode>
          value={ap.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { v: 'auto', label: 'Как в iPhone' },
            { v: 'light', label: 'Светлая' },
            { v: 'dark', label: 'Тёмная' },
          ]}
        />
      )}
      <div className="label" style={{ margin: '14px 0 8px' }}>Акцентный цвет</div>
      <div className="accent-dots">
        <button className={`auto ${!ap.accent ? 'active' : ''}`} onClick={() => set({ accent: null })} aria-label="Как в теме" title="Как в теме" />
        {ACCENTS.map((c) => (
          <button key={c} className={ap.accent === c ? 'active' : ''} style={{ background: c }} onClick={() => set({ accent: c })} aria-label={c} />
        ))}
      </div>
    </div>
  );
}

interface TgStatus {
  configured: boolean;
  username: string | null;
  linked: boolean;
  ownerName: string | null;
  startLink: string | null;
  notify: boolean;
  error: string | null;
}

interface VkStatus {
  configured: boolean;
  groupName: string | null;
  link: string | null;
  linked: boolean;
  ownerName: string | null;
  code: string | null;
  notify: boolean;
  error: string | null;
}

function VkCard() {
  const [st, setSt] = useState<VkStatus | null>(null);
  const [err, setErr] = useState('');
  const load = () =>
    api<VkStatus>('/api/vk')
      .then((s) => {
        setSt(s);
        setErr('');
      })
      .catch((e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  if (err) return <div className="card small err-text">{err}</div>;
  if (!st) return <div className="card small muted">Загружаю…</div>;
  if (!st.configured) {
    return (
      <div className="card small">
        <div>
          Бот ВКонтакте работает через твоё сообщество (можно закрытое, только для себя). Настройка ~5 минут:
          <ol style={{ margin: '8px 0', paddingLeft: 18 }}>
            <li>ВКонтакте → Сообщества → <b>Создать сообщество</b> (тип любой, например «Группа по интересам»).</li>
            <li>
              Управление → <b>Сообщения</b>: включить. Там же <b>Настройки для бота → Возможности ботов: включены</b>.
            </li>
            <li>
              Управление → <b>Работа с API → Ключи доступа → Создать ключ</b>: отметь «Управление сообществом» и «Сообщения сообщества». Скопируй ключ.
            </li>
            <li>
              Работа с API → <b>Long Poll API</b>: включить, версия API <b>5.199</b>. Во вкладке «Типы событий» отметь «Входящее сообщение» и «Действие с сообщением».
            </li>
            <li>
              На сервере добавь в <span className="kbd">.env</span>: <span className="kbd">VK_GROUP_TOKEN=ключ</span> и <span className="kbd">VK_GROUP_ID=номер</span> (цифры из адреса
              сообщества или из «Работа с API»), затем <span className="kbd">docker compose up -d</span>.
            </li>
          </ol>
        </div>
        <button className="btn small secondary" onClick={load}>
          Проверить снова
        </button>
      </div>
    );
  }
  return (
    <div className="card small">
      {st.linked ? (
        <>
          <div className="row between">
            <span>{st.groupName ? `Сообщество «${st.groupName}»` : 'Бот ВКонтакте'}</span>
            <b style={{ color: 'var(--ok)' }}>подключён{st.ownerName ? ` · ${st.ownerName}` : ''}</b>
          </div>
          <div className="tiny muted" style={{ margin: '6px 0' }}>
            Пиши или пересылай в сообщения сообщества задачи, заметки, сообщения репетитора, что съел и что купил. Команды словами: «сегодня», «завтра», «задачи».
          </div>
          <Toggle
            label="Дублировать напоминания во ВКонтакте"
            hint="Пары, дела, утренняя сводка и изменения в расписании"
            checked={st.notify}
            onChange={(v) => api<VkStatus>('/api/vk/settings', { body: { notify: v } }).then(setSt).catch((e) => toast((e as Error).message))}
          />
          <button
            className="btn small danger"
            onClick={() => {
              if (!confirm('Отключить бота ВКонтакте?')) return;
              api<VkStatus>('/api/vk/unlink', { body: {} }).then(setSt);
            }}
          >
            Отключить
          </button>
        </>
      ) : (
        <>
          <div>
            Бот {st.groupName ? <b>«{st.groupName}»</b> : ''} готов. Открой сообщения сообщества и отправь туда этот код:
          </div>
          <div className="row" style={{ margin: '10px 0' }}>
            <span className="big-num" style={{ fontSize: 28, letterSpacing: '0.12em' }}>
              {st.code}
            </span>
            <button className="btn small secondary" onClick={() => st.code && navigator.clipboard?.writeText(st.code).then(() => toast('Код скопирован'))}>
              Копировать
            </button>
          </div>
          {st.error ? <div className="err-text" style={{ marginBottom: 6 }}>Связь с ВКонтакте: {st.error}</div> : null}
          <div className="grid-2">
            {st.link ? (
              <a className="btn small" href={st.link} target="_blank" rel="noreferrer">
                Открыть ВКонтакте
              </a>
            ) : null}
            <button className="btn small secondary" onClick={load}>
              Я отправил код
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TelegramCard() {
  const [st, setSt] = useState<TgStatus | null>(null);
  const [err, setErr] = useState('');
  const load = () =>
    api<TgStatus>('/api/telegram')
      .then((s) => {
        setSt(s);
        setErr('');
      })
      .catch((e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  if (err) return <div className="card small err-text">{err}</div>;
  if (!st) return <div className="card small muted">Загружаю…</div>;
  if (!st.configured) {
    return (
      <div className="card small">
        <div>
          Бот ещё не создан. Это займёт 2 минуты:
          <ol style={{ margin: '8px 0', paddingLeft: 18 }}>
            <li>
              В Telegram открой <b>@BotFather</b> → <span className="kbd">/newbot</span> → придумай имя и логин бота (должен заканчиваться на <i>bot</i>).
            </li>
            <li>Скопируй токен, который пришлёт BotFather.</li>
            <li>
              На сервере добавь в файл <span className="kbd">.env</span> строку <span className="kbd">TELEGRAM_BOT_TOKEN=токен</span> и выполни{' '}
              <span className="kbd">docker compose up -d</span>.
            </li>
          </ol>
          Потом вернись сюда и нажми «Подключить».
        </div>
        <button className="btn small secondary" onClick={load}>
          Проверить снова
        </button>
      </div>
    );
  }
  return (
    <div className="card small">
      {st.linked ? (
        <>
          <div className="row between">
            <span>Бот {st.username ? `@${st.username}` : ''}</span>
            <b style={{ color: 'var(--ok)' }}>подключён{st.ownerName ? ` · ${st.ownerName}` : ''}</b>
          </div>
          <div className="tiny muted" style={{ margin: '6px 0' }}>
            Пиши или пересылай боту задачи, заметки, сообщения репетитора, что съел и что купил — ИИ сам разложит это по приложению. Команды: /today, /tomorrow, /tasks.
          </div>
          <Toggle
            label="Дублировать напоминания в Telegram"
            hint="Пары, дела, утренняя сводка и изменения в расписании"
            checked={st.notify}
            onChange={(v) => api<TgStatus>('/api/telegram/settings', { body: { notify: v } }).then(setSt).catch((e) => toast((e as Error).message))}
          />
          <button
            className="btn small danger"
            onClick={() => {
              if (!confirm('Отключить бота от приложения?')) return;
              api<TgStatus>('/api/telegram/unlink', { body: {} }).then(setSt);
            }}
          >
            Отключить
          </button>
        </>
      ) : (
        <>
          <div>Бот {st.username ? <b>@{st.username}</b> : ''} готов. Нажми «Подключить» — откроется Telegram, там нажми «Запустить» (Start).</div>
          {st.error ? (
            <div className="err-text" style={{ marginTop: 6 }}>
              Связь с Telegram: {st.error}
              <div className="tiny muted" style={{ marginTop: 4 }}>
                Если Telegram недоступен с сервера, используй бота ВКонтакте (выше) или укажи прокси в .env: TELEGRAM_PROXY=http://логин:пароль@хост:порт
              </div>
            </div>
          ) : null}
          <div className="grid-2" style={{ marginTop: 10 }}>
            {st.startLink ? (
              <a className="btn small" href={st.startLink} target="_blank" rel="noreferrer">
                Подключить
              </a>
            ) : (
              <button className="btn small" disabled>
                Подключить
              </button>
            )}
            <button className="btn small secondary" onClick={load}>
              Я нажал Start
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function fmtTime(ts?: number | null) {
  return ts ? new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
}

export function SettingsScreen() {
  const { status, error } = statusStore.use();
  const sync = syncStore.use();
  const sched = useSchedule();
  const settings = useRecord('settings', 'main');
  const [push, setPush] = useState<string>('…');
  const [profile, setProfile] = useState(settings?.profileNote || '');
  const [start, setStart] = useState<number | null>(get('ledger', 'start')?.amount ?? 100);

  useEffect(() => {
    void loadStatus();
    void pushState().then(setPush);
  }, []);

  const calUrl = status ? `${status.publicUrl || window.location.origin}${status.calendarPath}` : '';

  const exportData = async () => {
    const blob = new Blob([JSON.stringify({ app: 'smart-schedule', at: Date.now(), data: exportAll() })], { type: 'application/json' });
    const name = `raspisanie-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([blob], name, { type: 'application/json' });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Резервная копия распорядка' }).catch(() => undefined);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const importData = async (f: File) => {
    try {
      const json = JSON.parse(await f.text());
      const n = importAll(json.data || json);
      toast(`Импортировано записей: ${n}`);
    } catch {
      toast('Не удалось прочитать файл');
    }
  };

  return (
    <>
      <div className="section-title">Оформление</div>
      <AppearanceCard />

      <div className="section-title">Сервер</div>
      <div className="card small">
        {hasServer() ? (
          <>
            <div className="row between">
              <span>Подключение</span>
              <b style={{ color: error ? 'var(--danger)' : 'var(--ok)' }}>{error ? 'нет связи' : status ? 'есть' : '…'}</b>
            </div>
            <div className="row between">
              <span>Синхронизация</span>
              <span>
                {sync.status === 'syncing' ? 'идёт…' : sync.status === 'error' ? `ошибка: ${sync.error}` : sync.status === 'offline' ? 'нет связи' : `ок, ${fmtTime(sync.lastSync)}`}
              </span>
            </div>
            <div className="row between">
              <span>Группа</span>
              <span>{status?.group || sched.data?.group || '—'}</span>
            </div>
            <div className="row between">
              <span>Пары обновлены</span>
              <span>{fmtTime(sched.data?.fetchedAt)}</span>
            </div>
            {sched.data?.error ? <div className="err-text">Сайт ТулГУ: {sched.data.error}</div> : null}
            <div className="row between">
              <span>Нейросеть</span>
              <span>{status ? (status.ai.configured ? `${status.ai.provider} · ${status.ai.model}` : 'не настроена') : '—'}</span>
            </div>
            {status?.ai.usage?.length ? (
              <div className="tiny muted">
                В этом месяце: {status.ai.usage.reduce((s, u) => s + u.calls, 0)} запросов, {Math.round(status.ai.usage.reduce((s, u) => s + u.input + u.output, 0) / 1000)} тыс. токенов
              </div>
            ) : null}
            <div className="grid-2" style={{ marginTop: 10 }}>
              <button className="btn small secondary" onClick={() => syncNow().then(() => toast('Синхронизировано'))}>
                Синхронизировать
              </button>
              <button className="btn small secondary" onClick={() => refreshSchedule(true).then(() => toast('Расписание обновлено'))}>
                Обновить пары
              </button>
            </div>
          </>
        ) : (
          <>
            <div>Режим без сервера: всё хранится только на телефоне, пары и нейросеть недоступны.</div>
            <button
              className="btn small"
              style={{ marginTop: 10 }}
              onClick={async () => {
                await metaSet('token', null);
                authStore.set({ token: null });
              }}
            >
              Подключить сервер
            </button>
          </>
        )}
      </div>

      {hasServer() ? (
        <>
          <div className="section-title">Уведомления</div>
          <div className="card small">
            {push === 'need-install' ? (
              <div>
                На iPhone push-уведомления работают только из установленного приложения: в Safari нажми <b>Поделиться → «На экран Домой»</b>, потом
                открой «Распорядок» с рабочего стола и включи уведомления здесь.
              </div>
            ) : push === 'unsupported' ? (
              <div>Этот браузер не поддерживает push-уведомления. Используй подписку на календарь ниже.</div>
            ) : (
              <>
                <div className="row between">
                  <span>Push-уведомления</span>
                  <b>{push === 'on' ? 'включены' : push === 'denied' ? 'запрещены в настройках' : 'выключены'}</b>
                </div>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  Напоминания о парах и делах, утренняя сводка и изменения в расписании. Время задаётся переменными {'{напоминание}'} и {'{напоминание_пара}'}.
                </div>
                <div className="grid-2" style={{ marginTop: 10 }}>
                  {push === 'on' ? (
                    <button className="btn small secondary" onClick={() => disablePush().then(() => pushState().then(setPush))}>
                      Выключить
                    </button>
                  ) : (
                    <button
                      className="btn small"
                      onClick={() =>
                        enablePush()
                          .then(() => {
                            toast('Уведомления включены');
                            return pushState().then(setPush);
                          })
                          .catch((e) => toast((e as Error).message))
                      }
                    >
                      Включить
                    </button>
                  )}
                  <button className="btn small secondary" onClick={() => api('/api/push/test', { body: {} }).then(() => toast('Отправил тестовое уведомление'))}>
                    Проверить
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="section-title">Бот ВКонтакте</div>
          <VkCard />

          <div className="section-title">Telegram-бот</div>
          <TelegramCard />

          <div className="section-title">Календарь iPhone (работает и без интернета)</div>
          <div className="card small">
            <div>
              Подпишись на свой распорядок в «Календаре» — тогда напоминания сработают, даже если интернета не будет: телефон сам заранее загрузит события.
            </div>
            {calUrl ? (
              <>
                <div className="kbd" style={{ display: 'block', margin: '10px 0', padding: 8 }}>
                  {calUrl}
                </div>
                <div className="grid-2">
                  <a className="btn small" href={calUrl.replace(/^https?:/, 'webcal:')}>
                    Подписаться
                  </a>
                  <button className="btn small secondary" onClick={() => navigator.clipboard?.writeText(calUrl).then(() => toast('Скопировано'))}>
                    Копировать
                  </button>
                </div>
                <div className="tiny muted" style={{ marginTop: 8 }}>
                  Если кнопка не сработала: Настройки → Календарь → Учётные записи → Добавить → Другое → Подписной календарь → вставь ссылку. В параметрах выключи
                  «Удалить напоминания». Ссылка секретная — никому не отправляй.
                </div>
              </>
            ) : (
              <div className="muted">Загружаю…</div>
            )}
          </div>
        </>
      ) : null}

      <div className="section-title">О тебе (для ИИ)</div>
      <div className="card">
        <Field label="Что ИИ должен о тебе знать" hint="Учёба, работа, режим, что мешает, как тебе удобнее планировать">
          <textarea className="textarea" value={profile} onChange={(e) => setProfile(e.target.value)} style={{ minHeight: 120 }} />
        </Field>
        <button
          className="btn small"
          onClick={() => {
            patch('settings', 'main', { profileNote: profile });
            toast('Сохранено');
          }}
        >
          Сохранить
        </button>
      </div>

      <div className="section-title">Игра</div>
      <div className="card">
        <Field label="Стартовый баланс, 🪙">
          <NumInput value={start} onChange={setStart} />
        </Field>
        <button
          className="btn small"
          onClick={() => {
            if (start == null) return;
            patch('ledger', 'start', { amount: Math.round(start) });
            toast('Стартовый баланс обновлён');
          }}
        >
          Сохранить
        </button>
      </div>

      <div className="section-title">Данные</div>
      <div className="card">
        <div className="grid-2">
          <button className="btn small secondary" onClick={exportData}>
            Резервная копия
          </button>
          <label className="btn small secondary">
            Восстановить
            <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
          </label>
        </div>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          {isLocalMode() ? 'Без сервера данные живут только в этом телефоне — периодически делай резервную копию.' : 'Данные хранятся в телефоне и копируются на твой сервер.'}
          {isIOS() && !isStandalone() ? ' Совет: установи приложение на экран «Домой» — так iPhone не будет чистить его данные.' : ''}
        </div>
        <div className="hr" />
        <button
          className="btn small danger"
          onClick={async () => {
            if (!confirm('Выйти на этом устройстве? Несинхронизированные изменения пропадут.')) return;
            await idbClearAll();
            location.reload();
          }}
        >
          Выйти и очистить это устройство
        </button>
      </div>
      <div className="tiny muted center" style={{ margin: '16px 0' }}>
        Умный распорядок · версия 1.0
      </div>
    </>
  );
}
