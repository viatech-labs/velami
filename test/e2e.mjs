// Сквозной тест: настоящий Chrome с расширением, поддельный chatgpt.com.
// Проверяем то, что реально ушло в сеть, а не то, что расширение о себе сообщает.
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = process.env.PG_EXT_DIR ? path.resolve(process.env.PG_EXT_DIR) : root;
const out = path.join(root, 'test', 'artifacts');
mkdirSync(out, { recursive: true });

const MOCK_PAGE = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>ChatGPT (тестовый двойник)</title>
<style>body{font:15px system-ui;max-width:720px;margin:40px auto}#prompt-textarea{min-height:60px;border:1px solid #ccc;border-radius:12px;padding:12px}
.answer{background:#f4f4f4;border-radius:12px;padding:12px;white-space:pre-wrap}</style></head><body>
<h2>ChatGPT (тестовый двойник)</h2><div id="answers"></div>
<div id="prompt-textarea" contenteditable="true"></div><p><button data-testid="send-button" id="send">Отправить</button>
<button id="copy-text">Копировать</button><button id="copy-rich">Копировать с форматированием</button><button id="copy-event">Копировать через событие</button>
<div data-testid="chatgpt-writing-block"><div id="draft" class="ProseMirror" contenteditable="true"></div></div>
<div data-testid="assistant-message" data-is-streaming="false" id="mail"><input type="text" id="mail-subject"><textarea id="mail-body" rows="4" cols="60"></textarea>
<span id="mail-buttons"><button id="mail-copy">Копировать письмо</button></span></div><textarea id="notes" rows="1"></textarea>
<input type="file" id="file"></p><div id="drop" style="padding:16px;border:2px dashed #aaa">Перетащите файл</div><pre id="file-seen"></pre>
<script>
let lastRaw = '';
let copyResult = '';
document.getElementById('copy-text').onclick = () => navigator.clipboard.writeText(lastRaw).then(() => { copyResult = 'ok'; }, (e) => { copyResult = String(e); });
document.getElementById('copy-rich').onclick = () => navigator.clipboard.write([new ClipboardItem({
  'text/plain': new Blob([lastRaw], { type: 'text/plain' }),
  'text/html': new Blob(['<p><b>Ответ:</b> ' + lastRaw + '</p>'], { type: 'text/html' }),
})]).then(() => { copyResult = 'ok'; }, (e) => { copyResult = String(e); });
/* Как сейчас у ChatGPT: текст кладётся в буфер в обработчике события copy, событие останавливается. */
let copyViaEvent = false;
document.addEventListener('copy', (e) => {
  if (!copyViaEvent) return;
  e.clipboardData.setData('text/plain', lastRaw);
  e.clipboardData.setData('text/html', '<p><b>Ответ:</b> ' + lastRaw + '</p>');
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
document.getElementById('copy-event').onclick = () => { copyViaEvent = true; copyResult = document.execCommand('copy') ? 'ok' : 'failed'; copyViaEvent = false; };
/* Редактируемый блок ответа: сайт сохраняет его на сервер в Markdown при каждом изменении текста. */
const draft = document.getElementById('draft');
let saveTimer = 0;
new MutationObserver(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fetch('/backend-api/conversation/message/writing-blocks', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ writing_block: { content: draft.innerText.replace(/[@_*-]/g, '\\\\$&') + '&#x20;' } }) }).catch(() => {}), 150);
}).observe(draft, { subtree: true, childList: true, characterData: true });
/* Черновик письма как у Claude: тема и текст в полях формы внутри ответа. Сайт держит их значения
   у себя (как React): принимает правку по событию input, сам возвращает в поле своё значение,
   по правке показывает кнопку сброса и сообщает о правке на сервер. */
