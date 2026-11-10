/* Текст из документов Office (docx, xlsx, pptx): это zip с XML внутри. Распаковка встроенным
   DecompressionStream, без сторонних библиотек. Работает в offscreen-документе и в тестах. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__PGOffice = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MAX_ENTRY = 64 * 1024 * 1024;
  const MAX_TOTAL = 160 * 1024 * 1024;
  const utf8 = new TextDecoder('utf-8');

  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

  /* Оглавление zip: имя, способ сжатия, контрольная сумма, размеры, смещение. Zip64 не нужен: документы меньше 4 ГБ. */
  function entries(bytes) {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (u32(bytes, i) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error('not a zip');
    const count = u16(bytes, end + 10);
    let p = u32(bytes, end + 16);
    const out = new Map();
    for (let n = 0; n < count; n++) {
      if (u32(bytes, p) !== 0x02014b50) throw new Error('broken zip');
      const method = u16(bytes, p + 10);
      const time = u16(bytes, p + 12);
      const date = u16(bytes, p + 14);
      const crc = u32(bytes, p + 16);
      const size = u32(bytes, p + 20);
      const usize = u32(bytes, p + 24);
      const nameLen = u16(bytes, p + 28);
      const extraLen = u16(bytes, p + 30);
      const commentLen = u16(bytes, p + 32);
      const offset = u32(bytes, p + 42);
      const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      out.set(name, { method, time, date, crc, size, usize, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  async function inflate(data, limit) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const parts = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { reader.cancel().catch(() => {}); throw new Error('too large'); }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  }

  function opener(bytes) {
    const list = entries(bytes);
    let used = 0;
    const stored = (e) => {
      const h = e.offset;
      if (u32(bytes, h) !== 0x04034b50) throw new Error('broken zip');
      const start = h + 30 + u16(bytes, h + 26) + u16(bytes, h + 28);
      return bytes.subarray(start, start + e.size);
    };
    const readBytes = async (name) => {
      const e = list.get(name);
      if (!e) return null;
      const data = stored(e);
      const limit = Math.min(MAX_ENTRY, MAX_TOTAL - used);
      const raw = e.method === 0 ? data : e.method === 8 ? await inflate(data, limit) : null;
      if (!raw) throw new Error('unsupported zip method');
      if (raw.length > limit) throw new Error('too large');
      used += raw.length;
      return raw;
    };
    return {
      names: [...list.keys()],
      readBytes,
      async read(name) {
        const raw = await readBytes(name);
        return raw && utf8.decode(raw);
      },
      raw(name) {
        const e = list.get(name);
        return { ...e, data: stored(e) };
      },
    };
  }

  const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITY[e.toLowerCase()];
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  });
  const byNumber = (a, b) => (parseInt(a.match(/\d+/) || 0, 10) - parseInt(b.match(/\d+/) || 0, 10)) || a.localeCompare(b);

  const toXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /* Word: абзацы построчно, строка таблицы одной строкой, ячейки через табуляцию. */
  function wordText(xml) {
    const flat = xml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (tr) => {
      const cells = [...tr.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) => wordText(c[0]).replace(/\s*\n\s*/g, ' '));
      return `<w:p><w:t>${toXml(cells.join('\t'))}</w:t></w:p>`;
    });
    const lines = [];
    for (const para of flat.split(/<\/w:p>/)) {
      let line = '';
      const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
      let m;
      while ((m = re.exec(para))) {
        if (m[1] !== undefined) line += unxml(m[1]);
        else line += m[0] === '<w:tab/>' ? '\t' : '\n';
      }
      if (line.trim()) lines.push(line);
    }
    return lines.join('\n');
  }

  async function docx(zip) {
    const parts = ['word/document.xml', ...zip.names.filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n)).sort(byNumber),
      'word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml'];
    const out = [];
    for (const name of parts) {
      const xml = await zip.read(name);
      if (xml) { const t = wordText(xml); if (t) out.push(t); }
    }
    return out.join('\n\n');
  }

  const colIndex = (ref) => {
    const letters = (ref || '').match(/^[A-Z]+/);
    if (!letters) return -1;
    let n = 0;
    for (const ch of letters[0]) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  };
  const runs = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => unxml(m[1])).join('');

  /* Excel: каждый лист отдельным блоком, строки построчно, ячейки через табуляцию на своих местах. */
  async function xlsx(zip) {
    const shared = [];
    const sst = await zip.read('xl/sharedStrings.xml');
    if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runs(m[1]));
    const book = (await zip.read('xl/workbook.xml')) || '';
    const rels = (await zip.read('xl/_rels/workbook.xml.rels')) || '';
    const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      (m[0].match(/\bId="([^"]+)"/) || [])[1], (m[0].match(/\bTarget="([^"]+)"/) || [])[1]]));
    const sheets = [...book.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
      name: unxml((m[0].match(/\bname="([^"]*)"/) || [])[1] || ''),
      path: (() => {
        const t = target.get((m[0].match(/\br:id="([^"]+)"/) || [])[1]) || '';
        return t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
      })(),
    }));
    const out = [];
    for (const sheet of sheets) {
      const xml = await zip.read(sheet.path);
      if (!xml) continue;
      const rows = [];
      for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = c[1];
          const body = c[2] || '';
          const type = (attrs.match(/\bt="([^"]+)"/) || [])[1];
          const v = (body.match(/<v>([^<]*)<\/v>/) || [])[1];
          let value = '';
          if (type === 's') value = shared[parseInt(v, 10)] || '';
          else if (type === 'inlineStr') value = runs(body);
          else if (v !== undefined) value = unxml(v);
          if (!value) continue;
          const at = colIndex((attrs.match(/\br="([^"]+)"/) || [])[1]);
          cells[at >= 0 ? at : cells.length] = value.replace(/[\t\n]+/g, ' ');
        }
        if (cells.length) rows.push(Array.from(cells, (x) => x || '').join('\t'));
      }
      if (rows.length) out.push(`[${sheet.name}]\n` + rows.join('\n'));
    }
    return out.join('\n\n');
  }

  /* PowerPoint: слайды по порядку, абзацы построчно. */
  async function pptx(zip) {
    const slides = zip.names.filter((n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
    const order = (n) => (n.includes('notes') ? 100000 : 0) + parseInt(n.match(/(\d+)\.xml$/)[1], 10);
    slides.sort((a, b) => order(a) - order(b));
    const out = [];
    for (const name of slides) {
      const xml = await zip.read(name);
      const lines = xml.split(/<\/a:p>/).map(runsA).filter((l) => l.trim());
      if (lines.length) out.push(lines.join('\n'));
    }
    return out.join('\n\n');
  }
  const runsA = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => unxml(m[1])).join('');

  const KINDS = { docx, xlsx, pptx };
  const kindOf = (name) => {
    const m = /\.(docx|docm|xlsx|xlsm|pptx|pptm)$/i.exec(name || '');
    return m ? m[1].slice(0, 3).toLowerCase() + 'x' : null;
  };

  /* ---------- весь документ: каждая XML-часть пакета ----------
     Кроме основного текста данные лежат в метаданных, комментариях и их авторах, удалённом тексте
     правок, полях и ссылках, диаграммах, SmartArt, именах листов, сводных таблицах, вложенных
     документах. Разбор находит в них куски текста (units), очистка заменяет найденное прямо в XML,
     сохраняя оформление. Кусок текста Word или DrawingML — абзац целиком: имя, разорванное на
     несколько фрагментов с разным оформлением, ищется как одно. */

  const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|[^<]+/g;
  const ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  const HAS_TEXT = /[\p{L}\p{N}]/u;

  const GROUP = new Set(['w:p', 'a:p', 'si', 'is', 'text']);
  const GROUP_TEXT = new Set(['w:t', 'w:delText', 'a:t', 't']);
  const PRESERVE = new Set(['w:t', 'w:delText', 't']);
  const SEP = { 'w:tab': '\t', 'w:br': '\n', 'w:cr': '\n', 'a:br': '\n' };
  /* Кто автор и где работает: имя, логин, компания. Это не проверяется, а стирается всегда. */
  const BLANK_TEXT = { 'dc:creator': '', 'cp:lastModifiedBy': '', Company: '', Manager: '', HyperlinkBase: '' };
  const BLANK_ATTR = { 'w:author': 'Velami', 'w:initials': 'V', 'w15:author': 'Velami', 'w15:userId': 'Velami', 'w15:providerId': 'None' };
  const AUTHOR_TAG = /(^|:)(cmAuthor|author|person)$/;
  const AUTHOR_ATTR = { name: 'Velami', displayName: 'Velami', initials: 'V', userId: 'Velami', providerId: 'None' };
  const TEXT_ATTR = new Set(['name', 'v', 'caption', 'title', 'descr', 'tooltip', 'display', 'displayName', 'text', 'prompt', 'error',
    'promptTitle', 'errorTitle', 'w:instr', 'sheet', 'Target']);
  /* В именах листов, именованных диапазонах и формулах скобки метки ломают файл: там метка без скобок. */
  const BARE_TEXT = new Set(['f', 'c:f', 'definedName']);
  const bareAttr = (tag, key) => (tag === 'sheet' && key === 'name') || (tag === 'definedName' && key === 'name')
    || (tag === 'table' && (key === 'name' || key === 'displayName')) || key === 'sheet';
  /* Колонтитулы Excel: коды &L, &C, &"Arial,Bold", &12 стоят вплотную к тексту. */
  const HEADER = /^(odd|even|first)(Header|Footer)$/;
  const HEADER_CODE = /&(?:"[^"]*"|\d+|[A-Za-z&])/g;
  const MACRO_TYPES = {
    'application/vnd.ms-word.document.macroEnabled.main+xml': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    'application/vnd.ms-excel.sheet.macroEnabled.main+xml': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml': 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  };
  const REMOVE = /(^|\/)vbaProject\.bin(\.rels)?$|(^|\/)vbaData\.xml$|^docProps\/thumbnail\.[a-z]+$|^_xmlsignatures\//i;
  const IMAGE_PART = /(^|\/)media\/[^/]+\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|webp|wdp)$/i;
  const READABLE = {
    docx: /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/,
    xlsx: /^xl\/(sharedStrings\.xml|worksheets\/[^/]+\.xml)$/,
    pptx: /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/,
  };
  const MAX_DEPTH = 3;

  const attrXml = (s) => toXml(s).replace(/"/g, '&quot;');

  function resolvePart(relsName, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = (relsName.replace(/_rels\/[^/]*$/, '') + target).split('/');
    const out = [];
    for (const x of parts) {
      if (x === '..') out.pop();
      else if (x && x !== '.') out.push(x);
    }
    return out.join('/');
  }

  function scanXml(name, xml, { removed, readable }) {
    const units = [];
    const repls = [];
    const stack = [];
    const groups = [];
    const sheet = /^xl\/worksheets\/[^/]+\.xml$/.test(name);
    const comments = /^xl\/comments(\d*|\/[^/]+)\.xml$/.test(name);
    const rels = /\.rels$/.test(name);
    const types = name === '[Content_Types].xml';
    let cell = null;

    /* Стираемые поля тоже проверяются: если имя есть только в авторе, файл всё равно нужно очистить. */
    const meta = (text) => { if (HAS_TEXT.test(text)) units.push({ text, segs: [], covered: false, blank: true }); };
    const finish = (g) => {
      let text = '';
      for (const sg of g.segs) { sg.at = text.length; sg.len = sg.text.length; text += sg.text; }
      if (HAS_TEXT.test(text)) units.push({ text, segs: g.segs, covered: readable && !g.del });
    };
    const onAttrs = (tag, attrs, at, tagStart, tagEnd) => {
      if (rels && tag === 'Relationship') {
        const target = unxml((attrs.match(/\bTarget="([^"]*)"/) || [])[1] || '');
        if (!/\bTargetMode="External"/.test(attrs) && removed.has(resolvePart(name, target))) {
          repls.push({ s: tagStart, e: tagEnd, str: '' });
          return;
        }
      }
      if (types && tag === 'Override' && removed.has(unxml((attrs.match(/\bPartName="([^"]*)"/) || [])[1] || '').replace(/^\//, ''))) {
        repls.push({ s: tagStart, e: tagEnd, str: '' });
        return;
      }
      for (const a of attrs.matchAll(ATTR)) {
        const key = a[1];
        const val = a[3] !== undefined ? a[3] : a[4];
        const s = at + a.index + a[0].length - val.length - 1;
        const e = s + val.length;
        const blank = key in BLANK_ATTR ? BLANK_ATTR[key] : AUTHOR_TAG.test(tag) && key in AUTHOR_ATTR ? AUTHOR_ATTR[key] : null;
        if (blank !== null) {
          if (val !== blank) { repls.push({ s, e, str: blank }); meta(unxml(val)); }
          continue;
        }
        if (types && key === 'ContentType' && MACRO_TYPES[val]) { repls.push({ s, e, str: MACRO_TYPES[val] }); continue; }
        if (!TEXT_ATTR.has(key)) continue;
        if (key === 'Target' && !(tag === 'Relationship' && /\bTargetMode="External"/.test(attrs))) continue;
        const text = unxml(val);
        if (!HAS_TEXT.test(text)) continue;
        units.push({ text, segs: [{ kind: 'attr', text, at: 0, len: text.length, s, e }], bare: bareAttr(tag, key), covered: false });
      }
    };

    TAG.lastIndex = 0;
    let m;
    while ((m = TAG.exec(xml))) {
      const raw = m[0];
      const start = m.index;
      const end = start + raw.length;
      if (m[2]) {
        const tag = m[2];
        if (m[1]) {
          let i = stack.length - 1;
          while (i >= 0 && stack[i].tag !== tag) i--;
          if (i >= 0) stack.length = i;
          if (groups.length && groups[groups.length - 1].tag === tag) finish(groups.pop());
          if (tag === 'c' && cell) { cell.e = end; cell = null; }
          continue;
        }
        onAttrs(tag, m[3], start + 1 + tag.length, start, end);
        if (SEP[tag] && groups.length) groups[groups.length - 1].segs.push({ kind: 'sep', text: SEP[tag] });
        if (m[4]) continue;
        stack.push({ tag, s: start });
        if (GROUP.has(tag) && (tag !== 'text' || comments)) groups.push({ tag, segs: [], del: false });
        if (tag === 'c' && sheet) cell = { s: start, attrs: m[3], t: (m[3].match(/\bt="([^"]*)"/) || [])[1] || 'n' };
        continue;
      }
      if (raw[0] === '<') continue;
      const top = stack[stack.length - 1];
      const parent = top ? top.tag : '';
      if (parent in BLANK_TEXT || (parent === 'author' && comments)) {
        const str = parent === 'author' ? 'Velami' : BLANK_TEXT[parent];
        if (raw !== str) { repls.push({ s: start, e: end, str }); meta(unxml(raw)); }
        continue;
      }
      const text = unxml(raw);
      const g = groups[groups.length - 1];
      if (g && GROUP_TEXT.has(parent)) {
        g.segs.push({ kind: 'text', text, s: start, e: end, tag: parent, open: top.s });
        if (parent === 'w:delText') g.del = true;
        continue;
      }
      if (sheet && parent === 'v' && cell) {
        if (cell.t !== 's' && cell.t !== 'b' && HAS_TEXT.test(text)) {
          units.push({ text, segs: [{ kind: 'text', text, at: 0, len: text.length, s: start, e: end }], cell, covered: readable });
        }
        continue;
      }
      if (!HAS_TEXT.test(text)) continue;
      const seg = { kind: 'text', text, at: 0, len: text.length, s: start, e: end };
      if (HEADER.test(parent)) {
        const plain = text.replace(HEADER_CODE, (c) => ' '.repeat(c.length));
        units.push({ text: plain, src: text, segs: [seg], covered: false });
        continue;
      }
      units.push({ text, segs: [seg], bare: BARE_TEXT.has(parent), covered: false });
    }
    return { units, repls };
  }

  /* Пакет целиком: XML-части, вложенные документы Office, картинки, внедрённые объекты, макросы. */
  async function plan(bytes, kind, depth = 0) {
    const zip = opener(bytes);
    const removed = new Set(zip.names.filter((n) => REMOVE.test(n)));
    const info = { images: 0, objects: 0, macros: zip.names.some((n) => /vbaProject\.bin$/i.test(n)), nested: 0 };
    const files = [];
    for (const name of zip.names) {
      if (removed.has(name)) { files.push({ name, removed: true }); continue; }
      if (/\.(xml|rels|vml)$/i.test(name)) {
        const xml = await zip.read(name);
        files.push({ name, xml, ...scanXml(name, xml, { removed, readable: depth === 0 && READABLE[kind].test(name) }) });
        continue;
      }
      if (IMAGE_PART.test(name)) info.images++;
      if (/(^|\/)embeddings\//i.test(name)) {
        const sub = kindOf(name);
        if (sub && depth < MAX_DEPTH) {
          const nested = await plan(await zip.readBytes(name), sub, depth + 1);
          info.images += nested.info.images;
          info.objects += nested.info.objects;
          info.nested += 1 + nested.info.nested;
          files.push({ name, nested });
          continue;
        }
        info.objects++;
        files.push({ name, empty: true });
        continue;
      }
      files.push({ name });
    }
    return { zip, files, info };
  }

  function unitsOf(p, out = []) {
    for (const f of p.files) {
      if (f.units) out.push(...f.units);
      if (f.nested) unitsOf(f.nested, out);
    }
    return out;
  }

  /* Замены в XML для одного куска текста. Метка встаёт в тот фрагмент, где начиналось значение,
     остальные фрагменты теряют свою часть значения и сохраняют оформление. */
  function unitRepls(u, found, tokenOf, out) {
    if (!found.length || u.blank) return 0;
    const tokenFor = (f) => {
      let t = tokenOf.get(f.id);
      if (!t) return null;
      if (u.bare) t = t.slice(2, -2);
      return f.encoded ? encodeURIComponent(t) : t;
    };
    const nodes = u.segs.filter((sg) => sg.kind !== 'sep' && sg.len > 0);
    const owner = found.map((f) => nodes.find((sg) => f.start >= sg.at && f.start < sg.at + sg.len)
      || nodes.find((sg) => sg.at >= f.start && sg.at < f.end));
    const src = u.src || u.text;
    for (const sg of nodes) {
      const end = sg.at + sg.len;
      let r = '';
      let pos = sg.at;
      found.forEach((f, i) => {
        if (f.end <= sg.at || f.start >= end) return;
        r += src.slice(pos, Math.max(f.start, sg.at));
        const token = owner[i] === sg ? tokenFor(f) : '';
        r += token === null ? src.slice(Math.max(f.start, sg.at), Math.min(f.end, end)) : token;
        pos = Math.min(f.end, end);
      });
      r += src.slice(pos, end);
      if (r === sg.text) continue;
      if (u.cell) {
        const attrs = u.cell.attrs.replace(/\s+t="[^"]*"/, '');
        out.push({ s: u.cell.s, e: u.cell.e, str: `<c${attrs} t="inlineStr"><is><t xml:space="preserve">${toXml(r)}</t></is></c>` });
      } else if (sg.kind === 'attr') {
        out.push({ s: sg.s, e: sg.e, str: attrXml(r) });
      } else if (PRESERVE.has(sg.tag)) {
        out.push({ s: sg.open, e: sg.e, str: `<${sg.tag} xml:space="preserve">${toXml(r)}` });
      } else {
        out.push({ s: sg.s, e: sg.e, str: toXml(r) });
      }
    }
    return found.length;
  }

  /* Замены применяются с конца к началу. Если одна замена внутри другой (формула внутри ячейки,
     ссылка внутри удаляемой связи), остаётся внешняя. */
  function splice(xml, repls) {
    const sorted = [...repls].sort((a, b) => a.s - b.s || b.e - a.e);
    let out = '';
    let cursor = 0;
    for (const r of sorted) {
      if (r.s < cursor) continue;
      out += xml.slice(cursor, r.s) + r.str;
      cursor = r.e;
    }
    return out + xml.slice(cursor);
  }

  /* ---------- запись zip ---------- */

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(b) {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function deflate(data) {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const utf8out = new TextEncoder();

  async function pack(items) {
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const it of items) {
      let { method, crc, size, usize, data } = it.copy || {};
      const { time = 0, date = 0x21 } = it.copy || it;
      if (it.bytes) {
        usize = it.bytes.length;
        crc = crc32(it.bytes);
        data = usize ? await deflate(it.bytes) : it.bytes;
        method = usize ? 8 : 0;
        if (data.length >= usize) { data = it.bytes; method = 0; }
        size = data.length;
      }
      const nameBytes = utf8out.encode(it.name);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, method, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, usize, true);
      local.setUint16(26, nameBytes.length, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, method, true);
      c.setUint16(12, time, true);
      c.setUint16(14, date, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, size, true);
      c.setUint32(24, usize, true);
      c.setUint16(28, nameBytes.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const cdSize = central.reduce((n, x) => n + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, items.length, true);
    end.setUint16(10, items.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let at = 0;
    for (const x of parts) { out.set(x, at); at += x.length; }
    return out;
  }

  async function emit(p, locate, values, tokenOf, stats) {
    const items = [];
    for (const f of p.files) {
      if (f.removed) { stats.removed++; continue; }
      const meta = p.zip.raw(f.name);
      if (f.nested) { items.push({ name: f.name, bytes: await emit(f.nested, locate, values, tokenOf, stats), time: meta.time, date: meta.date }); continue; }
      if (f.empty) { stats.emptied++; items.push({ name: f.name, bytes: new Uint8Array(0), time: meta.time, date: meta.date }); continue; }
      if (f.units) {
        const repls = [...f.repls];
        for (const u of f.units) stats.replaced += unitRepls(u, locate(u.text, values), tokenOf, repls);
        if (repls.length) { items.push({ name: f.name, bytes: utf8out.encode(splice(f.xml, repls)), time: meta.time, date: meta.date }); continue; }
      }
      items.push({ name: f.name, copy: meta });
    }
    return pack(items);
  }

  const outName = (name) => name.replace(/\.(doc|xls|ppt)m$/i, (m, x) => '.' + x + 'x');

  /* Текст документа: сначала то, что видно при чтении, потом всё остальное, что есть в пакете.
     Бросает ошибку, если файл не zip или распакованное слишком велико. */
  async function extract(bytes, name) {
    const kind = kindOf(name);
    if (!kind) throw new Error('unsupported');
    const text = await KINDS[kind](opener(bytes));
    const p = await plan(bytes, kind);
    const hidden = [...new Set(unitsOf(p).filter((u) => !u.covered).map((u) => u.text.trim()).filter((t) => t.length > 1))];
    return { kind, text: hidden.length ? text + '\n\n' + hidden.join('\n') : text, ...p.info };
  }

  /* Очищенная копия в том же формате. values: найденные значения с метками ({id, type, value, token}),
     locate: поиск этих значений в тексте (PG.locate). Макросы, подписи и миниатюра удаляются,
     внедрённые объекты, которые нельзя разобрать, обнуляются. */
  async function clean(bytes, name, values, locate) {
    const kind = kindOf(name);
    if (!kind) throw new Error('unsupported');
    const tokenOf = new Map(values.map((v) => [v.id, v.token]));
    const stats = { replaced: 0, removed: 0, emptied: 0 };
    const out = await emit(await plan(bytes, kind), locate, values, tokenOf, stats);
    return { bytes: out, name: outName(name), ...stats };
  }

  return { extract, clean, kindOf };
});
