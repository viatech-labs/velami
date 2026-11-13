// Копирует onnxruntime-web и pdfjs-dist из node_modules в vendor/: расширение загружает только свои файлы.
// Версия закреплена в package.json и package-lock.json. Запуск: npm run setup
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules/onnxruntime-web');
const dst = path.join(root, 'vendor/onnxruntime-web');
const FILES = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

const deps = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies;
function version(name) {
  const have = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
  if (have !== deps[name]) {
    console.error(`${name} ${have}, ожидается ${deps[name]}. Выполните npm ci.`);
    process.exit(1);
  }
  return have;
}
const have = version('onnxruntime-web');

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const f of FILES) copyFileSync(path.join(src, 'dist', f), path.join(dst, f));
writeFileSync(path.join(dst, 'LICENSE.txt'), `ONNX Runtime Web ${have}, https://github.com/microsoft/onnxruntime

MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);
console.log(`vendor/onnxruntime-web: ${FILES.length} файла из onnxruntime-web ${have}`);

/* pdf.js: только извлечение текста, без отрисовки. cmaps нужны, чтобы текст из PDF со
   встроенными CID-шрифтами читался как Unicode. */
const pdfVersion = version('pdfjs-dist');
const pdfSrc = path.join(root, 'node_modules/pdfjs-dist');
const pdfDst = path.join(root, 'vendor/pdfjs');
rmSync(pdfDst, { recursive: true, force: true });
mkdirSync(pdfDst, { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) copyFileSync(path.join(pdfSrc, 'build', f), path.join(pdfDst, f));
cpSync(path.join(pdfSrc, 'cmaps'), path.join(pdfDst, 'cmaps'), { recursive: true });
writeFileSync(path.join(pdfDst, 'LICENSE.txt'), `PDF.js ${pdfVersion}, https://github.com/mozilla/pdf.js\n\n` + readFileSync(path.join(pdfSrc, 'LICENSE'), 'utf8'));
console.log(`vendor/pdfjs: pdf.js ${pdfVersion}, cmaps`);

/* Tesseract: распознавание текста на картинках. Одна сборка ядра (SIMD, только LSTM, wasm внутри .js):
   Chrome 116+ поддерживает SIMD везде. Модели языков tessdata_best в 8-битном виде, сжатые gzip. */
const tessVersion = version('tesseract.js');
const coreVersion = version('tesseract.js-core');
const tessDst = path.join(root, 'vendor/tesseract');
rmSync(tessDst, { recursive: true, force: true });
mkdirSync(path.join(tessDst, 'lang'), { recursive: true });
/* В сборках Tesseract.js зашиты адреса по умолчанию на cdn.jsdelivr.net: откуда брать воркер, ядро и
   модели языков, если путь не задан. Расширение всегда задаёт пути на свои файлы (src/offscreen.js),
   но Chrome Web Store считает сами строки удалённым кодом и отклоняет пакет (отказ 0.1.2, AIGW-37).
   Здесь эти адреса вырезаются. Каждый фрагмент обязан встретиться ровно один раз: при смене версии
   tesseract.js подготовка упадёт, и правку придётся сверить заново. */
const TESS_PATCH = {
  'tesseract.min.js': [
    // Адрес воркера по умолчанию.
    ['workerPath:"https://cdn.jsdelivr.net/npm/tesseract.js@v".concat(c,"/dist/worker.min.js")', 'workerPath:""'],
    // Воркер из blob с importScripts(адрес): расширение запускает воркер прямо из своего файла.
    ['if(Blob&&URL&&n){var o=new Blob([\'importScripts("\'.concat(e,\'");\')],{type:"application/javascript"});r=new Worker(URL.createObjectURL(o))}else r=new Worker(e);', 'r=new Worker(e);'],
  ],
  'worker.min.js': [
    // Адрес моделей языков по умолчанию.
    ['b=s||"https://cdn.jsdelivr.net/npm/@tesseract.js-data/".concat(i,m?"/4.0.0_best_int":"/4.0.0")', 'b=s||""'],
    // Адрес ядра по умолчанию.
    ['c=o||"https://cdn.jsdelivr.net/npm/tesseract.js-core@v".concat(h.substring(1))', 'c=o||""'],
    // Запасной способ найти глобальный объект через выполнение строки: в Chrome 116+ есть globalThis.
    ['new Function("return this")()', 'globalThis'],
  ],
};
const TESS_NOTICE = '/* Modified by Via-Tech for Velami: default CDN addresses and the blob worker loader are removed, see scripts/vendor.mjs. */\n';
for (const [f, pairs] of Object.entries(TESS_PATCH)) {
  let code = readFileSync(path.join(root, 'node_modules/tesseract.js/dist', f), 'utf8');
  for (const [from, to] of pairs) {
    const n = code.split(from).length - 1;
    if (n !== 1) {
      console.error(`tesseract.js/dist/${f}: фрагмент найден ${n} раз, ожидается 1:\n  ${from}`);
      process.exit(1);
    }
    code = code.replace(from, () => to);
  }
  if (/https?:\/\//.test(code) || /new Function\(|\beval\(/.test(code)) {
    console.error(`tesseract.js/dist/${f}: после правки остался адрес или выполнение строки`);
    process.exit(1);
  }
  writeFileSync(path.join(tessDst, f), TESS_NOTICE + code);
}
copyFileSync(path.join(root, 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), path.join(tessDst, 'tesseract-core-simd-lstm.wasm.js'));
const LANGS = ['eng', 'ita', 'rus'];
for (const l of LANGS) {
  version(`@tesseract.js-data/${l}`);
  copyFileSync(path.join(root, `node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`), path.join(tessDst, 'lang', `${l}.traineddata.gz`));
}
writeFileSync(path.join(tessDst, 'LICENSE.txt'), [
  `Tesseract.js ${tessVersion}, https://github.com/naptha/tesseract.js`,
  `Tesseract.js-core ${coreVersion}, https://github.com/naptha/tesseract.js-core (Tesseract OCR, Leptonica)`,
  `Language data ${LANGS.join(', ')}: tessdata_best, https://github.com/tesseract-ocr/tessdata_best`,
  '',
  'Changes by Via-Tech: in tesseract.min.js and worker.min.js the default CDN addresses of the',
  'worker, the core and the language data, the blob worker loader and the "new Function" global lookup are',
  'removed. The extension loads all of them from its own package. The exact replacements are in',
  'scripts/vendor.mjs of https://github.com/viatech-labs/velami. The core and the language data are unmodified.',
  '',
  readFileSync(path.join(root, 'node_modules/tesseract.js/LICENSE.md'), 'utf8'),
  readFileSync(path.join(root, 'node_modules/tesseract.js-core/LICENSE'), 'utf8'),
].join('\n'));
console.log(`vendor/tesseract: tesseract.js ${tessVersion}, core ${coreVersion}, ${LANGS.join('+')}`);

/* Шрифт меток на закрытых картинках: моноширинный, цифры и буквы не путаются (1 и I, 0 и O). */
const fontVersion = version('@fontsource/ibm-plex-mono');
const fontSrc = path.join(root, 'node_modules/@fontsource/ibm-plex-mono');
const fontDst = path.join(root, 'vendor/fonts');
rmSync(fontDst, { recursive: true, force: true });
mkdirSync(fontDst, { recursive: true });
copyFileSync(path.join(fontSrc, 'files/ibm-plex-mono-latin-600-normal.woff2'), path.join(fontDst, 'plex-mono-600.woff2'));
writeFileSync(path.join(fontDst, 'LICENSE.txt'), `IBM Plex Mono, latin 600, @fontsource/ibm-plex-mono ${fontVersion}\n\n` + readFileSync(path.join(fontSrc, 'LICENSE'), 'utf8'));
console.log(`vendor/fonts: IBM Plex Mono ${fontVersion}`);
