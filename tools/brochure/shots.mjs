// Снимки экранов для брошюры: настоящий Chrome с расширением, копия страницы чата, выдуманные данные.
// Возвращает пути к снимкам и то, что реально ушло бы в чат.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { STRINGS, serveChat } from '../demo/stage.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOCAL = {
  ru: { probe: 'Здравствуйте, меня зовут Иван Петров.', untick: 'Напомни позвонить Павлу Смирнову по номеру +7 916 765-43-21 завтра в 10.',
    phone: '+7 916 765-43-21', person: 'Ольга Соколова', panel: ['[[ADDRESS_1]]', '[[PERSON_1]]', '[[CARD_1]]'] },
  it: { probe: 'Ciao, mi chiamo Luca Bianchi.', untick: 'Ricordami di chiamare Luca Verdi al +39 347 765 4321 domani alle 10.',
    phone: '+39 347 765 4321', person: 'Giulia Bianchi', panel: ['[[ADDRESS_1]]', '[[PERSON_1]]', '[[IBAN_1]]'] },
  en: { probe: 'Hello, my name is James Miller.', untick: 'Remind me to call Paul Smith at +44 7700 900123 tomorrow at 10.',
    phone: '+44 7700 900123', person: 'Emily Watson', panel: ['[[ADDRESS_1]]', '[[PERSON_1]]', '[[IBAN_1]]'] },
};

// Выписка для кадра «чистая копия»: PDF с выдуманными данными. Владелец совпадает с именем из словаря.
// Телефон не тот, что в примере со снятой галочкой: то значение пользователь сам разрешил отправлять.
const STATEMENT = {
  ru: { name: 'выписка.pdf', title: 'Выписка по счёту', holder: 'Владелец счёта', mail: 'Почта', phone: 'телефон', card: 'Карта', balance: 'Остаток', sum: '125 400,00 ₽',
    email: 'olga.sokolova@example.com', tel: '+7 916 123-45-67', page2: 'Страница 2: операций за период нет.' },
  it: { name: 'estratto.pdf', title: 'Estratto conto', holder: 'Intestatario', mail: 'Email', phone: 'telefono', card: 'Carta', balance: 'Saldo', sum: '1.250,50 EUR',
    email: 'giulia.bianchi@example.com', tel: '+39 347 123 4567', iban: 'IT60 X054 2811 1010 0000 0123 456', page2: 'Pagina 2: nessun movimento nel periodo.' },
  en: { name: 'statement.pdf', title: 'Account statement', holder: 'Account holder', mail: 'Email', phone: 'phone', card: 'Card', balance: 'Balance', sum: '1,250.50 GBP',
    email: 'emily.watson@example.com', tel: '+44 7700 900456', iban: 'GB82 WEST 1234 5698 7654 32', page2: 'Page 2: no transactions in the period.' },
};
const CARD = '4111 1111 1111 1111';
const statementHtml = (d, person) => `<!doctype html><meta charset="utf-8"><body style="font:15px Helvetica, Arial, sans-serif;margin:48px;color:#1d1d1f">
<h1 style="font-size:30px;margin:0 0 22px">${d.title}</h1>
<p>${d.holder}: ${person}.</p>
<p>${d.mail} ${d.email}, ${d.phone} ${d.tel}.</p>
<table border="1" cellpadding="8" style="border-collapse:collapse;margin-top:18px">
${d.iban ? `<tr><td>IBAN</td><td>${d.iban}</td></tr>` : ''}<tr><td>${d.card}</td><td>${CARD}</td></tr><tr><td>${d.balance}</td><td>${d.sum}</td></tr></table>
<div style="page-break-before:always"><p>${d.page2}</p></div></body>`;

