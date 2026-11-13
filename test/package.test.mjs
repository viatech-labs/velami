import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_ROOTS, canonicalManifest, checkGenerated, listFiles, pack, unpack } from '../scripts/package-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Модель собирается отдельно (npm run model) и в CI не строится: без неё проверяем всё остальное.
const hasModel = existsSync(path.join(root, 'models/ner/model.onnx'));

test('сборка воспроизводима: два прогона дают одинаковый zip', () => {
  const files = listFiles(root);
  const build = () => pack(files.map((name) => ({ name, data: readFileSync(path.join(root, name)) })));
  assert.ok(build().equals(build()));
});

test('в пакет попадает только код расширения', () => {
  const files = listFiles(root);
  for (const f of ['manifest.json', 'src/background.js', 'src/page-hook.js', 'src/i18n.js', '_locales/it/messages.json',
    'offscreen.html', 'src/offscreen.js', 'src/ner-core.js', ...(hasModel ? ['models/ner/model.onnx', 'models/ner/model.data', 'models/ner/NOTICE.txt'] : []),
    'vendor/onnxruntime-web/ort.wasm.min.mjs', 'vendor/onnxruntime-web/ort-wasm-simd-threaded.wasm', 'vendor/onnxruntime-web/LICENSE.txt',
    'src/office.js', 'src/policy.js', 'managed-schema.json', 'src/sites.js', 'src/proto.js', 'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdfjs/LICENSE.txt']) assert.ok(files.includes(f), f);
  for (const f of files) assert.ok(!/^(test|tools|node_modules|scripts|dist|\.cache)\/|\.md$|\.map$|package/.test(f), 'лишний файл ' + f);
  assert.deepEqual(checkGenerated(root).filter((p) => hasModel || !p.includes('models/ner')), []);
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const referenced = [manifest.background.service_worker, manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((c) => c.js), ...Object.values(manifest.icons), manifest.storage.managed_schema];
  for (const f of referenced) assert.ok(files.includes(f), 'манифест ссылается на отсутствующий ' + f);
});

test('zip читается обратно без потерь', () => {
  const entries = [{ name: 'a.txt', data: Buffer.from('привет') }, { name: 'dir/b.bin', data: Buffer.from([0, 1, 2, 255]) }];
  const back = unpack(pack(entries));
  assert.deepEqual(back.map((e) => [e.name, [...e.data]]), entries.map((e) => [e.name, [...e.data]]));
});

test('манифест сверяется без полей, которые добавляет Web Store', () => {
  const a = Buffer.from(JSON.stringify({ name: 'x', version: '1', permissions: ['storage'] }));
  const b = Buffer.from(JSON.stringify({ version: '1', update_url: 'https://clients2.google.com/service/update2/crx', permissions: ['storage'], name: 'x' }, null, 2));
  assert.ok(canonicalManifest(a).equals(canonicalManifest(b)));
});

test('сверка находит подменённый файл в установленной копии', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pg-verify-'));
  try {
    for (const f of PACKAGE_ROOTS) {
      if (!existsSync(path.join(root, f))) continue;
      if (f === 'models' || f === 'vendor') symlinkSync(path.join(root, f), path.join(dir, f));
      else cpSync(path.join(root, f), path.join(dir, f), { recursive: true });
    }
    const run = () => { try { execFileSync('node', [path.join(root, 'scripts/verify.mjs'), dir], { encoding: 'utf8' }); return 0; } catch (e) { return e.status; } };
    assert.equal(run(), 0);
    writeFileSync(path.join(dir, 'src/background.js'), readFileSync(path.join(dir, 'src/background.js'), 'utf8') + '\nfetch("https://evil.example");\n');
    assert.equal(run(), 1);
    writeFileSync(path.join(dir, 'src/background.js'), readFileSync(path.join(root, 'src/background.js')));
    assert.equal(run(), 0);
    writeFileSync(path.join(dir, 'extra.js'), 'console.log(1)');
    assert.equal(run(), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* Chrome Web Store отклонил 0.1.2 за «код, размещённый на удалённых серверах»: в сборках Tesseract.js
   были адреса cdn.jsdelivr.net по умолчанию, хотя расширение ими не пользовалось (AIGW-37).
   Проверка магазина смотрит на строки в коде, поэтому в пакете не должно быть ни одного адреса,
   кроме перечисленных: сайты чатов, самопроверка, ссылки на разработчика и адреса-идентификаторы
   форматов (пространства имён XML, текст лицензии), с которых ничего не загружается. */
test('в коде пакета нет внешних адресов, кроме известных', () => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const chats = [...manifest.host_permissions, ...manifest.optional_host_permissions].map((o) => new URL(o.replace('/*', '/')).host);
  const allowed = new Set([...chats, 'httpbin.org', 'velami.pro', 'via-tech.org', 'github.com',
    // Идентификаторы форматов в pdf.js и строки в библиотеках, это не адреса загрузки.
    'www.w3.org', 'ns.adobe.com', 'www.xfa.org', 'www.apache.org', 'web.dev', 'example.com', 'foo.bar']);
  const found = [];
  // Адреса раздачи библиотек не должны встречаться нигде, даже в тексте лицензий.
  for (const f of listFiles(root).filter((n) => /\.(js|mjs|html|json|css|txt)$/.test(n))) {
    assert.ok(!/jsdelivr|unpkg\.com|cdnjs|googleapis\.com/i.test(readFileSync(path.join(root, f), 'utf8')), `${f}: адрес CDN`);
  }
  for (const f of listFiles(root).filter((n) => /\.(js|mjs|html|json|css)$/.test(n))) {
    const text = readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(/(?:https?|wss?):\/\/([A-Za-z0-9.-]+\.[a-z]{2,})/g)) if (!allowed.has(m[1].toLowerCase())) found.push(`${f}: ${m[0]}`);
    if (/\.(js|mjs)$/.test(f) && /^vendor\/tesseract\//.test(f)) {
      assert.ok(!/new Function\(|\beval\(/.test(text), `${f}: выполнение строки как кода`);
      assert.ok(!/Blob\(\[['"]importScripts/.test(text), `${f}: воркер из blob с importScripts`);
    }
  }
  assert.deepEqual([...new Set(found)], []);
});
