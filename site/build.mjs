#!/usr/bin/env node
// Сборка velami.pro в dist/site: index.<lang>.html и privacy.<lang>.html для en/it/ru, стили, WebP-картинки.
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

const NB = '\u00a0';
const glue = (s) => {
  let r = s.replace(/(^|[\s(>])([\p{L}]{1,2})\s+(?=[\p{L}\d[])/gu, `$1$2${NB}`).replace(/(^|[\s(>])([\p{L}]{1,2})\s+(?=[\p{L}\d[])/gu, `$1$2${NB}`);
  if (r.length < 90) r = r.replace(/ (\S{1,12})$/u, `${NB}$1`).replace(/ (\S{1,12})<br>/u, `${NB}$1<br>`);
  return r;
};
const typo = (v) => typeof v === 'string' ? glue(v) : Array.isArray(v) ? v.map(typo) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typo(x)]));
const T = Object.fromEntries(LANGS.map((l) => [l, { ...typo(CONTENT[l]), title: CONTENT[l].title, description: CONTENT[l].description }]));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rich = (s) => esc(s).replace(/\[\[([A-Z_0-9]+)\]\]/g, '<code class="tok">[[$1]]</code>');

const ICONS = {
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  log: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.3 21.5h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7.5 15h9"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M8 7h8M8 11h6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  gh: null,
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
};
const icon = (n, cls = 'ic') => n === 'gh'
  ? `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`
  : `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

const MARK_SVG = readFileSync(path.join(ROOT, 'brand', 'velami-mark.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');
let markN = 0;
const mark = (cls = 'mark') => { const id = 'vg' + ++markN; return MARK_SVG.replace(/id="vg"/, `id="${id}"`).replace(/url\(#vg\)/, `url(#${id})`).replace('<svg ', `<svg class="${cls}" aria-hidden="true" `); };

function head(t, lang, { title, description, canonical, og }) {
  const alt = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN}/${l}/${canonical}">`).join('\n  ');
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#faf9f5" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1f1e1d" media="(prefers-color-scheme: dark)">
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
  <link rel="preload" href="/fonts/source-serif-4-${lang === 'ru' ? 'cyrillic' : 'latin'}.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/style.css?v=${HASH}">
</head>`;
}

function header(t, lang, home = '') {
  return `<header class="top">
  <div class="capsule">
    <a class="brand" href="/${home}" aria-label="Velami">${mark()}<span>Velami</span></a>
    <nav class="nav" aria-label="Velami">
      <a href="/#how">${esc(t.nav.how)}</a>
      <a href="/#check">${esc(t.nav.check)}</a>
      <a href="/#teams">${esc(t.nav.teams)}</a>
      <a href="/#faq">${esc(t.nav.faq)}</a>
    </nav>
    <a class="btn btn-sm" href="${DOWNLOAD}">${esc(t.nav.cta)}</a>
  </div>
</header>`;
}

function footer(t, lang) {
  return `<footer class="foot">
  <div class="wrap foot-in">
    <div class="foot-brand">
      <a class="brand" href="/">${mark()}<span>Velami</span></a>
      <p>${esc(t.footer.tagline)}</p>
    </div>
    <nav class="foot-links">
      <a href="/privacy">${esc(t.footer.privacy)}</a>
      <a href="${REPO}">${esc(t.footer.source)}</a>
      <a href="mailto:${MAIL}">${esc(t.footer.support)}</a>
    </nav>
    <div class="foot-meta">
      <p>${esc(t.footer.made)} <a href="https://via-tech.org">Via-Tech</a> · v${VERSION} · AGPL-3.0</p>
      <p>${esc(t.footer.clean)}</p>
    </div>
  </div>
</footer>`;
}

function picture(lang, name, alt, { dark, w, h, cls = '', eager = false } = {}) {
  const src = `/img/${lang}/${name}.webp`;
  const d = dark ? `<source srcset="/img/${lang}/${dark}.webp" media="(prefers-color-scheme: dark)">` : '';
  return `<picture class="${cls}">${d}<img src="${src}" alt="${esc(alt)}" width="${w}" height="${h}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"></picture>`;
}

// Первый кадр демо считаем при сборке тем же детектором, чтобы без JS страница выглядела так же.
function demoBlock(t, lang) {
  const labels = Object.fromEntries(Object.entries(I18N.MESSAGES[lang]).filter(([k]) => k.startsWith('type.')).map(([k, v]) => [k.slice(5), v]));
  const sample = CONTENT[lang].demo.sample;
  const r = PG.maskText(sample, { vault: new PG.Vault() });
  const outHtml = esc(r.text).replace(/\[\[([A-Z_]+)_(\d+)\]\]/g, '<mark class="tok">[[$1_$2]]</mark>');
  const chips = r.findings.map((f) => `<li><span>${esc(labels[f.type] || f.type)}</span><code>${esc(f.token)}</code></li>`).join('');
  return `<div class="demo" id="demo" data-labels="${esc(JSON.stringify(labels))}" data-count="${esc(t.demo.count)}" data-none="${esc(t.demo.none)}">
        <div class="pane">
          <div class="pane-h"><span class="pane-dot"></span>${esc(t.demo.you)}</div>
          <label class="sr" for="demo-in">${esc(t.demo.you)}</label>
          <textarea id="demo-in" spellcheck="false" rows="4">${esc(sample)}</textarea>
        </div>
        <div class="pane pane-out">
          <div class="pane-h"><span class="pane-dot pane-dot-on"></span>${esc(t.demo.ai)}<span class="count on" id="demo-count">${esc(t.demo.count.replace('{n}', r.findings.length))}</span></div>
          <div class="out" id="demo-out" aria-live="polite">${outHtml}</div>
          <ul class="found" id="demo-found">${chips}</ul>
        </div>
      </div>
      <p class="demo-note">${esc(t.demo.note)}</p>`;
}

function index(lang) {
  const t = T[lang];
  const steps = t.how.steps.map(([h, p], i) => `
          <li>
            <span class="num">${i + 1}</span>
            <div><h3>${esc(h)}</h3><p>${rich(p)}</p></div>
          </li>`).join('');
  const chips = t.types.list.map((x) => `<li>${esc(x)}</li>`).join('');
  const checks = t.check.cards.map(([h, p], i) => `
        <li>
          ${icon(['eye', 'log', 'flask', 'code'][i])}
          <h3>${esc(h)}</h3>
          <p>${esc(p)}</p>
        </li>`).join('');
  const teams = t.teams.cards.map(([h, p], i) => `
        <li>
          ${icon(['book', 'lock', 'file'][i])}
          <h3>${esc(h)}</h3>
          <p>${esc(p)}</p>
        </li>`).join('');
  const faq = t.faq.items.map(([q, a]) => `
        <details>
          <summary>${esc(q)}</summary>
          <p>${esc(a)}</p>
        </details>`).join('');
  const sites = SITES.map((s) => `<li>${esc(s)}</li>`).join('') +
    OPTIONAL_SITES.map((s) => `<li class="opt">${esc(s)}<small>${esc(t.sites.optional)}</small></li>`).join('');
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
<main>
  <section class="hero">
    <div class="wrap">
      <div class="hero-text">
        <p class="eyebrow">${esc(t.hero.eyebrow)}</p>
        <h1>${t.hero.title}</h1>
        <p class="lead">${esc(t.hero.lead)}</p>
        <div class="ctas">
          <a class="btn" href="${DOWNLOAD}">${icon('download')}${esc(t.hero.cta)}</a>
          <a class="btn btn-ghost" href="${REPO}">${icon('gh')}${esc(t.hero.source)}</a>
        </div>
        <p class="note">${esc(t.hero.note)}</p>
      </div>
      <p class="kicker">${esc(t.demo.label)}</p>
      ${demoBlock(t, lang)}
    </div>
  </section>

  <section id="how" class="sec">
    <div class="wrap how">
      <div class="how-text">
        <h2>${esc(t.how.title)}</h2>
        <p class="sub">${esc(t.how.lead)}</p>
        <ol class="steps">${steps}
        </ol>
      </div>
      <div class="how-shot">
        ${picture(lang, 'panel', t.hero.alt, { dark: 'panel-dark', w: 678, h: 1024 })}
      </div>
    </div>
    <div class="wrap">
      <figure class="frame">
        ${picture(lang, 'answer', t.how.alt, { w: 1720, h: 880 })}
      </figure>
    </div>
  </section>

  <section id="types" class="sec sec-tint">
    <div class="wrap center-block">
      <h2>${esc(t.types.title)}</h2>
      <p class="sub">${esc(t.types.lead)}</p>
      <ul class="chips">${chips}</ul>
    </div>
  </section>

  <section id="check" class="sec">
    <div class="wrap">
      <div class="sec-head">
        <h2>${esc(t.check.title)}</h2>
        <p class="sub">${esc(t.check.lead)}</p>
      </div>
      <ul class="cols">${checks}
      </ul>
      <figure class="frame">
        ${picture(lang, 'log', t.check.alt, { dark: 'log-dark', w: 1600, h: 1000 })}
      </figure>
    </div>
  </section>

  <section class="sec sec-tint">
    <div class="wrap duo">
      <div>
        <h2>${esc(t.files.title)}</h2>
        <p class="sub">${esc(t.files.text)}</p>
      </div>
      <div>
        <h2>${esc(t.sites.title)}</h2>
        <p class="sub">${esc(t.sites.text)}</p>
        <ul class="sites">${sites}</ul>
      </div>
    </div>
  </section>

  <section id="teams" class="sec">
    <div class="wrap">
      <div class="teams">
        <div class="teams-head">
          <h2>${esc(t.teams.title)}</h2>
          <p>${esc(t.teams.lead)}</p>
        </div>
        <ul class="teams-grid">${teams}
        </ul>
        <div class="ctas">
          <a class="btn btn-light" href="mailto:${MAIL}?subject=Velami">${icon('mail')}${esc(t.teams.cta)}</a>
          <a class="btn btn-ghost-light" href="${REPO}/blob/main/docs/ENTERPRISE.md">${esc(t.teams.guide)}${icon('arrow')}</a>
        </div>
      </div>
    </div>
  </section>

  <section id="faq" class="sec">
    <div class="wrap faq-wrap">
      <h2>${esc(t.faq.title)}</h2>
      <div class="faq">${faq}
      </div>
    </div>
  </section>

  <section class="sec final">
    <div class="wrap center-block">
      ${mark('mark mark-lg')}
      <h2>${t.hero.title}</h2>
      <div class="ctas">
        <a class="btn" href="${DOWNLOAD}">${icon('download')}${esc(t.hero.cta)}</a>
        <a class="btn btn-ghost" href="${REPO}">${icon('gh')}${esc(t.hero.source)}</a>
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
  const body = md2html(sections.parts[lang]);
  const ver = { en: sections.version, it: sections.version.replace('Version', 'Versione').replace('November', 'novembre'), ru: sections.version.replace('Version', 'Версия').replace('November', 'ноября') }[lang];
  return `${head(t, lang, { title: `${t.privacy.title} · Velami`, description: t.description, canonical: 'privacy' })}
<body>
${header(t, lang)}
<main class="doc">
  <div class="wrap narrow">
    <a class="back" href="/">${icon('arrow', 'ic ic-flip')}${esc(t.privacy.back)}</a>
    <h1>${esc(t.privacy.title)}</h1>
    <p class="muted">${inline(ver.split('. Extension')[0])}.</p>
    ${body}
  </div>
</main>
${footer(t, lang)}
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
    const need = { panel: ['panel-alpha.png'], 'panel-dark': ['panel-dark-alpha.png'], answer: ['answer.png', 1720], log: ['log.png', 1600], 'log-dark': ['log-dark.png', 1600] };
    for (const [name, [file, w]] of Object.entries(need)) {
      const src = path.join(shots, file);
      if (!existsSync(src)) throw new Error(`нет скриншота ${src}`);
      webp(src, path.join(dir, name + '.webp'), w);
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
