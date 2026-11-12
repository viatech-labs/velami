#!/usr/bin/env node
import { createHash } from 'node:crypto';
// Сборка velami.pro в dist/site: index.<lang>.html и privacy.<lang>.html для en/it/ru, стили, шрифты, WebP-картинки.
// Скриншоты снимаются из настоящего расширения (tools/brochure/shots.mjs) в /tmp/shots-<lang> или --shots <dir>.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { CONTENT, REPO, DOWNLOAD, MAIL, SITES, OPTIONAL_SITES } from './content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const PG = require('../src/detector.js');
const I18N = require('../src/i18n.js');
const SRC = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'dist', 'site');
const LANGS = ['en', 'it', 'ru'];
const ORIGIN = 'https://velami.pro';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SHOTS = arg('--shots', '/tmp/shots-{lang}');
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
const PKG_SHA = (existsSync(path.join(ROOT, 'dist', `velami-${VERSION}.zip.sha256`)) ? readFileSync(path.join(ROOT, 'dist', `velami-${VERSION}.zip.sha256`), 'utf8') : '0'.repeat(64)).split(/\s/)[0];
/* Число файлов в пакете берётся из списка сборки, чтобы пример на сайте совпадал с выпущенной версией. */
const PKG_LIST = path.join(ROOT, 'dist', `velami-${VERSION}.files.json`);
const PKG_FILES = existsSync(PKG_LIST) ? Object.keys(JSON.parse(readFileSync(PKG_LIST, 'utf8')).files).length : 0;
/* Цифры на плитках считаются из кода: сколько видов меток знает детектор и сколько сайтов поддержано. */
const FACTS = {
  types: Object.keys(I18N.MESSAGES.en).filter((k) => k.startsWith('type.')).length,
  sites: SITES.length + OPTIONAL_SITES.length,
  on: SITES.length,
  opt: OPTIONAL_SITES.length,
};
const fact = (s) => s.replace(/\{(\w+)\}/g, (m, k) => FACTS[k] ?? m);
/* Форматы сверены с src/content.js (TEXT_EXT, DOC_EXT, OCR_IMAGE). Текстовых расширений там больше, здесь самые частые. */
const FORMATS = ['.txt', '.csv', '.docx', '.xlsx', '.pptx', '.pdf', '.png', '.jpg'];

