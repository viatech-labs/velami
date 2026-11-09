// Сцена для демо-ролика и брошюры: копия страницы чата на chatgpt.com (запросы перехватывает
// puppeteer, в сеть ничего не уходит), ответ ИИ из меток и курсор для видео. Все данные выдуманы.

export const STRINGS = {
  ru: {
    title: 'Чат с ИИ',
    note: 'тестовая копия страницы, данные выдуманы',
    ask: 'Спросите что-нибудь',
    attach: 'Прикрепить файл',
    fileSeen: 'Сайт получил файл',
    message: 'Помоги написать письмо в банк. Меня зовут Анна Сергеевна Миронова, живу по адресу '
      + 'Санкт-Петербург, Невский проспект, 28, кв. 5. Карта 4111 1111 1111 1111 пропала, почта anna.mironova@example.com.',
    secrets: ['Анна Сергеевна Миронова', 'Невский проспект, 28', '4111 1111 1111 1111', 'anna.mironova@example.com'],
    hoverValue: 'anna.mironova@example.com',
    reply: ({ PERSON, ADDRESS, CARD, EMAIL }) => [
      'Конечно. Вот черновик письма:',
      '',
      'Уважаемая служба поддержки!',
      `Я, ${PERSON}, сообщаю о пропаже банковской карты ${CARD}. Прошу заблокировать её и выпустить новую.`,
      `Новую карту прошу доставить по адресу: ${ADDRESS}.`,
      `Ответ прошу направить на ${EMAIL}.`,
      '',
      `С уважением, ${PERSON}`,
    ].join('\n'),
    file: { name: 'клиенты.csv', text: 'имя;почта;телефон\nМария Петрова;maria.petrova@example.com;+7 916 123-45-67\nключ API sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd\n' },
    dictTerm: 'Северный Ветер',
  },
  it: {
    title: 'Chat con l’IA',
    note: 'copia di prova della pagina, dati inventati',
    ask: 'Chiedi qualsiasi cosa',
    attach: 'Allega un file',
    fileSeen: 'Il sito ha ricevuto il file',
    message: 'Aiutami a scrivere una mail alla banca. Mi chiamo Mario Rossi, abito in via Garibaldi 12, Milano. '
      + 'Ho perso la carta 4111 1111 1111 1111. Il mio IBAN è IT60 X054 2811 1010 0000 0123 456 e la mia mail è mario.rossi@example.com.',
    secrets: ['Mario Rossi', 'via Garibaldi 12', '4111 1111 1111 1111', 'IT60 X054 2811 1010 0000 0123 456', 'mario.rossi@example.com'],
    hoverValue: 'mario.rossi@example.com',
    reply: ({ PERSON, ADDRESS, CARD, IBAN, EMAIL }) => [
      'Certo. Ecco una bozza:',
      '',
      'Gentile servizio clienti,',
      `sono ${PERSON} e vi scrivo per segnalare lo smarrimento della carta ${CARD}. Vi chiedo di bloccarla e di emetterne una nuova.`,
      `Potete inviare la nuova carta al mio indirizzo, ${ADDRESS}. Il conto collegato è ${IBAN}.`,
      `Per la risposta potete scrivermi a ${EMAIL}.`,
      '',
      `Cordiali saluti, ${PERSON}`,
    ].join('\n'),
    file: { name: 'clienti.csv', text: 'nome;email;iban\nGiulia Bianchi;giulia.bianchi@example.com;IT60 X054 2811 1010 0000 0123 456\nchiave API sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd\n' },
    dictTerm: 'Ferrari Logistica',
  },
  en: {
    title: 'AI chat',
    note: 'test copy of the page, made-up data',
    ask: 'Ask anything',
    attach: 'Attach a file',
    fileSeen: 'The site received the file',
    message: 'Help me write an email to my bank. My name is John Carter, I live at 221 Baker Street, London. '
      + 'I lost my card 4111 1111 1111 1111. My IBAN is GB82 WEST 1234 5698 7654 32 and my email is john.carter@example.com.',
    secrets: ['John Carter', '221 Baker Street', '4111 1111 1111 1111', 'GB82 WEST 1234 5698 7654 32', 'john.carter@example.com'],
    hoverValue: 'john.carter@example.com',
    reply: ({ PERSON, ADDRESS, CARD, IBAN, EMAIL }) => [
      'Sure. Here is a draft:',
      '',
      'Dear customer service,',
      `my name is ${PERSON} and I am writing to report the loss of my card ${CARD}. Please block it and issue a new one.`,
      `You can send the new card to my address, ${ADDRESS}. The linked account is ${IBAN}.`,
      `You can reply to ${EMAIL}.`,
      '',
      `Kind regards, ${PERSON}`,
    ].join('\n'),
    file: { name: 'clients.csv', text: 'name;email;iban\nEmily Watson;emily.watson@example.com;GB82 WEST 1234 5698 7654 32\nAPI key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd\n' },
    dictTerm: 'Northwind Logistics',
  },
};

