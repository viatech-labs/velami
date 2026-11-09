// Сквозной тест политики организации (chrome.storage.managed). Браузер в тесте не управляется
// MDM, поэтому политику подаём в фоновый процесс той же функцией, которую вызывает событие
// изменения managed-хранилища, и проверяем, что видит пользователь и что уходит сайту.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = process.env.PG_EXT_DIR ? path.resolve(process.env.PG_EXT_DIR) : root;
const files = path.join(root, 'test', 'fixtures', 'files');
const out = path.join(root, 'test', 'artifacts', 'policy');
mkdirSync(out, { recursive: true });

const POLICY = {
  organization: 'Studio Bianchi',
  supportContact: 'it@studio-bianchi.example',
  enabled: true,
  language: 'it',
  dictionary: [{ term: 'Progetto Fenice', type: 'CUSTOM' }, { term: 'Bianchi Holding', type: 'ORG' }],
  allowExclusions: false,
  allowOriginalFiles: false,
  allowUncheckedFiles: false,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, fn) => { fn(); results.push(name); console.log('  ✓ ' + name); };
setTimeout(() => { console.error('Тест не уложился в 3 минуты'); process.exit(2); }, 180000).unref();

const PAGE = `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>ChatGPT (doppione)</title></head><body style="font:15px system-ui;margin:40px">
<div id="prompt-textarea" contenteditable="true" style="border:1px solid #ccc;min-height:40px"></div>
<input type="file" id="file" multiple><div id="drop" style="margin-top:12px;padding:30px;border:2px dashed #aaa">Trascina qui</div>
<script>
window.__got = [];
async function upload(f) {
  window.__got.push(f.name);
  await fetch('https://files.example/upload/' + encodeURIComponent(f.name), { method: 'PUT', body: f });
}
document.getElementById('file').onchange = (e) => { for (const f of e.target.files) upload(f); };
const drop = document.getElementById('drop');
drop.ondragover = (e) => e.preventDefault();
drop.ondrop = (e) => { e.preventDefault(); for (const f of e.dataTransfer.files) upload(f); };
</script></body></html>`;

