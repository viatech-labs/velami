const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../src/sites.js');
const P = require('../src/proto.js');
const W = require('../src/json-walk.js');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const builtIn = S.SITES.filter((s) => !s.optional).flatMap(S.originsOf);
const optional = S.SITES.filter((s) => s.optional).flatMap(S.originsOf);
const u = (s) => new URL(s);

test('манифест совпадает с реестром сайтов', () => {
  assert.deepStrictEqual(manifest.host_permissions, builtIn);
  assert.deepStrictEqual(manifest.optional_host_permissions, optional);
  for (const cs of manifest.content_scripts) assert.deepStrictEqual(cs.matches, builtIn);
  assert.ok(manifest.content_scripts[0].js.includes('src/sites.js') && manifest.content_scripts[0].js.includes('src/proto.js'));
  assert.ok(manifest.permissions.includes('scripting'));
});

test('непроверенные сайты не включены по умолчанию', () => {
  for (const s of S.SITES) assert.ok(!!s.verified !== !!s.optional, s.id);
});

test('запрос к модели определяется по сайту', () => {
  const g = S.siteFor('gemini.google.com');
  assert.ok(S.isSend(g, u('https://geminiweb-pa.clients6.google.com/v1/processSession'), 'gemini.google.com'));
  assert.ok(S.isSend(g, u('https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=x'), 'gemini.google.com'));
  assert.ok(!S.isSend(g, u('https://play.google.com/log?format=json'), 'gemini.google.com'));
  const p = S.siteFor('www.perplexity.ai');
  assert.ok(S.isSend(p, u('https://www.perplexity.ai/rest/sse/perplexity_ask'), 'www.perplexity.ai'));
  assert.ok(!S.isSend(p, u('https://www.perplexity.ai/rest/thread/list'), 'www.perplexity.ai'));
  const c = S.siteFor('chatgpt.com');
  assert.ok(S.isSend(c, u('https://chatgpt.com/backend-api/f/conversation'), 'chatgpt.com'));
  assert.ok(!S.isSend(c, u('https://evil.example/conversation'), 'chatgpt.com'));
  assert.ok(S.isSend(S.siteFor('chat.deepseek.com'), u('https://chat.deepseek.com/api/v0/chat/completion'), 'chat.deepseek.com'));
  assert.ok(S.isSend(S.siteFor('grok.com'), u('https://grok.com/rest/app-chat/conversations/new'), 'grok.com'));
  assert.strictEqual(S.siteFor('example.com'), null);
});

test('WebSocket: подсказки Perplexity не отправляются, чат Copilot маскируется', () => {
  const p = S.siteFor('www.perplexity.ai');
  assert.strictEqual(S.wsMode(p, u('wss://suggest.perplexity.ai/suggest/ws')), 'drop');
  assert.strictEqual(S.wsMode(p, u('wss://www.perplexity.ai/socket.io/')), 'scan');
  const c = S.siteFor('copilot.microsoft.com');
  assert.strictEqual(S.wsMode(c, u('wss://copilot.microsoft.com/c/api/chat?api-version=2')), 'mask');
  assert.ok(S.isSend(c, u('wss://copilot.microsoft.com/c/api/chat?api-version=2'), 'copilot.microsoft.com'));
});

test('поля сообщения у сайтов со своими ключами и без ключей', () => {
  const p = S.siteFor('www.perplexity.ai');
  assert.ok(W.isUserText({ key: 'query_str' }, p, 'mario'));
  assert.ok(!W.isUserText({ key: 'query_str' }, null, 'mario'));
  const g = S.siteFor('gemini.google.com');
  assert.ok(W.isUserText({ key: 0 }, g, 'scrivi a mario.rossi@example.com'));
  assert.ok(!W.isUserText({ key: 0 }, g, 'c_9f2b1e7a3d'));
  assert.ok(!W.isUserText({ key: 0 }, g, '!CQqlQm7NAAY6l_kKGpdCLhSSBX_3p_E7AEABjq4o301iqAxs4WhURZMV'));
});

/* Сообщение protobuf, собранное вручную: поле 1 — вложенное сообщение со строкой и числом,
   поле 2 — строка, поле 3 — число, поле 4 — fixed32. */
function msg() {
  const str = (field, s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from([(field << 3) | 2, b.length]), b]); };
  const inner = Buffer.concat([str(1, 'scrivi a mario.rossi@example.com'), Buffer.from([0x10, 0x96, 0x01])]);
  return Buffer.concat([Buffer.from([0x0a, inner.length]), inner, str(2, 'it-IT'), Buffer.from([0x18, 0x07, 0x25, 1, 2, 3, 4])]);
}

test('protobuf: строки находятся, сборка без изменений даёт тот же base64', () => {
  const b64 = msg().toString('base64');
  const o = P.open(b64);
  assert.deepStrictEqual(o.strings, ['scrivi a mario.rossi@example.com', 'it-IT']);
  assert.strictEqual(o.rebuild(o.strings), b64);
});

test('protobuf: замена меняет длины и сохраняет остальные поля', () => {
  const o = P.open(msg().toString('base64'));
  const out = o.rebuild(['scrivi a [[EMAIL_1]] ' + 'x'.repeat(200), 'it-IT']);
  const again = P.open(out);
  assert.deepStrictEqual(again.strings, ['scrivi a [[EMAIL_1]] ' + 'x'.repeat(200), 'it-IT']);
  assert.ok(!P.readable(out).includes('mario.rossi'));
  assert.ok(Buffer.from(out, 'base64').subarray(-7).equals(Buffer.from([0x18, 0x07, 0x25, 1, 2, 3, 4])));
});

test('protobuf: короткий текст остаётся строкой', () => {
  const b = Buffer.from('hi'); const o = P.open(Buffer.concat([Buffer.from([0x0a, b.length]), b]).toString('base64'));
  assert.deepStrictEqual(o.strings, ['hi']);
  const text = 'Ciao,\nscrivi a mario.rossi@example.com\ngrazie';
  const t = Buffer.from(text); const o2 = P.open(Buffer.concat([Buffer.from([0x0a, t.length]), t]).toString('base64'));
  assert.deepStrictEqual(o2.strings, [text]);
});

test('protobuf: не base64 и не protobuf не разбираются', () => {
  assert.strictEqual(P.open('ciao mondo'), null);
  assert.strictEqual(P.open(Buffer.from('{"a":1}').toString('base64')), null);
  assert.strictEqual(P.open(Buffer.from([0x0f, 0xff, 0xff]).toString('base64')), null);
});
