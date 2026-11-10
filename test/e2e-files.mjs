// Сквозной тест вложений: PDF, Word, Excel, PowerPoint, скан и картинка на двойнике chatgpt.com.
// Проверяем, что ушло на сервер сайта: копия с метками, оригинал по явному выбору или ничего.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { crc32, inflateRawSync } from 'node:zlib';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = process.env.PG_EXT_DIR ? path.resolve(process.env.PG_EXT_DIR) : root;
const files = path.join(root, 'test', 'fixtures', 'files');
const out = path.join(root, 'test', 'artifacts', 'files');
mkdirSync(out, { recursive: true });

const SECRETS = ['mario.rossi@example.com', '4111 1111 1111 1111', 'IT60 X054 2811 1010 0000 0123 456', 'RSSMRA85T10A562S'];
const LEFT = /Rossi|Bianchi|Verdi|example\.com|example%40|RSSMRA|4111|IT60 ?X054|347 ?123/i;
const OFFICE = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const require = createRequire(import.meta.url);
const Office = require(path.join(root, 'src', 'office.js'));
const Tesseract = require('tesseract.js');
let ocrWorker = null;
/* Что увидит модель на картинке: тот же OCR, что в расширении, но в Node. */
async function ocrText(bytes) {
  ocrWorker ||= await Tesseract.createWorker(['ita', 'eng', 'rus'], 1, { langPath: path.join(root, 'vendor', 'tesseract', 'lang'), cacheMethod: 'none', gzip: true });
  return (await ocrWorker.recognize(Buffer.from(bytes))).data.text;
}
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

  /* PDF с текстом: копия с метками. */
  await pick('estratto.pdf');
  const askText = textOf(await waitDialog());
  await page.screenshot({ path: path.join(out, 'pdf-ask.png') });
  check('PDF с данными: окно с выбором, оригинал сайту пока не передан', () => {
    assert.match(askText, /Dati personali in «estratto\.pdf»/);
    assert.match(askText, /estratto\.pdf\.txt/);
  });
  assert.deepEqual(await got(), []);
  await press('Invia copia pulita');
  const pdfCopy = await waitUpload('estratto.pdf.txt');
  check('PDF: сайт получил текстовую копию с метками, без данных', () => {
    assert.ok(pdfCopy, 'копия не загружена');
    for (const v of SECRETS) assert.ok(!pdfCopy.includes(v), 'утекло ' + v);
    for (const t of ['[[EMAIL_1]]', '[[CARD_1]]', '[[IBAN_1]]', '[[CF_1]]']) assert.ok(pdfCopy.includes(t), 'нет ' + t);
    assert.match(pdfCopy, /Estratto conto/);
    assert.equal(uploads['estratto.pdf'], undefined);
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
  const sent = async (name) => {
    await waitUpload(name);
    const b = await page.evaluate((n) => window.__bin[n], name);
    return b && { type: b.type, bytes: new Uint8Array(Buffer.from(b.data, 'base64')) };
  };
  async function sameFormat(file, sentName, mime, labels) {
    await pick(file);
    const text = textOf(await waitDialog());
    assert.match(text, new RegExp('«' + sentName.replace('.', '\\.') + '»: '), text);
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
    return { parts, copyText };
  }

  const pres = await sameFormat('presentazione.pptx', 'presentazione.pptx', OFFICE.pptx, ['[[EMAIL_1]]', '[[PERSON_1]]']);
  check('PowerPoint: копия тем же файлом с метками, адрес из двух фрагментов текста тоже скрыт', () => {
    assert.match(pres.copyText, /Cliente: \[\[PERSON_1\]\]/);
  });

  const word = await sameFormat('nascosto.docx', 'nascosto.docx', OFFICE.docx, ['[[EMAIL_', '[[IBAN_', '[[CF_', '[[PHONE_']);
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

  /* Скан: страница-картинка читается OCR, уходит текстовая копия с метками. */
  await pick('scansione.pdf');
  const scanText = textOf(await waitDialog(400));
  await page.screenshot({ path: path.join(out, 'scan-ask.png') });
  await press('Invia copia pulita');
  const scanCopy = await waitUpload('scansione.pdf.txt');
  check('PDF-скан: текст страницы-картинки прочитан OCR, ушла копия с метками', () => {
    assert.match(scanText, /Dati personali in «scansione\.pdf»/);
    assert.ok(scanCopy && scanCopy.includes('[[EMAIL_1]]'), 'нет метки в копии: ' + scanCopy);
    assert.ok(!LEFT.test(scanCopy), 'утекло: ' + scanCopy);
    assert.equal(uploads['scansione.pdf'], undefined);
  });

  /* Картинка с данными: та же картинка, места закрыты метками. */
  await pick('bonifico.png');
  const shotAsk = textOf(await waitDialog(400));
  await press('Invia copia pulita');
  const shot = await sent('bonifico.png');
  const shotSeen = await ocrText(shot.bytes);
  writeFileSync(path.join(out, 'bonifico-sent.png'), shot.bytes);
  check('картинка: окно с найденным, уходит та же PNG, на ней метки вместо данных', () => {
    assert.match(shotAsk, /ha letto il testo dell’immagine/);
    assert.equal(shot.type, 'image/png');
    assert.equal(Buffer.from(shot.bytes.subarray(1, 4)).toString(), 'PNG');
    assert.ok(!LEFT.test(shotSeen), 'на картинке осталось: ' + shotSeen);
    assert.match(shotSeen, /IBAN_1/);
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
    assert.match(mediaSeen, /IBAN_1/);
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
  const txt = await waitUpload('nota.txt');
  check('текстовый файл чистится без вопросов, как раньше', () => {
    assert.ok(txt && txt.includes('[[EMAIL_1]]') && !txt.includes('mario.rossi@example.com'));
  });

  await sleep(800);
  const log = await ext({ type: 'getLog' });
  const pillText = textOf(find(await tree(), (n) => cls(n, 'pill')));
  check('журнал: копии записаны как проверенные, оригиналы по выбору с причиной, тревоги нет', () => {
    assert.ok(log.some((e) => e.kind === 'file' && e.file === 'estratto.pdf' && /estratto\.pdf\.txt/.test(e.note || '')));
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
