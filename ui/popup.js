const send = (msg) => chrome.runtime.sendMessage(msg);
const $ = (id) => document.getElementById(id);
const t = (key, params) => I18N.t(key, params);

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
  $('version').textContent = t('brand.version', { v: chrome.runtime.getManifest().version });
  $('enabled').checked = s.settings.enabled;
  $('rehydrate').checked = s.settings.rehydrate;
  const m = s.model || {};
  $('model').checked = s.settings.model && m.state !== 'missing';
  $('model').disabled = m.state === 'missing';
  $('model-state').textContent = !s.settings.model ? t('model.off')
    : m.state === 'ready' ? t('model.ready', { ms: m.lastMs })
    : m.state === 'error' ? t('model.error', { error: m.error })
    : t('model.' + (m.state || 'idle'));
  $('language').value = s.settings.language || 'auto';

  const p = s.policy || {};
  const locked = p.locked || {};
  $('managed').hidden = !p.managed;
  $('managed-text').textContent = p.organization ? t('policy.managed', { org: p.organization }) : t('policy.managedNoOrg');
  for (const id of ['enabled', 'rehydrate', 'model', 'language']) {
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
$('language').addEventListener('change', (e) => send({ type: 'setSettings', patch: { language: e.target.value } }).then(render));
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#' + b.dataset.open) });
  window.close();
}));

render();
