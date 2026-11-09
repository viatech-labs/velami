// Демо-ролик Velami с субтитрами: настоящий Chrome с расширением, копия страницы чата, выдуманные данные.
// node tools/demo/record.mjs [--lang ru|it] [папка расширения] -> dist/demo/velami-demo-<lang>.mp4 и .srt
// Нужен ffmpeg с libx264. Субтитры вшиты в кадр и продублированы отдельной дорожкой.
import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURSOR, MARK_SVG, STRINGS, serveChat } from './stage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const li = argv.indexOf('--lang');
const lang = li >= 0 ? argv.splice(li, 2)[1] : 'ru';
if (!STRINGS[lang]) throw new Error('язык ролика: ru или it');
const extDir = path.resolve(argv[0] || root);
const out = path.join(root, 'dist', 'demo');
const work = path.join(out, 'work-' + lang);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const SAY = {
  ru: {
    title: ['Приватные чаты с ИИ', 'Демонстрация на тестовой копии страницы чата. Все данные выдуманы.'],
    end: ['Без серверов и аккаунтов. Всё остаётся на вашем компьютере.', 'Разработано в Via-Tech · via-tech.org · info@via-tech.org', 'Версия {v}'],
    intro: 'Это Velami, расширение для Chrome. Оно скрывает личные данные до того, как они уйдут в ChatGPT или Claude.',
    type: 'Пишем как обычно: имя, адрес, номер карты и почту.',
    panel: 'Рядом появляется панель «Что увидит модель». Вместо личных данных в ней метки.',
    model: 'Имя и адрес нашла нейросеть, которая работает прямо на компьютере. Карту и почту нашли правила.',
    send: 'Отправляем. В запрос к ИИ уходят только метки.',
    answer: 'ИИ отвечает с метками, а Velami подставляет настоящие значения. Только на вашем экране.',
    hover: 'Наведите на значение, и видно, какую метку на самом деле получил ИИ.',
    file: 'Текстовые файлы тоже очищаются: сайт получает копию с метками.',
    popup: 'Иконка расширения показывает, включена ли защита и сколько данных скрыто сегодня.',
    popup2: 'Здесь же включаются подстановка настоящих значений и локальная модель.',
    welcome: 'На странице «Начало» список всего, что скрывает Velami.',
    dict: 'В «Мой словарь» добавьте то, что знаете только вы: компанию, клиента, проект.',
    dict2: 'С этого момента это слово скрывается в каждом сообщении, в любом падеже.',
    log: 'В журнале точное тело каждого запроса и его SHA-256, чтобы сверить с DevTools.',
    test: '«Проверь меня сам» отправляет пример на независимый эхо-сервер httpbin.org.',
    test2: 'Сервер получил только метки. По каждому значению видно, что оно до сервера не дошло.',
    vault: 'Соответствие меток и значений хранится только в этом браузере.',
    verify: 'А здесь написано, как проверить всё самому, не веря нам на слово.',
  },
  it: {
    title: ['Chat private con l’IA', 'Dimostrazione su una copia di prova della chat. Tutti i dati sono inventati.'],
    end: ['Nessun server, nessun account. Tutto resta sul tuo computer.', 'Realizzato da Via-Tech · via-tech.org · info@via-tech.org', 'Versione {v}'],
    intro: 'Questo è Velami, un’estensione per Chrome. Nasconde i dati personali prima che arrivino a ChatGPT o Claude.',
    type: 'Scrivi come sempre: nome, indirizzo, carta, IBAN ed e-mail.',
    panel: 'Accanto alla chat compare il pannello “Cosa vedrà il modello”. Al posto dei dati ci sono etichette.',
    model: 'Nome e indirizzo li trova un modello di IA che gira sul tuo computer. Carta, IBAN ed e-mail li trovano regole precise.',
    send: 'Invii. Alla chat arrivano solo le etichette.',
    answer: 'L’IA risponde con le etichette e Velami rimette i valori veri. Solo sul tuo schermo.',
    hover: 'Passa il mouse su un valore e vedi quale etichetta ha ricevuto davvero l’IA.',
    file: 'Anche i file di testo vengono ripuliti: il sito riceve una copia con le etichette.',
    popup: 'L’icona dell’estensione mostra se la protezione è attiva e quanti dati sono stati nascosti oggi.',
    popup2: 'Da qui accendi il ripristino dei valori veri e il modello locale.',
    welcome: 'Nella pagina Inizio c’è l’elenco di tutto quello che Velami nasconde.',
    dict: 'In “Il mio dizionario” aggiungi quello che conosci solo tu: la tua azienda, un cliente, un progetto.',
    dict2: 'Da ora quel nome viene nascosto in ogni messaggio.',
    log: 'Il registro conserva il corpo esatto di ogni richiesta e il suo SHA-256, da confrontare con DevTools.',
    test: '“Mettimi alla prova” invia un esempio a un server eco indipendente, httpbin.org.',
    test2: 'Il server ha ricevuto solo etichette. Per ogni valore vedi che non è arrivato.',
    vault: 'L’associazione tra etichette e valori resta solo in questo browser.',
    verify: 'E qui trovi come verificare tutto da solo, senza fidarti di noi.',
  },
}[lang];
const S = STRINGS[lang];

