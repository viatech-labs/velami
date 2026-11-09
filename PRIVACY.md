# Privacy policy · Informativa privacy · Политика конфиденциальности

Version 0.1, 9 November 2026. Extension: Velami. Developer: Via-Tech, https://via-tech.org.

---

## English

**In short.** The extension runs entirely on your computer. It has no servers, no accounts, no
analytics and no telemetry. We at Via-Tech, the developer, never receive any of your data.

**What it does with your data.** When you write in ChatGPT (chatgpt.com, chat.openai.com), Claude
(claude.ai), Gemini (gemini.google.com) or Perplexity (perplexity.ai), or in Microsoft Copilot,
DeepSeek, Mistral Le Chat or Grok if you turned them on in the settings, the extension looks for personal data in your text and in the files you attach (text files, PDF, Word, Excel, PowerPoint, whose text is read on your computer):
card numbers, IBANs, tax codes, phone numbers, e-mail addresses, keys and passwords, and names and
addresses. Names and addresses are found by your dictionary and by a recognition model that is part
of the extension and runs on your computer. Before the page sends anything, it replaces each value
with a label such as `[[EMAIL_1]]`. The chat service receives the labels. When the answer comes back,
the extension shows the real values again, only on your screen.

**What is stored, and where.** Everything is kept in your browser's local extension storage
(`chrome.storage.local`) on this computer:

- settings and your dictionary;
- the label vault, which links each label to its real value, so answers can be shown with real values;
- the log of the last 300 checked requests (the body as it was sent, with labels, and its SHA-256);
- daily counters shown in the popup.

If your organization manages Velami, its policy (settings and an organization dictionary) comes from
your browser's managed storage (`chrome.storage.managed`), set by your administrator. Velami only
reads it and never sends it anywhere.

The list of names and addresses found by the model is kept only in memory, for up to 30 minutes, and
is never written to disk. A value that was actually replaced goes to the label vault like any other.
Nothing is synced to your Google account. You can clear the log and the vault at
any time from the extension's page, and uninstalling the extension deletes all of it.

**What leaves your computer.** Only what the chat site itself sends, after the replacement. The
extension does not add any requests of its own, with one exception: the “Test it yourself” page,
when you press the button, sends the sample text (already with labels) to `httpbin.org`, an
independent echo service, so you can see what a server receives. The model is loaded from the
extension's own files. The extension's security policy does not allow its pages, its background
process and the model to contact any other address.

**What we cannot protect.** The chat site sees what you type in its input box before you send it,
and the answer on screen with the real values. The extension replaces your values in all the
site's requests it can see, but it cannot stop a site that deliberately encrypts data to get around
it. The recognition model can miss a name or an address, so add the important ones to your
dictionary. From context a model may still guess who a text is about.

**Source code.** The code is open under AGPL-3.0, so anyone can check these statements:
https://github.com/viatech-labs/velami

**Children.** The extension is not directed at children under 16.

**Changes.** Any change to this policy will be published with a new version of the extension.

**Contact.** Via-Tech, info@via-tech.org, https://via-tech.org

---

## Italiano

**In breve.** L'estensione funziona interamente sul tuo computer. Non ha server, account, analytics
né telemetria. Noi di Via-Tech, che sviluppiamo l'estensione, non riceviamo mai i tuoi dati.

**Cosa fa con i tuoi dati.** Quando scrivi in ChatGPT (chatgpt.com, chat.openai.com), Claude
(claude.ai), Gemini (gemini.google.com) o Perplexity (perplexity.ai), oppure in Microsoft Copilot,
DeepSeek, Mistral Le Chat o Grok se li hai attivati nelle impostazioni, l'estensione cerca i dati personali nel testo e nei file che alleghi (file di testo, PDF, Word, Excel, PowerPoint, il cui testo viene letto sul tuo computer): numeri di
carta, IBAN, codici fiscali, telefoni, indirizzi e-mail, chiavi e password, nomi e indirizzi. Nomi e
indirizzi li trovano il tuo dizionario e un modello di riconoscimento che fa parte dell'estensione e
gira sul tuo computer. Prima che la pagina invii qualcosa, sostituisce ogni valore con
un'etichetta come `[[EMAIL_1]]`. Il servizio di chat riceve le etichette. Quando arriva la risposta,
l'estensione rimette i valori reali, solo sul tuo schermo.

**Cosa viene conservato e dove.** Tutto resta nello spazio locale dell'estensione nel tuo browser
(`chrome.storage.local`) su questo computer:

- le impostazioni e il tuo dizionario;
- l'archivio delle etichette, che collega ogni etichetta al suo valore reale, per mostrare le risposte con i valori reali;
- il registro delle ultime 300 richieste controllate (il corpo così come è stato inviato, con le etichette, e il suo SHA-256);
- i contatori giornalieri mostrati nel popup.

