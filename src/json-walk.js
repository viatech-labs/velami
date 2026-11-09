/* Какие строки JSON-тела запроса проверяются перед отправкой.
   Один и тот же код работает на странице сайта и в самопроверке «Проверь меня сам». */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__PGWalk = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const SKIP_KEY = /(^|_)(id|ids|uuid|uuids)$|^(model|timezone|timezone_offset_min|locale|action|role|content_type|type|status|recipient|channel|conversation_mode)$/i;
  const TEXT_KEY = /^(parts|text|prompt|content|title|query|input|extracted_content)$/i;

  function collect(rootNode) {
    const refs = [];
    const walk = (node, key, holder, k) => {
      if (typeof node === 'string') {
        if (holder && node.length >= 3) refs.push({ holder, k, key });
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, key, node, i));
        return;
      }
      if (node && typeof node === 'object') {
        for (const kk of Object.keys(node)) if (!SKIP_KEY.test(kk)) walk(node[kk], kk, node, kk);
      }
    };
    walk(rootNode, '', null, null);
    return refs;
  }

  /* Строка без ключа похожа на текст человека, а не на идентификатор или токен. */
  const looksLikeText = (s) => typeof s === 'string' && s.length >= 3 && /[\s@]/.test(s.trim()) && !/^[!\w+/=.:-]{40,}$/.test(s);

  /* site: запись из sites.js. У сайта могут быть свои поля с текстом и строки без ключей (Gemini). */
  function isUserText(ref, site, value) {
    const key = String(ref.key);
    if (TEXT_KEY.test(key)) return true;
    if (site && site.textKeys && site.textKeys.includes(key)) return true;
    return !!(site && site.looseText && looksLikeText(value !== undefined ? value : ref.holder && ref.holder[ref.k]));
  }

  return { collect, isUserText, looksLikeText };
});
