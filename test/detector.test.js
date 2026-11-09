const test = require('node:test');
const assert = require('node:assert/strict');
const PG = require('../src/detector.js');
const walk = require('../src/json-walk.js');

const types = (text, opts) => PG.detect(text, opts).map((f) => `${f.type}:${f.value}`);

test('контрольные суммы', () => {
  const c = PG.checks;
  assert.ok(c.luhn('4111111111111111'));
  assert.ok(!c.luhn('4111111111111112'));
  assert.ok(c.ibanValid('IT60X0542811101000000123456'));
  assert.ok(c.ibanValid('DE89370400440532013000'));
  assert.ok(c.ibanValid('GB82WEST12345698765432'));
  assert.ok(!c.ibanValid('IT61X0542811101000000123456'));
  assert.ok(c.cfValid('RSSMRA85T10A562S'));
  assert.ok(!c.cfValid('RSSMRA85T10A562T'));
  assert.ok(c.pivaValid('12345678903'));
  assert.ok(!c.pivaValid('12345678904'));
  assert.ok(c.innValid('7707083893'));
  assert.ok(c.innValid('500100732259'));
  assert.ok(!c.innValid('7707083894'));
  assert.ok(c.snilsValid('11223344595'));
  assert.ok(!c.snilsValid('11223344596'));
});

test('находит типовые данные', () => {
  const found = types([
    'mail: Maria.Rossi@example.com, tel +39 333 123 4567, моб. 8 (916) 123-45-67',
    'карта 4111 1111 1111 1111, IBAN IT60 X054 2811 1010 0000 0123 456',
    'CF RSSMRA85T10A562S, P.IVA 12345678903, ИНН 7707083893, СНИЛС 112-233-445 95',
    'паспорт 4510 123456, сервер 10.0.12.7',
    'ключ sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z и password: Hunter2!x',
  ].join('\n'));
  for (const expected of [
    'EMAIL:Maria.Rossi@example.com', 'PHONE:+39 333 123 4567', 'PHONE:8 (916) 123-45-67',
    'CARD:4111 1111 1111 1111', 'IBAN:IT60 X054 2811 1010 0000 0123 456',
    'CF:RSSMRA85T10A562S', 'PIVA:12345678903', 'INN:7707083893', 'SNILS:112-233-445 95',
    'PASSPORT:4510 123456', 'IP:10.0.12.7',
    'SECRET:sk-proj-Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z', 'SECRET:Hunter2!x',
  ]) assert.ok(found.includes(expected), `нет ${expected} в ${JSON.stringify(found)}`);
});

test('не трогает обычные числа и даты', () => {
  const found = types('Заказ 1234567890123456 от 2026-11-09 на 1 250,00 €, версия 2.4.1, 11 цифр 12345678903 без контекста, ИНН не указан 7707083893?');
  assert.deepEqual(found.filter((f) => !f.startsWith('INN')), []);
});

test('IBAN обрезается по контрольной сумме и не съедает соседний', () => {
  const found = types('IBAN DE89 3704 0044 0532 0130 00 BIC COBADEFFXXX e IT60X0542811101000000123456 ok');
  assert.deepEqual(found, ['IBAN:DE89 3704 0044 0532 0130 00', 'IBAN:IT60X0542811101000000123456']);
});

test('словарь: падежи для русских слов, регистр для латиницы', () => {
  const dictionary = [{ term: 'Петров', type: 'PERSON' }, { term: 'Mario Rossi', type: 'PERSON' }, { term: 'Иван', type: 'PERSON' }];
  const found = types('Пишу Петрову и Петровой, а не Петровскому. MARIO  ROSSI в копии. Иванов не Иван.', { dictionary });
  assert.deepEqual(found, ['PERSON:Петрову', 'PERSON:Петровой', 'PERSON:MARIO  ROSSI', 'PERSON:Иван']);
});