Se Velami è gestito dalla tua organizzazione, la sua policy (impostazioni e dizionario
dell'organizzazione) arriva dallo spazio gestito del browser (`chrome.storage.managed`), impostato
dall'amministratore. Velami la legge soltanto e non la invia da nessuna parte.

L'elenco dei nomi e degli indirizzi trovati dal modello resta solo in memoria, al massimo per 30
minuti, e non viene mai scritto su disco. Un valore effettivamente sostituito finisce nell'archivio
delle etichette come tutti gli altri. Niente viene sincronizzato con il tuo account Google. Puoi svuotare il registro e l'archivio in
qualsiasi momento dalla pagina dell'estensione, e disinstallando l'estensione si cancella tutto.

**Cosa esce dal tuo computer.** Solo ciò che il sito della chat invia già di suo, dopo la
sostituzione. L'estensione non aggiunge richieste proprie, con un'eccezione: la pagina «Mettimi alla
prova», quando premi il pulsante, invia il testo di esempio (già con le etichette) a `httpbin.org`,
un servizio eco indipendente, così vedi cosa riceve un server. Il modello viene caricato dai file
dell'estensione stessa. La policy di sicurezza dell'estensione non permette alle sue pagine, al
processo in background e al modello di contattare altri indirizzi.

**Cosa non possiamo proteggere.** Il sito della chat vede ciò che scrivi nella sua casella prima
dell'invio e la risposta sullo schermo con i valori reali. L'estensione sostituisce i tuoi valori in
tutte le richieste del sito che riesce a vedere, ma non può fermare un sito che cifra apposta i dati
per aggirarla. Il modello di riconoscimento può non trovare un nome o un indirizzo, quindi aggiungi
quelli importanti al dizionario. Dal contesto un modello può comunque capire di chi parla un testo.

**Codice sorgente.** Il codice è aperto con licenza AGPL-3.0, chiunque può verificare quanto scritto qui:
https://github.com/viatech-labs/velami

**Minori.** L'estensione non è destinata ai minori di 16 anni.

**Modifiche.** Ogni modifica a questa informativa sarà pubblicata con una nuova versione dell'estensione.

**Contatto.** Via-Tech, info@via-tech.org, https://via-tech.org

---

## Русский

**Коротко.** Расширение целиком работает на вашем компьютере. У него нет серверов, учётных записей,
аналитики и телеметрии. Мы в Via-Tech, разработчике расширения, никогда не получаем ваших данных.

**Что оно делает с данными.** Когда вы пишете в ChatGPT (chatgpt.com, chat.openai.com), Claude
(claude.ai), Gemini (gemini.google.com) или Perplexity (perplexity.ai), а также в Microsoft Copilot,
DeepSeek, Mistral Le Chat или Grok, если вы включили их в настройках, расширение ищет личные данные в тексте и в прикреплённых файлах (текстовые, PDF, Word, Excel, PowerPoint, их текст читается на вашем компьютере): номера карт,
IBAN, налоговые коды, телефоны, адреса e-mail, ключи и пароли, имена и адреса. Имена и адреса ищут
ваш словарь и модель распознавания, которая входит в расширение и работает на вашем компьютере.
До того как страница что-то отправит, каждое значение заменяется меткой вроде `[[EMAIL_1]]`.
Сервис чата получает метки. Когда приходит ответ, расширение возвращает настоящие значения только
на вашем экране.

**Что хранится и где.** Всё лежит в локальном хранилище расширения в браузере
(`chrome.storage.local`) на этом компьютере:

- настройки и ваш словарь;
- хранилище меток, где каждой метке соответствует настоящее значение, чтобы показывать ответы с настоящими значениями;
- журнал последних 300 проверенных запросов (тело в том виде, в каком ушло, с метками, и его SHA-256);
- дневные счётчики во всплывающем окне.

Если Velami управляет ваша организация, её политика (настройки и словарь организации) приходит из
управляемого хранилища браузера (`chrome.storage.managed`), которое задаёт администратор. Velami
только читает её и никуда не отправляет.

Список имён и адресов, найденных моделью, хранится только в памяти, не дольше 30 минут, и никогда
не записывается на диск. Значение, которое действительно заменили, попадает в хранилище меток, как
любое другое. С аккаунтом Google ничего не синхронизируется. Журнал и хранилище можно очистить в любой момент на
странице расширения, а при удалении расширения всё стирается.

**Что уходит с компьютера.** Только то, что отправляет сам сайт чата, уже после замены. Своих
запросов расширение не добавляет, за одним исключением: страница «Проверь меня сам» по нажатию
кнопки отправляет пример текста (уже с метками) на `httpbin.org`, независимый эхо-сервер, чтобы вы
увидели, что получает сервер. Модель загружается из файлов самого расширения. Политика безопасности
расширения не позволяет его страницам, фоновому процессу и модели обращаться к другим адресам.

**От чего мы не защищаем.** Сайт чата видит, что вы печатаете в его поле ввода до отправки, и ответ
на экране с настоящими значениями. Расширение заменяет ваши значения во всех запросах сайта, которые
видит, но не может помешать сайту, который намеренно шифрует данные, чтобы его обойти. Модель
распознавания может пропустить имя или адрес, поэтому важные стоит добавить в словарь. По контексту
модель всё равно может догадаться, о ком текст.

**Исходный код.** Код открыт по лицензии AGPL-3.0, проверить написанное здесь может любой:
https://github.com/viatech-labs/velami

**Дети.** Расширение не предназначено для детей младше 16 лет.

**Изменения.** Любое изменение политики публикуется вместе с новой версией расширения.

**Контакт.** Via-Tech, info@via-tech.org, https://via-tech.org
