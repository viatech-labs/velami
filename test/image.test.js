const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Img = require('../src/image.js');

const files = path.join(__dirname, 'fixtures', 'files');
const word = (text, x0, y0 = 10, h = 14) => ({
  text, bbox: { x0, y0, x1: x0 + text.length * 8, y1: y0 + h },
  symbols: [...text].map((ch, i) => ({ text: ch, bbox: { x0: x0 + i * 8, y0, x1: x0 + i * 8 + 7, y1: y0 + h } })),
});
const page = (...lines) => [{ paragraphs: [{ lines: lines.map((words) => ({ words })) }] }];

test('формат картинки определяется по байтам, а не по имени', () => {
  assert.equal(Img.formatOf(fs.readFileSync(path.join(files, 'bonifico.png'))), 'png');
  assert.equal(Img.formatOf(fs.readFileSync(path.join(files, 'chat-ru.jpg'))), 'jpeg');
  assert.equal(Img.formatOf(Buffer.from('GIF89a......')), 'gif');
  assert.equal(Img.formatOf(Buffer.from('%PDF-1.7 ....')), null);
});

test('раскладка OCR: слова через пробел, строки через перевод строки, почта не рвётся у @', () => {
  const { text, boxes } = Img.layout(page(
    [word('Email', 0), word('mario.rossi@', 50), word('example.com,', 150), word('tel', 260)],
    [word('IBAN', 0, 30), word('IT60', 40, 30)],
  ));
  assert.equal(text, 'Email mario.rossi@example.com, tel\nIBAN IT60');
  assert.equal(boxes.length, text.length);
  assert.equal(boxes[5], null);
  assert.equal(boxes[text.indexOf('IT60')].line, 2);
});

test('место закрывается целиком, но не залезает на соседние символы', () => {
  const { text, boxes } = Img.layout(page([word('Nome:', 0), word('Mario', 50), word('Rossi', 100), word('ok', 160)]));
  const start = text.indexOf('Mario');
  const { rects, lost } = Img.rectsFor(boxes, [{ start, end: start + 'Mario Rossi'.length, token: '[[PERSON_1]]', id: 'p1' }]);
  assert.deepEqual(lost, []);
  assert.equal(rects.length, 1);
  const r = rects[0];
  assert.ok(r.x0 <= 50 && r.x1 >= 140, JSON.stringify(r));
  assert.ok(r.x0 > 39 && r.x1 < 160, 'залезло на соседей: ' + JSON.stringify(r));
  assert.equal(r.token, '[[PERSON_1]]');
});

test('значение на двух строках: две заливки, метка только в первой', () => {
  const { text, boxes } = Img.layout(page([word('via', 0), word('Roma', 40)], [word('12', 0, 30), word('Milano', 30, 30)]));
  const start = text.indexOf('Roma');
  const { rects } = Img.rectsFor(boxes, [{ start, end: text.indexOf('Milano') + 6, token: '[[ADDRESS_1]]', id: 'a' }]);
  assert.equal(rects.length, 2);
  assert.deepEqual(rects.map((r) => r.token), ['[[ADDRESS_1]]', '']);
});

test('JPEG: EXIF с автором и GPS удаляется без перекодирования', () => {
  const src = fs.readFileSync(path.join(files, 'chat-ru.jpg'));
  const r = Img.stripMeta(new Uint8Array(src));
  assert.deepEqual(r.removed, ['exif']);
  assert.equal(r.gps, true);
  assert.equal(r.orientation, 1);
  const out = Buffer.from(r.bytes);
  assert.ok(!out.includes('Exif') && !out.includes('Maria Petrova'));
  assert.equal(out[0], 0xff); assert.equal(out[1], 0xd8);
  assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9]);
  assert.ok(src.length - out.length > 0 && src.length - out.length < 2000);
});

test('PNG: текстовые блоки и время удаляются, картинка остаётся той же', () => {
  const png = fs.readFileSync(path.join(files, 'paesaggio.png'));
  const zlib = require('node:zlib');
  const data = Buffer.from('Author\0Mario Rossi', 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0); chunk.write('tEXt', 4, 'latin1'); data.copy(chunk, 8);
  chunk.writeUInt32BE(zlib.crc32(chunk.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  const r = Img.stripMeta(new Uint8Array(Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)])));
  assert.deepEqual(r.removed, ['text']);
  assert.ok(Buffer.from(r.bytes).equals(png));
});

test('WebP: EXIF и XMP удаляются, флаги VP8X и размер RIFF исправлены', () => {
  const ch = (type, body) => {
    const b = Buffer.alloc(8 + body.length + (body.length & 1));
    b.write(type, 0, 'latin1'); b.writeUInt32LE(body.length, 4); Buffer.from(body).copy(b, 8);
    return b;
  };
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x0c;
  const body = Buffer.concat([ch('VP8X', vp8x), ch('VP8 ', Buffer.alloc(11, 1)), ch('EXIF', Buffer.from('Exif\0\0GPS')), ch('XMP ', Buffer.from('<x:xmpmeta/>'))]);
  const head = Buffer.alloc(12); head.write('RIFF', 0, 'latin1'); head.writeUInt32LE(body.length + 4, 4); head.write('WEBP', 8, 'latin1');
  const r = Img.stripMeta(new Uint8Array(Buffer.concat([head, body])));
  const out = Buffer.from(r.bytes);
  assert.deepEqual(r.removed, ['exif', 'xmp']);
  assert.ok(!out.includes('EXIF') && !out.includes('xmpmeta'));
  assert.equal(out.readUInt32LE(4), out.length - 8);
  assert.equal(out[20] & 0x0c, 0);
});

test('результат: PNG, JPEG и WebP остаются собой, GIF и BMP становятся PNG', () => {
  assert.deepEqual(Img.output('foto.jpg', 'jpeg'), { name: 'foto.jpg', type: 'image/jpeg' });
  assert.deepEqual(Img.output('anim.gif', 'gif'), { name: 'anim.png', type: 'image/png' });
});