const NB = '\u00a0';
const glue = (s) => {
  let r = s.replace(/(^|[\s(>])([\p{L}]{1,2})\s+(?=[\p{L}\d[])/gu, `$1$2${NB}`).replace(/(^|[\s(>])([\p{L}]{1,2})\s+(?=[\p{L}\d[])/gu, `$1$2${NB}`);
  if (r.length < 90) r = r.replace(/ (\S{1,12})$/u, `${NB}$1`).replace(/ (\S{1,12})<br>/u, `${NB}$1<br>`);
  return r;
};
const typo = (v) => v == null ? v : typeof v === 'string' ? glue(v) : Array.isArray(v) ? v.map(typo) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typo(x)]));
// Подписи к цифрам стоят в узких плитках, поэтому к ним неразрывные пробелы не добавляются.
const T = Object.fromEntries(LANGS.map((l) => [l, { ...typo(CONTENT[l]), stats: CONTENT[l].stats, title: CONTENT[l].title, description: CONTENT[l].description }]));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rich = (s) => esc(s).replace(/\[\[([A-Z_0-9]+)\]\]/g, '<code class="tok">[[$1]]</code>');
const toks = (x) => esc(x).replace(/\[\[([A-Z_]+_\d+)\]\]/g, '<mark class="tok">[[$1]]</mark>');

const ICONS = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9.5 8h.01M14.5 8h.01M9.5 12h.01M14.5 12h.01M10 21v-4h4v4"/>',
};
const WHO_ICONS = ['user', 'briefcase', 'code', 'building'];
const GH = '<path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>';
const icon = (n, cls = 'ic') => n === 'gh'
  ? `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true">${GH}</svg>`
  : `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

const MARK_SVG = readFileSync(path.join(ROOT, 'brand', 'velami-mark.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');
let markN = 0;
const mark = (cls = 'mark') => { const id = 'vg' + ++markN; return MARK_SVG.replace(/id="vg"/, `id="${id}"`).replace(/url\(#vg\)/, `url(#${id})`).replace('<svg ', `<svg class="${cls}" aria-hidden="true" `); };

function head(t, lang, { title, description, canonical, og }) {
  const alt = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN}/${l}/${canonical}">`).join('\n  ');
  const preload = [...(lang === 'ru' ? ['cyrillic'] : []), 'latin'].map((sub) => `<link rel="preload" href="/fonts/onest-${sub}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n  ');
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#ffffff">
  <link rel="canonical" href="${ORIGIN}/${lang}/${canonical}">
  ${alt}
  <link rel="alternate" hreflang="x-default" href="${ORIGIN}/${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Velami">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${ORIGIN}/${lang}/${canonical}">
  <meta property="og:locale" content="${t.locale}">
  <meta property="og:image" content="${ORIGIN}/img/og-${lang}.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  ${og || ''}
  ${preload}
  <link rel="stylesheet" href="/style.css?v=${HASH}">
</head>`;
}

// Мини-сцены к шагам: настоящий текст, найденный тем же детектором, что в расширении.
function scenes(lang) {
  const sc = CONTENT[lang].scene;
  const r = PG.maskText(sc.msg, { vault: new PG.Vault() });
  const values = Object.fromEntries(r.findings.map((f) => [f.token, f.value]));
  let cur = 0;
  let hot = '';
  for (const f of r.findings) { hot += esc(sc.msg.slice(cur, f.start)) + `<mark class="hot">${esc(f.value)}</mark>`; cur = f.end; }
  hot += esc(sc.msg.slice(cur));
  const masked = esc(r.text).replace(/\[\[([A-Z_]+)_(\d+)\]\]/g, '<mark class="tok">[[$1_$2]]</mark>');
  const back = esc(sc.answer).replace(/\[\[([A-Z_]+_\d+)\]\]/g, (m, k) => `<mark class="back">${esc(values['[[' + k + ']]'] || m)}</mark>`);
  const card = (who, body, cls = '') => `<div class="scene ${cls}"><p class="scene-who">${esc(who)}</p><p class="scene-msg">${body}</p></div>`;
  return [card(sc.you, hot), card(sc.ai, masked, 'scene-ai'), card(sc.back, back, 'scene-back')];
}

// На главной ссылки меню ведут к якорям той же страницы, на странице политики к главной на том же языке.
function header(t, lang, home = '') {
  return `<a class="skip" href="#main">${esc(t.skip)}</a>
<header class="top">
  <div class="wrap top-in">
    <a class="brand" href="/${lang}/" aria-label="Velami">${mark()}<span>Velami</span></a>
    <nav class="nav" aria-label="Velami">
      <a href="${home}#how">${esc(t.nav.how)}</a>
      <a href="${home}#check">${esc(t.nav.check)}</a>
      <a href="${home}#teams">${esc(t.nav.teams)}</a>
      <a href="${home}#faq">${esc(t.nav.faq)}</a>
    </nav>
    <a class="btn btn-sm btn-primary top-cta" href="${DOWNLOAD}">${esc(t.nav.cta)}</a>
  </div>
</header>`;
}

function footer(t, lang, home = '') {
  return `<footer class="foot">
  <div class="wrap foot-in">
    <div class="foot-brand">
      <a class="brand" href="/${lang}/">${mark()}<span>Velami</span></a>
      <p>${esc(t.footer.tagline)}</p>
    </div>
    <nav class="foot-links" aria-label="Velami">
      <a href="${home}#how">${esc(t.nav.how)}</a>
      <a href="${home}#check">${esc(t.nav.check)}</a>
      <a href="${home}#teams">${esc(t.nav.teams)}</a>
      <a href="${home}#faq">${esc(t.nav.faq)}</a>
      <a href="/${lang}/privacy">${esc(t.footer.privacy)}</a>
      <a href="${REPO}">${esc(t.footer.source)}</a>
      <a href="mailto:${MAIL}">${MAIL}</a>
    </nav>
    <p class="foot-meta">${esc(t.footer.made)} <a href="https://via-tech.org">Via-Tech</a> · AGPL-3.0 · v${VERSION} · ${esc(t.footer.clean)}</p>
  </div>
</footer>`;
}

// Размеры картинки берутся из исходного PNG, чтобы место под неё было занято ещё до загрузки.
function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
const SIZES = {};
function picture(lang, name, alt) {
  const { w, h } = SIZES[`${lang}/${name}`];
  return `<img src="/img/${lang}/${name}.webp" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async">`;
}

// Живое демо на первом экране. Первый кадр считаем при сборке тем же детектором, чтобы без JS страница выглядела так же.
function demoBlock(t, lang) {
  const labels = Object.fromEntries(Object.entries(I18N.MESSAGES[lang]).filter(([k]) => k.startsWith('type.')).map(([k, v]) => [k.slice(5), v]));
  const sample = CONTENT[lang].demo.sample;
  const r = PG.maskText(sample, { vault: new PG.Vault() });
  const outHtml = esc(r.text).replace(/\[\[([A-Z_]+)_(\d+)\]\]/g, '<mark class="tok">[[$1_$2]]</mark>');
  const chips = r.findings.map((f) => `<li><span>${esc(labels[f.type] || f.type)}</span><code>${esc(f.token)}</code></li>`).join('');
  return `<div class="demo" id="demo" data-labels="${esc(JSON.stringify(labels))}" data-count="${esc(t.demo.count)}" data-none="${esc(t.demo.none)}">
          <div class="demo-bar"><i></i><i></i><i></i><span>${esc(t.demo.label)}</span></div>
          <div class="demo-body">
            <div class="pane pane-in">
              <div class="pane-h">${esc(t.demo.you)}</div>
              <label class="sr" for="demo-in">${esc(t.demo.you)}</label>
              <textarea id="demo-in" spellcheck="false" rows="3">${esc(sample)}</textarea>
            </div>
            <div class="pane-link" aria-hidden="true"><span>${mark('mark mark-s')}<b>Velami</b>${icon('down', 'ic ic-link')}</span></div>
            <div class="pane pane-out">
              <div class="pane-h">${esc(t.demo.ai)}<span class="count on" id="demo-count">${esc(t.demo.count.replace('{n}', r.findings.length))}</span></div>
              <div class="out" id="demo-out" aria-live="polite">${outHtml}</div>
              <ul class="found" id="demo-found">${chips}</ul>
            </div>
          </div>
        </div>
        <p class="demo-note">${esc(t.demo.note)}</p>`;
}

function index(lang) {
  const t = T[lang];
  const sc = scenes(lang);
  const secH = (tag, h, lead) => `<header class="sec-h reveal">
        <p class="tag">${esc(tag)}</p>
        <h2>${esc(h)}</h2>${lead ? `\n        <p class="lead">${esc(lead)}</p>` : ''}
      </header>`;
  const works = SITES.map((s) => `<li class="site">${esc(s)}</li>`).join('') + OPTIONAL_SITES.map((s) => `<li class="site opt">${esc(s)}</li>`).join('');
  const stats = t.stats.map(([n, l]) => `<div class="stat"><dt>${esc(fact(n))}</dt><dd>${esc(fact(l))}</dd></div>`).join('');
  const whos = t.who.cards.map(([h, p, eg], i) => `
        <article class="cell who who-${i + 1} reveal">
          <span class="who-ic">${icon(WHO_ICONS[i])}</span>
          <h3>${esc(h)}</h3>
          <p>${esc(p)}</p>
          <p class="who-eg"><span>${esc(t.who.eg)}</span>${esc(eg)}</p>
        </article>`).join('');
  const steps = t.how.steps.map(([h, p], i) => `
        <article class="cell step reveal">
          <div class="step-art">${sc[i]}</div>
          <div class="step-text">
            <p class="step-n">0${i + 1}</p>
            <h3>${esc(h)}</h3>
            <p>${rich(p)}</p>
          </div>
        </article>`).join('');
  const pr = CONTENT[lang].proof;
  const logSha = createHash('sha256').update(pr.logText).digest('hex');
  const mocks = [
    `<div class="mock"><p class="mock-h">${esc(pr.panel)}</p><ul class="mock-list">${pr.items.map(([v, k]) => `<li class="${k ? 'on' : 'off'}"><span class="box"></span><span class="v">${esc(v)}</span>${k ? `<mark class="tok">${esc(k)}</mark>` : `<small>${esc(pr.keep)}</small>`}</li>`).join('')}</ul></div>`,
    `<div class="mock"><p class="mock-h">${esc(pr.log)}</p><p class="mock-msg">${toks(pr.logText)}</p><p class="mock-sha">SHA-256 ${logSha.slice(0, 24)}…</p></div>`,
    `<div class="mock"><p class="mock-h">${esc(pr.echo)}</p><p class="mock-msg">${toks(pr.logText)}</p><p class="mock-ok">✓ ${esc(pr.echoOk)}</p></div>`,
    `<pre class="term"><code><span class="dim">$</span> shasum -a 256 velami-${VERSION}.zip\n${PKG_SHA.slice(0, 40)}…\n<span class="dim">$</span> npm run verify\n<span class="ok">✓ ${PKG_FILES || 224} files match the sources</span></code></pre>`,
  ];
  const proofs = t.check.cards.map(([h, p], i) => `
        <article class="cell proof reveal">
          <div class="proof-art">${mocks[i]}</div>
          <h3>${esc(h)}</h3>
          <p>${esc(p)}</p>
        </article>`).join('');
  const chips = t.types.list.map((x) => `<li>${esc(x)}</li>`).join('');
  const teams = t.teams.cards.map(([h, p], i) => `
        <article class="cell team reveal">
          <p class="step-n">0${i + 1}</p>
          <h3>${esc(h)}</h3>
          <p>${esc(p)}</p>
        </article>`).join('');
  const faq = t.faq.items.map(([q, a]) => `
        <details>
          <summary>${esc(q)}</summary>
          <p>${esc(a)}</p>
        </details>`).join('');
  const ld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Velami',
    applicationCategory: 'BrowserApplication', operatingSystem: 'Chrome', softwareVersion: VERSION,
    description: t.description, url: `${ORIGIN}/${lang}/`, inLanguage: lang, license: 'https://www.gnu.org/licenses/agpl-3.0.html',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    publisher: { '@type': 'Organization', name: 'Via-Tech', url: 'https://via-tech.org', email: MAIL },
  };

  return `${head(t, lang, { title: t.title, description: t.description, canonical: '', og: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` })}
