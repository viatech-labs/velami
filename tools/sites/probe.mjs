// Снимает, как сайт ИИ отправляет сообщение: открывает страницу без расширения и без входа,
// набирает фразу с выдуманными данными, отправляет и записывает запросы, где эта фраза ушла.
// node tools/sites/probe.mjs [site ...] -> dist/probe/<site>.json и <site>.png
// С --ext то же самое с установленным Velami: в сеть должны уйти метки, а не данные
// (dist/probe/<site>-ext.json, журнал расширения в отчёте).
import puppeteer from 'puppeteer';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'dist', 'probe');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITES = {
  gemini: 'https://gemini.google.com/app',
  copilot: 'https://copilot.microsoft.com/',
  perplexity: 'https://www.perplexity.ai/',
  deepseek: 'https://chat.deepseek.com/',
  mistral: 'https://chat.mistral.ai/chat',
  grok: 'https://grok.com/',
};
const MARK = 'zebra quartz 4111 1111 1111 1111 mario.rossi@example.com';
const EDITABLE = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';

const args = process.argv.slice(2);
const withExt = args.includes('--ext');
const pick = args.filter((a) => !a.startsWith('--'));
const Proto = createRequire(import.meta.url)('../../src/proto.js');
const SECRETS = ['4111 1111 1111 1111', '4111111111111111', 'mario.rossi@example.com'];
/* Тело как текст: форма раскодирована, protobuf в полях ___data__ прочитан. */
function readable(body) {
  let text = body;
  try { text = decodeURIComponent(body.replace(/\+/g, ' ')); } catch { /* не форма */ }
  try {
    for (const [k, v] of new URLSearchParams(body)) if (/___data__$/.test(k)) text += '\n' + Proto.readable(v);
  } catch { /* не форма */ }
  return text;
}
const AGREE = /^(accept all|accept|agree|i agree|got it|continue|accept and continue|принять все|принять|согласен|продолжить|принять и продолжить|разрешить все|consenti|accetta tutto)$/i;
async function dismiss(page) {
  for (let i = 0; i < 3; i++) {
    const clicked = await page.evaluate((src) => {
      const re = new RegExp(src, 'i');
      const b = [...document.querySelectorAll('button, [role="button"]')].find((n) => re.test((n.innerText || '').trim()) && n.offsetParent);
      if (b) { b.click(); return (b.innerText || '').trim(); }
      return null;
    }, AGREE.source);
    if (!clicked) return;
    await sleep(1200);
  }
}
const browser = await puppeteer.launch({
  headless: true,
  args: ['--lang=en-US', '--window-size=1280,900', '--disable-blink-features=AutomationControlled',
    ...(withExt ? [`--disable-extensions-except=${root}`, `--load-extension=${root}`] : [])],
  defaultViewport: { width: 1280, height: 900 },
});
let ext = null;
if (withExt) {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
  const admin = await browser.newPage();
  await admin.goto(`chrome-extension://${new URL(sw.url()).host}/dashboard.html#log`);
  ext = (msg) => admin.evaluate((m) => chrome.runtime.sendMessage(m), msg);
}
try {
  for (const [name, url] of Object.entries(SITES)) {
    if (pick.length && !pick.includes(name)) continue;
    const page = await browser.newPage();
    await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
    const hits = [];
    const posts = [];
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', (e) => {
      const r = e.request;
      const body = r.postData || '';
      if (r.method === 'GET' || r.method === 'OPTIONS') return;
      let decoded = '';
      try { decoded = decodeURIComponent(body.replace(/\+/g, ' ')); } catch { /* не форма */ }
      const text = withExt ? readable(body) : decoded;
      const found = body.includes('zebra') || text.includes('zebra');
      const leak = withExt ? SECRETS.filter((v) => text.includes(v)) : undefined;
      if (found) hits.push({ kind: 'http', method: r.method, url: r.url, type: r.headers['Content-Type'] || r.headers['content-type'] || '', body: body.slice(0, 6000), leak, labels: withExt ? (text.match(/\[\[[A-Z]+_\d+\]\]/g) || []) : undefined });
      else posts.push({ url: r.url.slice(0, 200), len: body.length, hasPostData: !!r.hasPostData, body: body.slice(0, 4000) });
    });
    cdp.on('Network.webSocketCreated', (e) => hits.push({ kind: 'ws-open', url: e.url }));
    cdp.on('Network.webSocketFrameSent', (e) => {
      const d = e.response.payloadData || '';
      if (d.includes('zebra') || (withExt && SECRETS.some((v) => d.includes(v)))) hits.push({ kind: 'ws', url: '', body: d.slice(0, 6000), leak: withExt ? SECRETS.filter((v) => d.includes(v)) : undefined });
    });
    const report = { site: name, url, ok: false, note: '', ext: withExt };
    const started = Date.now();
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      await sleep(2500);
      await dismiss(page);
      report.finalUrl = page.url();
      const box = await page.waitForSelector(EDITABLE, { visible: true, timeout: 15000 });
      await box.click();
      await page.keyboard.type(MARK, { delay: 15 });
      await sleep(800);
      await page.keyboard.press('Enter');
      await sleep(2500);
      if (!hits.some((h) => h.kind !== 'ws-open')) {
        const btn = await page.$('button[aria-label*="Send" i], button[aria-label*="Отправ" i], button[aria-label*="Submit" i], button[type="submit"], button[data-testid*="send" i]');
        if (btn) { await btn.click().catch(() => {}); report.clicked = true; }
      }
      await sleep(10000);
      report.ok = hits.some((h) => h.kind !== 'ws-open');
      if (!report.ok) report.note = 'фраза не ушла в сеть';
    } catch (e) {
      report.note = String(e.message || e).slice(0, 300);
      report.finalUrl = page.url();
    }
    if (ext) {
      const log = await ext({ type: 'getLog' });
      report.log = log.filter((e) => e.at > started).map(({ kind, channel, host, path: p, summary, reason, note }) => ({ kind, channel, host, path: p, summary, reason, note }));
      report.leaks = hits.filter((h) => h.leak && h.leak.length).length;
      const text = await page.evaluate(() => document.body.innerText).catch(() => '');
      report.answerHasValues = SECRETS.some((v) => text.includes(v));
      report.answerHasLabels = /\[\[[A-Z]+_\d+\]\]/.test(text);
    }
    report.posts = posts.slice(-40);
    report.hits = hits.filter((h) => h.kind !== 'ws-open' || hits.some((x) => x.kind === 'ws'));
    const file = name + (withExt ? '-ext' : '');
    await page.screenshot({ path: path.join(out, file + '.png') }).catch(() => {});
    writeFileSync(path.join(out, file + '.json'), JSON.stringify(report, null, 2));
    console.log(`${name}: ${report.ok ? 'ушло' : 'нет'}  ${report.finalUrl || ''}  ${report.note}`);
    for (const h of report.hits) console.log(`   ${h.kind} ${h.method || ''} ${(h.url || '').slice(0, 90)} ${h.leak ? 'утечка=' + JSON.stringify(h.leak) + ' метки=' + JSON.stringify(h.labels) : ''}`);
    if (ext) {
      console.log(`   журнал: ${report.log.map((e) => e.kind + (e.channel ? '/' + e.channel : '') + ' ' + e.host + (e.summary ? ' скрыто=' + e.summary.count + ' остаток=' + e.summary.recheck : '') + (e.reason ? ' ' + e.reason : '')).join(' | ')}`);
      console.log(`   ответ: настоящие значения ${report.answerHasValues}, метки ${report.answerHasLabels}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
