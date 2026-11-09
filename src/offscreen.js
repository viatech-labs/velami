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

async function pdfText(bytes) {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = PDF + 'pdf.worker.min.mjs';
  }
  let doc;
  const task = pdfjs.getDocument({ data: bytes, cMapUrl: PDF + 'cmaps/', cMapPacked: true, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
  try {
    doc = await task.promise;
  } catch (e) {
    task.destroy();
    if (e && e.name === 'PasswordException') return { reason: 'password' };
    throw e;
  }
  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const texts = [];
    let empty = 0;
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
      if (text.replace(/\s/g, '').length < EMPTY_PAGE) empty++;
      texts.push(text);
      page.cleanup();
    }
    return { text: texts.join('\n\n'), pages: doc.numPages, emptyPages: empty, truncated: doc.numPages > pages };
  } finally {
    task.destroy();
  }
}

async function extract({ name, data }) {
  const bytes = Uint8Array.from(atob(String(data || '')), (c) => c.charCodeAt(0));
  if (/\.pdf$/i.test(name) || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return { kind: 'pdf', ...(await pdfText(bytes)) };
  }
  if (__PGOffice.kindOf(name)) return __PGOffice.extract(bytes, name);
  return { reason: 'unsupported' };
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
        : Promise.resolve({ error: 'unknown' });
  job.then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e) }));
  return true;
});
touch();
