// Живой прогон на настоящих сайтах из QA-профиля (tools/qa-login.mjs). Только выдуманные значения.
// Запуск: node tools/qa-live.mjs [chatgpt claude ...] [--cases text-it,pdf,...]
//         PG_EXT_DIR=<распакованный zip> node tools/qa-live.mjs   — проверка собранного пакета
// Что проверяется в каждом случае: тела HTTP-запросов (включая загрузки файлов) и кадры WebSocket
// без настоящих значений, журнал Velami без тревог, ответ с настоящими значениями и без меток,
// буфер после кнопки «Копировать» сайта. Итог: test/artifacts/live/report.json и report.md.
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { QA_PROFILE, EXT_DIR, snapshotExtension, dropWorkerCache, assertFresh } from './qa-ext.mjs';

const require = createRequire(import.meta.url);
const Sites = require('../src/sites.js');
const Office = require('../src/office.js');
const Img = require('../src/image.js');
const Tesseract = require('tesseract.js');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'test', 'artifacts', 'live');
const files = path.join(root, 'test', 'fixtures', 'files');
mkdirSync(out, { recursive: true });

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
  pdf: { file: 'estratto.pdf', press: 'clean', message: 'Chi è l’intestatario dell’estratto conto allegato e qual è il saldo?', secrets: [IT.name, IT.email, IT.iban, IT.cf, IT.card], shown: [IT.name] },
  'pdf-long': { file: 'relazione-lunga.pdf', press: 'clean', message: 'Chi firma il documento allegato? Rispondi con il nome completo.', secrets: ['Luca Bianchi'], shown: ['Luca Bianchi'] },
  /* Данных в тексте страниц нет: они на вставленной картинке, в поле формы, комментарии, ссылке и свойствах. */
  'pdf-form': { file: 'modulo.pdf', press: 'clean', message: 'Che titolo ha il modulo allegato e quale codice fiscale è scritto nel campo?', secrets: [IT.name, IT.email, IT.iban, IT.cf, 'giulia.bianchi@example.com', 'paolo.neri@example.com', 'Luca Verdi'], shown: [IT.cf] },
  /* Данные только во вложенном в PDF файле. Вложение в копию не попадает целиком, поэтому меток
     в трафике нет и быть не должно (labels: false); что копия ушла и что в ней нет значений,
     проверяется по самому файлу, который получил сайт. */
  'pdf-attach': { file: 'allegato.pdf', press: 'clean', labels: false, dialog: /allegato\.pdf/, message: 'Riassumi il documento allegato in una riga.', secrets: [IT.email, IT.iban] },
  'pdf-scan': { file: 'scansione.pdf', press: 'clean', message: 'Che cosa c’è scritto nel documento allegato? Riporta il testo.', secrets: [IT.name, IT.email], shown: [IT.email] },
  image: { file: 'bonifico.png', press: 'clean', message: 'Che cosa c’è scritto nell’immagine allegata? Indica beneficiario e importo.', secrets: [IT.name, IT.email, IT.iban, IT.cf], shown: [IT.name] },
  photo: { file: 'chat-ru.jpg', press: 'clean', message: 'Что написано на картинке? Перепиши текст.', secrets: ['maria.petrova@example.com', 'Maria Petrova'], shown: [] },
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
/* Бесплатный Perplexity после нескольких файлов открывает форму оплаты Pro. Стенд в ней ничего не нажимает. */
const PAYWALL = /Подтвердить и оплатить|Confirm and pay|Conferma e paga|Назад к тарифам|Back to plans|Torna ai piani/i;
const TOKEN = /\[\[[A-Z_]+_\d+\]\]|(?<![A-Za-z0-9_])\[?(PERSON|EMAIL|CARD|IBAN|CF|PHONE|DOB|PASSPORT|PLATE|SECRET|ADDRESS)_\d+\]?(?![A-Za-z0-9_])/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sessions = new WeakMap();

/* ---------- что на самом деле ушло в файлах ----------
   Тела загрузок сжаты (Office) или лежат картинкой (PDF, снимки): поиск значений по сырым байтам
   ничего не доказывает. Файл, который страница отдала в fetch или XHR, разбирается здесь так же,
   как его разберёт сайт: текст документа, текстовый слой PDF и OCR картинок страниц. */
/* Файлы ловятся в момент, когда их получает сайт: событие change, drop или paste, которое Velami
   повторяет уже с очищенными файлами (исходное он останавливает раньше). Слушатель живёт в отдельном
   изолированном мире CDP: страница его не видит, fetch и DOM сайта не тронуты. Тела загрузок из CDP
   для этого не годятся: двоичные данные там приходят с потерями. */