<body>
${header(t, lang)}
<main id="main">
  <section class="hero">
    <div class="wrap hero-in">
      <div class="hero-text">
        <h1>${t.hero.title}</h1>
        <p class="hero-sub">${esc(t.hero.lead)}</p>
        <div class="ctas">
          <a class="btn btn-primary" href="${DOWNLOAD}">${icon('download')}${esc(t.hero.cta)}</a>
          <a class="btn btn-ghost" href="${REPO}">${icon('gh')}${esc(t.hero.source)}</a>
        </div>
        <p class="hero-note">${esc(t.hero.note)}</p>
      </div>
      <div class="hero-demo">
        ${demoBlock(t, lang)}
      </div>
    </div>
    <div class="wrap">
      <ul class="works"><li class="lbl">${esc(t.works)}</li>${works}<li class="lbl lbl-opt">${esc(t.sites.optional)}</li></ul>
    </div>
  </section>

  <section class="stats">
    <div class="wrap">
      <dl class="stats-in">${stats}</dl>
    </div>
  </section>

  <section id="who" class="sec">
    <div class="wrap">
      ${secH(t.tags.who, t.who.title, t.who.lead)}
      <div class="grid g4">${whos}
      </div>
    </div>
  </section>

  <section id="how" class="sec">
    <div class="wrap">
      ${secH(t.nav.how, t.how.title, t.how.lead)}
      <div class="grid g3">${steps}
      </div>
    </div>
  </section>

  <section id="check" class="sec sec-dark">
    <div class="wrap">
      ${secH(t.nav.check, t.check.title, t.check.lead)}
      <div class="grid g2">${proofs}
      </div>
      <figure class="frame reveal">
        <div class="frame-bar"><i></i><i></i><i></i><span>${esc(t.logTitle)}</span></div>
        ${picture(lang, 'log', t.check.alt)}
      </figure>
    </div>
  </section>

  <section id="hides" class="sec">
    <div class="wrap">
      ${secH(t.tags.hides, t.rows.title)}
      <article class="cell feat reveal">
        <div class="feat-text">
          <h3>${esc(t.rows.msg)}</h3>
          <p>${esc(t.types.lead)}</p>
          <ul class="chips">${chips}</ul>
        </div>
        <div class="feat-art">${picture(lang, 'panel', t.hero.alt)}</div>
      </article>
      <div class="grid g2 grid-next">
        <article class="cell card reveal">
          <h3>${esc(t.rows.files)}</h3>
          <p>${esc(t.files.text)}</p>
          <ul class="chips chips-mono">${FORMATS.map((f) => `<li>${f}</li>`).join('')}</ul>
        </article>
        <article class="cell card reveal">
          <h3>${esc(t.rows.sites)}</h3>
          <p>${esc(t.sites.text)}</p>
          <ul class="sites">${SITES.map((s) => `<li>${esc(s)}</li>`).join('')}${OPTIONAL_SITES.map((s) => `<li class="opt">${esc(s)}</li>`).join('')}</ul>
        </article>
      </div>
    </div>
  </section>

  <section id="teams" class="sec">
    <div class="wrap">
      ${secH(t.tags.teams, t.teams.title, t.teams.lead)}
      <div class="grid g3">${teams}
      </div>
      <div class="ctas ctas-sec reveal">
        <a class="btn btn-primary" href="mailto:${MAIL}?subject=Velami">${esc(t.teams.cta)}</a>
        <a class="btn btn-ghost" href="${REPO}/blob/main/docs/ENTERPRISE.md">${esc(t.teams.guide)}${icon('arrow')}</a>
      </div>
    </div>
  </section>

  <section id="faq" class="sec">
    <div class="wrap faq-in">
      ${secH(t.tags.faq, t.faq.title)}
      <div class="faq reveal">${faq}
      </div>
    </div>
  </section>

  <section class="final">
    <div class="wrap">
      <div class="final-in">
        <h2>${esc(t.final.title)}</h2>
        <p>${esc(t.final.text)}</p>
        <div class="ctas">
          <a class="btn btn-invert" href="${DOWNLOAD}">${icon('download')}${esc(t.hero.cta)}</a>
          <a class="btn btn-invert-ghost" href="mailto:${MAIL}">${esc(t.final.ask)}</a>
        </div>
      </div>
    </div>
  </section>
