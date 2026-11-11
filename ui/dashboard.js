const send = (msg) => chrome.runtime.sendMessage(msg);
const $ = (sel) => document.querySelector(sel);
const t = (key, params) => I18N.t(key, params);
const ECHO_URL = 'https://httpbin.org/anything';

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function withTokens(text) {
  const frag = document.createDocumentFragment();
  const re = PG.tokenRe();
  let cursor = 0;
  let m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(cursor, m.index));
    frag.append(el('span', { class: 'tok tok-' + m[1], title: I18N.label(m[1]), text: m[0] }));
    cursor = m.index + m[0].length;
  }
  frag.append(text.slice(cursor));
  return frag;
}

/* ---------- навигация ---------- */

const loaders = {};
function route() {
  const id = (location.hash || '#welcome').slice(1);
  document.querySelectorAll('main section').forEach((s) => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + id));
  if (loaders[id]) loaders[id]();
}
window.addEventListener('hashchange', route);

/* ---------- начало ---------- */

$('#quick-dict').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const s = await send({ type: 'state' });
  const dict = [...s.settings.dictionary];
  for (const [type, raw] of form) {
    for (const term of String(raw).split(',').map((t) => t.trim()).filter((t) => t.length >= 2)) {
      if (!dict.some((d) => d.term.toLowerCase() === term.toLowerCase())) dict.push({ term, type });
    }
  }
  await send({ type: 'setSettings', patch: { dictionary: dict } });
  e.target.reset();
  const saved = e.target.querySelector('.saved');
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 2000);
});

/* ---------- проверь меня сам ---------- */


const compact = (s) => String(s).replace(/[\s-]/g, '').toLowerCase();

$('#echo-run').addEventListener('click', async () => {
  const state = $('#echo-state');
  const original = $('#echo-input').value;
  state.textContent = t('test.sending');
  $('#echo-result').hidden = true;
  try {
    await send({ type: 'modelProbe', text: original });
    const preview = await send({ type: 'mask', text: original });
    if (preview.disabled) { state.textContent = t('test.disabled'); return; }

    const body = {
      action: 'next',
      messages: [{ id: crypto.randomUUID(), author: { role: 'user' }, content: { content_type: 'text', parts: [original] } }],
      model: 'echo-test',
    };
    const refs = __PGWalk.collect(body);
    const r = await send({ type: 'maskBatch', texts: refs.map((x) => x.holder[x.k]), trusted: refs.map((x) => __PGWalk.isUserText(x)), dryRun: true });
    if (!r || r.error) throw new Error((r && r.error) || t('test.noReply'));
    refs.forEach((x, i) => { x.holder[x.k] = r.texts[i]; });

    const resp = await fetch(ECHO_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', credentials: 'omit',
    });
    const data = await resp.json();
    const raw = String(data.data || '');
    let received = raw;
    try { received = data.json.messages[0].content.parts[0]; } catch { /* показываем сырое тело */ }

    $('#echo-original').textContent = original;
    $('#echo-received').textContent = '';
    $('#echo-received').append(withTokens(received));
    $('#echo-raw').textContent = JSON.stringify(data, null, 2);
    $('#echo-ip').textContent = data.origin
      ? t('test.ip', { ip: data.origin })
      : '';

    const list = $('#echo-checks');
    list.textContent = '';
    const seen = new Set();
    let bad = 0;
    for (const f of preview.findings) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const label = I18N.label(f.type);
      const present = raw.toLowerCase().includes(f.value.toLowerCase()) || compact(raw).includes(compact(f.value));
      if (f.excluded) {
        list.append(el('li', { class: 'info' }, el('b', { text: '·' }), t(present ? 'test.excludedGot' : 'test.excludedNot', { label, value: f.value })));
        continue;
      }
      if (present) bad++;
      list.append(el('li', { class: present ? 'bad' : 'ok' },
        el('b', { text: present ? '✗' : '✓' }),
        present
          ? t('test.leaked', { label, value: f.value })
          : t('test.ok', { label, value: f.value, token: f.token })));
    }
    const unmasked = original.match(/\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+/gu) || [];
    const names = unmasked.filter((n) => raw.includes(n) && !preview.findings.some((f) => n.split(' ').some((w) => f.value.includes(w))));
    if (names.length) {
      list.append(el('li', { class: 'info' }, el('b', { text: '!' }),
        t('test.names', { names: [...new Set(names)].join(', ') })));
    }
    state.textContent = bad ? t('test.errors', { n: bad }) : t('test.done');
    $('#echo-result').hidden = false;
  } catch (err) {
    state.textContent = t('test.failed', { error: err.message });
  }
});

