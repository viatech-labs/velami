// Общая часть живых прогонов (tools/qa-live.mjs и разведка в tools/tmp): копия расширения для
// QA-профиля и проверка, что Chrome исполняет именно её, а не код из кэша профиля.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listFiles } from '../scripts/package-lib.mjs';

export const QA_PROFILE = path.join(os.homedir(), 'Library', 'Application Support', 'velami-qa-chrome');
export const EXT_DIR = path.join(os.tmpdir(), 'velami-live-ext');

/* Копия расширения, где необязательные сайты уже разрешены: окно разрешения Chrome в автоматическом
   браузере не нажать. Путь постоянный, чтобы id расширения и его настройки не менялись. */
export function snapshotExtension(root, packed) {
  rmSync(EXT_DIR, { recursive: true, force: true });
  if (packed) cpSync(path.resolve(packed), EXT_DIR, { recursive: true });
  else for (const f of listFiles(root)) cpSync(path.join(root, f), path.join(EXT_DIR, f));
  const file = path.join(EXT_DIR, 'manifest.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.host_permissions = [...manifest.host_permissions, ...manifest.optional_host_permissions];
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  return manifest;
}

/* Фоновый скрипт и всё, что он подключает через importScripts, Chrome хранит в профиле
   (Default/Service Worker) и при том же пути расширения берёт оттуда, а не с диска. Новый номер
   версии в манифесте этого не меняет: проверено 11.11.2026, после смены версии исполнялся код
   двухдневной давности. Поэтому перед запуском кэш удаляется. Вход на сайты хранится в cookies
   и не теряется. Вызывать до puppeteer.launch, пока профиль никем не открыт. */
export function dropWorkerCache(profile = QA_PROFILE) {
  rmSync(path.join(profile, 'Default', 'Service Worker'), { recursive: true, force: true });
}

/* Сверка: каждая функция, которую исполняет фоновый процесс, должна дословно быть в файлах
   расширения на диске. Иначе прогон проверяет не тот код, и его результат ничего не значит. */
export async function assertFresh(browser) {
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/src/background.js'), { timeout: 20000 });
  const worker = await target.worker();
  const r = await worker.evaluate(async () => {
    const main = chrome.runtime.getManifest().background.service_worker;
    const dir = main.slice(0, main.lastIndexOf('/') + 1);
    const read = async (f) => (await fetch(chrome.runtime.getURL(f), { cache: 'no-store' })).text();
    const mainText = await read(main);
    const imported = [...mainText.matchAll(/importScripts\(([^)]*)\)/g)]
      .flatMap((m) => [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => dir + x[1]));
    const disk = (await Promise.all([main, ...imported].map(read))).join('\n');
    const own = (name, v) => typeof v === 'function' && !/\[native code\]/.test(Function.prototype.toString.call(v)) ? [[name, v]] : [];
    const fns = [];
    for (const k of Object.keys(self)) {
      let v;
      try { v = self[k]; } catch { continue; }
      fns.push(...own(k, v));
      if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
        for (const [n, f] of Object.entries(v)) fns.push(...own(k + '.' + n, f));
      }
    }
    return {
      files: [main, ...imported],
      checked: fns.length,
      stale: fns.filter(([, f]) => !disk.includes(Function.prototype.toString.call(f))).map(([n]) => n),
    };
  });
  if (r.checked < 20) throw new Error(`Сверка кода фонового процесса ничего не проверила (функций: ${r.checked})`);
  if (r.stale.length) {
    throw new Error(`Chrome исполняет устаревший фоновый код, с диском расходятся: ${r.stale.slice(0, 12).join(', ')}`
      + (r.stale.length > 12 ? ` и ещё ${r.stale.length - 12}` : ''));
  }
  return r;
}
