/* Предпросмотр чистой копии. Копия лежит во вкладке чата (content.js) и приходит сюда через
   фоновый скрипт: в ней уже метки, настоящих значений на этой странице нет. Страницы PDF и
   картинки рисуются на canvas из байтов копии, без blob-адресов. */
const send = (msg) => chrome.runtime.sendMessage(msg);
const $ = (id) => document.getElementById(id);
const t = (key, params) => I18N.t(key, params);

const MAX_SHEETS = 30;

function withTokens(text) {
  const frag = document.createDocumentFragment();
  const re = PG.tokenRe();
  let cursor = 0;
  let m;
  while ((m = re.exec(text))) {
    frag.append(text.slice(cursor, m.index));
    const tok = document.createElement('span');
    tok.className = 'tok tok-' + m[1];
    tok.title = I18N.label(m[1]);
    tok.textContent = m[0];
    frag.append(tok);
    cursor = m.index + m[0].length;
  }
  frag.append(text.slice(cursor));
  return frag;
}

const fromBase64 = (data) => Uint8Array.from(atob(String(data || '')), (c) => c.charCodeAt(0));

function sizeText(n) {
  if (n < 1024) return t('preview.bytes', { n });
  if (n < 1024 * 1024) return t('preview.kb', { n: (n / 1024).toFixed(n < 10240 ? 1 : 0) });
  return t('preview.mb', { n: (n / 1024 / 1024).toFixed(1) });
}

async function digest(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function sheet(bytes, type, label) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  $('sheets').append(canvas);
  if (label) {
    const num = document.createElement('p');
    num.className = 'num';
    num.textContent = label;
    $('sheets').append(num);
  }
}

async function render() {
  const s = await send({ type: 'state' });
  I18N.setLanguage(s.settings.language);
  I18N.apply(document);

  const q = new URLSearchParams(location.hash.slice(1));
  const tab = Number(q.get('tab'));
  $('back').addEventListener('click', async () => {
    try {
      if (Number.isInteger(tab)) await chrome.tabs.update(tab, { active: true });
      const own = await chrome.tabs.getCurrent();
      if (own) { await chrome.tabs.remove(own.id); return; }
    } catch { /* вкладки чата уже нет */ }
    window.close();
  });

  const c = await send({ type: 'previewGet', tab, id: q.get('id') }).catch(() => null);
  if (!c || c.error || !c.data) {
    $('title').textContent = t('preview.title');
    $('gone').hidden = false;
    return;
  }
  const bytes = fromBase64(c.data);
  const hash = await digest(bytes);
  document.title = t('preview.titleOf', { name: c.name });
  $('title').textContent = t('preview.titleOf', { name: c.name });
  $('lead').textContent = t('preview.lead', { host: c.host, source: c.source });
  $('f-name').textContent = c.name;
  $('f-size').textContent = sizeText(bytes.length);
  $('f-found').textContent = Object.entries(c.byType || {}).map(([type, n]) => `${I18N.label(type)} ×${n}`).join(', ') || String(c.count || 0);
  $('f-hash').textContent = hash;
  $('facts').hidden = false;

  const ext = c.name.split('.').pop().toLowerCase();
  const isPdf = c.type === 'application/pdf';
  const isImage = /^image\//.test(c.type);
  const note = !c.same ? t('preview.noteText') : isPdf ? t('preview.notePdf') : isImage ? t('preview.noteImage') : t('preview.noteOffice');
  $('note').textContent = note;
  $('note').hidden = false;

  if (isPdf) {
    const images = __PGPdf.pageImages(bytes);
    for (let i = 0; i < Math.min(images.length, MAX_SHEETS); i++) await sheet(images[i], 'image/jpeg', t('preview.page', { n: i + 1, of: images.length }));
    $('pages').hidden = !images.length;
  } else if (isImage) {
    await sheet(bytes, c.type, '');
    $('pages').hidden = false;
  }

  const text = String(c.text || '').trim();
  if (text) {
    $('text-title').textContent = t(isImage ? 'preview.textImage' : isPdf ? 'preview.textPdf' : c.same ? 'preview.textOffice' : 'preview.textPlain');
    $('body').append(withTokens(text));
    $('text').hidden = false;
  }

  $('save').hidden = false;
  $('save').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([bytes], { type: c.type || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = c.name || 'copy.' + ext;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
}

render().catch((e) => {
  $('gone').hidden = false;
  $('gone').textContent = String((e && e.message) || e);
});
