/* Изолированный мир content script: мост к перехватчику на странице, панель
   «что увидит модель», контроль покрытия отправок и подстановка настоящих значений в ответы. */
(() => {
  'use strict';
  if (window.__pgContent) return;
  window.__pgContent = true;

  const RELAY = new Set(['maskBatch', 'log', 'scan']);
  /* Запросы страницы, на которые отвечает сам изолированный мир. Ни один не возвращает настоящих значений. */
  const LOCAL = { copy: (p) => copyRestored(p), fileChecked: (p) => fileChecked(p) };
  const send = (msg) => chrome.runtime.sendMessage(msg);
  const tr = (key, params) => I18N.t(key, params);

  let enabled = true;
  let rehydrateOn = true;
  let byToken = {};

  /* ---------- мост к page-hook ---------- */

  let hookPort = null;
  function onPort(port) {
    if (hookPort) return;
    hookPort = port;
    port.postMessage({ type: 'lang', lang: I18N.lang });
    port.onmessage = async (e) => {
      const m = e.data || {};
      if (m.type === 'event') { onHookEvent(m.payload || {}); return; }
      const local = LOCAL[m.type];
      if (!local && !RELAY.has(m.type)) { port.postMessage({ id: m.id, ok: false, error: 'forbidden' }); return; }
      try {
        const result = local ? await local(m.payload || {}) : await send({ ...(m.payload || {}), type: m.type });
        if (!result || result.error) throw new Error((result && result.error) || tr('err.noReply'));
        port.postMessage({ id: m.id, ok: true, result });
      } catch (err) {
        port.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
      }
    };
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.__pg === 'port' && e.ports && e.ports[0]) onPort(e.ports[0]);
    else if (e.data.__pg === 'hook-ready' && !hookPort) window.postMessage({ __pg: 'hello' }, '*');
  });
  window.postMessage({ __pg: 'hello' }, '*');

  /* ---------- панель ---------- */

  const MARK = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7.2" fill="#cf6b47"/><rect x="8" y="9" width="11" height="2.6" rx="1.3" fill="#fff" fill-opacity=".72"/><rect x="8" y="14.3" width="16" height="4.4" rx="2.2" fill="#fff"/><rect x="8" y="21.4" width="8" height="2.6" rx="1.3" fill="#fff" fill-opacity=".72"/></svg>';
  const CHEVRON = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const host = document.createElement('div');
  host.setAttribute('data-pg-gateway', '');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
