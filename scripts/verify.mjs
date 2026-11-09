// Сверка установленного расширения или zip с исходниками.
// Запуск: npm run verify -- <папка расширения | файл .zip> [--list dist/velami-X.files.json]
// Без --list эталон считается по исходникам в этой папке.
// Папка расширения из Web Store на macOS:
//   ~/Library/Application Support/Google/Chrome/Default/Extensions/<id>/<версия>_0
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalManifest, fileHashes, listFiles, sha256, unpack } from './package-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const listAt = args.indexOf('--list');
if (!target) {
  console.error('Укажите папку расширения или zip: npm run verify -- <путь>');
  process.exit(2);
}

const expected = listAt >= 0
  ? JSON.parse(readFileSync(args[listAt + 1], 'utf8')).files
  : fileHashes(root, listFiles(root));

let actual = {};
if (statSync(target).isDirectory()) {
  const roots = readdirSync(target).filter((r) => r !== '_metadata' && r !== '.DS_Store');
  actual = fileHashes(target, listFiles(target, roots));
} else {
  for (const { name, data } of unpack(readFileSync(target))) {
    actual[name] = sha256(name === 'manifest.json' ? canonicalManifest(data) : data);
  }
}

const missing = Object.keys(expected).filter((f) => !(f in actual));
const extra = Object.keys(actual).filter((f) => !(f in expected) && !f.startsWith('_metadata/'));
const changed = Object.keys(expected).filter((f) => f in actual && actual[f] !== expected[f]);

for (const f of changed) console.log('ИЗМЕНЁН   ' + f);
for (const f of missing) console.log('НЕТ       ' + f);
for (const f of extra) console.log('ЛИШНИЙ    ' + f);
const ok = !changed.length && !missing.length && !extra.length;
console.log(ok
  ? `Совпадает: ${Object.keys(expected).length} файлов, SHA-256 каждого равен исходникам.`
  : `Не совпадает: изменено ${changed.length}, нет ${missing.length}, лишних ${extra.length}.`);
process.exit(ok ? 0 : 1);
