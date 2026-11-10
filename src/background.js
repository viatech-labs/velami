/* Единственный владелец хранилища меток, журнала и статистики. Всё лежит в chrome.storage.local
   на этом компьютере. Сетевых запросов фоновый процесс не делает. */
importScripts('detector.js', 'sites.js', 'policy.js');

const DEFAULT_SETTINGS = { enabled: true, rehydrate: true, model: true, language: 'auto', dictionary: [], exclusions: [], sites: {}, askImages: true };
const SITES = self.__PGSites;
const POLICY = self.__PGPolicy;
const OPTIONAL_SITES = SITES.SITES.filter((x) => x.optional);
const LANGUAGES = ['auto', 'en', 'it', 'ru'];
const LOG_LIMIT = 300;
const BODY_LIMIT = 20000;
const PAGE_MESSAGES = new Set(['maskBatch', 'log', 'scan', 'mask', 'noteInput', 'setExclusion', 'open', 'extractFile', 'cleanDoc', 'setImagesAsk']);
const MAX_EXTRACT = 30 * 1024 * 1024;

let state = null;
let chain = Promise.resolve();

function serial(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

const today = () => new Date().toISOString().slice(0, 10);
const freshStats = () => ({ day: today(), masked: 0, requests: 0, files: 0, blocked: 0, leaks: 0, unchecked: 0, coverage: 0, dropped: 0 });

let loading = null;

function load() {
  if (state) return Promise.resolve(state);
  if (!loading) {
    loading = Promise.all([chrome.storage.local.get(['settings', 'userSettings', 'policy', 'vault', 'stats']), readPolicy()]).then(async ([r, policy]) => {
      const user = { ...DEFAULT_SETTINGS, ...(r.userSettings || r.settings || {}) };
      user.dictionary = (user.dictionary || []).filter((d) => !d.managed);
      state = {
        user,
        policy,
        settings: POLICY.apply(user, policy),
        vault: new PG.Vault(r.vault),
        stats: r.stats && r.stats.day === today() ? r.stats : freshStats(),
      };
      if (!r.userSettings || JSON.stringify(r.settings) !== JSON.stringify(state.settings) || JSON.stringify(r.policy) !== JSON.stringify(policy)) {
        await chrome.storage.local.set({ settings: state.settings, userSettings: state.user, policy: state.policy });
      }
      return state;
    });
  }
  return loading;
}

/* Политика читается только из managed-хранилища: его пишет браузер по политике организации,
   ни страница, ни само расширение изменить его не могут. */
const readManaged = () => chrome.storage.managed.get(null).catch(() => ({}));
const readPolicy = () => readManaged().then(POLICY.normalize);

async function setPolicy(raw) {
  const s = await load();
  s.policy = POLICY.normalize(raw);
  s.settings = POLICY.apply(s.user, s.policy);
  await persist(['settings']);
  return s.policy;
}

function stats(s) {
  if (s.stats.day !== today()) s.stats = freshStats();
  return s.stats;
}

const ctx = (s, vault) => ({
  vault,
  dictionary: s.settings.dictionary,
  auto: autoTerms(s),
  exclusions: new Set(s.settings.exclusions),
});

/* ---------- локальная модель: имена и адреса без словаря ----------
   Модель работает в offscreen-документе. Найденное хранится только в памяти фонового процесса
   и действует как временный словарь: те же значения маскируются во всех запросах сайта. */
const MODEL_TTL = 30 * 60 * 1000;
const MODEL_TYPES = { person: 'PERSON', address: 'ADDRESS' };
const PREVIEW_BUDGET = 250;
const SEND_BUDGET = 3000;
const MODEL_MAX_CHARS = 20000;
const FILE_BUDGET = 60000;
const FILE_MAX_CHUNKS = 25;
const model = { state: 'idle', error: '', loadMs: 0, lastMs: 0, threads: 0, available: null };
const modelTerms = new Map();
const recognized = new Set();

function autoTerms(s) {
  if (!s.settings.model) return [];
  const now = Date.now();
  for (const [k, v] of modelTerms) if (now - v.at > MODEL_TTL) modelTerms.delete(k);
  return [...modelTerms.values()];
}

async function modelAvailable() {
  if (model.available === null) {
    try { model.available = (await fetch(chrome.runtime.getURL('models/ner/meta.json'))).ok; } catch { model.available = false; }
    if (!model.available) model.state = 'missing';
  }
  return model.available;
}

let creatingOffscreen = null;
async function ensureOffscreen() {
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (open.length) return;
  creatingOffscreen ||= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Local name and address recognition model and text extraction from attached PDF and Office files. Runs on this computer, no network.',
  }).finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function recognize(texts) {
  const s = await load();
  if (!s.settings.model || !texts.length || !(await modelAvailable())) return false;
  if (model.state !== 'ready') model.state = 'loading';
  try {
    await ensureOffscreen();
    const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'recognize', texts: texts.map((t) => t.slice(0, MODEL_MAX_CHARS)) });
    if (!r || r.error) throw new Error((r && r.error) || 'no reply');
    Object.assign(model, { state: 'ready', error: '', loadMs: r.stats.loadMs, lastMs: r.stats.lastMs, threads: r.stats.threads });
    const now = Date.now();
    r.results.forEach((entities, i) => {
      for (const e of entities) {
        const type = MODEL_TYPES[e.label];
        if (!type) continue;
        const terms = [e.value, ...(type === 'PERSON' ? PG.nameVariants(e.value) : [])];
        for (const term of terms) {
          const key = term.toLowerCase();
          const prev = modelTerms.get(key);
          modelTerms.set(key, { term, type, score: Math.max(e.score, prev ? prev.score : 0), at: now });
        }
      }
      recognized.add(texts[i]);
    });
    while (modelTerms.size > 300) modelTerms.delete(modelTerms.keys().next().value);
    while (recognized.size > 50) recognized.delete(recognized.values().next().value);
    return true;
  } catch (err) {
    Object.assign(model, { state: 'error', error: String((err && err.message) || err) });
    return false;
  }
}

