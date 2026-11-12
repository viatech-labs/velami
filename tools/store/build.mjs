// Картинки для Chrome Web Store: кадры 1280×800 с подписью и малая плитка 440×280 на EN, IT, RU.
// Снимки берутся из настоящего Chrome с расширением на копии страницы чата (как в брошюре), данные выдуманные.
// node tools/store/build.mjs [папка расширения] [--lang en,it,ru] [--no-shots]  ->  dist/store/<lang>/
// Магазин принимает только JPEG или PNG без альфа-канала, поэтому всё сохраняется в JPEG.
import puppeteer from 'puppeteer';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureShots } from '../brochure/shots.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const noShots = argv.includes('--no-shots');
const langAt = argv.indexOf('--lang');
const langs = langAt >= 0 ? argv[langAt + 1].split(',') : ['en', 'it', 'ru'];
const extDir = path.resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lang') || root);
const dist = path.join(root, 'dist', 'store');

const TEXT = {
  en: {
    tagline: 'Private chats with AI',
    shots: [
      ['panel', 'See exactly what the model will get', 'Personal data becomes labels before the message leaves your computer'],
      ['answer', 'The answer comes back with your real data', 'Labels are swapped back only on your screen'],
      ['copy', 'Files go out with the data covered', 'PDF, Word, Excel, PowerPoint and images. See the clean copy before it is sent'],
      ['log', 'Every request stays in the log', 'The exact text that was sent, with its SHA-256'],
      ['echo', 'Don’t trust us, test it', 'A sample goes to an independent echo server and you see what arrived'],
    ],
  },
  it: {
    tagline: 'Chat private con l’IA',
    shots: [
      ['panel', 'Vedi esattamente cosa riceverà il modello', 'I dati personali diventano etichette prima che il messaggio lasci il computer'],
      ['answer', 'La risposta torna con i tuoi dati reali', 'Le etichette vengono sostituite solo sul tuo schermo'],
      ['copy', 'I file partono con i dati coperti', 'PDF, Word, Excel, PowerPoint e immagini. Guarda la copia pulita prima dell’invio'],
      ['log', 'Ogni richiesta resta nel registro', 'Il testo esatto che è partito, con il suo SHA-256'],
      ['echo', 'Non fidarti, mettici alla prova', 'Un esempio va a un server eco indipendente e vedi cosa è arrivato'],
    ],
  },
  ru: {
    tagline: 'Приватные чаты с ИИ',
    shots: [
      ['panel', 'Видно, что именно получит модель', 'Личные данные становятся метками до того, как сообщение уйдёт с компьютера'],
      ['answer', 'Ответ приходит с настоящими данными', 'Метки заменяются обратно только на вашем экране'],
      ['copy', 'Файлы уходят с закрытыми данными', 'PDF, Word, Excel, PowerPoint и картинки. Чистую копию видно до отправки'],
      ['log', 'Каждый запрос остаётся в журнале', 'Точный текст, который ушёл, и его SHA-256'],
      ['echo', 'Не верьте на слово, проверьте', 'Пример уходит на независимый эхо-сервер, и видно, что дошло'],
    ],
  },
};

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", "Segoe UI", Roboto, sans-serif';
const GRAD = '<defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#df8462"/><stop offset="1" stop-color="#bd5a38"/></linearGradient></defs>';
const BARS = '<rect x="8" y="9" width="11" height="2.6" rx="1.3" fill="#fff" fill-opacity=".72"/><rect x="8" y="14.3" width="16" height="4.4" rx="2.2" fill="#fff"/><rect x="8" y="21.4" width="8" height="2.6" rx="1.3" fill="#fff" fill-opacity=".72"/>';
const MARK = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">${GRAD}<rect width="32" height="32" rx="7.2" fill="url(#vg)"/>${BARS}</svg>`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const dataUrl = (file) => 'data:image/png;base64,' + readFileSync(file).toString('base64');
// Снимок самопроверки в shots.mjs начинается с x=220, а боковое меню страницы шириной 240px: срезаем его край (в пикселях снимка, масштаб 2).
const TRIM_LEFT = { echo: 40 };
const trimLeft = (page, url, px) => page.evaluate(async (src, cut) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth - cut;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, -cut, 0);
  return c.toDataURL('image/png');
}, url, px);

