/* Локальная модель распознавания имён и адресов и извлечение текста из PDF и документов Office.
   Работает в offscreen-документе расширения: модель, onnxruntime и pdf.js лежат внутри пакета,
   сетевых запросов здесь нет (это держит CSP).
   Отвечает только фоновому процессу своего расширения. */
import * as ort from '../vendor/onnxruntime-web/ort.wasm.min.mjs';

const BASE = chrome.runtime.getURL('');
const MODEL = BASE + 'models/ner/';
const IDLE_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 300;
const THRESHOLD = 0.5;

ort.env.wasm.wasmPaths = BASE + 'vendor/onnxruntime-web/';
// The 8-bit weights are unpacked on every run, which takes about 350 ms on one thread and scales
// with threads. Checks are short bursts, so all cores but one are used, up to 4.
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 1;

let ready = null;
let idleTimer = null;
const cache = new Map();
const stats = { loadMs: 0, runs: 0, lastMs: 0, threads: ort.env.wasm.numThreads };

function load() {
  if (!ready) {
    ready = (async () => {
      const t0 = performance.now();
      const [meta, tokenizerJson] = await Promise.all([
        fetch(MODEL + 'meta.json').then((r) => r.json()),
        fetch(MODEL + 'tokenizer.json').then((r) => r.json()),
      ]);
      const session = await ort.InferenceSession.create(MODEL + 'model.onnx', {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        externalData: [{ path: 'model.data', data: MODEL + 'model.data' }],
      });
      stats.loadMs = Math.round(performance.now() - t0);
      return { meta, session, tokenizer: NER.createTokenizer(tokenizerJson) };
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

const int64 = (values, dims) => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), dims);

let queue = Promise.resolve();
function runChunk(m, words) {
  const run = queue.then(() => infer(m, words));
  queue = run.catch(() => {});
  return run;
}

async function infer(m, words) {
  const x = NER.buildInputs(m.tokenizer, words, m.meta.labels, m.meta.maxWidth);
  const n = x.ids.length;
  const spans = x.length * x.maxWidth;
  const out = await m.session.run({
    input_ids: int64(x.ids, [1, n]),
    attention_mask: int64(x.ids.map(() => 1), [1, n]),
    words_mask: int64(x.wordsMask, [1, n]),
    text_lengths: int64([x.length], [1, 1]),
    span_idx: int64(x.spanIdx, [1, spans, 2]),
    span_mask: new ort.Tensor('bool', Uint8Array.from(x.spanMask, Number), [1, spans]),
  });
  return NER.decode(out.logits.data, words, m.meta.labels, { maxWidth: x.maxWidth, threshold: THRESHOLD });
}

async function recognize(text) {
  const m = await load();
  const t0 = performance.now();
  const found = await NER.recognize(text, (words) => { stats.runs++; return runChunk(m, words); }, cache, CACHE_LIMIT);
  stats.lastMs = Math.round(performance.now() - t0);
  return found.map(({ label, score, value }) => ({ label, score, value }));
}

/* ---------- текст из файлов ---------- */

const PDF = BASE + 'vendor/pdfjs/';
const MAX_PAGES = 500;
const EMPTY_PAGE = 20;
let pdfjs = null;

/* Страница без текстового слоя (скан, фото): рисуется примерно в 200 dpi и читается OCR. */
async function renderPage(page, dpi, maxSide) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(dpi / 72, maxSide / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  /* intent print: обычная отрисовка ждёт requestAnimationFrame, а в скрытом offscreen-документе он не наступает. */
  const task = page.render({ canvasContext: ctx, viewport, intent: 'print' });
  let timer;
  await Promise.race([task.promise, new Promise((_, no) => { timer = setTimeout(() => { task.cancel(); no(new Error('render timeout')); }, PAGE_RENDER_MS); })])
    .finally(() => clearTimeout(timer));
  return { canvas, viewport, scale };
}

async function pageOcr(page) {
  const { canvas } = await renderPage(page, 200, 4000);
  return (await ocrCanvas(canvas)).text;
}

async function openPdf(bytes) {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = PDF + 'pdf.worker.min.mjs';
  }
  const task = pdfjs.getDocument({ data: bytes, cMapUrl: PDF + 'cmaps/', cMapPacked: true, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
  try {
    return { task, doc: await task.promise };
  } catch (e) {
    task.destroy();
    if (e && e.name === 'PasswordException') return { reason: 'password' };
    throw e;
  }
}

const pageText = (content) => content.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim();

/* ocr: false читает только текстовый слой (проверка готовой копии, где слой есть на каждой странице). */
async function pdfText(bytes, { ocr = true } = {}) {
  const { task, doc, reason } = await openPdf(bytes);
  if (reason) return { reason };
  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const texts = [];
    let empty = 0;
    let ocrPages = 0;
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      let text = pageText(await page.getTextContent());
      if (ocr && text.replace(/\s/g, '').length < EMPTY_PAGE) {
        const seen = ocrPages < OCR_PAGES ? await pageOcr(page).catch(() => null) : null;
        if (seen === null) empty++;
        else { ocrPages++; text = (text + '\n' + seen).trim(); }
      }
      texts.push(text);
      page.cleanup();
    }
    return { text: texts.join('\n\n'), pages: doc.numPages, emptyPages: empty, ocrPages, truncated: doc.numPages > pages };
  } finally {
    task.destroy();
  }
}

/* ---------- картинки: распознавание текста и закрытие найденных мест ---------- */

const TESS = BASE + 'vendor/tesseract/';
const OCR_LANGS = ['ita', 'eng', 'rus'];
const OCR_MAX_PIXELS = 40e6;
const OCR_SMALL_SIDE = 1000;
const OCR_CACHE = 40;
const OCR_CACHE_PIXELS = 60e6;
const OCR_PAGES = 30;
const PAGE_RENDER_MS = 20000;
let ocrWorker = null;
const ocrCache = new Map();

function ocrReady() {
  if (!ocrWorker) {
    ocrWorker = Tesseract.createWorker(OCR_LANGS, 1, {
      workerPath: TESS + 'worker.min.js',
      corePath: TESS + 'tesseract-core-simd-lstm.wasm.js',
      langPath: TESS + 'lang',
      workerBlobURL: false,
      cacheMethod: 'none',
      gzip: true,
    });
    ocrWorker.catch(() => { ocrWorker = null; });
  }
  return ocrWorker;
}

async function digest(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
}

/* Мелкий текст на скриншотах Tesseract читает плохо: маленькие картинки увеличиваются вдвое,
   координаты возвращаются в пикселях исходного размера. */
async function ocrCanvas(canvas) {
  const scale = Math.max(canvas.width, canvas.height) < OCR_SMALL_SIDE ? 2 : 1;
  let src = canvas;
  if (scale !== 1) {
    src = new OffscreenCanvas(canvas.width * scale, canvas.height * scale);
    const ctx = src.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, src.width, src.height);
  }
  const worker = await ocrReady();
  const { data } = await worker.recognize(await src.convertToBlob({ type: 'image/png' }), {}, { text: false, blocks: true });
  const out = __PGImage.layout(data.blocks);
  if (scale !== 1) out.boxes = out.boxes.map((b) => b && { x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale, line: b.line });
  return out;
}

