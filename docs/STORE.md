# Chrome Web Store listing

Texts for the Developer Dashboard form. The form is filled in English, the store listing is
localized in EN, IT and RU.

## Build and check the package

```sh
npm test && npm run e2e
npm run build                          # dist/velami-<version>.zip, .zip.sha256, .files.json
PG_EXT_DIR=<unpacked zip> npm run e2e  # the same e2e on the built package
```

Upload `dist/velami-<version>.zip` to the Dashboard. The SHA-256 of the zip and `.files.json` are
published with each GitHub release. After publication, compare the copy installed from the store
with `npm run verify -- "<extension folder>" --list dist/velami-<version>.files.json`. The store
adds `update_url` to the manifest and a `_metadata/` folder, the check allows for both.

## Publisher

Publisher: **Via-Tech**. Website: https://via-tech.org. Support and privacy contact: info@via-tech.org.
Source code: https://github.com/viatech-labs/velami (AGPL-3.0). The same details are in the
manifest (`author`, `homepage_url`), in `PRIVACY.md`, on the extension's settings page and in the
brochures and videos.

## Single purpose

Protects personal data in AI chats: before a message or a text file is sent to an AI chat (ChatGPT,
Claude, Gemini, Perplexity, and Copilot, DeepSeek, Mistral Le Chat and Grok when the user turns them on),
the extension replaces personal data with labels, then shows the real values in the answer locally,
and lets the user see exactly what was sent.

## Permission justifications

**storage.** Keeps the user's settings, personal dictionary, the label vault (label to real value,
needed to show answers with real values) and the local log of checked requests. All on the device.
It also reads an optional organization policy from chrome.storage.managed (schema
`managed-schema.json`), set by the user's administrator through Chrome policy. Read only, never sent.

**unlimitedStorage.** The log keeps the exact body of up to 300 checked requests (up to 20,000
characters each) so the user can verify what left the computer. Together with the label vault this
can exceed the default 10 MB quota. Nothing is uploaded anywhere.

**Host permission https://chatgpt.com/\*, https://chat.openai.com/\*, https://claude.ai/\*,
https://gemini.google.com/\*, https://www.perplexity.ai/\*, https://perplexity.ai/\*.** The
extension must run on the chat pages to find personal data in the outgoing request before the page
sends it, to show the user the preview panel, and to put the real values back into the answer. It
does not run on any other site.

**Optional host permission https://copilot.microsoft.com/\*, https://copilot.com/\*,
https://chat.deepseek.com/\*, https://chat.mistral.ai/\*, https://grok.com/\*.** Requested only
when the user turns one of these chats on in the extension's settings, one site at a time. Turning
the site off removes the permission.

**scripting.** Registers the same content scripts on an optional chat after the user has turned it
on and granted the permission (chrome.scripting.registerContentScripts). No code is injected from
outside the package.

**offscreen.** Runs the bundled name and address recognition model (onnxruntime-web, WebAssembly)
reads the text of attached PDF and Office files (bundled pdf.js) and the text on attached images (bundled Tesseract) in an offscreen document, because a service worker cannot run WebAssembly threads. The document is
created on the first check, answers only the extension's own background process, has no network
access beyond the extension's files (CSP), and closes itself after 5 minutes without work.

**Cross-origin isolation (COOP same-origin, COEP require-corp).** Needed for WebAssembly threads,
so a short check takes about 150 to 250 ms instead of about 450 ms on one thread. It applies only to the extension's
own pages.

**Content script in the MAIN world (page-hook.js).** Only a script in the page context can see and
modify the requests the chat page makes with fetch, XMLHttpRequest and sendBeacon. The script holds
no data: it sends the request text to the isolated content script for masking and has no way to read
the label vault.

**Remote code.** No. All code is in the package. The extension's own code is not minified. The
bundled onnxruntime-web 1.31.1 (MIT), pdf.js 6.5.438 (Apache-2.0) and Tesseract.js 7.0.0 with its core (Apache-2.0) are the unmodified upstream builds, and the model files and Tesseract language data (tessdata_best, Apache-2.0) are data
with SHA-256 recorded in `tools/model/model.lock.json`. Labels on covered images are drawn with the bundled IBM Plex Mono font (OFL-1.1). The extension pages CSP is
`script-src 'self' 'wasm-unsafe-eval'` (WebAssembly from the package only) and
`connect-src 'self' https://httpbin.org`.

**Package size.** About 198 MB, of which 166 MB is the recognition model, 15 MB the WebAssembly
runtime, 12 MB Tesseract with Italian, English and Russian language data and 3 MB pdf.js with its character maps. See `docs/MODEL.md`.

## Data usage (Privacy practices)

The extension processes on the device: personally identifiable information, financial and payment
information, authentication information (keys and passwords the user pastes), personal
communications (chat text), website content (the outgoing request and the answer on the chat page).
None of it is collected by or transmitted to the developer, sold, or used for any purpose other than
the single purpose above.

Tick these five data types. The Web Store User Data FAQ (question 3) requires disclosure even when
data is only processed or stored on the device. The one network call the extension makes itself is
the user-started self-test to httpbin.org with a sample text that already contains labels.

Certifications to tick: data is not sold to third parties; not used or transferred for purposes
unrelated to the single purpose; not used to determine creditworthiness or for lending.

Privacy policy URL: https://velami.pro/privacy

## Store listing

Category: Make Chrome Yours → Privacy & Security.

**EN · Velami: private chats with AI**