</main>
${footer(t, lang)}
<script src="/detector.js?v=${HASH}"></script>
<script src="/demo.js?v=${HASH}"></script>
</body>
</html>
`;
}

// PRIVACY.md: три языковых раздела под заголовками "## English" / "## Italiano" / "## Русский".
function privacySections() {
  const md = readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');
  const version = md.split('\n').find((l) => /^Version/.test(l)) || '';
  const parts = {};
  const names = { English: 'en', Italiano: 'it', 'Русский': 'ru' };
  for (const chunk of md.split(/^## /m).slice(1)) {
    const [title, ...rest] = chunk.split('\n');
    const lang = names[title.trim()];
    if (lang) parts[lang] = rest.join('\n').replace(/^---\s*$/m, '').trim();
  }
  return { parts, version };
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,])/g, '$1<a href="$2">$2</a>')
    .replace(/(^|[\s(])([a-z0-9.]+@[a-z0-9.-]+\.[a-z]{2,})/gi, '$1<a href="mailto:$2">$2</a>');
}

function md2html(md) {
  const out = [];
  let list = null;
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const close = () => { if (list) { out.push(`<ul>${list.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); list = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (/^###\s/.test(line)) { flush(); close(); out.push(`<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`); continue; }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) { flush(); (list ||= []).push(li[1].replace(/;$/, '')); continue; }
    if (list && /^\s{2,}\S/.test(line)) { list[list.length - 1] += ' ' + line.trim().replace(/;$/, ''); continue; }
    if (!line.trim()) { flush(); close(); continue; }
    close();
    para.push(line.trim());
  }
  flush(); close();
  return out.join('\n');
}

