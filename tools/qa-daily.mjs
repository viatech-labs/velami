#!/usr/bin/env node
// Ежедневная живая проверка: опубликованный пакет из Chrome Web Store на четырёх основных сайтах.
// Сайты чатов меняют вёрстку и запросы без предупреждения. Поломку должны находить мы, а не пользователи.
//
//   node tools/qa-daily.mjs                     прогон сейчас
//   node tools/qa-daily.mjs --install [ЧЧ:ММ]   запуск каждый день (launchd, по умолчанию 09:30)
//   node tools/qa-daily.mjs --uninstall         убрать расписание
//   node tools/qa-daily.mjs --status            расписание и последний итог
//   node tools/qa-daily.mjs --test-signal       показать окно тревоги, ничего не проверяя
//   --sites a,b  --cases x,y                    свой набор сайтов и случаев
//   --local | --ext <папка>                     рабочая копия или распакованный пакет вместо пакета из магазина
//
// Что делает прогон: узнаёт версию в магазине, при новой версии скачивает пакет и сверяет его со сборкой,
// запускает tools/qa-live.mjs (тот же сценарий, что в матрице) и пишет итог одной страницей.
// Отчёты лежат вне репозитория: ~/Library/Logs/velami-qa (latest.md, history.jsonl, runs/).
// Профиль Chrome с тестовыми аккаунтами (tools/qa-login.mjs) остаётся на этом компьютере.
// Сигнал: при поломке окно с кнопкой «Открыть отчёт», если сайт проверить не удалось, уведомление.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'bgbollfnmoffpolhpggejbjdkmelcpcn';
const LABEL = 'pro.velami.qa-daily';
const HOME = os.homedir();
/* QA_LOGS уводит отчёты в другую папку: так проверяют сам сигнал, не трогая историю настоящих прогонов. */
const LOGS = process.env.QA_LOGS ? path.resolve(process.env.QA_LOGS) : path.join(HOME, 'Library', 'Logs', 'velami-qa');
const CACHE = path.join(HOME, 'Library', 'Caches', 'velami-qa', 'store');
const PLIST = path.join(HOME, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const PROFILE = path.join(HOME, 'Library', 'Application Support', 'velami-qa-chrome');
const HISTORY = path.join(LOGS, 'history.jsonl');
const LATEST = path.join(LOGS, 'latest.md');
const KEEP_DAYS = 14;
const TIMEOUT_MIN = 45;

const SITES = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity', copilot: 'Copilot', deepseek: 'DeepSeek', mistral: 'Mistral Le Chat', grok: 'Grok' };
const CASE_NAMES = { 'text-it': 'Сообщение', 'text-ru': 'Сообщение (рус.)', pdf: 'PDF', docx: 'Word', xlsx: 'Excel', image: 'Картинка' };
const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const sites = argOf('--sites', 'chatgpt,claude,gemini,perplexity').split(',');
const cases = argOf('--cases', 'text-it,pdf').split(',');

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
const human = (d = new Date()) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const say = (...a) => console.log(`[${human()}]`, ...a);

/* ---------- сигнал ---------- */
const quote = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
function alertWindow(title, text, file) {
  if (process.platform !== 'darwin' || process.env.QA_NO_SIGNAL) return;
  const script = [
    `set r to display dialog ${quote(text)} with title ${quote(title)} buttons {"Закрыть", "Открыть отчёт"} default button 2 with icon caution giving up after 43200`,
    `if button returned of r is "Открыть отчёт" then do shell script "open " & quoted form of ${quote(file)}`,
  ];
  spawn('osascript', script.flatMap((l) => ['-e', l]), { detached: true, stdio: 'ignore' }).unref();
}
function notify(title, text) {
  if (process.platform !== 'darwin' || process.env.QA_NO_SIGNAL) return;
  spawnSync('osascript', ['-e', `display notification ${quote(text)} with title ${quote(title)}`], { stdio: 'ignore' });
}

/* ---------- расписание ---------- */
function install(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('Время в виде ЧЧ:ММ, например 09:30');
  mkdirSync(LOGS, { recursive: true });
  mkdirSync(path.dirname(PLIST), { recursive: true });
  const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // Homebrew хранит node в папке с номером версии. После обновления она исчезает, поэтому берём постоянную ссылку.
  const node = ['/opt/homebrew/bin/node', '/usr/local/bin/node'].find((p) => { try { return realpathSync(p) === realpathSync(process.execPath); } catch { return false; } }) || process.execPath;
  writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${x(node)}</string><string>${x(path.join(root, 'tools', 'qa-daily.mjs'))}</string></array>
  <key>WorkingDirectory</key><string>${x(root)}</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${+m[1]}</integer><key>Minute</key><integer>${+m[2]}</integer></dict>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${x(path.dirname(node))}:/usr/bin:/bin:/usr/sbin:/sbin</string><key>LANG</key><string>en_US.UTF-8</string></dict>
  <key>StandardOutPath</key><string>${x(path.join(LOGS, 'launchd.log'))}</string>
  <key>StandardErrorPath</key><string>${x(path.join(LOGS, 'launchd.log'))}</string>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`);
  const domain = `gui/${process.getuid()}`;
  spawnSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' });
  const r = spawnSync('launchctl', ['bootstrap', domain, PLIST], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('launchctl bootstrap: ' + (r.stderr || r.stdout).trim());
  console.log(`Расписание поставлено: каждый день в ${pad(+m[1])}:${m[2]}. Если компьютер в это время спит, прогон пойдёт после пробуждения.\n${PLIST}\nУбрать: node tools/qa-daily.mjs --uninstall`);
}
function uninstall() {
  spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' });
  rmSync(PLIST, { force: true });
  console.log('Расписание убрано. Отчёты остались в ' + LOGS);
}
function status() {
  const r = spawnSync('launchctl', ['print', `gui/${process.getuid()}/${LABEL}`], { encoding: 'utf8' });
  if (r.status !== 0) console.log('Расписание не стоит.');
  else {
    const hour = /"Hour" => (\d+)/.exec(r.stdout);
    const min = /"Minute" => (\d+)/.exec(r.stdout);
    console.log(`Расписание стоит${hour && min ? `: каждый день в ${pad(hour[1])}:${pad(min[1])}` : ''}. Запусков: ${(/runs = (\d+)/.exec(r.stdout) || [])[1] || '?'}, последний код выхода: ${(/last exit code = (.+)/.exec(r.stdout) || [])[1] || '?'}`);
  }
  const last = readHistory().at(-1);
  console.log(last ? `Последний прогон ${last.when}: ${last.title}\n${LATEST}` : 'Прогонов ещё не было.');
}

/* ---------- пакет из магазина ---------- */
async function storePackage() {
  const url = `https://clients2.google.com/service/update2/crx?response=updatecheck&acceptformat=crx3&prodversion=141.0.0.0&x=id%3D${ID}%26uc`;
  const xml = await (await fetch(url, { signal: AbortSignal.timeout(30000) })).text();
  const attr = (k) => (new RegExp(`\\b${k}="([^"]+)"`).exec(xml.slice(xml.indexOf('<updatecheck'))) || [])[1];
  const version = attr('version');
  const codebase = attr('codebase');
  if (!version || !codebase) throw new Error('магазин не назвал версию: ' + xml.slice(0, 200));
  const dir = path.join(CACHE, version);
  if (!existsSync(path.join(dir, 'manifest.json'))) {
    say(`в магазине версия ${version}, скачиваю пакет`);
    mkdirSync(CACHE, { recursive: true });
    const crx = path.join(CACHE, `${version}.crx`);
    const buf = Buffer.from(await (await fetch(codebase.replace(/&amp;/g, '&'), { signal: AbortSignal.timeout(15 * 60000) })).arrayBuffer());
    if (attr('hash_sha256') && sha256(buf) !== attr('hash_sha256')) throw new Error('пакет из магазина скачан с ошибкой: хэш не совпал');
    writeFileSync(crx, buf);
    rmSync(dir, { recursive: true, force: true });
    /* У crx перед архивом идёт заголовок: unzip предупреждает о лишних байтах и выходит с кодом 1, файлы при этом целы. */
    const r = spawnSync('unzip', ['-q', '-o', crx, '-d', dir], { encoding: 'utf8' });
    if (r.status > 1 || !existsSync(path.join(dir, 'manifest.json'))) throw new Error('пакет из магазина не распаковался: ' + (r.stderr || '').slice(0, 200));
    rmSync(crx, { force: true });
    for (const old of readdirSync(CACHE)) if (old !== version) rmSync(path.join(CACHE, old), { recursive: true, force: true });
  }
  /* Сверка со сборкой: те же файлы, что мы выпускали под этим номером. _metadata добавляет магазин, сверка её пропускает. */
  const list = path.join(root, 'dist', `velami-${version}.files.json`);
  let verified = 'со сборкой не сверен (нет dist/velami-' + version + '.files.json)';
  if (existsSync(list)) {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'verify.mjs'), dir, '--list', list], { encoding: 'utf8' });
    const files = Object.keys(JSON.parse(readFileSync(list, 'utf8')).files).length;
    verified = r.status === 0 ? `совпадает с нашей сборкой, ${files} файлов` : 'НЕ СОВПАДАЕТ с нашей сборкой: ' + (r.stdout || r.stderr).trim().split('\n').slice(0, 3).join(', ');
    if (r.status !== 0) return { version, dir, verified, mismatch: true };
  }
  /* Chrome не грузит распакованное расширение с папкой _metadata. Убирается после сверки. */
  rmSync(path.join(dir, '_metadata'), { recursive: true, force: true });
  return { version, dir, verified };
}

