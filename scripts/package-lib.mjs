// Общие функции сборки и сверки пакета. Архив собирается без сжатия, в отсортированном порядке
// и с фиксированной датой, поэтому из одних и тех же исходников всегда получается один и тот же zip.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { crc32 } from 'node:zlib';

export const PACKAGE_ROOTS = ['manifest.json', 'popup.html', 'dashboard.html', 'offscreen.html', 'managed-schema.json', 'src', 'ui', 'icons', '_locales', 'vendor', 'models'];

/** Модель и onnxruntime не хранятся в git: их собирают npm run model и npm run setup. */
export function checkGenerated(root) {
  const problems = [];
  const lock = JSON.parse(readFileSync(path.join(root, 'tools/model/model.lock.json'), 'utf8'));
  for (const [name, digest] of Object.entries(lock)) {
    const file = path.join(root, 'models/ner', name);
    if (!existsSync(file)) problems.push(`нет models/ner/${name} (npm run model)`);
    else if (sha256(readFileSync(file)) !== digest) problems.push(`models/ner/${name} не совпадает с tools/model/model.lock.json`);
  }
  for (const f of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    if (!existsSync(path.join(root, 'vendor/onnxruntime-web', f))) problems.push(`нет vendor/onnxruntime-web/${f} (npm run setup)`);
  }
  for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs', 'cmaps/UniGB-UCS2-H.bcmap']) {
    if (!existsSync(path.join(root, 'vendor/pdfjs', f))) problems.push(`нет vendor/pdfjs/${f} (npm run setup)`);
  }
  return problems;
}
const IGNORED = new Set(['.DS_Store']);

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function walk(root, rel, out) {
  const abs = path.join(root, rel);
  if (statSync(abs).isDirectory()) {
    for (const name of readdirSync(abs)) if (!IGNORED.has(name)) walk(root, path.posix.join(rel, name), out);
  } else {
    out.push(rel);
  }
}

/** Файлы пакета относительно корня, в порядке байтов имени. */
export function listFiles(root, roots = PACKAGE_ROOTS) {
  const out = [];
  for (const r of roots) if (existsSync(path.join(root, r))) walk(root, r, out);
  return out.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

/** Манифест без полей, которые добавляет Chrome Web Store при публикации. */
export function canonicalManifest(buf) {
  const m = JSON.parse(buf.toString('utf8'));
  delete m.update_url;
  delete m.key;
  const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
  return Buffer.from(JSON.stringify(sortKeys(m)));
}

/** SHA-256 каждого файла. Для manifest.json считается по каноническому виду. */
export function fileHashes(root, files) {
  const out = {};
  for (const f of files) {
    const buf = readFileSync(path.join(root, f));
    out[f] = sha256(f === 'manifest.json' ? canonicalManifest(buf) : buf);
  }
  return out;
}

const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1; // 1980-01-01

/** ZIP без сжатия (method 0). entries: [{ name, data: Buffer }] в нужном порядке. */
export function pack(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
}

/** Чтение ZIP без сжатия, который собрал pack(). Для сверки пакета. */
export function unpack(buf) {
  const endAt = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0) throw new Error('не ZIP');
  const count = buf.readUInt16LE(endAt + 10);
  let p = buf.readUInt32LE(endAt + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('повреждён центральный каталог');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (method !== 0) throw new Error(`файл ${name} сжат, сверка поддерживает только архивы этой сборки`);
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    out.push({ name, data: buf.subarray(dataAt, dataAt + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
