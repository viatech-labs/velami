const send = (msg) => chrome.runtime.sendMessage(msg);
const $ = (id) => document.getElementById(id);
const t = (key, params) => I18N.t(key, params);
const RELEASES = 'https://github.com/viatech-labs/velami/releases';
const VERSION = chrome.runtime.getManifest().version;

/* Вкладка, с которой открыли окно, на которой Velami должен работать, но не отвечает: её открыли до
   установки или обновления расширения, и поможет только перезагрузка. Адрес вкладки расширение видит
   лишь там, где у него есть разрешение, то есть на чатах. ?tab=<id> задаёт вкладку явно, когда окно
   открыто как страница (так его открывает тест). */
let staleTabId = null;
async function findStaleTab() {
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  const tab = forced ? await chrome.tabs.get(forced).catch(() => null) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab || !tab.id || tab.status !== 'complete' || !/^https:\/\//.test(tab.url || '')) return null;
  const r = await chrome.tabs.sendMessage(tab.id, { type: 'ping' }).catch(() => null);
  return r && r.ok ? null : tab.id;
}

async function render() {
  const s = await send({ type: 'state' });
  I18N.setLanguage(s.settings.language);
  I18N.apply(document);
  const st = s.stats;
  const alerts = st.blocked + st.leaks + st.coverage + st.unchecked;
  $('s-masked').textContent = st.masked;
  $('s-requests').textContent = st.requests;
  $('s-alerts').textContent = alerts;
  $('stat-alerts').classList.toggle('hot', alerts > 0);
  $('version').textContent = t('brand.version', { v: VERSION });
  $('enabled').checked = s.settings.enabled;
  $('rehydrate').checked = s.settings.rehydrate;
  const m = s.model || {};
  $('model').checked = s.settings.model && m.state !== 'missing';
  $('model').disabled = m.state === 'missing';
  $('model-state').textContent = !s.settings.model ? t('model.off')
    : m.state === 'ready' ? t('model.ready', { ms: m.lastMs })
    : m.state === 'error' ? t('model.error', { error: m.error })
    : t('model.' + (m.state || 'idle'));
  $('orgs').checked = s.settings.orgs !== false;
  $('language').value = s.settings.language || 'auto';

  const note = s.updated && s.updated.version === VERSION;
  $('updated').hidden = !note;
  if (note) {
    $('updated-title').textContent = t('popup.updated', { v: VERSION });
    const text = I18N.MESSAGES.en['whatsnew.' + VERSION] ? t('whatsnew.' + VERSION) : '';
    $('updated-text').textContent = text;
    $('updated-text').hidden = !text;
  }

  const p = s.policy || {};
  const locked = p.locked || {};
  $('managed').hidden = !p.managed;
  $('managed-text').textContent = p.organization ? t('policy.managed', { org: p.organization }) : t('policy.managedNoOrg');
  for (const id of ['enabled', 'rehydrate', 'model', 'orgs', 'language']) {
    if (!(id in locked)) continue;
    $(id).disabled = true;
    $(id).closest('label').title = t('policy.locked');
  }

  const head = $('head');
  head.className = 'group status';
  if (!s.settings.enabled) {
    head.classList.add('off');
    $('title').textContent = t('pill.off');
    $('subtitle').textContent = t('popup.offSub');
  } else if (st.blocked || st.coverage) {
    head.classList.add('bad');
    $('title').textContent = t('popup.bad');
    $('subtitle').textContent = t('popup.badSub');
  } else if (st.leaks || st.unchecked) {
    head.classList.add('warn');
    $('title').textContent = t('popup.warn');
    $('subtitle').textContent = t('popup.warnSub');
  } else {
    $('title').textContent = t('pill.on');
    $('subtitle').textContent = t('popup.onSub');
  }
}

$('enabled').addEventListener('change', (e) => send({ type: 'setSettings', patch: { enabled: e.target.checked } }).then(render));
$('rehydrate').addEventListener('change', (e) => send({ type: 'setSettings', patch: { rehydrate: e.target.checked } }).then(render));
$('model').addEventListener('change', (e) => send({ type: 'setSettings', patch: { model: e.target.checked } }).then(render));
$('orgs').addEventListener('change', (e) => send({ type: 'setSettings', patch: { orgs: e.target.checked } }).then(render));
$('language').addEventListener('change', (e) => send({ type: 'setSettings', patch: { language: e.target.value } }).then(render));
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#' + b.dataset.open) });
  window.close();
}));
$('updated-notes').addEventListener('click', () => { chrome.tabs.create({ url: RELEASES }); window.close(); });
$('updated-ok').addEventListener('click', () => send({ type: 'ackUpdate' }).then(render));
$('stale-reload').addEventListener('click', () => { if (staleTabId) chrome.tabs.reload(staleTabId).then(() => window.close(), () => {}); });

render();
findStaleTab().then((id) => { staleTabId = id; $('stale').hidden = !id; }, () => {});