const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(() => r(false), ms))]);

/* Предпросмотр зовёт модель на каждую паузу в наборе. Держим не больше одного запуска и
   один отложенный, самый свежий текст: старые черновики считать незачем. */
let previewRun = null;
let previewNext = null;
function recognizePreview(text) {
  if (previewRun) { previewNext = text; return previewRun; }
  previewRun = recognize([text]).finally(() => {
    previewRun = null;
    if (previewNext) { const t = previewNext; previewNext = null; recognizePreview(t); }
  });
  return previewRun;
}

async function persist(keys) {
  const s = await load();
  const patch = {};
  if (keys.includes('settings')) Object.assign(patch, { settings: s.settings, userSettings: s.user, policy: s.policy });
  if (keys.includes('vault')) patch.vault = s.vault.data;
  if (keys.includes('stats')) patch.stats = s.stats;
  await chrome.storage.local.set(patch);
  updateBadge();
}

async function updateBadge() {
  const s = await load();
  const st = stats(s);
  let text = '';
  let color = '#3b6e38';
  if (!s.settings.enabled) { text = 'OFF'; color = '#6e6e73'; }
  else if (st.blocked || st.coverage) { text = '!'; color = '#a3291d'; }
  else if (st.leaks) { text = '!'; color = '#8f5a0c'; }
  else if (st.masked) text = st.masked > 999 ? '999+' : String(st.masked);
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function countRemaining(texts, s) {
  const excl = new Set(s.settings.exclusions);
  let n = 0;
  for (const t of texts) n += PG.detect(t, { dictionary: s.settings.dictionary, auto: autoTerms(s) }).filter((f) => !excl.has(f.id)).length;
  return n;
}

/* Недавно набранные в поле ввода тексты. Значения, найденные в них, ищутся во всех исходящих
   запросах сайта. Хранятся только в памяти фонового процесса. */
const INPUT_TTL = 30 * 60 * 1000;
let inputs = [];

function noteInput(text) {
  const t = String(text || '').trim();
  if (!t) return;
  const now = Date.now();
  inputs = inputs.filter((x) => now - x.at < INPUT_TTL && !t.startsWith(x.text) && !x.text.startsWith(t));
  inputs.push({ text: t, at: now });
  if (inputs.length > 10) inputs = inputs.slice(-10);
}

function candidates(s) {
  const now = Date.now();
  inputs = inputs.filter((x) => now - x.at < INPUT_TTL);
  return PG.candidatesFrom(inputs.map((x) => x.text), {
    dictionary: s.settings.dictionary, auto: autoTerms(s), exclusions: s.settings.exclusions, vaultData: s.vault.data,
  });
}

async function mask({ text }) {
  const s = await load();
  const t = String(text || '');
  noteInput(t);
  if (!s.settings.enabled) return { disabled: true, text, findings: [] };
  if (s.settings.model && !recognized.has(t)) await within(recognizePreview(t), PREVIEW_BUDGET);
  const r = PG.maskText(t, { ...ctx(s, s.vault), commit: false });
  return {
    text: r.text,
    modelPending: s.settings.model && model.available !== false && model.state !== 'error' && !recognized.has(t),
    findings: r.findings.map(({ type, label, value, id, token, excluded, isNew, source, score }) => ({ type, label, value, id, token, excluded, isNew, source, score })),
  };
}

/* Текст файла модель читает по частям: у неё предел MODEL_MAX_CHARS на запуск. */
function fileChunks(text) {
  const out = [];
  let rest = text;
  while (rest.length > MODEL_MAX_CHARS && out.length < FILE_MAX_CHUNKS) {
    const cut = rest.lastIndexOf('\n', MODEL_MAX_CHARS);
    const at = cut > MODEL_MAX_CHARS / 2 ? cut + 1 : MODEL_MAX_CHARS;
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  const complete = rest.length <= MODEL_MAX_CHARS;
  if (complete) out.push(rest);
  return { chunks: out.filter((c) => c.trim()), complete };
}

async function recognizeFile(texts) {
  const parts = texts.map(fileChunks);
  const ok = await within(recognize(parts.flatMap((p) => p.chunks)), FILE_BUDGET);
  if (ok) texts.forEach((t, i) => { if (parts[i].complete) recognized.add(t); });
  return ok && parts.every((p) => p.complete);
}

async function maskBatch({ texts, trusted, dryRun, file }) {
  const s = await load();
  if (!s.settings.enabled) return { disabled: true };
  const list = (texts || []).map(String);
  const userText = list.filter((_, i) => trusted && trusted[i]);
  const pendingModel = userText.filter((t) => t.trim() && !recognized.has(t));
  const modelOn = s.settings.model && await modelAvailable();
  const modelChecked = !modelOn || !pendingModel.length
    || await (file ? recognizeFile(pendingModel) : within(recognize(pendingModel), SEND_BUDGET));
  const vault = dryRun ? new PG.Vault(s.vault.data) : s.vault;
  const opts = { ...ctx(s, vault), commit: true };
  const known = PG.candidatesFrom(userText, { dictionary: s.settings.dictionary, auto: opts.auto, exclusions: s.settings.exclusions })
    .concat(candidates(s));
  const out = [];
  const byType = {};
  const values = new Map();
  let count = 0;
  let created = 0;
  for (let i = 0; i < list.length; i++) {
    const full = trusted && trusted[i] ? PG.maskText(list[i], opts) : { text: list[i], findings: [] };
    const r = PG.maskKnown(full.text, { ...opts, candidates: known });
    out.push(r.text);
    for (const f of [...full.findings, ...r.findings]) {
      if (f.excluded) continue;
      count++;
      byType[f.type] = (byType[f.type] || 0) + 1;
      if (f.isNew) created++;
      if (file && f.token) values.set(f.id + '\u0000' + f.value, { id: f.id, type: f.type, value: f.value, token: f.token });
    }
  }
  const remaining = countRemaining(out.filter((_, i) => trusted && trusted[i]), s)
    + out.reduce((n, t) => n + PG.locate(t, known).length, 0);
  const summary = { count, byType, recheck: remaining };
  if (!modelChecked && userText.some((t) => t.trim())) summary.model = model.state === 'error' ? 'error' : 'timeout';
  else if (modelOn && !file && userText.some((t) => t.length > MODEL_MAX_CHARS)) summary.model = 'partial';
  if (!dryRun) {
    stats(s).masked += count;
    await persist(created ? ['vault', 'stats'] : ['stats']);
  }
  return file ? { texts: out, summary, values: [...values.values()] } : { texts: out, summary };
}

const LOG_FIELDS = ['kind', 'channel', 'host', 'path', 'method', 'file', 'summary', 'texts', 'body', 'reason', 'note', 'types', 'requests'];
const KIND_STAT = { sent: 'requests', file: 'files', blocked: 'blocked', leak: 'leaks', unchecked: 'unchecked', coverage: 'coverage', dropped: 'dropped' };

async function addLog(entry, sender) {
  const e = { id: crypto.randomUUID(), at: Date.now(), site: '' };
  for (const k of LOG_FIELDS) if (entry && entry[k] !== undefined) e[k] = entry[k];
  if (!KIND_STAT[e.kind]) return { ok: false };
  if (e.requests !== undefined) e.requests = Array.isArray(e.requests) ? e.requests.filter((r) => typeof r === 'string').slice(0, 15).map((r) => r.slice(0, 200)) : undefined;
  try { e.site = new URL(sender.tab.url).host; } catch { /* ignore */ }
  if (typeof e.body === 'string') {
    e.bodyBytes = new TextEncoder().encode(e.body).length;
    e.sha256 = await sha256(e.body);
    e.truncated = e.body.length > BODY_LIMIT;
    e.body = e.body.slice(0, BODY_LIMIT);
  }
  await serial(async () => {
    const { log = [] } = await chrome.storage.local.get('log');
    log.unshift(e);
    await chrome.storage.local.set({ log: log.slice(0, LOG_LIMIT) });
  });
  if (e.kind === 'sent' && e.channel === 'other') return { ok: true };
  const s = await load();
  const st = stats(s);
  st[KIND_STAT[e.kind]] = (st[KIND_STAT[e.kind]] || 0) + 1;
  await persist(['stats']);
  return { ok: true };
}

const recentLeaks = new Map();

/* verify: повторная проверка готового тела перед отправкой. Остаток останавливает отправку,
   в журнал попадает остановка, а не утечка. */
async function scan({ host, path, text, verify }, sender) {
  const s = await load();
  if (!s.settings.enabled) return { leak: false };
  const r = PG.findLeaks(String(text || ''), { candidates: candidates(s) });
  if (!r.leak) return { leak: false };
  if (verify) return { leak: true, types: r.types };
  const types = r.types;
  const sig = host + '|' + types.join(',');
  if (Date.now() - (recentLeaks.get(sig) || 0) > 60000) {
    recentLeaks.set(sig, Date.now());
    await addLog({ kind: 'leak', host, path, method: 'POST', types }, sender);
  }
  return { leak: true };
}

async function setSettings(patch) {
  const s = await load();
  const next = { ...s.user };
  patch = Object.fromEntries(Object.entries(patch).filter(([k]) => !POLICY.isLocked(s.policy, k)));
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (typeof patch.rehydrate === 'boolean') next.rehydrate = patch.rehydrate;
  if (typeof patch.model === 'boolean') next.model = patch.model;
  if (typeof patch.askImages === 'boolean') next.askImages = patch.askImages;
  if (LANGUAGES.includes(patch.language)) next.language = patch.language;
  if (Array.isArray(patch.dictionary)) {
    next.dictionary = patch.dictionary
      .map((d) => ({ term: String(d.term || '').trim(), type: PG.DICT_TYPES.includes(d.type) ? d.type : 'CUSTOM' }))
      .filter((d, i) => d.term.length >= 2 && !(patch.dictionary[i] || {}).managed);
  }
  if (Array.isArray(patch.exclusions)) next.exclusions = [...new Set(patch.exclusions.map(String))];
  if (patch.sites && typeof patch.sites === 'object') {
    next.sites = { ...next.sites };
    for (const site of OPTIONAL_SITES) if (typeof patch.sites[site.id] === 'boolean') next.sites[site.id] = patch.sites[site.id];
  }
  s.user = next;
  s.settings = POLICY.apply(next, s.policy);
  await persist(['settings']);
  if (patch.sites) await syncSites();
  return s.settings;
}

/* Сайты, которые пользователь включил сам. Скрипты те же, что в манифесте для основных
   сайтов, регистрируются только при выданном разрешении на сайт. */
let siteSync = Promise.resolve();
function syncSites() {
  siteSync = siteSync.catch(() => {}).then(registerSites);
  return siteSync;
}

async function registerSites() {
  const s = await load();
  const [main, isolated] = chrome.runtime.getManifest().content_scripts;
  const scripts = [];
  for (const site of OPTIONAL_SITES) {
    if (!s.settings.sites[site.id]) continue;
    const matches = SITES.originsOf(site);
    if (!await chrome.permissions.contains({ origins: matches })) continue;
    scripts.push(
      { id: `site-${site.id}-main`, matches, js: main.js, runAt: 'document_start', world: 'MAIN' },
      { id: `site-${site.id}`, matches, js: isolated.js, runAt: 'document_start' },
    );
  }
  const ids = (await chrome.scripting.getRegisteredContentScripts()).map((x) => x.id).filter((id) => id.startsWith('site-'));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
}

async function sitesState() {
  const s = await load();
  const list = [];
  for (const site of SITES.SITES) {
    const granted = !site.optional || await chrome.permissions.contains({ origins: SITES.originsOf(site) });
    list.push({ id: site.id, name: site.name, url: site.url, hosts: site.hosts, verified: !!site.verified, optional: !!site.optional, enabled: !site.optional || (!!s.settings.sites[site.id] && granted) });
  }
  return list;
}

/* Текст вложенного PDF или документа Office. Файл приходит из изолированного мира страницы
   в base64, разбирается в offscreen-документе и нигде не сохраняется. */
async function extractFile({ name, data }) {
  if (typeof data !== 'string' || data.length > MAX_EXTRACT * 4 / 3 + 4) return { reason: 'big' };
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'extract', name: String(name || ''), data });
  return r || { reason: 'broken' };
}

