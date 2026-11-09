// Брошюра Velami: снимки экранов с настоящим расширением и вёрстка в PDF.
// node tools/brochure/build.mjs [папка расширения] [--lang it|ru] [--no-shots]
//   -> dist/brochure/velami-guida-it.pdf, dist/brochure/velami-rukovodstvo-ru.pdf
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureShots } from './shots.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const noShots = argv.includes('--no-shots');
const langAt = argv.indexOf('--lang');
const lang = langAt >= 0 ? argv[langAt + 1] : 'it';
const OUT = { it: { file: 'velami-guida-it.pdf', locale: 'it-IT' }, ru: { file: 'velami-rukovodstvo-ru.pdf', locale: 'ru-RU' } }[lang];
if (!OUT) throw new Error('язык брошюры: it или ru');
const { brochureHtml } = await import(`./content-${lang}.mjs`);
const extDir = path.resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lang') || root);
const dist = path.join(root, 'dist', 'brochure');
const work = path.join(dist, lang);
mkdirSync(work, { recursive: true });

const version = JSON.parse(readFileSync(path.join(extDir, 'manifest.json'), 'utf8')).version;
const metaFile = path.join(work, 'meta.json');
let meta;
if (noShots) meta = JSON.parse(readFileSync(metaFile, 'utf8'));
else {
  const r = await captureShots({ extDir, out: work, lang });
  meta = { prompt: r.prompt, message: r.message };
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  const bad = r.echoChecks.filter((c) => !c.startsWith('ok'));
  if (bad.length) throw new Error('самопроверка на эхо-сервере не чистая:\n' + bad.join('\n'));
}

const date = new Intl.DateTimeFormat(OUT.locale, { month: 'long', year: 'numeric' }).format(new Date()).replace(/ г\.$/, '');
const htmlFile = path.join(work, 'brochure.html');
writeFileSync(htmlFile, brochureHtml({ version, date: date[0].toUpperCase() + date.slice(1), ...meta }));

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'networkidle0' });
  const overflow = await page.$$eval('.page', (pages) => pages.map((p, i) => {
    const limit = p.getBoundingClientRect().bottom - 16 * 3.78;
    const last = [...p.querySelectorAll('*')].filter((n) => !n.closest('footer') && !n.closest('.cover-foot') && !n.closest('.end'))
      .reduce((m, n) => Math.max(m, n.getBoundingClientRect().bottom), 0);
    return last > limit ? `стр. ${i + 1}: вылезает на ${Math.round((last - limit) / 3.78)} мм` : null;
  }).filter(Boolean));
  if (overflow.length) console.warn('Не помещается:\n' + overflow.join('\n'));
  const pdf = path.join(dist, OUT.file);
  await page.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
  const pages = await page.$$('.page');
  if (process.platform === 'darwin') {
    execFileSync('swift', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'quartz-pages.swift'), pdf, work], { stdio: 'inherit' });
  } else {
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
    for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(work, `page-${String(i + 1).padStart(2, '0')}.png`) });
  }
  console.log(`${pdf}  страниц: ${pages.length}`);
} finally {
  await browser.close();
}