async function decode(bytes) {
  const format = __PGImage.formatOf(bytes);
  if (!format) return null;
  const bitmap = await createImageBitmap(new Blob([bytes], { type: __PGImage.MIME[format] }));
  if (bitmap.width * bitmap.height > OCR_MAX_PIXELS) { bitmap.close(); return { format, big: true }; }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return { format, canvas };
}

/* Распознанный текст картинки по её байтам. null: формат не читается (EMF, TIFF, SVG...) или слишком большая. */
async function ocrBytes(bytes) {
  const key = await digest(bytes);
  if (ocrCache.has(key)) {
    const hit = ocrCache.get(key);
    ocrCache.delete(key);
    ocrCache.set(key, hit);
    return hit;
  }
  const img = await decode(bytes);
  if (!img || img.big) return null;
  const r = { ...(await ocrCanvas(img.canvas)), format: img.format, canvas: img.canvas };
  ocrCache.set(key, r);
  let pixels = 0;
  for (const v of ocrCache.values()) pixels += v.canvas.width * v.canvas.height;
  while (ocrCache.size > 1 && (ocrCache.size > OCR_CACHE || pixels > OCR_CACHE_PIXELS)) {
    const [k, v] = ocrCache.entries().next().value;
    pixels -= v.canvas.width * v.canvas.height;
    ocrCache.delete(k);
  }
  return r;
}