const W = 1280, H = 800, BAND = 120, FPS = 30;
const BG = '#1d1d1f';
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const duration = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());

const cues = [];
let segment = null;
function say(text) {
  const t = (Date.now() - segment.start) / 1000;
  const prev = cues[cues.length - 1];
  if (prev && prev.segment === segment.name && prev.end == null) prev.end = t;
  cues.push({ segment: segment.name, start: t, end: null, text });
}
function quiet() {
  const prev = cues[cues.length - 1];
  if (prev && prev.segment === segment.name && prev.end == null) prev.end = (Date.now() - segment.start) / 1000;
}
// Время показа субтитра от длины фразы: около 15 знаков в секунду, не меньше 3,5 с.
const readMs = (text) => Math.max(3500, text.length * 66);
async function line(text, extra = 0) { say(text); await sleep(readMs(text) + extra); }

const light = (page) => page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

async function record(page, name, fn) {
  const file = path.join(work, name + '.webm');
  await page.bringToFront();
  const recorder = await page.screencast({ path: file });
  segment = { name, start: Date.now() };
  await sleep(300);
  await fn();
  quiet();
  await sleep(400);
  await recorder.stop();
  return file;
}

async function glide(page, x, y, steps = 25) {
  await page.mouse.move(x, y, { steps });
  await sleep(150);
}
async function center(page, selector) {
  const b = await (await page.waitForSelector(selector)).boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
}
async function clickOn(page, selector, dx = 0) {
  const [x, y] = await center(page, selector);
  await glide(page, x + dx, y);
  await page.mouse.click(x + dx, y);
}

const browser = await puppeteer.launch({
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, `--window-size=${W},${H}`, '--lang=' + lang],
  defaultViewport: { width: W, height: H },
});

