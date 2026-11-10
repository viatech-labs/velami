// Разведка на настоящем сайте: Chrome с расширением отправляет сообщение с выдуманными данными
// и записывает весь исходящий трафик. Использовать только тестовые значения.
// Запуск: node test/probe-real.mjs [chatgpt|claude] [--headful] [--profile] [--file <путь>] [--text <сообщение>]
// --profile: профиль с тестовыми аккаунтами из tools/qa-login.mjs (окно всегда видимое).
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = process.env.PG_EXT_DIR ? path.resolve(process.env.PG_EXT_DIR) : root;
const out = path.join(root, 'test', 'artifacts', 'probe');
mkdirSync(out, { recursive: true });

const site = process.argv[2] || 'chatgpt';
const headful = process.argv.includes('--headful');
const noExt = process.argv.includes('--no-ext');
const useProfile = process.argv.includes('--profile');
const argOf = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const attach = argOf('--file');
const slow = process.argv.includes('--slow');
const QA_PROFILE = path.join(os.homedir(), 'Library', 'Application Support', 'velami-qa-chrome');
const URLS = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/new' };
const FAKE = ['maria.petrova@example.com', '4111 1111 1111 1111', 'IT60 X054 2811 1010 0000 0123 456', 'Анна Сергеевна Миронова', 'Невский проспект, 28'];
const MESSAGE = argOf('--text') || `Повтори дословно, ничего не меняя: меня зовут ${FAKE[3]}, живу по адресу Санкт-Петербург, ${FAKE[4]}, кв. 5. Почта ${FAKE[0]}, карта ${FAKE[1]}, IBAN ${FAKE[2]}.`;
const TOKEN = /\[\[(EMAIL|CARD|IBAN|PERSON|ADDRESS)_\d+\]\]/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

setTimeout(() => { console.error('Разведка не уложилась в 3 минуты'); process.exit(2); }, 180000).unref();