/* Метки рисуются своим шрифтом из пакета: на любой системе они выглядят одинаково. */
const LABEL_FONT = '600 {px}px "Velami Label", ui-monospace, monospace';
let labelFont = null;
function labelFontReady() {
  if (!labelFont) {
    labelFont = new FontFace('Velami Label', `url(${BASE}vendor/fonts/plex-mono-600.woff2)`, { weight: '600' }).load()
      .then((f) => { document.fonts.add(f); })
      .catch(() => {});
  }
  return labelFont;
}

/* Найденные места заливаются серым, в первом прямоугольнике каждого значения тёмным пишется
   метка размером с окружающий текст: так её надёжнее читают и люди, и модели. Метка, которая
   не помещается, теряет скобки, потом уменьшается до 0,7 размера и только после этого расширяет
   заливку вправо, закрывая соседний текст. */
function paint(canvas, rects) {
  const ctx = canvas.getContext('2d');
  for (const r of rects) {
    const h = Math.max(8, r.y1 - r.y0);
    let w = Math.max(4, r.x1 - r.x0);
    let label = r.token;
    let px = Math.max(10, Math.round(h * 0.85));
    if (label) {
      const fits = (t, size) => { ctx.font = LABEL_FONT.replace('{px}', size); return ctx.measureText(t).width + 8 <= w; };
      const bare = label.replace(/^\[\[|\]\]$/g, '');
      if (!fits(label, px)) {
        if (fits(bare, px)) label = bare;
        else {
          const min = Math.max(10, Math.round(px * 0.7));
          ctx.font = LABEL_FONT.replace('{px}', px);
          const at = Math.max(min, Math.floor(px * (w - 8) / ctx.measureText(label).width));
          if (fits(label, at)) px = at;
          else { label = bare; px = Math.max(min, Math.min(px, Math.floor(px * (w - 8) / ctx.measureText(bare).width))); }
        }
      }
      ctx.font = LABEL_FONT.replace('{px}', px);
      w = Math.max(w, ctx.measureText(label).width + 8);
    }
    w = Math.min(w, canvas.width - r.x0);
    ctx.fillStyle = '#dfe2e7';
    ctx.fillRect(r.x0, r.y0, w, h);
    if (label) {
      ctx.fillStyle = '#16181d';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, r.x0 + 4, r.y0 + h / 2 + 0.5, w - 6);
    }
  }
}

async function encode(canvas, format) {
  const type = format === 'jpeg' || format === 'webp' ? __PGImage.MIME[format] : 'image/png';
  return new Uint8Array(await (await canvas.convertToBlob({ type, quality: 0.92 })).arrayBuffer());
}