try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const admin = await browser.newPage();
  await admin.goto(`chrome-extension://${extId}/dashboard.html#welcome`);
  const ext = (msg) => admin.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const version = await admin.evaluate(() => chrome.runtime.getManifest().version);
  await ext({ type: 'setSettings', patch: { language: lang, dictionary: [] } });
  await ext({ type: 'modelProbe', text: lang === 'it' ? 'Ciao, mi chiamo Luca Bianchi.' : 'Привет, меня зовут Иван Петров.' });

  const chat = await browser.newPage();
  await light(chat);
  await chat.evaluateOnNewDocument(CURSOR);
  const sent = await serveChat(chat, lang);
  await chat.goto('https://chatgpt.com/', { waitUntil: 'load' });
  await chat.waitForSelector('[data-pg-gateway]', { timeout: 5000 });
  const cdp = await chat.createCDPSession();
  const pageText = async () => {
    const { root: d } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const acc = [];
    (function walk(n) { if (n.nodeType === 3) acc.push(n.nodeValue); for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) walk(c); })(d);
    return acc.join(' ');
  };
  const filePath = path.join(work, S.file.name);
  writeFileSync(filePath, S.file.text);

  const chatClip = await record(chat, '1-chat', async () => {
    await glide(chat, 640, 300, 1);
    await line(SAY.intro);
    const [ex, ey] = await center(chat, '#prompt-textarea');
    await glide(chat, ex - 250, ey);
    await chat.mouse.click(ex - 250, ey);
    say(SAY.type);
    await chat.keyboard.type(S.message, { delay: 26 });
    for (let i = 0; i < 40 && !(await pageText()).includes('[[ADDRESS_1]]'); i++) await sleep(250);
    await glide(chat, 1060, 380);
    await line(SAY.panel);
    await line(SAY.model);
    const [sx, sy] = await center(chat, '#send');
    await glide(chat, sx, sy);
    say(SAY.send);
    await sleep(1500);
    await chat.mouse.click(sx, sy);
    await chat.waitForSelector('.msg.bot', { timeout: 10000 });
    await sleep(readMs(SAY.send) - 1500);
    await line(SAY.answer);
    const pos = await chat.evaluate((needle) => {
      const bot = document.querySelector('.msg.bot');
      const walker = document.createTreeWalker(bot, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.nodeValue.indexOf(needle);
        if (i >= 0) { const r = new Range(); r.setStart(n, i); r.setEnd(n, i + 6); const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }
      }
      return null;
    }, S.hoverValue);
    if (!pos) throw new Error('в ответе нет подставленного значения ' + S.hoverValue);
    await glide(chat, pos[0], pos[1]);
    await line(SAY.hover);
    await glide(chat, 600, 120);
    const [ax, ay] = await center(chat, '.attach');
    await glide(chat, ax, ay);
    say(SAY.file);
    await (await chat.$('#file')).uploadFile(filePath);
    await chat.waitForSelector('.msg.file', { timeout: 8000 });
    await chat.evaluate(() => document.querySelector('.msg.file').scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await sleep(readMs(SAY.file) + 1500);
  });
  for (const v of S.secrets) if (!sent.prompt || sent.prompt.includes(v)) throw new Error('в запрос ушло: ' + v);
  if (!sent.file || /@example\.com/.test(sent.file)) throw new Error('файл ушёл без очистки: ' + sent.file);

  const popup = await browser.newPage();
  await light(popup);
  await popup.evaluateOnNewDocument(CURSOR);
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.addStyleTag({ content: `html { min-height: 100%; background: #e5e5ea; } body { margin: 34px auto 0; zoom: 1.4; border-radius: 12px; background: var(--bg); box-shadow: 0 0 0 .5px rgba(0,0,0,.12), 0 24px 60px -12px rgba(0,0,0,.3); overflow: hidden; }` });
  await popup.waitForFunction(() => document.getElementById('version').textContent !== '');
  const popupClip = await record(popup, '2-popup', async () => {
    await glide(popup, 640, 220, 1);
    await line(SAY.popup);
    await clickOn(popup, '#rehydrate');
    await sleep(900);
    await popup.mouse.click(...(await center(popup, '#rehydrate')));
    await glide(popup, ...(await center(popup, '#model')));
    await line(SAY.popup2);
  });

  const dash = await browser.newPage();
  await light(dash);
  await dash.evaluateOnNewDocument(CURSOR);
  await dash.goto(`chrome-extension://${extId}/dashboard.html#welcome`);
  await dash.addStyleTag({ content: '#echo-ip, #echo-raw, #echo-result details { display: none !important } html { scroll-behavior: smooth; }' });
  await dash.waitForSelector('#hides .hide-group');
  const scrollTo = (sel) => dash.evaluate((s) => document.querySelector(s).scrollIntoView({ behavior: 'smooth', block: 'start' }), sel);
  const dashClip = await record(dash, '3-dashboard', async () => {
    await glide(dash, 700, 300, 1);
    say(SAY.welcome);
    await sleep(1200);
    await scrollTo('#welcome h2');
    await sleep(readMs(SAY.welcome) + 800);
    await dash.evaluate(() => window.scrollTo({ top: 0 }));

    await clickOn(dash, 'nav a[href="#dict"]');
    say(SAY.dict);
    await sleep(800);
    await clickOn(dash, '#dict-add input[name="term"]');
    await dash.keyboard.type(S.dictTerm, { delay: 60 });
    await dash.select('#dict-add select[name="type"]', 'ORG');
    await sleep(readMs(SAY.dict) - 1500);
    await clickOn(dash, '#dict-add button');
    await line(SAY.dict2);

    await clickOn(dash, 'nav a[href="#log"]');
    say(SAY.log);
    await dash.waitForSelector('#log-list details summary');
    await sleep(1500);
    await clickOn(dash, '#log-list details summary', -150);
    await sleep(readMs(SAY.log));

    await clickOn(dash, 'nav a[href="#test"]');
    say(SAY.test);
    await sleep(1500);
    await clickOn(dash, '#echo-run');
    await dash.waitForFunction(() => !document.querySelector('#echo-result').hidden || /:/.test(document.querySelector('#echo-state').textContent), { timeout: 20000 });
    if (await dash.$eval('#echo-result', (n) => n.hidden)) throw new Error('эхо-сервер недоступен: ' + await dash.$eval('#echo-state', (n) => n.textContent));
    await sleep(Math.max(0, readMs(SAY.test) - 3000));
    say(SAY.test2);
    await sleep(1200);
    await dash.evaluate(() => document.querySelector('#echo-checks').scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await sleep(readMs(SAY.test2));

    await dash.evaluate(() => window.scrollTo({ top: 0 }));
    await clickOn(dash, 'nav a[href="#vault"]');
    say(SAY.vault);
    await sleep(1200);
    await clickOn(dash, '#vault-reveal');
    await sleep(readMs(SAY.vault));

    await clickOn(dash, 'nav a[href="#verify"]');
    await line(SAY.verify, 800);
  });

  const card = await browser.newPage();
  const cardHtml = (title, lines) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:${W}px;height:${H}px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:${BG};color:#fff;font-family:${FONT};-webkit-font-smoothing:antialiased">
    ${MARK_SVG(96)}
    <div style="font:700 72px/1.1 ${FONT};letter-spacing:-.035em;margin-top:22px">${title}</div>
    ${lines.map((l, i) => `<div style="font-size:${i ? 22 : 32}px;font-weight:${i ? 400 : 500};letter-spacing:-.01em;color:${i ? '#98989d' : '#f5f5f7'};margin-top:${i ? 12 : 14}px">${l}</div>`).join('')}</body>`;
  const shot = async (html, file, size = { width: W, height: H }) => {
    await card.setViewport(size);
    await card.setContent(html);
    await card.screenshot({ path: file });
    return file;
  };
  const titlePng = await shot(cardHtml('Velami', SAY.title), path.join(work, 'title.png'));
  const endPng = await shot(cardHtml('Velami', SAY.end.map((l) => l.replace('{v}', version))), path.join(work, 'end.png'));

  const still = (png, seconds, name) => {
    const f = path.join(work, name + '.mp4');
    ffmpeg('-loop', '1', '-t', String(seconds), '-i', png, '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-crf', '18', f);
    return f;
  };
  const clip = (webm, name) => {
    const f = path.join(work, name + '.mp4');
    ffmpeg('-i', webm, '-vf', `fps=${FPS},scale=${W}:${H},format=yuv420p`, '-c:v', 'libx264', '-crf', '18', f);
    return f;
  };
  const pieces = [
    { file: still(titlePng, 4, '0-title') },
    { file: clip(chatClip, '1-chat'), segment: '1-chat' },
    { file: clip(popupClip, '2-popup'), segment: '2-popup' },
    { file: clip(dashClip, '3-dashboard'), segment: '3-dashboard' },
    { file: still(endPng, 4, '4-end') },
  ];

  let offset = 0;
  const timeline = [];
  for (const p of pieces) {
    const d = duration(p.file);
    for (const c of cues.filter((c) => c.segment === p.segment)) {
      timeline.push({ start: offset + c.start, end: offset + Math.min(c.end ?? d, d), text: c.text });
    }
    offset += d;
  }

  const list = path.join(work, 'list.txt');
  writeFileSync(list, pieces.map((p) => `file '${p.file}'`).join('\n'));
  const joined = path.join(work, 'joined.mp4');
  ffmpeg('-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined);

  const captionHtml = (text) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:${W}px;height:${BAND}px;display:flex;align-items:center;justify-content:center;background:${BG}">
    <div style="max-width:1120px;text-align:center;color:#f5f5f7;font:500 27px/1.35 ${FONT};letter-spacing:-.01em">${text}</div></body>`;
  const inputs = [];
  let graph = `[0:v]pad=${W}:${H + BAND}:0:0:color=${BG}[v0]`;
  for (const [i, c] of timeline.entries()) {
    inputs.push('-i', await shot(captionHtml(c.text), path.join(work, `cap-${i}.png`), { width: W, height: BAND }));
    graph += `;[v${i}][${i + 1}:v]overlay=0:${H}:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'[v${i + 1}]`;
  }
  const burned = path.join(work, 'burned.mp4');
  ffmpeg('-i', joined, ...inputs, '-filter_complex', graph, '-map', `[v${timeline.length}]`, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', burned);

  const stamp = (s) => {
    const ms = Math.round(s * 1000);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  const srt = path.join(out, `velami-demo-${lang}.srt`);
  writeFileSync(srt, timeline.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
  const final = path.join(out, `velami-demo-${lang}.mp4`);
  ffmpeg('-i', burned, '-i', srt, '-map', '0:v', '-map', '1:s', '-c:v', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=' + (lang === 'it' ? 'ita' : 'rus'), '-movflags', '+faststart', final);
  console.log(`${final}  ${duration(final).toFixed(1)} s, ${timeline.length} subtitles`);
  console.log(srt);
} finally {
  await browser.close();
}