const QA_WORLD = 'velami-qa';
const CAPTURE = `(() => {
  if (globalThis.__qaFiles) return;
  const store = globalThis.__qaFiles = [];
  const take = (files, via) => {
    for (const f of files || []) {
      if (f.size > 40 * 1024 * 1024) { store.push({ name: f.name, type: f.type, via, data: '' }); continue; }
      f.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        store.push({ name: f.name, type: f.type, via, data: btoa(bin) });
      }, () => {});
    }
  };
  /* Слушатели ставятся после загрузки документа, то есть позже слушателей Velami (document_start) на том же
     window: исходное событие Velami останавливает раньше, сюда доходит только то, что получает сайт. */
  const listen = () => {
    addEventListener('change', (e) => { const i = e.composedPath()[0]; if (i && i.type === 'file') take(i.files, 'input'); }, true);
    addEventListener('drop', (e) => take(e.dataTransfer && e.dataTransfer.files, 'drop'), true);
    addEventListener('paste', (e) => take(e.clipboardData && e.clipboardData.files, 'paste'), true);
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', listen, { once: true });
  else listen();
})()`;
async function handedFiles(page) {
  try {
    const client = page._client();
    const { frameTree } = await client.send('Page.getFrameTree');
    const { executionContextId } = await client.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: QA_WORLD });
    const r = await client.send('Runtime.evaluate', { contextId: executionContextId, expression: 'JSON.stringify(globalThis.__qaFiles || null)', returnByValue: true });
    return JSON.parse(r.result.value);
  } catch (e) {
    console.error('handedFiles:', e.message);
    return null;
  }
}

let ocrWorker = null;
async function ocrText(bytes) {
  ocrWorker ||= await Tesseract.createWorker(['ita', 'eng', 'rus'], 1, { langPath: path.join(root, 'vendor', 'tesseract', 'lang'), cacheMethod: 'none', gzip: true });
  return (await ocrWorker.recognize(Buffer.from(bytes))).data.text;
}

