/* Сайты ИИ, на которых работает Velami, и то, как каждый из них отправляет сообщение модели.
   Один список для страницы сайта, панели, фонового процесса, страницы настроек и тестов.
   verified: формат снят с живого сайта. optional: включается пользователем на странице настроек,
   Chrome при этом отдельно спрашивает разрешение на сайт. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__PGSites = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const SITES = [
    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', hosts: ['chatgpt.com', 'chat.openai.com'],
      send: [{ path: /conversation|completion/i }], verified: true },
    { id: 'claude', name: 'Claude', url: 'https://claude.ai/', hosts: ['claude.ai'],
      send: [{ path: /conversation|completion/i }], verified: true },
    // Без входа: protobuf в base64 в поле формы reqN___data__ на geminiweb-pa (снято 09/11/2026).
    // С входом: f.req в StreamGenerate, JSON внутри JSON. Ключей у строк нет, текст ищется по виду.
    { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', hosts: ['gemini.google.com'],
      send: [{ host: 'geminiweb-pa.clients6.google.com', path: /\/processSession$/ }, { path: /\/StreamGenerate$/ }],
      looseText: true, proto: /^req\d+___data__$/, verified: true },
    // Сообщение: JSON с query_str и dsl_query (снято 09/11/2026). Подсказки при наборе уходят
    // по WebSocket по одной букве, такие кадры не отправляются: неполное значение не распознать.
    { id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', hosts: ['www.perplexity.ai', 'perplexity.ai'],
      send: [{ path: /^\/rest\/sse\/perplexity_ask$/ }], textKeys: ['query_str', 'dsl_query'],
      dropWs: [/^wss:\/\/suggest\.perplexity\.ai\//], verified: true },
    { id: 'copilot', name: 'Microsoft Copilot', url: 'https://copilot.microsoft.com/', hosts: ['copilot.microsoft.com', 'copilot.com'],
      wsSend: [/\/c\/api\/chat/], optional: true },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', hosts: ['chat.deepseek.com'],
      send: [{ path: /\/api\/v0\/chat\/completion$/ }], optional: true },
    { id: 'mistral', name: 'Mistral Le Chat', url: 'https://chat.mistral.ai/chat', hosts: ['chat.mistral.ai'],
      send: [{ path: /^\/api\/(chat|trpc\/(message|chat)\.)/ }], optional: true },
    { id: 'grok', name: 'Grok', url: 'https://grok.com/', hosts: ['grok.com'],
      send: [{ path: /^\/rest\/app-chat\/conversations\// }], textKeys: ['message'], optional: true },
  ];

  const siteFor = (host) => SITES.find((s) => s.hosts.includes(String(host || '').toLowerCase())) || null;
  const originsOf = (site) => site.hosts.map((h) => `https://${h}/*`);

  /* Запрос к модели: путь отправки сообщения на самом сайте или на его адресе для модели. */
  function isSend(site, url, pageHost) {
    if (!site) return false;
    if (/^wss?:$/.test(url.protocol)) return (site.wsSend || []).some((re) => re.test(url.href));
    return (site.send || []).some((rule) => (rule.host ? url.host === rule.host : url.host === pageHost) && rule.path.test(url.pathname));
  }

  function wsMode(site, url) {
    if (!site) return 'scan';
    if ((site.dropWs || []).some((re) => re.test(url.href))) return 'drop';
    if ((site.wsSend || []).some((re) => re.test(url.href))) return 'mask';
    return 'scan';
  }

  return { SITES, siteFor, originsOf, isSend, wsMode };
});