const frameHtml = (img, title, sub) => `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1280px; height: 800px; overflow: hidden; }
  body { background: #f5f5f7; font-family: ${FONT}; color: #1d1d1f; -webkit-font-smoothing: antialiased;
    display: flex; flex-direction: column; align-items: center; padding-top: 44px; }
  .head { display: flex; align-items: center; gap: 18px; max-width: 1120px; }
  h1 { font-size: 38px; font-weight: 700; letter-spacing: -.02em; line-height: 1.1; }
  p { margin-top: 10px; font-size: 20px; color: #6e6e73; letter-spacing: -.005em; text-align: center; }
  .stage { flex: 1; width: 100%; display: flex; align-items: center; justify-content: center; padding: 26px 70px 40px; min-height: 0; }
  img { display: block; max-width: 100%; max-height: 100%; border-radius: 12px; background: #fff;
    box-shadow: 0 0 0 1px rgba(29, 29, 31, .1), 0 24px 60px -24px rgba(29, 29, 31, .35); }
</style><div class="head">${MARK(40)}<h1>${esc(title)}</h1></div><p>${esc(sub)}</p><div class="stage"><img src="${img}"></div>`;

const tileHtml = (tagline) => `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 440px; height: 280px; overflow: hidden; }
  body { background: linear-gradient(160deg, #df8462 0%, #bd5a38 100%); font-family: ${FONT}; color: #fff;
    -webkit-font-smoothing: antialiased; display: flex; flex-direction: column; justify-content: center; padding: 0 40px; }
  .bars { display: flex; flex-direction: column; gap: 9px; margin-bottom: 26px; }
  .bars i { display: block; height: 9px; border-radius: 5px; background: rgba(255, 255, 255, .72); }
  .bars i:nth-child(2) { height: 15px; border-radius: 8px; background: #fff; width: 150px; }
  .bars i:nth-child(1) { width: 104px; } .bars i:nth-child(3) { width: 76px; }
  h1 { font-size: 54px; font-weight: 700; letter-spacing: -.03em; line-height: 1; }
  p { margin-top: 10px; font-size: 22px; font-weight: 500; letter-spacing: -.01em; opacity: .92; }
</style><div class="bars"><i></i><i></i><i></i></div><h1>Velami</h1><p>${esc(tagline)}</p>`;

const render = async (page, html, w, h, file) => {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: w, height: h } });
};

for (const lang of langs) {
  const T = TEXT[lang];
  if (!T) throw new Error('язык: en, it или ru');
  const work = path.join(dist, lang, 'raw');
  const out = path.join(dist, lang);
  mkdirSync(work, { recursive: true });
  if (!noShots) {
    const r = await captureShots({ extDir, out: work, lang });
    const bad = r.echoChecks.filter((c) => !c.startsWith('ok'));
    if (bad.length) throw new Error('самопроверка на эхо-сервере не чистая:\n' + bad.join('\n'));
  }
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [i, [shot, title, sub]] of T.shots.entries()) {
      const src = path.join(work, shot + '.png');
      if (!existsSync(src)) throw new Error('нет снимка ' + src + ', запусти без --no-shots');
      const img = TRIM_LEFT[shot] ? await trimLeft(page, dataUrl(src), TRIM_LEFT[shot]) : dataUrl(src);
      await render(page, frameHtml(img, title, sub), 1280, 800, path.join(out, `${i + 1}-${shot}.jpg`));
    }
    await render(page, tileHtml(T.tagline), 440, 280, path.join(out, 'promo-440x280.jpg'));
  } finally {
    await browser.close();
  }
  console.log(`${lang}: ${T.shots.length} кадров и плитка в ${path.relative(root, out)}/`);
}