/* Текст файла глазами сайта. kind: office, pdf, image, text. seen — то, что прочитано OCR. */
async function readUpload(u) {
  const bytes = new Uint8Array(Buffer.from(u.data, 'base64'));
  const base = { name: u.name, size: bytes.length };
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const raw = Buffer.from(bytes).toString('latin1');
      const name = /\.(docx|xlsx|pptx|docm|xlsm|pptm)$/i.test(u.name) ? u.name : raw.includes('word/document.xml') ? 'f.docx' : raw.includes('xl/workbook.xml') ? 'f.xlsx' : raw.includes('ppt/presentation.xml') ? 'f.pptx' : '';
      if (!name) return { ...base, kind: 'zip', text: '', seen: '' };
      const seen = [];
      const r = await Office.extract(bytes, name, { ocr: async (key, b) => { const t = Img.formatOf(b) ? await ocrText(b).catch(() => '') : ''; seen.push(t); return t; } });
      return { ...base, kind: 'office', text: r.text || '', seen: seen.join('\n') };
    }
    if (bytes[0] === 0x25 && bytes[1] === 0x50) {
      const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
      let text = '';
      for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('') + '\n';
      const pages = doc.numPages;
      await doc.cleanup();
      const raw = Buffer.from(bytes);
      let seen = '';
      let images = 0;
      for (let at = raw.indexOf('/DCTDecode'); at >= 0 && images < 8; at = raw.indexOf('/DCTDecode', at + 1)) {
        const start = raw.indexOf('stream\n', at) + 7;
        seen += await ocrText(raw.subarray(start, raw.indexOf('\nendstream', start))).catch(() => '') + '\n';
        images++;
      }
      return { ...base, kind: 'pdf', text, seen, pages, velami: raw.includes('/GlyphLessFont') };
    }
    if (Img.formatOf(bytes)) return { ...base, kind: 'image', text: '', seen: await ocrText(bytes) };
    return { ...base, kind: 'text', text: Buffer.from(bytes).toString('utf8'), seen: '' };
  } catch (e) {
    return { ...base, kind: 'broken', text: '', seen: '', error: String(e && e.message || e).slice(0, 120) };
  }
}
const squeeze = (s) => String(s).replace(/\s+/g, '').toLowerCase();
/* Значение в теле запроса может быть записано иначе, чем его набрали: Markdown ставит «\» перед
   знаками, HTML заменяет знаки и пробелы сущностями, JSON переносит строки как \n. Для поиска
   утечек всё это снимается, пробелы и регистр не учитываются. Без этого 11.11.2026 матрица
   не увидела e-mail вида name\@example.com в сохранении черновика ChatGPT. */
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const loose = (s) => squeeze(String(s)
  .replace(/\\+[nrt]/g, ' ')
  .replace(/\\/g, '')
  .replace(/&#[xX]([0-9a-fA-F]{1,6});/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d{1,7});/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, n) => ENTITY[n]));
const LABEL_SEEN = /\[\[[A-Z1]{2,}_\d+\]\]|\b[A-Z1]{2,}_\d+\b/;

const src = process.env.PG_EXT_DIR ? path.resolve(process.env.PG_EXT_DIR) : root;
const extDir = EXT_DIR;
const manifest = snapshotExtension(root, process.env.PG_EXT_DIR);
dropWorkerCache();

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
  const fresh = await assertFresh(browser);
  console.log(`Фоновый процесс исполняет код с диска: сверено функций ${fresh.checked} (${fresh.files.join(', ')})`);
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
    await page._client().send('Page.addScriptToEvaluateOnNewDocument', { source: CAPTURE, worldName: QA_WORLD });
    const sent = [];
    let handed = null;
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
        /* Чистая копия PDF и картинок готовится десятки секунд: ждём запись в журнале, потом загрузку сайтом. */
        if (c.press === 'clean') {
          const base = path.basename(file);
          for (const end = Date.now() + 240000; Date.now() < end; await sleep(1000)) {
            if ((await ext({ type: 'getLog' })).some((e) => e.at >= since && e.kind === 'file' && e.file === base)) break;
          }
        }
        await sleep(12000);
        await shot('2-attached');
        handed = await handedFiles(page);
        if (c.expectSent === false || c.expectOriginal) return await finish(c, { dialogText, page, ext, since, sent, handed, sentMessage: false });
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
        /* Значения второго ответа уже есть в первом сообщении, а порядок сообщений в DOM у сайтов
           разный (DeepSeek держит их в обратном). Поэтому считаем, сколько раз значение было на
           странице до вопроса и сколько стало после ответа. */
        const before = await countOn(page, c.followup.shown);
        const notGrown = async () => { const now = await countOn(page, c.followup.shown); return c.followup.shown.filter((v, i) => now[i] <= before[i]); };
        await focus();
        await typeText(page, cdp, site, c.followup.message);
        await sleep(1000);
        await page.keyboard.press('Enter');
        await waitAnswer(page);
        await shot('4-followup');
        followup = await notGrown();
        /* Модель с «размышлением» начинает ответ с паузой дольше, чем ждёт waitAnswer. */
        for (const end = Date.now() + 45000; followup.length && Date.now() < end;) {
          await sleep(3000);
          followup = await notGrown();
        }
      }
      const clipboard = c.copy ? await copyLast(page, meta) : null;
      return await finish(c, { dialogText, page, ext, since, sent, handed, sentMessage: true, missing, firstDraft, followup, clipboard, site, name });
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
  if (ocrWorker) await ocrWorker.terminate();
}
writeReport();

/* Свои значения пользователь видит в собственном сообщении настоящими, поэтому ответ модели ищем
   только в тексте после сообщения. Конец сообщения без личных данных служит якорем. */
async function countOn(page, values) {
  const text = await readText(page);
  return values.map((v) => text.split(v).length - 1);
}

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

