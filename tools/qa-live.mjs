// Живой прогон на настоящих сайтах из QA-профиля (tools/qa-login.mjs): текст с данными, длинный PDF
// с именем в конце, Word с данными. Только выдуманные значения из test/fixtures.
// Запуск: node tools/qa-live.mjs [chatgpt claude ...] [--cases text,pdf,docx]
// Итог: test/artifacts/live/report.json и скриншоты по каждому случаю.
import puppeteer from 'puppeteer';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { listFiles } from '../scripts/package-lib.mjs';

const require = createRequire(import.meta.url);
const Sites = require('../src/sites.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'test', 'artifacts', 'live');
const files = path.join(root, 'test', 'fixtures', 'files');
mkdirSync(out, { recursive: true });

const QA_PROFILE = path.join(os.homedir(), 'Library', 'Application Support', 'velami-qa-chrome');
const DEFAULT_SITES = ['chatgpt', 'claude', 'gemini', 'perplexity', 'mistral', 'deepseek'];
const START = { claude: 'https://claude.ai/new' };
const argOf = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--cases');
const sites = positional.length ? positional : DEFAULT_SITES;
const cases = (argOf('--cases') || 'text,pdf,docx').split(',');

const CASES = {
  text: {
    message: 'Sono Mario Rossi, email mario.rossi@example.com, carta 4111 1111 1111 1111, IBAN IT60 X054 2811 1010 0000 0123 456. Scrivi una breve mail alla banca con questi dati.',
    secrets: ['Mario Rossi', 'mario.rossi@example.com', '4111 1111 1111 1111', 'IT60 X054 2811 1010 0000 0123 456'],
    shown: ['Mario Rossi'],
  },
  pdf: {
    file: 'relazione-lunga.pdf',
    message: 'Chi firma il documento allegato? Rispondi con il nome completo.',
    secrets: ['Luca Bianchi'],
    shown: ['Luca Bianchi'],
  },
  docx: {
    file: 'richiesta.docx',
    message: 'Riassumi il documento allegato in due righe, con il nome del cliente.',
    secrets: ['Mario Rossi', 'mario.rossi@example.com', 'IT60 X054 2811 1010 0000 0123 456'],
    shown: ['Mario Rossi'],
  },
};
const CLEAN = /^(Invia copia pulita|Send clean copy|Отправить чистую копию)$/;
const TOKEN = /\[\[[A-Z_]+_\d+\]\]/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Копия расширения, где необязательные сайты уже разрешены: окно разрешения Chrome
   в автоматическом браузере не нажать. Путь постоянный, чтобы id и настройки не менялись. */
const extDir = path.join(os.tmpdir(), 'velami-live-ext');
rmSync(extDir, { recursive: true, force: true });
for (const f of listFiles(root)) cpSync(path.join(root, f), path.join(extDir, f));
const manifest = JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...manifest.host_permissions, ...manifest.optional_host_permissions];
writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const browser = await puppeteer.launch({
  headless: false,
  userDataDir: QA_PROFILE,
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=1280,900', '--lang=it-IT'],
  defaultViewport: { width: 1280, height: 900 },
});
const report = [];
try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const admin = await browser.newPage();
  await admin.goto(`chrome-extension://${extId}/dashboard.html#log`);
  const ext = (msg) => admin.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  await ext({ type: 'setSettings', patch: { sites: Object.fromEntries(Sites.SITES.filter((s) => s.optional).map((s) => [s.id, sites.includes(s.id)])) } });

  for (const site of sites) {
    for (const name of cases) {
      const r = await runCase(site, name, CASES[name]).catch((e) => ({ error: String(e && e.message || e).slice(0, 300) }));
      const row = { site, case: name, ...r };
      report.push(row);
      console.log(JSON.stringify(row));
      writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    }
  }

  async function runCase(site, name, c) {
    const meta = Sites.SITES.find((s) => s.id === site);
    const since = Date.now();
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('DOM.enable');
    const bodies = [];
    cdp.on('Network.requestWillBeSent', (e) => { if (e.request.postData) bodies.push({ url: e.request.url, body: e.request.postData }); });
    const shot = (step) => page.screenshot({ path: path.join(out, `${site}-${name}-${step}.png`) }).catch(() => {});
    try {
      await page.goto(START[site] || meta.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(4000);
      for (let i = 0; i < 3; i++) {
        const closed = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => /^(Rifiuta|Reject|Only necessary|Solo necessari|Только обязательные|Пропустить|Skip|Salta|Может быть, позже|Maybe later|Forse più tardi|Не сейчас|Not now)/i.test(x.textContent.trim()));
          if (b) b.click();
          return !!b;
        }).catch(() => false);
        if (!closed) break;
        await sleep(1000);
      }
      await page.keyboard.press('Escape');
      const composer = await page.waitForFunction(() => [...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')]
        .find((n) => n.getBoundingClientRect().height > 0 && n.getBoundingClientRect().width > 200) || null, { timeout: 30000 }).then((h) => h.asElement()).catch(() => null);
      if (!composer) { await shot('0-nocomposer'); return { error: 'нет поля ввода: ' + await page.title() }; }
      const box = await composer.boundingBox();
      await page.mouse.click(box.x + 20, box.y + box.height / 2);

      let dialogText = null;
      if (c.file) {
        const input = await page.$('input[type=file]');
        if (input) await input.uploadFile(path.join(files, c.file));
        else {
          /* Поле файла появляется после кнопки «прикрепить» и пункта меню: ждём окно выбора файла. */
          const chooser = page.waitForFileChooser({ timeout: 8000 });
          const ATTACH = /attach|allega|прикреп|upload|carica|загруз|add files|aggiungi file|добавить файл/i;
          const clickFirst = () => page.evaluate((src) => {
            const re = new RegExp(src, 'i');
            const b = [...document.querySelectorAll('button, [role=menuitem]')].find((x) => x.getBoundingClientRect().height > 0 && re.test((x.getAttribute('aria-label') || '') + ' ' + x.textContent));
            if (b) b.click();
            return !!b;
          }, ATTACH.source);
          if (!(await clickFirst())) { await shot('0-noinput'); return { error: 'нет поля файла и кнопки «прикрепить»' }; }
          await sleep(800);
          await clickFirst();
          const fc = await chooser.catch(() => null);
          if (!fc) { await shot('0-noinput'); return { error: 'окно выбора файла не открылось' }; }
          await fc.accept([path.join(files, c.file)]);
        }
        const d = await waitDialog(cdp, 120000);
        if (!d) { await shot('1-nodialog'); return { error: 'окно Velami не появилось', panel: await panelText(cdp) }; }
        dialogText = textOf(d).replace(/\s+/g, ' ').trim().slice(0, 300);
        await shot('1-dialog');
        const btn = find(d, (n) => n.nodeName === 'BUTTON' && CLEAN.test(textOf(n).trim()));
        if (!btn) return { error: 'нет кнопки чистой копии', dialog: dialogText };
        const { model } = await cdp.send('DOM.getBoxModel', { nodeId: btn.nodeId });
        await page.mouse.click((model.content[0] + model.content[4]) / 2, (model.content[1] + model.content[5]) / 2);
        await sleep(12000);
        await page.mouse.click(box.x + 20, box.y + box.height / 2);
      }
      await page.keyboard.type(c.message, { delay: 4 });
      await sleep(1500);
      await shot('2-typed');
      await page.keyboard.press('Enter');
      await sleep(45000);
      await shot('3-answer');
      const pageText = await page.evaluate(() => document.body.innerText);
      writeFileSync(path.join(out, `${site}-${name}-page.txt`), pageText);
      const log = (await ext({ type: 'getLog' })).filter((e) => e.at >= since);
      const decoded = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
      const leaked = bodies.filter((b) => c.secrets.some((v) => b.body.includes(v) || decoded(b.body).includes(v))).map((b) => b.url);
      return {
        ok: !leaked.length && !log.some((e) => e.kind === 'coverage' || e.kind === 'leak') && c.shown.every((v) => pageText.includes(v)) && !TOKEN.test(pageText),
        leaked,
        labelsSent: bodies.some((b) => TOKEN.test(decoded(b.body))),
        log: log.map((e) => `${e.kind}${e.file ? ' ' + e.file : ''}${e.summary ? ' n=' + e.summary.count : ''}`),
        answerHasReal: c.shown.filter((v) => pageText.includes(v)),
        labelsOnPage: TOKEN.test(pageText),
        dialog: dialogText,
      };
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
}
const okCount = report.filter((r) => r.ok).length;
console.log(`\nИтог: ${okCount} из ${report.length} без замечаний. Отчёт: ${path.join(out, 'report.json')}`);

function kids(n) { return [...(n.children || []), ...(n.shadowRoots || []), ...(n.contentDocument ? [n.contentDocument] : [])]; }
function textOf(n) { return n.nodeType === 3 ? n.nodeValue : n.nodeName === 'STYLE' ? '' : kids(n).map(textOf).join(' '); }
function find(n, test) { if (test(n)) return n; for (const c of kids(n)) { const r = find(c, test); if (r) return r; } return null; }
function attr(n, name) { const a = n.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === name) return a[i + 1]; return null; }
async function tree(cdp) { return (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })).root; }
async function waitDialog(cdp, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(300)) {
    const d = find(await tree(cdp), (n) => String(attr(n, 'class') || '').split(' ').includes('ask') && attr(n, 'hidden') === null);
    if (d) return d;
  }
  return null;
}
async function panelText(cdp) {
  const host = find(await tree(cdp), (n) => attr(n, 'data-pg-gateway') !== null);
  return host ? textOf(host).replace(/\s+/g, ' ').slice(0, 400) : 'нет панели';
}
