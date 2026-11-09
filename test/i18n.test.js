const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const I18N = require('../src/i18n.js');
const PG = require('../src/detector.js');

const root = path.resolve(__dirname, '..');
const params = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('у всех языков одинаковые ключи и одинаковые подстановки', () => {
  const base = I18N.MESSAGES.en;
  for (const lang of I18N.SUPPORTED) {
    const m = I18N.MESSAGES[lang];
    assert.deepEqual(Object.keys(m).sort(), Object.keys(base).sort(), lang);
    for (const k of Object.keys(base)) assert.equal(params(m[k]), params(base[k]), `${lang}: ${k}`);
  }
});

test('разметка только в ключах _html и только из безопасного набора тегов', () => {
  for (const lang of I18N.SUPPORTED) {
    for (const [k, v] of Object.entries(I18N.MESSAGES[lang])) {
      const tags = [...v.matchAll(/<\/?([a-z]+)[^>]*>/g)].map((m) => m[1]);
      if (!k.endsWith('_html')) { assert.equal(tags.length, 0, `${lang}: ${k}`); continue; }
      for (const tag of tags) assert.ok(['code', 'span'].includes(tag), `${lang}: ${k} <${tag}>`);
      assert.ok(!/on\w+=|javascript:/i.test(v), `${lang}: ${k}`);
    }
  }
});

test('у каждого типа находки есть название на каждом языке', () => {
  for (const lang of I18N.SUPPORTED) {
    for (const type of Object.keys(PG.LABELS)) assert.ok(I18N.MESSAGES[lang]['type.' + type], `${lang}: ${type}`);
  }
  for (const k of ['sent', 'other', 'file', 'blocked', 'leak', 'unchecked', 'coverage']) assert.ok(I18N.MESSAGES.en['kind.' + k], k);
});

test('выбор языка: настройка, затем язык браузера, затем английский', () => {
  assert.equal(I18N.resolve('it'), 'it');
  assert.equal(I18N.resolve('ru'), 'ru');
  assert.equal(I18N.resolve('auto'), I18N.resolve());
  assert.ok(I18N.SUPPORTED.includes(I18N.resolve('xx')));
  I18N.setLanguage('it');
  assert.equal(I18N.t('preview.hidden', { n: 3 }).startsWith('Da nascondere: 3.'), true);
  assert.equal(I18N.t('нет.такого'), 'нет.такого');
});

test('все ключи из разметки и кода существуют в таблице строк', () => {
  const files = ['dashboard.html', 'popup.html', 'src/content.js', 'ui/dashboard.js', 'ui/popup.js'];
  const used = new Set();
  for (const f of files) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of s.matchAll(/data-i18n(?:-ph|-title)?="([\w.]+)"/g)) used.add(m[1]);
    for (const m of s.matchAll(/\b(?:tr|t)\('([\w.]*\w)'\s*[,)]/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(k in I18N.MESSAGES.en, 'нет ключа ' + k);
  for (const lang of I18N.SUPPORTED) {
    const msgs = JSON.parse(fs.readFileSync(path.join(root, '_locales', lang, 'messages.json'), 'utf8'));
    assert.ok(msgs.extName.message && msgs.extDescription.message.length <= 132, lang);
  }
});