async function finish(c, { dialogText, page, ext, since, sent, handed, sentMessage, missing = [], firstDraft = '', followup, clipboard, site, name }) {
  await sleep(1500);
  const pageText = await readText(page);
  if (site) writeFileSync(path.join(out, `${site}-${name}-page.txt`), pageText);
  const log = (await ext({ type: 'getLog' })).filter((e) => e.at >= since);
  const decode = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
  const secrets = c.secrets || [];
  const leaked = c.expectOriginal ? [] : sent.filter((b) => b.body && secrets.some((v) => b.body.includes(v) || decode(b.body).includes(v) || loose(b.body).includes(loose(v)) || loose(decode(b.body)).includes(loose(v))))
    .map((b) => `${b.kind} ${b.url.slice(0, 80)}`);
  const unread = sent.filter((b) => b.kind === 'upload' && b.body === null).length;
  /* Файлы: один и тот же файл сайт может отправить несколько раз (повтор, превью), разбираем каждый один раз. */
  const filesSent = [];
  const seenFiles = new Set();
  for (const u of handed || []) {
    const key = u.name + '|' + u.data.length + '|' + u.data.slice(0, 256);
    if (seenFiles.has(key)) continue;
    seenFiles.add(key);
    filesSent.push(u.data ? await readUpload(u) : { name: u.name, kind: 'big', size: 0, text: '', seen: '' });
  }
  if (!c.expectOriginal) {
    for (const f of filesSent) {
      const all = squeeze(f.text + '\n' + f.seen);
      const found = secrets.filter((v) => all.includes(squeeze(v)));
      if (found.length) leaked.push(`файл ${f.name || f.kind}: ${found.join(', ')}`);
    }
  }
  const fileLabels = filesSent.some((f) => /\[\[[A-Z_]+_\d+\]\]/.test(f.text) || LABEL_SEEN.test(f.seen));
  const labelsSeen = fileLabels || sent.some((b) => b.body && /\[\[[A-Z_]+_\d+\]\]/.test(decode(b.body)));
  const alarms = log.filter((e) => e.kind === 'coverage' || e.kind === 'leak').map((e) => e.kind);
  const problems = [];
  const extra = {};
  if (leaked.length) problems.push('УТЕЧКА: ' + leaked.join(', '));
  /* Бесплатный аккаунт упёрся в лимит: модель не ответила, проверять нечего, кроме утечек. */
  const limit = !leaked.length && pageText.match(LIMIT_REACHED);
  if (limit) return { ok: null, skipped: 'у аккаунта кончился лимит сообщений: ' + limit[0], requests: sent.length, labelsSeen };
  const paywall = !leaked.length && pageText.match(PAYWALL);
  if (paywall) return { ok: null, skipped: 'сайт вместо отправки показал оплату тарифа: ' + paywall[0], requests: sent.length, labelsSeen };
  /* Если ушло сообщение или чистая копия, метки обязаны быть в перехваченном трафике.
     Нет меток: скрипт не видел нужный запрос, и «утечки нет» ничего не доказывает. */
  if (c.labels !== false && ((sentMessage && secrets.length) || c.press === 'clean' || (c.file && !c.press))) {
    if (!labelsSeen) problems.push('в перехваченном трафике нет меток: проверка утечек слепая');
  }
  if (alarms.length) {
    problems.push('тревога в журнале: ' + alarms.join(','));
    /* Что именно встревожило расширение: адрес, причина и запросы, которые оно записало. */
    extra.alarms = log.filter((e) => ['leak', 'unchecked', 'coverage', 'blocked'].includes(e.kind))
      .map((e) => ({ kind: e.kind, host: e.host, path: e.path, method: e.method, reason: e.reason, note: e.note, types: e.types, requests: e.requests }));
  }
  if (c.dialog && !(dialogText && c.dialog.test(dialogText))) problems.push('окно без ожидаемого текста');
  if (c.file && c.press === 'cancel' && (filesSent.length || sent.some((b) => b.body && b.body.includes(path.basename(c.file))))) problems.push('файл ушёл после «Отмена»');
  /* Тот же формат: чистая копия PDF обязана быть PDF от Velami, картинка картинкой, Office документом. */
  if (c.file && c.press === 'clean' && filesSent.length) {
    const ext = path.extname(c.file).toLowerCase();
    const want = ext === '.pdf' ? 'pdf' : /^\.(png|jpe?g|webp|gif|bmp)$/.test(ext) ? 'image' : 'office';
    const same = filesSent.find((f) => f.kind === want);
    if (!same) problems.push(`чистая копия ушла не тем форматом: ${filesSent.map((f) => f.kind + ' ' + f.name).join(', ')}`);
    else if (want === 'pdf' && !same.velami) problems.push('ушёл PDF, собранный не Velami');
  }
  if (c.file && (c.press === 'clean' || !c.press) && !filesSent.length) problems.push(handed ? 'сайт не получил файл от Velami' : 'файл, отданный сайту, прочитать не удалось: проверка содержимого слепая');
  if (c.expectOriginal && !log.some((e) => e.kind === 'unchecked' && e.file === path.basename(c.file))) problems.push('оригинал не записан в журнал как выбор пользователя');
  if (c.file && c.press === 'clean' && !log.some((e) => e.kind === 'file' && e.file === path.basename(c.file))) problems.push('нет записи о чистой копии в журнале');
  if (sentMessage) {
    /* Модель вправе не повторять данные (отказ, свои заглушки вида [Nome]). Это не ошибка Velami,
       если на странице не осталось ни одной метки: тогда возвращать было нечего. */
    if (missing.length) {
      if (TOKEN.test(pageText)) problems.push('в ответе нет настоящих значений: ' + missing.join(', '));
      else extra.modelSkipped = missing;
    }
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
      /* Чего модель не написала в ответе (отказ), того нет и в буфере: это не ошибка копирования. */
      const skippedByModel = c.followup ? [] : (extra.modelSkipped || []);
      const want = (c.followup ? c.followup.shown : c.shown).filter((v) => !clipboard.text.includes(v) && !skippedByModel.includes(v));
      if (want.length) problems.push('в буфере нет ' + want.join(', '));
    }
  }
  return {
    ok: !problems.length,
    problems,
    requests: sent.length,
    labelsSeen,
    unreadUploads: unread,
    files: filesSent.map((f) => `${f.kind} ${f.name} ${f.size}${f.error ? ' ' + f.error : ''}`),
    log: log.map((e) => `${e.kind}${e.file ? ' ' + e.file : ''}${e.summary ? ' n=' + e.summary.count : ''}`),
    dialog: dialogText,
    clipboard: clipboard && (clipboard.error || clipboard.text.slice(0, 120)),
    ...extra,
  };
}