/* ---------- разбор итогов ---------- */
const readHistory = () => existsSync(HISTORY) ? readFileSync(HISTORY, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

/* Что значит строка отчёта qa-live. leak и broken это поломка Velami, access и skip значат «проверить не удалось». */
function classify(row) {
  if (!row) return { state: 'none', why: 'случай не запускался' };
  const problems = (row.problems || []).concat(row.error || []);
  const text = problems.join('. ');
  if (/УТЕЧКА|тревога в журнале/.test(text)) return { state: 'leak', why: text };
  if (row.ok === null) return { state: 'skip', why: row.skipped || 'пропущен' };
  if (row.ok) return { state: 'ok', why: row.modelSkipped ? 'модель не повторила значения, меток на странице нет' : '' };
  if (/нет поля ввода/.test(text) || /Just a moment|Attention Required|Verify you are human/i.test(text)) return { state: 'access', why: text + '. Похоже на выход из аккаунта или проверку «вы не робот»' };
  if (row.signedOut) return { state: 'access', why: 'сайт показывает вход вместо тестового аккаунта. ' + text };
  return { state: 'broken', why: text };
}
const CELL = { ok: 'да', leak: 'УТЕЧКА', broken: 'СЛОМАНО', access: 'нет доступа', skip: 'пропуск', none: 'не запускался' };

function summarize(rows, pkg, crash) {
  const table = {};
  for (const s of sites) for (const c of cases) table[`${s}/${c}`] = classify(rows.find((r) => r.site === s && r.case === c));
  const of = (...states) => Object.entries(table).filter(([, v]) => states.includes(v.state));
  const bad = of('leak', 'broken');
  const blind = of('access', 'skip', 'none');
  /* Сайт считается непроверенным, если на нём не прошёл ни один случай. */
  const unseen = sites.filter((s) => !cases.some((c) => table[`${s}/${c}`].state === 'ok') && !cases.some((c) => ['leak', 'broken'].includes(table[`${s}/${c}`].state)));
  let level = 'ok';
  let title = 'всё в порядке';
  if (crash) { level = 'broken'; title = 'прогон не состоялся: ' + crash; }
  else if (pkg.mismatch) { level = 'broken'; title = 'пакет в магазине отличается от нашей сборки'; }
  else if (of('leak').length) { level = 'broken'; title = 'УТЕЧКА: ' + of('leak').map(([k]) => k).join(', '); }
  else if (bad.length) { level = 'broken'; title = 'сломано: ' + bad.map(([k]) => k).join(', '); }
  else if (unseen.length) { level = 'attention'; title = 'не удалось проверить: ' + unseen.map((s) => SITES[s] || s).join(', '); }
  else if (blind.length) { title = `в порядке, не проверено случаев: ${blind.length}`; }
  return { level, title, table, bad, blind, unseen };
}

function changes(now, before) {
  if (!before) return ['Это первый прогон, сравнивать не с чем.'];
  const out = [];
  if (before.version !== now.version) out.push(`Версия в магазине: была ${before.version}, стала ${now.version}.`);
  for (const [k, v] of Object.entries(now.states)) {
    const was = before.states && before.states[k];
    if (was && was !== v) out.push(`${k}: было «${CELL[was] || was}», стало «${CELL[v] || v}».`);
  }
  return out.length ? out : [`Без изменений с прошлого прогона (${before.when}).`];
}

function render({ when, pkg, sum, diff, dir, minutes }) {
  const head = `| Сайт | ${cases.map((c) => CASE_NAMES[c] || c).join(' | ')} |\n|${' --- |'.repeat(cases.length + 1)}`;
  const rows = sites.map((s) => `| ${SITES[s] || s} | ${cases.map((c) => CELL[sum.table[`${s}/${c}`].state]).join(' | ')} |`).join('\n');
  const list = (items) => items.map(([k, v]) => `- ${k}: ${v.why}`).join('\n');
  const mark = { ok: 'ВСЁ В ПОРЯДКЕ', attention: 'НЕ ВСЁ ПРОВЕРЕНО', broken: 'ЕСТЬ ПОЛОМКА' }[sum.level];
  return `# Velami: живая проверка ${when}

**${mark}.** ${sum.title[0].toUpperCase() + sum.title.slice(1)}.

Пакет: ${pkg.version || '?'} ${pkg.from}, ${pkg.verified}. Прогон занял ${minutes} мин.

${head}
${rows}
${sum.bad.length ? `\n## Что сломалось\n${list(sum.bad)}\n` : ''}${sum.blind.length ? `\n## Что не удалось проверить\n${list(sum.blind)}\n${sum.blind.some(([, v]) => v.state === 'access') ? '\nЕсли сайт просит войти: `node tools/qa-login.mjs`, войти в тестовый аккаунт и закрыть окно.\n' : ''}` : ''}
## Что изменилось
${diff.map((d) => `- ${d}`).join('\n')}

Снимки экрана и полный отчёт: ${dir}
Повторить один сайт: \`node tools/qa-daily.mjs --sites chatgpt\`
`;
}

/* ---------- прогон ---------- */
function profileBusy() {
  /* Chrome держит в профиле ссылку SingletonLock вида «хост-pid». Если процесс жив, профиль открыт. */
  try {
    const pid = Number(readlinkSync(path.join(PROFILE, 'SingletonLock')).split('-').pop());
    process.kill(pid, 0);
    return pid;
  } catch { return 0; }
}

function runLive(extDir, out) {
  return new Promise((resolve) => {
    const env = { ...process.env, QA_OUT: out };
    if (extDir) env.PG_EXT_DIR = extDir; else delete env.PG_EXT_DIR;
    const child = spawn(process.execPath, [path.join(root, 'tools', 'qa-live.mjs'), ...sites, '--cases', cases.join(',')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const log = path.join(out, 'run.log');
    const take = (b) => { appendFileSync(log, b); tail = (tail + b).slice(-2000); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => { take(`\nпрогон остановлен: дольше ${TIMEOUT_MIN} минут\n`); child.kill('SIGTERM'); }, TIMEOUT_MIN * 60000);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, tail }); });
  });
}

