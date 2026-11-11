// Брошюра Velami на итальянском: A4, вёрстка в духе материалов Apple. Снимки берутся из той же папки.
import { MARK_SVG } from '../demo/stage.mjs';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tok = (s) => esc(s).replace(/\[\[([A-Z]+)_(\d+)\]\]/g, '<span class="tok">[[$1_$2]]</span>');

export function brochureHtml({ version, date, prompt, message }) {
  let n = 0;
  const page = (cls, body) => {
    n++;
    const foot = n === 1 ? '' : `<footer><span>Velami · Guida al prodotto</span><span>${n}</span></footer>`;
    return `<section class="page ${cls}">${body}${foot}</section>`;
  };
  const fig = (src, caption = '', cls = '') => `<figure class="${cls}"><img src="${src}">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;

  const pages = [
    page('cover', `
      <div class="brand">${MARK_SVG(44)}<b>Velami</b></div>
      <p class="eyebrow">Guida al prodotto</p>
      <h1>Scrivi all’IA.<br>I tuoi dati restano a casa.</h1>
      <p class="lead">Velami è un’estensione per Chrome che toglie i dati personali dai messaggi prima che arrivino a ChatGPT, Claude, Gemini o Perplexity, e li rimette nella risposta solo sul tuo schermo. Tutto succede sul tuo computer.</p>
      ${fig('panel-crop.png', '', 'hero')}
      <div class="cover-foot"><span>Versione ${version} · Via-Tech</span><span>${date}</span></div>`),

    page('', `
      <p class="eyebrow">Perché esiste</p>
      <h2>Una chat con l’IA sembra privata. Non lo è.</h2>
      <div class="cols2">
        <p>Ogni giorno si incollano in ChatGPT e Claude mail di clienti, contratti, estratti conto, tabelle con nomi e telefoni. Quel testo finisce sui server del fornitore. Resta nei log, nella cronologia delle chat, a volte nei dati usati per addestrare i modelli, e passa dai fornitori di analytics del sito.</p>
        <p>Velami parte da un’idea semplice. All’IA serve il contenuto del messaggio, non l’identità delle persone. Quindi prima dell’invio ogni dato personale diventa un’etichetta neutra, come <span class="tok">[[PERSON_1]]</span>. L’IA lavora sul testo, risponde con le etichette e Velami rimette i valori veri solo sul tuo schermo.</p>
      </div>
      <p class="eyebrow mt">Per chi è</p>
      <h3 class="h3big">Per chiunque usi l’IA con dati di altre persone.</h3>
      <div class="grid3">
        <div class="card"><b>Professionisti</b><p>Commercialisti, avvocati, consulenti del lavoro. Fai riformulare una lettera a un cliente senza inviare il suo codice fiscale, l’IBAN o l’indirizzo.</p></div>
        <div class="card"><b>Amministrazione e HR</b><p>Bozze di comunicazioni, riepiloghi, tabelle con nomi e contatti dei dipendenti. Anche i CSV allegati vengono ripuliti.</p></div>
        <div class="card"><b>Agenti e commerciali</b><p>Mail ai clienti, offerte, solleciti. Nomi, telefoni e indirizzi e-mail restano sul tuo computer.</p></div>
        <div class="card"><b>Sviluppatori</b><p>Log, configurazioni, pezzi di codice. Chiavi API, token e password vengono sostituiti prima dell’invio.</p></div>
        <div class="card"><b>Piccole imprese</b><p>Una regola semplice per tutto il team. Usate l’IA come volete, i dati dei clienti non escono. Niente server da installare, niente account.</p></div>
        <div class="card"><b>Privati</b><p>Una lettera alla banca, un reclamo, una pratica. Il tuo nome, la tua carta e il tuo indirizzo restano tuoi.</p></div>
      </div>
      <div class="note"><b>Cosa non è.</b> Velami non è un antivirus e non è una VPN. Non nasconde il tuo indirizzo IP e non può fermare un sito che vuole aggirarlo di proposito. Fa una cosa sola, in modo che tu possa verificarla: toglie i dati personali da quello che invii all’IA.</div>`),

    page('', `
      <p class="eyebrow">Come funziona</p>
      <h2>Quattro passaggi, nessuna abitudine da cambiare.</h2>
      <div class="steps">
        <div><i>1</i><b>Scrivi come sempre</b><p>Nella chat di ChatGPT, Claude, Gemini o Perplexity, nel browser. Velami lavora mentre scrivi.</p></div>
        <div><i>2</i><b>Velami sostituisce</b><p>Prima che la pagina invii il messaggio, ogni dato diventa un’etichetta.</p></div>
        <div><i>3</i><b>L’IA risponde</b><p>Lavora sul testo con le etichette. I valori veri non li vede mai.</p></div>
        <div><i>4</i><b>Tu vedi i dati veri</b><p>Velami rimette i valori nella risposta, solo sul tuo schermo.</p></div>
      </div>
      <div class="compare">
        <div><p class="label">Hai scritto</p><p class="box">${esc(message)}</p></div>
        <div><p class="label">Ha ricevuto l’IA</p><p class="box">${tok(prompt)}</p></div>
      </div>
      <p class="small muted">Testo reale catturato dalla richiesta di rete durante la preparazione di questa guida, su una copia di prova della chat con dati inventati.</p>
      <div class="grid3 mt">
        <div class="card plain"><b>Locale</b><p>Nessun server, nessun account, nessuna analytics. Anche il modello che riconosce nomi e indirizzi gira dentro l’estensione.</p></div>
        <div class="card plain"><b>Visibile</b><p>Prima dell’invio vedi cosa riceverà l’IA. Dopo l’invio il registro ti mostra cosa è partito davvero.</p></div>
        <div class="card plain"><b>Verificabile</b><p>Puoi controllare tutto da solo, con DevTools, con un server eco indipendente e con lo SHA-256 pubblicato di ogni file.</p></div>
      </div>`),

    page('', `
      <p class="eyebrow">Il pannello</p>
      <h2>Vedi prima cosa riceverà l’IA.</h2>
      <p class="intro">Appena inizi a scrivere, accanto alla chat compare il pannello <i>Cosa vedrà il modello</i>. In alto c’è il testo esattamente come partirà, con le etichette al posto dei dati. Sotto, l’elenco di ogni valore trovato, con il tipo e l’etichetta che lo sostituisce.</p>
      ${fig('panel-crop.png', 'Il pannello mentre scrivi. Il numero in alto dice quanti valori verranno nascosti.', 'mid')}
      <div class="grid2 mt">
        <div><h4>Trovato dal modello</h4><p>Nomi e indirizzi riconosciuti dal modello locale hanno questa nota. Se il modello non è sicuro, la riga diventa gialla e ti chiede di controllare.</p></div>
        <div><h4>Togli la spunta per inviare così com’è</h4><p>Se un valore serve all’IA, per esempio il nome di una città, togli la spunta. Velami lo ricorda e lo trovi in <i>Il mio dizionario</i>, dove puoi nasconderlo di nuovo.</p></div>
      </div>`),

    page('', `
      <p class="eyebrow">Il pannello, in dettaglio</p>
      <h2>Tu decidi cosa parte.</h2>
      <div class="split">
        ${fig('untick.png', 'Il telefono è stato lasciato visibile apposta. Sotto c’è l’esito dell’invio precedente con il secondo controllo della richiesta.')}
        <div>
          <h4>Dopo ogni invio</h4><p>In fondo al pannello compare l’esito: quanti dati sono stati nascosti e il risultato del secondo controllo, che rilegge la richiesta già pronta a partire.</p>
          <h4>Se il modello non ha finito</h4><p>Il pannello mostra subito quello che hanno trovato le regole e aggiunge nomi e indirizzi appena il modello risponde. All’invio Velami aspetta il modello fino a 3 secondi. Se non basta, ti avvisa che i nomi non sono stati controllati.</p>
          <h4>Tema chiaro e scuro</h4><p>Il pannello segue il tema del sistema.</p>
          ${fig('panel-dark.png', '', 'small-fig')}
        </div>
      </div>`),

    page('', `
      <p class="eyebrow">La risposta</p>
      <h2>L’IA risponde con le etichette. Tu leggi i nomi veri.</h2>
      <p class="intro">Quando arriva la risposta, Velami sostituisce ogni etichetta con il valore vero, direttamente nella pagina. I valori rimessi sono evidenziati in verde chiaro, così sai sempre cosa l’IA non ha visto.</p>
      ${fig('answer.png', 'La bozza scritta dall’IA, con i dati veri rimessi da Velami sul tuo computer.', 'wide')}
      ${fig('tooltip.png', 'Passando il mouse su un valore vedi quale etichetta ha ricevuto davvero l’IA.', 'mid mt')}
      <div class="grid2 mt">
        <div><h4>Copia con i valori veri</h4><p>Il pulsante Copia del sito mette negli appunti il testo con i valori veri, anche nella copia con formattazione. Se una pagina prova a copiare senza che tu abbia cliccato, negli appunti finiscono le etichette.</p></div>
        <div><h4>Si può spegnere</h4><p>Se preferisci vedere le etichette anche nella risposta, basta un interruttore nel popup dell’estensione.</p></div>
      </div>`),

    page('', `
      <p class="eyebrow">File allegati</p>
      <h2>Anche i file vengono ripuliti, prima che il sito li veda.</h2>
      <p class="intro">Quando scegli, trascini o incolli un file, Velami lo legge sul tuo computer e passa al sito una copia con le etichette nello stesso formato. Il sito non vede mai l’originale. Un avviso ti dice quanti dati sono stati nascosti e di che tipo.</p>
      ${fig('file.png', 'Un CSV con nome, e-mail, IBAN e una chiave API. Il sito riceve solo la copia con le etichette.', 'wide')}
      <div class="grid3 mt">
        <div class="card plain"><b>Cosa viene ripulito</b><p>File di testo, Word, Excel, PowerPoint, PDF anche scansionati e immagini. I documenti vengono letti per intero, con commenti, revisioni, proprietà e immagini al loro interno.</p></div>
        <div class="card plain"><b>Se qualcosa va storto</b><p>Se il controllo non riesce, il file non viene passato al sito. Meglio un file in meno che un file non controllato.</p></div>
        <div class="card plain"><b>La copia si vede prima</b><p>Prima dell’invio puoi aprire la copia e vedere esattamente cosa riceverà il sito. Nome, dimensione e SHA-256 di ogni copia inviata restano nel registro.</p></div>
      </div>`),

    page('', `
      <p class="eyebrow">Cosa nasconde</p>
      <h2>Ogni tipo di dato ha il suo metodo.</h2>
      <p class="intro">Dove esiste una cifra di controllo, Velami la verifica, così un numero qualsiasi non viene scambiato per una carta. I numeri senza controllo vengono nascosti solo quando il testo dice cosa sono. Nomi e indirizzi li trova il modello locale, aiutato da regole.</p>
      <table class="types">
        <thead><tr><th>Dato</th><th>Esempio</th><th>Come lo riconosce</th></tr></thead>
        <tbody>
          <tr class="grp"><td colspan="3">Sempre</td></tr>
          <tr><td>Carta di pagamento</td><td class="mono">4111 1111 1111 1111</td><td>Formato e algoritmo di Luhn</td></tr>
          <tr><td>IBAN</td><td class="mono">IT60 X054 2811 1010 0000 0123 456</td><td>Formato e controllo mod 97</td></tr>
          <tr><td>Codice fiscale</td><td class="mono">RSSMRA85T10A562S</td><td>Formato e carattere di controllo</td></tr>
          <tr><td>E-mail, telefono, IP</td><td class="mono">+39 347 123 4567</td><td>Formato</td></tr>
          <tr><td>Chiavi e password</td><td class="mono">sk-proj-…, ghp_…, AKIA…</td><td>Formati di OpenAI, Anthropic, GitHub, GitLab, AWS, Slack, Google, JWT, chiavi PEM, e ciò che segue «password:»</td></tr>
          <tr class="grp"><td colspan="3">Quando il testo dice cos’è</td></tr>
          <tr><td>Partita IVA</td><td class="mono">P.IVA 01234567897</td><td>Vicino a «P.IVA», con cifra di controllo</td></tr>
          <tr><td>Passaporto, carta d’identità</td><td class="mono">YA1234567, CA12345AB</td><td>Vicino a «passaporto», «carta d’identità»</td></tr>
          <tr><td>Data di nascita</td><td class="mono">nato il 12/03/1985</td><td>Vicino a «nato», «data di nascita». Le altre date restano</td></tr>
          <tr><td>Targa</td><td class="mono">targa AB 123 CD</td><td>Vicino a «targa». Codici prodotto e numeri d’ordine restano</td></tr>
          <tr class="grp"><td colspan="3">Modello locale e regole</td></tr>
          <tr><td>Nomi e cognomi</td><td class="mono">Mario Rossi, F. Moretti</td><td>Modello di riconoscimento sul tuo computer, varianti con iniziali</td></tr>
          <tr><td>Indirizzi</td><td class="mono">via Garibaldi 12, Milano</td><td>Modello, più regole per via, corso, piazza con numero civico e CAP</td></tr>
          <tr class="grp"><td colspan="3">Tutto ciò che aggiungi</td></tr>
          <tr><td>Il tuo dizionario</td><td class="mono">Ferrari Logistica</td><td>Aziende, clienti, progetti, qualsiasi parola</td></tr>
        </tbody>
      </table>
      <p class="small muted">Velami riconosce anche documenti russi (INN, SNILS, passaporto, polizza OMS, targhe), perché l’interfaccia e il modello funzionano in italiano, inglese e russo.</p>`),

    page('', `
      <p class="eyebrow">Il popup dell’estensione</p>
      <h2>Lo stato della protezione, a colpo d’occhio.</h2>
      <div class="split popups">
        <div class="pair">${fig('popup.png')}${fig('popup-dark.png')}</div>
        <div>
          <p>Un clic sull’icona di Velami nella barra di Chrome apre il popup. In alto l’interruttore generale, sotto lo stato e i contatori del giorno: dati nascosti, invii controllati, avvisi.</p>
          <h4>Quattro stati</h4>
          <ul class="states">
            <li><span class="dot g"></span><b>Protezione attiva.</b> Tutto viene controllato su questo computer.</li>
            <li><span class="dot o"></span><b>Ci sono avvisi.</b> Per esempio un file non controllato. Dai un’occhiata al registro.</li>
            <li><span class="dot r"></span><b>Serve un controllo.</b> Un invio è stato bloccato o è partito senza passare da Velami.</li>
            <li><span class="dot k"></span><b>Velami disattivato.</b> Il testo arriva in chat senza modifiche.</li>
          </ul>
          <h4>Impostazioni</h4>
          <p>Mostrare o no i valori veri nelle risposte, accendere o spegnere il modello locale, scegliere la lingua.</p>
          <h4>Il pulsante sul sito</h4>
          <p>In basso a destra della chat c’è sempre il pulsante di Velami. Cambia colore se qualcosa non va.</p>
          <div class="pills">${fig('pill-on.png')}${fig('pill-off.png')}</div>
        </div>
      </div>`),

    page('', `
      <p class="eyebrow">Inizio e dizionario</p>
      <h2>Tre minuti per configurarlo. Poi lavora da solo.</h2>
      ${fig('welcome.png', 'La pagina Inizio si apre dopo l’installazione. Tre passi: cosa nascondere di te, una prova, e via.', 'wide')}
      <div class="split mt">
        ${fig('dict.png', 'Il mio dizionario. Sotto ci sono i valori a cui hai tolto la spunta.')}
        <div>
          <h4>Quello che sai solo tu</h4>
          <p>Il modello trova i nomi delle persone, ma non può sapere che «Ferrari Logistica» è il tuo cliente più importante. Nel dizionario aggiungi aziende, clienti, progetti, nomi di familiari. Da quel momento vengono nascosti in ogni messaggio, anche dentro i file.</p>
          <h4>Il dizionario ha la precedenza</h4>
          <p>Quello che aggiungi viene cercato prima del modello, quindi vale sempre, anche quando il modello è spento.</p>
        </div>
      </div>`),

    page('', `
      <p class="eyebrow">Registro invii</p>
      <h2>Cosa è uscito dal computer, byte per byte.</h2>
      <p class="intro">Il registro conserva le ultime 300 richieste controllate, con il corpo esatto così come è partito e il suo SHA-256. Puoi confrontarlo con la scheda Network di DevTools, scaricarlo in JSON o svuotarlo.</p>
      ${fig('log.png', 'Ogni voce mostra destinazione, tipi di dati nascosti e l’esito del secondo controllo.', 'wide')}
      <table class="kinds mt">
        <tbody>
          <tr><td><span class="badge g">Inviato al modello</span></td><td>Il messaggio partito verso la chat IA, con le etichette.</td></tr>
          <tr><td><span class="badge">Richiesta del sito</span></td><td>Analytics o richieste di servizio della pagina che contenevano i tuoi dati. Anche queste vengono ripulite.</td></tr>
          <tr><td><span class="badge g">File controllato</span></td><td>Un file allegato, con quello che ha ricevuto il sito al suo posto.</td></tr>
          <tr><td><span class="badge o">Non controllato</span></td><td>Un file che Velami non è riuscito a leggere o che hai deciso di inviare così com’è.</td></tr>
          <tr><td><span class="badge o">Fuga non sostituita</span></td><td>Dati usciti da un canale che Velami non può modificare, come un WebSocket. Velami lo segnala.</td></tr>
          <tr><td><span class="badge r">Bloccato</span></td><td>Velami ha fermato l’invio, per esempio perché il collegamento con l’estensione si era interrotto.</td></tr>
          <tr><td><span class="badge r">Fuori da Velami</span></td><td>Un messaggio è partito senza passare da Velami. Il pulsante sul sito diventa rosso.</td></tr>
        </tbody>
      </table>`),

    page('', `
      <p class="eyebrow">Mettimi alla prova</p>
      <h2>Non fidarti. Prova.</h2>
      <div class="split">
        ${fig('echo.png', 'Il server eco ha ricevuto solo etichette. Il controllo è fatto valore per valore.', 'tall')}
        <div>
          <p>Questa pagina fa passare un testo di prova per lo stesso codice dei messaggi in chat e lo invia a httpbin.org, un servizio eco indipendente che restituisce tutto ciò che riceve. Non lo gestiamo noi.</p>
          <p>A sinistra vedi cosa hai scritto, a destra cosa ha ricevuto il server. Sotto, per ogni valore, la conferma che il server non l’ha ricevuto e quale etichetta è arrivata al suo posto.</p>
          <p>Se nel testo ci sono parole che sembrano nomi ma nessuno le ha trovate, la pagina te lo dice e ti propone di aggiungerle al dizionario.</p>
          <p>Il testo di prova è modificabile. Puoi scriverci quello che vuoi controllare, purché inventato.</p>
        </div>
      </div>`),

    page('', `
      <p class="eyebrow">Archivio etichette e verifica</p>
      <h2>Le chiavi restano nel tuo browser.</h2>
      ${fig('vault.png', 'L’archivio etichette, qui con i valori mostrati. Di solito sono nascosti.', 'wide')}
      <div class="grid2 mt">
        <div><h4>Archivio etichette</h4><p>È l’unico posto dove un’etichetta incontra il suo valore. Sta nello spazio locale dell’estensione su questo computer e non si sincronizza con l’account Google. Serve a rimettere i valori nelle risposte, anche nelle chat vecchie. Puoi svuotarlo quando vuoi.</p></div>
        <div><h4>Verifica senza di noi</h4><p>Una pagina con le istruzioni per controllare Velami da solo. In due minuti con DevTools, cercando la richiesta <span class="mono">conversation</span>. Per i tecnici con mitmproxy e confrontando lo SHA-256 di ogni file installato con quello pubblicato.</p></div>
      </div>`),

    page('', `
      <p class="eyebrow">Come è fatto</p>
      <h2>Quattro parti, una sola uscita verso la rete: quella del sito.</h2>
      <div class="arch">
        <div><b>Pagina della chat</b><p>Un piccolo script intercetta fetch, sendBeacon e XHR della pagina. Ogni corpo di richiesta passa dal controllo prima di partire.</p></div>
        <div><b>Ponte isolato</b><p>Lo script dell’estensione, separato dagli script del sito. Disegna il pannello, rimette i valori nelle risposte, ripulisce i file e gestisce gli appunti.</p></div>
        <div><b>Processo in background</b><p>Archivio etichette, registro, contatori, coda verso il modello. Qui le etichette vengono assegnate e conservate.</p></div>
        <div><b>Documento del modello</b><p>Il modello di riconoscimento in un documento separato, con WebAssembly su più thread. Si chiude dopo 5 minuti senza lavoro.</p></div>
      </div>
      <div class="grid2 mt">
        <div>
          <h4>Si ferma invece di lasciar passare</h4>
          <p>Se il collegamento con l’estensione si interrompe, l’invio viene bloccato, non inviato così com’è. Il ponte sa solo nascondere e controllare. Dalla pagina non si può chiedere il valore di un’etichetta.</p>
          <h4>Due controlli e una sentinella</h4>
          <p>Ogni richiesta viene riletta dopo la sostituzione. Una sentinella segnala se la pagina manda i tuoi dati a un altro indirizzo. Il controllo di copertura avverte se un messaggio è partito senza passare da Velami.</p>
        </div>
        <div>
          <h4>Nessuna rete propria</h4>
          <p>La policy di sicurezza dell’estensione permette alle sue pagine, al processo in background e al modello di contattare solo i file dell’estensione e httpbin.org, per la pagina di prova. Lo verifica un test automatico.</p>
          <h4>Ogni file ha la sua impronta</h4>
          <p>Con ogni versione pubblichiamo lo SHA-256 del pacchetto e di ogni file. Così puoi verificare che la copia installata sia proprio quella rilasciata.</p>
        </div>
      </div>`),

    page('', `
      <p class="eyebrow">Il modello locale</p>
      <h2>Un’IA che riconosce nomi e indirizzi, senza uscire dal computer.</h2>
      <div class="split">
        <table class="facts">
          <tbody>
            <tr><td>Modello</td><td>GLiNER multi PII v1, licenza Apache 2.0</td></tr>
            <tr><td>Base</td><td>mDeBERTa v3, multilingue</td></tr>
            <tr><td>Lingue</td><td>Italiano, inglese, russo</td></tr>
            <tr><td>Formato</td><td>Pesi a 8 bit, 164 MB, inclusi nel pacchetto</td></tr>
            <tr><td>Esecuzione</td><td>onnxruntime-web, WebAssembly, fino a 4 thread</td></tr>
            <tr><td>Avvio</td><td>0,5 a 0,8 secondi al primo messaggio</td></tr>
            <tr><td>Controllo</td><td>140 a 450 ms per un messaggio breve</td></tr>
            <tr><td>Memoria</td><td>circa 250 MB, solo mentre è caricato</td></tr>
          </tbody>
        </table>
        <div>
          <h4>Quanto è preciso</h4>
          <p>Su un insieme di 118 testi inventati, frasi e documenti nelle tre lingue, Velami nel suo insieme trova il 98% di nomi e indirizzi, con il 98% di precisione. In italiano 98% e 96%.</p>
          <p class="small muted">L’insieme è piccolo e preparato da noi. I numeri danno un ordine di grandezza, non una garanzia. Per questo il pannello va guardato prima di inviare, e i nomi importanti vanno nel dizionario.</p>
          <h4>Cosa resta in memoria</h4>
          <p>I nomi trovati dal modello restano in memoria al massimo 30 minuti e non vengono mai scritti su disco. Un valore davvero sostituito va nell’archivio etichette come tutti gli altri.</p>
          <h4>Si può spegnere</h4>
          <p>Senza modello Velami continua a nascondere tutto il resto e i nomi del tuo dizionario.</p>
        </div>
      </div>`),

    page('', `
      <p class="eyebrow">Limiti, in modo onesto</p>
      <h2>Cosa Velami non sa ancora fare.</h2>
      <div class="grid2">
        <div><h4>Il sito vede lo schermo</h4><p>Il sito della chat vede quello che scrivi nella casella prima dell’invio e la risposta con i valori veri. Velami protegge dal fatto che i tuoi dati finiscano sui server e nell’addestramento, non da un sito che cifra apposta i dati per aggirarlo.</p></div>
        <div><h4>Il contesto resta</h4><p>Le etichette nascondono i dati, non il significato. Da quello che racconti un modello può comunque capire di chi si parla.</p></div>
        <div><h4>Il modello può sbagliare</h4><p>Può perdere un nome raro o un indirizzo scritto in forma libera, e a volte scambia una parola comune per un nome. Il pannello e il dizionario servono a questo.</p></div>
        <div><h4>Testo nelle immagini</h4><p>Il testo in immagini e scansioni viene riconosciuto automaticamente e può essere letto con errori. Volti, firme e scrittura a mano non vengono riconosciuti. I PDF oltre 30 pagine partono come copia di testo.</p></div>
        <div><h4>Dipende dai siti</h4><p>L’intercettazione segue il modo in cui oggi funziona ogni sito. Se un sito cambia, il controllo di copertura lo segnala con il pulsante rosso.</p></div>
        <div><h4>Solo nel browser</h4><p>Funziona in Chrome su computer. Le app desktop e mobile delle chat IA non passano da Velami.</p></div>
      </div>
      <p class="eyebrow mt">Requisiti</p>
      <table class="facts wide-t">
        <tbody>
          <tr><td>Browser</td><td>Google Chrome per computer, versione recente</td></tr>
          <tr><td>Siti</td><td>ChatGPT, Claude, Gemini, Perplexity. Da attivare: Copilot, DeepSeek, Mistral Le Chat, Grok</td></tr>
          <tr><td>Lingue dell’interfaccia</td><td>Italiano, inglese, russo. Di solito quella del browser</td></tr>
          <tr><td>Spazio e memoria</td><td>Pacchetto da 186 MB, circa 250 MB di memoria mentre il modello è attivo</td></tr>
          <tr><td>Account e server</td><td>Nessuno</td></tr>
        </tbody>
      </table>`),

    page('', `
      <p class="eyebrow">Domande frequenti</p>
      <h2>Le risposte brevi.</h2>
      <div class="faq">
        <div><b>Devo creare un account?</b><p>No. Velami si installa e funziona. Non ci sono account, abbonamenti o server.</p></div>
        <div><b>Voi leggete le mie chat?</b><p>No. Non riceviamo nulla. Il registro e l’archivio stanno nel tuo browser e si cancellano disinstallando l’estensione.</p></div>
        <div><b>L’IA risponde peggio con le etichette?</b><p>Di solito no. Per scrivere una lettera o riassumere un contratto all’IA serve il contenuto, non il nome vero della persona.</p></div>
        <div><b>E se un dato mi serve in chiaro?</b><p>Togli la spunta nel pannello. Velami lo invia così com’è e se lo ricorda. Puoi nasconderlo di nuovo dal dizionario.</p></div>
        <div><b>E se Velami non trova un nome?</b><p>Lo vedi nel pannello prima di inviare. Aggiungilo al dizionario e da lì in poi viene sempre nascosto.</p></div>
        <div><b>Aiuta con il GDPR?</b><p>Riduce i dati personali che mandate a un fornitore esterno, che è il principio di minimizzazione. Non sostituisce le vostre valutazioni né gli accordi con il fornitore dell’IA.</p></div>
        <div><b>Rallenta il computer?</b><p>Il modello si carica al primo messaggio in meno di un secondo e si chiude da solo dopo 5 minuti senza lavoro.</p></div>
        <div><b>Come faccio a sapere che funziona?</b><p>Apri Mettimi alla prova, oppure guarda la richiesta in DevTools. La guida passo passo è nella pagina Verifica senza di noi.</p></div>
      </div>
      <div class="end">
        <div class="brand">${MARK_SVG(36)}<b>Velami</b></div>
        <p>Nessun server. Nessun account. Tutto resta sul tuo computer.</p>
        <p>Velami è sviluppato da Via-Tech. <b>via-tech.org</b> · <b>info@via-tech.org</b></p>
        <p class="muted small">Versione ${version}. Le schermate di questa guida sono state create su una copia di prova della chat con dati inventati.</p>
      </div>`),
  ];

  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Velami · Guida al prodotto</title><style>${CSS}</style></head><body>${pages.join('\n')}</body></html>`;
}

