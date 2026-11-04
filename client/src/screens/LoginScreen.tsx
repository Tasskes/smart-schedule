import { useState } from 'react';
import { api, authStore, LOCAL_TOKEN } from '../api';
import { metaSet } from '../db/idb';

export function LoginScreen() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const login = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string }>('/api/login', { body: { password }, auth: false });
      await metaSet('token', res.token);
      authStore.set({ token: res.token });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const local = async () => {
    await metaSet('token', LOCAL_TOKEN);
    authStore.set({ token: LOCAL_TOKEN });
  };

  return (
    <div className="login">
      <img className="logo" src="/icons/icon-192.png" alt="" />
      <h1 className="center" style={{ margin: '0 0 6px' }}>Умный распорядок</h1>
      <p className="center muted small" style={{ marginTop: 0 }}>
        Пары ТулГУ, план недели с ИИ, цели, задачи и питание
      </p>
      <div className="card" style={{ marginTop: 20 }}>
        <div className="field">
          <label>Пароль от твоего сервера</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
            autoComplete="current-password"
            placeholder="APP_PASSWORD из файла .env"
          />
        </div>
        {error ? <div className="err-text" style={{ marginBottom: 10 }}>{error}</div> : null}
        <button className="btn block" disabled={busy || !password} onClick={login}>
          {busy ? 'Вхожу…' : 'Войти'}
        </button>
      </div>
      <button className="btn ghost block" onClick={local}>
        Попробовать без сервера
      </button>
      <p className="tiny muted center">Без сервера не будет автозагрузки пар, нейросети и уведомлений — только ручной режим.</p>
    </div>
  );
}
