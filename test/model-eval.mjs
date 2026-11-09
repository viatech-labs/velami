// Точность модели на открытом наборе test/model-set.json. Запуск: npm run eval:model
// Находка засчитывается, если тип совпал и фрагмент пересекается с эталоном. Отдельно считается,
// сколько найдено с точными границами.
// Вторая таблица, «конвейер», это то, что реально заменит расширение: правила адресов, находки
// модели и их варианты («Мельников О. В.») как словарь. Там эталон считается найденным, если его
// задела хотя бы одна находка, а лишней считается находка, не задевшая эталон своего типа.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadModel, modelBuilt, root } from './model-runner.mjs';

const PG = createRequire(import.meta.url)('../src/detector.js');

if (!modelBuilt()) {
  console.error('Модель не собрана: npm run model');
  process.exit(1);
}
const TYPES = { person: 'PERSON', address: 'ADDRESS' };
const set = JSON.parse(readFileSync(path.join(root, 'test/model-set.json'), 'utf8')).items;
const model = await loadModel();
const stat = {};
const pipe = {};
const misses = [];
const pipeMisses = [];
const times = [];
// Каждая строка эталона размечается во всех местах текста. Более длинные идут первыми, поэтому
// «Олег Викторович» внутри «Олег Викторович Мельников» второй раз не размечается.
function goldSpans(text, gold) {
  const spans = [];
  for (const [type, s] of [...gold].sort((a, b) => b[1].length - a[1].length)) {
    let n = 0;
    for (let i = text.indexOf(s); i >= 0; i = text.indexOf(s, i + 1)) {
      if (spans.some((x) => x.start < i + s.length && i < x.end)) continue;
      spans.push({ type, start: i, end: i + s.length, hit: false });
      n++;
    }
    if (!n && !spans.some((x) => text.slice(x.start, x.end).includes(s))) throw new Error(`эталон «${s}» не найден в тексте: ${text.slice(0, 60)}`);
  }
  return spans;
}

for (const [lang, text, gold, kind = 'phrase'] of set) {
  const t0 = performance.now();
  const found = await model.recognize(text);
  times.push(performance.now() - t0);
  const g = goldSpans(text, gold);
  const keys = [lang, kind, 'all'];
  for (const k of keys) { stat[k] ||= { tp: 0, fp: 0, fn: 0, exact: 0, sentences: 0 }; stat[k].sentences++; }
  for (const e of found) {
    const type = TYPES[e.label];
    const m = g.find((x) => !x.hit && x.type === type && x.start < e.end && e.start < x.end);
    for (const k of keys) {
      if (m) { stat[k].tp++; if (m.start === e.start && m.end === e.end) stat[k].exact++; } else stat[k].fp++;
    }
    if (m) m.hit = true;
    else misses.push(`  лишнее   ${lang} ${type} «${e.value}» ${e.score.toFixed(2)}`);
  }
  for (const x of g) {
    if (x.hit) continue;
    for (const k of keys) stat[k].fn++;
    misses.push(`  пропуск  ${lang} ${x.type} «${text.slice(x.start, x.end)}»`);
  }

  const auto = [];
  for (const e of found) {
    const type = TYPES[e.label];
    for (const term of [e.value, ...(type === 'PERSON' ? PG.nameVariants(e.value) : [])]) auto.push({ term, type, score: e.score });
  }
  const shown = PG.detect(text, { auto }).filter((f) => f.type === 'PERSON' || f.type === 'ADDRESS');
  const gp = goldSpans(text, gold);
  for (const k of keys) { pipe[k] ||= { tp: 0, fp: 0, fn: 0, exact: 0, sentences: 0 }; pipe[k].sentences++; }
  for (const f of shown) {
    const ms = gp.filter((x) => x.type === f.type && x.start < f.end && f.start < x.end);
    if (!ms.length) {
      for (const k of keys) pipe[k].fp++;
      pipeMisses.push(`  лишнее   ${lang} ${f.type} «${f.value}»${f.source === 'model' ? '' : ' (правило)'}`);
    }
    for (const m of ms) m.hit = true;
  }
  for (const x of gp) {
    for (const k of keys) x.hit ? pipe[k].tp++ : pipe[k].fn++;
    if (!x.hit) pipeMisses.push(`  пропуск  ${lang} ${x.type} «${text.slice(x.start, x.end)}»`);
  }
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '—');
console.log(`Набор: ${set.length} текстов. Порог 0.5, один поток WASM.`);
console.log('срез    текстов  точность  полнота  точные границы');
for (const k of ['en', 'it', 'ru', 'phrase', 'doc', 'all']) {
  const s = stat[k];
  if (!s) continue;
  console.log(`${k.padEnd(7)} ${String(s.sentences).padStart(7)}  ${pct(s.tp, s.tp + s.fp).padStart(8)}  ${pct(s.tp, s.tp + s.fn).padStart(7)}  ${pct(s.exact, s.tp).padStart(14)}`);
}
times.sort((a, b) => a - b);
console.log(`Время на фразу: медиана ${times[times.length >> 1].toFixed(0)} мс, 95% ${times[Math.floor(times.length * 0.95)].toFixed(0)} мс`);
console.log(misses.length ? 'Ошибки модели:\n' + misses.join('\n') : 'Ошибок у модели нет.');
console.log('\nКонвейер (правила + модель + варианты имён)');
console.log('срез    текстов  точность  полнота');
for (const k of ['en', 'it', 'ru', 'phrase', 'doc', 'all']) {
  const s = pipe[k];
  if (!s) continue;
  console.log(`${k.padEnd(7)} ${String(s.sentences).padStart(7)}  ${pct(s.tp, s.tp + s.fp).padStart(8)}  ${pct(s.tp, s.tp + s.fn).padStart(7)}`);
}
console.log(pipeMisses.length ? 'Ошибки конвейера:\n' + pipeMisses.join('\n') : 'Ошибок у конвейера нет.');