export function chatPage(lang) {
  const s = STRINGS[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${s.title}</title><style>
*{box-sizing:border-box}body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;color:#1d1d1f;background:#fff;-webkit-font-smoothing:antialiased}
header{height:56px;display:flex;align-items:center;gap:10px;padding:0 40px;border-bottom:1px solid #f0f0f2;font-weight:600}
header small{font-weight:400;color:#86868b}
main{width:800px;margin-left:40px;padding:24px 0 200px}
.msg{margin:0 0 18px;padding:12px 16px;border-radius:18px;white-space:pre-wrap}
.user{background:#f2f2f7;margin-left:120px}.bot{border:1px solid #ececf0}
.file{margin-left:120px;border:1px dashed #c7c7cc;font:13px/1.6 ui-monospace,"SF Mono",Menlo,monospace}
.file b{display:block;font:600 12px -apple-system,BlinkMacSystemFont,sans-serif;color:#86868b;margin-bottom:4px}
.composer{position:fixed;left:40px;bottom:28px;width:800px;display:flex;gap:10px;align-items:flex-end;padding:12px;border:1px solid #d2d2d7;border-radius:26px;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.06)}
#prompt-textarea{flex:1;min-height:52px;max-height:200px;overflow:auto;outline:none;padding:4px 8px}
#prompt-textarea:empty:before{content:"${s.ask}";color:#aeaeb2}
.attach{display:grid;place-items:center;width:40px;height:40px;border-radius:50%;background:#f2f2f7;color:#1d1d1f;font-size:22px;cursor:pointer}
#send{width:40px;height:40px;border:0;border-radius:50%;background:#1d1d1f;color:#fff;font-size:20px;cursor:pointer}
</style></head><body>
<header>${s.title} <small>${s.note}</small></header>
<main id="thread"></main>
<div class="composer"><label class="attach" title="${s.attach}">+<input type="file" id="file" hidden></label><div id="prompt-textarea" contenteditable="true"></div><button id="send" data-testid="send-button" aria-label="Send">↑</button></div>
<script>
const add = (cls, t, title) => { const d = document.createElement('div'); d.className = 'msg ' + cls; if (title) { const b = document.createElement('b'); b.textContent = title; d.append(b); } d.append(t); document.getElementById('thread').append(d); return d; };
document.getElementById('file').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await f.text();
  add('file', text, '${s.fileSeen} «' + f.name + '»');
  await fetch('/backend-api/files', { method: 'PUT', body: f });
};
document.getElementById('send').onclick = async () => {
  const ed = document.getElementById('prompt-textarea');
  const text = ed.innerText.trim(); if (!text) return;
  ed.textContent = '';
  add('user', text);
  const r = await fetch('/backend-api/f/conversation', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'next', model: 'demo', messages: [{ author: { role: 'user' }, content: { content_type: 'text', parts: [text] } }] }) });
  add('bot', await r.text());
};
</script></body></html>`;
}

export function reply(lang, prompt) {
  const label = (type) => (prompt.match(new RegExp('\\[\\[' + type + '_\\d+\\]\\]')) || [''])[0];
  const labels = Object.fromEntries(['PERSON', 'ADDRESS', 'CARD', 'IBAN', 'EMAIL'].map((t) => [t, label(t)]));
  return STRINGS[lang].reply(labels);
}

// Перехват запросов страницы чата. sent.prompt и sent.file — то, что реально ушло бы на сервер.
export async function serveChat(page, lang) {
  const sent = { prompt: null, file: null };
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const url = req.url();
    if (url === 'https://chatgpt.com/') return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: chatPage(lang) });
    if (url === 'https://chatgpt.com/backend-api/f/conversation') {
      sent.prompt = JSON.parse(req.postData()).messages[0].content.parts[0];
      return req.respond({ status: 200, contentType: 'text/plain; charset=utf-8', body: reply(lang, sent.prompt) });
    }
    if (url === 'https://chatgpt.com/backend-api/files') {
      sent.file = req.postData() ?? (await req.fetchPostData().catch(() => null));
      return req.respond({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    return req.abort();
  });
  return sent;
}

export const CURSOR = `(() => {
  const init = () => {
    if (document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11-7 1-4 7z" fill="#1d1d1f" stroke="#fff" stroke-width="1.5"/></svg>';
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform .03s linear';
    document.documentElement.append(c);
    addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:28px;height:28px;border-radius:50%;background:rgba(201,100,66,.3);left:' + (e.clientX - 14) + 'px;top:' + (e.clientY - 14) + 'px;transition:transform .4s,opacity .4s';
      document.documentElement.append(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(2.2)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 450);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();`;

export const MARK_SVG = (size) => `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="vgm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#df8462"/><stop offset="1" stop-color="#bd5a38"/></linearGradient></defs><rect width="32" height="32" rx="7.2" fill="url(#vgm)"/><rect x="8" y="9" width="11" height="2.6" rx="1.3" fill="#fff" fill-opacity=".72"/><rect x="8" y="14.3" width="16" height="4.4" rx="2.2" fill="#fff"/><rect x="8" y="21.4" width="8" height="2.6" rx="1.3" fill="#fff" fill-opacity=".72"/></svg>`;