/* Тот же документ Office с метками. Метки берутся из хранилища, а не из сообщения страницы:
   страница называет только значения, найденные в этом файле при maskBatch. */
async function cleanDocFile({ name, data, values }) {
  if (typeof data !== 'string' || data.length > MAX_EXTRACT * 4 / 3 + 4) return { error: 'big' };
  const s = await load();
  const list = [];
  for (const v of Array.isArray(values) ? values.slice(0, 5000) : []) {
    const token = v && typeof v.id === 'string' ? s.vault.peek(v.id) : null;
    if (token && typeof v.value === 'string' && v.value) list.push({ id: v.id, type: PG.typeOfToken(token), value: v.value, token });
  }
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'clean', name: String(name || ''), data, values: list });
  return r || { error: 'no reply' };
}

async function setExclusion({ id, excluded }) {
  const s = await load();
  const set = new Set(s.settings.exclusions);
  if (excluded) set.add(String(id)); else set.delete(String(id));
  return setSettings({ exclusions: [...set] });
}

async function handle(msg, sender) {
  const fromExtensionPage = (sender.url || '').startsWith(chrome.runtime.getURL(''));
  if (!fromExtensionPage && !PAGE_MESSAGES.has(msg.type)) return { error: 'forbidden' };
  const s = await load();
  switch (msg.type) {
    case 'mask': return mask(msg);
    case 'noteInput':
      noteInput(msg.text);
      return { ok: true };
    case 'maskBatch': return maskBatch({ texts: msg.texts, trusted: msg.trusted, dryRun: fromExtensionPage && !!msg.dryRun, file: !!msg.file });
    case 'log': return addLog(msg.entry, sender);
    case 'scan': return scan(msg, sender);
    case 'setExclusion': return setExclusion(msg);
    case 'extractFile': return extractFile(msg);
    case 'cleanDoc': return cleanDocFile(msg);
    case 'setImagesAsk': return setSettings({ askImages: !!msg.ask });
    case 'open':
      await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#' + (msg.page || 'log')) });
      return { ok: true };
    case 'state':
      await modelAvailable();
      return { settings: s.settings, policy: s.policy, stats: stats(s), vaultSize: s.vault.size, model: { ...model, terms: modelTerms.size } };
    case 'modelProbe': {
      const text = String(msg.text || '').slice(0, 20000);
      const t0 = Date.now();
      recognized.delete(text);
      const ok = await recognize([text]);
      const found = PG.detect(text, { auto: autoTerms(s) }).filter((f) => f.source === 'model');
      return { ok, ms: Date.now() - t0, model: { ...model }, found: found.map(({ type, value, score }) => ({ type, value, score })) };
    }
    case 'setSettings': return setSettings(msg.patch || {});
    case 'getSites': return sitesState();
    case 'getLog': return (await chrome.storage.local.get('log')).log || [];
    case 'clearLog':
      await serial(() => chrome.storage.local.set({ log: [] }));
      return { ok: true };
    case 'getVault': return s.vault.data;
    case 'clearVault':
      s.vault = new PG.Vault();
      await persist(['vault']);
      return { ok: true };
    case 'resetStats':
      s.stats = freshStats();
      await persist(['stats']);
      return { ok: true };
    default: return { error: 'unknown message' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.target === 'offscreen') return false;
  handle(msg || {}, sender).then(sendResponse, (err) => sendResponse({ error: String((err && err.message) || err) }));
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  updateBadge();
  syncSites().catch(() => {});
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#welcome') });
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'managed') readManaged().then(setPolicy).then(updateBadge).catch(() => {});
});
chrome.permissions.onRemoved.addListener(() => { syncSites().catch(() => {}); });
