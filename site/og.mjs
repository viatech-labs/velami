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
      const panel = 'data:image/webp;base64,' + readFileSync(path.join(out, 'img', lang, 'panel.webp')).toString('base64');
      await page.setContent(`<!doctype html><html><head><style>
        body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #faf9f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f1e1d; }
        .g { position: absolute; right: -160px; top: -120px; width: 820px; height: 820px; background: radial-gradient(closest-side, rgba(201,100,66,.16), transparent 70%); }
        .t { position: absolute; left: 80px; top: 84px; width: 640px; }
        .b { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 650; letter-spacing: -.01em; }
        .b svg { width: 48px; height: 48px; }
        h1 { margin: 56px 0 24px; font-family: Georgia, serif; font-size: 60px; line-height: 1.05; letter-spacing: -.02em; font-weight: 500; } em { font-style: italic; color: #c96442; }
        p { margin: 0; font-size: 25px; line-height: 1.4; color: #5f5d58; }
        .u { position: absolute; left: 80px; bottom: 64px; font-size: 22px; color: #a9502f; font-weight: 600; }
        img { position: absolute; right: 70px; top: 54px; width: 360px; filter: drop-shadow(0 30px 40px rgba(31,30,29,.18)); }
      </style></head><body><div class="g"></div>
        <div class="t"><div class="b">${mark}<span>Velami</span></div><h1>${t.hero.title}</h1><p>${t.hero.eyebrow.split('·')[1].trim().replace(/^./, (c) => c.toUpperCase())}</p></div>
        <div class="u">velami.pro</div><img src="${panel}"></body></html>`, { waitUntil: 'load' });
      await page.screenshot({ path: path.join(out, 'img', `og-${lang}.png`) });
    }
  } finally {
    await browser.close();
  }
}
