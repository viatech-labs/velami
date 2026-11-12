// Сквозной тест вложений: PDF, Word, Excel, PowerPoint, скан и картинка на двойнике chatgpt.com.
// Проверяем, что ушло на сервер сайта: копия с метками, оригинал по явному выбору или ничего.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { crc32, inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = process.env.PG_EXT_DIR ? path.resolve(process.env.PG_EXT_DIR) : root;
const files = path.join(root, 'test', 'fixtures', 'files');
const out = path.join(root, 'test', 'artifacts', 'files');
mkdirSync(out, { recursive: true });

const SECRETS = ['mario.rossi@example.com', '4111 1111 1111 1111', 'IT60 X054 2811 1010 0000 0123 456', 'RSSMRA85T10A562S'];
const LEFT = /Rossi|Bianchi|Verdi|example\.com|example%40|RSSMRA|4111|IT60 ?X054|347 ?123|333 ?123/i;
const OFFICE = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const require = createRequire(import.meta.url);
const Office = require(path.join(root, 'src', 'office.js'));
const Tesseract = require('tesseract.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
/* Что модель получит из PDF: текстовый слой и картинки страниц. */
async function pdfLayers(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    text += c.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('') + '\n';
  }
  const pages = doc.numPages;
  await doc.cleanup();
  const raw = Buffer.from(bytes);
  const images = [];
  for (let at = raw.indexOf('/DCTDecode'); at >= 0; at = raw.indexOf('/DCTDecode', at + 1)) {
    const start = raw.indexOf('stream\n', at) + 7;
    images.push(raw.subarray(start, raw.indexOf('\nendstream', start)));
  }
  return { text, pages, images, raw: raw.toString('latin1') };
}
let ocrWorker = null;
/* Что увидит модель на картинке: тот же OCR, что в расширении, но в Node. */
async function ocrText(bytes) {
  ocrWorker ||= await Tesseract.createWorker(['ita', 'eng', 'rus'], 1, { langPath: path.join(root, 'vendor', 'tesseract', 'lang'), cacheMethod: 'none', gzip: true });
  return (await ocrWorker.recognize(Buffer.from(bytes))).data.text;
}
/* Метки, которые прочитал OCR. Мелкий шрифт Tesseract читает с ошибками вроде 1BAN вместо IBAN,
   поэтому считаем по форме метки, а не по точному тексту. */
const labelsOn = (text) => text.match(/\[\[[A-Z1]{2,}_\d+\]\]|\b[A-Z1]{2,}_\d+\b/g) || [];
/* PNG с текстовым блоком метаданных (автор), чтобы проверить, что он не уходит. */
function withPngText(png, key, value) {
  const data = Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}

function unzipAll(buf, prefix = '') {
  const out = {};
  let end = buf.length - 22;
  while (buf.readUInt32LE(end) !== 0x06054b50) end--;
  let p = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0; n--) {
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const h = buf.readUInt32LE(p + 42);
    const start = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28);
    const raw = buf.subarray(start, start + size);
    const data = buf.readUInt16LE(p + 10) === 8 ? inflateRawSync(raw) : raw;
    out[prefix + name] = data;
    if (/\.(docx|xlsx|pptx)$/i.test(name) && data.length) Object.assign(out, unzipAll(data, prefix + name + '!'));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, fn) => { fn(); results.push(name); console.log('  ✓ ' + name); };
setTimeout(() => { console.error('Тест не уложился в 5 минут'); process.exit(2); }, 300000).unref();

