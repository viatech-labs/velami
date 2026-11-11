import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const require = createRequire(import.meta.url);
const Pdf = require('../src/pdf.js');
const files = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'files');

async function open(bytes) {
  return pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
}

function jpegSize(b) {
  for (let i = 2; i + 9 < b.length;) {
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + ((b[i + 2] << 8) | b[i + 3]);
  }
  throw new Error('no SOF');
}

test('текстовый слой PDF: у каждой буквы рамка на картинке страницы, строки по порядку', async () => {
  const doc = await open(readFileSync(path.join(files, 'estratto.pdf')));
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const { text, boxes } = Pdf.textLayout((await page.getTextContent()).items, viewport.transform);
  assert.equal(text.length, boxes.length);
  const at = text.indexOf('mario.rossi@example.com');
  assert.ok(at >= 0, text);
  const value = boxes.slice(at, at + 23);
  assert.ok(value.every((b) => b && b.x0 >= 0 && b.x1 <= viewport.width && b.y0 >= 0 && b.y1 <= viewport.height && b.x1 > b.x0));
  assert.ok(value.every((b, i) => i === 0 || b.x0 >= value[i - 1].x0), 'буквы идут слева направо');
  assert.equal(new Set(value.map((b) => b.line)).size, 1);
  const lines = boxes.filter(Boolean).map((b) => b.line);
  assert.ok(lines.every((l, i) => i === 0 || l >= lines[i - 1]), 'номера строк не убывают');
  await doc.cleanup();
});

test('элемент под углом закрывается целиком, ширина букв делится по measure', () => {
  const items = [
    { str: 'WW.', transform: [10, 0, 0, 10, 100, 700], width: 30, height: 10, hasEOL: true },
    { str: 'ab', transform: [0, 10, -10, 0, 50, 50], width: 20, height: 10, hasEOL: false },
  ];
  const { text, boxes } = Pdf.textLayout(items, [1, 0, 0, -1, 0, 800], (s) => [...s].reduce((n, c) => n + (c === 'W' ? 2 : 1), 0));
  assert.equal(text, 'WW.\nab');
  assert.equal(boxes[0].x0, 100);
  assert.equal(boxes[1].x0, 112);
  assert.equal(boxes[2].x1, 130);
  assert.equal(boxes[3], null);
  assert.deepEqual(boxes[4], boxes[5]);
  assert.ok(boxes[4].y1 - boxes[4].y0 >= 20, 'рамка повёрнутого элемента по всей длине');
});

test('невидимый слой: значение заменено меткой, строки раздельно', () => {
  const text = 'Email mario@x.it\nTel 347';
  const boxes = [...text].map((c, i) => (c === '\n' ? null : { x0: i * 5, x1: i * 5 + 5, y0: i < 16 ? 0 : 20, y1: i < 16 ? 10 : 30, line: i < 16 ? 1 : 2 }));
  const runs = Pdf.maskedRuns(text, boxes, [{ start: 6, end: 16, token: '[[EMAIL_1]]' }, { start: 21, end: 24, token: '[[PHONE_1]]' }]);
  assert.deepEqual(runs.map((r) => r.text), ['Email [[EMAIL_1]]', 'Tel [[PHONE_1]]']);
  assert.equal(runs[0].x1, 80);
});