test('маскирование: одинаковые значения дают одну метку, вся цепочка обратима', () => {
  const vault = new PG.Vault();
  const text = 'Напиши a@b.it и копию на A@B.IT, второй адрес c@d.it, карта 4111-1111-1111-1111';
  const r = PG.maskText(text, { vault, commit: true });
  assert.equal(r.text, 'Напиши [[EMAIL_1]] и копию на [[EMAIL_1]], второй адрес [[EMAIL_2]], карта [[CARD_1]]');
  const again = PG.maskText('ещё раз c@d.it и новый e@f.it', { vault, commit: true });
  assert.equal(again.text, 'ещё раз [[EMAIL_2]] и новый [[EMAIL_3]]');
  const back = PG.rehydrate('Ответ для [[EMAIL_2]], [[ EMAIL 1 ]] и [[CARD_1]], [[EMAIL_9]] не знаем', vault.data.byToken);
  assert.equal(back.text, 'Ответ для c@d.it, a@b.it и 4111-1111-1111-1111, [[EMAIL_9]] не знаем');
  assert.equal(back.spans.length, 3);
});

test('предпросмотр без commit не меняет хранилище и нумерует новые значения по порядку', () => {
  const vault = new PG.Vault();
  const r = PG.maskText('x@y.it и z@y.it', { vault, commit: false });
  assert.equal(r.text, '[[EMAIL_1]] и [[EMAIL_2]]');
  assert.equal(vault.size, 0);
});

test('исключения и уже готовые метки', () => {
  const vault = new PG.Vault();
  const r = PG.maskText('a@b.it и c@d.it', { vault, exclusions: ['EMAIL:a@b.it'], commit: true });
  assert.equal(r.text, 'a@b.it и [[EMAIL_1]]');
  const twice = PG.maskText(r.text, { vault, exclusions: ['EMAIL:a@b.it'], commit: true });
  assert.equal(twice.text, r.text);
});

test('словарная метка раскрывается в каноническую форму', () => {
  const vault = new PG.Vault();
  const dictionary = [{ term: 'Петров', type: 'PERSON' }];
  const r = PG.maskText('Позвони Петрову', { vault, dictionary, commit: true });
  assert.equal(r.text, 'Позвони [[PERSON_1]]');
  assert.equal(PG.rehydrate(r.text, vault.data.byToken).text, 'Позвони Петров');
});

test('сторож: ищет только значения из набранного текста', () => {
  const candidates = PG.candidatesFrom(['мой адрес a@b.it']);
  assert.equal(PG.findLeaks('{"q":"привет","n":"4111111111111111"}', { candidates }).leak, false);
  assert.deepEqual(PG.findLeaks('{"typed":"мой адрес A@B.IT"}', { candidates }).types, ['EMAIL']);
  const excluded = PG.candidatesFrom(['a@b.it'], { exclusions: ['EMAIL:a@b.it'] });
  assert.equal(PG.findLeaks('a@b.it', { candidates: excluded }).leak, false);
});

test('известные значения: буквально, в URL-кодировке, по границам слов, не трогая токены', () => {
  const vault = new PG.Vault();
  const typed = 'Я Мария Петрова, почта m.p@example.com, карта 4111 1111 1111 1111';
  const dictionary = [{ term: 'Мария Петрова', type: 'PERSON' }];
  const candidates = PG.candidatesFrom([typed], { dictionary });
  const form = 'prompt=' + encodeURIComponent(typed).replace(/%20/g, '+') + '&token=gAAA4111111111111111xyz&n=Марияшка';
  const r = PG.maskKnown(form, { vault, candidates, commit: true });
  assert.ok(!r.text.includes(encodeURIComponent('m.p@example.com')), r.text);
  assert.ok(r.text.includes(encodeURIComponent('[[EMAIL_1]]')));
  assert.ok(r.text.includes(encodeURIComponent('[[CARD_1]]')));
  assert.ok(r.text.includes(encodeURIComponent('[[PERSON_1]]')));
  assert.ok(r.text.endsWith('&token=gAAA4111111111111111xyz&n=Марияшка'), r.text);
  const json = PG.maskKnown('{"t":"' + typed + '"}', { vault, candidates, commit: true });
  assert.equal(json.text, '{"t":"Я [[PERSON_1]], почта [[EMAIL_1]], карта [[CARD_1]]"}');
});

