// Логотип Velami для документов, сайтов и аватаров сервисов. Запуск: npm run brand -> brand/
// Знак тот же, что в иконках расширения (tools/icons/render.mjs).
// avatar: квадрат без скруглений и полей, сервисы сами обрезают его в круг или скруглённый квадрат.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'brand');
mkdirSync(out, { recursive: true });

const GRAD = '<defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#df8462"/><stop offset="1" stop-color="#bd5a38"/></linearGradient></defs>';
const BARS = '<rect x="8" y="9" width="11" height="2.6" rx="1.3" fill="#fff" fill-opacity=".72"/><rect x="8" y="14.3" width="16" height="4.4" rx="2.2" fill="#fff"/><rect x="8" y="21.4" width="8" height="2.6" rx="1.3" fill="#fff" fill-opacity=".72"/>';
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

const MARK = svg(32, 32, `${GRAD}<rect width="32" height="32" rx="7.2" fill="url(#vg)"/>${BARS}`);
const AVATAR = svg(32, 32, `${GRAD}<rect width="32" height="32" fill="url(#vg)"/>${BARS}`);
const FONT = '-apple-system, BlinkMacSystemFont, &quot;SF Pro Display&quot;, &quot;Helvetica Neue&quot;, Arial, sans-serif';
const LOGO = (color) => svg(132, 32, `${GRAD}<rect width="32" height="32" rx="7.2" fill="url(#vg)"/>${BARS}<text x="42" y="23.6" font-family="${FONT}" font-size="22" font-weight="700" letter-spacing="-.6" fill="${color}">Velami</text>`);

writeFileSync(path.join(out, 'velami-mark.svg'), MARK);
writeFileSync(path.join(out, 'velami-avatar.svg'), AVATAR);
writeFileSync(path.join(out, 'velami-logo.svg'), LOGO('#1d1d1f'));
writeFileSync(path.join(out, 'velami-logo-white.svg'), LOGO('#ffffff'));

const PNG = [
  ['velami-mark-1024.png', MARK, 32, 32, 1024 / 32, null],
  ['velami-mark-512.png', MARK, 32, 32, 512 / 32, null],
  ['velami-mark-256.png', MARK, 32, 32, 256 / 32, null],
  ['velami-avatar-512.png', AVATAR, 32, 32, 512 / 32, null],
  ['velami-avatar-192.png', AVATAR, 32, 32, 192 / 32, null],
  ['velami-logo-light.png', LOGO('#1d1d1f'), 132, 32, 8, null],
  ['velami-logo-dark.png', LOGO('#ffffff'), 132, 32, 8, '#1c1c1e'],
];

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [name, art, w, h, scale, bg] of PNG) {
    const pad = bg ? 6 : 0;
    await page.setViewport({ width: w + pad * 2, height: h + pad * 2, deviceScaleFactor: scale });
    await page.setContent(`<html><body style="margin:0;background:${bg || 'transparent'}"><div style="padding:${pad}px;width:${w}px;height:${h}px">${art.replace('<svg ', '<svg style="display:block" ')}</div></body></html>`);
    writeFileSync(path.join(out, name), await page.screenshot({ omitBackground: !bg }));
    console.log('brand/' + name);
  }
} finally {
  await browser.close();
}
