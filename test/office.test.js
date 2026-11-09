const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../src/office.js');

const dir = path.join(__dirname, 'fixtures', 'files');
const read = (name) => O.extract(new Uint8Array(fs.readFileSync(path.join(dir, name))), name);

test('Word: абзацы, таблица строкой, нижний колонтитул', async () => {
  const r = await read('richiesta.docx');
  assert.strictEqual(r.kind, 'docx');
  assert.match(r.text, /Il cliente Mario Rossi chiede un bonifico\. Email mario\.rossi@example\.com/);
  assert.match(r.text, /^IBAN\tIT60 X054 2811 1010 0000 0123 456$/m);
  assert.match(r.text, /^Codice fiscale\tRSSMRA85T10A562S$/m);
  assert.match(r.text, /carta 4111 1111 1111 1111/);
});

test('Excel: листы, ячейки на своих местах, общие строки и числа', async () => {
  const r = await read('clienti.xlsx');
  assert.strictEqual(r.kind, 'xlsx');
  assert.match(r.text, /^\[Clienti\]$/m);
  assert.match(r.text, /^Mario Rossi\tmario\.rossi@example\.com\tIT60 X054 2811 1010 0000 0123 456\t1250\.5$/m);
  assert.match(r.text, /^Giulia Bianchi\tgiulia\.bianchi@example\.com\t\t300$/m);
  assert.match(r.text, /^\[Note\]\n\tChiamare il \+39 347 123 4567$/m);
});

test('PowerPoint: текст из нескольких фрагментов склеивается в строку', async () => {
  const r = await read('presentazione.pptx');
  assert.strictEqual(r.text, 'Cliente: Mario Rossi\nContatto mario.rossi@example.com');
});

test('тип по имени и защита от не-zip', async () => {
  assert.strictEqual(O.kindOf('a.DOCX'), 'docx');
  assert.strictEqual(O.kindOf('a.xlsm'), 'xlsx');
  assert.strictEqual(O.kindOf('a.doc'), null);
  await assert.rejects(O.extract(new Uint8Array([1, 2, 3, 4]), 'x.docx'), /not a zip/);
});

test('zip-бомба: распаковка останавливается на лимите', async () => {
  const zlib = require('node:zlib');
  const big = zlib.deflateRawSync(Buffer.alloc(80 * 1024 * 1024, 0x41));
  const name = Buffer.from('word/document.xml');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(big.length, 18); local.writeUInt32LE(0xffffffff, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(big.length, 20); central.writeUInt32LE(0xffffffff, 24); central.writeUInt16LE(name.length, 28);
  const cdOffset = 30 + name.length + big.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([local, name, big, central, name, end]);
  await assert.rejects(O.extract(new Uint8Array(zip), 'bomba.docx'), /too large/);
});