test('служебные base64-токены не принимаются за IBAN и карты', () => {
  const token = 'gAAAAABq8X-lLZR41tnIOD_mOYqo5icZntaX5K9nVIsHvXZro4eiJ2mETPYHKHz00VJcwM4XThtaXZSjaTm8DbSvYfiwzLg2JB0k1g7nXWqzThHjdXU8VkX92QdGfTO7WUQA';
  assert.deepEqual(types(token + ' DE89370400440532013000x-' + 'a_4111111111111111 v1.4111111111111111.2'), []);
});

test('обход JSON пропускает идентификаторы и служебные поля', () => {
  const body = {
    action: 'next',
    conversation_id: '9b1c-4111111111111111',
    messages: [{ id: 'abc', author: { role: 'user' }, content: { content_type: 'text', parts: ['почта a@b.it'] } }],
    model: 'gpt-x',
  };
  const refs = walk.collect(body);
  assert.deepEqual(refs.map((r) => r.holder[r.k]), ['почта a@b.it']);
  assert.ok(walk.isUserText(refs[0]));
});

test('адреса с типом улицы и номером дома, на трёх языках', () => {
  const addr = (t) => PG.detect(t).filter((f) => f.type === 'ADDRESS').map((f) => f.value);
  assert.deepEqual(addr('Адрес: 620014, г. Екатеринбург, ул. Малышева, д. 51, кв. 17. Звоните.'), ['620014, г. Екатеринбург, ул. Малышева, д. 51, кв. 17']);
  assert.deepEqual(addr('Санкт-Петербург, Невский проспект, 28, кв. 5.'), ['Санкт-Петербург, Невский проспект, 28, кв. 5']);
  assert.deepEqual(addr('Giulia abita in Via Indipendenza 18, 40121 Bologna, interno 6.'), ['Via Indipendenza 18, 40121 Bologna, interno 6']);
  assert.deepEqual(addr('Spedire a Corso Vittorio Emanuele II 45, 20122 Milano (MI).'), ['Corso Vittorio Emanuele II 45, 20122 Milano (MI)']);
  assert.deepEqual(addr('Ship to 1420 Maple Avenue, Apt 3B, Springfield, IL 62704.'), ['1420 Maple Avenue, Apt 3B, Springfield, IL 62704']);
  assert.deepEqual(addr('He lives at 221B Baker Street, London NW1 6XE.'), ['221B Baker Street, London NW1 6XE']);
  for (const t of [
    'В 2024 году улица стала шире, дом 5 этажей.',
    'Ho pagato via bonifico 300 euro.',
    'Il corso di 12 ore inizia lunedì.',
    'Collegato via USB 2 e via Vercel Dashboard',
    'via SumSub.\n4. Verifica',
    'Read chapter 12 Main Points today.',
  ]) assert.deepEqual(addr(t), [], t);
});

test('варианты имени из находки модели: отчество и инициалы, без одной фамилии', () => {
  assert.deepEqual(PG.nameVariants('Олег Викторович Мельников'), ['Олег Викторович', 'О. В. Мельников', 'О.В. Мельников', 'Мельников О. В.', 'Мельников О.В.']);
  assert.deepEqual(PG.nameVariants('Тихонов Максим Игоревич').slice(0, 2), ['Максим Игоревич', 'М. И. Тихонов']);
  assert.deepEqual(PG.nameVariants('Francesca Moretti'), ['F. Moretti']);
  assert.deepEqual(PG.nameVariants('Ахмед'), []);
  assert.deepEqual(PG.nameVariants('К. А. Белов'), []);
  assert.deepEqual(PG.nameVariants('Иван Петров Сидоров'), []);
});