<style>
  :host { all: initial; }
  .wrap {
    --surface: rgba(255, 255, 255, .94); --solid: #fff; --fill: rgba(29, 29, 31, .06); --fill-2: rgba(29, 29, 31, .11);
    --line: rgba(29, 29, 31, .1); --fg: #1d1d1f; --fg-2: #3a3a3c; --muted: #6e6e73;
    --accent: #c96442; --link: #a9502f;
    --ok: #4f8a4b; --ok-soft: rgba(79, 138, 75, .11); --ok-fg: #3b6e38; --warn: #c8811a; --warn-soft: rgba(200, 129, 26, .12); --warn-fg: #8f5a0c;
    --bad: #c0392b; --bad-soft: rgba(192, 57, 43, .09); --bad-fg: #a3291d;
    --sh: 0 0 0 1px rgba(29, 29, 31, .1), 0 24px 48px -16px rgba(29, 29, 31, .22), 0 6px 16px -8px rgba(29, 29, 31, .1);
    position: fixed; right: 16px; bottom: 96px; z-index: 2147483646; display: flex; flex-direction: column; align-items: flex-end;
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI Variable", "Segoe UI", Roboto, sans-serif; letter-spacing: -.006em; color: var(--fg);
    -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) {
    .wrap {
      --surface: rgba(30, 30, 32, .95); --solid: #2c2c2e; --fill: rgba(255, 255, 255, .07); --fill-2: rgba(255, 255, 255, .13);
      --line: rgba(255, 255, 255, .1); --fg: #f5f5f7; --fg-2: #d1d1d6; --muted: #98989d;
      --accent: #d97757; --link: #e8957a;
      --ok: #79b26f; --ok-soft: rgba(121, 178, 111, .14); --ok-fg: #9cc893; --warn: #e0a043; --warn-soft: rgba(224, 160, 67, .15); --warn-fg: #ecbb6e;
      --bad: #e5675a; --bad-soft: rgba(229, 103, 90, .15); --bad-fg: #f08b80;
      --sh: 0 0 0 1px rgba(255, 255, 255, .1), 0 24px 48px -12px rgba(0, 0, 0, .6);
    }
  }
  button { font: inherit; }
  .mark { display: block; width: 20px; height: 20px; flex: none; }
  .pill { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px 0 8px; border: 0; border-radius: 999px; background: #1d1d1f; color: #f5f5f7; font-weight: 500; letter-spacing: -.01em; cursor: pointer; box-shadow: 0 0 0 1px rgba(255, 255, 255, .12), 0 8px 24px -8px rgba(0, 0, 0, .4); transition: transform .2s cubic-bezier(.3, .7, .4, 1); }
  .pill:hover { transform: scale(1.03); }
  .pill .mark { width: 20px; height: 20px; }
  .pill .dot { width: 7px; height: 7px; border-radius: 50%; background: #79b26f; }
  .pill.off .dot { background: #6e6e73; }
  .pill.warn { background: #8f5a0c; } .pill.bad { background: #a3291d; }
  .pill.warn .dot, .pill.bad .dot { background: #fff; }
  .card { width: 380px; max-height: min(72vh, 640px); display: flex; flex-direction: column; margin-bottom: 10px; overflow: hidden; background: var(--surface); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px); border-radius: 14px; box-shadow: var(--sh); }
  header { display: flex; align-items: center; gap: 9px; padding: 11px 10px 11px 14px; }
  header b { flex: 1; font-size: 14px; font-weight: 600; line-height: 1.2; letter-spacing: -.01em; }
  .count { min-width: 20px; padding: 1px 7px; border-radius: 999px; background: var(--fill); color: var(--fg-2); font-size: 12px; font-weight: 600; text-align: center; font-variant-numeric: tabular-nums; }
  .x { display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 50%; background: var(--fill); color: var(--muted); cursor: pointer; }
  .x:hover { background: var(--fill-2); color: var(--fg); }
  .body { overflow: auto; }
  .sec { padding: 0 14px 12px; }
  .muted { color: var(--muted); font-size: 12.5px; }
  .preview { margin-top: 8px; white-space: pre-wrap; word-break: break-word; max-height: 168px; overflow: auto; padding: 10px 12px; color: var(--fg-2); background: var(--solid); border-radius: 10px; font-size: 13px; line-height: 1.6; }
  .tok { display: inline-block; padding: 0 5px; border-radius: 5px; color: var(--fg-2); background: var(--fill); font: 500 11.5px/1.6 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0; white-space: nowrap; }
  .t-SECRET { color: var(--bad-fg); background: var(--bad-soft); }
  ul { list-style: none; margin: 12px 0 0; padding: 0; background: var(--solid); border-radius: 10px; overflow: hidden; }
  li { position: relative; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: start; padding: 9px 12px; }
  li + li::before { content: ""; position: absolute; top: 0; left: 38px; right: 0; height: 1px; background: var(--line); }
  li input { margin: 2px 0 0; width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
  li .v { font-weight: 500; color: var(--fg); word-break: break-word; }
  li .t { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
  li .badge { padding: 0 6px; border-radius: 999px; background: var(--fill); color: var(--muted); font-size: 11px; font-weight: 500; }
  li.ex .v { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--bad); }
  li.ex .t { color: var(--bad-fg); font-weight: 500; }
  li.unsure { background: var(--warn-soft); } li.unsure .badge { background: transparent; color: var(--warn-fg); padding: 0; }
  .model-wait { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .model-wait::before { content: ""; width: 12px; height: 12px; border: 2px solid var(--fill-2); border-top-color: var(--muted); border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .status { display: flex; gap: 8px; align-items: flex-start; margin: 0 14px 12px; padding: 9px 12px; border-radius: 10px; font-size: 12.5px; }
  .status::before { content: ""; flex: none; width: 7px; height: 7px; margin-top: 5px; border-radius: 50%; background: currentColor; }
  .status.ok { background: var(--ok-soft); color: var(--ok-fg); } .status.warn { background: var(--warn-soft); color: var(--warn-fg); } .status.bad { background: var(--bad-soft); color: var(--bad-fg); }
  footer { display: flex; gap: 2px; padding: 6px 8px; border-top: 1px solid var(--line); }
  footer a { padding: 5px 8px; border-radius: 7px; color: var(--link); cursor: pointer; text-decoration: none; font-size: 12.5px; }
  footer a:hover { background: var(--fill); }
  .toast { max-width: 360px; margin: 0 0 10px; padding: 10px 14px; border-radius: 12px; background: #1d1d1f; color: #f5f5f7; font-size: 12.5px; box-shadow: 0 12px 28px -8px rgba(0, 0, 0, .4); }
  .toast.warn { background: #8f5a0c; } .toast.bad { background: #a3291d; }
  .tip { position: fixed; z-index: 2147483647; max-width: 300px; padding: 7px 10px; border-radius: 8px; background: #1d1d1f; color: #f5f5f7; font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; pointer-events: none; box-shadow: 0 8px 20px -6px rgba(0, 0, 0, .45); }
  .tip code { font: 500 11px ui-monospace, Menlo, monospace; color: #e8957a; }
  .ask { width: 380px; margin-bottom: 10px; padding: 14px; background: var(--surface); -webkit-backdrop-filter: saturate(180%) blur(30px); backdrop-filter: saturate(180%) blur(30px); border-radius: 14px; box-shadow: var(--sh); }
  .ask header { padding: 0 0 8px; }
  .ask p { margin: 0 0 8px; color: var(--fg-2); }
  .ask .ask-note { color: var(--warn-fg); }
  .ask label { display: flex; align-items: center; gap: 8px; margin: 4px 0 10px; color: var(--muted); font-size: 12.5px; cursor: pointer; }
  .ask label input { width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
  .ask .btns { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .ask button { height: 30px; padding: 0 12px; border: 0; border-radius: 8px; background: var(--fill); color: var(--fg); font-weight: 500; cursor: pointer; }
  .ask button:hover { background: var(--fill-2); }
  .ask button.primary { background: var(--accent); color: #fff; }
  .ask button.primary:hover { filter: brightness(1.06); }
  [hidden] { display: none !important; }
</style>
<div class="tip" hidden></div>
<div class="wrap">
  <div class="toast" role="status" hidden></div>
  <section class="ask" role="alertdialog" aria-modal="false" hidden>
    <header>${MARK}<b class="ask-title"></b></header>
    <p class="ask-text"></p>
    <p class="ask-note" hidden></p>
    <label class="ask-opt" hidden><input type="checkbox"><span></span></label>
    <div class="btns"></div>
  </section>
  <section class="card" hidden>
    <header>${MARK}<b data-i18n="panel.title"></b><span class="count" hidden></span><button class="x" data-i18n-title="panel.collapse">${CHEVRON}</button></header>
    <div class="body">
      <div class="sec">
        <div class="summary muted"></div>
        <div class="preview" hidden></div>
        <div class="model-wait muted" data-i18n="preview.modelWait" hidden></div>
        <ul class="findings" hidden></ul>
      </div>
    </div>
    <div class="status" hidden></div>
    <footer><a data-open="log" data-i18n="panel.log"></a><a data-open="test" data-i18n="panel.test"></a><a data-open="dict" data-i18n="panel.dict"></a></footer>
  </section>
  <button class="pill">${MARK}<span class="pill-text"></span><span class="dot"></span></button>
</div>`;

  const $ = (sel) => shadow.querySelector(sel);
  I18N.apply(shadow);
  const card = $('.card');
  const pill = $('.pill');
  const pillText = $('.pill-text');
  const summaryEl = $('.summary');
  const previewEl = $('.preview');
  const findingsEl = $('.findings');
  const modelWaitEl = $('.model-wait');
  const statusEl = $('.status');
  const countEl = $('.count');
  const toastEl = $('.toast');
  const tipEl = $('.tip');
  let toastTimer = null;

  function toast(level, text, ms = 4000) {
    toastEl.className = 'toast ' + (level === 'ok' ? '' : level);
    toastEl.textContent = text;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  let userCollapsed = false;
  let alert = null;

  pill.addEventListener('click', () => { userCollapsed = card.hidden ? false : true; card.hidden = !card.hidden; });
  $('.x').addEventListener('click', () => { userCollapsed = true; card.hidden = true; });
  shadow.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', () => send({ type: 'open', page: a.dataset.open }).catch(() => {})));

  function setPill() {
    pill.className = 'pill';
    if (!enabled) { pill.classList.add('off'); pillText.textContent = tr('pill.off'); return; }
    if (alert) { pill.classList.add(alert.level); pillText.textContent = tr(alert.pill); return; }
    pillText.textContent = tr('pill.on');
  }

  function setStatus(level, text) {
    statusEl.hidden = !text;
    statusEl.className = 'status ' + (level || '');
    statusEl.textContent = text || '';
  }

  function raise(level, pillLabel, text) {
    alert = { level, pill: pillLabel };
    setStatus(level, text);
    setPill();
    card.hidden = false;
  }

  function renderMasked(text) {
    previewEl.textContent = '';
    const re = PG.tokenRe();
    let cursor = 0;
    let m;
    while ((m = re.exec(text))) {
      previewEl.append(text.slice(cursor, m.index));
      const span = document.createElement('span');
      span.className = 'tok t-' + m[1];
      span.textContent = m[0];
      span.title = I18N.label(m[1]);
      previewEl.append(span);
      cursor = m.index + m[0].length;
    }
    previewEl.append(text.slice(cursor));
  }

  const UNSURE_BELOW = 0.8;

  function renderFindings(findings) {
    findingsEl.textContent = '';
    findingsEl.hidden = !findings.length;
    const seen = new Set();
    for (const f of findings) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const li = document.createElement('li');
      const unsure = f.source === 'model' && f.score < UNSURE_BELOW;
      if (f.excluded) li.className = 'ex';
      else if (unsure) li.className = 'unsure';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !f.excluded;
      cb.disabled = policy.allowExclusions === false;
      cb.title = tr(cb.disabled ? 'policy.noExclusions' : 'panel.keepTitle');
      cb.addEventListener('change', async () => {
        await send({ type: 'setExclusion', id: f.id, excluded: !cb.checked }).catch(() => {});
        refreshPreview();
      });
      const v = document.createElement('span');
      v.className = 'v';
      v.textContent = f.value;
      const t = document.createElement('span');
      t.className = 't';
      if (f.excluded) t.textContent = tr('panel.asIs', { label: I18N.label(f.type) });
      else {
        const tok = document.createElement('span');
        tok.className = 'tok t-' + f.type;
        tok.textContent = f.token;
        t.append(I18N.label(f.type), tok);
        if (f.source === 'model') {
          const b = document.createElement('span');
          b.className = 'badge';
          b.textContent = tr(unsure ? 'panel.modelUnsure' : 'panel.model');
          t.append(b);
        }
      }
      li.append(cb, v, t);
      findingsEl.append(li);
    }
  }

  /* ---------- поле ввода и предпросмотр ---------- */

  const EDITABLE = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';
  let composer = null;
  let previewTimer = null;
  let previewSeq = 0;
  let modelRetry = 0;

  const composerText = () => {
    if (!composer || !composer.isConnected) return '';
    return composer.tagName === 'TEXTAREA' ? composer.value : composer.innerText;
  };

  function schedulePreview() {
    modelRetry = 0;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 120);
  }

  async function refreshPreview() {
    const text = composerText().trim();
    const mySeq = ++previewSeq;
    if (!text) {
      previewEl.hidden = true;
      modelWaitEl.hidden = true;
      findingsEl.textContent = '';
      findingsEl.hidden = true;
      countEl.hidden = true;
      summaryEl.textContent = tr('preview.empty');
      if (!alert) card.hidden = true;
      userCollapsed = false;
      return;
    }
    let r;
    try { r = await send({ type: 'mask', text }); } catch { return; }
    if (mySeq !== previewSeq || !r) return;
    if (r.disabled) {
      summaryEl.textContent = tr('preview.disabled');
      previewEl.hidden = true;
      findingsEl.textContent = '';
      findingsEl.hidden = true;
      countEl.hidden = true;
      return;
    }
    const active = r.findings.filter((f) => !f.excluded).length;
    countEl.hidden = !active;
    countEl.textContent = active;
    summaryEl.textContent = active
      ? tr('preview.hidden', { n: active })
      : tr('preview.none');
    previewEl.hidden = false;
    renderMasked(r.text);
    renderFindings(r.findings);
    modelWaitEl.hidden = !r.modelPending;
    if (r.modelPending && modelRetry < 20) {
      modelRetry++;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(refreshPreview, 400);
    } else if (!r.modelPending) {
      modelRetry = 0;
    }
    if (r.findings.length && !userCollapsed) card.hidden = false;
  }

  document.addEventListener('input', (e) => {
    const el = e.target && e.target.closest ? e.target.closest(EDITABLE) : null;
    if (!el || host.contains(el)) return;
    composer = el;
    schedulePreview();
  }, true);

  /* ---------- контроль покрытия: каждую отправку шлюз должен увидеть ---------- */

  /* Куда страница ходила, пока шлюз ждал отправку: адрес без строки запроса, идентификаторы
     заменены. По этому списку видно, каким путём сообщение ушло мимо шлюза. */
  function requestsSince(t0) {
    const seen = new Set();
    for (const r of performance.getEntriesByType('resource')) {
      if (r.startTime < t0 || !/^(fetch|xmlhttprequest|beacon|other)$/.test(r.initiatorType)) continue;
      try {
        const u = new URL(r.name);
        seen.add(`${r.initiatorType} ${u.host}${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|\d{6,}|[\w-]{24,}/gi, ':id')}`);
      } catch { /* ignore */ }
      if (seen.size >= 15) break;
    }
    return [...seen];
  }

  /* Сайт может отправить сообщение только после загрузки файла: пока загрузка идёт и ещё
     пару секунд после неё ожидание продлевается, но не дольше UPLOAD_WAIT. */
  const SEND_WAIT = 6000;
  const UPLOAD_WAIT = 90000;
  let uploadsActive = 0;
  let uploadEndedAt = 0;
  let expectTimer = null;
  function expectSend() {
    const text = composerText().trim();
    if (!enabled || !text) return;
    send({ type: 'noteInput', text }).catch(() => {});
    clearTimeout(expectTimer);
    const t0 = performance.now();
    const check = () => {
      const waited = performance.now() - t0;
      if (waited < UPLOAD_WAIT && (uploadsActive > 0 || Date.now() - uploadEndedAt < 2500)) {
        expectTimer = setTimeout(check, 1000);
        return;
      }
      raise('bad', 'pill.coverage', tr('status.coverage'));
      send({ type: 'log', entry: { kind: 'coverage', host: location.host, path: location.pathname, note: tr('status.coverageNote'), requests: requestsSince(t0) } }).catch(() => {});
    };
    expectTimer = setTimeout(check, SEND_WAIT);
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    const el = e.target && e.target.closest ? e.target.closest(EDITABLE) : null;
    if (el && el === composer) expectSend();
  }, true);
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest
      ? e.target.closest('button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="Submit" i], button[aria-label*="Отправ" i], button[aria-label*="Invia" i], [role="button"][aria-label*="Send" i]')
      : null;
    if (btn) expectSend();
  }, true);

  function onHookEvent(ev) {
    if (ev.event === 'upload') {
      uploadsActive = Math.max(0, Number(ev.active) || 0);
      if (!uploadsActive) uploadEndedAt = Date.now();
    } else if (ev.event === 'sent') {
      clearTimeout(expectTimer);
      if (alert && alert.pill === 'pill.coverage') alert = null;
      const s = ev.summary || { count: 0, byType: {}, recheck: 0 };
      const types = typesText(s);
      if (s.recheck > 0) {
        raise('bad', 'pill.check', tr('status.recheck', { n: s.recheck }));
      } else if (!alert) {
        const text = s.count ? tr('status.sent', { n: s.count, types }) : tr('status.sentClean');
        if (s.model) setStatus('warn', text + ' ' + tr(s.model === 'partial' ? 'status.modelPartial' : 'status.modelSkipped'));
        else setStatus('ok', text);
        setPill();
      }
      setTimeout(schedulePreview, 300);
    } else if (ev.event === 'blocked') {
      clearTimeout(expectTimer);
      raise('bad', 'pill.blocked', tr('status.blocked', { reason: ev.reason }));
    } else if (ev.event === 'unchecked') {
      raise('warn', 'pill.unchecked', tr('status.unchecked', { host: ev.host }));
    } else if (ev.event === 'masked-other') {
      if (!alert) setStatus('ok', tr('status.other', { host: ev.host, n: ev.count }));
    } else if (ev.event === 'leak') {
      raise('warn', 'pill.leak', tr('status.leak', { host: ev.host }));
    }
  }

  /* ---------- подстановка настоящих значений в ответы ---------- */

  const TOKEN_TEST = new RegExp(PG.TOKEN_SOURCE + '|' + PG.LOOSE_SOURCE);
  const SKIP = 'textarea, script, style, noscript, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';
  const restored = new Map();
  const canHighlight = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  let hlFrame = 0;

  function processText(node) {
    const v = node.nodeValue;
    if (!v) return;
    const p = node.parentElement;
    if (!p || p.closest(SKIP) || host.contains(p)) return;
    if (!TOKEN_TEST.test(v)) {
      if (PIECE.test(v)) restoreAcross(p);
      return;
    }
    const r = PG.rehydrate(v, byToken);
    if (!r.spans.length) return;
    node.nodeValue = r.text;
    restored.set(node, r.spans.map((s) => ({ start: s.start, end: s.end, token: s.token, value: r.text.slice(s.start, s.end) })));
    scheduleHighlights();
  }

  /* ChatGPT при выводе ответа кладёт каждый кусок в свой элемент: «[», «[PERSON», «_», «1]]».
     Метка целиком видна только у общего предка. Значение встаёт в узел, где метка начиналась,
     из остальных узлов уходят её куски. Сами узлы не удаляются: ими владеет сайт. */
  const PIECE = /[[\]_\d]/;
  const ACROSS_LEVELS = 4;
  const ACROSS_MAX = 4000;
  function restoreAcross(start) {
    let el = start;
    let found = false;
    for (let i = 0; el && i < ACROSS_LEVELS && !found; i++) {
      const t = el.textContent;
      if (t.length > ACROSS_MAX) return;
      if (TOKEN_TEST.test(t)) found = true;
      else el = el.parentElement;
    }
    if (!found || el.closest(SKIP) || host.contains(el)) return;
    const nodes = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) if (!n.parentElement.closest(SKIP)) nodes.push(n);
    const texts = nodes.map((n) => n.nodeValue);
    const starts = [];
    let all = '';
    for (const t of texts) { starts.push(all.length); all += t; }
    const at = (pos) => { let i = starts.length - 1; while (i > 0 && starts[i] > pos) i--; return i; };
    const re = new RegExp(PG.TOKEN_SOURCE + '|' + PG.LOOSE_SOURCE, 'g');
    const hits = [];
    for (let m; (m = re.exec(all));) {
      const token = m[1] ? `[[${m[1]}_${m[2]}]]` : `[[${m[3]}_${m[4]}]]`;
      if (byToken[token] != null) hits.push({ a: m.index, b: m.index + m[0].length, token, value: String(byToken[token]) });
    }
    if (!hits.length) return;
    const marks = new Map();
    for (const h of hits.reverse()) {
      const first = at(h.a);
      const last = at(h.b - 1);
      for (let i = last; i >= first; i--) {
        const from = Math.max(h.a, starts[i]) - starts[i];
        const to = Math.min(h.b, starts[i] + nodes[i].nodeValue.length) - starts[i];
        texts[i] = texts[i].slice(0, from) + (i === first ? h.value : '') + texts[i].slice(to);
      }
      const list = marks.get(first) || [];
      const from = h.a - starts[first];
      list.forEach((s) => { s.start += h.value.length - (Math.min(h.b, starts[first] + nodes[first].nodeValue.length) - h.a); s.end = s.start + s.value.length; });
      list.push({ start: from, end: from + h.value.length, token: h.token, value: h.value });
      marks.set(first, list);
    }
    nodes.forEach((n, i) => { if (texts[i] !== n.nodeValue) n.nodeValue = texts[i]; });
    for (const [i, spans] of marks) restored.set(nodes[i], spans);
    scheduleHighlights();
  }

  function scanTree(rootNode) {
    if (!rehydrateOn || !enabled || !rootNode) return;
    if (rootNode.nodeType === Node.TEXT_NODE) { processText(rootNode); return; }
    if (rootNode.nodeType !== Node.ELEMENT_NODE && rootNode.nodeType !== Node.DOCUMENT_NODE) return;
    const w = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) processText(n);
  }

  function scheduleHighlights() {
    if (!canHighlight || hlFrame) return;
    hlFrame = requestAnimationFrame(() => {
      hlFrame = 0;
      const hl = new Highlight();
      for (const [node, spans] of restored) {
        if (!node.isConnected) { restored.delete(node); continue; }
        for (const s of spans) {
          if (node.nodeValue.slice(s.start, s.end) !== s.value) continue;
          const range = new Range();
          range.setStart(node, s.start);
          range.setEnd(node, s.end);
          hl.add(range);
        }
      }
      CSS.highlights.set('pg-restored', hl);
    });
  }

  const observer = new MutationObserver((mutations) => {
    if (!rehydrateOn || !enabled) return;
    for (const m of mutations) {
      if (m.type === 'characterData') processText(m.target);
      else for (const n of m.addedNodes) scanTree(n);
    }
  });

  /* ---------- подсказка над подставленным значением ---------- */

  let tipFrame = 0;
  let lastMove = null;

  function hitRestored(x, y) {
    let node = null;
    let offset = 0;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    const spans = node && restored.get(node);
    if (!spans) return null;
    for (const s of spans) {
      if (offset < s.start || offset > s.end || node.nodeValue.slice(s.start, s.end) !== s.value) continue;
      const range = new Range();
      range.setStart(node, s.start);
      range.setEnd(node, s.end);
      for (const b of range.getClientRects()) {
        if (x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1) return s;
      }
    }
    return null;
  }

  function updateTip() {
    tipFrame = 0;
    const s = lastMove && hitRestored(lastMove.clientX, lastMove.clientY);
    if (!s) { tipEl.hidden = true; return; }
    tipEl.textContent = '';
    const code = document.createElement('code');
    code.textContent = s.token;
    const [before, after] = tr('tip', { token: '\u0000' }).split('\u0000');
    tipEl.append(before, code, after || '');
    tipEl.hidden = false;
    const w = tipEl.offsetWidth;
    const h = tipEl.offsetHeight;
    tipEl.style.left = Math.max(4, Math.min(lastMove.clientX + 12, innerWidth - w - 8)) + 'px';
    tipEl.style.top = (lastMove.clientY + 20 + h > innerHeight ? lastMove.clientY - h - 10 : lastMove.clientY + 20) + 'px';
  }

  document.addEventListener('mousemove', (e) => {
    if (!restored.size && tipEl.hidden) return;
    lastMove = e;
    if (!tipFrame) tipFrame = requestAnimationFrame(updateTip);
  }, { capture: true, passive: true });

  /* ---------- копирование ответа с настоящими значениями ---------- */

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function restore(text, html) {
    if (!html) return PG.rehydrate(text, byToken);
    const escaped = {};
    for (const [k, v] of Object.entries(byToken)) escaped[k] = escapeHtml(v);
    return PG.rehydrate(text, escaped);
  }

  function copied(n) {
    toast('ok', n
      ? tr('copy.done', { n })
      : tr('copy.none'));
  }

  /* Сайт попросил записать в буфер текст с метками. Записываем сами, страница получает только «готово».
     Без свежего действия пользователя отказываем: иначе страница могла бы прочитать результат из буфера. */
  async function copyRestored({ items }) {
    if (!enabled || !rehydrateOn) throw new Error('rehydration off');
    if (!navigator.userActivation || !navigator.userActivation.isActive) throw new Error('no user activation');
    let n = 0;
    const out = (Array.isArray(items) ? items : []).map((it) => {
      const parts = {};
      for (const type of ['text/plain', 'text/html']) {
        if (typeof it[type] !== 'string') continue;
        const r = restore(it[type], type === 'text/html');
        if (type === 'text/plain') n += r.spans.length;
        parts[type] = new Blob([r.text], { type });
      }
      return new ClipboardItem(parts);
    });
    if (!out.length) throw new Error('empty');
    await navigator.clipboard.write(out);
    copied(n);
    return { ok: true };
  }

  function selectedText() {
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && typeof a.selectionStart === 'number') {
      return a.value.slice(a.selectionStart, a.selectionEnd);
    }
    return String(window.getSelection() || '');
  }

  function onCopy(e) {
    if (!enabled || !rehydrateOn || !e.clipboardData) return;
    const dt = e.clipboardData;
    if (e.defaultPrevented) {
      const plain = dt.getData('text/plain');
      const html = dt.getData('text/html');
      if (!TOKEN_TEST.test(plain) && !TOKEN_TEST.test(html)) return;
      const r = restore(plain);
      dt.setData('text/plain', r.text);
      if (html) dt.setData('text/html', restore(html, true).text);
      copied(r.spans.length);
      return;
    }
    const text = selectedText();
    if (!text || !TOKEN_TEST.test(text)) return;
    const r = restore(text);
    dt.setData('text/plain', r.text);
    e.preventDefault();
    copied(r.spans.length);
  }

  /* ---------- файлы: текстовые заменяются очищенной копией до того, как их увидит сайт ---------- */

  const TEXT_EXT = /\.(txt|text|csv|tsv|md|markdown|json|jsonl|ndjson|xml|ya?ml|toml|ini|conf|cfg|env|log|sql|html?|eml|vcf|ics|srt|vtt|tex|rtf|js|mjs|cjs|ts|tsx|jsx|py|rb|php|java|kt|go|rs|c|h|cc|cpp|hpp|cs|swift|sh|bash|zsh|ps1|properties)$/i;
  const TEXT_MIME = /^text\/|^application\/(json|ld\+json|xml|x-yaml|yaml|csv|sql|x-sh|javascript|x-ndjson)\b/i;
  const MAX_TEXT_FILE = 2 * 1024 * 1024;
  const MAX_DOC_FILE = 30 * 1024 * 1024;
  const PDF_COPY_PAGES = 30;
  const DOC_EXT = /\.(pdf|docx|docm|xlsx|xlsm|pptx|pptm)$/i;
  const DOC_MIME = /^application\/(pdf|vnd\.openxmlformats-officedocument\.)/i;
  const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?|avif|svg)$/i;
  const OCR_IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;
  const OCR_IMAGE_MIME = /^image\/(png|jpeg|gif|webp|bmp)$/i;
  const MAX_IMAGE_FILE = 20 * 1024 * 1024;
  const OFFICE_MIME = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    pdf: 'application/pdf',
  };
  const checkedFiles = new Set();
  const replayed = new WeakSet();
  const fileJobs = new WeakMap();
  const sigOf = (f) => [f.name, f.size, f.lastModified].join('|');
  const looksText = (f) => TEXT_EXT.test(f.name) || TEXT_MIME.test(f.type);
  const isTextFile = (f) => looksText(f) && f.size <= MAX_TEXT_FILE;
  const isDoc = (f) => DOC_EXT.test(f.name) || DOC_MIME.test(f.type);
  const isImage = (f) => /^image\//i.test(f.type) || IMAGE.test(f.name);
  const isReadableImage = (f) => OCR_IMAGE_MIME.test(f.type) || (!/^image\//i.test(f.type) && OCR_IMAGE.test(f.name));
  let askImages = true;
  let policy = {};

  function fileChecked({ sigs }) {
    return { checked: !enabled || (Array.isArray(sigs) && sigs.every((s) => checkedFiles.has(s))) };
  }

  function typesText(summary) {
    return Object.entries(summary.byType || {}).map(([type, n]) => `${I18N.label(type)} ×${n}`).join(', ');
  }

  /* ---------- вопрос пользователю: файл, который нельзя проверить или можно отправить копией ---------- */

  const askEl = $('.ask');
  let askChain = Promise.resolve();

  /* buttons: [{ id, label, primary }]. Ответ: { choice, option }. Escape = первая кнопка без primary. */
  function ask({ title, text, note, option, buttons }) {
    const run = askChain.then(() => new Promise((resolve) => {
      askEl.querySelector('.ask-title').textContent = title;
      askEl.querySelector('.ask-text').textContent = text;
      const noteEl = askEl.querySelector('.ask-note');
      noteEl.hidden = !note;
      noteEl.textContent = note || '';
      const opt = askEl.querySelector('.ask-opt');
      opt.hidden = !option;
      opt.querySelector('input').checked = false;
      opt.querySelector('span').textContent = option || '';
      const box = askEl.querySelector('.btns');
      box.textContent = '';
      const done = (choice) => {
        askEl.hidden = true;
        askEl.removeEventListener('keydown', onKey);
        resolve({ choice, option: !opt.hidden && opt.querySelector('input').checked });
      };
      const cancel = (buttons.find((b) => b.id === 'cancel') || buttons[0]).id;
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(cancel); } };
      askEl.addEventListener('keydown', onKey);
      let focus = null;
      for (const b of buttons) {
        const el = document.createElement('button');
        el.textContent = b.label;
        if (b.primary) { el.className = 'primary'; focus = el; }
        el.addEventListener('click', () => done(b.id));
        box.append(el);
      }
      askEl.hidden = false;
      (focus || box.firstChild).focus();
    }));
    askChain = run.catch(() => {});
    return run;
  }

  /* Файл, который Velami не проверил: уходит только после явного «отправить как есть». */
  async function askUnchecked(f, reason, extra = {}) {
    const image = reason === 'image';
    if (policy.allowUncheckedFiles === false) {
      await ask({
        title: tr('file.ask.title', { name: f.name }),
        text: tr('file.ask.' + reason, extra),
        note: tr('policy.fileBlocked') + (policy.supportContact ? ' ' + tr('policy.support', { contact: policy.supportContact }) : ''),
        buttons: [{ id: 'cancel', label: tr('policy.ok'), primary: true }],
      });
      return cancelled(f);
    }
    if (image && !askImages) return passUnchecked(f, reason);
    const r = await ask({
      title: tr('file.ask.title', { name: f.name }),
      text: tr('file.ask.' + reason, extra),
      option: image && !('askImages' in (policy.locked || {})) ? tr('file.ask.noImages') : '',
      buttons: image
        ? [{ id: 'cancel', label: tr('file.ask.cancel') }, { id: 'send', label: tr('file.ask.send'), primary: true }]
        : [{ id: 'send', label: tr('file.ask.send') }, { id: 'cancel', label: tr('file.ask.cancel'), primary: true }],
    });
    if (image && r.option) send({ type: 'setImagesAsk', ask: false }).catch(() => {});
    if (r.choice !== 'send') return cancelled(f);
    return passUnchecked(f, reason);
  }

  function passUnchecked(f, reason) {
    checkedFiles.add(sigOf(f));
    send({ type: 'log', entry: { kind: 'unchecked', host: location.host, file: f.name, note: tr('file.userSent', { why: tr('file.why.' + reason) }) } }).catch(() => {});
    return f;
  }

  function cancelled(f) {
    toast('ok', tr('file.cancelled', { name: f.name }), 5000);
    return null;
  }

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  const fromBase64 = (data) => Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));

  /* PDF и Office: текст достаёт offscreen-документ расширения. Если в тексте есть данные,
     пользователь выбирает: копия с метками в том же формате, оригинал или отмена. Длинный PDF
     (больше PDF_COPY_PAGES страниц) и документ, который не удалось собрать, уходят текстом. */
  async function cleanDoc(f) {
    if (f.size > MAX_DOC_FILE) return askUnchecked(f, 'big', { mb: 30 });
    toast('ok', tr('file.reading', { name: f.name }), 600000);
    const r = await send({ type: 'extractFile', name: f.name, data: toBase64(await f.arrayBuffer()) });
    toastEl.hidden = true;
    if (!r || r.error) throw new Error((r && r.error) || tr('err.noReply'));
    if (r.reason) return askUnchecked(f, r.reason === 'big' ? 'big' : r.reason, { mb: 30 });
    if (!String(r.text || '').trim()) return askUnchecked(f, 'notext');
    const m = await send({ type: 'maskBatch', texts: [r.text], trusted: [true], file: true });
    if (!m || m.error) throw new Error((m && m.error) || tr('err.noReply'));
    if (m.disabled) return f;
    const images = r.emptyPages || 0;
    const types = typesText(m.summary);
    const unnamed = !!m.summary.model;
    if (!m.summary.count) {
      if (unnamed) return askUnchecked(f, 'names');
      if (images) return askUnchecked(f, 'partial', { n: images });
      if (r.attachments) return askUnchecked(f, 'attachments', { n: r.attachments });
      checkedFiles.add(sigOf(f));
      send({ type: 'log', entry: { kind: 'file', host: location.host, file: f.name, summary: m.summary, body: r.text } }).catch(() => {});
      toast('ok', tr('file.clean', { name: f.name }), 6000);
      return f;
    }
    const office = r.kind !== 'pdf';
    const pdfSame = !office && !r.truncated && r.pages <= PDF_COPY_PAGES;
    const same = office || pdfSame;
    const sameName = office ? f.name.replace(/\.(doc|xls|ppt)m$/i, (x, k) => '.' + k + 'x') : f.name;
    const copyName = f.name + '.txt';
    const noOriginal = policy.allowOriginalFiles === false;
    const choice = await ask({
      title: tr('file.doc.title', { name: f.name }),
      text: office ? tr('file.doc.foundSame', { n: m.summary.count, types, copy: sameName })
        : pdfSame ? tr('file.doc.foundPdf', { n: m.summary.count, types, copy: sameName })
          : tr('file.doc.found', { n: m.summary.count, types, copy: copyName }),
      note: [unnamed ? tr('file.doc.names') : '', images ? tr('file.doc.pages', { n: images }) : '', r.truncated ? tr('file.doc.truncated', { n: 500 }) : '',
        office && r.images > (r.imagesRead || 0) ? tr('file.doc.images', { n: r.images - (r.imagesRead || 0) }) : '', office && (r.macros || r.objects) ? tr('file.doc.removed') : '',
        noOriginal ? tr('policy.noOriginal') : ''].filter(Boolean).join(' '),
      buttons: [
        { id: 'cancel', label: tr('file.ask.cancel') },
        noOriginal ? null : { id: 'original', label: tr('file.doc.original') },
        { id: 'clean', label: tr('file.doc.clean'), primary: true },
      ].filter(Boolean),
    });
    if (choice.choice === 'original' && !noOriginal) return passUnchecked(f, 'original');
    if (choice.choice !== 'clean') return cancelled(f);
    if (same) {
      if (pdfSame) toast('ok', tr('file.covering', { name: f.name }), 600000);
      const c = await send({ type: 'cleanDoc', name: f.name, data: toBase64(await f.arrayBuffer()), values: m.values || [] }).catch((e) => ({ error: String(e) }));
      if (pdfSame) toastEl.hidden = true;
      if (c && !c.error && c.data) {
        const file = new File([fromBase64(c.data)], c.name, { type: OFFICE_MIME[c.name.split('.').pop().toLowerCase()] || f.type, lastModified: f.lastModified });
        checkedFiles.add(sigOf(file));
        send({ type: 'log', entry: { kind: 'file', host: location.host, file: f.name, summary: m.summary, body: m.texts[0], note: tr('file.sameFormat', { copy: c.name }) } }).catch(() => {});
        toast('ok', tr('file.cleaned', { name: f.name, n: m.summary.count, types }) + ' ' + tr('file.sameFormat', { copy: c.name }), 7000);
        return file;
      }
    }
    const file = new File([m.texts[0]], copyName, { type: 'text/plain', lastModified: f.lastModified });
    checkedFiles.add(sigOf(file));
    const how = tr(same ? 'file.sameFailed' : 'file.converted', { copy: copyName });
    send({ type: 'log', entry: { kind: 'file', host: location.host, file: f.name, summary: m.summary, body: m.texts[0], note: how } }).catch(() => {});
    toast(same ? 'warn' : 'ok', tr('file.cleaned', { name: f.name, n: m.summary.count, types }) + ' ' + how, 7000);
    return file;
  }

  /* Картинка: текст на ней читает OCR в offscreen-документе. Без данных уходит та же картинка без
     метаданных (EXIF, GPS), с данными пользователь выбирает: та же картинка с закрытыми местами,
     оригинал или отмена. Копии в другом формате нет: если закрыть не вышло, картинка не уходит. */
  async function cleanImage(f) {
    if (f.size > MAX_IMAGE_FILE) return askUnchecked(f, 'big', { mb: 20 });
    toast('ok', tr('file.readingImage', { name: f.name }), 20000);
    const data = toBase64(await f.arrayBuffer());
    const r = await send({ type: 'extractFile', name: f.name, data });
    toastEl.hidden = true;
    if (!r || r.error) throw new Error((r && r.error) || tr('err.noReply'));
    if (r.reason) return askUnchecked(f, r.reason === 'unsupported' ? 'image' : r.reason, { mb: 20 });
    const metaNote = r.meta && r.meta.length ? ' ' + tr('file.img.meta') : '';
    const same = () => {
      if (!r.stripped) { checkedFiles.add(sigOf(f)); return f; }
      const file = new File([fromBase64(r.stripped)], f.name, { type: f.type, lastModified: f.lastModified });
      checkedFiles.add(sigOf(file));
      return file;
    };
    const text = String(r.text || '');
    if (!text.trim()) {
      send({ type: 'log', entry: { kind: 'file', host: location.host, file: f.name, summary: { count: 0, byType: {} }, note: tr('file.img.noText', { name: f.name }) + metaNote } }).catch(() => {});
      toast('ok', tr('file.img.noText', { name: f.name }) + metaNote, 6000);
      return same();
    }
    const m = await send({ type: 'maskBatch', texts: [text], trusted: [true], file: true });
    if (!m || m.error) throw new Error((m && m.error) || tr('err.noReply'));
    if (m.disabled) return f;
    const unnamed = !!m.summary.model;
    if (!m.summary.count) {
      if (unnamed) return askUnchecked(f, 'names');
      send({ type: 'log', entry: { kind: 'file', host: location.host, file: f.name, summary: m.summary, body: text } }).catch(() => {});
      toast('ok', tr('file.img.clean', { name: f.name }) + metaNote, 6000);
      return same();
    }
    const types = typesText(m.summary);
    const noOriginal = policy.allowOriginalFiles === false;
    const choice = await ask({
      title: tr('file.doc.title', { name: f.name }),
      text: tr('file.img.found', { n: m.summary.count, types }),
      note: [tr('file.img.note'), unnamed ? tr('file.doc.names') : '', noOriginal ? tr('policy.noOriginal') : ''].filter(Boolean).join(' '),
      buttons: [
        { id: 'cancel', label: tr('file.ask.cancel') },
        noOriginal ? null : { id: 'original', label: tr('file.doc.original') },
        { id: 'clean', label: tr('file.doc.clean'), primary: true },
      ].filter(Boolean),
    });
    if (choice.choice === 'original' && !noOriginal) return passUnchecked(f, 'original');
    if (choice.choice !== 'clean') return cancelled(f);
    toast('ok', tr('file.covering', { name: f.name }), 20000);
    const c = await send({ type: 'cleanDoc', name: f.name, data, values: m.values || [] }).catch((e) => ({ error: String(e) }));
    toastEl.hidden = true;
    if (!c || c.error || !c.data) {
      send({ type: 'log', entry: { kind: 'file', host: location.host, file: f.name, summary: m.summary, body: m.texts[0], note: tr('file.img.failed', { name: f.name }) } }).catch(() => {});
      toast('warn', tr('file.img.failed', { name: f.name }), 9000);
      return null;
    }
    const file = new File([fromBase64(c.data)], c.name, { type: c.type || f.type, lastModified: f.lastModified });
    checkedFiles.add(sigOf(file));
    send({ type: 'log', entry: { kind: 'file', host: location.host, file: f.name, summary: m.summary, body: m.texts[0], note: tr('file.img.sent') } }).catch(() => {});
    toast('ok', tr('file.cleaned', { name: f.name, n: m.summary.count, types }) + ' ' + tr('file.img.sent'), 7000);
    return file;
  }

  async function cleanFile(f) {
    const text = await f.text();
    if (text.includes('\u0000') || (text.match(/\uFFFD/g) || []).length > 8) return askUnchecked(f, 'other');
    const r = await send({ type: 'maskBatch', texts: [text], trusted: [true] });
    if (!r || r.error) throw new Error((r && r.error) || tr('err.noReply'));
    if (r.disabled) return f;
    const changed = r.summary.count > 0;
    const file = changed ? new File([r.texts[0]], f.name, { type: f.type || 'text/plain', lastModified: f.lastModified }) : f;
    checkedFiles.add(sigOf(file));
    send({
      type: 'log',
      entry: { kind: 'file', host: location.host, file: f.name, summary: r.summary, body: changed ? r.texts[0] : text },
    }).catch(() => {});
    const note = r.summary.model ? ' ' + tr(r.summary.model === 'partial' ? 'status.modelPartial' : 'status.modelSkipped') : '';
    toast(note ? 'warn' : 'ok', (changed
      ? tr('file.cleaned', { name: f.name, n: r.summary.count, types: typesText(r.summary) })
      : tr('file.clean', { name: f.name })) + note, 7000);
    return file;
  }

  async function checkFile(f) {
    if (isTextFile(f)) return cleanFile(f);
    if (looksText(f)) return askUnchecked(f, 'big', { mb: 2 });
    if (isDoc(f)) return cleanDoc(f);
    if (isReadableImage(f)) return cleanImage(f);
    return askUnchecked(f, isImage(f) ? 'image' : 'other');
  }

  async function cleanFiles(files) {
    const out = [];
    for (const f of files) {
      const r = await checkFile(f);
      if (r) out.push(r);
    }
    return out;
  }

  function fileFailed(name, err) {
    raise('bad', 'pill.fileFailed', tr('file.failed', { name, reason: (err && err.message) || err }));
  }

  function transfer(files, from) {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    for (const type of ['text/plain', 'text/html', 'text/uri-list']) {
      const v = from && from.getData(type);
      if (v) dt.setData(type, v);
    }
    return dt;
  }

  function replay(target, ev) {
    replayed.add(ev);
    target.dispatchEvent(ev);
  }

  /* Выбор файла: события input и change задерживаем, подменяем input.files и повторяем их. */
  function onFilePicked(e) {
    if (replayed.has(e) || !enabled) return;
    const input = e.composedPath()[0];
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
    let job = fileJobs.get(input);
    if (!job) {
      const files = [...(input.files || [])];
      if (!files.length) return;
      job = { seen: [] };
      fileJobs.set(input, job);
      cleanFiles(files).then(
        (out) => setTimeout(() => {
          fileJobs.delete(input);
          if (!out.length) { input.value = ''; return; }
          input.files = transfer(out).files;
          for (const type of job.seen) replay(input, new Event(type, { bubbles: true, composed: type === 'input' }));
        }, 0),
        (err) => {
          fileJobs.delete(input);
          input.value = '';
          fileFailed(files.map((f) => f.name).join(', '), err);
        },
      );
    }
    e.stopImmediatePropagation();
    if (!job.seen.includes(e.type)) job.seen.push(e.type);
  }

  /* Перетаскивание и вставка файла: останавливаем событие и повторяем его с очищенными файлами. */
  function onFileTransfer(e) {
    if (replayed.has(e) || !enabled) return;
    const data = e.type === 'drop' ? e.dataTransfer : e.clipboardData;
    const files = data ? [...data.files] : [];
    if (!files.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = e.composedPath()[0];
    const init = { bubbles: true, cancelable: true, composed: true };
    cleanFiles(files).then((out) => {
      if (!out.length) return;
      const dt = transfer(out, data);
      replay(target, e.type === 'drop'
        ? new DragEvent('drop', { ...init, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, dataTransfer: dt })
        : new ClipboardEvent('paste', { ...init, clipboardData: dt }));
    }, (err) => fileFailed(files.map((f) => f.name).join(', '), err));
  }

  window.addEventListener('input', onFilePicked, true);
  window.addEventListener('change', onFilePicked, true);
  window.addEventListener('drop', onFileTransfer, true);
  window.addEventListener('paste', onFileTransfer, true);

  function applyStorage(r) {
    const settings = r.settings || {};
    enabled = settings.enabled !== false;
    rehydrateOn = settings.rehydrate !== false;
    askImages = settings.askImages !== false;
    policy = r.policy || {};
    byToken = (r.vault && r.vault.byToken) || {};
    const before = I18N.lang;
    I18N.setLanguage(settings.language);
    I18N.apply(shadow);
    if (I18N.lang !== before) {
      toastEl.hidden = true;
      if (!alert) setStatus(null, '');
    }
    if (hookPort) hookPort.postMessage({ type: 'lang', lang: I18N.lang });
    setPill();
  }

  async function syncFromStorage() {
    const r = await chrome.storage.local.get(['vault', 'settings', 'policy']);
    applyStorage(r);
    if (document.body) scanTree(document.body);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.vault || changes.settings || changes.policy)) syncFromStorage().then(schedulePreview);
  });

  function mount() {
    const style = document.createElement('style');
    style.textContent = '::highlight(pg-restored) { background-color: rgba(201, 100, 66, .16); }';
    (document.head || document.documentElement).append(style);
    document.documentElement.append(host);
    window.addEventListener('copy', onCopy);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    syncFromStorage().finally(refreshPreview);
  }

  if (document.readyState === 'complete') mount();
  else window.addEventListener('load', () => setTimeout(mount, 500), { once: true });
})();
