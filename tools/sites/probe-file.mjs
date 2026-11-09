// Живая проверка вложения на настоящем сайте без входа: Velami установлен, прикрепляется PDF
// с выдуманными данными, в окне выбирается «чистая копия», записывается всё, что ушло в сеть.
// node tools/sites/probe-file.mjs [chatgpt|perplexity|gemini] -> dist/probe/file-<site>.json и .png
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'dist', 'probe');
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITES = { chatgpt: 'https://chatgpt.com/', perplexity: 'https://www.perplexity.ai/', gemini: 'https://gemini.google.com/app' };
const site = process.argv[2] || 'chatgpt';
const SECRETS = ['mario.rossi@example.com', '4111 1111 1111 1111', 'RSSMRA85T10A562S', 'IT60 X054'];
const file = path.join(root, 'test/fixtures/files/estratto.pdf');

const browser = await puppeteer.launch({
  headless: true,
  args: ['--lang=it-IT', '--window-size=1280,900', '--disable-blink-features=AutomationControlled', `--disable-extensions-except=${root}`, `--load-extension=${root}`],
  defaultViewport: { width: 1280, height: 900 },
});
const report = { site, ok: false, steps: [], requests: [] };
try {
  const page = await browser.newPage();
  await page.setUserAgent((await browser.userAgent()).replace('HeadlessChrome', 'Chrome'));
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable', { maxPostDataSize: 5 * 1024 * 1024 });
  cdp.on('Network.requestWillBeSent', async (e) => {
    const r = e.request;
    if (r.method === 'GET' || r.method === 'OPTIONS') return;
    let body = r.postData || '';
    if (!body && r.hasPostData) body = await cdp.send('Network.getRequestPostData', { requestId: e.requestId }).then((x) => x.postData, () => '');
    const pdf = body.startsWith('%PDF');
    report.requests.push({ url: r.url.slice(0, 160), method: r.method, len: body.length, pdf, leak: SECRETS.filter((s) => body.includes(s)), labels: (body.match(/\[\[[A-Z]+_\d+\]\]/g) || []).length });
  });
  await page.goto(SITES[site], { waitUntil: 'networkidle2', timeout: 45000 });
  await sleep(2500);
  const input = await page.waitForSelector('input[type="file"]', { timeout: 15000 });
  await input.uploadFile(file);
  report.steps.push('файл выбран');
  const tree = async () => (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })).root;
  const kids = (n) => [...(n.children || []), ...(n.shadowRoots || [])];
  const textOf = (n) => (n.nodeType === 3 ? n.nodeValue : n.nodeName === 'STYLE' ? '' : kids(n).map(textOf).join(' '));
  const find = (n, t) => { if (t(n)) return n; for (const c of kids(n)) { const r = find(c, t); if (r) return r; } return null; };
  let btn = null;
  for (let i = 0; i < 80 && !btn; i++) {
    btn = find(await tree(), (n) => n.nodeName === 'BUTTON' && ['Invia copia pulita', 'Отправить чистую копию', 'Send clean copy'].includes(textOf(n).trim()));
    if (!btn) await sleep(200);
  }
  if (!btn) {
    await page.screenshot({ path: path.join(out, `file-${site}.png`) });
    const host = find(await tree(), (n) => (n.attributes || []).includes('data-pg-gateway'));
    report.inputs = await page.$$eval('input[type="file"]', (l) => l.map((i) => ({ accept: i.accept, multiple: i.multiple, files: i.files.length })));
    throw new Error('окно Velami не появилось. Панель: ' + (host ? textOf(host).replace(/\s+/g, ' ').slice(0, 300) : 'нет') + ' inputs ' + JSON.stringify(report.inputs));
  }
  await page.screenshot({ path: path.join(out, `file-${site}-ask.png`) });
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId: btn.nodeId });
  await page.mouse.click((model.content[0] + model.content[4]) / 2, (model.content[1] + model.content[5]) / 2);
  report.steps.push('выбрана чистая копия');
  await sleep(12000);
  await page.screenshot({ path: path.join(out, `file-${site}.png`) });
  report.attached = await page.evaluate(() => document.body.innerText.includes('estratto.pdf'));
  report.ok = !report.requests.some((r) => r.leak.length || r.pdf);
} catch (e) {
  report.error = String(e.message || e);
} finally {
  writeFileSync(path.join(out, `file-${site}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ site, ok: report.ok, error: report.error, steps: report.steps, attached: report.attached }, null, 0));
  for (const r of report.requests.filter((x) => x.len > 200 || x.labels || x.leak.length)) console.log(`  ${r.method} ${r.url.slice(0, 90)} len=${r.len} pdf=${r.pdf} утечка=${r.leak.join('|')} метки=${r.labels}`);
  await browser.close();
}
