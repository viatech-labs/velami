// Сквозной тест вложений: PDF, Word, Excel, PowerPoint, скан и картинка на двойнике chatgpt.com.
// Проверяем, что ушло на сервер сайта: копия с метками, оригинал по явному выбору или ничего.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = process.env.PG_EXT_DIR ? path.resolve(process.env.PG_EXT_DIR) : root;
const files = path.join(root, 'test', 'fixtures', 'files');
const out = path.join(root, 'test', 'artifacts', 'files');
mkdirSync(out, { recursive: true });

const SECRETS = ['mario.rossi@example.com', '4111 1111 1111 1111', 'IT60 X054 2811 1010 0000 0123 456', 'RSSMRA85T10A562S'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, fn) => { fn(); results.push(name); console.log('  ✓ ' + name); };
setTimeout(() => { console.error('Тест не уложился в 3 минуты'); process.exit(2); }, 180000).unref();

const PAGE = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>ChatGPT (doppione)</title></head><body style="font:15px system-ui;margin:40px">
<div id="prompt-textarea" contenteditable="true" style="border:1px solid #ccc;min-height:40px"></div>
<input type="file" id="file" multiple><div id="drop" style="margin-top:12px;padding:30px;border:2px dashed #aaa">Trascina qui</div>
<script>
window.__got = [];
async function upload(f, via) {
  window.__got.push({ name: f.name, size: f.size, type: f.type, via });
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

  /* Длинный PDF: имя после первых 20 000 символов. Модель читает файл целиком, по частям. */
  await pick('relazione-lunga.pdf');
  const longText = textOf(await waitDialog(400));
  await page.screenshot({ path: path.join(out, 'pdf-long-ask.png') });
  await press('Annulla');
  check('длинный PDF: имя в конце найдено, файл не ушёл как чистый', () => {
    assert.match(longText, /Dati personali in «relazione-lunga\.pdf»/);
    assert.match(longText, /Nome/);
    assert.equal(uploads['relazione-lunga.pdf'], undefined);
  });

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

  /* PowerPoint: копия. */
  await pick('presentazione.pptx');
  await press('Invia copia pulita');
  const pptx = await waitUpload('presentazione.pptx.txt');
  check('PowerPoint: копия с метками, адрес из двух фрагментов текста тоже скрыт', () => {
    assert.ok(pptx && !pptx.includes('mario.rossi@example.com') && pptx.includes('[[EMAIL_1]]'), pptx);
    assert.ok(!pptx.includes('Mario Rossi'));
  });

  /* Скан без текста: только «как есть» или отмена. */
  await pick('scansione.pdf');
  const scanText = textOf(await waitDialog());
  await page.screenshot({ path: path.join(out, 'scan-ask.png') });
  await press('Annulla');
  check('PDF-скан: Velami честно говорит, что не может проверить, и по отмене файл не уходит', () => {
    assert.match(scanText, /non può controllare «scansione\.pdf»/);
    assert.match(scanText, /scansione/);
    assert.equal(uploads['scansione.pdf'], undefined);
  });

  /* PDF с паролем: прочитать нельзя, спрашиваем. */
  await pick('protetto.pdf');
  const lockedText = textOf(await waitDialog());
  await press('Annulla');
  check('PDF с паролем: окно «protetto da password», по отмене не уходит', () => {
    assert.match(lockedText, /protetto da password/);
    assert.equal(uploads['protetto.pdf'], undefined);
  });

  /* Картинка перетаскиванием: спрашивает один раз, потом по галочке не спрашивает. */
  const png = readFileSync(path.join(root, 'icons', '128.png'));
  await dropFile('screenshot.png', 'image/png', png);
  const imgText = textOf(await waitDialog());
  await tick();
  await press('Invia così com’è');
  await waitUpload('screenshot.png');
  await sleep(600);
  await dropFile('foto.png', 'image/png', png);
  const second = await waitUpload('foto.png');
  check('картинка: спросили один раз, после «Non chiedere più» уходит без окна', () => {
    assert.match(imgText, /immagine/);
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
    assert.ok(log.some((e) => e.kind === 'unchecked' && e.file === 'screenshot.png'));
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
}