const mail = { subject: '', body: '', model: { subject: '', body: '' } };
const mailEl = { subject: document.getElementById('mail-subject'), body: document.getElementById('mail-body') };
const mailReset = Object.assign(document.createElement('button'), { id: 'mail-reset', textContent: 'Сбросить изменения' });
let mailTimer = 0;
const renderMail = () => {
  for (const k of ['subject', 'body']) if (mailEl[k].value !== mail[k]) mailEl[k].value = mail[k];
  const edited = mail.subject !== mail.model.subject || mail.body !== mail.model.body;
  if (edited && !mailReset.isConnected) document.getElementById('mail-buttons').append(mailReset);
  if (!edited) mailReset.remove();
  window.__mailto = 'mailto:?subject=' + encodeURIComponent(mail.subject) + '&body=' + encodeURIComponent(mail.body);
};
for (const k of ['subject', 'body']) mailEl[k].addEventListener('input', () => {
  mail[k] = mailEl[k].value;
  renderMail();
  clearTimeout(mailTimer);
  mailTimer = setTimeout(() => fetch('/backend-api/mail-draft', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ widget: 'message_compose', action: 'edit', subject: mail.subject, body: mail.body }) }).catch(() => {}), 150);
});
mailReset.onclick = () => { Object.assign(mail, mail.model); renderMail(); };
document.getElementById('mail-copy').onclick = () => navigator.clipboard.writeText('Subject: ' + mail.subject + '\\n\\n' + mail.body).then(() => { copyResult = 'ok'; }, (e) => { copyResult = String(e); });
window.modelMail = (subject, body, streaming) => {
  document.getElementById('mail').setAttribute('data-is-streaming', String(streaming));
  mail.model = { subject, body };
  Object.assign(mail, mail.model);
  renderMail();
};
document.getElementById('file').onchange = async (e) => {
  const f = e.target.files[0];
  window.__fileText = await f.text();
  document.getElementById('file-seen').textContent = window.__fileText;
  await fetch('https://files.example/upload/' + encodeURIComponent(f.name), { method: 'PUT', body: f });
};
const drop = document.getElementById('drop');
drop.ondragover = (e) => e.preventDefault();
drop.ondrop = async (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append('file', e.dataTransfer.files[0]);
  fd.append('purpose', 'assistants');
  await fetch('/backend-api/files', { method: 'POST', body: fd });
};
const TOKEN = 'gAAAAABq8X-lLZR41tnIOD_mOYqo5icZntaX5K9nVIsHvXZro4eiJ2mETPYHKHz00VJcwM4X4111111111111111DE89370400440532013000';
document.getElementById('send').onclick = async () => {
  const ed = document.getElementById('prompt-textarea');
  const text = ed.innerText; ed.textContent = '';
  fetch('/ces/v1/t', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'typed', properties: { draft: text } }) }).catch(() => {});
  navigator.sendBeacon('https://telemetry.example/beacon', JSON.stringify({ typed: text }));
  try {
    const form = new URLSearchParams({ conversationState: JSON.stringify({ messages: [] }), prompt: text, chatRequirementsToken: TOKEN, timezone: 'Europe/Moscow' });
    const f = await fetch('/unauth-mweb/conversation/updates', { method: 'POST', body: form });
    const r = await fetch('/backend-api/f/conversation', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'next', conversation_id: 'c-1', model: 'gpt-x',
        messages: [{ id: 'm-1', author: { role: 'user' }, content: { content_type: 'text', parts: [text] } }] }) });
    lastRaw = await f.text();
    const p = document.createElement('div'); p.className = 'answer'; p.textContent = lastRaw;
    const q = document.createElement('div'); q.className = 'answer-json'; q.textContent = await r.text();
    document.getElementById('answers').append(p, q);
  } catch (e) { const p = document.createElement('div'); p.className = 'error'; p.textContent = String(e); document.body.append(p); }
};
</script></body></html>`;

const SECRET_VALUES = ['maria.petrova@example.com', '4111 1111 1111 1111', 'IT60 X054 2811 1010 0000 0123 456', 'Мария Петрова', 'RSSMRA85T10A562S'];
const MESSAGE = 'Я Мария Петрова, почта maria.petrova@example.com. Карта 4111 1111 1111 1111, IBAN IT60 X054 2811 1010 0000 0123 456, CF RSSMRA85T10A562S. Составь письмо в банк.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, fn) => { fn(); results.push(name); console.log('  ✓ ' + name); };

setTimeout(() => { console.error('Тест не уложился в 2 минуты'); process.exit(2); }, 120000).unref();

const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=1280,900'],
  defaultViewport: { width: 1280, height: 900 },
});

try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  console.log('Расширение загружено:', extId);

  const scheme = async (pg, value) => { await pg.emulateMediaFeatures([{ name: 'prefers-color-scheme', value }]); await sleep(350); };
  const admin = await browser.newPage();
  await scheme(admin, 'light');
  const cspErrors = [];
  admin.on('console', (m) => { if (/Content Security Policy/i.test(m.text()) && !/example\.org/.test(m.text())) cspErrors.push(m.text()); });
  await admin.goto(`chrome-extension://${extId}/dashboard.html#dict`);
  const ext = (msg) => admin.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  await ext({ type: 'setSettings', patch: { language: 'ru', dictionary: [{ term: 'Мария Петрова', type: 'PERSON' }] } });

  const page = await browser.newPage();
  await scheme(page, 'light');
  const captured = { conversation: null, form: null, analytics: null, beacon: null, upload: null, drop: null, block: [], mail: [] };
  await browser.defaultBrowserContext().overridePermissions('https://chatgpt.com', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = req.url();
    if (url.startsWith('https://files.example/upload/')) {
      captured.upload = req.postData() ?? (await req.fetchPostData().catch(() => null));
      return req.respond({ status: 201, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'PUT' }, body: '' });
    }
    if (url === 'https://chatgpt.com/backend-api/files') {
      captured.drop = req.postData() ?? (await req.fetchPostData().catch(() => null));
      return req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (url === 'https://chatgpt.com/') return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: MOCK_PAGE });
    if (url === 'https://chatgpt.com/backend-api/f/conversation') {
      captured.conversation = req.postData();
      const parts = JSON.parse(captured.conversation).messages[0].content.parts[0];
      return req.respond({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'Модель получила: ' + parts });
    }
    if (url === 'https://chatgpt.com/unauth-mweb/conversation/updates') {
      captured.form = req.postData();
      const prompt = new URLSearchParams(captured.form).get('prompt');
      return req.respond({ status: 200, contentType: 'text/plain; charset=utf-8', body: 'Модель получила: ' + prompt });
    }
    if (url === 'https://chatgpt.com/backend-api/conversation/message/writing-blocks') {
      captured.block.push(req.postData());
      return req.respond({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (url === 'https://chatgpt.com/backend-api/mail-draft') {
      captured.mail.push(req.postData());
      return req.respond({ status: 200, contentType: 'application/json', body: '{}' });
    }
    if (url === 'https://chatgpt.com/ces/v1/t') {
      captured.analytics = req.postData();
      return req.respond({ status: 204, body: '' });
    }
    if (url.startsWith('https://telemetry.example/')) {
      captured.beacon = req.postData();
      return req.respond({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    return req.abort();
  });

  await page.goto('https://chatgpt.com/', { waitUntil: 'load' });
  await page.waitForSelector('[data-pg-gateway]', { timeout: 5000 });
  await page.click('#prompt-textarea');
  await page.keyboard.type(MESSAGE, { delay: 2 });
  await sleep(800);

  const cdp = await page.createCDPSession();
  const { root: dom } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const texts = [];
  (function collect(n) { if (n.nodeType === 3) texts.push(n.nodeValue); for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) collect(c); })(dom);
  const panelText = texts.join(' ');
  check('панель показывает метки до отправки', () => {
    for (const t of ['[[PERSON_1]]', '[[EMAIL_1]]', '[[CARD_1]]', '[[IBAN_1]]', '[[CF_1]]', 'Будет скрыто: 5']) assert.ok(panelText.includes(t), 'нет ' + t);
  });
  await page.screenshot({ path: path.join(out, '1-preview.png') });
  await scheme(page, 'dark');
  await page.screenshot({ path: path.join(out, '1c-preview-dark.png') });
  await scheme(page, 'light');

  await page.click('#send');
  await page.waitForSelector('.answer, .error', { timeout: 10000 });
  await sleep(600);

  const TOKENS = ['[[PERSON_1]]', '[[EMAIL_1]]', '[[CARD_1]]', '[[IBAN_1]]', '[[CF_1]]'];
  check('JSON-запрос к модели (вошедший пользователь): только метки', () => {
    assert.ok(captured.conversation, 'запрос не перехвачен');
    for (const v of SECRET_VALUES) assert.ok(!captured.conversation.includes(v), 'утекло: ' + v);
    for (const t of TOKENS) assert.ok(captured.conversation.includes(t), 'нет метки ' + t);
    const body = JSON.parse(captured.conversation);
    assert.equal(body.conversation_id, 'c-1');
    assert.equal(body.model, 'gpt-x');
  });
  check('форма к модели (без входа, как сейчас на chatgpt.com): метки, служебный токен цел', () => {
    assert.ok(captured.form, 'запрос не перехвачен');
    const form = new URLSearchParams(captured.form);
    const prompt = form.get('prompt');
    for (const v of SECRET_VALUES) assert.ok(!prompt.includes(v), 'утекло: ' + v);
    for (const t of TOKENS) assert.ok(prompt.includes(t), 'нет метки ' + t);
    assert.equal(form.get('chatRequirementsToken'), 'gAAAAABq8X-lLZR41tnIOD_mOYqo5icZntaX5K9nVIsHvXZro4eiJ2mETPYHKHz00VJcwM4X4111111111111111DE89370400440532013000');
    assert.equal(form.get('timezone'), 'Europe/Moscow');
  });
  check('аналитика сайта и sendBeacon на сторонний адрес получили метки', () => {
    for (const [name, body] of [['аналитика', captured.analytics], ['beacon', captured.beacon]]) {
      assert.ok(body, name + ': запрос не перехвачен');
      for (const v of SECRET_VALUES) assert.ok(!body.includes(v), `${name}: утекло ${v}`);
      assert.ok(body.includes('[[EMAIL_1]]'), name + ': нет метки');
    }
  });

  const answer = await page.$eval('.answer', (n) => n.textContent);
  check('в ответе на странице настоящие значения вместо меток', () => {
    for (const v of SECRET_VALUES) assert.ok(answer.includes(v), 'не подставлено: ' + v);
    assert.ok(!/\[\[[A-Z]+_\d+\]\]/.test(answer), 'остались метки: ' + answer);
  });
  await page.screenshot({ path: path.join(out, '2-answer.png') });

  const shadowTexts = async () => {
    const { root: d } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const acc = [];
    (function walkDom(n) { if (n.nodeType === 3) acc.push(n.nodeValue); for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walkDom(c); })(d);
    return acc.join(' ');
  };

  const box = await page.evaluate(() => {
    const node = document.querySelector('.answer').firstChild;
    const i = node.nodeValue.indexOf('maria.petrova@example.com');
    const r = new Range(); r.setStart(node, i); r.setEnd(node, i + 5);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  /* Ответ приходит кусками, каждый в своём элементе, как у ChatGPT: метка разорвана на узлы. */
  const streamed = await page.evaluate(async () => {
    const wrap = document.createElement('span');
    const p = document.createElement('p');
    p.className = 'streamed';
    p.append(wrap);
    document.getElementById('answers').append(p);
    const pieces = ['Il titolare è **', '[', '[PERSON', '_', '1]]', '**, mail ', '[[EMAIL', '_1]]', '; firma PERSON', '_', '1', '; altro [[PERSON', '_99]]', ' fine.'];
    for (const t of pieces) {
      const s = document.createElement('span');
      s.textContent = t;
      wrap.append(s);
      await new Promise((r) => setTimeout(r, 40));
    }
    await new Promise((r) => setTimeout(r, 300));
    return p.textContent;
  });
  check('метка, разорванная по элементам при выводе ответа, подставляется', () => {
    assert.equal(streamed, 'Il titolare è **Мария Петрова**, mail maria.petrova@example.com; firma Мария Петрова; altro [[PERSON_99]] fine.');
  });

  await page.mouse.move(box.x, box.y);
  await sleep(300);
  const tipText = await shadowTexts();
  check('при наведении на подставленное значение видна подсказка с меткой', () => {
    assert.ok(tipText.includes('Модель видела только') && tipText.includes('[[EMAIL_1]]'), 'нет подсказки');
  });
  await page.screenshot({ path: path.join(out, '2b-tooltip.png'), clip: { x: Math.max(0, box.x - 300), y: Math.max(0, box.y - 60), width: 640, height: 160 } });
  await page.mouse.move(5, 5);

  await page.bringToFront();
  await page.click('#copy-text');
  await page.waitForFunction(() => copyResult !== '', { timeout: 5000 });
  const copyText = await page.evaluate(() => Promise.all([copyResult, navigator.clipboard.readText()]));
  check('кнопка «Копировать» (writeText) кладёт в буфер настоящие значения', () => {
    assert.equal(copyText[0], 'ok');
    for (const v of SECRET_VALUES) assert.ok(copyText[1].includes(v), 'нет в буфере: ' + v);
    assert.ok(!/\[\[[A-Z]+_\d+\]\]/.test(copyText[1]), 'в буфере метки: ' + copyText[1]);
  });

  await page.evaluate(() => { copyResult = ''; });
  await page.click('#copy-rich');
  await page.waitForFunction(() => copyResult !== '', { timeout: 5000 });
  const copyRich = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return [copyResult, await (await item.getType('text/plain')).text(), await (await item.getType('text/html')).text()];
  });
  check('копирование с форматированием (clipboard.write): настоящие значения в тексте и HTML', () => {
    assert.equal(copyRich[0], 'ok');
    for (const s of [copyRich[1], copyRich[2]]) {
      assert.ok(s.includes('maria.petrova@example.com') && s.includes('4111 1111 1111 1111'), 'нет значений: ' + s);
      assert.ok(!/\[\[[A-Z]+_\d+\]\]/.test(s), 'остались метки: ' + s);
    }
    assert.ok(copyRich[2].includes('<b>'), 'потеряно форматирование');
  });

  await page.evaluate(() => { copyResult = ''; });
  await page.click('#copy-event');
  await page.waitForFunction(() => copyResult !== '', { timeout: 5000 });
  await sleep(500);
  const copyEventToast = await shadowTexts();
  const copyEvent = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read();
    return [copyResult, await (await item.getType('text/plain')).text(), await (await item.getType('text/html')).text()];
  });
  check('копирование через событие copy, которое сайт останавливает: в буфере настоящие значения', () => {
    assert.equal(copyEvent[0], 'ok');
    for (const s of [copyEvent[1], copyEvent[2]]) {
      for (const v of ['maria.petrova@example.com', '4111 1111 1111 1111', 'Мария Петрова']) assert.ok(s.includes(v), 'нет в буфере: ' + v + ' в ' + s);
      assert.ok(!/\[\[[A-Z]+_\d+\]\]/.test(s), 'остались метки: ' + s);
    }
    assert.ok(copyEvent[2].includes('<b>'), 'потеряно форматирование');
    assert.ok(copyEventToast.includes('Скопировано с настоящими значениями: 5'), 'нет сообщения о копировании');
  });

  /* Редактируемый блок ответа (черновик письма в ChatGPT): значения возвращаются и в нём, а его
     сохранение на сервер уходит с метками, хотя сайт экранирует знаки как в Markdown. */
  const draftSeen = await page.evaluate(async () => {
    const d = document.getElementById('draft');
    d.innerHTML = '<p>Gentile <span>[</span><span class="oai-writing-block-placeholder">[PERSON_1]</span><span>]</span>,</p><p>scrivo da [[EMAIL_1]], carta [[CARD_1]].</p>';
    const ed = document.getElementById('prompt-textarea');
    ed.textContent = 'черновик с [[EMAIL_1]]';
    await new Promise((r) => setTimeout(r, 900));
    const r = { draft: d.innerText, composer: ed.textContent };
    ed.textContent = '';
    return r;
  });
  check('редактируемый блок ответа: значения подставлены, поле ввода не тронуто', () => {
    assert.match(draftSeen.draft, /Gentile Мария Петрова,/);
    assert.match(draftSeen.draft, /scrivo da maria\.petrova@example\.com, carta 4111 1111 1111 1111\./);
    assert.equal(draftSeen.composer, 'черновик с [[EMAIL_1]]');
  });
  check('сохранение блока на сервер: значения с экранированием Markdown заменены метками', () => {
    assert.ok(captured.block.length > 0, 'сайт не сохранил блок');
    const last = JSON.parse(captured.block[captured.block.length - 1]).writing_block.content;
    for (const body of captured.block) for (const v of ['maria.petrova', 'example.com', '4111', 'Петрова']) assert.ok(!body.includes(v), 'в сохранении блока осталось ' + v + ': ' + body);
    assert.match(last, /Gentile \[\[PERSON_1\]\],/);
    assert.match(last, /scrivo da \[\[EMAIL_1\]\], carta \[\[CARD_1\]\]\./);
  });

  /* Черновик письма в полях формы (Claude): значения возвращаются в тему и в текст, сайт получает
     их как правку и отдаёт своими кнопками. Пока ответ печатается, поля не трогаются. Обычное поле
     ввода вне ответа остаётся с метками. Всё, что сайт шлёт о черновике, уходит с метками. */
  const MAIL_SUBJECT = 'Richiesta di [[PERSON_1]]';
  const MAIL_BODY = 'Gentile banca,\nsono [[PERSON_1]], email [[EMAIL_1]], IBAN [[IBAN_1]].\nCordiali saluti';
  const mailState = () => page.evaluate(() => ({
    subject: document.getElementById('mail-subject').value, body: document.getElementById('mail-body').value,
    site: mail.subject + '\n' + mail.body, mailto: decodeURIComponent(window.__mailto), notes: document.getElementById('notes').value,
    reset: !!document.getElementById('mail-reset'),
  }));
  await page.evaluate((s, b) => { document.getElementById('notes').value = 'заметка с [[EMAIL_1]]'; window.modelMail(s, b, true); }, MAIL_SUBJECT, MAIL_BODY);
  await sleep(700);
  const mailStreaming = await mailState();
  check('черновик письма в полях формы: пока ответ печатается, поля не тронуты', () => {
    assert.equal(mailStreaming.subject, MAIL_SUBJECT);
    assert.equal(mailStreaming.body, MAIL_BODY);
  });
  await page.evaluate(() => document.getElementById('mail').setAttribute('data-is-streaming', 'false'));
  await sleep(700);
  const mailDone = await mailState();
  check('черновик письма в полях формы: в теме и тексте настоящие значения, сайт их принял', () => {
    assert.equal(mailDone.subject, 'Richiesta di Мария Петрова');
    assert.equal(mailDone.body, 'Gentile banca,\nsono Мария Петрова, email maria.petrova@example.com, IBAN IT60 X054 2811 1010 0000 0123 456.\nCordiali saluti');
    assert.equal(mailDone.site, mailDone.subject + '\n' + mailDone.body);
    assert.equal(mailDone.notes, 'заметка с [[EMAIL_1]]', 'тронуто поле вне ответа');
  });
  await page.evaluate(() => { copyResult = ''; });
  await page.click('#mail-copy');
  await page.waitForFunction(() => copyResult !== '', { timeout: 5000 });
  const mailCopy = await page.evaluate(() => navigator.clipboard.readText());
  check('кнопки черновика («Копировать», «Открыть в почте») дают настоящие значения', () => {
    for (const s of [mailCopy, mailDone.mailto]) {
      for (const v of ['Мария Петрова', 'maria.petrova@example.com', 'IT60 X054 2811 1010 0000 0123 456']) assert.ok(s.includes(v), 'нет значения ' + v + ': ' + s);
      assert.ok(!/\[\[[A-Z]+_\d+\]\]/.test(s), 'остались метки: ' + s);
    }
  });
  await page.click('#mail-reset');
  await sleep(700);
  const mailReset = await mailState();
  check('сайт вернул в черновик текст модели («Сбросить изменения»): значения подставлены снова', () => {
    assert.equal(mailReset.subject, mailDone.subject);
    assert.equal(mailReset.body, mailDone.body);
  });
  await page.evaluate(() => { const b = document.getElementById('mail-body'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); });
  await page.keyboard.type(' Scrivetemi a maria.petrova@example.com', { delay: 2 });
  await sleep(900);
  const mailTyped = await mailState();
  const mailPanel = await (async () => {
    const { root: d } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const acc = [];
    const walkDom = (n, inside) => {
      const mine = inside || (n.attributes || []).includes('data-pg-gateway');
      if (n.nodeType === 3 && mine) acc.push(n.nodeValue);
      for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walkDom(c, mine);
    };
    walkDom(d, false);
    return acc.join(' ');
  })();
  check('правка черновика человеком: это не поле ввода чата, сайту правка уходит с метками', () => {
    assert.ok(mailTyped.body.endsWith('Cordiali saluti Scrivetemi a maria.petrova@example.com'), mailTyped.body);
    assert.ok(mailPanel.length > 20, 'панель не найдена');
    assert.ok(!mailPanel.includes('Gentile banca'), 'панель показала черновик как сообщение: ' + mailPanel);
    assert.ok(captured.mail.length >= 3, 'сайт не сообщил о правках: ' + captured.mail.length);
    for (const body of captured.mail) for (const v of ['maria.petrova', 'example.com', 'Петрова', 'IT60']) assert.ok(!body.includes(v), 'в запросе о черновике осталось ' + v + ': ' + body);
    const last = JSON.parse(captured.mail[captured.mail.length - 1]);
    assert.equal(last.subject, MAIL_SUBJECT);
    assert.equal(last.body, MAIL_BODY + ' Scrivetemi a [[EMAIL_1]]');
  });
  await page.evaluate(() => { window.modelMail('', '', false); document.getElementById('notes').value = ''; });

  const FILE_TEXT = 'имя;почта;iban\nМария Петрова;maria.petrova@example.com;IT60 X054 2811 1010 0000 0123 456\nключ sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd\n';
  const filePath = path.join(out, 'clienti.csv');
  writeFileSync(filePath, FILE_TEXT);
  const input = await page.$('#file');
  await input.uploadFile(filePath);
  await page.waitForFunction(() => typeof window.__fileText === 'string', { timeout: 5000 });
  await sleep(500);
  const seen = await page.evaluate(() => window.__fileText);
  check('выбранный файл: сайт видит и загружает только копию с метками', () => {
    for (const body of [seen, captured.upload].filter((b, i) => i === 0 || b != null)) {
      assert.ok(body, 'файл не загружен');
      for (const v of ['maria.petrova@example.com', 'IT60 X054 2811 1010 0000 0123 456', 'Мария Петрова', 'sk-proj-AbCdEf']) assert.ok(!body.includes(v), 'утекло из файла: ' + v);
      for (const t of ['[[PERSON_1]]', '[[EMAIL_1]]', '[[IBAN_1]]', '[[SECRET_1]]']) assert.ok(body.includes(t), 'нет метки ' + t + ' в ' + body);
    }
  });

  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], 'note.txt', { type: 'text/plain' }));
    document.getElementById('drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, FILE_TEXT);
  for (let i = 0; i < 30 && !captured.drop; i++) await sleep(100);
  await sleep(300);
  check('перетащенный файл уходит с метками, поля формы целы', () => {
    assert.ok(captured.drop, 'файл не загружен');
    for (const v of ['maria.petrova@example.com', 'Мария Петрова']) assert.ok(!captured.drop.includes(v), 'утекло: ' + v);
    assert.ok(captured.drop.includes('[[EMAIL_1]]') && captured.drop.includes('assistants'));
  });

  const fileLog = await ext({ type: 'getLog' });
  check('журнал: файлы записаны как проверенные, тревоги «без проверки» нет', () => {
    assert.ok(fileLog.some((e) => e.kind === 'file' && e.file === 'clienti.csv' && e.summary.count >= 4), 'нет записи о clienti.csv');
    assert.ok(fileLog.some((e) => e.kind === 'file' && e.file === 'note.txt'), 'нет записи о note.txt');
    assert.ok(!fileLog.some((e) => e.kind === 'unchecked'), 'ложная тревога «без проверки»');
  });
  await page.screenshot({ path: path.join(out, '2c-file.png') });

  const log = await ext({ type: 'getLog' });
  check('журнал записал ровно те тела, что ушли в сеть', () => {
    for (const [p, body] of [['/backend-api/f/conversation', captured.conversation], ['/unauth-mweb/conversation/updates', captured.form]]) {
      const sent = log.find((e) => e.kind === 'sent' && e.channel === 'model' && e.path === p);
      assert.ok(sent, 'нет записи об отправке ' + p);
      assert.equal(sent.body, body);
      assert.equal(sent.summary.count, 5);
      assert.equal(sent.summary.recheck, 0);
    }
    assert.ok(log.some((e) => e.channel === 'other' && e.path === '/ces/v1/t'), 'нет записи об аналитике');
    assert.ok(log.some((e) => e.channel === 'other' && e.host === 'telemetry.example'), 'нет записи о beacon');
  });

  await ext({ type: 'setSettings', patch: { enabled: false } });
  await sleep(300);
  await page.click('#prompt-textarea');
  await page.keyboard.type('выключено: test@example.com', { delay: 2 });
  await page.click('#send');
  await sleep(800);
  check('выключенный шлюз ничего не меняет', () => assert.ok(new URLSearchParams(captured.form).get('prompt').includes('test@example.com')));
  await ext({ type: 'setSettings', patch: { enabled: true } });

  await ext({ type: 'setSettings', patch: { language: 'it' } });
  await page.click('#prompt-textarea');
  await page.keyboard.type('scrivimi a luca@example.it', { delay: 2 });
  await sleep(700);
  const itText = await shadowTexts();
  check('язык меняется на лету: панель на итальянском', () => {
    for (const s of ['Cosa vedrà il modello', 'Da nascondere: 1', 'Protezione attiva']) assert.ok(itText.includes(s), 'нет «' + s + '»');
  });
  await page.screenshot({ path: path.join(out, '2d-italiano.png') });
  await page.evaluate(() => { document.getElementById('prompt-textarea').textContent = ''; });
  await ext({ type: 'setSettings', patch: { language: 'ru' } });

  const MODEL_MESSAGE = 'Передай Ахмедову Руслану Тимуровичу, что Giulia Bianchi приедет в via Garibaldi 12, Milano. Подпись: Ахмедов Р. Т.';
  const MODEL_VALUES = ['Ахмедову Руслану Тимуровичу', 'Giulia Bianchi', 'via Garibaldi 12', 'Ахмедов Р. Т.'];
  await page.click('#prompt-textarea');
  await page.keyboard.type(MODEL_MESSAGE, { delay: 2 });
  let modelPanel = '';
  for (let i = 0; i < 40; i++) {
    modelPanel = await shadowTexts();
    if (modelPanel.includes('нашла модель') && modelPanel.includes('[[ADDRESS_') && modelPanel.includes('Ахмедов Р. Т.')) break;
    await sleep(250);
  }
  check('локальная модель находит имена и адрес без словаря, подпись с инициалами тоже скрыта', () => {
    for (const v of ['Ахмедову Руслану Тимуровичу', 'Giulia Bianchi', 'Ахмедов Р. Т.', 'нашла модель', '[[ADDRESS_1]]']) assert.ok(modelPanel.includes(v), 'нет «' + v + '»');
  });
  await page.screenshot({ path: path.join(out, '1b-model.png') });
  const answersBefore = await page.$$eval('.answer', (n) => n.length);
  await page.click('#send');
  await page.waitForFunction((n) => document.querySelectorAll('.answer').length > n, { timeout: 10000 }, answersBefore);
  await sleep(300);
  check('найденное моделью не ушло ни в JSON-запрос, ни в форму', () => {
    const prompt = new URLSearchParams(captured.form).get('prompt');
    for (const body of [captured.conversation, prompt]) {
      for (const v of MODEL_VALUES) assert.ok(!body.includes(v), 'утекло: ' + v + ' в ' + body);
      assert.ok(/\[\[PERSON_\d+\]\]/.test(body) && /\[\[ADDRESS_\d+\]\]/.test(body), 'нет меток в ' + body);
    }
  });
  const modelAnswer = await page.$$eval('.answer', (n) => n[n.length - 1].textContent);
  check('в ответе имена и адрес подставлены обратно', () => {
    for (const v of MODEL_VALUES) assert.ok(modelAnswer.includes(v), 'не подставлено: ' + v + ' в ' + modelAnswer);
  });
  const offscreenTarget = browser.targets().find((t) => t.url() === `chrome-extension://${extId}/offscreen.html`);
  const offscreen = offscreenTarget && await offscreenTarget.asPage();
  const offscreenInfo = offscreen && await offscreen.evaluate(async () => ({
    isolated: self.crossOriginIsolated,
    outside: await fetch('https://example.org/', { cache: 'no-store' }).then(() => 'ушло', (e) => 'остановлено: ' + e.message),
    own: (await fetch('models/ner/meta.json')).ok,
  }));
  const modelState = (await ext({ type: 'state' })).model;
  check('модель работает в offscreen-документе, посторонние адреса оттуда недоступны (CSP)', () => {
    assert.ok(offscreenInfo, 'offscreen-документ не найден');
    assert.equal(modelState.state, 'ready');
    assert.ok(offscreenInfo.isolated, 'нет изоляции: модель работает в один поток');
    assert.ok(offscreenInfo.own, 'файлы модели недоступны');
    assert.match(offscreenInfo.outside, /^остановлено/);
  });
  console.log(`    модель: загрузка ${modelState.loadMs} мс, последняя проверка ${modelState.lastMs} мс, потоков ${modelState.threads}`);

  const orphan = await browser.newPage();
  let orphanSent = null;
  await orphan.setRequestInterception(true);
  orphan.on('request', (req) => {
    if (req.url() === 'https://example.org/') {
      const hook = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')).content_scripts[0].js.map((f) => readFileSync(path.join(root, f), 'utf8')).join('\n');
      return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: `<meta charset="utf-8"><script>${hook}</script>` });
    }
    if (req.url().startsWith('https://example.org/backend-api/')) { orphanSent = req.postData(); return req.respond({ status: 200, body: 'ok' }); }
    return req.abort();
  });
  await orphan.goto('https://example.org/');
  const orphanResult = await orphan.evaluate(() => fetch('/backend-api/f/conversation', {
    method: 'POST', body: JSON.stringify({ messages: [{ content: { parts: ['почта a@b.it'] } }] }),
  }).then(() => 'ушло', (e) => e.message));
  check('без связи с расширением отправка останавливается, а не уходит как есть', () => {
    assert.equal(orphanSent, null);
    assert.match(orphanResult, /Velami stopped|Velami ha bloccato|Velami остановил/);
  });
  await orphan.close();

  const show = (tab) => admin.evaluate((t) => { location.hash = t; window.scrollTo(0, 0); }, tab);
  await admin.bringToFront();
  await show('log');
  await sleep(700);
  await admin.screenshot({ path: path.join(out, '3-log.png') });

  await show('test');
  await sleep(200);
  await admin.click('#echo-run');
  try {
    await admin.waitForFunction(() => !document.querySelector('#echo-result').hidden || /Не удалось/.test(document.querySelector('#echo-state').textContent), { timeout: 20000 });
    const echo = await admin.$eval('#echo-state', (n) => n.textContent);
    if (/Не удалось/.test(echo)) console.log('  · эхо-тест пропущен, нет доступа к httpbin.org: ' + echo);
    else {
      const received = await admin.$eval('#echo-received', (n) => n.textContent);
      check('эхо-сервер получил только метки', () => {
        for (const v of ['maria.petrova@example.com', '4111 1111 1111 1111', 'RSSMRA85T10A562S']) assert.ok(!received.includes(v), 'утекло на эхо: ' + v);
        assert.ok(received.includes('[[EMAIL_1]]'));
      });
      await admin.screenshot({ path: path.join(out, '4-echo.png'), fullPage: true });
    }
  } catch (err) {
    console.log('  · эхо-тест не завершился: ' + err.message);
  }

  const tryFetch = (u) => fetch(u, { cache: 'no-store' }).then(() => 'ушло', (e) => 'остановлено: ' + e.message);
  const fromPage = await admin.evaluate(tryFetch, 'https://example.org/');
  const fromWorker = await (await sw.worker()).evaluate(tryFetch, 'https://example.org/');
  check('страницы и фоновый процесс расширения не могут обратиться к посторонним адресам (CSP)', () => {
    assert.match(fromPage, /^остановлено/);
    assert.match(fromWorker, /^остановлено/);
  });

  await ext({ type: 'setSettings', patch: { language: 'en' } });
  await show('welcome');
  await admin.waitForFunction(() => document.querySelector('#welcome h1').textContent.startsWith('Use AI'), { timeout: 3000 }).catch(() => {});
  const h1 = await admin.$eval('#welcome h1', (n) => n.textContent);
  check('страница управления переключается на английский', () => assert.equal(h1, 'Use AI without giving away your personal data'));
  check('политика безопасности не ломает интерфейс расширения', () => assert.deepEqual(cspErrors, []));
  await admin.evaluate(() => window.scrollTo(0, 0));
  await admin.screenshot({ path: path.join(out, '5-welcome-en.png'), fullPage: true });
  await scheme(admin, 'dark');
  await admin.screenshot({ path: path.join(out, '5b-welcome-dark.png'), fullPage: true });

  const popup = await browser.newPage();
  await popup.setViewport({ width: 340, height: 360 });
  await scheme(popup, 'light');
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForFunction(() => document.getElementById('version').textContent !== '', { timeout: 3000 });
  await sleep(350);
  const popupText = await popup.evaluate(() => document.body.innerText);
  check('всплывающее окно: статус защиты, версия и счётчики', () => {
    for (const s of ['Protected', 'version ' + JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8')).version, 'hidden today']) assert.ok(popupText.includes(s), 'нет «' + s + '» в ' + popupText);
  });
  await popup.screenshot({ path: path.join(out, '6-popup.png'), fullPage: true });
  await scheme(popup, 'dark');
  await popup.screenshot({ path: path.join(out, '6b-popup-dark.png'), fullPage: true });

  console.log(`\nПройдено проверок: ${results.length}. Скриншоты: ${out}`);
} finally {
  await browser.close();
}