export async function captureShots({ extDir, out, lang }) {
  const S = STRINGS[lang];
  const L = LOCAL[lang];
  const W = 1280, H = 800;
  const shots = {};
  const browser = await puppeteer.launch({
    headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, `--window-size=${W},${H}`, '--lang=' + lang],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
  });
  const scheme = async (page, value) => { await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value }]); await sleep(400); };
  const snap = async (page, name, opts = {}) => {
    const file = path.join(out, name + '.png');
    await page.screenshot({ path: file, ...opts });
    shots[name] = file;
  };

  try {
    const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
    const extId = new URL(sw.url()).host;
    const admin = await browser.newPage();
    await scheme(admin, 'light');
    await admin.goto(`chrome-extension://${extId}/dashboard.html#welcome`);
    const ext = (msg) => admin.evaluate((m) => chrome.runtime.sendMessage(m), msg);
    await ext({ type: 'setSettings', patch: { language: lang, dictionary: [], exclusions: [] } });
    await ext({ type: 'modelProbe', text: L.probe });

    const chat = await browser.newPage();
    await scheme(chat, 'light');
    const sent = await serveChat(chat, lang);
    await chat.goto('https://chatgpt.com/', { waitUntil: 'load' });
    await chat.waitForSelector('[data-pg-gateway]', { timeout: 5000 });
    const cdp = await chat.createCDPSession();
    const tree = async () => (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })).root;
    const kids = (n) => [...(n.children || []), ...(n.shadowRoots || [])];
    const textOf = (n) => (n.nodeType === 3 ? n.nodeValue : kids(n).map(textOf).join(' '));
    const pageText = async () => textOf(await tree());
    const waitText = async (needles, tries = 60) => {
      let t = '';
      for (let i = 0; i < tries; i++) { t = await pageText(); if (needles.every((s) => t.includes(s))) return t; await sleep(250); }
      throw new Error('на странице нет: ' + needles.filter((s) => !t.includes(s)).join(', '));
    };
    // Панель живёт в закрытом Shadow DOM, поэтому галочку находим через CDP с pierce.
    const clickFinding = async (value) => {
      let input = null;
      (function walk(n) {
        if (input) return;
        if (n.nodeName === 'LI' && textOf(n).includes(value)) input = kids(n).find((c) => c.nodeName === 'INPUT');
        kids(n).forEach(walk);
      })(await tree());
      if (!input) throw new Error('в панели нет строки ' + value);
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId: input.nodeId });
      const [x1, y1, , , x3, y3] = model.content;
      await chat.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
    };

    const boxOf = async (cls) => {
      let node = null;
      (function walk(n) {
        if (node) return;
        const attrs = n.attributes || [];
        for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === 'class' && attrs[i + 1].split(' ').includes(cls)) node = n;
        kids(n).forEach(walk);
      })(await tree());
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId });
      const [x1, y1, , , x3, y3] = model.border;
      return { x: x1, y: y1, width: x3 - x1, height: y3 - y1 };
    };
    const around = (b, pad, top = pad) => ({ x: b.x - pad, y: b.y - top, width: b.width + pad * 2, height: b.height + top + pad });

    await chat.click('#prompt-textarea');
    await chat.keyboard.type(S.message, { delay: 1 });
    const panelText = await waitText(L.panel);
    await sleep(500);
    await snap(chat, 'panel');
    const card = await boxOf('card');
    const pill = await boxOf('pill');
    const panelClip = { x: card.x - 24, y: card.y - 24, width: card.width + 40, height: pill.y + pill.height - card.y + 44 };
    await snap(chat, 'panel-crop', { clip: panelClip });
    await scheme(chat, 'dark');
    await snap(chat, 'panel-dark', { clip: panelClip });
    const alone = await chat.addStyleTag({ content: 'html, body { background: transparent !important } body > :not([data-pg-gateway]) { visibility: hidden !important }' });
    await sleep(200);
    await snap(chat, 'panel-dark-alpha', { clip: panelClip, omitBackground: true });
    await scheme(chat, 'light');
    await snap(chat, 'panel-alpha', { clip: panelClip, omitBackground: true });
    await alone.evaluate((n) => n.remove());

    await chat.click('#send');
    await chat.waitForSelector('.msg.bot', { timeout: 10000 });
    await sleep(800);
    for (const v of S.secrets) if (!sent.prompt || sent.prompt.includes(v)) throw new Error('в запрос ушло: ' + v);
    await snap(chat, 'answer', { clip: { x: 20, y: 60, width: 860, height: 440 } });
    await scheme(chat, 'dark');
    await snap(chat, 'answer-dark', { clip: { x: 20, y: 60, width: 860, height: 440 } });
    await scheme(chat, 'light');
    const pos = await chat.evaluate((needle) => {
      const walker = document.createTreeWalker(document.querySelector('.msg.bot'), NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.nodeValue.indexOf(needle);
        if (i >= 0) { const r = new Range(); r.setStart(n, i); r.setEnd(n, i + 6); const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }
      }
      return null;
    }, S.hoverValue);
    await chat.mouse.move(pos[0], pos[1]);
    await sleep(500);
    await snap(chat, 'tooltip', { clip: { x: Math.max(0, pos[0] - 360), y: Math.max(0, pos[1] - 150), width: 720, height: 230 } });
    await chat.mouse.move(5, 5);

    await chat.click('#prompt-textarea');
    await chat.keyboard.type(L.untick, { delay: 1 });
    await waitText([L.phone, '[[PHONE_']);
    await sleep(500);
    await clickFinding(L.phone);
    await sleep(600);
    { const c = await boxOf('card'); const p = await boxOf('pill'); await snap(chat, 'untick', { clip: { x: c.x - 24, y: c.y - 24, width: c.width + 40, height: p.y + p.height - c.y + 44 } }); }
    await chat.evaluate(() => { document.getElementById('prompt-textarea').textContent = ''; document.getElementById('prompt-textarea').dispatchEvent(new InputEvent('input', { bubbles: true })); });
    await sleep(400);

    const filePath = path.join(out, S.file.name);
    writeFileSync(filePath, S.file.text);
    await ext({ type: 'setSettings', patch: { rehydrate: false } });
    await sleep(300);
    await (await chat.$('#file')).uploadFile(filePath);
    await chat.waitForSelector('.msg.file', { timeout: 8000 });
    await chat.evaluate(() => document.querySelector('.msg.file').scrollIntoView({ block: 'center' }));
    await sleep(700);
    if (!sent.file || sent.file.includes('@example.com')) throw new Error('файл ушёл без очистки');
    await snap(chat, 'file');
    await ext({ type: 'setSettings', patch: { rehydrate: true } });
    await sleep(4000);

    const bare = await chat.addStyleTag({ content: 'body > :not([data-pg-gateway]) { visibility: hidden !important }' });
    await ext({ type: 'setSettings', patch: { enabled: false } });
    await sleep(600);
    await snap(chat, 'pill-off', { clip: around(await boxOf('pill'), 28, 10) });
    await ext({ type: 'setSettings', patch: { enabled: true } });
    await sleep(600);
    await snap(chat, 'pill-on', { clip: around(await boxOf('pill'), 28, 10) });
    await bare.evaluate((n) => n.remove());

    const popup = await browser.newPage();
    await popup.setViewport({ width: 340, height: 360, deviceScaleFactor: 2 });
    await scheme(popup, 'light');
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.waitForFunction(() => document.getElementById('version').textContent !== '');
    await sleep(500);
    await snap(popup, 'popup', { fullPage: true });
    await scheme(popup, 'dark');
    await snap(popup, 'popup-dark', { fullPage: true });

    const show = async (tab) => { await admin.evaluate((t) => { location.hash = t; window.scrollTo(0, 0); }, tab); await sleep(700); };
    await ext({ type: 'setSettings', patch: { dictionary: [{ term: S.dictTerm, type: 'ORG' }, { term: L.person, type: 'PERSON' }] } });
    await admin.bringToFront();
    await admin.reload();
    await sleep(800);
    await show('welcome');
    await snap(admin, 'welcome');
    await snap(admin, 'welcome-full', { fullPage: true });
    await admin.evaluate(() => document.querySelector('#welcome h2').scrollIntoView({ block: 'start' }));
    await sleep(300);
    await snap(admin, 'hides');
    await show('dict');
    await snap(admin, 'dict');
    await show('log');
    await admin.click('#log-list details summary');
    await sleep(300);
    await snap(admin, 'log');
    await scheme(admin, 'dark');
    await snap(admin, 'log-dark');
    await scheme(admin, 'light');
    await show('test');
    await admin.addStyleTag({ content: '#echo-ip, #echo-result details { display: none !important }' });
    await admin.click('#echo-run');
    await admin.waitForFunction(() => !document.querySelector('#echo-result').hidden || /:/.test(document.querySelector('#echo-state').textContent), { timeout: 20000 });
    const echoChecks = await admin.$eval('#echo-checks', (n) => [...n.children].map((li) => li.className + ': ' + li.textContent));
    const echoH = await admin.evaluate(() => document.querySelector('#test').getBoundingClientRect().bottom + 24);
    await snap(admin, 'echo', { clip: { x: 220, y: 0, width: 1060, height: echoH }, captureBeyondViewport: true });
    await show('vault');
    await admin.click('#vault-reveal');
    await sleep(300);
    await snap(admin, 'vault');
    await show('verify');
    await snap(admin, 'verify', { fullPage: true });
    await scheme(admin, 'dark');
    await show('welcome');
    await snap(admin, 'welcome-dark');

    /* Чистая копия PDF: выписка прикладывается к чату, из окна Velami открывается предпросмотр копии.
       Файл сайту не уходит: после снимка выбор отменяется. Кадр снимается последним, чтобы окно и
       запись об отмене не попали в остальные снимки. */
    const D = STATEMENT[lang];
    const maker = await browser.newPage();
    await maker.setContent(statementHtml(D, L.person), { waitUntil: 'load' });
    const pdfPath = path.join(out, D.name);
    writeFileSync(pdfPath, await maker.pdf({ format: 'A4' }));
    await maker.close();
    const clickNode = async (node) => {
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId });
      const [x1, y1, , , x3, y3] = model.content;
      await chat.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
    };
    const has = (n, name) => { const a = n.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === name) return true; return false; };
    const byClass = (n, cls) => { const a = n.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === 'class' && a[i + 1].split(' ').includes(cls)) return true; return false; };
    const findNode = (n, test) => { if (test(n)) return n; for (const c of kids(n)) { const r = findNode(c, test); if (r) return r; } return null; };
    const askParts = async () => {
      const ask = findNode(await tree(), (n) => byClass(n, 'ask'));
      if (!ask || has(ask, 'hidden')) return null;
      const more = findNode(ask, (n) => byClass(n, 'ask-more'));
      const btns = findNode(ask, (n) => byClass(n, 'btns'));
      return more && !has(more, 'hidden') && btns ? { more, cancel: kids(btns).find((c) => c.nodeName === 'BUTTON') } : null;
    };
    await scheme(chat, 'light');
    await chat.bringToFront();
    const before = sent.file;
    await chat.evaluate(() => { document.getElementById('file').value = ''; });
    await (await chat.$('#file')).uploadFile(pdfPath);
    let parts = null;
    for (let i = 0; i < 240 && !parts; i++) { parts = await askParts(); if (!parts) await sleep(250); }
    if (!parts) throw new Error('окно Velami с предпросмотром копии не появилось для ' + D.name);
    const opened = browser.waitForTarget((t) => t.url().includes('/preview.html#'), { timeout: 120000 });
    await clickNode(parts.more);
    const tab = await (await opened).page();
    await tab.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
    await scheme(tab, 'light');
    await tab.waitForSelector('#facts:not([hidden])', { timeout: 60000 });
    await tab.waitForSelector('#sheets canvas', { timeout: 60000 });
    await sleep(1200);
    const copyText = await tab.evaluate(() => document.body.innerText);
    for (const v of [L.person, D.email, D.tel, D.iban, CARD].filter(Boolean)) if (copyText.includes(v)) throw new Error('в чистой копии осталось: ' + v);
    await snap(tab, 'copy');
    await tab.click('#back');
    for (let i = 0; i < 40 && !tab.isClosed(); i++) await sleep(100);
    await chat.bringToFront();
    parts = await askParts();
    if (parts && parts.cancel) await clickNode(parts.cancel);
    await sleep(500);
    if (sent.file !== before) throw new Error('файл ушёл на сайт, хотя выбор отменён');

    return { shots, prompt: sent.prompt, message: S.message, panelText, echoChecks, copyText };
  } finally {
    await browser.close();
  }
}