function privacy(lang, sections) {
  const t = T[lang];
  const home = `/${lang}/`;
  const body = md2html(sections.parts[lang]);
  const ver = { en: sections.version, it: sections.version.replace('Version', 'Versione').replace('November', 'novembre'), ru: sections.version.replace('Version', 'Версия').replace('November', 'ноября') }[lang];
  // Заголовок без неразрывных пробелов: на узком экране длинное название должно переноситься.
  return `${head(t, lang, { title: `${t.privacy.title} · Velami`, description: t.description, canonical: 'privacy' })}
<body>
${header(t, lang, home)}
<main id="main" class="doc">
  <div class="wrap doc-in">
    <a class="back" href="${home}">${icon('arrow', 'ic ic-flip')}${esc(t.privacy.back)}</a>
    <h1>${esc(CONTENT[lang].privacy.title)}</h1>
    <p class="doc-ver">${inline(ver.split('. Extension')[0])}.</p>
    ${body}
  </div>
</main>
${footer(t, lang, home)}
</body>
</html>
`;
}

function webp(src, dst, width) {
  const args = ['-quiet', '-q', '82', '-m', '6', '-metadata', 'none'];
  if (width) args.push('-resize', String(width), '0');
  execFileSync('cwebp', [...args, src, '-o', dst]);
}

