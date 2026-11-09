/* Строки внутри protobuf, закодированного в base64 (так Gemini без входа отправляет сообщение).
   Разбор по формату передачи, без схемы: вложенное поле считается строкой, если это UTF-8
   без управляющих символов, иначе сообщением, если разбирается целиком, иначе байтами. Числа и неизменённые поля переносятся байт в байт,
   длины пересчитываются при сборке. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__PGProto = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const MAX_DEPTH = 24;
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const enc = new TextEncoder();

  function varint(buf, i) {
    let n = 0;
    let mul = 1;
    for (let j = 0; j < 10; j++) {
      if (i + j >= buf.length) return null;
      const b = buf[i + j];
      n += (b & 0x7f) * mul;
      mul *= 128;
      if (!(b & 0x80)) return { n, end: i + j + 1 };
    }
    return null;
  }

  function writeVarint(n, out) {
    while (n >= 128) { out.push((n % 128) | 0x80); n = Math.floor(n / 128); }
    out.push(n);
  }

  function parse(buf, depth = 0) {
    const fields = [];
    let i = 0;
    while (i < buf.length) {
      const tag = varint(buf, i);
      if (!tag || tag.n < 8 || tag.n >= 2 ** 32) return null;
      const wt = tag.n % 8;
      const head = buf.subarray(i, tag.end);
      i = tag.end;
      if (wt === 0) {
        const v = varint(buf, i);
        if (!v) return null;
        fields.push({ head, raw: buf.subarray(i, v.end) });
        i = v.end;
      } else if (wt === 1 || wt === 5) {
        const size = wt === 1 ? 8 : 4;
        if (i + size > buf.length) return null;
        fields.push({ head, raw: buf.subarray(i, i + size) });
        i += size;
      } else if (wt === 2) {
        const len = varint(buf, i);
        if (!len || len.end + len.n > buf.length) return null;
        const body = buf.subarray(len.end, len.end + len.n);
        i = len.end + len.n;
        fields.push({ head, ...classify(body, depth) });
      } else {
        return null;
      }
    }
    return fields;
  }

  /* Текст без управляющих символов считается строкой: короткий текст вроде «hi» формально
     разбирается и как сообщение из чисел. У вложенного сообщения первый байт тега поля 1 —
     перевод строки, поэтому сообщение принимается, только если разбирается целиком и в нём
     есть поле с длиной. */
  const CONTROL = /[\u0000-\u001f\u007f]/;
  function classify(body, depth) {
    let str = null;
    try { str = utf8.decode(body); } catch { /* не UTF-8 */ }
    if (str !== null && !CONTROL.test(str)) return { str };
    const msg = body.length && depth < MAX_DEPTH ? parse(body, depth + 1) : null;
    if (msg && msg.some((f) => !f.raw)) return { msg };
    return str !== null ? { str } : { bytes: body };
  }

  function strings(fields, out = []) {
    for (const f of fields) {
      if (f.msg) strings(f.msg, out);
      else if (f.str !== undefined) out.push(f);
    }
    return out;
  }

  function serialize(fields) {
    const out = [];
    const push = (bytes) => { for (const b of bytes) out.push(b); };
    for (const f of fields) {
      push(f.head);
      if (f.raw) { push(f.raw); continue; }
      const body = f.msg ? serialize(f.msg) : f.str !== undefined ? enc.encode(f.str) : f.bytes;
      writeVarint(body.length, out);
      push(body);
    }
    return Uint8Array.from(out);
  }

  const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /* Строки сообщения из base64 и сборка обратно. null, если это не protobuf. */
  function open(b64) {
    if (typeof b64 !== 'string' || b64.length < 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
    let bytes;
    try { bytes = fromBase64(b64); } catch { return null; }
    const fields = parse(bytes);
    if (!fields || !fields.length) return null;
    const refs = strings(fields);
    return {
      strings: refs.map((f) => f.str),
      rebuild(next) {
        refs.forEach((f, i) => { f.str = next[i]; });
        return toBase64(serialize(fields));
      },
    };
  }

  /* Текст для повторной проверки готового тела: все байты как UTF-8, где получится. */
  function readable(b64) {
    try { return new TextDecoder('utf-8').decode(fromBase64(b64)); } catch { return ''; }
  }

  return { open, readable, parse, serialize };
});
