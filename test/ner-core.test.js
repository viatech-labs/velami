const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NER = require('../src/ner-core.js');
const PG = require('../src/detector.js');

const root = path.resolve(__dirname, '..');
const modelDir = path.join(root, 'models/ner');
const built = fs.existsSync(path.join(modelDir, 'tokenizer.json'));

const tiny = {
  model: {
    type: 'Unigram', unk_id: 3,
    vocab: [['[PAD]', 0], ['[CLS]', 0], ['[SEP]', 0], ['[UNK]', 0], ['▁', -2], ['▁ma', -3], ['ria', -3], ['▁maria', -4], ['r', -5], ['i', -5], ['a', -5], ['m', -5]],
  },
  added_tokens: [{ id: 12, content: '<<ENT>>' }, { id: 13, content: '<<SEP>>' }],
  post_processor: { special_tokens: { '[CLS]': { ids: [1] }, '[SEP]': { ids: [2] } } },
};

test('токенизатор: лучшее разбиение, служебные слова, неизвестные символы', () => {
  const tok = NER.createTokenizer(tiny);
  assert.deepEqual(tok.encodeWord('maria'), [7]);
  assert.deepEqual(tok.encodeWord('<<ENT>>'), [12]);
  assert.deepEqual(tok.encodeWord('ma日本'), [5, 3]);
  assert.equal(tok.clsId, 1);
  assert.equal(tok.sepId, 2);
});

test('слова делятся по Unicode, как в GLiNER', () => {
  const w = NER.splitWords('Ёлкин-Палкин, Città 12!');
  assert.deepEqual(w.map((x) => x.text), ['Ёлкин-Палкин', ',', 'Città', '12', '!']);
  assert.equal(w[2].start, 14);
});

test('длинный текст режется на куски с перекрытием и без пропусков', () => {
  const words = Array.from({ length: 500 }, (_, i) => ({ text: 'w' + i, start: i * 3, end: i * 3 + 2 }));
  const chunks = NER.chunkWords(words, 160, 16);
  const covered = new Set(chunks.flatMap((c) => c.words.map((w) => w.text)));
  assert.equal(covered.size, 500);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].offset, chunks[i - 1].offset + 144);
});

test('входы модели: маска слов и все промежутки до 12 слов', () => {
  const tok = NER.createTokenizer(tiny);
  const words = NER.splitWords('maria maria');
  const x = NER.buildInputs(tok, words, ['ma'], 12);
  assert.deepEqual(x.ids, [1, 12, 5, 13, 7, 7, 2]);
  assert.deepEqual(x.wordsMask, [0, 0, 0, 0, 1, 2, 0]);
  assert.equal(x.spanMask.filter(Boolean).length, 3);
  assert.deepEqual(x.spanIdx.slice(0, 4), [0, 0, 0, 1]);
});

test('разбор ответа: порог и жадный выбор без пересечений', () => {
  const words = NER.splitWords('Anna Rossi Roma');
  const W = 2;
  const logits = new Float32Array(words.length * W * 2).fill(-10);
  const at = (i, k, c) => (i * W + k) * 2 + c;
  logits[at(0, 1, 0)] = 3;
  logits[at(1, 0, 0)] = 1;
  logits[at(2, 0, 1)] = 0.5;
  const r = NER.decode(logits, words, ['person', 'address'], { maxWidth: W, threshold: 0.6 });
  assert.deepEqual(r.map((e) => [e.label, e.start, e.end]), [['person', 0, 10], ['address', 11, 15]]);
});

test('названия ИИ-сервисов и метки не считаются именами', () => {
  const text = 'Claude e Gemini, [[PERSON_1]], Anna';
  const e = (start, end, label = 'person') => ({ label, start, end });
  assert.equal(NER.accept(e(0, 6), text), null);
  assert.equal(NER.accept(e(0, 15), text), null);
  assert.equal(NER.accept(e(17, 29), text), null);
  assert.equal(NER.accept(e(31, 35), text), 'Anna');
  assert.equal(NER.accept(e(0, 5), 'Li Wu'), 'Li Wu');
});

test('роль в начале строки не считается именем, имя рядом с ней остаётся', () => {
  const e = (start, end) => ({ label: 'person', start, end });
  assert.equal(NER.accept(e(0, 7), 'Cliente: Mario Rossi'), null);
  assert.equal(NER.accept(e(0, 6), 'Клиент Иван Петров'), null);
  assert.equal(NER.accept(e(0, 19), 'Cliente Mario Rossi'), 'Cliente Mario Rossi');
  assert.equal(NER.accept(e(9, 20), 'Cliente: Mario Rossi'), 'Mario Rossi');
});

test('находки на перекрытии кусков не дублируются', async () => {
  const text = Array.from({ length: 300 }, (_, i) => (i === 150 ? 'Mario' : 'x')).join(' ');
  const run = async (words) => words.filter((w) => w.text === 'Mario').map((w) => ({ label: 'person', start: w.start, end: w.end, score: 0.9 }));
  const found = await NER.recognize(text, run);
  assert.equal(found.length, 1);
  assert.equal(found[0].value, 'Mario');
});

test('находки модели маскируются как словарь, но уступают точным правилам', () => {
  const auto = [{ term: 'Ponte Vecchio, Firenze', type: 'ADDRESS', score: 0.7 }, { term: 'Anna Bianchi', type: 'PERSON', score: 0.95 }];
  const text = 'Anna Bianchi, Ponte Vecchio, Firenze, anna@example.com';
  const f = PG.detect(text, { auto });
  assert.deepEqual(f.map((x) => [x.type, x.source || 'rule']), [['PERSON', 'model'], ['ADDRESS', 'model'], ['EMAIL', 'rule']]);
  assert.equal(f[0].score, 0.95);
  const dictWins = PG.detect('Anna Bianchi', { auto, dictionary: [{ term: 'Anna Bianchi', type: 'PERSON' }] });
  assert.equal(dictWins[0].source, undefined);
  const withEmail = PG.detect('scrivi a mario.rossi@example.com', { auto: [{ term: 'mario.rossi', type: 'PERSON', score: 0.6 }] });
  assert.deepEqual(withEmail.map((x) => x.type), ['EMAIL']);
});

test('токенизатор совпадает с Hugging Face tokenizers на 3000 слов', { skip: !built && 'модель не собрана: npm run model' }, () => {
  const tok = NER.createTokenizer(JSON.parse(fs.readFileSync(path.join(modelDir, 'tokenizer.json'), 'utf8')));
  const ref = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/model-tokens.json'), 'utf8'));
  const bad = ref.filter(([w, ids]) => tok.encodeWord(w).join() !== ids.join());
  assert.deepEqual(bad.slice(0, 5), []);
  assert.ok(ref.length >= 3000);
});

test('собранная модель совпадает с lock-файлом', { skip: !built && 'модель не собрана: npm run model' }, () => {
  const { createHash } = require('node:crypto');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'tools/model/model.lock.json'), 'utf8'));
  for (const [name, digest] of Object.entries(lock)) {
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(modelDir, name))).digest('hex'), digest, name);
  }
});
