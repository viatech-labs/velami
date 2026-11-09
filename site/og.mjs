// OG-картинки 1200×630 для превью ссылок: og-<lang>.png в dist/site/img.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { CONTENT } from './content.mjs';

export async function renderOg(out, langs) {
  const mark = readFileSync(path.join(out, 'favicon.svg'), 'utf8');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    for (const lang of langs) {
      const t = CONTENT[lang];
      const b64 = (f) => readFileSync(path.join(out, f)).toString('base64');
      const latin = b64('fonts/jost-latin.woff2');
      const cyr = b64('fonts/jost-cyrillic.woff2');
      const photo = 'data:image/webp;base64,' + b64('img/photo-hero.webp');
      await page.setContent(`<!doctype html><html><head><style>
        @font-face { font-family: Jost; src: url(data:font/woff2;base64,${latin}) format('woff2'); font-weight: 200 600; }
        @font-face { font-family: Jost; src: url(data:font/woff2;base64,${cyr}) format('woff2'); font-weight: 200 600; unicode-range: U+0400-04FF; }
        body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #0e0e0e; font-family: Jost, sans-serif; color: #eeeeef; }
        .p { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 70% 50%; opacity: .7; }
        .s { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(14,14,14,.95) 0%, rgba(14,14,14,.7) 50%, rgba(14,14,14,.15) 85%); }
        .t { position: absolute; left: 80px; top: 76px; width: 820px; }
        .b { display: flex; align-items: center; gap: 14px; font-size: 32px; font-weight: 400; }
        .b svg { width: 44px; height: 44px; }
        h1 { margin: 88px 0 0; font-size: 72px; line-height: 1.1; font-weight: 300; } em { font-style: normal; color: #e2967a; }
        .u { position: absolute; left: 80px; bottom: 64px; font-size: 24px; color: #a3a2a0; }
      </style></head><body><img class="p" src="${photo}"><div class="s"></div>
        <div class="t"><div class="b">${mark}<span>Velami</span></div><h1>${t.hero.title}</h1></div>
        <div class="u">velami.pro</div></body></html>`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(out, 'img', `og-${lang}.png`) });
    }
  } finally {
    await browser.close();
  }
}