let HASH = '';

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(path.join(OUT, 'img'), { recursive: true });

  const css = readFileSync(path.join(SRC, 'fonts', 'fonts.css'), 'utf8') + '\n' + readFileSync(path.join(SRC, 'style.css'), 'utf8');
  mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
  for (const f of readdirSync(path.join(SRC, 'fonts')).filter((x) => x.endsWith('.woff2'))) copyFileSync(path.join(SRC, 'fonts', f), path.join(OUT, 'fonts', f));
  // Моноширинный шрифт берётся из того же пакета, что и в расширении (scripts/vendor.mjs), в репозитории его копии нет.
  const plex = path.join(ROOT, 'node_modules', '@fontsource', 'ibm-plex-mono', 'files');
  for (const w of [400, 500, 600]) for (const sub of ['latin', 'cyrillic']) copyFileSync(path.join(plex, `ibm-plex-mono-${sub}-${w}-normal.woff2`), path.join(OUT, 'fonts', `plex-${sub}-${w}.woff2`));
  copyFileSync(path.join(ROOT, 'src', 'detector.js'), path.join(OUT, 'detector.js'));
  copyFileSync(path.join(SRC, 'demo.js'), path.join(OUT, 'demo.js'));
  const { createHash } = await import('node:crypto');
  HASH = createHash('sha256').update(css).update(readFileSync(path.join(SRC, 'demo.js'))).update(readFileSync(path.join(ROOT, 'src', 'detector.js'))).digest('hex').slice(0, 10);
  writeFileSync(path.join(OUT, 'style.css'), css);

  const mark = readFileSync(path.join(ROOT, 'brand', 'velami-mark.svg'), 'utf8');
  writeFileSync(path.join(OUT, 'favicon.svg'), mark);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(ROOT, 'brand', 'velami-mark-256.png'), '-vf', 'scale=32:32:flags=lanczos', path.join(OUT, 'favicon-32.png')]);
  copyFileSync(path.join(ROOT, 'brand', 'velami-avatar-192.png'), path.join(OUT, 'apple-touch-icon.png'));
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(ROOT, 'brand', 'velami-mark-256.png'), '-vf', 'scale=48:48:flags=lanczos', '-f', 'ico', path.join(OUT, 'favicon.ico')]);

  const sections = privacySections();
  for (const lang of LANGS) {
    const shots = SHOTS.replace('{lang}', lang);
    const dir = path.join(OUT, 'img', lang);
    mkdirSync(dir, { recursive: true });
    const need = { panel: ['panel-alpha.png'], log: ['log.png', 1600] };
    for (const [name, [file, w]] of Object.entries(need)) {
      const src = path.join(shots, file);
      if (!existsSync(src)) throw new Error(`нет скриншота ${src}`);
      webp(src, path.join(dir, name + '.webp'), w);
      const size = pngSize(src);
      SIZES[`${lang}/${name}`] = w ? { w, h: Math.round(size.h * w / size.w) } : size;
    }
    writeFileSync(path.join(OUT, `index.${lang}.html`), index(lang));
    writeFileSync(path.join(OUT, `privacy.${lang}.html`), privacy(lang, sections));
  }

  writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  const urls = LANGS.flatMap((l) => ['', 'privacy'].map((p) => `  <url><loc>${ORIGIN}/${l}/${p}</loc>${LANGS.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${ORIGIN}/${a}/${p}"/>`).join('')}</url>`));
  writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`);
  writeFileSync(path.join(OUT, '.well-known-security.txt'), `Contact: mailto:${MAIL}\nPolicy: ${REPO}/blob/main/SECURITY.md\nPreferred-Languages: en, it, ru\nExpires: 2027-11-01T00:00:00.000Z\n`);

  const og = path.join(SRC, 'og.mjs');
  if (existsSync(og) && !process.argv.includes('--no-og')) await (await import(og)).renderOg(OUT, LANGS);
  console.log('site →', path.relative(ROOT, OUT));
}

main().catch((e) => { console.error(e); process.exit(1); });
