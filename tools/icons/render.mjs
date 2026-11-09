// Иконки расширения из знака Velami. Запуск: npm run icons
// 128 px по правилам Chrome Web Store: рисунок 96 px и прозрачные поля по 16 px.
// В 16 px две полосы вместо трёх, иначе они сливаются.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FULL = '<defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#df8462"/><stop offset="1" stop-color="#bd5a38"/></linearGradient></defs><rect width="32" height="32" rx="7.2" fill="url(#vg)"/><rect x="8" y="9" width="11" height="2.6" rx="1.3" fill="#fff" fill-opacity=".72"/><rect x="8" y="14.3" width="16" height="4.4" rx="2.2" fill="#fff"/><rect x="8" y="21.4" width="8" height="2.6" rx="1.3" fill="#fff" fill-opacity=".72"/>';
const SMALL = '<defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#df8462"/><stop offset="1" stop-color="#bd5a38"/></linearGradient></defs><rect width="32" height="32" rx="7.2" fill="url(#vg)"/><rect x="6" y="8" width="13" height="5" rx="2.5" fill="#fff" fill-opacity=".75"/><rect x="6" y="17" width="20" height="7" rx="3.5" fill="#fff"/>';
const SIZES = [[16, SMALL, 0], [32, FULL, 0], [48, FULL, 0], [128, FULL, 16]];

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [size, art, pad] of SIZES) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const inner = size - pad * 2;
    await page.setContent(`<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${inner}" height="${inner}" style="display:block;margin:${pad}px">${art}</svg></body></html>`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(path.join(root, 'icons', `${size}.png`), png);
    console.log(`icons/${size}.png`);
  }
} finally {
  await browser.close();
}
