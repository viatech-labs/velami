// Сквозной тест обновления расширения при открытой вкладке чата.
// Chrome обновляет расширение молча: старый скрипт во вкладке остаётся без связи с расширением,
// шлюз ничего не пропускает. Проверяем, что человек видит понятное сообщение и кнопку, что сайту
// в это время ничего не уходит, что всплывающее окно подсказывает перезагрузить вкладку и
// показывает, что нового в версии.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PACKAGE_ROOTS } from '../scripts/package-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = process.env.PG_EXT_DIR ? path.resolve(process.env.PG_EXT_DIR) : root;
const out = path.join(root, 'test', 'artifacts', 'update');
mkdirSync(out, { recursive: true });
const I18N = (await import(path.join(srcDir, 'src', 'i18n.js'))).default;

/* Копия расширения, в которой можно менять номер версии. Модель и библиотеки для файлов здесь не
   нужны: без модели расширение работает на правилах. */
const extDir = mkdtempSync(path.join(tmpdir(), 'velami-update-'));
for (const f of PACKAGE_ROOTS) {
  if (f === 'models' || f === 'vendor' || !existsSync(path.join(srcDir, f))) continue;
  cpSync(path.join(srcDir, f), path.join(extDir, f), { recursive: true });
}
const manifest = JSON.parse(readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
const VERSION = manifest.version;
const OLD = '0.0.1';
const setVersion = (v) => writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify({ ...manifest, version: v }, null, 2));
setVersion(OLD);

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ChatGPT (test twin)</title></head><body>
<div id="prompt-textarea" contenteditable="true" style="min-height:60px;border:1px solid #ccc"></div>
<button data-testid="send-button" id="send">Send</button><div id="out"></div>
<script>
document.getElementById('send').onclick = async () => {
  const ed = document.getElementById('prompt-textarea');
  const text = ed.innerText; ed.textContent = '';
  try {
    const r = await fetch('/backend-api/f/conversation', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'next', messages: [{ id: 'm-1', author: { role: 'user' }, content: { content_type: 'text', parts: [text] } }] }) });
    document.getElementById('out').textContent = 'ok ' + await r.text();
  } catch (e) { document.getElementById('out').textContent = 'ERR ' + e.message; }
};
</script></body></html>`;
const EMAIL = 'mario.rossi@example.com';
const MESSAGE = `Write to ${EMAIL} about the invoice.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, fn) => { fn(); results.push(name); console.log('  ✓ ' + name); };
setTimeout(() => { console.error('Тест не уложился в 2 минуты'); process.exit(2); }, 120000).unref();

/* Расширение ставим через DevTools, а не ключом --load-extension: повторная установка той же папки
   работает как обновление из магазина, а после chrome.runtime.reload() распакованное расширение
   в Chrome без окна обратно не поднимается. */
const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  enableExtensions: true,
  args: ['--window-size=1280,900', '--lang=en-US'],
  defaultViewport: { width: 1280, height: 900 },
});

