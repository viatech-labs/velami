// Живой прогон на настоящих сайтах из QA-профиля (tools/qa-login.mjs). Только выдуманные значения.
// Запуск: node tools/qa-live.mjs [chatgpt claude ...] [--cases text-it,pdf,...]
//         PG_EXT_DIR=<распакованный zip> node tools/qa-live.mjs   — проверка собранного пакета
// Что проверяется в каждом случае: тела HTTP-запросов (включая загрузки файлов) и кадры WebSocket
// без настоящих значений, журнал Velami без тревог, ответ с настоящими значениями и без меток,
// буфер после кнопки «Копировать» сайта. Итог: test/artifacts/live/report.json и report.md.
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
const DEFAULT_SITES = ['chatgpt', 'claude', 'perplexity', 'deepseek', 'mistral', 'gemini'];
const START = { claude: 'https://claude.ai/new' };
const argOf = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--cases');
const sites = positional.length ? positional : DEFAULT_SITES;

const IT = {
  name: 'Mario Rossi', email: 'mario.rossi@example.com', card: '4111 1111 1111 1111',
  iban: 'IT60 X054 2811 1010 0000 0123 456', cf: 'RSSMRA85T10A562S', phone: '+39 347 123 4567',
};
const RU = {
  name: 'Анна Сергеевна Миронова', phone: '8 (916) 123-45-67', dob: '12.03.1985', passport: '4510 123456',
  // Выдуманный ключ собирается из частей, чтобы сканер секретов в репозитории не принимал его за настоящий.
  plate: 'А123ВС77', email: 'anna.mironova@example.com', key: ['sk', 'proj', 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z'].join('-'),
};
const TXT = path.join(out, 'nota.txt');
writeFileSync(TXT, `Promemoria: scrivere a ${IT.email} entro venerdì.`);

/* Случай: как передать данные, какую кнопку нажать в окне Velami, что должно и не должно уйти.
   expectSent: false значит, что сайт не должен получить ни файла, ни сообщения. */
const CASES = {
  'text-it': {
    message: `Sono ${IT.name}, codice fiscale ${IT.cf}, telefono ${IT.phone}, email ${IT.email}, carta ${IT.card}, IBAN ${IT.iban}. Scrivi una breve mail alla banca con questi dati.`,
    secrets: Object.values(IT), shown: [IT.name],
    followup: { message: 'Ripeti solo il mio IBAN e il mio codice fiscale, senza altro testo.', shown: [IT.iban, IT.cf] },
    copy: true,
  },
  'text-ru': {
    message: `Меня зовут ${RU.name}, родилась ${RU.dob}, паспорт ${RU.passport}, телефон ${RU.phone}, почта ${RU.email}, машина ${RU.plate}. Ключ API ${RU.key}. Составь короткое заявление в страховую с этими данными.`,
    secrets: Object.values(RU), shown: ['Миронова'], copy: true,
  },
  pdf: { file: 'relazione-lunga.pdf', press: 'clean', message: 'Chi firma il documento allegato? Rispondi con il nome completo.', secrets: ['Luca Bianchi'], shown: ['Luca Bianchi'] },
  docx: { file: 'richiesta.docx', press: 'clean', message: 'Riassumi il documento allegato in due righe, con il nome del cliente.', secrets: [IT.name, IT.email, IT.iban, IT.cf, IT.card], shown: [IT.name] },
  xlsx: { file: 'clienti.xlsx', press: 'clean', message: 'Quanti clienti ci sono nel file allegato e come si chiamano?', secrets: [IT.name, IT.email, IT.iban, 'Giulia Bianchi', 'giulia.bianchi@example.com'], shown: [IT.name] },
  pptx: { file: 'presentazione.pptx', press: 'clean', message: 'Chi è il cliente nella presentazione allegata e qual è il suo contatto?', secrets: [IT.name, IT.email], shown: [IT.name] },
  txt: { file: TXT, message: 'A chi devo scrivere secondo la nota allegata? Rispondi con l’indirizzo.', secrets: [IT.email], shown: [IT.email] },
  drop: { file: 'richiesta.docx', via: 'drop', press: 'clean', message: 'Riassumi il documento allegato in una riga.', secrets: [IT.name, IT.email, IT.iban, IT.cf], shown: [] },
  paste: { file: 'clienti.xlsx', via: 'paste', press: 'clean', message: 'Quante righe ha la tabella allegata?', secrets: [IT.name, IT.email, IT.iban], shown: [] },
  scan: { file: 'scansione.pdf', press: 'cancel', expectSent: false, dialog: /scansione\.pdf/ },
  cancel: { file: 'estratto.pdf', press: 'cancel', expectSent: false, secrets: [IT.name, IT.email, IT.iban, IT.cf, IT.card] },
  original: { file: 'estratto.pdf', press: 'original', expectOriginal: true },
};
const cases = (argOf('--cases') || Object.keys(CASES).join(',')).split(',');
const BUTTONS = {
  clean: /^(Invia copia pulita|Send clean copy|Отправить чистую копию)$/,
  original: /^(Invia l’originale|Send original|Отправить оригинал)$/,
  cancel: /^(Annulla|Cancel|Отмена)$/,
};
const LIMIT_REACHED = /Досягнуто ліміт повідомлень|Ви досягли ліміту повідомлень|Вы достигли лимита|You've reached (your|the) (message )?limit|You have reached (your|the) (message )?limit|Hai raggiunto il limite|limite di messaggi raggiunto|Message limit reached/i;
const TOKEN = /\[\[[A-Z_]+_\d+\]\]|(?<![A-Za-z0-9_])\[?(PERSON|EMAIL|CARD|IBAN|CF|PHONE|DOB|PASSPORT|PLATE|SECRET|ADDRESS)_\d+\]?(?![A-Za-z0-9_])/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sessions = new WeakMap();

/* Копия расширения, где необязательные сайты уже разрешены: окно разрешения Chrome
   в автоматическом браузере не нажать. Путь постоянный, чтобы id и настройки не менялись. */
const src = process.env.PG_EXT_DIR ? path.resolve(process.env.PG_EXT_DIR) : root;
const extDir = path.join(os.tmpdir(), 'velami-live-ext');
rmSync(extDir, { recursive: true, force: true });
if (process.env.PG_EXT_DIR) cpSync(src, extDir, { recursive: true });
else for (const f of listFiles(root)) cpSync(path.join(root, f), path.join(extDir, f));
const manifest = JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...manifest.host_permissions, ...manifest.optional_host_permissions];
/* Путь копии от запуска к запуску одинаковый, и при той же версии Chrome берёт фоновый скрипт из кэша
   профиля, а не с диска. Уникальная четвёртая цифра версии заставляет прочитать свежий код. */
