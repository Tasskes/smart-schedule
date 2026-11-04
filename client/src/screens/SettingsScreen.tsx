import { useEffect, useState } from 'react';
import { api, authStore, hasServer, isLocalMode, loadStatus, statusStore } from '../api';
import { Field, NumInput, toast } from '../components/ui';
import { idbClearAll, metaSet } from '../db/idb';
import { refreshSchedule, useSchedule } from '../db/schedule';
import { exportAll, get, importAll, patch, useRecord } from '../db/store';
import { disablePush, enablePush, isIOS, isStandalone, pushState } from '../push';
import { syncNow, syncStore } from '../sync';

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