try {
  const extId = await browser.installExtension(extDir);
  console.log('Расширение загружено:', extId, 'версия', OLD);

  /* Страница расширения: через неё тест говорит с фоновым процессом. После обновления расширения
     Chrome закрывает его страницы, поэтому каждый раз открываем новую. */
  const extPage = async (file = 'dashboard.html#log') => {
    const p = await browser.newPage();
    await p.goto(`chrome-extension://${extId}/${file}`);
    return p;
  };
  const ext = async (fn, arg) => { const p = await extPage(); try { return await p.evaluate(fn, arg); } finally { await p.close().catch(() => {}); } };
  const ready = async () => {
    for (let i = 0; i < 30; i++) {
      const ok = await ext(() => chrome.runtime.sendMessage({ type: 'state' }).then((s) => !!s && !!s.settings)).catch(() => false);
      if (ok) return;
      await sleep(300);
    }
    throw new Error('расширение не отвечает');
  };
  /* То, что делает Chrome при обновлении: ставит расширение заново поверх прежнего. */
  const reloadExtension = async () => {
    assert.equal(await browser.installExtension(extDir), extId);
    await sleep(500);
    await ready();
  };
  const popupAt = async (tabId) => {
    const p = await browser.newPage();
    await p.setViewport({ width: 340, height: 520 });
    await p.goto(`chrome-extension://${extId}/popup.html${tabId ? '?tab=' + tabId : ''}`);
    await p.waitForFunction(() => document.getElementById('version').textContent !== '', { timeout: 5000 });
    await sleep(500);
    return p;
  };
  const shown = (p, id) => p.$eval('#' + id, (n) => getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0);

  await ready();
  for (const p of await browser.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();
  await ext(() => chrome.runtime.sendMessage({ type: 'setSettings', patch: { language: 'en' } }));

  let popup = await popupAt();
  const first = { managed: await shown(popup, 'managed'), stale: await shown(popup, 'stale'), updated: await shown(popup, 'updated'), text: await popup.evaluate(() => document.body.innerText) };
  await popup.screenshot({ path: path.join(out, '1-popup-plain.png') });
  await popup.close();
  check('всплывающее окно без политики: строки «Managed by» нет, заметок об обновлении и вкладке нет', () => {
    assert.equal(first.managed, false, 'строка политики видна без политики');
    assert.ok(!/Managed by/.test(first.text), first.text);
    assert.equal(first.stale, false);
    assert.equal(first.updated, false);
  });

  /* Вкладка чата. */
  const page = await browser.newPage();
  const sent = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url === 'https://chatgpt.com/') return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGE });
    if (url === 'https://chatgpt.com/backend-api/f/conversation') { sent.push(req.postData()); return req.respond({ status: 200, contentType: 'text/plain', body: 'model answer' }); }
    return req.abort();
  });
  /* Видимый текст панели Velami: закрытый Shadow DOM читаем через DevTools, скрытые блоки пропускаем. */
  const panel = async () => {
    const cdp = await page.createCDPSession();
    const { root: d } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const acc = [];
    (function walk(n, mine) {
      const attrs = n.attributes || [];
      if (n.nodeName === 'STYLE' || attrs.includes('hidden')) return;
      const inside = mine || attrs.includes('data-pg-gateway');
      if (n.nodeType === 3 && inside && n.nodeValue.trim()) acc.push(n.nodeValue.trim());
      for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c, inside);
    })(d, false);
    await cdp.detach();
    return acc.join(' | ');
  };
  const waitPanel = async (re, ms = 8000) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms;) { const t = await panel(); if (re.test(t)) return t; await sleep(250); }
    return panel();
  };
  const openChat = async () => {
    await page.goto('https://chatgpt.com/', { waitUntil: 'load' });
    await page.waitForSelector('[data-pg-gateway]', { timeout: 5000 });
    await sleep(700);
  };
  const typeMessage = async () => { await page.click('#prompt-textarea'); await page.keyboard.type(MESSAGE, { delay: 2 }); };
  const send = async () => { sent.length = 0; await page.click('#send'); await page.waitForFunction(() => document.getElementById('out').textContent !== '', { timeout: 15000 }); return page.$eval('#out', (n) => n.textContent); };
  const tabId = () => ext(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }).then((t) => t[0] && t[0].id));

  await openChat();
  await typeMessage();
  const before = await waitPanel(/\[\[EMAIL_1\]\]/);
  const id = await tabId();
  popup = await popupAt(id);
  const liveStale = await shown(popup, 'stale');
  await popup.close();
  check('вкладка, где Velami работает: панель показывает метку, окно не просит перезагрузку', () => {
    assert.ok(before.includes('[[EMAIL_1]]'), before);
    assert.ok(Number.isInteger(id));
    assert.equal(liveStale, false);
  });

  /* Расширение поставили заново, версия та же: вкладка осталась со старым скриптом. */
  await reloadExtension();
  const lostText = await waitPanel(new RegExp(I18N.MESSAGES.en['action.reload']), 6000);
  await page.screenshot({ path: path.join(out, '2-page-lost.png') });
  check('после переустановки расширения страница сама говорит, что случилось, и даёт кнопку', () => {
    assert.ok(lostText.includes(I18N.MESSAGES.en['status.lost']), lostText);
    assert.ok(lostText.includes(I18N.MESSAGES.en['action.reload']), lostText);
    assert.ok(lostText.includes(I18N.MESSAGES.en['pill.reload']), lostText);
    assert.ok(!/invalidated|forbidden/i.test(lostText), lostText);
  });

  const siteError = await send();
  const afterSend = await panel();
  check('без связи с расширением сайту ничего не уходит, текст ошибки понятный', () => {
    assert.deepEqual(sent, [], 'сообщение ушло без проверки');
    assert.match(siteError, /^ERR /);
    assert.ok(siteError.includes('updated or restarted'), siteError);
    assert.ok(!/invalidated/i.test(siteError + afterSend), siteError + ' / ' + afterSend);
    assert.ok(afterSend.includes(I18N.MESSAGES.en['status.lost']), afterSend);
  });

  popup = await popupAt(id);
  const stale = { shown: await shown(popup, 'stale'), text: await popup.$eval('#stale', (n) => n.innerText), updated: await shown(popup, 'updated') };
  await popup.screenshot({ path: path.join(out, '3-popup-stale.png') });
  check('всплывающее окно: вкладку нужно перезагрузить, а версия не менялась и заметки о ней нет', () => {
    assert.equal(stale.shown, true);
    assert.ok(stale.text.includes(I18N.MESSAGES.en['popup.stale']) && stale.text.includes(I18N.MESSAGES.en['popup.staleBtn']), stale.text);
    assert.equal(stale.updated, false);
  });

  const reloaded = page.waitForNavigation({ waitUntil: 'load', timeout: 10000 });
  await popup.click('#stale-reload').catch(() => {});
  await reloaded;
  await popup.close().catch(() => {});
  await page.waitForSelector('[data-pg-gateway]', { timeout: 5000 });
  await sleep(700);
  await typeMessage();
  await waitPanel(/\[\[EMAIL_1\]\]/);
  const answer = await send();
  popup = await popupAt(id);
  const againStale = await shown(popup, 'stale');
  await popup.close();
  check('кнопка в окне перезагружает вкладку, после этого сообщение уходит с меткой', () => {
    assert.equal(answer, 'ok model answer');
    assert.equal(sent.length, 1);
    assert.ok(sent[0].includes('[[EMAIL_1]]') && !sent[0].includes(EMAIL), sent[0]);
    assert.equal(againStale, false);
  });

  /* Кнопка на самой странице. */
  await reloadExtension();
  await waitPanel(new RegExp(I18N.MESSAGES.en['action.reload']), 6000);
  const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 10000 });
  const { root: doc } = await (await page.createCDPSession()).send('DOM.getDocument', { depth: -1, pierce: true });
  let buttonId = 0;
  (function find(n) { if ((n.attributes || []).includes('status-act')) buttonId = n.backendNodeId; for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) find(c); })(doc);
  const cdp = await page.createCDPSession();
  const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: buttonId });
  await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { this.click(); }' });
  await nav;
  await page.waitForSelector('[data-pg-gateway]', { timeout: 5000 });
  await sleep(700);
  await typeMessage();
  const fresh = await waitPanel(/\[\[EMAIL_1\]\]/);
  check('кнопка на странице перезагружает её, Velami снова работает', () => {
    assert.ok(fresh.includes('[[EMAIL_1]]') && !fresh.includes(I18N.MESSAGES.en['status.lost']), fresh);
  });

  /* Настоящее обновление: номер версии в манифесте сменился. */
  setVersion(VERSION);
  await reloadExtension();
  popup = await popupAt();
  const note = { shown: await shown(popup, 'updated'), text: await popup.$eval('#updated', (n) => n.innerText), version: await popup.$eval('#version', (n) => n.textContent) };
  await popup.screenshot({ path: path.join(out, '4-popup-updated.png') });
  check(`после обновления с ${OLD} до ${VERSION} окно говорит, что нового`, () => {
    assert.equal(note.shown, true);
    assert.ok(note.version.includes(VERSION), note.version);
    assert.ok(note.text.includes(I18N.MESSAGES.en['popup.updated'].replace('{v}', VERSION)), note.text);
    assert.ok(note.text.includes(I18N.MESSAGES.en['whatsnew.' + VERSION]), note.text);
  });
  await popup.click('#updated-ok');
  await sleep(500);
  const hiddenNow = !(await shown(popup, 'updated'));
  await popup.close();
  popup = await popupAt();
  const hiddenLater = !(await shown(popup, 'updated'));
  await popup.close();
  const stored = await ext(() => chrome.storage.local.get('updated'));
  check('«Got it» убирает заметку насовсем', () => {
    assert.equal(hiddenNow, true);
    assert.equal(hiddenLater, true);
    assert.deepEqual(stored, {});
  });

  /* Части от разных версий: фоновый процесс не знает сообщение, которое шлёт страница. Так бывает,
     когда распакованную папку заменили, а расширение на chrome://extensions не перезагрузили. */
  const bg = path.join(extDir, 'src', 'background.js');
  const code = readFileSync(bg, 'utf8');
  assert.ok(code.includes("new Set(['maskBatch', "), 'список сообщений страницы в background.js изменился, поправьте тест');
  writeFileSync(bg, code.replace("new Set(['maskBatch', ", "new Set(["));
  await reloadExtension();
  await openChat();
  await typeMessage();
  await sleep(1200);
  const mixedError = await send();
  const mixed = await waitPanel(/chrome:\/\/extensions/);
  await page.screenshot({ path: path.join(out, '5-page-mismatch.png') });
  check('части расширения от разных версий: ничего не уходит, панель объясняет, что сделать', () => {
    assert.deepEqual(sent, []);
    assert.match(mixedError, /^ERR /);
    assert.ok(mixed.includes(I18N.MESSAGES.en['status.mismatch']), mixed);
    assert.ok(!/\(forbidden\)/.test(mixed), mixed);
  });

  console.log(`\nПройдено проверок: ${results.length}. Скриншоты: ${out}`);
} finally {
  await browser.close();
  rmSync(extDir, { recursive: true, force: true });
}