/* ---------- сайты ---------- */

function siteCard(site) {
  const toggle = site.optional
    ? el('label', { class: 'toggle' },
      el('input', { type: 'checkbox', class: 'switch', 'data-site': site.id, ...(site.enabled ? { checked: '' } : {}) }),
      el('span', { text: t(site.enabled ? 'sites.on' : 'sites.off') }))
    : el('span', { class: 'badge sent', text: t('sites.on') });
  return el('div', { class: 'site' + (site.enabled ? ' on' : '') },
    el('div', {},
      el('b', { text: site.name }),
      el('div', { class: 'mono muted', text: site.hosts.join(', ') }),
      el('span', { class: 'badge ' + (site.verified ? 'sent' : 'unchecked'), text: t(site.verified ? 'sites.verified' : 'sites.unverified') })),
    el('div', { class: 'row' }, toggle, el('a', { class: 'btn', href: site.url, target: '_blank', rel: 'noopener', text: t('sites.open') })));
}

async function loadSites() {
  const list = await send({ type: 'getSites' });
  $('#sites-builtin').replaceChildren(...list.filter((x) => !x.optional).map(siteCard));
  $('#sites-optional').replaceChildren(...list.filter((x) => x.optional).map(siteCard));
}
loaders.sites = loadSites;

$('#sites-optional').addEventListener('change', async (e) => {
  const id = e.target.dataset && e.target.dataset.site;
  const site = id && __PGSites.SITES.find((x) => x.id === id);
  if (!site) return;
  const origins = __PGSites.originsOf(site);
  const msg = $('#sites-msg');
  msg.hidden = true;
  if (e.target.checked) {
    const granted = await chrome.permissions.request({ origins }).catch(() => false);
    if (!granted) { msg.textContent = t('sites.denied'); msg.hidden = false; await loadSites(); return; }
    await send({ type: 'setSettings', patch: { sites: { [id]: true } } });
  } else {
    await send({ type: 'setSettings', patch: { sites: { [id]: false } } });
    await chrome.permissions.remove({ origins }).catch(() => false);
  }
  await loadSites();
});

/* ---------- журнал ---------- */

const kindOf = (e) => (e.kind === 'sent' && e.channel === 'other' ? 'other' : e.kind);

