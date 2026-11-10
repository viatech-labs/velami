/* Картинки: текст, распознанный OCR, с координатами каждого символа, места найденных значений
   и удаление метаданных (EXIF, GPS, XMP, IPTC, комментарии) без перекодирования.
   Без DOM: распознавание и отрисовка живут в offscreen.js, здесь только разбор и геометрия. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__PGImage = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };

  function formatOf(b) {
    if (b.length < 12) return null;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
    if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
    return null;
  }

  /* Tesseract рвёт адрес почты на слова у «@» и точек: «mario.rossi@ example.com». Без склейки
     такой адрес не нашёлся бы и ушёл открытым. */
  function glued(prev, next) {
    if (prev.endsWith('@') || next.startsWith('@')) return true;
    return prev.includes('@') && !/\s/.test(prev) && (prev.endsWith('.') || /^\.[a-z]/i.test(next));
  }

  /* Текст страницы OCR: слова через пробел, строки через перевод строки, абзацы через пустую строку.
     boxes[i] — прямоугольник символа text[i] и номер строки, у разделителей null. */
  function layout(blocks) {
    let text = '';
    const boxes = [];
    let line = 0;
    const put = (s, box) => { for (let i = 0; i < s.length; i++) boxes.push(box); text += s; };
    for (const block of blocks || []) {
      for (const para of block.paragraphs || []) {
        if (text) put(text.endsWith('\n') ? '\n' : '\n\n', null);
        for (const ln of para.lines || []) {
          if (text && !text.endsWith('\n')) put('\n', null);
          line++;
          let prev = null;
          for (const w of ln.words || []) {
            if (prev !== null && !glued(prev, String(w.text || ''))) put(' ', null);
            prev = String(w.text || '');
            const wb = w.bbox;
            const symbols = w.symbols && w.symbols.length ? w.symbols : [{ text: w.text, bbox: wb }];
            const chars = [];
            for (const sym of symbols) {
              const t = String(sym.text || '');
              const { x0, x1 } = sym.bbox;
              for (let i = 0; i < t.length; i++) chars.push([t[i], x0 + (x1 - x0) * i / t.length, x0 + (x1 - x0) * (i + 1) / t.length]);
            }
            /* Высота берётся по слову: рамки отдельных символов («@», «g») прыгают по вертикали.
               Края слова берутся по его рамке: рамка первого символа бывает уже самой буквы. */
            chars.forEach(([ch, x0, x1], i) => put(ch, {
              x0: i === 0 ? Math.min(x0, wb.x0) : x0, x1: i === chars.length - 1 ? Math.max(x1, wb.x1) : x1, y0: wb.y0, y1: wb.y1, line,
            }));
          }
        }
      }
    }
    return { text, boxes };
  }

  /* Прямоугольники для найденных мест: по одному на строку. По вертикали запас pad пикселей,
     по горизонтали треть высоты строки, но не дальше соседнего символа вне места: рамки
     крайних букв у Tesseract бывают на пару пикселей уже самих букв.
     Возвращает и места, у которых нет ни одного символа на картинке (их закрыть нельзя). */
  function rectsFor(boxes, spans, pad = 2) {
    const rects = [];
    const lost = [];
    for (const sp of spans) {
      const byLine = new Map();
      for (let i = sp.start; i < sp.end; i++) {
        const b = boxes[i];
        if (!b) continue;
        const r = byLine.get(b.line);
        if (!r) byLine.set(b.line, { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, line: b.line });
        else Object.assign(r, { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) });
      }
      if (!byLine.size) { lost.push(sp); continue; }
      let first = true;
      for (const r of byLine.values()) {
        let left = -Infinity;
        let right = Infinity;
        for (let i = sp.start - 1; i >= 0; i--) { const b = boxes[i]; if (b && b.line === r.line) { left = b.x1; break; } if (b && b.line < r.line) break; }
        for (let i = sp.end; i < boxes.length; i++) { const b = boxes[i]; if (b && b.line === r.line) { right = b.x0; break; } if (b && b.line > r.line) break; }
        const h = Math.max(pad, (r.y1 - r.y0) / 3);
        rects.push({
          x0: Math.max(r.x0 - h, Math.min(r.x0, left + 1)), y0: r.y0 - pad,
          x1: Math.min(r.x1 + h, Math.max(r.x1, right - 1)), y1: r.y1 + pad,
          token: first ? sp.token : '', id: sp.id,
        });
        first = false;
      }
    }
    return { rects, lost };
  }

  /* ---------- метаданные ---------- */

  const u16 = (b, i, le) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const u32 = (b, i, le) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0);

  function exifInfo(seg) {
    const out = { orientation: 1, gps: false };
    if (seg.length < 14 || String.fromCharCode(...seg.subarray(0, 4)) !== 'Exif') return out;
    const t = seg.subarray(6);
    const le = t[0] === 0x49;
    const ifd = u32(t, 4, le);
    if (ifd + 2 > t.length) return out;
    const n = u16(t, ifd, le);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > t.length) break;
      const tag = u16(t, e, le);
      if (tag === 0x0112) out.orientation = u16(t, e + 8, le) || 1;
      if (tag === 0x8825) out.gps = true;
    }
    return out;
  }

  const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);

  function stripJpeg(b) {
    const parts = [b.subarray(0, 2)];
    const info = { removed: [], orientation: 1, gps: false };
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const marker = b[i + 1];
      if (marker === 0xda) break;
      if (marker === 0xff) { i++; continue; }
      const len = u16(b, i + 2, false);
      const seg = b.subarray(i, i + 2 + len);
      if (JPEG_DROP.has(marker)) {
        if (marker === 0xe1) Object.assign(info, exifInfo(seg.subarray(4)), { removed: info.removed });
        info.removed.push(marker === 0xe1 ? (String.fromCharCode(...seg.subarray(4, 8)) === 'Exif' ? 'exif' : 'xmp') : marker === 0xed ? 'iptc' : 'comment');
      } else {
        parts.push(seg);
      }
      i += 2 + len;
    }
    parts.push(b.subarray(i));
    return { bytes: concat(parts), ...info };
  }

  const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

  function stripPng(b) {
    const parts = [b.subarray(0, 8)];
    const removed = [];
    let i = 8;
    while (i + 12 <= b.length) {
      const len = u32(b, i, false);
      const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      const end = i + 12 + len;
      if (PNG_DROP.has(type)) removed.push(type === 'eXIf' ? 'exif' : 'text');
      else parts.push(b.subarray(i, end));
      i = end;
      if (type === 'IEND') break;
    }
    return { bytes: concat(parts), removed, orientation: 1, gps: false };
  }

  function stripWebp(b) {
    const chunks = [];
    const removed = [];
    let i = 12;
    while (i + 8 <= b.length) {
      const type = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
      const len = u32(b, i + 4, true);
      const end = Math.min(b.length, i + 8 + len + (len & 1));
      if (type === 'EXIF' || type === 'XMP ') removed.push(type === 'EXIF' ? 'exif' : 'xmp');
      else chunks.push(b.slice(i, end));
      i = end;
    }
    if (!removed.length) return { bytes: b, removed, orientation: 1, gps: false };
    const vp8x = chunks.find((c) => String.fromCharCode(c[0], c[1], c[2], c[3]) === 'VP8X');
    if (vp8x) vp8x[8] &= ~0x0c;
    const body = concat(chunks);
    const head = new Uint8Array(12);
    head.set(b.subarray(0, 12));
    const size = body.length + 4;
    head[4] = size & 0xff; head[5] = (size >> 8) & 0xff; head[6] = (size >> 16) & 0xff; head[7] = (size >>> 24) & 0xff;
    return { bytes: concat([head, body]), removed, orientation: 1, gps: false };
  }

  /* Тот же файл без метаданных. orientation != 1 значит, что картинку нужно перерисовать:
     без EXIF она повернулась бы. */
  function stripMeta(bytes) {
    const f = formatOf(bytes);
    if (f === 'jpeg') return stripJpeg(bytes);
    if (f === 'png') return stripPng(bytes);
    if (f === 'webp') return stripWebp(bytes);
    return { bytes, removed: [], orientation: 1, gps: false };
  }

  function concat(parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  /* Имя и тип результата: PNG, JPEG и WebP остаются собой, GIF и BMP становятся PNG. */
  function output(name, format) {
    if (format === 'png' || format === 'jpeg' || format === 'webp') return { name, type: MIME[format] };
    return { name: String(name).replace(/\.[^.]*$/, '') + '.png', type: MIME.png };
  }

  return { formatOf, layout, rectsFor, stripMeta, output, MIME };
});
