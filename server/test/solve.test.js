import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-solve-'));
process.env.APP_PASSWORD = 'test';
process.env.YANDEX_API_KEY = 'test-key';
process.env.YANDEX_FOLDER_ID = 'test-folder';

const { solvePhotoHandler } = await import('../src/solve.js');
const { setMediaImpl } = await import('../src/media.js');
const { filePath } = await import('../src/files.js');

const call = (body) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(d) {
        resolve({ status: this.statusCode, body: d });
      },
    };
    solvePhotoHandler({ body }, res).catch(reject);
  });

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

test('photo of an assignment is stored and its text recognized', async () => {
  let seen = null;
  setMediaImpl({ ocr: async (buf, mime) => ((seen = { len: buf.length, mime }), 'Найдите x: 2x + 3 = 7') });
  const r = await call({ data: `data:image/jpeg;base64,${jpeg.toString('base64')}`, mime: 'image/jpeg' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ocr, 'ok');
  assert.equal(r.body.text, 'Найдите x: 2x + 3 = 7');
  assert.deepEqual(seen, { len: jpeg.length, mime: 'image/jpeg' });
  const p = filePath(r.body.fileId);
  assert.ok(p && fs.existsSync(p), 'file saved');
  assert.deepEqual(fs.readFileSync(p), jpeg);
});

test('a failed recognition still keeps the photo and explains why', async () => {
  setMediaImpl({ ocr: async () => { throw new Error('Vision OCR: нет доступа'); } });
  const r = await call({ data: jpeg.toString('base64'), mime: 'image/jpeg' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ocr, 'error');
  assert.match(r.body.error, /нет доступа/);
  assert.ok(fs.existsSync(filePath(r.body.fileId)));
});

test('bad uploads are rejected', async () => {
  assert.equal((await call({})).status, 400);
  assert.equal((await call({ data: jpeg.toString('base64'), mime: 'application/zip' })).status, 400);
  assert.equal((await call({ data: '', mime: 'image/png' })).status, 400);
});
