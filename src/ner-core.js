/* Velami: подготовка текста для модели GLiNER и разбор её ответа. Сама модель запускается в
   offscreen-документе (src/offscreen.js), здесь только чистые функции без зависимостей, чтобы их
   можно было проверить в Node на тех же данных. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NER = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const SPACE = '\u2581';
  const UNK_PENALTY = 10;
  const MAX_PIECE = 24;

  /* Unigram-токенизатор SentencePiece по tokenizer.json. GLiNER кодирует каждое слово отдельно,
     поэтому пробелов внутри не бывает: NFKC, «▁» в начале и поиск лучшего разбиения (Витерби). */
  function createTokenizer(json) {
    const model = json.model;
    if (!model || model.type !== 'Unigram') throw new Error('unsupported tokenizer');
    const pieces = new Map();
    let minScore = 0;
    model.vocab.forEach(([piece, score], id) => {
      pieces.set(piece, { id, score });
      if (score < minScore) minScore = score;
    });
    const added = new Map((json.added_tokens || []).map((a) => [a.content, a.id]));
    const unkId = model.unk_id;
    const unkScore = minScore - UNK_PENALTY;
    const special = (name) => {
      const st = json.post_processor && json.post_processor.special_tokens && json.post_processor.special_tokens[name];
      return st ? st.ids[0] : added.get(name);
    };

    function encodeWord(word) {
      if (added.has(word)) return [added.get(word)];
      const chars = [...(SPACE + String(word).normalize('NFKC'))];
      const n = chars.length;
      const best = new Array(n + 1).fill(-Infinity);
      const from = new Array(n + 1).fill(-1);
      const tok = new Array(n + 1).fill(-1);
      best[0] = 0;
      for (let i = 0; i < n; i++) {
        if (best[i] === -Infinity) continue;
        let piece = '';
        let single = false;
        for (let j = i; j < Math.min(n, i + MAX_PIECE); j++) {
          piece += chars[j];
          const p = pieces.get(piece);
          if (!p) continue;
          if (j === i) single = true;
          const s = best[i] + p.score;
          if (s > best[j + 1]) { best[j + 1] = s; from[j + 1] = i; tok[j + 1] = p.id; }
        }
        if (!single) {
          const s = best[i] + unkScore;
          if (s > best[i + 1]) { best[i + 1] = s; from[i + 1] = i; tok[i + 1] = unkId; }
        }
      }
      const ids = [];
      for (let k = n; k > 0; k = from[k]) ids.push(tok[k]);
      ids.reverse();
      return ids.filter((id, i) => !(id === unkId && ids[i - 1] === unkId));
    }

    return { encodeWord, clsId: special('[CLS]'), sepId: special('[SEP]'), size: model.vocab.length + added.size };
  }

  const WORD_RE = /[\p{L}\p{N}\p{M}_]+(?:[-_][\p{L}\p{N}\p{M}_]+)*|\S/gu;

  function splitWords(text) {
    const words = [];
    WORD_RE.lastIndex = 0;
    let m;
    while ((m = WORD_RE.exec(text))) words.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    return words;
  }

  /* Длинный текст режем на куски по словам с перекрытием, чтобы имя на границе не потерялось. */
  function chunkWords(words, size = 160, overlap = 16) {
    if (words.length <= size) return [{ offset: 0, words }];
    const out = [];
    for (let i = 0; i < words.length; i += size - overlap) {
      out.push({ offset: i, words: words.slice(i, i + size) });
      if (i + size >= words.length) break;
    }
    return out;
  }

  /* Входы модели для одного куска текста, как в GLiNER (span-level, markerV0). */
  function buildInputs(tokenizer, words, labels, maxWidth = 12) {
    const prompt = [];
    for (const l of labels) prompt.push('<<ENT>>', l);
    prompt.push('<<SEP>>');
    const ids = [tokenizer.clsId];
    const wordsMask = [0];
    let w = 1;
    prompt.forEach((p) => { for (const id of tokenizer.encodeWord(p)) { ids.push(id); wordsMask.push(0); } });
    for (const word of words) {
      tokenizer.encodeWord(word.text).forEach((id, k) => { ids.push(id); wordsMask.push(k === 0 ? w++ : 0); });
    }
    ids.push(tokenizer.sepId);
    wordsMask.push(0);
    const L = words.length;
    const spanIdx = new Array(L * maxWidth * 2).fill(0);
    const spanMask = new Array(L * maxWidth).fill(false);
    for (let i = 0; i < L; i++) {
      for (let k = 0; k < maxWidth; k++) {
        const s = i * maxWidth + k;
        if (i + k < L) { spanIdx[2 * s] = i; spanIdx[2 * s + 1] = i + k; spanMask[s] = true; }
      }
    }
    return { ids, wordsMask, length: L, spanIdx, spanMask, maxWidth };
  }

  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  /* logits: [1, L, maxWidth, labels]. Жадный выбор без пересечений, как flat_ner в GLiNER. */
  function decode(logits, words, labels, { maxWidth = 12, threshold = 0.5 } = {}) {
    const L = words.length;
    const C = labels.length;
    const spans = [];
    for (let i = 0; i < L; i++) {
      for (let k = 0; k < maxWidth && i + k < L; k++) {
        for (let c = 0; c < C; c++) {
          const p = sigmoid(logits[(i * maxWidth + k) * C + c]);
          if (p >= threshold) spans.push({ i, j: i + k, label: labels[c], score: p });
        }
      }
    }
    spans.sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const s of spans) if (!chosen.some((c) => s.i <= c.j && c.i <= s.j)) chosen.push(s);
    return chosen
      .sort((a, b) => a.i - b.i)
      .map((s) => ({ label: s.label, start: words[s.i].start, end: words[s.j].end, score: s.score }));
  }

  /* Модель часто принимает названия ИИ-сервисов за имена людей, а в чатах с ИИ они встречаются
     постоянно. Это не персональные данные. */
  const NOT_PERSONS = new Set([
    'chatgpt', 'gpt', 'openai', 'claude', 'anthropic', 'gemini', 'bard', 'google', 'copilot', 'bing',
    'llama', 'meta', 'mistral', 'mixtral', 'grok', 'perplexity', 'deepseek', 'qwen', 'yandexgpt',
    'гигачат', 'gigachat', 'алиса', 'alice', 'siri', 'alexa', 'cortana', 'midjourney', 'dall-e',
    'cursor', 'github', 'velami',
    // Роли и обращения в начале строки («Cliente: Mario Rossi»): модель иногда принимает их за имя.
    'cliente', 'clienti', 'titolare', 'intestatario', 'intestataria', 'contatto', 'utente', 'firmatario', 'firmataria',
    'responsabile', 'referente', 'destinatario', 'mittente', 'richiedente', 'dipendente', 'collaboratore', 'agente',
    'signore', 'signora', 'gentile', 'egregio', 'spettabile', 'dottore', 'dottoressa', 'avvocato',
    'client', 'customer', 'contact', 'user', 'owner', 'holder', 'sender', 'recipient', 'applicant', 'employee', 'dear', 'mister', 'madam',
    'клиент', 'клиентка', 'заявитель', 'получатель', 'отправитель', 'владелец', 'пользователь', 'сотрудник', 'уважаемый', 'уважаемая', 'господин', 'госпожа',
    'самозанятый', 'самозанятая', 'ип', 'ооо', 'жена', 'муж', 'wife', 'husband', 'moglie', 'marito',
  ]);

  /* Организации, которые не нужно скрывать: ИИ-сервисы и программы, о которых спрашивают, и
     государственные органы, которые называют в вопросе о законе или процедуре. Без них ответ модели
     теряет смысл, а чужого секрета в них нет. Названия компаний-клиентов, банков, поставщиков
     скрываются: расширение не знает, какая из них чья. */
  const NOT_ORGS = new Set([
    ...NOT_PERSONS,
    'microsoft', 'apple', 'amazon', 'aws', 'azure', 'adobe', 'oracle', 'ibm', 'nvidia', 'intel', 'amd', 'samsung', 'huawei', 'xiaomi',
    'excel', 'word', 'outlook', 'powerpoint', 'office', 'office 365', 'microsoft 365', 'teams', 'sharepoint', 'onedrive', 'windows', 'macos', 'linux',
    'android', 'ios', 'chrome', 'safari', 'firefox', 'edge', 'gmail', 'google sheets', 'google docs', 'google drive', 'google workspace', 'google maps',
    'youtube', 'facebook', 'instagram', 'whatsapp', 'telegram', 'linkedin', 'twitter', 'x', 'tiktok', 'reddit', 'wikipedia', 'zoom', 'slack', 'notion',
    'dropbox', 'salesforce', 'sap', 'hubspot', 'shopify', 'wordpress', 'stripe', 'paypal', 'visa', 'mastercard', 'amex', 'american express',
    'python', 'javascript', 'typescript', 'java', 'node', 'react', 'docker', 'kubernetes', 'postgres', 'postgresql', 'mysql', 'mongodb', 'redis',
    'openai', 'anthropic', 'deepmind', 'hugging face', 'stability ai', 'midjourney', 'yandex', 'яндекс', 'сбер', 'vk', 'mail.ru', '1с', '1c',
    'битрикс', 'bitrix24', 'амо', 'amocrm', 'мой склад', 'госуслуги', 'эксель', 'ворд', 'amazon web services',
    // Обращения к службам без названия компании: «Dear Customer Support», «Assistenza clienti».
    'customer support', 'customer service', 'support', 'support team', 'help desk', 'helpdesk', 'assistenza', 'assistenza clienti',
    'servizio clienti', 'служба поддержки', 'поддержка', 'техподдержка', 'доставка', 'отдел кадров', 'бухгалтерия',
    'agenzia delle entrate', 'agenzia entrate', 'inps', 'inail', 'istat', 'consob', 'ivass', 'anac', 'garante privacy', 'garante',
    'camera di commercio', 'guardia di finanza', 'carabinieri', 'polizia', 'questura', 'prefettura', 'motorizzazione', 'aci', 'equitalia',
    'agenzia delle entrate-riscossione', 'banca d\'italia', 'bce', 'ue', 'unione europea', 'commissione europea', 'parlamento europeo',
    'stato', 'governo', 'ministero', 'regione', 'provincia', 'comune', 'asl', 'ats', 'ssn', 'sistema sanitario nazionale',
    'фнс', 'ифнс', 'налоговая', 'пфр', 'сфр', 'фсс', 'фомс', 'росстат', 'минфин', 'минтруд', 'минцифры', 'минэкономразвития', 'цб', 'цб рф',
    'центробанк', 'банк россии', 'мфц', 'мвд', 'гибдд', 'фссп', 'фмс', 'роспотребнадзор', 'росреестр', 'роскомнадзор', 'правительство',
    'госдума', 'совет федерации', 'администрация', 'мэрия', 'прокуратура', 'суд', 'арбитражный суд', 'верховный суд', 'конституционный суд',
    'irs', 'hmrc', 'sec', 'fca', 'ftc', 'fbi', 'nhs', 'eu', 'un', 'nato', 'who', 'ecb', 'fed', 'federal reserve', 'european commission',
    'european union', 'european parliament', 'companies house', 'internal revenue service', 'supreme court', 'congress', 'senate', 'parliament',
  ]);
  /* Государственные органы и учреждения, у которых название начинается с типа. `\b` в JS не знает
     кириллицы, поэтому граница слова задана явно; русским основам разрешено окончание до трёх букв
     («Минфине», «министерства», «пенсионный фонд»). */
  const END = '(?=[^\\p{L}\\p{N}]|$)';
  const PUBLIC_ORG = new RegExp('^(?:(?:'
    + 'comune|regione|provincia|città metropolitana|ministero|dipartimento|agenzia (?:delle|del|per|nazionale|regionale|italiana|europea)|tribunale|procura|corte|questura|prefettura|ordine|collegio|università|politecnico|scuola|liceo|istituto comprensivo|ospedale|camera di commercio|ispettorato|ufficio|inps|inail|asl|ats|azienda sanitaria|azienda ospedaliera|guardia di finanza|polizia|carabinieri|direzione|consiglio|parlamento|senato|governo|presidenza'
    + '|irs|hmrc|sec|fca|nhs|fbi|un|eu|nato|who|european|companies house|internal revenue|department of|ministry of|office of|city of|state of|county of|university of|court|supreme court|police|government|parliament|congress|senate|house of|bureau of|school|hospital'
    + ')' + END + '|(?:'
    + 'фнс|ифнс|мифнс|уфнс|пфр|сфр|фсс|мвд|умвд|гу мвд|гибдд|фссп|цб|минфин|мин(?:труд|цифры|экономразвития|здрав|обр|юст|транс|сельхоз|промторг|строй|природы|культуры|спорта|энерго|обороны|просвещения)|министерств|правительств|администраци|мэри|арбитражн|суд|прокуратур|росреестр|роспотребнадзор|роскомнадзор|госуслуг|мфц|департамент|управлени|комитет|инспекци|пенсионн|налогов|федеральн|государственн|городск|областн|районн|муниципальн|школ|гимнази|лице|детск|поликлиник|больниц|университет'
    + ')\\p{Ll}{0,3}' + END + ')', 'iu');

  /* Артикли и притяжательные слова перед названием («Il Comune di Milano», «our office»). */
  const ORG_LEAD = /^(?:the|il|la|lo|l'|gli|le|i|our|your|their|my|his|her|its|il nostro|la nostra|il vostro|la vostra|nostro|nostra|vostro|vostra|наш|наша|наше|нашу|нашей|нашего|ваш|ваша|ваше|вашу|вашей|вашего|их|его|её) /iu;
  /* Одна организационно-правовая форма без названия: модель иногда отдаёт только её. */
  const LEGAL_ONLY = /^(?:ооо|оао|зао|пао|ао|ип|нко|ано|тоо|тов|s\.?r\.?l|s\.?p\.?a|s\.?a\.?s|s\.?n\.?c|s\.?s|srls|ltd|llc|inc|corp|plc|gmbh|ag|kg|sa|sarl|bv|nv|oy|ab|as|aps|spa|srl|sas|snc)\.?$/iu;

  const orgKey = (value) => value.toLowerCase().replace(/[«»"„“”']/g, '').replace(/\s+/g, ' ').trim();
  /* Есть ли ключ в стоп-листе, с учётом русских окончаний («Яндексе», «Сбером»). */
  function orgStopped(key) {
    if (NOT_ORGS.has(key)) return true;
    if (!/[а-яё]$/u.test(key)) return false;
    for (let cut = 1; cut <= 3 && key.length - cut >= 3; cut++) if (NOT_ORGS.has(key.slice(0, -cut))) return true;
    return false;
  }

  function accept(entity, text) {
    const value = text.slice(entity.start, entity.end).trim();
    if (value.length < 2 || !/\p{L}/u.test(value)) return null;
    if (/\[\[|\]\]/.test(value)) return null;
    const words = value.toLowerCase().split(/[\s,.&/]+/).filter((w) => w.length > 3 || NOT_PERSONS.has(w));
    if (entity.label === 'person' && words.length && words.every((w) => NOT_PERSONS.has(w) || /^(gpt|claude|gemini|llama)[-\d.]/.test(w))) return null;
    if (entity.label === 'organization') {
      const key = orgKey(value).replace(ORG_LEAD, '');
      if (!key || orgStopped(key) || PUBLIC_ORG.test(key) || LEGAL_ONLY.test(key)) return null;
      const orgWords = key.split(/[\s,.&/-]+/).filter(Boolean);
      if (orgWords.every((w) => orgStopped(w) || /^(gpt|claude|gemini|llama)[-\d.]/.test(w))) return null;
      /* Название пишут с заглавной буквы. Нарицательное («банк», «our office», «пункт выдачи»)
         моделью принимается за организацию, но скрывать там нечего. */
      const lead = value.replace(/^[«"„“'(\s]+/u, '').replace(ORG_LEAD, '');
      if (!/^[\p{Lu}\p{N}]/u.test(lead) && !/^\p{Ll}+\p{Lu}/u.test(lead)) return null;
    }
    return value;
  }

  /* Весь текст: куски по словам, модель на каждый кусок (run(words) → сущности с абсолютными
     смещениями), на перекрытиях остаётся более уверенная находка. cache: Map или null. */
  async function recognize(text, run, cache = null, cacheLimit = 300) {
    const found = [];
    for (const chunk of chunkWords(splitWords(text))) {
      const first = chunk.words[0].start;
      const key = text.slice(first, chunk.words[chunk.words.length - 1].end);
      let rel = cache && cache.get(key);
      if (rel) {
        cache.delete(key);
      } else {
        rel = (await run(chunk.words)).map((e) => ({ ...e, start: e.start - first, end: e.end - first }));
      }
      if (cache) {
        cache.set(key, rel);
        if (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
      }
      for (const e of rel) found.push({ ...e, start: e.start + first, end: e.end + first });
    }
    found.sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const e of found) if (!chosen.some((c) => e.start < c.end && c.start < e.end)) chosen.push(e);
    return chosen
      .sort((a, b) => a.start - b.start)
      .map((e) => ({ label: e.label, start: e.start, end: e.end, score: e.score, value: accept(e, text) }))
      .filter((e) => e.value);
  }

  return { createTokenizer, splitWords, chunkWords, buildInputs, decode, accept, recognize, NOT_PERSONS, NOT_ORGS };
});