function writeReport() {
  const head = '| Сайт | ' + cases.join(' | ') + ' |\n|' + ' --- |'.repeat(cases.length + 1) + '\n';
  const cell = (r) => !r ? '' : r.ok === null ? 'пропуск' : r.ok ? (r.modelSkipped ? 'да*' : 'да') : 'НЕТ';
  const rows = sites.map((s) => `| ${s} | ` + cases.map((c) => cell(report.find((r) => r.site === s && r.case === c))).join(' | ') + ' |').join('\n');
  const notes = report.filter((r) => r.ok === false).map((r) => `- ${r.site} / ${r.case}: ${(r.problems || []).concat(r.error || []).join('. ')}`).join('\n');
  const soft = report.filter((r) => r.ok && r.modelSkipped).map((r) => `- ${r.site} / ${r.case}: модель не повторила ${r.modelSkipped.join(', ')}, меток на странице нет`).join('\n');
  writeFileSync(path.join(out, 'report.md'), `${head}${rows}\n\n${notes}\n${soft ? '\n\\* ' + 'модель не назвала значение сама (отказ или свои заглушки), подставлять было нечего:\n' + soft + '\n' : ''}`);
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
      const re = /^(Rifiuta|Reject|Only necessary|Solo necessari|Только обязательные|Пропустить|Пропустити|Skip|Salta|Может быть, позже|Maybe later|Forse più tardi|Не сейчас|Not now|Пізніше|Позже|Later|Più tardi)/i;
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
  const type = { '.pdf': 'application/pdf', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }[path.extname(file)] || 'application/octet-stream';
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
  let btns = await page.$$('[data-testid="copy-turn-action-button"], [data-testid="action-bar-copy"], button[aria-label^="Copy" i], button[aria-label^="Copia" i], button[aria-label^="Копировать" i], button[aria-label^="Скопировать" i], button[aria-label^="Копіювати" i], button[aria-label^="Скопіювати" i]');
  const shown = async (list) => {
    const out = [];
    for (const b of list) { const box = await b.boundingBox(); if (box && box.width > 0) out.push(b); }
    return out;
  };
  let visible = await shown(btns);
  if (!visible.length) {
    /* DeepSeek: кнопки под ответом без подписей. Под ответом их ряд из пяти и больше, первая копирует. */
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.ds-flex')].filter((r) => r.querySelectorAll(':scope > .ds-button[role="button"]').length >= 5);
      const row = rows[rows.length - 1];
      if (row) row.querySelector(':scope > .ds-button[role="button"]').setAttribute('data-qa-copy', '1');
    }).catch(() => {});
    visible = await shown(await page.$$('[data-qa-copy]'));
  }
  if (!visible.length) return { error: 'нет кнопки «Копировать»' };
  /* Последняя кнопка бывает под полем ввода или ниже окна: клик по координатам попал бы мимо. */
  const el = visible[visible.length - 1];
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await sleep(400);
  const b = await el.boundingBox();
  const over = await page.evaluate((x, y) => { const t = document.elementFromPoint(x, y); return t ? t.tagName + '.' + String(t.className).slice(0, 40) : null; }, b.x + b.width / 2, b.y + b.height / 2);
  const hit = await el.evaluate((e, x, y) => { const t = document.elementFromPoint(x, y); return !!t && (e === t || e.contains(t)); }, b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  if (hit) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  else return { error: 'кнопка «Копировать» закрыта другим элементом: ' + over };
  await sleep(1500);
  await page.bringToFront();
  const read = await page.evaluate(() => navigator.clipboard.readText().then((t) => ({ t }), (e) => ({ e: `${e.name}: ${e.message}`, focus: document.hasFocus(), active: document.activeElement && document.activeElement.tagName })));
  if (read.e) return { error: `буфер не читается (${read.e}; фокус: ${read.focus}, активен ${read.active})` };
  const text = read.t;
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