async function run() {
  mkdirSync(path.join(LOGS, 'runs'), { recursive: true });
  const started = Date.now();
  const when = human();
  const dir = path.join(LOGS, 'runs', stamp());
  mkdirSync(dir, { recursive: true });
  let pkg = { version: '', from: '', verified: '' };
  let crash = '';
  let rows = [];

  const busy = profileBusy();
  if (busy) crash = `профиль с тестовыми аккаунтами открыт в другом Chrome (pid ${busy}). Закройте его и повторите`;
  if (!crash) {
    const own = argOf('--ext', '');
    if (has('--local')) pkg = { version: JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8')).version, from: 'из рабочей копии', verified: 'не из магазина', dir: '' };
    else if (own) pkg = { version: JSON.parse(readFileSync(path.join(own, 'manifest.json'), 'utf8')).version, from: 'из папки ' + own, verified: 'не из магазина', dir: path.resolve(own) };
    else {
      try { pkg = { ...(await storePackage()), from: 'из Chrome Web Store' }; }
      catch (e) { crash = 'не удалось получить пакет из магазина: ' + String(e && e.message || e).slice(0, 200); }
    }
  }
  if (!crash && !pkg.mismatch) {
    say(`Velami ${pkg.version} ${pkg.from}, ${pkg.verified}. Сайты: ${sites.join(', ')}. Случаи: ${cases.join(', ')}`);
    const r = await runLive(pkg.dir, dir);
    const report = path.join(dir, 'report.json');
    if (existsSync(report)) rows = JSON.parse(readFileSync(report, 'utf8')).rows || [];
    if (r.code !== 0 || rows.length < sites.length * cases.length) {
      const last = r.tail.trim().split('\n').filter((l) => !l.startsWith('{')).slice(-3).join(' / ').slice(0, 300);
      if (!rows.length) crash = `сценарий остановился до первого случая (код ${r.code ?? r.signal}): ${last}`;
      else if (r.code !== 0) crash = `сценарий остановился на середине (код ${r.code ?? r.signal}, случаев ${rows.length} из ${sites.length * cases.length}): ${last}`;
    }
  }

  const sum = summarize(rows, pkg, crash);
  const states = Object.fromEntries(Object.entries(sum.table).map(([k, v]) => [k, v.state]));
  const entry = { when, at: new Date().toISOString(), version: pkg.version, level: sum.level, title: sum.title, states, dir };
  /* Сравниваем с прошлым прогоном того же набора: разовый запуск одного сайта не должен выглядеть как перемена. */
  const same = (h) => h.states && Object.keys(h.states).sort().join() === Object.keys(states).sort().join();
  const before = readHistory().filter(same).at(-1);
  const diff = changes(entry, before);
  const minutes = Math.max(1, Math.round((Date.now() - started) / 60000));
  const md = render({ when, pkg, sum, diff, dir, minutes });
  writeFileSync(path.join(dir, 'summary.md'), md);
  writeFileSync(LATEST, md);
  appendFileSync(HISTORY, JSON.stringify(entry) + '\n');
  for (const d of readdirSync(path.join(LOGS, 'runs'))) {
    const p = path.join(LOGS, 'runs', d);
    if (Date.now() - statSync(p).mtimeMs > KEEP_DAYS * 86400000) rmSync(p, { recursive: true, force: true });
  }
  console.log('\n' + md);

  if (sum.level === 'broken') alertWindow('Velami: живая проверка', `${sum.title[0].toUpperCase() + sum.title.slice(1)}.\n\nПакет ${pkg.version || '?'} ${pkg.from}, ${when}.${process.env.QA_NOTE ? '\n\n' + process.env.QA_NOTE : ''}`, LATEST);
  /* О сайте, который проверить не удалось, напоминаем один раз, когда список таких сайтов поменялся: постоянная причина
     (сайт закрыт для страны, вышли из аккаунта) не должна шуметь каждый день. В отчёте она остаётся всегда. */
  else if (sum.level === 'attention' && (!before || before.title !== sum.title)) notify('Velami: живая проверка', sum.title[0].toUpperCase() + sum.title.slice(1) + '. Отчёт: ~/Library/Logs/velami-qa/latest.md');
  process.exitCode = sum.level === 'broken' ? 1 : 0;
}

try {
  if (has('--install')) install(argOf('--install', '09:30'));
  else if (has('--uninstall')) uninstall();
  else if (has('--status')) status();
  else if (has('--test-signal')) { mkdirSync(LOGS, { recursive: true }); if (!existsSync(LATEST)) writeFileSync(LATEST, '# Velami: живая проверка\n\nПроверка сигнала, прогонов ещё не было.\n'); alertWindow('Velami: живая проверка', 'Проверка сигнала. Так выглядит сообщение о поломке.', LATEST); console.log('Окно запрошено у системы. Если его нет на экране, сигнал не работает.'); }
  else await run();
} catch (e) {
  console.error(String(e && e.message || e));
  process.exitCode = 2;
}
