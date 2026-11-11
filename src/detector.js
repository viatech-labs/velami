/* Velami: поиск чувствительных данных, замена метками и обратная подстановка.
   Без зависимостей: работает в service worker, на страницах расширения, в content script и в Node (тесты). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PG = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const LABELS = {
    SECRET: 'Ключ / пароль',
    IBAN: 'IBAN',
    CARD: 'Банковская карта',
    CF: 'Codice fiscale',
    EMAIL: 'E-mail',
    SNILS: 'СНИЛС',
    INN: 'ИНН',
    PIVA: 'Partita IVA',
    PASSPORT: 'Паспорт',
    IDDOC: 'Удостоверение личности',
    OMS: 'Полис ОМС',
    DOB: 'Дата рождения',
    PLATE: 'Госномер',
    PHONE: 'Телефон',
    IP: 'IP-адрес',
    PERSON: 'Имя',
    ORG: 'Организация',
    ADDRESS: 'Адрес',
    CUSTOM: 'Личное',
  };
  const DICT_TYPES = ['PERSON', 'ORG', 'ADDRESS', 'CUSTOM'];
  const PRIORITY = {
    SECRET: 100, DICT: 90, IBAN: 80, OMS: 76, CARD: 75, CF: 70, EMAIL: 65, SNILS: 60,
    INN: 58, PIVA: 57, PASSPORT: 55, IDDOC: 55, DOB: 54, PHONE: 50, PLATE: 45, IP: 40, ADDRESS: 35, PERSON: 34, MODEL: 30,
  };

  const TOKEN_SOURCE = '\\[\\[\\s*([A-Z]+(?:_[A-Z]+)*)[_ ](\\d+)\\s*\\]\\]';
  const tokenRe = () => new RegExp(TOKEN_SOURCE, 'g');

  const digitsOf = (s) => s.replace(/\D/g, '');
  const alnumUpper = (s) => s.replace(/[^0-9A-Za-z]/g, '').toUpperCase();

  function luhn(d) {
    let sum = 0;
    let alt = false;
    for (let i = d.length - 1; i >= 0; i--) {
      let n = d.charCodeAt(i) - 48;
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  function ibanValid(c) {
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(c)) return false;
    const r = c.slice(4) + c.slice(0, 4);
    let m = 0;
    for (const ch of r) {
      const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
      for (const d of v) m = (m * 10 + (d.charCodeAt(0) - 48)) % 97;
    }
    return m === 1;
  }

  const CF_ODD = {
    0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
    A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
    N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
  };
  function cfValid(value) {
    const cf = value.toUpperCase();
    let s = 0;
    for (let i = 0; i < 15; i++) {
      const c = cf[i];
      if (i % 2 === 0) s += CF_ODD[c];
      else s += c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 65;
    }
    return String.fromCharCode(65 + (s % 26)) === cf[15];
  }

  function pivaValid(d) {
    if (!/^\d{11}$/.test(d) || /^0+$/.test(d)) return false;
    let s = 0;
    for (let i = 0; i < 10; i++) {
      let n = d.charCodeAt(i) - 48;
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      s += n;
    }
    return (10 - (s % 10)) % 10 === d.charCodeAt(10) - 48;
  }

  function innValid(d) {
    const check = (ws) => (ws.reduce((a, w, i) => a + w * (d.charCodeAt(i) - 48), 0) % 11) % 10;
    if (d.length === 10) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === +d[9];
    if (d.length === 12) {
      return check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === +d[10]
        && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === +d[11];
    }
    return false;
  }

  function snilsValid(d) {
    if (!/^\d{11}$/.test(d)) return false;
    let s = 0;
    for (let i = 0; i < 9; i++) s += (d.charCodeAt(i) - 48) * (9 - i);
    let c = s < 100 ? s : s === 100 || s === 101 ? 0 : s % 101;
    if (c === 100) c = 0;
    return c === +d.slice(9);
  }

  const contextBefore = (text, start, re, span = 40) => re.test(text.slice(Math.max(0, start - span), start));

  function refineIban(m) {
    const raw = m[0];
    const pos = [];
    let compact = '';
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== ' ') { pos.push(i); compact += raw[i].toUpperCase(); }
    }
    for (let len = Math.min(34, compact.length); len >= 15; len--) {
      const end = m.index + pos[len - 1] + 1;
      if (/[A-Za-z0-9_\-+/=]/.test(m.input[end] || '')) continue;
      if (ibanValid(compact.slice(0, len))) return { start: m.index, end };
    }
    return null;
  }

  const PIVA_CONTEXT = /(p\.?\s?iva|partita\s+iva|vat|c\.?\s?f\.?|codice\s+fiscale)/i;

  /* Дата скрывается только как дата рождения: сроки и даты встреч модели нужны для ответа. */
  const BIRTH_CONTEXT = /(дат[аеуы]\s+рождени|д\.\s?р\.|рожд[её]н|родил(?:ся|ась)|date\s+of\s+birth|birth\s?date|birthday|\bd\.?o\.?b\b|\bborn\b|data\s+di\s+nascita|\bnat[oa]\b|nascita)/i;
  const MONTHS = 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря'
    + '|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre'
    + '|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
  const DOB_RE = new RegExp(
    '(?<![\\p{L}\\p{N}])(?:(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4}|\\d{2})|(\\d{4})-(\\d{2})-(\\d{2})'
    + `|\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+(\\d{4})(?:\\s?г\\.)?|(?:${MONTHS})\\.?\\s+\\d{1,2},?\\s+(\\d{4}))(?![\\p{L}\\p{N}])`,
    'giu',
  );
  function dobValid(v, m) {
    const [d, mo, y] = m[1] ? [+m[1], +m[2], +m[3]] : m[4] ? [+m[6], +m[5], +m[4]] : [1, 1, +(m[7] || m[8])];
    const year = y < 100 ? y + 1900 : y;
    return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && year >= 1900 && year <= new Date().getFullYear();
  }
  const PLATE_CONTEXT = /(targ|\bauto|macchin|veicol|vettur|\bmoto|plate|\bcar\b|vehicle|госномер|номер|машин|автомобил)/i;
  const ID_CONTEXT = /(carta\s+d['’]\s?identit|\bCIE\b|identity\s+card|\bID\s+card|documento|удостоверени)/i;
  const PASSPORT_CONTEXT = /(passaport|passport|загранпаспорт|заграничн)/i;

  /* Адреса с явной структурой: тип улицы, название и обязательно номер дома. Модель такие адреса
     в официальном русском формате («г. …, ул. …, д. …, кв. …») часто пропускает. */
  const RU_CITY = '(?:\\d{6},\\s*)?(?:(?:г\\.|город)\\s*[А-ЯЁ][а-яё]+(?:(?:\\s|-)[А-ЯЁ][а-яё]+)?,\\s*|[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)*,\\s*)?';
  const RU_TYPE = '(?:ул\\.|улиц[аеуы]|пр-т|просп\\.|проспект[а-я]*|пер\\.|переул[а-я]*|б-р|бульвар[а-я]*|ш\\.|шоссе|наб\\.|набережн[а-я]*|пл\\.|площад[а-я]*|проезд[а-я]*|мкр\\.?|микрорайон[а-я]*)';
  const RU_NAME = '[А-ЯЁ0-9][А-ЯЁа-яё0-9-]*';
  const RU_HOUSE = '(?:,?\\s*(?:д\\.|дом)\\s*|,\\s*)\\d+[а-яА-Я]?(?:\\/\\d+[а-яА-Я]?)?';
  const RU_TAIL = '(?:,?\\s*(?:корп\\.|корпус|к\\.|стр\\.|строение|кв\\.|квартира|оф\\.|офис|под\\.|подъезд|эт\\.|этаж)\\s*\\d+[а-яА-Я]?)*';
  const IT_TYPE = '(?:[Vv]ia|[Vv]iale|V\\.le|[Cc]orso|C\\.so|[Pp]iazza|P\\.zza|[Pp]iazzale|[Ll]argo|[Vv]icolo|[Ss]trada|[Ll]ungomare|[Ll]ungotevere|[Bb]orgo|[Cc]ontrada)';
  const IT_CAP = "[A-ZÀ-Ý][A-Za-zÀ-ÿ0-9'’.]*";
  const IT_FIRST = "[A-ZÀ-Ý][a-zà-ÿ'’][A-Za-zÀ-ÿ0-9'’.]*";
  const IT_PART = "(?:del|della|dei|degli|delle|di|da|d')";
  const IT_NAME = `(?:${IT_PART}\\s+)?${IT_FIRST}(?:\\s+(?:${IT_CAP}|${IT_PART}|\\d+[°ª]?)){0,5}?`;
  const IT_EXTRA = '(?:,?\\s*(?:interno|int\\.|scala|sc\\.|piano)\\s*[A-Za-z0-9]+)*';
  const IT_CITY = "(?:,?\\s*\\d{5}\\s+[A-ZÀ-Ý][a-zà-ÿ'’]+(?:\\s[A-ZÀ-Ý][a-zà-ÿ'’]+)?(?:\\s*\\([A-Z]{2}\\))?|,\\s*[A-ZÀ-Ý][a-zà-ÿ'’]+(?=\\s|[.,;:!?)]|$))?";
  const EN_TYPE = '(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Way|Terrace|Close|Square|Sq|Parkway|Pkwy|Highway|Hwy|Crescent|Row|Mews|Gardens)\\.?';
  const EN_UNIT = '(?:,?\\s*(?:Apt|Apartment|Suite|Ste|Unit|Flat|Floor|Fl)\\.?\\s*#?[A-Za-z0-9-]+)?';
  const EN_CITY = '(?:,\\s*[A-Z][a-z]+(?:\\s[A-Z][a-z]+){0,2})?(?:,?\\s*[A-Z]{2}\\s+\\d{5}(?:-\\d{4})?|,?\\s*[A-Z]{1,2}\\d[A-Z\\d]?\\s*\\d[A-Z]{2})?';
  /* Адрес пишется в одну строку: перенос внутри почти всегда значит, что совпадение случайное. */
  const oneLine = (src) => new RegExp(src.replaceAll('\\s', '[ \\t\\u00a0]'), 'gu');
  const ADDRESS_RULES = [
    { type: 'ADDRESS', re: oneLine(`(?<![\\p{L}\\p{N}])${RU_CITY}${RU_TYPE}\\s*${RU_NAME}(?:\\s+${RU_NAME}){0,3}${RU_HOUSE}${RU_TAIL}`) },
    { type: 'ADDRESS', re: oneLine(`(?<![\\p{L}\\p{N}])${RU_CITY}${RU_NAME}(?:\\s+${RU_NAME}){0,2}\\s+${RU_TYPE}${RU_HOUSE}${RU_TAIL}`) },
    { type: 'ADDRESS', re: oneLine(`(?<![\\p{L}\\p{N}])${IT_TYPE}\\s+${IT_NAME},?\\s+\\d+[A-Za-z]?(?:\\/[A-Za-z0-9]+)?${IT_EXTRA}${IT_CITY}${IT_EXTRA}`) },
    { type: 'ADDRESS', re: oneLine(`(?<![\\p{L}\\p{N}])\\d{1,6}[A-Z]?\\s+(?:[A-Z][a-z]+\\s+){1,4}${EN_TYPE}${EN_UNIT}${EN_CITY}(?![\\p{L}\\p{N}])`) },
  ];

  /* Русские ФИО с отчеством или инициалами. Модель в длинном тексте иногда теряет их целиком,
     а отчество и инициалы почти не встречаются вне имён. Слово слева берётся, только если оно
     похоже на фамилию или стоит не в начале предложения: «Передай Руслану Тимуровичу». */
  const RU_WORD = '[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?';
  const RU_PATR = '[А-ЯЁ][а-яё]+(?:ович|евич|овн|евн|ичн|иничн)(?:а|у|ем|е|ой|ы|ей|ым|ом)?';
  const RU_SURNAME = /(?:ов|ев|ёв|ин|ын|ский|цкий|ской|цкой|ова|ева|ёва|ина|ына|ская|цкая)(?:а|у|ым|ом|е|ой|ой|ую|ого|ому|им)?$/;
  const PERSON_RULES = [
    {
      type: 'PERSON',
      re: new RegExp(`(?<![\\p{L}\\p{N}])(?:(${RU_WORD})[ \\t\\u00a0]+)?${RU_WORD}[ \\t\\u00a0]+${RU_PATR}(?:[ \\t\\u00a0]+${RU_WORD})?(?![\\p{L}\\p{N}])`, 'gud'),
      refine(m) {
        let start = m.index;
        const left = m.indices[1];
        if (left) {
          const before = m.input.slice(0, left[0]).trimEnd();
          if (!RU_SURNAME.test(m[1]) && (!before || /[.!?:\n]$/.test(before))) start = left[1] + 1;
        }
        return { start, end: m.index + m[0].length };
      },
    },
    {
      type: 'PERSON',
      re: new RegExp(`(?<![\\p{L}\\p{N}])${RU_WORD}[ \\t\\u00a0]+[А-ЯЁ]\\.[ \\t\\u00a0]?[А-ЯЁ]\\.`, 'gu'),
      valid: (v, m, text, start) => !/^[ \t\u00a0]?[А-ЯЁ][а-яё]/.test(text.slice(start + v.length)),
    },
    { type: 'PERSON', re: new RegExp(`(?<![\\p{L}\\p{N}.])[А-ЯЁ]\\.[ \\t\\u00a0]?[А-ЯЁ]\\.[ \\t\\u00a0]?${RU_WORD}(?![\\p{L}\\p{N}])`, 'gu') },
  ];

  const RULES = [
    ...PERSON_RULES,
    { type: 'SECRET', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g },
    { type: 'SECRET', re: /\bsk-(?:proj-|ant-[a-z0-9]{2,8}-)?[A-Za-z0-9_-]{20,}/g },
    { type: 'SECRET', re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
    { type: 'SECRET', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
    { type: 'SECRET', re: /\bAKIA[0-9A-Z]{16}\b/g },
    { type: 'SECRET', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
    { type: 'SECRET', re: /\bAIza[0-9A-Za-z_-]{35}/g },
    { type: 'SECRET', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
    { type: 'SECRET', re: /(?:password|passwd|pwd|пароль|api[_-]?key)\s*[:=]\s*["']?([^\s"']{4,})/gid, group: 1 },
    { type: 'IBAN', re: /(?<![\w\-+/=])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,32}/gi, refine: refineIban },
    {
      type: 'CARD',
      re: /(?<![\w\-+/=.])(?:\d[ -]?){12,18}\d(?![\w\-+/=]|\.\d)/g,
      valid: (v) => {
        const d = digitsOf(v);
        return d.length >= 13 && d.length <= 19 && !/^(\d)\1+$/.test(d) && luhn(d);
      },
    },
    {
      type: 'CF',
      re: /\b[A-Z]{6}[0-9LMNP-V]{2}[A-EHLMPR-T][0-9LMNP-V]{2}[A-Z][0-9LMNP-V]{3}[A-Z]\b/gi,
      valid: cfValid,
    },
    { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
    { type: 'SNILS', re: /(?<!\d)\d{3}-\d{3}-\d{3}[ -]\d{2}(?!\d)/g, valid: (v) => snilsValid(digitsOf(v)) },
    { type: 'SNILS', re: /(?<!\d)\d{11}(?!\d)/g, context: /снилс/i, valid: snilsValid },
    { type: 'INN', re: /(?<!\d)(?:\d{12}|\d{10})(?!\d)/g, context: /инн/i, valid: innValid },
    {
      type: 'PIVA',
      re: /(?<![\dA-Z])(IT ?)?(\d{11})(?!\d)/gid,
      group: 2,
      valid: (v, m, text, start) => pivaValid(v) && (!!m[1] || contextBefore(text, m.index, PIVA_CONTEXT, 30)),
    },
    { type: 'PASSPORT', re: /(?<!\d)\d{2} ?\d{2} ?\d{6}(?!\d)/g, context: /паспорт/i },
    { type: 'PASSPORT', re: /(?<!\d)\d{2} ?\d{7}(?!\d)/g, context: PASSPORT_CONTEXT },
    { type: 'PASSPORT', re: /(?<![\p{L}\p{N}])[A-Z]{2} ?\d{7}(?![\p{L}\p{N}])/gu, context: PASSPORT_CONTEXT },
    { type: 'IDDOC', re: /(?<![\p{L}\p{N}])[A-Z]{2} ?\d{5} ?[A-Z]{2}(?![\p{L}\p{N}])/gu, context: ID_CONTEXT },
    { type: 'OMS', re: /(?<!\d)\d{4} ?\d{4} ?\d{4} ?\d{4}(?!\d)/g, context: /(полис|омс)/i },
    { type: 'DOB', re: DOB_RE, context: BIRTH_CONTEXT, valid: dobValid },
    { type: 'PLATE', re: /(?<![\p{L}\p{N}])[АВЕКМНОРСТУХ] ?\d{3} ?[АВЕКМНОРСТУХ]{2} ?\d{2,3}(?![\p{L}\p{N}])/gu },
    { type: 'PLATE', re: /(?<![\p{L}\p{N}])[ABEKMHOPCTYX] ?\d{3} ?[ABEKMHOPCTYX]{2} ?\d{2,3}(?![\p{L}\p{N}])/gu, context: PLATE_CONTEXT },
    { type: 'PLATE', re: /(?<![\p{L}\p{N}])[A-HJ-NPR-TV-Z]{2} ?\d{3} ?[A-HJ-NPR-TV-Z]{2}(?![\p{L}\p{N}])/gu, context: PLATE_CONTEXT },
    {
      type: 'PHONE',
      re: /(?<![\w+])\+\d[\d \-().]{7,20}\d(?!\d)/g,
      valid: (v) => { const n = digitsOf(v).length; return n >= 9 && n <= 15; },
    },
    { type: 'PHONE', re: /(?<!\d)8[ -]?\(?9\d{2}\)?[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)/g },
    { type: 'PHONE', re: /(?<![\d+])3\d{2}[ .-]?\d{3}[ .-]?\d{3,4}(?!\d)/g },
    {
      type: 'IP',
      re: /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\w|\.\d)/g,
      valid: (v) => !['0.0.0.0', '127.0.0.1', '255.255.255.255'].includes(v),
    },
    ...ADDRESS_RULES,
  ];

  function normKey(type, value) {
    switch (type) {
      case 'EMAIL': return value.toLowerCase();
      case 'IBAN': case 'CF': return alnumUpper(value);
      case 'CARD': case 'PHONE': case 'SNILS': case 'INN': case 'PIVA': case 'OMS': return digitsOf(value);
      case 'PASSPORT': case 'IDDOC': case 'PLATE': return alnumUpper(value.replace(/[АВЕКМНОРСТУХ]/g, (c) => 'ABEKMHOPCTYX'['АВЕКМНОРСТУХ'.indexOf(c)]));
      default: return value;
    }
  }

  const CYR_ENDINGS = '(?:а|я|у|ю|е|и|ы|ой|ей|ом|ем|ым|им|ою|ею|ах|ях|ам|ям|ами|ями|ых|их)?';
  const CYR_STEM = /(?:ами|ями|ого|его|ому|ему|ой|ей|ом|ем|ым|им|ою|ею|ах|ях|ам|ям|ых|их|а|я|у|ю|е|и|ы)$/i;
  const dictCache = new Map();
  /* stem: термин взят из текста в любом падеже (так его находит модель), поэтому окончание
     отрезается, если основа остаётся не короче 3 букв. Словарь пользователя пишется в именительном. */
  function dictRegex(term, stem = false) {
    const cacheKey = (stem ? '~' : '') + term;
    let re = dictCache.get(cacheKey);
    if (re) return re;
    const parts = term.split(/\s+/).map((w) => {
      if (!/[А-Яа-яЁё]/.test(w) || w.length < 4) return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let base = w;
      if (stem) {
        const cut = base.replace(CYR_STEM, '');
        if (cut.length >= 3) base = cut;
      }
      return base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + CYR_ENDINGS;
    });
    re = new RegExp('(?<![\\p{L}\\p{N}])' + parts.join('\\s+') + '(?![\\p{L}\\p{N}])', 'giu');
    dictCache.set(cacheKey, re);
    return re;
  }

  /* Как ещё может встретиться в тексте имя, которое нашла модель: «Олег Викторович» после
     «Олег Викторович Мельников», «Мельников О. В.», «F. Moretti». Только производные с отчеством
     или инициалом: одна фамилия без контекста слишком часто совпадает с обычным словом. */
  const PATRONYMIC = /(?:ович|евич|ич|овна|евна|ична|инична)(?:а|у|ем|е|ой|ы|ей)?$/i;
  function nameVariants(term) {
    const words = String(term || '').trim().split(/\s+/);
    if (words.some((w) => w.length < 2 || w.endsWith('.'))) return [];
    const ini = (w) => w[0].toUpperCase() + '.';
    const out = new Set();
    if (words.length === 3 && words.every((w) => /^[А-ЯЁ][а-яё-]+$/.test(w))) {
      const p = words.findIndex((w) => PATRONYMIC.test(w));
      let first; let patr; let sur;
      if (p === 1) [first, patr, sur] = words;
      else if (p === 2) [sur, first, patr] = words;
      else return [];
      out.add(`${first} ${patr}`);
      out.add(`${ini(first)} ${ini(patr)} ${sur}`);
      out.add(`${ini(first)}${ini(patr)} ${sur}`);
      out.add(`${sur} ${ini(first)} ${ini(patr)}`);
      out.add(`${sur} ${ini(first)}${ini(patr)}`);
    } else if (words.length === 2 && words.every((w) => /^\p{Lu}\p{Ll}+(?:['’-]\p{Lu}?\p{Ll}+)?$/u.test(w))) {
      if (PATRONYMIC.test(words[1])) return [];
      out.add(`${ini(words[0])} ${words[1]}`);
      if (/[А-ЯЁ]/.test(words[0])) out.add(`${words[1]} ${ini(words[0])}`);
    }
    return [...out];
  }

  /* auto: имена и адреса, которые нашла локальная модель. Работают как словарь, но с низшим
     приоритетом: точные правила (IBAN, e-mail…) внутри такого фрагмента важнее. */
  function dictionaryMatches(text, dictionary, auto = false) {
    const out = [];
    for (const entry of dictionary || []) {
      const term = String(entry.term || '').trim();
      if (term.length < 2) continue;
      const type = DICT_TYPES.includes(entry.type) ? entry.type : 'CUSTOM';
      const re = dictRegex(term, auto);
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const f = {
          type, start: m.index, end: m.index + m[0].length, value: m[0],
          key: term.toLowerCase(), canonical: term, priority: auto ? PRIORITY.MODEL : PRIORITY.DICT,
        };
        if (auto) { f.source = 'model'; f.score = entry.score; }
        out.push(f);
      }
    }
    return out;
  }

  function tokenSpans(text) {
    const spans = [];
    const re = tokenRe();
    let m;
    while ((m = re.exec(text))) spans.push({ start: m.index, end: m.index + m[0].length });
    return spans;
  }

  const overlaps = (a, b) => a.start < b.end && b.start < a.end;

  function detect(text, { dictionary = [], auto = [] } = {}) {
    const found = [];
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(text))) {
        let start;
        let end;
        if (rule.refine) {
          const r = rule.refine(m);
          if (!r) continue;
          ({ start, end } = r);
          rule.re.lastIndex = Math.max(end, m.index + 1);
        } else if (rule.group) {
          const ix = m.indices && m.indices[rule.group];
          if (!ix) continue;
          [start, end] = ix;
        } else {
          start = m.index;
          end = m.index + m[0].length;
        }
        const value = text.slice(start, end);
        if (rule.context && !contextBefore(text, start, rule.context)) continue;
        if (rule.valid && !rule.valid(value, m, text, start)) continue;
        found.push({ type: rule.type, start, end, value, key: normKey(rule.type, value), priority: PRIORITY[rule.type] });
      }
    }
    found.push(...dictionaryMatches(text, dictionary));
    found.push(...dictionaryMatches(text, auto, true));

    const guard = tokenSpans(text);
    found.sort((a, b) => b.priority - a.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const chosen = [];
    for (const f of found) {
      if (guard.some((g) => overlaps(f, g)) || chosen.some((c) => overlaps(f, c))) continue;
      chosen.push(f);
    }
    chosen.sort((a, b) => a.start - b.start);
    return chosen.map((f) => {
      const out = {
        type: f.type,
        label: LABELS[f.type],
        start: f.start,
        end: f.end,
        value: f.value,
        key: f.key,
        canonical: f.canonical,
        id: f.type + ':' + f.key,
      };
      if (f.source) { out.source = f.source; out.score = f.score; }
      return out;
    });
  }

  class Vault {
    constructor(data) {
      const d = data || {};
      this.data = { byKey: { ...(d.byKey || {}) }, byToken: { ...(d.byToken || {}) }, counters: { ...(d.counters || {}) } };
    }
    peek(id) { return this.data.byKey[id] || null; }
    counter(type) { return this.data.counters[type] || 0; }
    put(id, type, token, value) {
      this.data.byKey[id] = token;
      this.data.byToken[token] = value;
      const n = Number(/_(\d+)\]\]$/.exec(token)[1]);
      if (n > this.counter(type)) this.data.counters[type] = n;
    }
    get size() { return Object.keys(this.data.byToken).length; }
  }

  function applyFindings(text, findings, { vault, exclusions = [], commit = false }) {
    const excl = exclusions instanceof Set ? exclusions : new Set(exclusions);
    const pending = new Map();
    const pendingCount = {};
    const result = [];
    let out = '';
    let cursor = 0;
    for (const f of findings) {
      const excluded = excl.has(f.id);
      let token = null;
      let isNew = false;
      if (!excluded) {
        token = vault.peek(f.id) || (pending.get(f.id) || {}).token;
        if (!token) {
          pendingCount[f.type] = (pendingCount[f.type] || 0) + 1;
          token = `[[${f.type}_${vault.counter(f.type) + pendingCount[f.type]}]]`;
          pending.set(f.id, { token, type: f.type, value: f.canonical || f.value });
          isNew = true;
        }
        out += text.slice(cursor, f.start) + (f.encoded ? encodeURIComponent(token) : token);
        cursor = f.end;
      }
      result.push({ ...f, token, excluded, isNew });
    }
    out += text.slice(cursor);
    if (commit) for (const [id, p] of pending) vault.put(id, p.type, p.token, p.value);
    return { text: out, findings: result };
  }

  function maskText(text, opts = {}) {
    return applyFindings(text, detect(text, { dictionary: opts.dictionary, auto: opts.auto }), opts);
  }

  /* Известные значения: то, что детектор нашёл в набранном пользователем тексте. Их ищем в любых
     исходящих данных сайта буквально, без общего поиска, чтобы не портить служебные токены. */
  function candidatesFrom(texts, { dictionary = [], auto = [], exclusions = [], vaultData = null } = {}) {
    const excl = new Set(exclusions);
    const map = new Map();
    for (const t of texts) {
      for (const f of detect(String(t), { dictionary, auto })) {
        if (!excl.has(f.id)) map.set(f.id + '\u0000' + f.value, { id: f.id, type: f.type, value: f.value, canonical: f.canonical });
      }
    }
    if (vaultData) {
      for (const [id, token] of Object.entries(vaultData.byKey || {})) {
        const value = (vaultData.byToken || {})[token];
        const type = typeOfToken(token);
        if (!excl.has(id) && value && type) map.set(id + '\u0000' + value, { id, type, value: String(value) });
      }
    }
    return [...map.values()];
  }

  const WORD = /[\p{L}\p{N}]/u;

  /* Известное значение, записанное с экранированием. Редакторы сайтов сохраняют текст как Markdown
     или HTML: перед знаками появляется «\» (anna\@example.com, sk\-proj\_…), знаки и пробелы
     становятся сущностями (&amp;, &#64;, &#x20;, &nbsp;), пробел превращается в перевод строки.
     Буквальный поиск такое значение не видит, и оно ушло бы на сервер сайта нераспознанным. */
  const PUNCT = /[!-\/:-@[-`{-~]/;
  const NAMED = { '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": 'apos' };
  const reEscape = (ch) => ch.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
  const hexAnyCase = (h) => h.replace(/[a-f]/g, (x) => `[${x}${x.toUpperCase()}]`);
  const SPACE_SOURCE = '(?:[ \\t\\u00a0]|\\r?\\n|\\\\{1,3}\\r?\\n|&nbsp;|&#[xX]0*20;|&#0*32;|&#[xX]0*[aA]0;|&#0*160;)+';
  const looseCache = new Map();
  function looseValue(value, caseless) {
    const key = (caseless ? 'i' : 's') + value;
    let hit = looseCache.get(key);
    if (hit !== undefined) return hit;
    let src = '';
    let special = false;
    let space = false;
    let chunk = '';
    let longest = '';
    for (const ch of value) {
      const sp = /\s/.test(ch);
      const punct = !sp && PUNCT.test(ch);
      if (sp || punct) {
        special = true;
        if (chunk.length > longest.length) longest = chunk;
        chunk = '';
      } else chunk += ch;
      if (sp) { if (!space) src += SPACE_SOURCE; space = true; continue; }
      space = false;
      if (punct) {
        const cp = ch.codePointAt(0);
        src += `(?:\\\\{0,3}${reEscape(ch)}|&#[xX]0*${hexAnyCase(cp.toString(16))};|&#0*${cp};${NAMED[ch] ? `|&${NAMED[ch]};` : ''})`;
      } else src += reEscape(ch);
    }
    if (chunk.length > longest.length) longest = chunk;
    /* Без знаков и пробелов экранировать нечего. Кусок из букв и цифр нужен, чтобы быстро
       отсеять тексты, где значения точно нет. */
    hit = special && longest.length >= 2 ? { re: new RegExp(src, caseless ? 'gi' : 'g'), probe: caseless ? longest.toLowerCase() : longest } : null;
    if (looseCache.size > 5000) looseCache.clear();
    looseCache.set(key, hit);
    return hit;
  }

  function locate(text, candidates) {
    const found = [];
    const taken = tokenSpans(text);
    const lower = text.toLowerCase();
    const sorted = [...candidates].filter((c) => c.value.length >= 3).sort((a, b) => b.value.length - a.value.length);
    /* В большом тексте без «\» и «&» экранированных значений нет: там остаётся буквальный поиск. */
    const mayEscape = text.length < 20000 || /[\\&\u00a0]/.test(text);
    for (const c of sorted) {
      const enc = encodeURIComponent(c.value);
      const variants = [[c.value, false]];
      if (enc !== c.value) variants.push([enc, true], [enc.replace(/%20/g, '+'), true]);
      const caseless = c.type === 'EMAIL' || DICT_TYPES.includes(c.type);
      const hay = caseless ? lower : text;
      for (const [raw, encoded] of variants) {
        const needle = caseless ? raw.toLowerCase() : raw;
        for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
          const span = { start: i, end: i + needle.length };
          if (!encoded && (WORD.test(text[i - 1] || '') || WORD.test(text[span.end] || ''))) continue;
          if (taken.some((t) => overlaps(t, span))) continue;
          taken.push(span);
          found.push({ id: c.id, type: c.type, label: LABELS[c.type], value: c.value, canonical: c.canonical, start: span.start, end: span.end, encoded });
        }
      }
      const loose = mayEscape ? looseValue(c.value, caseless) : null;
      if (!loose || hay.indexOf(loose.probe) < 0) continue;
      loose.re.lastIndex = 0;
      for (let m; (m = loose.re.exec(text));) {
        if (!m[0]) { loose.re.lastIndex++; continue; }
        const span = { start: m.index, end: m.index + m[0].length };
        if (WORD.test(text[span.start - 1] || '') || WORD.test(text[span.end] || '')) continue;
        if (taken.some((t) => overlaps(t, span))) continue;
        taken.push(span);
        found.push({ id: c.id, type: c.type, label: LABELS[c.type], value: c.value, canonical: c.canonical, start: span.start, end: span.end, encoded: false });
      }
    }
    return found.sort((a, b) => a.start - b.start);
  }

  function maskKnown(text, opts = {}) {
    return applyFindings(text, locate(text, opts.candidates || []), opts);
  }

  /* Модели иногда теряют скобки метки: «PERSON_2», «[PERSON_2]», чаще всего внутри жирного шрифта.
     Такая форма заменяется, только если метка есть в хранилище. */
  const LOOSE_SOURCE = '\\[?(?<![A-Za-z0-9_])([A-Z]+(?:_[A-Z]+)*)_(\\d+)(?![A-Za-z0-9_])\\]?';
  const rehydrateRe = () => new RegExp(TOKEN_SOURCE + '|' + LOOSE_SOURCE, 'g');

  function rehydrate(text, byToken) {
    const spans = [];
    const re = rehydrateRe();
    let out = '';
    let cursor = 0;
    let m;
    while ((m = re.exec(text))) {
      const token = m[1] ? `[[${m[1]}_${m[2]}]]` : `[[${m[3]}_${m[4]}]]`;
      const value = byToken[token];
      if (value == null) continue;
      out += text.slice(cursor, m.index);
      const start = out.length;
      out += value;
      spans.push({ start, end: out.length, token });
      cursor = m.index + m[0].length;
    }
    out += text.slice(cursor);
    return { text: out, spans };
  }

  function findLeaks(text, { candidates = [] } = {}) {
    const types = [...new Set(locate(text, candidates).map((f) => f.type))].sort();
    return { types, leak: types.length > 0 };
  }

  function typeOfToken(token) {
    return (/^\[\[([A-Z_]+)_\d+\]\]$/.exec(token) || [])[1] || null;
  }

  return {
    LABELS, DICT_TYPES, TOKEN_SOURCE, LOOSE_SOURCE, tokenRe, typeOfToken,
    detect, nameVariants, maskText, maskKnown, candidatesFrom, locate, rehydrate, findLeaks, Vault,
    checks: { luhn, ibanValid, cfValid, pivaValid, innValid, snilsValid },
  };
});
