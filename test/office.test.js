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

const PG = require('../src/detector.js');
const zlib = require('node:zlib');

/* Распаковка всего пакета, включая вложенные документы, для проверки сырых байтов. */
function unzipAll(buf, prefix = '') {
  const out = {};
  let end = buf.length - 22;
  while (buf.readUInt32LE(end) !== 0x06054b50) end--;
  let p = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const h = buf.readUInt32LE(p + 42);
    const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
    const raw = buf.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.strictEqual(zlib.crc32(data), buf.readUInt32LE(p + 16), 'crc ' + name);
    out[prefix + name] = data;
    if (/\.(docx|xlsx|pptx)$/i.test(name) && data.length) Object.assign(out, unzipAll(data, prefix + name + '!'));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

const PEOPLE = [['Mario Rossi', 'PERSON'], ['Giulia Bianchi', 'PERSON']];
async function cleanFixture(name) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, name)));
  const r = await O.extract(bytes, name);
  const m = PG.maskText(r.text, { vault: new PG.Vault(), commit: true });
  const values = m.findings.map((f) => ({ id: f.id, type: f.type, value: f.value, token: f.token }));
  PEOPLE.forEach(([value, type], i) => values.push({ id: 'person:' + i, type, value, token: `[[PERSON_${i + 1}]]` }));
  const c = await O.clean(bytes, name, values, PG.locate);
  return { r, c, values, parts: unzipAll(Buffer.from(c.bytes)) };
}
const LEFT = /Rossi|Bianchi|Verdi|example\.com|example%40|RSSMRA|4111|IT60 ?X054|347 ?123/i;
const leftovers = (parts) => Object.entries(parts).filter(([n, b]) => !/\.(docx|xlsx|pptx)$/.test(n) && LEFT.test(b.toString('latin1')))
  .map(([n, b]) => n + ': ' + b.toString('latin1').match(LEFT)[0]);

test('разбор видит данные в скрытых местах Word', async () => {
  const { text } = await read('nascosto.docx');
  assert.match(text, /IT60 X054 2811 1010 0000 0123 456/, 'удалённый текст правки');
  assert.match(text, /mailto:giulia\.bianchi@example\.com/, 'поле HYPERLINK');
  assert.match(text, /mailto:anna\.verdi@example\.com/, 'внешняя ссылка');
  assert.match(text, /Verificare il codice RSSMRA85T10A562S/, 'комментарий');
  assert.match(text, /Pratica RSSMRA85T10A562S/, 'заголовок в метаданных');
  assert.match(text, /^Mario Rossi$/m, 'автор документа');
  assert.match(text, /^Giulia Bianchi$/m, 'автор правки и комментария');
});

test('Word: очищенная копия в том же формате, без данных ни в одной части', async () => {
  const { c, parts } = await cleanFixture('nascosto.docx');
  assert.strictEqual(c.name, 'nascosto.docx');
  assert.deepStrictEqual(leftovers(parts), []);
  const doc = parts['word/document.xml'].toString();
  assert.match(doc, /\[\[EMAIL_\d\]\]/);
  assert.match(doc, /<w:delText xml:space="preserve">\[\[IBAN_1\]\]<\/w:delText>/);
  assert.match(doc, /w:author="Velami"/);
  assert.match(parts['word/comments.xml'].toString(), /\[\[CF_1\]\]/);
  assert.match(parts['docProps/core.xml'].toString(), /<dc:creator><\/dc:creator>/);
  assert.ok(!parts['docProps/thumbnail.jpeg'], 'миниатюра удалена');
  assert.ok(!/thumbnail/.test(parts['_rels/.rels'].toString()), 'связь с миниатюрой удалена');
});

test('Word: значение, разорванное на фрагменты с разным оформлением, заменяется одной меткой', async () => {
  const { parts } = await cleanFixture('nascosto.docx');
  const doc = parts['word/document.xml'].toString();
  const para = doc.match(/<w:p>(?:(?!<\/w:p>)[\s\S])*Contatto principale[\s\S]*?<\/w:p>/)[0];
  const texts = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]);
  assert.strictEqual(texts.join(''), 'Contatto principale: [[EMAIL_1]]');
  assert.match(para, /<w:b\/>/, 'жирный фрагмент на месте');
});

test('Excel: число в ячейке, формула, имя листа, комментарий, колонтитул, подсказка', async () => {
  const { r, c, parts } = await cleanFixture('nascosto.xlsx');
  assert.match(r.text, /4111111111111111/);
  assert.match(r.text, /Chiedere a anna\.verdi@example\.com/);
  assert.deepStrictEqual(leftovers(parts), []);
  const sheet = parts['xl/worksheets/sheet1.xml'].toString();
  assert.match(sheet, /<c r="B1" t="inlineStr"><is><t xml:space="preserve">\[\[CARD_1\]\]<\/t><\/is><\/c>/);
  assert.match(sheet, /<f>"EMAIL_\d"<\/f>/, 'в формуле метка без скобок');
  assert.match(sheet, /<oddHeader>&amp;C\[\[EMAIL_\d\]\]<\/oddHeader>/, 'код колонтитула &C на месте');
  assert.match(parts['xl/workbook.xml'].toString(), /name="CF CF_1"/, 'в имени листа метка без скобок');
  assert.match(parts['xl/comments/comment1.xml'].toString(), /<author>Velami<\/author>/);
  assert.strictEqual(c.name, 'nascosto.xlsx');
});

test('PowerPoint: заметки, диаграмма и вложенная книга диаграммы', async () => {
  const { r, parts } = await cleanFixture('nascosto.pptx');
  assert.match(r.text, /Codice fiscale del cliente RSSMRA85T10A562S/);
  assert.match(r.text, /giulia\.bianchi@example\.com/);
  assert.deepStrictEqual(leftovers(parts), []);
  const nested = Object.keys(parts).filter((n) => n.includes('.xlsx!'));
  assert.ok(nested.length, 'вложенная книга разобрана');
});

test('макросы удаляются, .docm становится .docx', async () => {
  const { c, parts } = await cleanFixture('macro.docm');
  assert.strictEqual(c.name, 'macro.docx');
  assert.ok(!Object.keys(parts).some((n) => /vba/i.test(n)));
  assert.ok(!/macroEnabled|vbaProject/.test(parts['[Content_Types].xml'].toString()));
  assert.ok(!/vbaProject/.test(parts['word/_rels/document.xml.rels'].toString()));
});

test('без найденных значений меняется только автор документа', async () => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, 'clienti.xlsx')));
  const c = await O.clean(bytes, 'clienti.xlsx', [], PG.locate);
  assert.strictEqual(c.replaced, 0);
  const before = unzipAll(Buffer.from(bytes));
  const after = unzipAll(Buffer.from(c.bytes));
  for (const n of Object.keys(before)) if (n !== 'docProps/core.xml') assert.ok(before[n].equals(after[n]), n);
  assert.match(after['docProps/core.xml'].toString(), /<dc:creator[^>]*><\/dc:creator>/);
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