test('собранный PDF: страницы картинками, текст читается с метками, метаданных нет', async () => {
  const jpeg = readFileSync(path.join(files, 'chat-ru.jpg'));
  const size = jpegSize(jpeg);
  const out = Pdf.write([
    { width: 595, height: 842, jpeg, imageWidth: size.width, imageHeight: size.height, runs: [
      { x: 50, y: 780, size: 12, width: 200, text: 'Встреча в четверг' },
      { x: 50, y: 760, size: 12, width: 220, text: 'Scrivere a [[EMAIL_1]] (Mario)' },
    ] },
    { width: 842, height: 595, jpeg, imageWidth: size.width, imageHeight: size.height, runs: [] },
  ]);
  const raw = Buffer.from(out).toString('latin1');
  assert.ok(raw.startsWith('%PDF-1.7'));
  assert.ok(!/\/Info|\/Metadata|\/JavaScript|\/OpenAction/.test(raw));
  const doc = await open(out);
  assert.equal(doc.numPages, 2);
  const p1 = await doc.getPage(1);
  const t = (await p1.getTextContent()).items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join('');
  assert.match(t, /Встреча в четверг/);
  assert.match(t, /Scrivere a \[\[EMAIL_1\]\] \(Mario\)/);
  const [, , w, h] = (await doc.getPage(2)).view;
  assert.deepEqual([w, h], [842, 595]);
  const meta = await doc.getMetadata();
  assert.equal(meta.metadata, null);
  await doc.cleanup();
});

test('картинки на странице: место по матрицам, полосы скана склеиваются, мелочь отбрасывается', async () => {
  const doc = await open(readFileSync(path.join(files, 'modulo.pdf')));
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 2 });
  const ops = await page.getOperatorList({ intent: 'print' });
  const regions = Pdf.imageRegions(ops.fnArray, ops.argsArray, pdfjs.OPS, vp.transform, Math.ceil(vp.width), Math.ceil(vp.height));
  assert.equal(regions.length, 1);
  const [r] = regions;
  assert.ok(Math.abs(r.x0 - 144) < 2 && Math.abs(r.y0 - 320) < 2 && Math.abs(r.x1 - 944) < 2 && Math.abs(r.y1 - 620) < 2, JSON.stringify(r));
  await doc.cleanup();

  const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintFormXObjectBegin: 5, paintFormXObjectEnd: 6, paintImageXObjectRepeat: 7 };
  const strip = (y) => [[OPS.save, null], [OPS.transform, [400, 0, 0, 50, 100, y]], [OPS.paintImageXObject, ['img', 1, 1]], [OPS.restore, null]];
  const icon = [[OPS.save, null], [OPS.transform, [10, 0, 0, 10, 700, 700]], [OPS.paintImageXObject, ['i', 1, 1]], [OPS.restore, null]];
  const run = (list) => Pdf.imageRegions(list.map((x) => x[0]), list.map((x) => x[1]), OPS, [1, 0, 0, 1, 0, 0], 800, 800);
  assert.deepEqual(run([...strip(100), ...strip(150), ...strip(200), ...icon]), [{ x0: 100, y0: 100, x1: 500, y1: 250 }]);
  assert.deepEqual(run([[OPS.paintFormXObjectBegin, [[2, 0, 0, 2, 0, 0], null]], ...strip(100), [OPS.paintFormXObjectEnd, null], ...strip(600)]),
    [{ x0: 200, y0: 200, x1: 800, y1: 300 }, { x0: 100, y0: 600, x1: 500, y1: 650 }]);
  assert.deepEqual(run([[OPS.paintImageXObjectRepeat, []]]), [{ x0: 0, y0: 0, x1: 800, y1: 800 }]);
});

test('аннотации: значение поля видно на странице, комментарий, его автор и ссылка скрыты', async () => {
  const doc = await open(readFileSync(path.join(files, 'modulo.pdf')));
  const notes = Pdf.annotationTexts(await (await doc.getPage(1)).getAnnotations({ intent: 'any' }));
  const field = notes.find((a) => a.shown === 'RSSMRA85T10A562S');
  assert.ok(field && field.rect.length === 4);
  const hidden = notes.map((a) => a.hidden).join('\n');
  assert.match(hidden, /Sentire anche giulia\.bianchi@example\.com/);
  assert.match(hidden, /Luca Verdi/);
  assert.match(hidden, /mailto:paolo\.neri@example\.com/);
  await doc.cleanup();
  assert.equal(Pdf.maskText('CF RSSMRA85T10A562S di Mario', [{ start: 23, end: 28, token: '[[PERSON_1]]' }, { start: 3, end: 19, token: '[[CF_1]]' }]), 'CF [[CF_1]] di [[PERSON_1]]');
});
