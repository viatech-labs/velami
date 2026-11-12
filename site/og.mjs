// OG-картинки 1200×630 для превью ссылок: og-<lang>.png в dist/site/img.
// Тот же вид, что у сайта: белый фон, заголовок и пример «вы пишете → ИИ получает», посчитанный настоящим детектором.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import { CONTENT } from './content.mjs';

const PG = createRequire(import.meta.url)('../src/detector.js');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function renderOg(out, langs) {
  const mark = readFileSync(path.join(out, 'favicon.svg'), 'utf8');
  const font = (f) => `url(data:font/woff2;base64,${readFileSync(path.join(out, 'fonts', f)).toString('base64')}) format('woff2')`;
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    for (const lang of langs) {
      const t = CONTENT[lang];
      const r = PG.maskText(t.scene.msg, { vault: new PG.Vault() });
      let cur = 0;
      let you = '';
      for (const f of r.findings) { you += esc(t.scene.msg.slice(cur, f.start)) + `<mark>${esc(f.value)}</mark>`; cur = f.end; }
      you += esc(t.scene.msg.slice(cur));
      const ai = esc(r.text).replace(/\[\[([A-Z_]+_\d+)\]\]/g, '<code>[[$1]]</code>');
      await page.setContent(`<!doctype html><html lang="${lang}"><head><style>
        @font-face { font-family: Onest; src: ${font('onest-latin.woff2')}; font-weight: 100 900; }
        @font-face { font-family: Onest; src: ${font('onest-cyrillic.woff2')}; font-weight: 100 900; unicode-range: U+0400-04FF; }
        @font-face { font-family: Plex; src: ${font('plex-latin-500.woff2')}; font-weight: 500; }
        @font-face { font-family: Plex; src: ${font('plex-cyrillic-500.woff2')}; font-weight: 500; unicode-range: U+0400-04FF; }
        * { box-sizing: border-box; margin: 0; }
        body { width: 1200px; height: 630px; overflow: hidden; padding: 56px 64px; background: #fff; color: #1d1815; font-family: Onest, sans-serif; display: flex; flex-direction: column; }
        .b { display: flex; align-items: center; gap: 14px; font-size: 34px; font-weight: 600; letter-spacing: -.02em; }
        .b svg { width: 46px; height: 46px; border-radius: 12px; }
        .b span:last-child { margin-left: auto; font: 500 22px Plex, monospace; letter-spacing: 0; color: #6f665e; }
        h1 { margin-top: 40px; font-size: 76px; line-height: 1.04; font-weight: 700; letter-spacing: -.035em; }
        em { font-style: normal; color: #c96442; }
        .s { margin-top: auto; display: grid; grid-template-columns: 1fr 44px 1fr; align-items: center; padding: 26px 30px; border-radius: 36px; background: linear-gradient(150deg, #fde8dd, #f9dccb 55%, #f7e6d3); }
        .c { height: 100%; padding: 20px 24px 22px; border-radius: 22px; background: #fff; box-shadow: 0 18px 34px -22px rgba(110, 50, 25, .5); }
        .c p:first-child { margin-bottom: 10px; font: 500 17px Plex, monospace; letter-spacing: .08em; text-transform: uppercase; color: #6f665e; }
        .c p:last-child { font-size: 25px; line-height: 1.5; }
        .a { justify-self: center; font-size: 30px; font-weight: 600; color: #c96442; }
        mark { padding: 1px 4px; background: rgba(201, 100, 66, .13); box-shadow: inset 0 -3px 0 #c96442; color: inherit; white-space: nowrap; }
        code { padding: 2px 8px; border-radius: 8px; background: rgba(201, 100, 66, .13); color: #9c4a2c; font: 500 20px Plex, monospace; white-space: nowrap; }
      </style></head><body>
        <div class="b">${mark}<span>Velami</span><span>velami.pro</span></div>
        <h1>${t.hero.title}</h1>
        <div class="s">
          <div class="c"><p>${esc(t.scene.you)}</p><p>${you}</p></div>
          <div class="a">→</div>
          <div class="c"><p>${esc(t.scene.ai)}</p><p>${ai}</p></div>
        </div></body></html>`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(out, 'img', `og-${lang}.png`) });
    }
  } finally {
    await browser.close();
  }
}
