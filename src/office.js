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

  /* Оглавление zip: имя, способ сжатия, размеры, смещение. Zip64 не нужен: документы меньше 4 ГБ. */
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
      const size = u32(bytes, p + 20);
      const usize = u32(bytes, p + 24);
      const nameLen = u16(bytes, p + 28);
      const extraLen = u16(bytes, p + 30);
      const commentLen = u16(bytes, p + 32);
      const offset = u32(bytes, p + 42);
      const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      out.set(name, { method, size, usize, offset });
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
    return {
      names: [...list.keys()],
      async read(name) {
        const e = list.get(name);
        if (!e) return null;
        const h = e.offset;
        if (u32(bytes, h) !== 0x04034b50) throw new Error('broken zip');
        const start = h + 30 + u16(bytes, h + 26) + u16(bytes, h + 28);
        const data = bytes.subarray(start, start + e.size);
        const limit = Math.min(MAX_ENTRY, MAX_TOTAL - used);
        const raw = e.method === 0 ? data : e.method === 8 ? await inflate(data, limit) : null;
        if (!raw) throw new Error('unsupported zip method');
        if (raw.length > limit) throw new Error('too large');
        used += raw.length;
        return utf8.decode(raw);
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

  /* Текст документа. Бросает ошибку, если файл не zip или распакованное слишком велико. */
  async function extract(bytes, name) {
    const kind = kindOf(name);
    if (!kind) throw new Error('unsupported');
    return { kind, text: await KINDS[kind](opener(bytes)) };
  }

  return { extract, kindOf };
});