manifest.version = `${manifest.version.split('.').slice(0, 3).join('.')}.${Math.floor(Date.now() / 1000) % 60000}`;
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
  const isWorker = (t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js');
  const sw = await browser.waitForTarget(isWorker, { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const admin = await browser.newPage();
  await admin.goto(`chrome-extension://${extId}/dashboard.html#log`);
  const ext = (msg) => admin.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  if ((await ext({ type: 'cleanDoc' }))?.error === 'unknown message') throw new Error('Chrome запустил устаревший фоновый скрипт');
  await ext({ type: 'setSettings', patch: { askImages: true, sites: Object.fromEntries(Sites.SITES.filter((s) => s.optional).map((s) => [s.id, sites.includes(s.id)])) } });
  const version = (await ext({ type: 'state' })).version || manifest.version;
  console.log(`Velami ${manifest.version} из ${src}`);

  for (const site of sites) {
    for (const name of cases) {
      const t0 = Date.now();
      const r = await runCase(site, name, CASES[name]).catch((e) => ({ ok: false, error: String(e && e.message || e).slice(0, 300) }));
      const row = { site, case: name, sec: Math.round((Date.now() - t0) / 1000), ...r };
      report.push(row);
      console.log(JSON.stringify(row));
      writeFileSync(path.join(out, 'report.json'), JSON.stringify({ version, at: new Date().toISOString(), rows: report }, null, 2));
    }
  }

  async function runCase(site, name, c) {
    const meta = Sites.SITES.find((s) => s.id === site);
    const since = Date.now();
    const page = await browser.newPage();
    const sent = [];
    /* HTTP: события страницы Puppeteer переживают подмену вкладки (Claude после первой отправки
       переключается на другую цель). Тело загрузки файла дочитывается отдельно. */
    page.on('request', (req) => {
      if (req.method() === 'GET' || req.method() === 'OPTIONS') return;
      const body = req.postData();
      if (body !== undefined) sent.push({ kind: 'http', url: req.url(), body });
      else if (req.hasPostData()) req.fetchPostData().then((b) => sent.push({ kind: 'upload', url: req.url(), body: b ?? null }), () => sent.push({ kind: 'upload', url: req.url(), body: null }));
    });
    /* WebSocket: только через сессию CDP. После подмены вкладки подписываемся на новую. */
    let wired = null;
    const wire = () => {
      const client = page._client();
      if (client === wired) return;
      wired = client;
      sessions.set(page, client);
      client.on('Network.webSocketFrameSent', (e) => {
        const p = e.response;
        sent.push({ kind: 'ws', url: '', body: p.opcode === 2 ? Buffer.from(p.payloadData, 'base64').toString('utf8') : p.payloadData });
      });
    };
    wire();
    const rewire = setInterval(wire, 200);
    page.once('close', () => clearInterval(rewire));
    const cdp = { send: (m, p) => page._client().send(m, p) };
    await cdp.send('DOM.enable');
    const shot = (step) => page.screenshot({ path: path.join(out, `${site}-${name}-${step}.png`) }).catch(() => {});
    try {
      await page.goto(START[site] || meta.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(4000);
      if (/non è supportato|not supported in your country|не поддерживается в вашей стране/i.test(await page.evaluate(() => document.body.innerText).catch(() => ''))) {
        return { ok: null, skipped: 'сайт недоступен из этой страны' };
      }
      await dismissPopups(page);
      const composer = await findComposer(page);
      if (!composer) { await shot('0-nocomposer'); return { ok: false, error: 'нет поля ввода: ' + await page.title() }; }
      const focus = async () => { const b = await composer.boundingBox(); if (b) await page.mouse.click(b.x + 20, b.y + b.height / 2); };
      await focus();

      let dialogText = null;
      if (c.file) {
        const quota = await uploadQuota(page, site);
        if (quota) return { ok: null, skipped: 'у аккаунта кончилась квота загрузки файлов: ' + quota };
        const file = path.isAbsolute(c.file) ? c.file : path.join(files, c.file);
        const via = await giveFile(page, composer, file, c.via);
        if (!via) { await shot('0-nofile'); return { ok: false, error: 'сайт не принял файл: нет поля и перетаскивание не сработало' }; }
        if (c.press) {
          const d = await waitDialog(cdp, 120000);
          if (!d) { await shot('1-nodialog'); return { ok: false, error: 'окно Velami не появилось', panel: await panelText(cdp) }; }
          dialogText = textOf(d).replace(/\s+/g, ' ').trim().slice(0, 300);
          await shot('1-dialog');
          const btn = find(d, (n) => n.nodeName === 'BUTTON' && BUTTONS[c.press].test(textOf(n).trim()));
          if (!btn) return { ok: false, error: 'нет кнопки ' + c.press, dialog: dialogText };
          const { model } = await cdp.send('DOM.getBoxModel', { nodeId: btn.nodeId });
          await page.mouse.click((model.content[0] + model.content[4]) / 2, (model.content[1] + model.content[5]) / 2);
        }
        await sleep(12000);
        await shot('2-attached');
        if (c.expectSent === false || c.expectOriginal) return await finish(c, { dialogText, page, ext, since, sent, sentMessage: false });
        await focus();
      }
      await typeText(page, cdp, site, c.message);
      await sleep(1500);
      await shot('2-typed');
      await page.keyboard.press('Enter');
      await waitAnswer(page);
      await shot('3-answer');
      const missing = await missingInAnswer(page, c.message, c.shown);
      const firstDraft = await draftText(page);
      let followup = null;
      if (c.followup) {
        await focus();
        await typeText(page, cdp, site, c.followup.message);
        await sleep(1000);
        await page.keyboard.press('Enter');
        await waitAnswer(page);
        await shot('4-followup');
        followup = await missingInAnswer(page, c.followup.message, c.followup.shown);
      }
      const clipboard = c.copy ? await copyLast(page, meta) : null;
      return await finish(c, { dialogText, page, ext, since, sent, sentMessage: true, missing, firstDraft, followup, clipboard, site, name });
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
}
writeReport();

/* Свои значения пользователь видит в собственном сообщении настоящими, поэтому ответ модели ищем
   только в тексте после сообщения. Конец сообщения без личных данных служит якорем. */
async function missingInAnswer(page, message, values = []) {
  const text = await readText(page);
  const anchor = message.slice(-40);
  const at = text.lastIndexOf(anchor);
  if (at < 0) return ['(сообщение не найдено на странице)'];
  const answer = text.slice(at + anchor.length);
  return values.filter((v) => !answer.includes(v));
}

/* Claude после первой отправки меняет главный фрейм, и page.evaluate теряет его. Сессия CDP
   привязана к вкладке и переживает смену фрейма. */
/* Где на странице осталась метка: текстовые узлы вокруг неё и их родители. Нужен для разбора,
   почему подстановка не сработала (метка разорвана по узлам, лежит в поле ввода и т. п.). */
async function tokenDom(page) {
  const expression = `(() => {
    const re = /\\[\\[[A-Z_]+_\\d+\\]\\]/;
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = w.nextNode()) && out.length < 6) {
      if (!re.test(el.textContent) || [...el.children].some((k) => re.test(k.textContent))) continue;
      const nodes = [...el.childNodes].map((n) => n.nodeType === 3 ? 'T' + JSON.stringify(n.nodeValue.slice(0, 50)) : '<' + n.nodeName.toLowerCase() + (n.className ? '.' + String(n.className).slice(0, 30) : '') + '>' + JSON.stringify((n.textContent || '').slice(0, 30)));
      const path = []; for (let p = el; p && path.length < 6; p = p.parentElement) path.push(p.nodeName.toLowerCase() + (p.isContentEditable ? '[ce]' : ''));
      out.push({ path: path.join('<'), nodes });
    }
    return out;
  })()`;
  const r = await page._client().send('Runtime.evaluate', { expression, returnByValue: true });
  return r.result.value;
}

async function readText(page) {
  try {
    const r = await page._client().send('Runtime.evaluate', { expression: 'document.body ? document.body.innerText : ""', returnByValue: true });
    return String(r.result.value || '');
  } catch (e) {
    console.error('readText:', e.message);
    return '';
  }
}

/* Черновики, которые сайт даёт править (письмо у Claude в textarea, у ChatGPT в ProseMirror):
   их текста нет в innerText страницы или Velami его не трогает. */
async function draftText(page) {
  try {
    const r = await page._client().send('Runtime.evaluate', { returnByValue: true, expression: `[...document.querySelectorAll('textarea, [contenteditable="true"]')]
      .filter((n) => n.getBoundingClientRect().height > 0).map((n) => n.value !== undefined ? n.value : n.innerText).join('\\n')` });
    return String(r.result.value || '');
  } catch {
    return '';
  }
}

async function finish(c, { dialogText, page, ext, since, sent, sentMessage, missing = [], firstDraft = '', followup, clipboard, site, name }) {
  await sleep(1500);
  const pageText = await readText(page);
  if (site) writeFileSync(path.join(out, `${site}-${name}-page.txt`), pageText);
  const log = (await ext({ type: 'getLog' })).filter((e) => e.at >= since);
  const decode = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
  const secrets = c.secrets || [];
  const leaked = c.expectOriginal ? [] : sent.filter((b) => b.body && secrets.some((v) => b.body.includes(v) || decode(b.body).includes(v)))
    .map((b) => `${b.kind} ${b.url.slice(0, 80)}`);
  const unread = sent.filter((b) => b.kind === 'upload' && b.body === null).length;
  const labelsSeen = sent.some((b) => b.body && /\[\[[A-Z_]+_\d+\]\]/.test(decode(b.body)));
  const alarms = log.filter((e) => e.kind === 'coverage' || e.kind === 'leak').map((e) => e.kind);
  const problems = [];
  const extra = {};
  if (leaked.length) problems.push('УТЕЧКА: ' + leaked.join(', '));
  /* Бесплатный аккаунт упёрся в лимит: модель не ответила, проверять нечего, кроме утечек. */
  const limit = !leaked.length && pageText.match(LIMIT_REACHED);
  if (limit) return { ok: null, skipped: 'у аккаунта кончился лимит сообщений: ' + limit[0], requests: sent.length, labelsSeen };
  /* Если ушло сообщение или чистая копия, метки обязаны быть в перехваченном трафике.
     Нет меток: скрипт не видел нужный запрос, и «утечки нет» ничего не доказывает. */
  if ((sentMessage && secrets.length) || c.press === 'clean' || (c.file && !c.press)) {
    if (!labelsSeen) problems.push('в перехваченном трафике нет меток: проверка утечек слепая');
  }
  if (alarms.length) problems.push('тревога в журнале: ' + alarms.join(','));
  if (c.dialog && !(dialogText && c.dialog.test(dialogText))) problems.push('окно без ожидаемого текста');
  if (c.file && c.press === 'cancel' && sent.some((b) => b.body && b.body.includes(path.basename(c.file)))) problems.push('файл ушёл после «Отмена»');
  if (c.expectOriginal && !log.some((e) => e.kind === 'unchecked' && e.file === path.basename(c.file))) problems.push('оригинал не записан в журнал как выбор пользователя');
  if (c.file && c.press === 'clean' && !log.some((e) => e.kind === 'file' && e.file === path.basename(c.file))) problems.push('нет записи о чистой копии в журнале');
  if (sentMessage) {
    if (missing.length) problems.push('в ответе нет настоящих значений: ' + missing.join(', '));
    if (TOKEN.test(pageText)) {
      problems.push('метка на странице: ' + pageText.match(TOKEN)[0]);
      extra.tokenDom = await tokenDom(page).catch((e) => String(e));
    }
    if (!log.some((e) => e.kind === 'sent')) problems.push('отправка не видна в журнале');
  }
  if (followup && followup.length) problems.push('второе сообщение: нет ' + followup.join(', '));
  if (sentMessage) {
    const drafts = firstDraft + '\n' + await draftText(page);
    if (TOKEN.test(drafts)) problems.push('ограничение: метка в редактируемом черновике сайта: ' + drafts.match(TOKEN)[0]);
  }
  if (clipboard) {
    if (clipboard.error) problems.push('копирование: ' + clipboard.error);
    else if (TOKEN.test(clipboard.text)) problems.push('в буфере метка: ' + clipboard.text.match(TOKEN)[0]);
    else {
      const want = (c.followup ? c.followup.shown : c.shown).filter((v) => !clipboard.text.includes(v));
      if (want.length) problems.push('в буфере нет ' + want.join(', '));
    }
  }
  return {
    ok: !problems.length,
    problems,
    requests: sent.length,
    labelsSeen,
    unreadUploads: unread,
    log: log.map((e) => `${e.kind}${e.file ? ' ' + e.file : ''}${e.summary ? ' n=' + e.summary.count : ''}`),
    dialog: dialogText,
    clipboard: clipboard && (clipboard.error || clipboard.text.slice(0, 120)),
    ...extra,
  };
}

function writeReport() {
  const head = '| Сайт | ' + cases.join(' | ') + ' |\n|' + ' --- |'.repeat(cases.length + 1) + '\n';
  const cell = (r) => !r ? '' : r.ok === null ? 'пропуск' : r.ok ? 'да' : 'НЕТ';
  const rows = sites.map((s) => `| ${s} | ` + cases.map((c) => cell(report.find((r) => r.site === s && r.case === c))).join(' | ') + ' |').join('\n');
  const notes = report.filter((r) => r.ok === false).map((r) => `- ${r.site} / ${r.case}: ${(r.problems || []).concat(r.error || []).join('. ')}`).join('\n');
  writeFileSync(path.join(out, 'report.md'), `${head}${rows}\n\n${notes}\n`);
  const ok = report.filter((r) => r.ok).length;
  const skipped = report.filter((r) => r.ok === null).length;
  console.log(`\nИтог: ${ok} из ${report.length - skipped} без замечаний, пропущено ${skipped}. ${path.join(out, 'report.md')}`);
}

/* Бесплатный ChatGPT после нескольких файлов молча перестаёт их принимать, а причину пишет только в меню «+». */
async function uploadQuota(page, site) {
  if (site !== 'chatgpt') return '';
  const plus = await page.$('button[aria-label="Добавить файлы и другое"], button[aria-label="Add files and more"], button[aria-label="Aggiungi file e altro"]');
  if (!plus) return '';
  await plus.click().catch(() => {});
  await sleep(1000);
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  await page.keyboard.press('Escape');
  await sleep(300);
  const m = text.match(/(Перейти на Plus, чтобы загружать больше|Upgrade to Plus to upload more|Passa a Plus per caricare)[^\n]*\n?[^\n]*/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

async function dismissPopups(page) {
  for (let i = 0; i < 4; i++) {
    const closed = await page.evaluate(() => {
      const re = /^(Rifiuta|Reject|Only necessary|Solo necessari|Только обязательные|Пропустить|Пропустити|Skip|Salta|Может быть, позже|Maybe later|Forse più tardi|Не сейчас|Not now)/i;
      const b = [...document.querySelectorAll('button')].find((x) => x.getBoundingClientRect().height > 0 && re.test(x.textContent.trim()));
      if (b) b.click();
      return !!b;
    }).catch(() => false);
    if (!closed) break;
    await sleep(1000);
  }
  await page.keyboard.press('Escape');
  await sleep(500);
}

async function findComposer(page) {
  const h = await page.waitForFunction(() => [...document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')]
    .find((n) => n.getBoundingClientRect().height > 0 && n.getBoundingClientRect().width > 200) || null, { timeout: 40000 }).catch(() => null);
  return h && h.asElement();
}

/* Редактор Mistral теряет пробелы при посимвольном наборе из автоматики: там текст вставляется
   целиком, как при вводе через IME. Velami при этом видит обычное событие input. */
async function typeText(page, cdp, site, text) {
  if (site === 'mistral') await cdp.send('Input.insertText', { text });
  else await page.keyboard.type(text, { delay: 4 });
}

async function giveFile(page, composer, file, via) {
  if (!via) {
    const ext = path.extname(file).toLowerCase();
    const isImage = /^\.(png|jpe?g|gif|webp)$/.test(ext);
    const inputs = await page.$$('input[type=file]');
    let input = null;
    for (const h of inputs) {
      const accept = await h.evaluate((i) => i.accept || '');
      const ok = !accept || accept.split(',').some((a) => (a = a.trim().toLowerCase()) === ext || a === '*/*' || (isImage && a === 'image/*'));
      if (ok) { input = h; if (!accept) break; }
    }
    if (input) { await input.uploadFile(file); return 'input'; }
    via = 'drop';
  }
  const data = readFileSync(file).toString('base64');
  const type = { '.pdf': 'application/pdf', '.txt': 'text/plain', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }[path.extname(file)] || 'application/octet-stream';
  await composer.evaluate((el, name, t, b64, how) => {
    const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type: t }));
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, clientX: r.x + 40, clientY: r.y + r.height / 2 };
    if (how === 'paste') { el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { ...at, clipboardData: dt })); return; }
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { ...at, dataTransfer: dt }));
  }, path.basename(file), type, data, via);
  return via;
}

