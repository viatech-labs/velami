/* PDF той же формой: страницы рисуются картинками с закрытыми местами, поверх кладётся невидимый
   текстовый слой с метками вместо значений, чтобы модель читала текст, а не только картинку.
   Без DOM: отрисовка и OCR живут в offscreen.js, здесь геометрия текста и запись файла. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__PGPdf = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const mul = (m1, m2) => [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];

  /* Текст страницы из элементов getTextContent и прямоугольник каждого символа в пикселях картинки
     страницы (viewport.transform). Ширины букв внутри элемента делятся пропорционально measure(str).
     Элемент под углом закрывается целиком: каждой его букве достаётся рамка всего элемента. */
  function textLayout(items, transform, measure = (s) => s.length) {
    let text = '';
    const boxes = [];
    let line = 0;
    let prev = null;
    const scale = Math.hypot(transform[0], transform[1]);
    for (const it of items || []) {
      if (typeof it.str !== 'string') continue;
      const s = it.str;
      if (s) {
        const m = mul(transform, it.transform);
        const h = Math.hypot(m[2], m[3]) || Math.abs(it.height || 0) * scale || 1;
        const w = Math.abs(it.width || 0) * scale;
        const flat = Math.abs(m[1]) < 1e-3 * Math.abs(m[0]) && m[0] > 0;
        const top = m[5] - h * 0.8;
        const bottom = m[5] + h * 0.22;
        if (!(flat && prev && Math.abs(prev.base - m[5]) < h * 0.3 && m[4] >= prev.x - h)) line++;
        if (flat) {
          const total = measure(s) || s.length;
          let at = 0;
          for (let i = 0; i < s.length; i++) {
            const next = at + (measure(s[i]) || 1);
            boxes.push({ x0: m[4] + (w * at) / total, x1: m[4] + (w * Math.min(next, total)) / total, y0: top, y1: bottom, line });
            at = next;
          }
          prev = { base: m[5], x: m[4] + w };
        } else {
          const ux = m[0] / (Math.hypot(m[0], m[1]) || 1);
          const uy = m[1] / (Math.hypot(m[0], m[1]) || 1);
          const pts = [[0, -h * 0.8], [w, -h * 0.8], [0, h * 0.22], [w, h * 0.22]].map(([a, b]) => [m[4] + ux * a - uy * b, m[5] + uy * a + ux * b]);
          const box = { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])), line };
          for (let i = 0; i < s.length; i++) boxes.push(box);
          prev = null;
        }
        text += s;
      }
      if (it.hasEOL) { text += '\n'; boxes.push(null); prev = null; }
    }
    return { text, boxes };
  }

  /* Строки невидимого слоя: символы с рамками по строкам, найденные места заменены меткой.
     Метка встаёт на место первого символа значения, остальные символы значения выпадают. */
  function maskedRuns(text, boxes, spans) {
    const put = new Array(text.length);
    for (const sp of spans) {
      let first = true;
      for (let i = sp.start; i < sp.end; i++) {
        put[i] = first && boxes[i] ? sp.token : '';
        if (boxes[i]) first = false;
      }
    }
    const runs = [];
    let run = null;
    for (let i = 0; i < text.length; i++) {
      const b = boxes[i];
      if (!b) { run = null; continue; }
      if (!run || run.line !== b.line) {
        run = { line: b.line, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, text: '' };
        runs.push(run);
      }
      run.x0 = Math.min(run.x0, b.x0); run.y0 = Math.min(run.y0, b.y0);
      run.x1 = Math.max(run.x1, b.x1); run.y1 = Math.max(run.y1, b.y1);
      run.text += put[i] === undefined ? text[i] : put[i];
    }
    return runs.filter((r) => r.text.trim()).map(({ x0, y0, x1, y1, text: t }) => ({ x0, y0, x1, y1, text: t }));
  }

  /* ---------- запись ---------- */

  const enc = new TextEncoder();
  const num = (v) => {
    const r = Math.round(v * 1000) / 1000;
    return Object.is(r, -0) ? '0' : String(r);
  };
  const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  const utf16hex = (s) => { let h = ''; for (let i = 0; i < s.length; i++) h += hex4(s.charCodeAt(i)); return h; };

  /* Шрифт без глифов: коды символов равны UTF-16, ToUnicode отдаёт тот же текст при копировании
     и разборе. Текст рисуется в режиме 3 (невидимый), так что начертание не нужно. */
  function toUnicode() {
    let ranges = '';
    for (let hi = 0; hi < 256; hi++) ranges += `<${hex4(hi << 8)}> <${hex4((hi << 8) | 0xff)}> <${hex4(hi << 8)}>\n`;
    const chunks = [];
    const lines = ranges.trim().split('\n');
    for (let i = 0; i < lines.length; i += 100) chunks.push(`${Math.min(100, lines.length - i)} beginbfrange\n${lines.slice(i, i + 100).join('\n')}\nendbfrange`);
    return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
      + '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'
      + chunks.join('\n') + '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  }

  /* pages: [{ width, height (пункты), jpeg (байты), imageWidth, imageHeight, runs: [{ x, y, size, width, text }] }],
     координаты run в пунктах от левого нижнего угла, y — базовая линия. Без /Info и метаданных. */
  function write(pages) {
    const objects = [];
    const add = (parts) => { objects.push(parts); return objects.length; };
    const dict = (s) => [enc.encode(s)];
    const stream = (head, body) => [enc.encode(`<< ${head} /Length ${body.length} >>\nstream\n`), body, enc.encode('\nendstream')];

    const catalog = add(null);
    const pagesId = add(null);
    const cmap = add(stream('', enc.encode(toUnicode())));
    const descriptor = add(dict('<< /Type /FontDescriptor /FontName /GlyphLessFont /Flags 5 /FontBBox [0 0 500 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 1000 /StemV 80 >>'));
    const cid = add(dict(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /GlyphLessFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 500 /CIDToGIDMap /Identity >>`));
    const font = add(dict(`<< /Type /Font /Subtype /Type0 /BaseFont /GlyphLessFont /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${cmap} 0 R >>`));

    const kids = [];
    for (const p of pages) {
      const img = add(stream(`/Type /XObject /Subtype /Image /Width ${p.imageWidth} /Height ${p.imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, p.jpeg));
      let ops = `q ${num(p.width)} 0 0 ${num(p.height)} 0 0 cm /Im0 Do Q\n`;
      const runs = (p.runs || []).filter((r) => r.text);
      if (runs.length) {
        ops += 'BT 3 Tr\n';
        for (const r of runs) {
          const size = Math.max(1, r.size);
          const tz = Math.min(10000, Math.max(1, (100 * r.width) / (r.text.length * 0.5 * size)));
          ops += `/F1 ${num(size)} Tf ${num(tz)} Tz 1 0 0 1 ${num(r.x)} ${num(r.y)} Tm <${utf16hex(r.text)}> Tj\n`;
        }
        ops += 'ET\n';
      }
      const content = add(stream('', enc.encode(ops)));
      kids.push(add(dict(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources << /XObject << /Im0 ${img} 0 R >> /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`)));
    }
    objects[catalog - 1] = dict(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    objects[pagesId - 1] = dict(`<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);

    const out = [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])];
    let size = out[0].length;
    const offsets = [];
    objects.forEach((parts, i) => {
      offsets.push(size);
      const all = [enc.encode(`${i + 1} 0 obj\n`), ...parts, enc.encode('\nendobj\n')];
      for (const a of all) { out.push(a); size += a.length; }
    });
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += String(o).padStart(10, '0') + ' 00000 n \n';
    xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${size}\n%%EOF\n`;
    out.push(enc.encode(xref));
    const bytes = new Uint8Array(out.reduce((n, a) => n + a.length, 0));
    let at = 0;
    for (const a of out) { bytes.set(a, at); at += a.length; }
    return bytes;
  }

  return { textLayout, maskedRuns, write };
});
