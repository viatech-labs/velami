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
for (const f of ['tesseract.min.js', 'worker.min.js']) copyFileSync(path.join(root, 'node_modules/tesseract.js/dist', f), path.join(tessDst, f));
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