Short description: Hides personal data before it is sent to ChatGPT, Claude, Gemini and Perplexity and
shows exactly what left. Works locally, no servers of its own.

Description:

Write to ChatGPT, Claude, Gemini and Perplexity as usual. Copilot, DeepSeek, Mistral Le Chat
and Grok can be turned on in the settings. Before a message leaves your computer, Velami finds
card numbers, IBANs, tax codes, ID documents, dates of birth, licence plates, phone numbers, e-mails and API keys, recognises names and addresses
with a model that runs on your computer, and replaces them with labels like [[EMAIL_1]]. The model answers with labels, you see the answer with
the real values. Text files you attach are cleaned the same way, Word, Excel and PowerPoint go as the same document with labels, PDF as a text copy with labels, images as the same image with the data covered, and the Copy button gives you the
real values.

You do not have to trust us. A panel next to the chat shows the exact text the model will get. The
log keeps every request as it was sent, with its SHA-256, so you can compare it with DevTools. “Test
it yourself” sends a sample to an independent echo server and shows what arrived. If a message ever
leaves without passing through Velami, the button turns red.

No servers, no accounts, no analytics. Everything stays on this computer. The source code is open
(AGPL-3.0): github.com/viatech-labs/velami

**IT · Velami: chat private con l’IA**

Short description: Nasconde i dati personali prima dell'invio a ChatGPT, Claude, Gemini e Perplexity
e mostra cosa è uscito. Funziona in locale, senza server propri.

Description:

Scrivi a ChatGPT, Claude, Gemini e Perplexity come sempre. Copilot, DeepSeek, Mistral Le Chat
e Grok si attivano nelle impostazioni. Prima che un messaggio lasci il tuo computer, Velami
trova numeri di carta, IBAN, codici fiscali, documenti, date di nascita, targhe, telefoni, e-mail e chiavi API, riconosce nomi e
indirizzi con un modello che gira sul tuo computer, e li sostituisce con etichette come [[EMAIL_1]]. Il modello risponde con le etichette, tu vedi la
risposta con i valori reali. Anche i file di testo che alleghi vengono ripuliti, Word, Excel e PowerPoint partono come lo stesso documento con le etichette, i PDF come copia di testo, le immagini come la stessa immagine con i dati coperti, e il pulsante Copia
ti dà i valori reali.

Non devi fidarti di noi. Un pannello accanto alla chat mostra il testo esatto che riceverà il
modello. Il registro conserva ogni richiesta così come è partita, con il suo SHA-256, da confrontare
con DevTools. «Mettimi alla prova» invia un esempio a un server eco indipendente e mostra cosa è
arrivato. Se un messaggio parte senza passare da Velami, il pulsante diventa rosso.

Nessun server, nessun account, nessun analytics. Tutto resta su questo computer. Il codice è aperto
(AGPL-3.0): github.com/viatech-labs/velami

**RU · Velami: приватные чаты с ИИ**

Short description: Скрывает личные данные перед отправкой в ChatGPT, Claude, Gemini и Perplexity и
показывает, что именно ушло. Работает локально, без своих серверов.

Description:

Пишите в ChatGPT, Claude, Gemini и Perplexity как обычно. Copilot, DeepSeek, Mistral Le Chat
и Grok включаются в настройках. До того как сообщение покинет компьютер, Velami
находит номера карт, IBAN, налоговые коды, документы, даты рождения, госномера, телефоны, e-mail и API-ключи, распознаёт имена и адреса
моделью, которая работает на вашем компьютере, и заменяет их метками вроде [[EMAIL_1]]. Модель отвечает с метками, а вы видите ответ с настоящими
значениями. Прикреплённые текстовые файлы очищаются так же, Word, Excel и PowerPoint уходят тем же документом с метками, PDF текстовой копией, картинки той же картинкой с закрытыми данными, а кнопка «Копировать» отдаёт настоящие
значения.

Верить нам на слово не нужно. Панель рядом с чатом показывает точный текст, который получит модель.
Журнал хранит каждый запрос в том виде, в каком он ушёл, с SHA-256 для сверки с DevTools. «Проверь
меня сам» отправляет пример на независимый эхо-сервер и показывает, что дошло. Если сообщение уйдёт
в обход Velami, кнопка станет красной.

Без серверов, учётных записей и аналитики. Всё остаётся на этом компьютере. Исходный код открыт
(AGPL-3.0): github.com/viatech-labs/velami

## Screenshots and promo tile

`npm run store` writes the listing images to `dist/store/<en|it|ru>/`: five screenshots 1280×800
with a caption (`1-panel.jpg` panel before sending, `2-answer.jpg` answer with real values,
`3-file.jpg` cleaned file, `4-log.jpg` log, `5-echo.jpg` self-test) and the small promo tile
`promo-440x280.jpg`. JPEG, because the store does not accept PNG with an alpha channel. Upload each
language set to its localized listing. The screenshots come from real Chrome with the extension on a
test copy of the chat page (`tools/brochure/shots.mjs`), all data in them is made up, and the build
stops if the self-test lets a value through. `--no-shots` rebuilds the captions from the last capture.

The English README screenshots in `docs/img/` come from the same `tools/brochure/shots.mjs` with
`lang: 'en'`.

Demo video: `npm run demo -- <unpacked zip>` records real Chrome with the package on a test copy of
the chat page with made-up data, `dist/demo/velami-demo-ru.mp4` (subtitles burned in and as a
separate track) and `velami-demo-ru.srt`, `npm run demo:it` for Italian. The real IP from the
httpbin.org answer never appears on screen.