export const CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font: 10pt/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif; color: #1d1d1f; background: #fff; letter-spacing: -.003em; -webkit-font-smoothing: antialiased; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: 210mm; height: 297mm; padding: 20mm 18mm 18mm; overflow: hidden; break-after: page; background: #fff; }
h4 { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; }
h1, h2 { text-wrap: balance; }
h1 { margin: 0 0 6mm; font-size: 38pt; line-height: 1.06; font-weight: 700; letter-spacing: -.032em; }
h2 { margin: 0 0 6mm; font-size: 23pt; line-height: 1.14; font-weight: 700; letter-spacing: -.024em; max-width: 165mm; }
.h3big { margin: 0 0 5mm; font-size: 15pt; font-weight: 600; letter-spacing: -.015em; }
h4 { margin: 4mm 0 1mm; font-size: 10.5pt; font-weight: 600; }
p { margin: 0 0 3mm; }
.eyebrow { margin: 0 0 2mm; color: #a9502f; font-weight: 600; font-size: 10.5pt; }
.mt { margin-top: 7mm; }
.lead { font-size: 13pt; line-height: 1.45; color: #3a3a3c; max-width: 150mm; }
.intro { font-size: 11pt; color: #3a3a3c; max-width: 165mm; }
.muted { color: #6e6e73; } .small { font-size: 8.5pt; }
.mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 8.5pt; }
.tok { display: inline-block; padding: 0 1.2mm; border-radius: 1.2mm; background: rgba(29,29,31,.07); font: 500 8.5pt/1.5 ui-monospace, "SF Mono", Menlo, monospace; color: #3a3a3c; white-space: nowrap; }
figure { margin: 0; }
figure img { display: block; width: 100%; border-radius: 3mm; border: .3mm solid #e5e5ea; }
figcaption { margin-top: 2.5mm; font-size: 8.5pt; color: #6e6e73; }
footer { position: absolute; left: 18mm; right: 18mm; bottom: 10mm; display: flex; justify-content: space-between; font-size: 8pt; color: #8a877f; }

.cover { background: #f5f5f7; }
.brand { display: flex; align-items: center; gap: 3mm; margin-bottom: 26mm; }
.brand b { font-size: 20pt; font-weight: 600; }
.cover .eyebrow { font-size: 12pt; }
.hero { width: 96mm; margin: 6mm 0 0 auto; }
.hero img { border-radius: 4mm; }
.cover-foot { position: absolute; left: 18mm; right: 18mm; bottom: 12mm; display: flex; justify-content: space-between; font-size: 9pt; color: #8a877f; }

.cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; font-size: 10.5pt; color: #3a3a3c; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 9mm; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
.card { padding: 5mm; border-radius: 4mm; background: #f2f2f4; }
.card b { display: block; margin-bottom: 1.5mm; font-size: 10.5pt; }
.card p { margin: 0; font-size: 9pt; color: #3a3a3c; }
.card.plain { background: #fff; box-shadow: inset 0 0 0 .3mm #e5e5ea; }
.note { margin-top: 8mm; padding: 5mm 6mm; border-radius: 4mm; background: #f2f2f4; font-size: 9.5pt; color: #3a3a3c; }

.steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin: 4mm 0 8mm; }
.steps div { position: relative; padding: 5mm 4mm; border-radius: 4mm; background: #f2f2f4; }
.steps div + div::before { content: ""; position: absolute; left: -3.2mm; top: 9mm; width: 2.4mm; height: 2.4mm; border-top: .5mm solid #d4d0c4; border-right: .5mm solid #d4d0c4; transform: rotate(45deg); }
.steps i { display: grid; place-items: center; width: 7mm; height: 7mm; margin-bottom: 3mm; border-radius: 50%; background: rgba(201,100,66,.13); color: #a9502f; font: 600 9pt -apple-system, sans-serif; font-style: normal; }
.steps b { display: block; font-size: 10.5pt; margin-bottom: 1mm; }
.steps p { margin: 0; font-size: 9pt; color: #3a3a3c; }
.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
.compare .label { margin: 0 0 1.5mm; font-size: 8.5pt; font-weight: 600; color: #6e6e73; }
.compare .box { min-height: 34mm; padding: 4mm 5mm; border-radius: 4mm; background: #f2f2f4; font-size: 10pt; line-height: 1.65; }
.compare div:last-child .box { background: #fff; box-shadow: inset 0 0 0 .3mm #e5e5ea; }

.wide img { border-radius: 3mm; }
.mid { width: 105mm; margin: 0 auto; }
.mid figcaption { text-align: center; }
.split { display: grid; grid-template-columns: 1.05fr 1fr; gap: 9mm; align-items: start; }
.small-fig { width: 70%; margin-top: 3mm; }
.tall img { max-height: 200mm; object-fit: cover; object-position: top; }
.popups { grid-template-columns: 1.1fr 1fr; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.pills { display: flex; gap: 3mm; margin-top: 2mm; } .pills figure { width: 44mm; }
.pills img { border: 0; border-radius: 0; }
.states { margin: 0 0 2mm; padding: 0; list-style: none; }
.states li { position: relative; margin: 0 0 2mm; padding-left: 5mm; font-size: 9.5pt; color: #3a3a3c; }
.states b { color: #1d1d1f; }
.dot { position: absolute; left: 0; top: 1.6mm; width: 2.4mm; height: 2.4mm; border-radius: 50%; }
.dot.g { background: #4f8a4b; } .dot.o { background: #c8811a; } .dot.r { background: #c0392b; } .dot.k { background: #98989d; }

table { width: 100%; border-collapse: collapse; }
.types { font-size: 9pt; }
.types th { padding: 2mm 3mm; text-align: left; font-size: 8pt; font-weight: 600; color: #6e6e73; border-bottom: .3mm solid #e5e5ea; }
.types td { padding: 2mm 3mm; border-bottom: .2mm solid #ebe8de; vertical-align: top; }
.types td:first-child { font-weight: 600; width: 38mm; }
.types td.mono { width: 58mm; color: #3a3a3c; }
.types .grp td { padding-top: 4mm; color: #a9502f; font-weight: 600; font-size: 8.5pt; border-bottom: .3mm solid #e5e5ea; }
.kinds td { padding: 1.8mm 2mm; border-bottom: .2mm solid #ebe8de; font-size: 9pt; color: #3a3a3c; vertical-align: middle; }
.kinds td:first-child { width: 44mm; }
.badge { display: inline-block; padding: .5mm 2.5mm; border-radius: 99mm; font-size: 8pt; font-weight: 600; background: rgba(29,29,31,.07); color: #3a3a3c; }
.badge.g { background: rgba(79,138,75,.12); color: #3b6e38; } .badge.o { background: rgba(200,129,26,.13); color: #8f5a0c; } .badge.r { background: rgba(192,57,43,.1); color: #a3291d; }
.facts td { padding: 2.2mm 0; border-bottom: .2mm solid #ebe8de; font-size: 9.5pt; vertical-align: top; }
.facts td:first-child { width: 30mm; color: #6e6e73; }
.wide-t td:first-child { width: 48mm; }
.arch { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 2mm; }
.arch div { position: relative; padding: 5mm 4mm; border-radius: 4mm; background: #f2f2f4; }
.arch div:nth-child(1) { background: #fff; box-shadow: inset 0 0 0 .3mm #e5e5ea; }
.arch div + div::before { content: ""; position: absolute; left: -4mm; top: 50%; width: 4mm; height: .4mm; background: #d4d0c4; }
.arch b { display: block; margin-bottom: 1.5mm; font-size: 10pt; }
.arch p { margin: 0; font-size: 8.8pt; color: #3a3a3c; }
.faq { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm 9mm; }
.faq b { display: block; margin-bottom: 1mm; font-size: 10.5pt; }
.faq p { margin: 0; font-size: 9.5pt; color: #3a3a3c; }
.end { position: absolute; left: 18mm; right: 18mm; bottom: 24mm; padding-top: 8mm; border-top: .3mm solid #e5e5ea; }
.end .brand { margin-bottom: 3mm; }
.end p { margin: 0 0 1.5mm; font-size: 11pt; }
.end p.small { font-size: 8.5pt; }
`;