const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=1280,900'],
  defaultViewport: { width: 1280, height: 900 },
});

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  const sw = await swTarget.worker();
  const setPolicy = (raw) => sw.evaluate((r) => setPolicy(r), raw);
  const admin = await browser.newPage();
  await admin.goto(`chrome-extension://${extId}/dashboard.html#dict`);
  const ext = (msg) => admin.evaluate((m) => chrome.runtime.sendMessage(m), msg);

  await ext({ type: 'setSettings', patch: { language: 'en', dictionary: [{ term: 'Mario Rossi', type: 'PERSON' }], exclusions: ['EMAIL:mario.rossi@example.com'] } });
  const before = await ext({ type: 'state' });
  check('без политики расширение не управляется', () => {
    assert.equal(before.policy.managed, false);
    assert.deepEqual(before.settings.exclusions, ['EMAIL:mario.rossi@example.com']);
  });

  await setPolicy(POLICY);
  await ext({ type: 'setSettings', patch: { enabled: false, language: 'ru', dictionary: [], exclusions: ['EMAIL:x@y.it'] } });
  await ext({ type: 'setExclusion', id: 'EMAIL:z@y.it', excluded: true });
  const s = await ext({ type: 'state' });
  const stored = await admin.evaluate(() => chrome.storage.local.get(['settings', 'policy']));
  check('заданное организацией не меняется из настроек: защита, язык, исключения', () => {
    assert.equal(s.settings.enabled, true);
    assert.equal(s.settings.language, 'it');
    assert.deepEqual(s.settings.exclusions, []);
    assert.equal(stored.settings.enabled, true);
    assert.equal(stored.policy.organization, 'Studio Bianchi');
  });
  check('словарь организации остаётся, даже если пользователь очистил свой', () => {
    assert.deepEqual(s.settings.dictionary.map((d) => [d.term, !!d.managed]), [['Progetto Fenice', true], ['Bianchi Holding', true]]);
  });
  const masked = await ext({ type: 'maskBatch', texts: ['Il Progetto Fenice di Bianchi Holding parte lunedì'], trusted: [true], dryRun: true });
  check('слова организации скрываются в запросе', () => {
    assert.ok(!/Fenice|Bianchi/.test(masked.texts[0]), masked.texts[0]);
    assert.match(masked.texts[0], /\[\[CUSTOM_\d+\]\]/);
    assert.match(masked.texts[0], /\[\[ORG_\d+\]\]/);
  });

  /* Окно расширения и страница словаря. */
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await sleep(500);
  const pop = await popup.evaluate(() => ({
    managed: !document.getElementById('managed').hidden && document.getElementById('managed-text').textContent,
    enabled: document.getElementById('enabled').disabled,
    language: document.getElementById('language').disabled,
    rehydrate: document.getElementById('rehydrate').disabled,
  }));
  await popup.screenshot({ path: path.join(out, 'popup.png') });
  check('popup: «Gestito da Studio Bianchi», защита и язык заблокированы, остальное свободно', () => {
    assert.equal(pop.managed, 'Gestito da Studio Bianchi');
    assert.ok(pop.enabled && pop.language && !pop.rehydrate);
  });
  await popup.close();
  await admin.bringToFront();
  await admin.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await sleep(700);
  const dict = await admin.evaluate(() => ({
    note: document.getElementById('dict-policy').hidden ? '' : document.getElementById('dict-policy').textContent,
    rows: [...document.querySelectorAll('#dict-table tbody tr')].map((tr) => [tr.cells[0].textContent, !!tr.querySelector('button')]),
    excl: document.querySelector('#excl-table tbody').textContent,
  }));
  await admin.screenshot({ path: path.join(out, 'dict.png'), fullPage: true });
  check('словарь: записи организации без кнопки удаления, пояснение про исключения', () => {
    assert.match(dict.note, /2 termini/);
    assert.deepEqual(dict.rows, [['Progetto Fenice', false], ['Bianchi Holding', false]]);
    assert.match(dict.excl, /organizzazione/);
  });

  /* Страница чата. */
  const page = await browser.newPage();
  const uploads = {};
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = req.url();
    if (u === 'https://chatgpt.com/') return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
    if (u.startsWith('https://files.example/upload/')) {
      uploads[decodeURIComponent(u.split('/').pop())] = req.postData() ?? (await req.fetchPostData().catch(() => null)) ?? '';
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
  const findAll = (n, test, acc = []) => { if (test(n)) acc.push(n); for (const c of kids(n)) findAll(c, test, acc); return acc; };
  const attr = (n, name) => { const a = n.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === name) return a[i + 1]; return null; };
  const cls = (n, name) => (attr(n, 'class') || '').split(' ').includes(name);
  const dialog = async () => { const d = find(await tree(), (n) => cls(n, 'ask')); return d && attr(d, 'hidden') === null ? d : null; };
  async function waitDialog() {
    for (let i = 0; i < 80; i++) { const d = await dialog(); if (d) return d; await sleep(150); }
    throw new Error('окно Velami не появилось');
  }
  const buttons = (d) => findAll(d, (n) => n.nodeName === 'BUTTON').map((b) => textOf(b).trim());
  async function press(label) {
    const d = await waitDialog();
    const btn = find(d, (n) => n.nodeName === 'BUTTON' && textOf(n).trim() === label);
    assert.ok(btn, 'нет кнопки ' + label + ': ' + buttons(d).join(' | '));
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: btn.nodeId });
    const [x1, y1, , , x3, y3] = model.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
    await sleep(300);
  }
  const pick = async (name) => { await page.evaluate(() => { document.getElementById('file').value = ''; }); await (await page.$('#file')).uploadFile(path.join(files, name)); };
  const waitUpload = async (name) => { for (let i = 0; i < 60 && uploads[name] === undefined; i++) await sleep(150); return uploads[name]; };

  await pick('estratto.pdf');
  const pdfAsk = await waitDialog();
  const pdfButtons = buttons(pdfAsk);
  const pdfText = textOf(pdfAsk);
  await page.screenshot({ path: path.join(out, 'pdf-no-original.png') });
  await press('Invia copia pulita');
  const copy = await waitUpload('estratto.pdf.txt');
  check('PDF с данными: кнопки «оригинал» нет, есть пояснение, копия уходит с метками', () => {
    assert.deepEqual(pdfButtons, ['Annulla', 'Invia copia pulita']);
    assert.match(pdfText, /solo la copia pulita/);
    assert.ok(copy && copy.includes('[[EMAIL_1]]') && !copy.includes('mario.rossi@example.com'));
    assert.equal(uploads['estratto.pdf'], undefined);
  });

  await pick('scansione.pdf');
  const scanAsk = await waitDialog();
  const scanButtons = buttons(scanAsk);
  const scanText = textOf(scanAsk);
  await page.screenshot({ path: path.join(out, 'scan-blocked.png') });
  await press('OK');
  await sleep(500);
  check('скан: отправить нельзя, только «OK», в окне контакт поддержки, файл не ушёл', () => {
    assert.deepEqual(scanButtons, ['OK']);
    assert.match(scanText, /non permette di inviare file/);
    assert.match(scanText, /it@studio-bianchi\.example/);
    assert.equal(uploads['scansione.pdf'], undefined);
  });

  const png = readFileSync(path.join(root, 'icons', '128.png')).toString('base64');
  await page.evaluate((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'foto.png', { type: 'image/png' }));
    document.getElementById('drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, png);
  const imgAsk = await waitDialog();
  const imgButtons = buttons(imgAsk);
  const imgOption = find(imgAsk, (n) => cls(n, 'ask-opt'));
  await press('OK');
  await sleep(500);
  check('картинка тоже не уходит, галочки «не спрашивать» нет', () => {
    assert.deepEqual(imgButtons, ['OK']);
    assert.ok(attr(imgOption, 'hidden') !== null);
    assert.equal(uploads['foto.png'], undefined);
  });

  await page.click('#prompt-textarea');
  await page.keyboard.type('Scrivi a mario.rossi@example.com del Progetto Fenice');
  let boxes = [];
  for (let i = 0; i < 40 && !boxes.length; i++) {
    await sleep(200);
    boxes = findAll(await tree(), (n) => n.nodeName === 'INPUT' && attr(n, 'type') === 'checkbox' && attr(n, 'title') !== null);
  }
  await page.screenshot({ path: path.join(out, 'panel.png') });
  check('панель: галочки «оставить как есть» заблокированы', () => {
    assert.ok(boxes.length >= 2, 'находок в панели: ' + boxes.length);
    for (const b of boxes) assert.ok(attr(b, 'disabled') !== null, 'галочка не заблокирована');
  });

  /* Политику сняли: возвращается выбор пользователя. */
  await setPolicy({});
  const after = await ext({ type: 'state' });
  check('политику сняли: снова личные язык, словарь и исключения', () => {
    assert.equal(after.policy.managed, false);
    assert.equal(after.settings.language, 'en');
    assert.deepEqual(after.settings.dictionary, []);
    assert.deepEqual(after.settings.exclusions, ['EMAIL:mario.rossi@example.com']);
  });
  await sleep(500);
  await pick('richiesta.docx');
  const docButtons = buttons(await waitDialog());
  await press('Cancel');
  check('без политики кнопка оригинала вернулась', () => assert.deepEqual(docButtons, ['Cancel', 'Send original', 'Send clean copy']));

  console.log(`\nВсе проверки пройдены: ${results.length}`);
} catch (err) {
  console.error('\nПРОВАЛ:', err && err.message ? err.message : err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