/* Копия картинки, где закрыты все места найденных значений. null: на картинке их нет. */
async function redactBytes(bytes, list) {
  const o = await ocrBytes(bytes);
  if (!o) return null;
  const byId = new Map(list.map((v) => [v.id, v.token]));
  const spans = PG.locate(o.text, list).map((f) => ({ ...f, token: byId.get(f.id) }));
  if (!spans.length) return null;
  const { rects, lost } = __PGImage.rectsFor(o.boxes, spans);
  if (lost.length) throw new Error('value without position on image');
  await labelFontReady();
  const canvas = new OffscreenCanvas(o.canvas.width, o.canvas.height);
  canvas.getContext('2d').drawImage(o.canvas, 0, 0);
  paint(canvas, rects);
  return { bytes: await encode(canvas, o.format), format: o.format, replaced: spans.length, canvas };
}

async function extractImage(bytes) {
  const meta = __PGImage.stripMeta(bytes);
  const o = await ocrBytes(bytes);
  if (!o) return { reason: __PGImage.formatOf(bytes) ? 'big' : 'unsupported' };
  const r = { kind: 'image', text: o.text, format: o.format, width: o.canvas.width, height: o.canvas.height, meta: meta.removed, gps: meta.gps };
  /* Без найденных данных уходит тот же файл без метаданных. Повёрнутый EXIF-ом снимок перерисовывается,
     иначе без EXIF он лёг бы набок. */
  if (meta.removed.length) r.stripped = toBase64(meta.orientation === 1 ? meta.bytes : await encode(o.canvas, o.format));
  return r;
}

async function cleanImage(name, bytes, list) {
  const r = await redactBytes(bytes, list);
  if (!r) return { error: 'nothing to clean' };
  const again = await ocrCanvas(r.canvas);
  const left = PG.locate(again.text, list).length;
  if (left) return { error: 'values left after cleaning', left };
  const out = __PGImage.output(name, r.format);
  return { name: out.name, type: out.type, data: toBase64(r.bytes), replaced: r.replaced };
}

/* PDF той же формой. Каждая страница рисуется в PDF_DPI, места значений по текстовому слою
   (на скане по OCR) закрываются плашками с метками. Закрытую страницу читает OCR: найденное им
   (значение на вставленной картинке, неточная рамка) закрывается вторым проходом, а если и после
   него что-то читается, копии нет. Ссылки, формы и вложения в копию не попадают. */
const PDF_DPI = 150;
const PDF_MAX_SIDE = 2600;
const PDF_COPY_PAGES = 30;
let measureCtx = null;
function measure(s) {
  measureCtx ||= new OffscreenCanvas(1, 1).getContext('2d');
  measureCtx.font = '100px sans-serif';
  return measureCtx.measureText(s).width;
}

function locateOn(o, list) {
  const byId = new Map(list.map((v) => [v.id, v.token]));
  return PG.locate(o.text, list).map((f) => ({ ...f, token: byId.get(f.id) }));
}

async function cleanPdf(name, bytes, list) {
  const { task, doc, reason } = await openPdf(bytes);
  if (reason) return { error: reason };
  try {
    if (doc.numPages > PDF_COPY_PAGES) return { error: 'too many pages', pages: doc.numPages };
    await labelFontReady();
    const pages = [];
    let replaced = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      touch();
      const page = await doc.getPage(i);
      const { canvas, viewport, scale } = await renderPage(page, PDF_DPI, PDF_MAX_SIDE);
      let o = __PGPdf.textLayout((await page.getTextContent()).items, viewport.transform, measure);
      if (o.text.replace(/\s/g, '').length < EMPTY_PAGE) o = await ocrCanvas(canvas);
      const spans = locateOn(o, list);
      const { rects, lost } = __PGImage.rectsFor(o.boxes, spans, 3);
      if (lost.length) throw new Error('value without position on page ' + i);
      paint(canvas, rects);
      replaced += spans.length;
      for (let pass = 0; ; pass++) {
        const seen = await ocrCanvas(canvas);
        const left = locateOn(seen, list);
        if (!left.length) break;
        if (pass) return { error: 'values left after cleaning', page: i, left: left.length };
        paint(canvas, __PGImage.rectsFor(seen.boxes, left, 3).rects);
      }
      const runs = __PGPdf.maskedRuns(o.text, o.boxes, spans).map((r) => {
        const h = (r.y1 - r.y0) / scale;
        return { x: r.x0 / scale, y: viewport.height / scale - (r.y1 - (r.y1 - r.y0) * 0.2) / scale, size: h, width: (r.x1 - r.x0) / scale, text: r.text };
      });
      const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer());
      pages.push({ width: viewport.width / scale, height: viewport.height / scale, jpeg, imageWidth: canvas.width, imageHeight: canvas.height, runs });
      page.cleanup();
    }
    const out = __PGPdf.write(pages);
    /* pdf.js забирает буфер себе (transfer), поэтому на проверку уходит копия. */
    const check = await pdfText(out.slice(), { ocr: false });
    if (check.reason || PG.locate(check.text, list).length) return { error: 'values left after cleaning' };
    return { name, type: 'application/pdf', data: toBase64(out), replaced, pages: pages.length };
  } finally {
    task.destroy();
  }
}