test('находка модели в косвенном падеже ловит другие падежи', () => {
  const found = 'Ивану Сергеевичу Кузнецову';
  const auto = [found, ...PG.nameVariants(found)].map((term) => ({ term, type: 'PERSON', score: 0.9 }));
  assert.deepEqual(
    types('Иван Сергеевич Кузнецов пришёл. Кузнецов И. С. подписал. Иван Сергеевич ушёл.', { auto }),
    ['PERSON:Иван Сергеевич Кузнецов', 'PERSON:Кузнецов И. С.', 'PERSON:Иван Сергеевич'],
  );
  const inflected = [{ term: 'Анне Мироновой', type: 'PERSON', score: 0.9 }];
  assert.deepEqual(types('Анна Миронова', { auto: inflected }), ['PERSON:Анна Миронова']);
  assert.deepEqual(types('Анна Миронова', { dictionary: inflected }), []);
});

test('русские ФИО по отчеству и инициалам, без глагола в начале предложения', () => {
  const people = (t) => PG.detect(t).filter((f) => f.type === 'PERSON').map((f) => f.value);
  assert.deepEqual(people('Передай Ахмедову Руслану Тимуровичу привет. Подпись: Ахмедов Р. Т.'), ['Ахмедову Руслану Тимуровичу', 'Ахмедов Р. Т.']);
  assert.deepEqual(people('Передай Руслану Тимуровичу привет.'), ['Руслану Тимуровичу']);
  assert.deepEqual(people('Спасибо, Елена Петровна! Ольга Ильинична тоже придёт.'), ['Елена Петровна', 'Ольга Ильинична']);
  assert.deepEqual(people('Передал И. О. Петрову бумаги, Шевчук А. В. подписал.'), ['И. О. Петрову', 'Шевчук А. В.']);
  for (const t of ['Москва и Санкт-Петербург, Россия.', 'См. гл. 5, Т. 2 издания.', 'США и ЕС подписали.']) assert.deepEqual(people(t), [], t);
});

test('дата рождения, госномер, полис ОМС, документы: только по формату и контексту', () => {
  const kinds = (t) => PG.detect(t).map((f) => `${f.type}:${f.value}`);
  assert.deepEqual(kinds('Дата рождения: 12.03.1985, город Москва.'), ['DOB:12.03.1985']);
  assert.deepEqual(kinds('Родился 5 марта 1990 г. в Казани.'), ['DOB:5 марта 1990 г.']);
  assert.deepEqual(kinds('Nato a Roma il 12/03/1985.'), ['DOB:12/03/1985']);
  assert.deepEqual(kinds('Date of birth: March 12, 1985'), ['DOB:March 12, 1985']);
  assert.deepEqual(kinds('Встреча 12.03.2026 в 10:00, дедлайн 15.04.2026.'), []);
  assert.deepEqual(kinds('Дата рождения 31.02.2090'), []);
  assert.deepEqual(kinds('Моя машина А123ВС77.'), ['PLATE:А123ВС77']);
  assert.deepEqual(kinds('La mia auto targata AB 123 CD'), ['PLATE:AB 123 CD']);
  assert.deepEqual(kinds('Codice prodotto AB123CD in magazzino'), []);
  assert.deepEqual(kinds('Полис ОМС 1234 5678 9012 3456'), ['OMS:1234 5678 9012 3456']);
  assert.deepEqual(kinds('Carta d’identità CA12345AB'), ['IDDOC:CA12345AB']);
  assert.deepEqual(kinds('passaporto YA1234567, загранпаспорт 75 1234567'), ['PASSPORT:YA1234567', 'PASSPORT:75 1234567']);
  assert.deepEqual(kinds('Ordine n. AB12345CD spedito'), []);
  const a = PG.detect('госномер А123ВС77')[0];
  const b = PG.detect('госномер A123BC77')[0];
  assert.equal(a.id, b.id, 'кириллица и латиница в госномере дают одну метку');
});