const PAGE = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>ChatGPT (doppione)</title></head><body style="font:15px system-ui;margin:40px">
<div id="prompt-textarea" contenteditable="true" style="border:1px solid #ccc;min-height:40px"></div>
<input type="file" id="file" multiple><div id="drop" style="margin-top:12px;padding:30px;border:2px dashed #aaa">Trascina qui</div>
<script>
window.__got = [];
window.__bin = {};
async function upload(f, via) {
  window.__got.push({ name: f.name, size: f.size, type: f.type, via });
  const bytes = new Uint8Array(await f.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  window.__bin[f.name] = { type: f.type, data: btoa(bin) };
  await fetch('https://files.example/upload/' + encodeURIComponent(f.name), { method: 'PUT', body: f });
}
document.getElementById('file').onchange = (e) => { for (const f of e.target.files) upload(f, 'input'); };
const drop = document.getElementById('drop');
drop.ondragover = (e) => e.preventDefault();
drop.ondrop = (e) => { e.preventDefault(); for (const f of e.dataTransfer.files) upload(f, 'drop'); };
</script></body></html>`;

const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=1280,900'],
  defaultViewport: { width: 1280, height: 900 },
});

try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const admin = await browser.newPage();
  await admin.goto(`chrome-extension://${extId}/dashboard.html#log`);
  const ext = (msg) => admin.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  await ext({ type: 'setSettings', patch: { language: 'it', dictionary: [{ term: 'Mario Rossi', type: 'PERSON' }] } });

  const page = await browser.newPage();
  if (process.env.DEBUG) {
    page.on('console', (m) => console.log('   [page]', m.text()));
    browser.on('targetcreated', async (t) => {
      if (t.url().includes('offscreen')) { const w = await t.worker().catch(() => null) || await t.page().catch(() => null); if (w) w.on('console', (m) => console.log('   [offscreen]', m.text())); }
    });
  }
  const uploads = {};
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = req.url();
    if (u === 'https://chatgpt.com/') return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
    if (u.startsWith('https://files.example/upload/')) {
      const name = decodeURIComponent(u.split('/').pop());
      uploads[name] = req.postData() ?? (await req.fetchPostData().catch(() => null)) ?? '';
      return req.respond({ status: 201, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'PUT' }, body: '' });
    }
    return req.abort();
  });
  await page.goto('https://chatgpt.com/', { waitUntil: 'load' });
  await page.waitForSelector('[data-pg-gateway]', { timeout: 5000 });

  const cdp = await page.createCDPSession();
  const kids = (n) => [...(n.children || []), ...(n.shadowRoots || [])];
  const textOf = (n) => (n.nodeType === 3 ? n.nodeValue : n.nodeName === 'STYLE' ? '' : kids(n).map(textOf).join(' '));
  const tree = async () => (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })).root;
  const find = (n, test) => { if (test(n)) return n; for (const c of kids(n)) { const r = find(c, test); if (r) return r; } return null; };
  const cls = (n, name) => { const a = n.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === 'class' && a[i + 1].split(' ').includes(name)) return true; return false; };
  const hidden = (n) => { const a = n.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === 'hidden') return true; return false; };
  const dialog = async () => { const d = find(await tree(), (n) => cls(n, 'ask')); return d && !hidden(d) ? d : null; };
  async function waitDialog(tries = 80) {
    for (let i = 0; i < tries; i++) { const d = await dialog(); if (d) return d; await sleep(150); }
    const host = find(await tree(), (n) => (n.attributes || []).includes('data-pg-gateway'));
    throw new Error('окно Velami не появилось. Панель: ' + (host ? textOf(host).replace(/\s+/g, ' ').slice(0, 600) : 'нет'));
  }
  async function press(label) {
    const d = await waitDialog();
    const btn = find(d, (n) => n.nodeName === 'BUTTON' && textOf(n).trim() === label);
    assert.ok(btn, 'нет кнопки ' + label + ' в окне: ' + textOf(d));
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: btn.nodeId });
    const [x1, y1, , , x3, y3] = model.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
    await sleep(300);
  }
  async function tick() {
    const d = await waitDialog();
    const input = find(d, (n) => n.nodeName === 'INPUT');
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: input.nodeId });
    const [x1, y1, , , x3, y3] = model.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
  }
  const pick = async (name) => { await page.evaluate(() => { document.getElementById('file').value = ''; }); await (await page.$('#file')).uploadFile(path.join(files, name)); };
  const got = () => page.evaluate(() => window.__got.map((g) => g.name));
  const waitUpload = async (name) => { for (let i = 0; i < 60 && uploads[name] === undefined; i++) await sleep(150); return uploads[name]; };
  async function dropFile(name, type, data) {
    await page.evaluate(async (n, t, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], n, { type: t }));
      document.getElementById('drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, name, type, data.toString('base64'));
  }

  const sent = async (name, tries = 60) => {
    for (let i = 0; i < tries && uploads[name] === undefined; i++) await sleep(150);
    const b = await page.evaluate((n) => window.__bin[n], name);
    return b && { type: b.type, bytes: new Uint8Array(Buffer.from(b.data, 'base64')) };
  };

  /* Предпросмотр: «Guarda la copia» открывает вкладку расширения с копией, окно выбора остаётся открытым. */
  const sha = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  async function preview(shotName) {
    const opened = browser.waitForTarget((t) => t.url().includes('/preview.html#'), { timeout: 120000 });
    await press('Guarda la copia prima di inviarla');
    const tab = await (await opened).page();
    await tab.waitForSelector('#facts:not([hidden]), #gone:not([hidden])', { timeout: 30000 });
    await sleep(300);
    const seen = await tab.evaluate(() => ({
      gone: !document.getElementById('gone').hidden,
      title: document.getElementById('title').textContent,
      lead: document.getElementById('lead').textContent,
      name: document.getElementById('f-name').textContent,
      hash: document.getElementById('f-hash').textContent,
      found: document.getElementById('f-found').textContent,
      note: document.getElementById('note').textContent,
      sheets: [...document.querySelectorAll('#sheets canvas')].map((c) => [c.width, c.height]),
      text: document.getElementById('body').textContent,
      labels: document.querySelectorAll('#body .tok').length,
      all: document.body.innerText,
    }));
    await tab.screenshot({ path: path.join(out, shotName) });
    await tab.click('#back');
    for (let i = 0; i < 40 && !tab.isClosed(); i++) await sleep(100);
    seen.closed = tab.isClosed();
    return seen;
  }

  /* PDF с текстом: тот же PDF, места закрыты, текстовый слой с метками. */
  await pick('estratto.pdf');
  const askText = textOf(await waitDialog());
  await page.screenshot({ path: path.join(out, 'pdf-ask.png') });
  check('PDF с данными: окно с выбором, оригинал сайту пока не передан', () => {
    assert.match(askText, /Dati personali in «estratto\.pdf»/);
    assert.match(askText, /copia pulita «estratto\.pdf»: le stesse pagine/);
  });
  assert.deepEqual(await got(), []);
  const pdfPreview = await preview('pdf-preview.png');
  const afterPreview = await got();
  await press('Invia copia pulita');
  const pdfSent = await sent('estratto.pdf', 600);
  assert.ok(pdfSent, 'копия estratto.pdf не загружена');
  check('предпросмотр PDF: страницы и текст копии с метками, сайту ничего не передано, ушёл ровно показанный файл', () => {
    assert.ok(!pdfPreview.gone, 'копия не дошла до предпросмотра');
    assert.match(pdfPreview.title, /Copia pulita «estratto\.pdf»/);
    assert.match(pdfPreview.lead, /chatgpt\.com/);
    assert.equal(pdfPreview.sheets.length, 2);
    assert.ok(pdfPreview.labels >= 4, 'меток в тексте: ' + pdfPreview.labels);
    assert.ok(!LEFT.test(pdfPreview.all), 'в предпросмотре значение: ' + (pdfPreview.all.match(LEFT) || [])[0]);
    assert.deepEqual(afterPreview, []);
    assert.ok(pdfPreview.closed, 'вкладка предпросмотра не закрылась');
    assert.match(pdfPreview.hash, /^[0-9a-f]{64}$/);
    assert.equal(pdfPreview.hash, sha(pdfSent.bytes));
  });
  writeFileSync(path.join(out, 'estratto-sent.pdf'), pdfSent.bytes);
  const pdfCopy = await pdfLayers(pdfSent.bytes);
  const pdfSeen = await ocrText(pdfCopy.images[0]);
  writeFileSync(path.join(out, 'estratto-sent-p1.jpg'), pdfCopy.images[0]);
  check('PDF: сайт получил тот же PDF, в тексте метки, на странице данные закрыты', () => {
    assert.equal(pdfSent.type, 'application/pdf');
    assert.ok(pdfCopy.raw.startsWith('%PDF-'));
    assert.equal(pdfCopy.images.length, pdfCopy.pages);
    for (const v of SECRETS) assert.ok(!pdfCopy.text.includes(v), 'утекло ' + v);
    assert.ok(!LEFT.test(pdfCopy.raw), 'в байтах PDF осталось: ' + (pdfCopy.raw.match(LEFT) || [])[0]);
    for (const t of ['[[EMAIL_1]]', '[[CARD_1]]', '[[IBAN_1]]', '[[CF_1]]']) assert.ok(pdfCopy.text.includes(t), 'нет ' + t + ' в ' + pdfCopy.text);
    assert.match(pdfCopy.text, /Estratto conto/);
    assert.ok(!LEFT.test(pdfSeen), 'на странице осталось: ' + pdfSeen);
    assert.match(pdfSeen, /Estratto conto/);
  });

  /* Длинный PDF: имя после первых 20 000 символов. Модель читает файл целиком, по частям.
     Модель в git не хранится, без неё имя искать нечем. */
  if (existsSync(path.join(extDir, 'models/ner/model.onnx'))) {
    await pick('relazione-lunga.pdf');
    const longText = textOf(await waitDialog(400));
    await page.screenshot({ path: path.join(out, 'pdf-long-ask.png') });
    await press('Annulla');
    check('длинный PDF: имя в конце найдено, файл не ушёл как чистый', () => {
      assert.match(longText, /Dati personali in «relazione-lunga\.pdf»/);
      assert.match(longText, /Nome/);
      assert.equal(uploads['relazione-lunga.pdf'], undefined);
    });
  } else console.log('  - длинный PDF: пропущен, модель имён не собрана');

  /* Word: оригинал по явному выбору. */
  await pick('richiesta.docx');
  await press('Invia l’originale');
  const docx = await waitUpload('richiesta.docx');
  const gotDocx = await got();
  check('Word: «Invia l’originale» отдаёт сайту исходный файл', () => {
    assert.ok(docx !== undefined, 'оригинал не загружен');
    assert.ok(gotDocx.includes('richiesta.docx'));
  });

  /* Excel: отмена. */
  await pick('clienti.xlsx');
  await press('Annulla');
  await sleep(500);
  const afterCancel = await got();
  check('Excel: «Annulla» не передаёт сайту ничего, поле выбора очищено', () => {
    assert.ok(!afterCancel.some((n) => n.startsWith('clienti')), afterCancel.join(','));
  });
  assert.equal(await page.$eval('#file', (i) => i.files.length), 0);

  /* Office: чистая копия в том же формате. Проверяются сырые байты каждой части пакета. */
  async function sameFormat(file, sentName, mime, labels, look = '') {
    await pick(file);
    const text = textOf(await waitDialog());
    assert.match(text, new RegExp('«' + sentName.replace('.', '\\.') + '»: '), text);
    const shown = look ? await preview(look) : null;
    await press('Invia copia pulita');
    const copy = await sent(sentName);
    assert.ok(copy, 'копия ' + sentName + ' не загружена');
    assert.equal(copy.type, mime);
    const parts = unzipAll(Buffer.from(copy.bytes));
    const left = Object.entries(parts).filter(([n, b]) => !/\.(docx|xlsx|pptx)$/.test(n) && LEFT.test(b.toString('latin1')))
      .map(([n, b]) => n + ': ' + b.toString('latin1').match(LEFT)[0]);
    assert.deepEqual(left, []);
    const { text: copyText } = await Office.extract(copy.bytes, sentName);
    for (const t of labels) assert.ok(copyText.includes(t), 'нет ' + t + ' в ' + copyText.slice(0, 300));
    return { parts, copyText, bytes: copy.bytes, shown };
  }

  const pres = await sameFormat('presentazione.pptx', 'presentazione.pptx', OFFICE.pptx, ['[[EMAIL_1]]', '[[PERSON_1]]']);
  check('PowerPoint: копия тем же файлом с метками, адрес из двух фрагментов текста тоже скрыт', () => {
    assert.match(pres.copyText, /Cliente: \[\[PERSON_1\]\]/);
  });

  const word = await sameFormat('nascosto.docx', 'nascosto.docx', OFFICE.docx, ['[[EMAIL_', '[[IBAN_', '[[CF_', '[[PHONE_'], 'word-preview.png');
  check('предпросмотр Word: текст копии с метками без значений, ушёл ровно показанный файл', () => {
    assert.equal(word.shown.sheets.length, 0);
    assert.ok(word.shown.labels >= 4, 'меток в тексте: ' + word.shown.labels);
    assert.ok(!LEFT.test(word.shown.all), 'в предпросмотре значение: ' + (word.shown.all.match(LEFT) || [])[0]);
    assert.equal(word.shown.hash, sha(word.bytes));
  });
  check('Word: тот же .docx, данные скрыты в правках, комментариях, полях, ссылках и метаданных', () => {
    assert.match(word.parts['word/document.xml'].toString(), /w:author="Velami"/);
    assert.match(word.parts['word/comments.xml'].toString(), /\[\[CF_\d+\]\]/);
  });

  const book = await sameFormat('nascosto.xlsx', 'nascosto.xlsx', OFFICE.xlsx, ['[[CARD_', '[[IBAN_', '[[EMAIL_']);
  check('Excel: тот же .xlsx, число в ячейке, имя листа, комментарий и колонтитул скрыты', () => {
    assert.match(book.parts['xl/workbook.xml'].toString(), /name="CF CF_\d+"/);
  });

  await sameFormat('macro.docm', 'macro.docx', OFFICE.docx, ['[[EMAIL_']);
  check('Word с макросами: уходит .docx без макросов', () => {
    assert.equal(uploads['macro.docm'], undefined);
  });

  /* Скан: страница-картинка читается OCR, уходит тот же PDF с закрытыми местами. */
  await pick('scansione.pdf');
  const scanText = textOf(await waitDialog(400));
  await page.screenshot({ path: path.join(out, 'scan-ask.png') });
  await press('Invia copia pulita');
  const scanSent = await sent('scansione.pdf', 600);
  assert.ok(scanSent, 'копия scansione.pdf не загружена');
  const scanCopy = await pdfLayers(scanSent.bytes);
  const scanSeen = await ocrText(scanCopy.images[0]);
  writeFileSync(path.join(out, 'scansione-sent-p1.jpg'), scanCopy.images[0]);
  check('PDF-скан: текст страницы-картинки прочитан OCR, ушёл тот же PDF, места закрыты, слой с метками', () => {
    assert.match(scanText, /Dati personali in «scansione\.pdf»/);
    assert.ok(scanCopy.text.includes('[[EMAIL_1]]'), 'нет метки в слое: ' + scanCopy.text);
    assert.ok(!LEFT.test(scanCopy.text), 'утекло в слой: ' + scanCopy.text);
    assert.ok(!LEFT.test(scanSeen), 'на странице осталось: ' + scanSeen);
  });

  /* PDF, где в тексте страниц данных нет: они на вставленной картинке, в поле формы, в комментарии,
     ссылке и свойствах документа. */
  await pick('modulo.pdf');
  const formAsk = textOf(await waitDialog(400));
  await press('Invia copia pulita');
  const formSent = await sent('modulo.pdf', 600);
  assert.ok(formSent, 'копия modulo.pdf не загружена');
  const formCopy = await pdfLayers(formSent.bytes);
  const formSeen = await ocrText(formCopy.images[0]);
  writeFileSync(path.join(out, 'modulo-sent-p1.jpg'), formCopy.images[0]);
  check('PDF со скрытыми местами: найдены данные на картинке, в поле формы, комментарии, ссылке и свойствах', () => {
    assert.match(formAsk, /Dati personali in «modulo\.pdf»/);
    for (const t of ['IBAN', 'Codice fiscale', 'Telefono']) assert.ok(formAsk.includes(t), 'в окне нет ' + t + ': ' + formAsk);
    assert.match(formAsk, /E-mail ×[3-9]/);
  });
  check('PDF со скрытыми местами: в копии закрыты картинка и поле, нет комментария, ссылки и автора', () => {
    assert.ok(!LEFT.test(formCopy.raw), 'в байтах PDF осталось значение');
    assert.equal(String(formCopy.raw.match(/paolo|Luca|Annot|URI|Author/)), 'null');
    assert.ok(!LEFT.test(formCopy.text) && !/333 ?123/.test(formCopy.text), 'в слое осталось: ' + formCopy.text);
    assert.match(formCopy.text, /\[\[CF_\d+\]\]/);
    assert.ok(!LEFT.test(formSeen), 'на странице осталось: ' + formSeen);
    assert.ok(labelsOn(formSeen).length >= 5, 'меток не видно: ' + formSeen);
    assert.match(formSeen, /Modulo di richiesta/);
  });

  /* PDF с вложенным файлом: текстовое вложение читается, двоичное нет, и Velami об этом спрашивает. */
  await pick('allegato.pdf');
  const attachAsk = textOf(await waitDialog(400));
  await press('Invia copia pulita');
  const attachSent = await sent('allegato.pdf', 600);
  assert.ok(attachSent, 'копия allegato.pdf не загружена');
  const attachRaw = Buffer.from(attachSent.bytes).toString('latin1');
  await pick('allegato-binario.pdf');
  const binAsk = textOf(await waitDialog(400));
  await press('Annulla');
  check('PDF с вложенным файлом: данные из вложения найдены, в копии вложения нет, нечитаемое вложение под вопросом', () => {
    assert.match(attachAsk, /Dati personali in «allegato\.pdf»/);
    assert.ok(attachAsk.includes('IBAN'), attachAsk);
    assert.ok(!/EmbeddedFile|contatti|Filespec/.test(attachRaw) && !LEFT.test(attachRaw), 'вложение осталось в копии');
    assert.match(binAsk, /file incorporati/);
    assert.equal(uploads['allegato-binario.pdf'], undefined);
  });

  /* Картинка с данными: та же картинка, места закрыты метками. */
  await pick('bonifico.png');
  const shotAsk = textOf(await waitDialog(400));
  const shotPreview = await preview('image-preview.png');
  await press('Invia copia pulita');
  const shot = await sent('bonifico.png');
  check('предпросмотр картинки: показана закрытая картинка, ушёл ровно показанный файл', () => {
    assert.equal(shotPreview.sheets.length, 1);
    assert.ok(!LEFT.test(shotPreview.all), 'в предпросмотре значение: ' + (shotPreview.all.match(LEFT) || [])[0]);
    assert.equal(shotPreview.hash, sha(shot.bytes));
  });
  const shotSeen = await ocrText(shot.bytes);
  writeFileSync(path.join(out, 'bonifico-sent.png'), shot.bytes);
  check('картинка: окно с найденным, уходит та же PNG, на ней метки вместо данных', () => {
    assert.match(shotAsk, /ha letto il testo dell’immagine/);
    assert.equal(shot.type, 'image/png');
    assert.equal(Buffer.from(shot.bytes.subarray(1, 4)).toString(), 'PNG');
    assert.ok(!LEFT.test(shotSeen), 'на картинке осталось: ' + shotSeen);
    assert.ok(labelsOn(shotSeen).length >= 5, 'меток не видно: ' + shotSeen);
    assert.match(shotSeen, /Importo 1\.250,50 EUR/);
  });

  /* Фото по-русски с GPS: после очистки ни EXIF, ни данных. */
  await pick('chat-ru.jpg');
  await press('Invia copia pulita');
  const photo = await sent('chat-ru.jpg');
  const photoSeen = await ocrText(photo.bytes);
  check('JPEG: уходит JPEG без EXIF и GPS, почта и телефон закрыты', () => {
    assert.equal(photo.type, 'image/jpeg');
    const raw = Buffer.from(photo.bytes).toString('latin1');
    assert.ok(!raw.includes('Exif') && !raw.includes('Maria Petrova'), 'метаданные остались');
    assert.ok(!/maria\.petrova|916 ?123/i.test(photoSeen), 'на картинке осталось: ' + photoSeen);
    assert.match(photoSeen, /Встреча в четверг/);
  });

  /* Картинка без текста, но с автором в метаданных: уходит без окна и без метаданных. */
  await dropFile('sfondo.png', 'image/png', withPngText(readFileSync(path.join(files, 'paesaggio.png')), 'Author', 'Mario Rossi'));
  const plain = await sent('sfondo.png');
  check('картинка без текста: без окна, метаданные удалены, остальное как было', () => {
    assert.ok(plain, 'картинка не ушла');
    const raw = Buffer.from(plain.bytes).toString('latin1');
    assert.ok(!raw.includes('tEXt') && !raw.includes('Rossi'), 'метаданные остались');
    assert.equal(plain.bytes.length, readFileSync(path.join(files, 'paesaggio.png')).length);
  });

  /* Word, где данные только на вставленной картинке. */
  const receipt = await sameFormat('ricevuta.docx', 'ricevuta.docx', OFFICE.docx, []);
  const media = Object.entries(receipt.parts).find(([n]) => /^word\/media\/.+\.png$/.test(n));
  const mediaSeen = await ocrText(media[1]);
  check('Word с картинкой: картинка внутри документа закрыта метками', () => {
    assert.ok(!LEFT.test(mediaSeen), 'на картинке осталось: ' + mediaSeen);
    assert.ok(labelsOn(mediaSeen).length >= 4, 'меток не видно: ' + mediaSeen);
  });

  /* PDF с паролем: прочитать нельзя, спрашиваем. */
  await pick('protetto.pdf');
  const lockedText = textOf(await waitDialog());
  await press('Annulla');
  check('PDF с паролем: окно «protetto da password», по отмене не уходит', () => {
    assert.match(lockedText, /protetto da password/);
    assert.equal(uploads['protetto.pdf'], undefined);
  });

  /* Картинка в формате, который Velami не читает: спрашивает один раз, потом по галочке не спрашивает. */
  const png = readFileSync(path.join(root, 'icons', '128.png'));
  await dropFile('scheda.tiff', 'image/tiff', png);
  const imgText = textOf(await waitDialog());
  await tick();
  await press('Invia così com’è');
  await waitUpload('scheda.tiff');
  await sleep(600);
  await dropFile('scheda2.tiff', 'image/tiff', png);
  const second = await waitUpload('scheda2.tiff');
  check('картинка, которую Velami не читает: спросили один раз, после «Non chiedere più» уходит без окна', () => {
    assert.match(imgText, /Questo formato non lo apre/);
    assert.ok(second !== undefined, 'вторая картинка не ушла');
  });

  /* Простой текстовый файл как раньше: без окна. */
  writeFileSync(path.join(out, 'nota.txt'), 'Scrivere a mario.rossi@example.com');
  await page.evaluate(() => { document.getElementById('file').value = ''; });
  await (await page.$('#file')).uploadFile(path.join(out, 'nota.txt'));
  /* Содержимое берём из файла, который получила страница: тело запроса с файлом Chrome отдаёт не всегда. */
  const nota = await sent('nota.txt');
  const txt = nota && Buffer.from(nota.bytes).toString('utf8');
  check('текстовый файл чистится без вопросов, как раньше', () => {
    assert.ok(nota, 'текстовый файл не дошёл до сайта');
    assert.ok(!txt.includes('mario.rossi@example.com'), 'в файле настоящий адрес: ' + txt);
    assert.ok(txt.includes('[[EMAIL_1]]'), 'в файле нет метки: ' + txt);
  });

  await sleep(800);
  const log = await ext({ type: 'getLog' });
  const pillText = textOf(find(await tree(), (n) => cls(n, 'pill')));
  check('журнал: копии записаны как проверенные, оригиналы по выбору с причиной, тревоги нет', () => {
    assert.ok(log.some((e) => e.kind === 'file' && e.file === 'estratto.pdf' && /stesso formato/.test(e.note || '')));
    const pdfEntry = log.find((e) => e.kind === 'file' && e.file === 'estratto.pdf');
    assert.deepEqual(pdfEntry.copy, { name: 'estratto.pdf', bytes: pdfSent.bytes.length, sha256: sha(pdfSent.bytes) });
    const shotEntry = log.find((e) => e.kind === 'file' && e.file === 'bonifico.png');
    assert.equal(shotEntry.copy.sha256, sha(shot.bytes));
    const wordEntry = log.find((e) => e.kind === 'file' && e.file === 'nascosto.docx');
    assert.equal(wordEntry.copy.sha256, sha(word.bytes));
    assert.ok(log.some((e) => e.kind === 'unchecked' && e.file === 'richiesta.docx' && /su tua scelta/.test(e.note)));
    assert.ok(log.some((e) => e.kind === 'unchecked' && e.file === 'scheda.tiff'));
    assert.ok(log.some((e) => e.kind === 'file' && e.file === 'bonifico.png' && /stessa immagine/.test(e.note || '')));
    assert.ok(!/non controllato/i.test(pillText), 'кнопка показывает тревогу: ' + pillText);
  });
  const state = await ext({ type: 'state' });
  check('настройка «не спрашивать про картинки» сохранилась', () => assert.equal(state.settings.askImages, false));

  console.log(`\nВсе проверки пройдены: ${results.length}`);
} catch (err) {
  console.error('\nПРОВАЛ:', err && err.message ? err.message : err);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (ocrWorker) await ocrWorker.terminate();
}
