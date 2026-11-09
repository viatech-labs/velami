/* Политика организации из chrome.storage.managed. Администратор задаёт её через Google Admin,
   групповые политики Windows, профиль macOS или JSON-файл политик Linux. Схема в managed-schema.json.
   normalize проверяет сырые значения: всё, что не подходит по типу, игнорируется. apply накладывает
   политику на настройки пользователя: заданные ключи нельзя изменить, словарь организации
   добавляется к личному. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__PGPolicy = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const LOCKABLE = { enabled: 'boolean', rehydrate: 'boolean', model: 'boolean', askImages: 'boolean', language: 'string' };
  const LANGUAGES = ['auto', 'en', 'it', 'ru'];
  const DICT_TYPES = ['PERSON', 'ORG', 'ADDRESS', 'CUSTOM'];
  const MAX_TERMS = 5000;
  const MAX_TEXT = 120;

  const text = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');
  const allow = (v) => v !== false;

  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const locked = {};
    for (const [key, type] of Object.entries(LOCKABLE)) {
      if (typeof r[key] !== type) continue;
      if (key === 'language' && !LANGUAGES.includes(r[key])) continue;
      locked[key] = r[key];
    }
    const seen = new Set();
    const dictionary = [];
    for (const d of Array.isArray(r.dictionary) ? r.dictionary : []) {
      const term = text(d && typeof d === 'object' ? d.term : d);
      const key = term.toLowerCase();
      if (term.length < 2 || seen.has(key) || dictionary.length >= MAX_TERMS) continue;
      seen.add(key);
      dictionary.push({ term, type: DICT_TYPES.includes(d && d.type) ? d.type : 'CUSTOM' });
    }
    const policy = {
      organization: text(r.organization),
      supportContact: text(r.supportContact),
      locked,
      dictionary,
      allowExclusions: allow(r.allowExclusions),
      allowOriginalFiles: allow(r.allowOriginalFiles),
      allowUncheckedFiles: allow(r.allowUncheckedFiles),
    };
    policy.managed = !!(policy.organization || policy.supportContact || Object.keys(locked).length || dictionary.length
      || !policy.allowExclusions || !policy.allowOriginalFiles || !policy.allowUncheckedFiles);
    return policy;
  }

  function apply(user, policy) {
    const own = (user.dictionary || []).filter((d) => !d.managed);
    const taken = new Set(policy.dictionary.map((d) => d.term.toLowerCase()));
    return {
      ...user,
      ...policy.locked,
      dictionary: [
        ...policy.dictionary.map((d) => ({ ...d, managed: true })),
        ...own.filter((d) => !taken.has(d.term.toLowerCase())),
      ],
      exclusions: policy.allowExclusions ? user.exclusions || [] : [],
    };
  }

  /* Ключ настройки пользователя, который политика не даёт менять. */
  const isLocked = (policy, key) => key === 'exclusions' ? !policy.allowExclusions : key in policy.locked;

  return { normalize, apply, isLocked, LOCKABLE: Object.keys(LOCKABLE) };
});
