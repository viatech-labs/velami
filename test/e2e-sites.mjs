// Сквозной тест сайтов из sites.js: настоящий Chrome с расширением, двойники страниц на настоящих
// адресах, тела запросов в том виде, в каком их отправляют сайты (Gemini и Perplexity сняты
// с живых сайтов 09/11/2026, остальные по известному формату). WebSocket идёт на локальный wss.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { listFiles } from '../scripts/package-lib.mjs';

const require = createRequire(import.meta.url);
const Proto = require('../src/proto.js');
const Sites = require('../src/sites.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'test', 'artifacts', 'sites');
mkdirSync(out, { recursive: true });

const SECRETS = ['mario.rossi@example.com', '4111 1111 1111 1111', 'IT60 X054 2811 1010 0000 0123 456', 'Mario Rossi'];
const MESSAGE = 'Sono Mario Rossi, email mario.rossi@example.com, carta 4111 1111 1111 1111, IBAN IT60 X054 2811 1010 0000 0123 456. Scrivi una mail alla banca.';
const TOKENS = ['[[PERSON_1]]', '[[EMAIL_1]]', '[[CARD_1]]', '[[IBAN_1]]'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, fn) => { fn(); results.push(name); console.log('  ✓ ' + name); };
const clean = (name, body) => {
  assert.ok(body, name + ': запрос не перехвачен');
  for (const v of SECRETS) assert.ok(!body.includes(v), `${name}: утекло ${v}`);
  for (const t of TOKENS) assert.ok(body.includes(t), `${name}: нет метки ${t}`);
};

setTimeout(() => { console.error('Тест не уложился в 3 минуты'); process.exit(2); }, 180000).unref();

/* Копия расширения, где необязательные сайты уже разрешены: окно разрешения Chrome
   в автоматическом браузере не нажать. Включение сайта при этом идёт обычным путём. */
const tmp = mkdtempSync(path.join(os.tmpdir(), 'velami-sites-'));
const extDir = path.join(tmp, 'ext');
for (const f of listFiles(root)) cpSync(path.join(root, f), path.join(extDir, f));
const manifest = JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...manifest.host_permissions, ...manifest.optional_host_permissions];
writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem')], { stdio: 'ignore' });
const server = https.createServer({ key: readFileSync(path.join(tmp, 'key.pem')), cert: readFileSync(path.join(tmp, 'cert.pem')) });
const frames = { suggest: [], copilot: [] };
const opened = { suggest: 0, copilot: 0 };
const wss = new WebSocketServer({ server });
wss.on('connection', (ws, req) => {
  const kind = req.url.startsWith('/suggest') ? 'suggest' : 'copilot';
  opened[kind]++;
  ws.on('message', (data) => {
    const text = String(data);
    frames[kind].push(text);
    if (kind === 'copilot') {
      const msg = JSON.parse(text);
      ws.send(JSON.stringify({ event: 'appendText', text: 'Ricevuto: ' + msg.content[0].text }));
    }
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/* ---------- двойники страниц ---------- */

const shell = (title, composer, button, script) => `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${title} (doppione di test)</title>
<style>body{font:15px system-ui;max-width:720px;margin:40px auto}.ed{min-height:60px;border:1px solid #ccc;border-radius:12px;padding:12px;display:block;width:100%}
.answer{background:#f4f4f4;border-radius:12px;padding:12px;white-space:pre-wrap;margin:8px 0}</style></head><body>
<h2>${title} (doppione di test)</h2><div id="answers"></div>${composer}<p>${button}</p>
<script>
const show = (t) => { const p = document.createElement('div'); p.className = 'answer'; p.textContent = t; document.getElementById('answers').append(p); };
const fail = (e) => { const p = document.createElement('div'); p.className = 'error'; p.textContent = String(e); document.body.append(p); };
const read = () => { const ed = document.querySelector('.ed'); const t = ed.value !== undefined ? ed.value : ed.innerText; if (ed.value !== undefined) ed.value = ''; else ed.textContent = ''; return t; };
${script}
</script></body></html>`;

const textarea = '<textarea class="ed" rows="3"></textarea>';
const editable = '<div class="ed" contenteditable="true"></div>';

/* Gemini без входа: XHR с protobuf в base64, как на живом сайте. Со входом: f.req в StreamGenerate. */
const GEMINI = shell('Gemini', `<rich-textarea>${editable}</rich-textarea>`, '<button aria-label="Send message" id="send">Invia</button>', `
const enc = new TextEncoder();
const len = (n) => { const o = []; while (n >= 128) { o.push((n & 127) | 128); n >>= 7; } o.push(n); return o; };
const field = (no, bytes) => [(no << 3) | 2, ...len(bytes.length), ...bytes];
const b64 = (a) => btoa(String.fromCharCode(...a));
const send = () => {
  const text = read();
  const req0 = [...field(1, [...field(1, [...enc.encode(text)]), 0x10, 0x01]), ...field(3, [...enc.encode('it')]), ...field(4, [...enc.encode('c_9f2b1e7a3d')])];
  const req1 = field(2, [0x08, 0x01, ...field(9, field(1, [...enc.encode(text)]))]);
  const x = new XMLHttpRequest();
  x.open('POST', 'https://geminiweb-pa.clients6.google.com/v1/processSession?VER=8&gsessionid=Q34_bEFAS_KuHBv3GxikYi8avvw&RID=40588&t=1');
  x.setRequestHeader('content-type', 'application/x-www-form-urlencoded');
  x.send(new URLSearchParams({ count: '2', ofs: '0', req0___data__: b64(req0), req1___data__: b64(req1) }).toString());
  x.onload = async () => {
    const inner = JSON.stringify([[text, 0, null, null, null, null, 0], ['it'], ['c_1', 'r_1', 'rc_1']]);
    const r = await fetch('/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant&rt=c', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ 'f.req': JSON.stringify([null, inner]), at: 'AJvLN6MxQ0R5a1Zk3Lr9oTq8Yp2:1762700000000' }) });
    show(await r.text());
  };
  x.onerror = () => fail('xhr');
};
document.getElementById('send').onclick = send;`);

/* Perplexity: подсказки по WebSocket на каждую букву, сообщение JSON с query_str и dsl_query. */
const PERPLEXITY = shell('Perplexity', textarea, '<button aria-label="Submit" id="send">Invia</button>', `
const ws = new WebSocket('wss://suggest.perplexity.ai/suggest/ws');
let uuid = 0;
document.querySelector('.ed').addEventListener('input', (e) => { if (ws.readyState === 1) ws.send(JSON.stringify({ q: e.target.value, uuid: String(++uuid), full_completion: true })); });
document.getElementById('send').onclick = async () => {
  const text = read();
  const r = await fetch('/rest/sse/perplexity_ask', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ params: { language: 'it-IT', timezone: 'Europe/Rome', frontend_uuid: 'f3c1a2b4-0000-4000-8000-000000000001', mode: 'concise', dsl_query: text, query_source: 'home', version: '2.18' }, query_str: text }) }).catch(fail);
  show(await r.text());
};`);

const jsonSite = (title, url, makeBody) => shell(title, textarea, '<button aria-label="Send" id="send">Invia</button>', `
document.getElementById('send').onclick = async () => {
  const text = read();
  try {
    const r = await fetch('${url}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify((${makeBody})(text)) });
    show(await r.text());
  } catch (e) { fail(e); }
};`);

const DEEPSEEK = jsonSite('DeepSeek', '/api/v0/chat/completion', (t) => ({ chat_session_id: '7c1e0b8e-0000-4000-8000-00000000000a', parent_message_id: null, prompt: t, ref_file_ids: [], thinking_enabled: false, search_enabled: false }));
const GROK = jsonSite('Grok', '/rest/app-chat/conversations/new', (t) => ({ temporary: false, modelName: 'grok-4', message: t, fileAttachments: [], imageAttachments: [], disableSearch: false }));
const MISTRAL = jsonSite('Le Chat', '/api/chat', (t) => ({ chatId: '0b5e-test', mode: 'start', model: 'mistral-medium', messageInput: [{ type: 'text', text: t }], features: [] }));

const COPILOT = shell('Copilot', textarea, '<button aria-label="Submit message" id="send">Invia</button>', `
const ws = new WebSocket('wss://copilot.microsoft.com/c/api/chat?api-version=2');
ws.onopen = () => console.log('ws open'); ws.onerror = () => console.log('ws error'); ws.onclose = (e) => console.log('ws close', e.code);
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.event === 'appendText') show(m.text); };
document.getElementById('send').onclick = () => {
  const text = read();
  ws.send(JSON.stringify({ event: 'send', conversationId: 'cv-test', content: [{ type: 'text', text }], mode: 'chat', context: {} }));
};`);

const PAGES = {
  'https://gemini.google.com/app': GEMINI,
  'https://www.perplexity.ai/': PERPLEXITY,
  'https://chat.deepseek.com/': DEEPSEEK,
  'https://grok.com/': GROK,
  'https://chat.mistral.ai/chat': MISTRAL,
  'https://copilot.microsoft.com/': COPILOT,
};
const captured = {};
const reply = (body) => {
  let text = body;
  try { text = decodeURIComponent(body.replace(/\+/g, ' ')); } catch { /* не форма */ }
  const found = SECRETS.concat(TOKENS).filter((s) => text.includes(s));
  return 'Ricevuto: ' + found.join(' ');
};

const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=1280,900', '--ignore-certificate-errors',
    '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessChecks,BlockInsecurePrivateNetworkRequests',
    `--host-resolver-rules=MAP suggest.perplexity.ai 127.0.0.1:${port}, MAP copilot.microsoft.com 127.0.0.1:${port}`],
  defaultViewport: { width: 1280, height: 900 },
});

async function open(url) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = req.url();
    if (PAGES[u]) return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: PAGES[u] });
    if (req.method() === 'POST') {
      const body = req.postData() ?? (await req.fetchPostData().catch(() => '')) ?? '';
      const key = new URL(u).host + new URL(u).pathname;
      captured[key] = body;
      return req.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'text/plain; charset=utf-8', body: reply(body) });
    }
    return req.abort();
  });
  page.on('console', (m) => { if (process.env.DEBUG) console.log('   [page]', m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

async function type(page) {
  await page.click('.ed');
  await page.keyboard.type(MESSAGE, { delay: 2 });
  await sleep(700);
}

async function sendAndAnswer(page, name) {
  await page.click('#send');
  await page.waitForSelector('.answer, .error', { timeout: 10000 });
  await sleep(600);
  const err = await page.$('.error');
  assert.ok(!err, name + ': ' + (err && await page.$eval('.error', (n) => n.textContent)));
  return page.$eval('.answer', (n) => n.textContent);
}

const restored = (name, answer) => {
  for (const v of SECRETS) assert.ok(answer.includes(v), `${name}: в ответе не подставлено ${v}`);
  assert.ok(!/\[\[[A-Z]+_\d+\]\]/.test(answer), `${name}: в ответе остались метки`);
};

try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const admin = await browser.newPage();
  await admin.goto(`chrome-extension://${extId}/dashboard.html#sites`);
  const ext = (msg) => admin.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  await ext({ type: 'setSettings', patch: { language: 'it', dictionary: [{ term: 'Mario Rossi', type: 'PERSON' }] } });
  await admin.reload();
  await admin.waitForSelector('#sites-optional .site');
  await admin.screenshot({ path: path.join(out, 'sites-off.png'), fullPage: true });

  /* ---------- Gemini ---------- */
  let page = await open('https://gemini.google.com/app');
  await page.waitForSelector('[data-pg-gateway]', { timeout: 5000 });
  await type(page);
  let answer = await sendAndAnswer(page, 'Gemini');
  const session = captured['geminiweb-pa.clients6.google.com/v1/processSession'];
  check('Gemini без входа: в protobuf только метки, служебные поля целы', () => {
    assert.ok(session, 'processSession не перехвачен');
    const form = new URLSearchParams(session);
    assert.equal(form.get('count'), '2');
    const req0 = Proto.open(form.get('req0___data__'));
    const req1 = Proto.open(form.get('req1___data__'));
    assert.ok(req0 && req1, 'protobuf не разбирается после замены');
    clean('req0', req0.strings.join('\n'));
    clean('req1', req1.strings.join('\n'));
    assert.ok(req0.strings.includes('it') && req0.strings.includes('c_9f2b1e7a3d'), 'служебные строки изменены');
    for (const k of ['req0___data__', 'req1___data__']) for (const v of SECRETS) assert.ok(!Proto.readable(form.get(k)).includes(v), 'в байтах осталось ' + v);
  });
  check('Gemini со входом: f.req с JSON внутри JSON, токен at цел', () => {
    const body = captured['gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate'];
    const form = new URLSearchParams(body);
    const inner = JSON.parse(JSON.parse(form.get('f.req'))[1]);
    clean('f.req', inner[0][0]);
    assert.deepEqual(inner[2], ['c_1', 'r_1', 'rc_1']);
    assert.equal(form.get('at'), 'AJvLN6MxQ0R5a1Zk3Lr9oTq8Yp2:1762700000000');
  });
  check('Gemini: в ответе настоящие значения', () => restored('Gemini', answer));
  await page.screenshot({ path: path.join(out, 'gemini.png') });
  await page.close();

  /* ---------- Perplexity ---------- */
  page = await open('https://www.perplexity.ai/');
  await page.waitForSelector('[data-pg-gateway]', { timeout: 5000 });
  await sleep(500);
  await type(page);
  answer = await sendAndAnswer(page, 'Perplexity');
  check('Perplexity: query_str и dsl_query только с метками, остальные поля целы', () => {
    const body = captured['www.perplexity.ai/rest/sse/perplexity_ask'];
    const b = JSON.parse(body);
    clean('query_str', b.query_str);
    clean('dsl_query', b.params.dsl_query);
    assert.equal(b.params.frontend_uuid, 'f3c1a2b4-0000-4000-8000-000000000001');
    assert.equal(b.params.language, 'it-IT');
  });
  check('Perplexity: подсказки по буквам не ушли на сервер', () => {
    assert.equal(opened.suggest, 1, 'сокет подсказок не открылся, проверка была бы пустой');
    assert.equal(frames.suggest.length, 0, 'ушло кадров: ' + frames.suggest.length);
  });
  check('Perplexity: в ответе настоящие значения', () => restored('Perplexity', answer));
  await page.screenshot({ path: path.join(out, 'perplexity.png') });
  await page.close();

  /* ---------- необязательные сайты ---------- */
  page = await open('https://chat.deepseek.com/');
  await sleep(1200);
  const before = await page.$('[data-pg-gateway]');
  check('необязательный сайт без включения не трогается', () => assert.equal(before, null));
  await page.close();

  const ids = Sites.SITES.filter((s) => s.optional).map((s) => s.id);
  await ext({ type: 'setSettings', patch: { sites: Object.fromEntries(ids.map((id) => [id, true])) } });
  const state = await ext({ type: 'getSites' });
  check('включённые сайты отмечены как включённые и непроверенные', () => {
    for (const id of ids) {
      const s = state.find((x) => x.id === id);
      assert.ok(s.enabled && !s.verified, id);
    }
  });
  await admin.reload();
  await admin.waitForSelector('#sites-optional .site.on');
  await admin.screenshot({ path: path.join(out, 'sites-on.png'), fullPage: true });

  for (const [name, url, key, pick] of [
    ['DeepSeek', 'https://chat.deepseek.com/', 'chat.deepseek.com/api/v0/chat/completion', (b) => b.prompt],
    ['Grok', 'https://grok.com/', 'grok.com/rest/app-chat/conversations/new', (b) => b.message],
    ['Mistral', 'https://chat.mistral.ai/chat', 'chat.mistral.ai/api/chat', (b) => b.messageInput[0].text],
  ]) {
    page = await open(url);
    await page.waitForSelector('[data-pg-gateway]', { timeout: 5000 });
    await type(page);
    answer = await sendAndAnswer(page, name);
    check(`${name}: сообщение только с метками, ответ с настоящими значениями`, () => {
      const b = JSON.parse(captured[key]);
      clean(name, pick(b));
      restored(name, answer);
    });
    await page.screenshot({ path: path.join(out, name.toLowerCase() + '.png') });
    await page.close();
  }

  page = await open('https://copilot.microsoft.com/');
  await page.waitForSelector('[data-pg-gateway]', { timeout: 5000 });
  await sleep(500);
  await type(page);
  answer = await sendAndAnswer(page, 'Copilot');
  check('Copilot: кадр WebSocket только с метками, ответ с настоящими значениями', () => {
    assert.equal(frames.copilot.length, 1);
    const m = JSON.parse(frames.copilot[0]);
    assert.equal(m.event, 'send');
    assert.equal(m.conversationId, 'cv-test');
    clean('Copilot', m.content[0].text);
    restored('Copilot', answer);
  });
  await page.screenshot({ path: path.join(out, 'copilot.png') });
  await page.close();

  const log = await ext({ type: 'getLog' });
  check('журнал: отправки на каждом сайте, подсказки Perplexity отмечены, обходов нет', () => {
    const sent = new Set(log.filter((e) => e.kind === 'sent' && e.channel === 'model').map((e) => e.site));
    for (const h of ['gemini.google.com', 'www.perplexity.ai', 'chat.deepseek.com', 'grok.com', 'chat.mistral.ai', 'copilot.microsoft.com']) assert.ok(sent.has(h), 'нет отправки с ' + h);
    assert.ok(log.some((e) => e.kind === 'dropped' && e.host === 'suggest.perplexity.ai'), 'нет записи о подсказках');
    assert.ok(!log.some((e) => e.kind === 'coverage' || e.kind === 'blocked' || e.kind === 'leak'), JSON.stringify(log.filter((e) => ['coverage', 'blocked', 'leak'].includes(e.kind))));
  });

  await ext({ type: 'setSettings', patch: { sites: { deepseek: false } } });
  page = await open('https://chat.deepseek.com/');
  await sleep(1200);
  const after = await page.$('[data-pg-gateway]');
  check('выключенный сайт снова не трогается', () => assert.equal(after, null));
  await page.close();

  console.log(`\nВсе проверки пройдены: ${results.length}`);
} catch (err) {
  console.error('\nПРОВАЛ:', err && err.message ? err.message : err);
  if (process.env.DEBUG) console.error('frames', JSON.stringify(frames).slice(0, 500));
  process.exitCode = 1;
} finally {
  await browser.close();
  wss.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
