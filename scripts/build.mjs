// Воспроизводимая сборка пакета для Chrome Web Store.
// Результат в dist/: zip, его SHA-256 и список SHA-256 каждого файла (для npm run verify).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGenerated, fileHashes, listFiles, pack, sha256 } from './package-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = checkGenerated(root);
if (problems.length) {
  console.error('Сборка остановлена:\n  ' + problems.join('\n  '));
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = listFiles(root);
const zip = pack(files.map((name) => ({ name, data: readFileSync(path.join(root, name)) })));
const base = `velami-${manifest.version}`;
const dist = path.join(root, 'dist');
mkdirSync(dist, { recursive: true });

const zipHash = sha256(zip);
writeFileSync(path.join(dist, base + '.zip'), zip);
writeFileSync(path.join(dist, base + '.zip.sha256'), `${zipHash}  ${base}.zip\n`);
writeFileSync(path.join(dist, base + '.files.json'), JSON.stringify({
  version: manifest.version,
  zip: { name: base + '.zip', sha256: zipHash, bytes: zip.length },
  note: 'manifest.json hashed in canonical form: sorted keys, without update_url and key added by the Web Store',
  files: fileHashes(root, files),
}, null, 2) + '\n');

console.log(`${base}.zip  ${files.length} файлов, ${zip.length} байт`);
console.log(`SHA-256 ${zipHash}`);
