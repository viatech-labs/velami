const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../src/policy.js');

const user = { enabled: false, rehydrate: true, model: true, askImages: true, language: 'it', dictionary: [{ term: 'Progetto Alfa', type: 'CUSTOM' }], exclusions: ['EMAIL:a@b.it'], sites: {} };

test('без политики настройки пользователя не меняются', () => {
  const p = P.normalize({});
  assert.strictEqual(p.managed, false);
  assert.deepStrictEqual(P.apply(user, p), user);
  assert.strictEqual(P.normalize(undefined).managed, false);
});

test('заданные ключи перекрывают выбор пользователя и блокируются', () => {
  const p = P.normalize({ enabled: true, language: 'ru', model: false });
  const s = P.apply(user, p);
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.language, 'ru');
  assert.strictEqual(s.model, false);
  assert.strictEqual(s.rehydrate, true);
  assert.ok(P.isLocked(p, 'enabled'));
  assert.ok(!P.isLocked(p, 'rehydrate'));
  assert.ok(!P.isLocked(p, 'dictionary'));
});

test('значения неверного типа игнорируются', () => {
  const p = P.normalize({ enabled: 'true', language: 'de', model: 1, organization: 42, dictionary: 'Alfa', allowExclusions: 'no' });
  assert.deepStrictEqual(p.locked, {});
  assert.deepStrictEqual(p.dictionary, []);
  assert.strictEqual(p.organization, '');
  assert.strictEqual(p.allowExclusions, true);
  assert.strictEqual(p.managed, false);
});

test('словарь организации идёт первым, личный остаётся, дубликаты убираются', () => {
  const p = P.normalize({ dictionary: [{ term: ' Rossi S.p.A. ', type: 'ORG' }, { term: 'progetto alfa' }, { term: 'x' }, { term: 'ROSSI S.P.A.' }, 'Codice Zeta', { term: 'Via Roma 1', type: 'BOGUS' }] });
  assert.deepStrictEqual(p.dictionary, [
    { term: 'Rossi S.p.A.', type: 'ORG' },
    { term: 'progetto alfa', type: 'CUSTOM' },
    { term: 'Codice Zeta', type: 'CUSTOM' },
    { term: 'Via Roma 1', type: 'CUSTOM' },
  ]);
  const s = P.apply(user, p);
  assert.deepStrictEqual(s.dictionary.map((d) => [d.term, !!d.managed]), [
    ['Rossi S.p.A.', true], ['progetto alfa', true], ['Codice Zeta', true], ['Via Roma 1', true],
  ]);
  assert.ok(p.managed);
});

test('записи организации из старых настроек не размножаются', () => {
  const p = P.normalize({ dictionary: [{ term: 'Rossi S.p.A.', type: 'ORG' }] });
  const once = P.apply(user, p);
  const twice = P.apply(once, p);
  assert.deepStrictEqual(twice.dictionary, once.dictionary);
});

test('запрет исключений обнуляет их, личный список сохраняется у пользователя', () => {
  const p = P.normalize({ allowExclusions: false, allowOriginalFiles: false, allowUncheckedFiles: false });
  const s = P.apply(user, p);
  assert.deepStrictEqual(s.exclusions, []);
  assert.deepStrictEqual(user.exclusions, ['EMAIL:a@b.it']);
  assert.ok(P.isLocked(p, 'exclusions'));
  assert.strictEqual(p.allowOriginalFiles, false);
  assert.strictEqual(p.allowUncheckedFiles, false);
  assert.ok(p.managed);
});

test('длинные строки обрезаются, словарь ограничен', () => {
  const p = P.normalize({ organization: 'A'.repeat(500), dictionary: Array.from({ length: 6000 }, (_, i) => 'term' + i) });
  assert.strictEqual(p.organization.length, 120);
  assert.strictEqual(p.dictionary.length, 5000);
});

test('схема для администратора описывает все ключи политики', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'managed-schema.json'), 'utf8'));
  const keys = Object.keys(schema.properties).sort();
  const expected = [...P.LOCKABLE, 'organization', 'supportContact', 'dictionary', 'allowExclusions', 'allowOriginalFiles', 'allowUncheckedFiles'].sort();
  assert.deepStrictEqual(keys, expected);
  for (const k of keys) assert.ok(schema.properties[k].title, 'нет title у ' + k);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.storage.managed_schema, 'managed-schema.json');
});