/* Ответ готов, когда текст страницы перестал меняться: модели печатают потоком. */
async function waitAnswer(page) {
  await sleep(8000);
  let last = -1;
  let still = 0;
  for (const end = Date.now() + 90000; Date.now() < end && still < 3; await sleep(2500)) {
    const n = (await readText(page)).length;
    still = n === last ? still + 1 : 0;
    last = n;
  }
}

async function copyLast(page, meta) {
  await browser.defaultBrowserContext().overridePermissions(new URL(meta.url).origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await page.bringToFront();
  await page.evaluate(() => navigator.clipboard.writeText('-')).catch(() => {});
  const btns = await page.$$('[data-testid="copy-turn-action-button"], [data-testid="action-bar-copy"], button[aria-label^="Copy" i], button[aria-label^="Copia" i], button[aria-label^="Копировать" i], button[aria-label^="Скопировать" i], button[aria-label^="Копіювати" i], button[aria-label^="Скопіювати" i]');
  const visible = [];
  for (const b of btns) { const box = await b.boundingBox(); if (box && box.width > 0) visible.push(box); }
  if (!visible.length) return { error: 'нет кнопки «Копировать»' };
  const b = visible[visible.length - 1];
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await sleep(1500);
  const text = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => null);
  if (text == null) return { error: 'буфер не читается' };
  if (text === '-') return { error: 'сайт ничего не записал в буфер' };
  return { text };
}

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