/* Картинки внутри документов Office: текст для поиска и замена на закрытую копию. */
async function officeOcr(key, bytes) {
  const o = await ocrBytes(bytes).catch(() => null);
  return o ? o.text : null;
}

const fromBase64 = (data) => Uint8Array.from(atob(String(data || '')), (c) => c.charCodeAt(0));
function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const isPdf = (name, bytes) => /\.pdf$/i.test(name) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);

async function extract({ name, data }) {
  const bytes = fromBase64(data);
  if (isPdf(name, bytes)) {
    return { kind: 'pdf', ...(await pdfText(bytes)) };
  }
  if (__PGOffice.kindOf(name)) return __PGOffice.extract(bytes, name, { ocr: officeOcr });
  if (__PGImage.formatOf(bytes)) return extractImage(bytes);
  return { reason: 'unsupported' };
}

/* Документ Office, PDF или картинка с метками вместо найденных значений. Готовый файл разбирается заново:
   если в нём осталось хоть одно значение, копия не отдаётся. */
async function cleanDoc({ name, data, values }) {
  const list = (Array.isArray(values) ? values : [])
    .filter((v) => v && typeof v.id === 'string' && typeof v.value === 'string' && typeof v.token === 'string' && PG.typeOfToken(v.token))
    .map(({ id, type, value, token }) => ({ id, type: String(type), value, token }));
  if (!list.length) return { error: 'nothing to clean' };
  const bytes = fromBase64(data);
  name = String(name || '');
  if (isPdf(name, bytes)) return cleanPdf(name, bytes, list);
  if (!__PGOffice.kindOf(name) && __PGImage.formatOf(bytes)) return cleanImage(name, bytes, list);
  const redact = async (key, read) => {
    const r = await redactBytes(await read(), list);
    return r && r.bytes;
  };
  const r = await __PGOffice.clean(bytes, name, list, PG.locate, { redact });
  const check = await __PGOffice.extract(r.bytes, r.name, { ocr: officeOcr });
  const left = PG.locate(check.text, list).length;
  if (left) return { error: 'values left after cleaning', left };
  return { name: r.name, data: toBase64(r.bytes), replaced: r.replaced, removed: r.removed, emptied: r.emptied, images: r.images };
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => window.close(), IDLE_MS);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  if (sender.id !== chrome.runtime.id || sender.tab || !String(sender.url || '').startsWith(BASE)) return false;
  touch();
  const job = msg.type === 'recognize'
    ? Promise.all((msg.texts || []).map((t) => recognize(String(t)))).then((results) => ({ results, stats }))
    : msg.type === 'warmup' ? load().then(() => ({ stats }))
      : msg.type === 'extract' ? extract(msg).catch((e) => ({ reason: 'broken', error: String((e && e.message) || e) }))
        : msg.type === 'clean' ? cleanDoc(msg).catch((e) => ({ error: String((e && e.message) || e) }))
          : Promise.resolve({ error: 'unknown' });
  job.then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});
touch();