async function loadLog() {
  const [log, vault] = await Promise.all([send({ type: 'getLog' }), send({ type: 'getVault' })]);
  const filter = $('#log-filter').value;
  const reveal = $('#log-reveal').checked;
  const list = $('#log-list');
  list.textContent = '';
  const rows = log.filter((e) => {
    const k = kindOf(e);
    if (filter === 'sent') return k === 'sent' || k === 'file';
    if (filter === 'other') return k === 'other' || k === 'dropped';
    if (filter === 'alerts') return !['sent', 'other', 'file', 'dropped'].includes(k);
    return true;
  });
  if (!rows.length) { list.append(el('div', { class: 'empty', text: t('log.empty') })); return; }

  for (const e of rows) {
    const k = kindOf(e);
    const card = el('div', { class: 'entry ' + k });
    card.append(el('div', { class: 'meta' },
      el('span', { class: 'badge ' + k, text: t('kind.' + k) }),
      el('span', { text: new Date(e.at).toLocaleString() }),
      el('span', { class: 'mono', text: k === 'file' ? t('log.fileMeta', { file: e.file, host: e.host }) : `${e.method || ''} ${e.host || ''}${e.path || ''}` })));

    if (e.summary) {
      const chips = el('div', { class: 'chips' });
      const types = Object.entries(e.summary.byType || {});
      if (!types.length) chips.append(el('span', { class: 'chip', text: t('log.noData') }));
      for (const [type, n] of types) chips.append(el('span', { class: 'chip', text: `${I18N.label(type)} ×${n}` }));
      chips.append(el('span', {
        class: 'recheck ' + (e.summary.recheck ? 'bad' : 'ok'),
        text: e.summary.recheck ? t('log.recheckBad', { n: e.summary.recheck }) : t('log.recheckOk'),
      }));
      card.append(chips);
    }
    if (e.types) card.append(el('div', { class: 'chips' }, ...e.types.map((type) => el('span', { class: 'chip', text: I18N.label(type) }))));
    if (e.reason || e.note) card.append(el('div', { class: 'muted', text: e.reason || e.note }));
    if (e.copy) card.append(el('div', { class: 'muted mono copy', text: t('log.copyMeta', { name: e.copy.name, bytes: e.copy.bytes, hash: e.copy.sha256 }) }));
    if (Array.isArray(e.requests) && e.requests.length) card.append(el('pre', { class: 'muted', text: e.requests.join('\n') }));
    if (k === 'other') card.append(el('div', { class: 'muted', text: t('log.otherNote') }));
    if (k === 'leak') card.append(el('div', { class: 'muted', text: t('log.leakNote') }));

    for (const text of (e.texts || []).filter((x) => String(x).trim().length > 2).slice(0, 6)) {
      const msg = el('div', { class: 'msg' });
      msg.append(reveal ? PG.rehydrate(text, vault.byToken).text : withTokens(text));
      card.append(msg);
    }
    if (e.body) {
      card.append(el('details', {},
        el('summary', { class: 'muted', text: t('log.bodyMeta', { what: t(k === 'file' ? 'log.bodyFile' : 'log.bodyRequest'), bytes: e.bodyBytes, hash: e.sha256.slice(0, 16) }) + (e.truncated ? t('log.truncated') : '') }),
        el('pre', { text: e.body }),
        el('div', { class: 'muted mono', text: 'SHA-256: ' + e.sha256 })));
    }
    list.append(card);
  }
}
loaders.log = loadLog;
$('#log-filter').addEventListener('change', loadLog);
$('#log-reveal').addEventListener('change', loadLog);
$('#log-refresh').addEventListener('click', loadLog);
$('#log-clear').addEventListener('click', async () => {
  if (!confirm(t('log.confirmClear'))) return;
  await send({ type: 'clearLog' });
  await send({ type: 'resetStats' });
  loadLog();
});
$('#log-export').addEventListener('click', async () => {
  const log = await send({ type: 'getLog' });
  const url = URL.createObjectURL(new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' }));
  el('a', { href: url, download: `velami-log-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

/* ---------- словарь ---------- */


async function loadDict() {
  const s = await send({ type: 'state' });
  const p = s.policy || {};
  const orgTerms = s.settings.dictionary.filter((d) => d.managed).length;
  $('#dict-policy').hidden = !orgTerms;
  $('#dict-policy').textContent = t('policy.dictNote', { n: orgTerms });
  const tbody = $('#dict-table tbody');
  tbody.textContent = '';
  if (!s.settings.dictionary.length) tbody.append(el('tr', {}, el('td', { colspan: 3, class: 'empty', text: t('dict.empty') })));
  s.settings.dictionary.forEach((d, i) => {
    tbody.append(el('tr', {},
      el('td', { text: d.term }),
      el('td', { text: I18N.label(d.type) }),
      el('td', {}, d.managed ? el('span', { class: 'muted', text: p.organization || t('policy.org') }) : el('button', {
        class: 'btn danger', text: t('dict.delete'),
        onclick: async () => {
          const next = s.settings.dictionary.filter((_, j) => j !== i);
          await send({ type: 'setSettings', patch: { dictionary: next } });
          loadDict();
        },
      }))));
  });

  const ex = $('#excl-table tbody');
  ex.textContent = '';
  const noEx = p.allowExclusions === false;
  if (!s.settings.exclusions.length) ex.append(el('tr', {}, el('td', { colspan: 3, class: 'empty', text: t(noEx ? 'policy.noExclusions' : 'dict.exEmpty') })));
  for (const id of s.settings.exclusions) {
    const [type, ...rest] = id.split(':');
    ex.append(el('tr', {},
      el('td', { text: I18N.label(type) }),
      el('td', { class: 'mono', text: rest.join(':') }),
      el('td', {}, el('button', {
        class: 'btn', text: t('dict.hideAgain'),
        onclick: async () => { await send({ type: 'setExclusion', id, excluded: false }); loadDict(); },
      }))));
  }
}
loaders.dict = loadDict;
$('#dict-add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const s = await send({ type: 'state' });
  await send({ type: 'setSettings', patch: { dictionary: [...s.settings.dictionary, { term: f.get('term'), type: f.get('type') }] } });
  e.target.reset();
  loadDict();
});

/* ---------- хранилище ---------- */

async function loadVault() {
  const v = await send({ type: 'getVault' });
  const reveal = $('#vault-reveal').checked;
  const tbody = $('#vault-table tbody');
  tbody.textContent = '';
  const rows = Object.entries(v.byToken);
  if (!rows.length) { tbody.append(el('tr', {}, el('td', { colspan: 3, class: 'empty', text: t('vault.empty') }))); return; }
  for (const [token, value] of rows) {
    const type = PG.typeOfToken(token);
    tbody.append(el('tr', {},
      el('td', {}, el('span', { class: 'tok tok-' + type, text: token })),
      el('td', { text: I18N.label(type) }),
      el('td', { class: reveal ? 'mono' : 'mono blur', text: value })));
  }
}
loaders.vault = loadVault;
$('#vault-reveal').addEventListener('change', loadVault);
$('#vault-clear').addEventListener('click', async () => {
  if (!confirm(t('vault.confirmClear'))) return;
  await send({ type: 'clearVault' });
  loadVault();
});

/* ---------- язык ---------- */

const HIDES = [
  ['hides.auto', ['CARD', 'IBAN', 'EMAIL', 'PHONE', 'SECRET', 'CF', 'SNILS', 'IP', 'PLATE']],
  ['hides.context', ['INN', 'PIVA', 'PASSPORT', 'IDDOC', 'OMS', 'DOB']],
  ['hides.model', ['PERSON', 'ADDRESS']],
  ['hides.dict', ['ORG', 'CUSTOM']],
];
function renderHides() {
  const box = $('#hides');
  box.textContent = '';
  for (const [key, types] of HIDES) {
    box.append(el('div', { class: 'hide-group' },
      el('h3', { text: t(key) }),
      el('p', { class: 'muted', text: t(key + 'P') }),
      el('div', { class: 'chips' }, ...types.map((type) => el('span', { class: 'tok tok-' + type, text: I18N.label(type) })))));
  }
}

function renderPromises() {
  const tbody = $('#promises');
  tbody.textContent = '';
  for (let i = 1; i <= 10; i++) tbody.append(el('tr', {}, el('td', { text: t('verify.p' + i) }), el('td', { text: t('verify.c' + i) })));
}

let sampleShown = '';
async function applyLanguage() {
  const s = await send({ type: 'state' });
  I18N.setLanguage(s.settings.language);
  I18N.apply(document);
  $('#language').value = s.settings.language || 'auto';
  $('#language').disabled = !!(s.policy && s.policy.locked && 'language' in s.policy.locked);
  $('#language').title = $('#language').disabled ? t('policy.locked') : '';
  renderPromises();
  renderHides();
  $('#version').textContent = t('brand.version', { v: chrome.runtime.getManifest().version });
  const input = $('#echo-input');
  if (!input.value || input.value === sampleShown) input.value = sampleShown = t('test.sample');
}

$('#language').addEventListener('change', async (e) => {
  await send({ type: 'setSettings', patch: { language: e.target.value } });
  await applyLanguage();
  route();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.policy && location.hash === '#dict') loadDict();
  if (area !== 'local' || !changes.settings) return;
  const { oldValue = {}, newValue = {} } = changes.settings;
  if (oldValue.language !== newValue.language) applyLanguage().then(route);
});

applyLanguage().then(route);
