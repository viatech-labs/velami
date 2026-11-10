/* Выполняется в контексте страницы (world: MAIN) до скриптов сайта.
   Каждое исходящее тело запроса (fetch, XHR, sendBeacon) и строка запроса GET проходят через шлюз:
   в полях сообщения работает полный поиск, в остальных полях заменяются только значения,
   найденные в набранном пользователем тексте. Служебные токены сайта не трогаются.
   WebSocket маскируется на сайтах, где через него уходит сообщение (sites.js), на остальных
   только проверяется. Мост к расширению не умеет раскрывать метки: копирование
   ответа с настоящими значениями выполняет изолированный мир, страница получает только «готово». */
(() => {
  'use strict';
  const walk = window.__PGWalk;
  const sites = window.__PGSites;
  const proto = window.__PGProto;
  for (const k of ['__PGWalk', '__PGSites', '__PGProto']) { try { delete window[k]; } catch { /* ignore */ } }
  if (!walk || !sites || !proto || window.__pgHooked) return;
  Object.defineProperty(window, '__pgHooked', { value: true });

  const site = sites.siteFor(location.host);
  const PREPARE_PATH = /\/prepare$/;

  const origFetch = window.fetch;
  const origBeacon = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;
  const origWsSend = window.WebSocket ? WebSocket.prototype.send : null;
  const clip = window.Clipboard ? Clipboard.prototype : null;
  const origWriteText = clip && clip.writeText;
  const origWrite = clip && clip.write;
  const HAS_TOKEN = /\[\[\s*[A-Z]+(?:_[A-Z]+)*[_ ]\d+\s*\]\]/;

  /* ---------- мост ---------- */

  let port = null;
  let seq = 0;
  const pending = new Map();
  let markReady;
  const ready = new Promise((r) => { markReady = r; });

  function attach(p) {
    port = p;
    port.onmessage = (e) => {
      if (e.data && e.data.type === 'lang') { if (TEXT[e.data.lang]) lang = e.data.lang; return; }
      const { id, ok, result, error } = e.data || {};
      const h = pending.get(id);
      if (!h) return;
      pending.delete(id);
      if (ok) h.resolve(result); else h.reject(new Error(error));
    };
    markReady();
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__pg !== 'hello' || port) return;
    const ch = new MessageChannel();
    attach(ch.port1);
    window.postMessage({ __pg: 'port' }, '*', [ch.port2]);
  });
  window.postMessage({ __pg: 'hook-ready' }, '*');

  const timeout = (ms, msg) => new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms));

  async function rpc(type, payload, ms = 8000) {
    await Promise.race([ready, timeout(3000, say('noReply'))]);
    return Promise.race([
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        port.postMessage({ id, type, payload });
      }),
      timeout(ms, say('timeout')),
    ]);
  }

  const emit = (payload) => { if (port) port.postMessage({ type: 'event', payload }); };

  /* Строки, которые страница показывает сама (ошибка fetch, запись в журнал). Язык присылает расширение. */
  const TEXT = {
    en: { noReply: 'the extension is not responding', timeout: 'the extension did not reply in time', blocked: 'Velami stopped the message: {reason}. Reload the page.', unchecked: 'File or binary data. Not checked in this version.', dropped: 'Typing suggestions were not sent: the site sends the text letter by letter, before it can be checked.' },
    it: { noReply: 'l’estensione non risponde', timeout: 'l’estensione non ha risposto in tempo', blocked: 'Velami ha bloccato l’invio: {reason}. Ricarica la pagina.', unchecked: 'File o dati binari. In questa versione non vengono controllati.', dropped: 'I suggerimenti durante la scrittura non sono stati inviati: il sito manda il testo lettera per lettera, prima che si possa controllarlo.' },
    ru: { noReply: 'расширение не отвечает', timeout: 'расширение не ответило вовремя', blocked: 'Velami остановил отправку: {reason}. Перезагрузите страницу.', unchecked: 'Файл или двоичные данные. В этой версии не проверяются.', dropped: 'Подсказки при наборе не отправлены: сайт шлёт текст по буквам, раньше, чем его можно проверить.' },
  };
  const navLang = String(navigator.language || '').slice(0, 2).toLowerCase();
  let lang = TEXT[navLang] ? navLang : 'en';
  const say = (key, params) => TEXT[lang][key].replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? params[k] : m));

  /* ---------- форма тела запроса ---------- */

  const FORM_RE = /^[\w.\-%*~]+=[^&]*(?:&[\w.\-%*~]+=[^&]*)*$/;
  const isFile = (v) => typeof File !== 'undefined' && v instanceof File;

  /* Части тела: строка или вложенная форма (JSON внутри строки, protobuf в base64).
     strings и userText плоские, rebuild раздаёт новые строки частям по порядку. */
  function composite(parts, finish) {
    const strings = [];
    const userText = [];
    let raw = false;
    for (const p of parts) {
      if (p.sub) { strings.push(...p.sub.strings); userText.push(...p.sub.userText); raw = raw || !!p.sub.raw; } else { strings.push(p.value); userText.push(p.user); }
    }
    return {
      strings, userText, raw,
      rebuild(m) {
        let j = 0;
        const values = parts.map((p) => {
          if (!p.sub) return m[j++];
          const n = p.sub.strings.length;
          const v = p.sub.rebuild(m.slice(j, j + n));
          j += n;
          return v;
        });
        return finish(values);
      },
    };
  }

  /* Строка, внутри которой JSON или protobuf. depth ограничивает вложенность. */
  function nested(value, key, depth) {
    if (depth > 3 || typeof value !== 'string' || value.length < 8) return null;
    const t = value.trim();
    if (t[0] === '[' || t[0] === '{') {
      try {
        const inner = JSON.parse(value);
        if (inner && typeof inner === 'object') return jsonShape(inner, depth + 1);
      } catch { /* не JSON */ }
    }
    if (site && site.proto && site.proto.test(key)) {
      const msg = proto.open(value);
      if (msg) {
        return {
          strings: msg.strings,
          userText: msg.strings.map((s) => walk.looksLikeText(s)),
          raw: true,
          rebuild: (m) => msg.rebuild(m),
        };
      }
    }
    return null;
  }

  function jsonShape(obj, depth = 0) {
    const refs = walk.collect(obj);
    const parts = refs.map((r) => {
      const v = r.holder[r.k];
      const sub = nested(v, r.key, depth);
      return sub ? { sub } : { value: v, user: walk.isUserText(r, site, v) };
    });
    return composite(parts, (values) => { refs.forEach((r, i) => { r.holder[r.k] = values[i]; }); return JSON.stringify(obj); });
  }

  function formShape(params, asObject) {
    const entries = [...params];
    const parts = entries.map(([k, v]) => {
      const sub = nested(v, k, 0);
      return sub ? { sub } : { value: v, user: walk.isUserText({ key: k }, site, v) };
    });
    return composite(parts, (values) => {
      const p = new URLSearchParams();
      entries.forEach(([k], i) => p.append(k, values[i]));
      return asObject ? p : p.toString();
    });
  }

  function formDataShape(fd) {
    const entries = [...fd];
    const idx = [];
    entries.forEach(([, v], i) => { if (typeof v === 'string') idx.push(i); });
    return {
      files: entries.map(([, v]) => v).filter(isFile),
      strings: idx.map((i) => entries[i][1]),
      userText: idx.map((i) => walk.isUserText({ key: entries[i][0] }, site, entries[i][1])),
      rebuild(m) {
        const out = new FormData();
        let j = 0;
        for (const [k, v] of entries) {
          if (typeof v === 'string') out.append(k, m[j++]);
          else out.append(k, v, isFile(v) ? v.name : undefined);
        }
        return out;
      },
    };
  }

  function shapeOf(body, contentType) {
    if (body instanceof URLSearchParams) return formShape(body, true);
    if (typeof FormData !== 'undefined' && body instanceof FormData) return formDataShape(body);
    if (typeof body !== 'string') return null;
    const t = body.trim();
    if (t[0] === '{' || t[0] === '[') {
      try { return jsonShape(JSON.parse(body)); } catch { /* не JSON */ }
    }
    if (/x-www-form-urlencoded/i.test(contentType) || (t.length < 200000 && FORM_RE.test(t))) {
      return formShape(new URLSearchParams(body), false);
    }
    return { strings: [body], userText: [true], rebuild: (m) => m[0] };
  }

  function contentTypeOf(init, req) {
    try { return new Headers((init && init.headers) || (req && req.headers) || {}).get('content-type') || ''; } catch { return ''; }
  }

  /* ---------- общая обработка ---------- */

  function preview(body) {
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    return null;
  }

  /* Готовое тело с protobuf перечитывается целиком: набранные значения не должны остаться
     ни в одной строке, даже если разбор принял строку за вложенное сообщение. */
  function readableBody(body) {
    const text = typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : '';
    if (!text) return '';
    const parts = [];
    try {
      for (const [k, v] of new URLSearchParams(text)) parts.push(site && site.proto && site.proto.test(k) ? proto.readable(v) : v);
    } catch { /* не форма */ }
    return parts.join('\n');
  }

  async function process(url, method, shape, original) {
    const isSend = sites.isSend(site, url, location.host) && shape.userText.some(Boolean);
    const texts = shape.strings;
    if (!texts.length || texts.every((t) => !t || t.length < 3)) return { changed: false };
    const result = await rpc('maskBatch', { texts, trusted: shape.userText.map((u) => isSend && u) });
    if (result.disabled) return { changed: false };
    const changed = result.summary.count > 0;
    const body = changed ? shape.rebuild(result.texts) : original;
    if (changed && shape.raw) {
      const left = await rpc('scan', { host: url.host, path: url.pathname, text: readableBody(body).slice(0, 50000), verify: true });
      if (left && left.leak) throw new Error('recheck');
    }
    if (isSend || changed) {
      const shown = isSend ? result.texts.filter((_, i) => shape.userText[i]) : [];
      rpc('log', {
        entry: {
          kind: 'sent', channel: isSend ? 'model' : 'other', host: url.host, path: url.pathname, method,
          summary: result.summary, texts: shown.slice(0, 20), body: preview(body) ?? '[FormData]',
        },
      }).catch(() => {});
      if (isSend && !PREPARE_PATH.test(url.pathname)) emit({ event: 'sent', path: url.pathname, summary: result.summary });
      else if (result.summary.count > 0) emit({ event: 'masked-other', host: url.host, count: result.summary.count });
    }
    return { changed, body };
  }

  function blocked(url, method, err) {
    const reason = err && err.message ? err.message : String(err);
    emit({ event: 'blocked', path: url.pathname, reason });
    rpc('log', { entry: { kind: 'blocked', host: url.host, path: url.pathname, method, reason } }).catch(() => {});
    return new TypeError(say('blocked', { reason }));
  }

  function reportUnchecked(url, method) {
    emit({ event: 'unchecked', host: url.host });
    rpc('log', {
      entry: { kind: 'unchecked', host: url.host, path: url.pathname, method, note: say('unchecked') },
    }).catch(() => {});
  }

  /* Текстовые файлы изолированный мир заменяет очищенной копией ещё при выборе. Здесь только
     спрашиваем, прошёл ли файл проверку, и предупреждаем, если нет. */
  const sigOf = (f) => [f.name, f.size, f.lastModified].join('|');
  function noteFiles(url, method, files) {
    if (!files || !files.length) return;
    rpc('fileChecked', { sigs: files.map(sigOf) }, 3000)
      .then((r) => { if (!r || !r.checked) reportUnchecked(url, method); }, () => reportUnchecked(url, method));
  }

  function scanLater(url, text) {
    if (!text || text.length < 8) return;
    rpc('scan', { host: url.host, path: url.pathname, text: text.slice(0, 50000) })
      .then((r) => { if (r && r.leak) emit({ event: 'leak', host: url.host }); })
      .catch(() => {});
  }

  async function maskQuery(url, method) {
    if (url.search.length < 8) return url;
    const shape = formShape(url.searchParams, true);
    const r = await process(url, method, shape, null);
    if (!r.changed) return url;
    const next = new URL(url);
    next.search = r.body.toString();
    return next;
  }

  /* Пока страница загружает файл, сайт может держать сообщение у себя и отправить его модели
     после загрузки (Claude: PDF, снято 10/11/2026). Изолированный мир на это время продлевает
     ожидание отправки, иначе тревога «в обход» срабатывает зря. */
  const isBinary = (b) => b instanceof Blob || b instanceof ArrayBuffer || ArrayBuffer.isView(b);
  let uploads = 0;
  function uploading(on, promise) {
    if (!on) return promise;
    emit({ event: 'upload', active: ++uploads });
    const done = () => emit({ event: 'upload', active: --uploads });
    promise.then(done, done);
    return promise;
  }

  /* ---------- fetch ---------- */

  async function guardedFetch(input, init) {
    const args = [input, init];
    const req = input instanceof Request ? input : null;
    let url;
    let method;
    try {
      url = new URL(req ? req.url : String(input), location.href);
      method = String((init && init.method) || (req && req.method) || 'GET').toUpperCase();
    } catch {
      return Reflect.apply(origFetch, window, args);
    }

    try {
      if (method === 'GET' || method === 'HEAD') {
        const next = await maskQuery(url, method);
        if (next === url) return Reflect.apply(origFetch, window, args);
        return Reflect.apply(origFetch, window, [req ? new Request(next, req) : next.href, init]);
      }

      const hasInitBody = !!init && init.body != null;
      let body = hasInitBody ? init.body : null;
      if (!hasInitBody && req) {
        try { body = await req.clone().text(); } catch { body = null; }
      }
      if (body == null || body === '') return Reflect.apply(origFetch, window, args);

      const shape = shapeOf(body, contentTypeOf(init, req));
      if (!shape) {
        if (isFile(body)) noteFiles(url, method, [body]);
        else if (method === 'PUT' && (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body))) reportUnchecked(url, method);
        return uploading(isBinary(body), Reflect.apply(origFetch, window, args));
      }
      noteFiles(url, method, shape.files);
      const up = !!(shape.files && shape.files.length);

      const r = await process(url, method, shape, body);
      if (!r.changed) return uploading(up, Reflect.apply(origFetch, window, args));
      if (req && !hasInitBody) return uploading(up, Reflect.apply(origFetch, window, [new Request(req, { body: r.body })]));
      return uploading(up, Reflect.apply(origFetch, window, [input, { ...init, body: r.body }]));
    } catch (err) {
      throw blocked(url, method, err);
    }
  }

  window.fetch = guardedFetch;

  /* ---------- sendBeacon: ответ сразу, отправка после проверки ---------- */

  if (origBeacon) {
    navigator.sendBeacon = function (u, data) {
      let url;
      try { url = new URL(u, location.href); } catch { return origBeacon(u, data); }
      if (data == null) return origBeacon(u, data);
      (async () => {
        let body = data;
        let type = '';
        if (data instanceof Blob && !isFile(data) && data.size < 500000) { type = data.type; body = await data.text(); }
        const shape = shapeOf(body, type);
        if (!shape) { origBeacon(u, data); return; }
        const r = await process(url, 'POST', shape, body);
        if (!r.changed) { origBeacon(u, data); return; }
        origBeacon(u, typeof r.body === 'string' && type ? new Blob([r.body], { type }) : r.body);
      })().catch((err) => blocked(url, 'POST', err));
      return true;
    };
  }

  /* ---------- XHR: асинхронные запросы ждут проверки ---------- */

  XMLHttpRequest.prototype.open = function (m, u, async, ...rest) {
    try { this.__pg = { url: new URL(u, location.href), method: String(m).toUpperCase(), async: async !== false }; } catch { this.__pg = null; }
    return Reflect.apply(origXhrOpen, this, arguments.length > 2 ? [m, u, async, ...rest] : [m, u]);
  };
  XMLHttpRequest.prototype.send = function (data) {
    const meta = this.__pg;
    const shape = meta && data != null ? shapeOf(data, '') : null;
    if (meta && meta.async && (isBinary(data) || (shape && shape.files && shape.files.length))) {
      uploading(true, new Promise((resolve) => this.addEventListener('loadend', resolve, { once: true })));
    }
    if (!shape) {
      if (meta && isFile(data)) noteFiles(meta.url, meta.method, [data]);
      return Reflect.apply(origXhrSend, this, [data]);
    }
    noteFiles(meta.url, meta.method, shape.files);
    if (!meta.async) {
      const text = preview(data);
      if (text) scanLater(meta.url, text);
      return Reflect.apply(origXhrSend, this, [data]);
    }
    process(meta.url, meta.method, shape, data).then(
      (r) => Reflect.apply(origXhrSend, this, [r.changed ? r.body : data]),
      (err) => {
        blocked(meta.url, meta.method, err);
        this.dispatchEvent(new ProgressEvent('error'));
        this.dispatchEvent(new ProgressEvent('loadend'));
      },
    );
    return undefined;
  };

  /* ---------- WebSocket ----------
     Канал отправки сообщения (sites.js wsSend) маскируется: кадры встают в очередь сокета
     и уходят по порядку после проверки. Подсказки по буквам (dropWs) не отправляются,
     остальные кадры только проверяются. */

  const wsQueues = new WeakMap();
  const droppedHosts = new Set();

  function wsMask(ws, url, data) {
    const prev = wsQueues.get(ws) || Promise.resolve();
    const next = prev.then(async () => {
      let out = data;
      let shape = null;
      try { shape = jsonShape(JSON.parse(data)); } catch { /* не JSON */ }
      if (shape) {
        const r = await process(url, 'WS', shape, data);
        if (r.changed) out = r.body;
      }
      if (ws.readyState === WebSocket.OPEN) Reflect.apply(origWsSend, ws, [out]);
    }).catch((err) => {
      blocked(url, 'WS', err);
      try { ws.close(4000, 'Velami'); } catch { /* ignore */ }
    });
    wsQueues.set(ws, next);
  }

  function wsDrop(url) {
    if (droppedHosts.has(url.host)) return;
    droppedHosts.add(url.host);
    rpc('log', { entry: { kind: 'dropped', host: url.host, path: url.pathname, method: 'WS', note: say('dropped') } }).catch(() => {});
  }

  if (origWsSend) {
    WebSocket.prototype.send = function (data) {
      let url = null;
      try { url = new URL(this.url); } catch { /* ignore */ }
      const mode = url ? sites.wsMode(site, url) : 'scan';
      if (mode === 'drop') { wsDrop(url); return undefined; }
      if (mode === 'mask' && typeof data === 'string') { wsMask(this, url, data); return undefined; }
      if (url && typeof data === 'string') scanLater(url, data);
      return Reflect.apply(origWsSend, this, [data]);
    };
  }

  /* ---------- буфер обмена: текст с метками записывает расширение, уже с настоящими значениями ---------- */

  async function textItems(items) {
    const out = [];
    let tokens = false;
    for (const item of items) {
      const entry = {};
      for (const type of item.types) {
        if (type !== 'text/plain' && type !== 'text/html') return null;
        const s = await (await item.getType(type)).text();
        if (HAS_TOKEN.test(s)) tokens = true;
        entry[type] = s;
      }
      out.push(entry);
    }
    return tokens ? out : null;
  }

  if (origWriteText) {
    clip.writeText = function (data) {
      const text = String(data);
      if (!port || !HAS_TOKEN.test(text)) return Reflect.apply(origWriteText, this, [data]);
      return rpc('copy', { items: [{ 'text/plain': text }] }, 3000)
        .then(() => undefined, () => Reflect.apply(origWriteText, this, [data]));
    };
  }
  if (origWrite) {
    clip.write = async function (items) {
      let payload = null;
      try { payload = port && items && items.length ? await textItems(items) : null; } catch { payload = null; }
      if (!payload) return Reflect.apply(origWrite, this, [items]);
      try { await rpc('copy', { items: payload }, 3000); } catch { return Reflect.apply(origWrite, this, [items]); }
      return undefined;
    };
  }
})();
