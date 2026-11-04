import { useEffect, useState } from 'react';
import { apiBlob } from '../api';
import type { Attachment } from '../types';

function AuthImage({ id, onOpen }: { id: string; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    apiBlob(`/api/files/${id}`)
      .then((b) => {
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => setFailed(true));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  if (failed) return <div className="att-thumb att-missing">нет связи</div>;
  if (!url) return <div className="att-thumb att-missing">…</div>;
  return (
    <button className="att-thumb" onClick={() => onOpen(url)} aria-label="Открыть картинку">
      <img src={url} alt="" />
    </button>
  );
}

export function Attachments({ list }: { list?: Attachment[] }) {
  const [full, setFull] = useState<string | null>(null);
  if (!list?.length) return null;
  const images = list.filter((a) => a.kind === 'image' && a.id);
  const voices = list.filter((a) => a.kind === 'voice' && a.text);
  return (
    <div className="attachments">
      {images.length ? (
        <div className="att-grid">
          {images.map((a) => (
            <AuthImage key={a.id} id={a.id!} onOpen={setFull} />
          ))}
        </div>
      ) : null}
      {voices.map((a, i) => (
        <div key={i} className="att-voice">
          <span>🎤</span>
          <div className="grow">
            <div className="tiny muted">{a.from || 'Голосовое'}{a.duration ? ` · ${Math.floor(a.duration / 60)}:${String(Math.round(a.duration % 60)).padStart(2, '0')}` : ''}</div>
            <div className="small">«{a.text}»</div>
          </div>
        </div>
      ))}
      {images.some((a) => a.text) ? (
        <details className="small">
          <summary className="muted">Текст с картинок</summary>
          {images
            .filter((a) => a.text)
            .map((a) => (
              <div key={a.id} className="att-ocr">
                {a.text}
              </div>
            ))}
        </details>
      ) : null}
      {full ? (
        <div className="att-viewer" onClick={() => setFull(null)} role="dialog">
          <img src={full} alt="" />
        </div>
      ) : null}
    </div>
  );
}