const browser = await puppeteer.launch({
  headless: !(headful || useProfile),
  ...(useProfile ? { userDataDir: QA_PROFILE, ignoreDefaultArgs: ['--enable-automation'] } : {}),
  args: [...(useProfile ? ['--disable-blink-features=AutomationControlled'] : []), ...(noExt ? [] : [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`]), '--window-size=1280,900', '--lang=ru-RU'],
  defaultViewport: { width: 1280, height: 900 },
});
const traffic = [];
let tEnter = 0;
try {
  const sw = noExt ? null : await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
  const extId = sw ? new URL(sw.url()).host : null;

  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (e) => {
    if (e.request.method === 'GET' || e.request.method === 'OPTIONS') return;
    traffic.push({ t: tEnter ? +((Date.now() - tEnter) / 1000).toFixed(1) : null, kind: 'http', method: e.request.method, url: e.request.url, initiator: e.initiator && e.initiator.type, body: (e.request.postData || '').slice(0, 4000) });
  });
  cdp.on('Network.webSocketCreated', (e) => traffic.push({ kind: 'ws-open', url: e.url }));
  cdp.on('Network.webSocketFrameSent', (e) => traffic.push({ kind: 'ws-send', body: String(e.response.payloadData).slice(0, 4000) }));
  browser.on('targetcreated', (t) => { if (/worker/.test(t.type())) traffic.push({ kind: 'worker', type: t.type(), url: t.url() }); });

  await page.goto(URLS[site], { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Сайт может перезагрузить страницу после проверки Cloudflare: ждём, пока поле ввода
  // переживёт паузу без навигации.
  for (let i = 0; i < 6; i++) {
    await sleep(3000);
    try {
      if (await page.evaluate(() => !!document.querySelector('#prompt-textarea, [contenteditable="true"]'))) break;
    } catch { /* страница перезагружается */ }
  }
  await page.screenshot({ path: path.join(out, `${site}-0-loaded.png`) });

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /только обязательные|Reject|Rifiuta|necessary/i.test(x.textContent));
    if (b) b.click();
  }).catch(() => {});
  await sleep(800);
  const composerInfo = await page.evaluate(() => [...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')]
    .map((n) => ({ tag: n.tagName, id: n.id, cls: String(n.className).slice(0, 80), ce: n.getAttribute('contenteditable'), visible: n.getBoundingClientRect().height > 0 })));
  console.log('Кандидаты в поле ввода:', JSON.stringify(composerInfo));
  const composerSel = 'textarea:not([style*="display: none"]), [contenteditable="true"], [contenteditable="plaintext-only"]';
  const composer = await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].find((n) => n.getBoundingClientRect().height > 0) || null, { timeout: 20000 }, composerSel)
    .then((h) => h.asElement()).catch(() => null);
  if (!composer) {
    console.log('Поле ввода не найдено. Заголовок страницы:', await page.title());
    writeFileSync(path.join(out, `${site}-traffic.json`), JSON.stringify(traffic, null, 2));
    process.exit(3);
  }
  const t0 = Date.now();
  const step = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
  page.on('console', (m) => { if (m.type() === 'error' || /шлюз/i.test(m.text())) step('console: ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => step('pageerror: ' + String(e).slice(0, 200)));
  await page.bringToFront();
  await sleep(500);
  const box = await composer.boundingBox();
  if (box) await page.mouse.click(box.x + 20, box.y + box.height / 2); else await composer.focus();
  step('клик по полю');
  if (attach) {
    const input = await page.$('input[type=file]');
    if (!input) step('нет input[type=file]');
    else {
      if (slow) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 200, downloadThroughput: 200000, uploadThroughput: 4000 });
      await input.uploadFile(path.resolve(attach)); step('файл выбран: ' + path.basename(attach));
    }
    await sleep(slow ? 800 : 6000);
    await page.screenshot({ path: path.join(out, `${site}-0b-file.png`) });
    await composer.click().catch(() => {});
  }
  await page.keyboard.type(MESSAGE, { delay: 5 });
  step('текст набран');
  await sleep(1200);
  await page.screenshot({ path: path.join(out, `${site}-1-typed.png`) });
  step('скриншот 1');
  tEnter = Date.now();
  await page.keyboard.press('Enter');
  step('Enter');
  await sleep(8000);
  await page.screenshot({ path: path.join(out, `${site}-1b-after8s.png`) });
  if (slow) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(25000);
  await page.screenshot({ path: path.join(out, `${site}-2-answer.png`) });
  step('скриншот 2');

  let clipboard = null;
  await browser.defaultBrowserContext().overridePermissions(new URL(URLS[site]).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const copyBtns = await page.$$('[data-testid="copy-turn-action-button"], button[aria-label*="Копировать" i], button[aria-label*="Copy" i]');
  if (copyBtns.length) {
    const b = await copyBtns[copyBtns.length - 1].boundingBox();
    if (b) {
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(1500);
      clipboard = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'ошибка: ' + e.message);
    }
  }
  step(`кнопок «Копировать»: ${copyBtns.length}`);

  const pageText = await page.evaluate(() => document.body.innerText);
  let log = [];
  if (extId) {
    const admin = await browser.newPage();
    await admin.goto(`chrome-extension://${extId}/dashboard.html#log`);
    log = await admin.evaluate(() => chrome.runtime.sendMessage({ type: 'getLog' }));
  }

  const decode = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
  for (const t of traffic) if (t.body) t.decoded = decode(t.body);
  const leaked = traffic.filter((t) => t.body && FAKE.some((v) => t.body.includes(v) || t.decoded.includes(v)));
  const withTokens = traffic.filter((t) => t.body && TOKEN.test(t.decoded));
  writeFileSync(path.join(out, `${site}-traffic.json`), JSON.stringify(traffic, null, 2));
  writeFileSync(path.join(out, `${site}-log.json`), JSON.stringify(log, null, 2));
  writeFileSync(path.join(out, `${site}-page.txt`), pageText);

  console.log(`Запросов с телом: ${traffic.filter((t) => t.kind === 'http').length}, WebSocket: ${traffic.filter((t) => t.kind === 'ws-open').length}, воркеров: ${traffic.filter((t) => t.kind === 'worker').length}`);
  console.log('С метками:', withTokens.map((t) => `${t.method || t.kind} ${t.url || ''}`));
  console.log('С НАСТОЯЩИМИ значениями:', leaked.map((t) => `${t.method || t.kind} ${t.url || ''}`));
  console.log('Запросы после Enter:', traffic.filter((t) => t.kind === 'http' && t.t != null && t.t < 30).map((t) => `${t.t}s ${t.method} ${new URL(t.url).pathname}`));
  console.log('Журнал шлюза:', log.map((e) => `${e.kind} ${e.host}${e.path || ''}`));
  console.log('Ответ содержит настоящие значения:', FAKE.map((v) => `${v}: ${pageText.includes(v)}`));
  console.log('Метки видны на странице:', TOKEN.test(pageText));
  console.log('В буфере после «Копировать»:', clipboard);
  console.log('Буфер: настоящие значения', clipboard ? FAKE.map((v) => `${v}: ${clipboard.includes(v)}`) : '-', 'метки:', clipboard ? TOKEN.test(clipboard) : '-');
} finally {
  await browser.close();
}
