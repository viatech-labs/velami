// Guide per gli studi professionali, solo italiano, indirizzo /it/guide/<slug> (AIGW-52).
// Ogni pagina risponde a una domanda che gli studi cercano davvero. Regole dei testi: niente «conforme al GDPR»,
// niente «anonimizzazione», niente «unico» o «il primo», cifre solo con la fonte, e ogni pagina dice che non è
// un parere legale. Velami compare una volta, verso la fine, come uno dei modi per fare quello che la guida spiega.
// Il corpo è markdown ridotto: «## » e «### » titoli, «> » citazione, «- » elenco, link [testo](url), **grassetto**.

export const GUIDES = [
  {
    slug: 'informativa-ia-clienti-studio',
    title: 'Informativa sull’IA ai clienti dello studio: cosa chiede l’art. 13 della legge 132/2025',
    description: 'Dal 10 ottobre 2025 commercialisti, consulenti del lavoro e avvocati devono informare i clienti sui sistemi di intelligenza artificiale che usano. Cosa dice la norma, cosa non dice, i modelli di CNF e CNDCEC e un esempio di testo da adattare.',
    h1: 'Informativa sull’intelligenza artificiale ai clienti dello studio',
    sub: 'Cosa chiede l’articolo 13 della legge 132/2025, cosa non chiede, dove trovare i modelli degli ordini e cosa scrivere sui dati dei clienti.',
    published: '2026-11-20',
    updated: '2026-11-20',
    body: `
Sì, dal 10 ottobre 2025 chi esercita una professione intellettuale e usa sistemi di intelligenza artificiale deve informarne il cliente. Lo chiede l’articolo 13 della legge 23 settembre 2025, n. 132. La norma dice che cosa comunicare e come, cioè «con linguaggio chiaro, semplice ed esaustivo», ma non impone un modulo, una firma o una scadenza. Qui trovi il testo della norma, i modelli pubblicati dagli ordini e un esempio da adattare allo studio.

## Cosa dice la legge

L’articolo 13 è composto da due commi. Il testo in vigore, da Normattiva:

> 1. L’utilizzo di sistemi di intelligenza artificiale nelle professioni intellettuali è finalizzato al solo esercizio delle attività strumentali e di supporto all’attività professionale e con prevalenza del lavoro intellettuale oggetto della prestazione d’opera.

> 2. Per assicurare il rapporto fiduciario tra professionista e cliente, le informazioni relative ai sistemi di intelligenza artificiale utilizzati dal professionista sono comunicate al soggetto destinatario della prestazione intellettuale con linguaggio chiaro, semplice ed esaustivo.

Il primo comma fissa un limite all’uso: l’IA serve per le attività strumentali e di supporto, e il lavoro intellettuale del professionista deve restare prevalente. Il secondo comma introduce il dovere di informazione verso il cliente. La legge è stata pubblicata nella Gazzetta Ufficiale n. 223 del 25 settembre 2025 ed è in vigore dal 10 ottobre 2025.

## A chi si applica

La norma parla di «professioni intellettuali» senza elencarle. Il riferimento è alle professioni del codice civile (articoli 2229 e seguenti): avvocati, dottori commercialisti ed esperti contabili, consulenti del lavoro, notai, ingegneri, architetti, medici e le altre professioni ordinistiche. Non distingue tra IA generativa usata in chat, come ChatGPT, Claude, Gemini o Copilot, e funzioni di IA integrate nei gestionali. Se uno strumento di IA entra nel lavoro svolto per il cliente, rientra.

## Cosa non dice la legge

- Non indica un modulo. Il modo lo sceglie lo studio.
- Non indica un momento preciso. Può essere il conferimento dell’incarico, il rinnovo del mandato o una comunicazione a parte.
- Non chiede la firma del cliente. Alcuni modelli degli ordini la prevedono per presa visione, ma è una scelta di prudenza, non un obbligo di legge.
- Non prevede una sanzione propria. Il rispetto dell’obbligo rientra nei doveri di informazione e correttezza verso il cliente, sui quali vigilano gli ordini.

## I modelli degli ordini

**Avvocati.** Il Consiglio Nazionale Forense ha diffuso il 13 ottobre 2025 uno schema di informativa, non vincolante, da usare con il cliente e con la parte assistita. L’avvocato informa che potrà ricorrere a sistemi di IA per attività strumentali e di supporto, ad esempio organizzazione, ricerca normativa e giurisprudenziale, analisi preliminare di documenti e bozze, che l’uso avverrà nel rispetto del GDPR e dei doveri deontologici e che ogni risultato sarà verificato dall’avvocato, anche nelle fonti. Lo schema prevede la firma dell’avvocato e quella del cliente per presa visione. [Comunicazione del CNF ai Consigli dell’Ordine (PDF)](https://www.consiglionazionaleforense.it/documents/20182/0/Comunicazione+ai+COA+-+Schema+informativa+IA.pdf), [la notizia e lo schema sul sito dell’Ordine di Milano](https://www.ordineavvocatimilano.it/it/news/informativa-sullutilizzo-di-strumenti-di-intelligenza-artificiale-ex-art-13-legge-23-settembre-2025-n132/p100-n2904).

**Commercialisti.** Il CNDCEC ha scelto la strada della clausola contrattuale da inserire nel mandato professionale. La clausola tipo è stata diffusa il 9 ottobre 2025 ed è pubblicata come Appendice D della guida operativa «L’aiuto intelligente al commercialista» n. 3, del 24 ottobre 2025. Prevede che l’IA sia usata solo per finalità ausiliarie, che valutazioni, decisioni e responsabilità restino al professionista con un controllo umano effettivo, che i dati siano trattati nel rispetto del GDPR e dell’AI Act, che il professionista fornisca su richiesta informazioni sugli strumenti e sulle misure di sicurezza e che il cliente possa chiedere, con richiesta espressa e motivata, di escludere l’uso dell’IA nell’incarico. [La guida sul sito del CNDCEC](https://commercialisti.it/documenti-studio/guida-operativa-di-intelligenza-artificiale-3-laiuto-intelligente-al-commercialista/).

**Consulenti del lavoro.** Al momento in cui scriviamo non abbiamo trovato un modello del Consiglio nazionale dell’Ordine. Le due impostazioni sopra si adattano senza difficoltà anche a uno studio di consulenza del lavoro. Se il vostro Consiglio provinciale ha pubblicato indicazioni, seguite quelle.

## Dove inserirla

Le soluzioni usate dagli studi sono tre e si possono combinare.

- Una clausola nella lettera d’incarico o nel mandato, come propone il CNDCEC. Vale per i nuovi clienti e per i rinnovi.
- Un foglio a parte, firmato per presa visione, come propone il CNF. Serve quando il mandato è già in corso o quando lo studio preferisce un documento dedicato.
- Una comunicazione ai clienti già in essere, via mail o PEC, con lo stesso testo. La legge non dice se i clienti acquisiti prima del 10 ottobre 2025 vadano informati, ma la norma parla di rapporto fiduciario e una comunicazione alla prima occasione utile costa poco.

L’informativa sull’IA non è l’informativa privacy dell’articolo 13 del GDPR. Sono due obblighi diversi. Si possono consegnare insieme, ma è meglio tenerli distinti nel testo. Pubblicare l’informativa solo sul sito dello studio non basta: la norma chiede una comunicazione al destinatario della prestazione.

## Cosa scrivere sui dati dei clienti

I modelli degli ordini dicono che l’uso dell’IA avviene nel rispetto del GDPR. È corretto, ma un cliente attento farà una domanda più concreta: quali dei miei dati finiscono in ChatGPT? Conviene rispondere nel testo, con quattro informazioni.

- **Quali strumenti.** Il nome del sistema e del fornitore, ad esempio ChatGPT di OpenAI, Copilot di Microsoft, Gemini di Google. Senza elenchi generici.
- **Per cosa.** Bozze, sintesi, ricerche, traduzioni. Dire anche per cosa non si usa, ad esempio per decisioni sul cliente.
- **Cosa esce dallo studio.** Se i documenti del cliente vengono inviati così come sono, se vengono prima ripuliti dai dati identificativi, se il piano del fornitore esclude l’uso dei dati per l’addestramento.
- **Chi controlla.** Il professionista verifica ogni risultato e resta responsabile della prestazione.

Il terzo punto è quello che fa la differenza nella pratica. Un modo per renderlo vero è sostituire i dati identificativi con etichette prima dell’invio: nome, codice fiscale, partita IVA, IBAN e recapiti diventano segnaposto come [[CF_1]], e il professionista rivede i valori reali solo nella risposta, sul proprio schermo. Lo studio può farlo a mano oppure con un software che lavora nel browser, come [Velami](/it/studi), che tiene anche un registro locale di ciò che è stato inviato. Nessun rilevatore trova tutto, quindi il controllo del testo prima dell’invio resta compito di chi lo scrive.

## Un esempio di testo

È un esempio da adattare, non un parere legale. Indica gli strumenti che lo studio usa davvero e fai verificare il testo dal tuo Ordine o dal tuo consulente privacy.

> Lo studio utilizza sistemi di intelligenza artificiale generativa, ad esempio ChatGPT di OpenAI, solo per attività di supporto come la stesura di bozze, la sintesi di documenti e le ricerche preliminari. Ogni risultato viene controllato dal professionista, che resta l’unico responsabile della prestazione.

> Prima dell’invio a questi sistemi, i dati che identificano il cliente, come nome, codice fiscale, partita IVA, IBAN e recapiti, vengono sostituiti con etichette da un software che funziona sul computer dello studio. Il professionista verifica il testo prima di inviarlo. Su richiesta, lo studio fornisce informazioni sugli strumenti utilizzati e sulle misure adottate. Il cliente può chiedere che per il proprio incarico non vengano usati sistemi di intelligenza artificiale.

## In cinque passi

- Elenca gli strumenti di IA che lo studio usa davvero, chat e gestionali compresi.
- Scegli dove sta l’informativa: clausola nel mandato, foglio a parte, comunicazione ai clienti in essere.
- Scrivi cosa esce dallo studio e cosa no, con parole che un cliente capisce.
- Conserva una copia datata del testo consegnato e, se c’è, della firma.
- Aggiorna il testo quando cambi strumenti o fornitori.
`,
    faq: [
      ['Serve la firma del cliente?', 'La legge non la chiede. Lo schema del CNF prevede la firma per presa visione, la clausola del CNDCEC viene firmata insieme al mandato. Avere una prova della consegna è prudente, ma il modo lo sceglie lo studio.'],
      ['Vale anche se uso ChatGPT gratuito solo ogni tanto?', 'Sì. La norma non distingue per frequenza d’uso o per piano, gratuito o a pagamento. Se lo strumento entra nel lavoro svolto per il cliente, il cliente va informato.'],
      ['Basta pubblicare l’informativa sul sito dello studio?', 'No. L’articolo 13 chiede che le informazioni siano comunicate al destinatario della prestazione. La pagina sul sito può integrare, ma non sostituisce la consegna al cliente.'],
      ['Devo informare anche i clienti acquisiti prima del 10 ottobre 2025?', 'La legge non lo dice. Dato che la norma tutela il rapporto fiduciario, una comunicazione alla prima occasione utile, via mail o PEC, è la scelta più prudente.'],
      ['L’informativa sull’IA sostituisce l’informativa privacy?', 'No. Sono due obblighi diversi: l’articolo 13 della legge 132/2025 e l’articolo 13 del GDPR. Si possono consegnare insieme, tenendo distinti i due testi.'],
      ['Devo dire al cliente quali dati invio all’IA?', 'La norma chiede informazioni «esaustive» sui sistemi usati. Dire cosa esce dallo studio e cosa viene prima ripulito risponde alla domanda che il cliente farà comunque, e riduce i chiarimenti successivi.'],
    ],
    sources: [
      ['Legge 23 settembre 2025, n. 132, articolo 13, testo in vigore', 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2025-09-23;132~art13'],
      ['CNF, Comunicazione ai Consigli dell’Ordine sullo schema di informativa IA, 13 ottobre 2025', 'https://www.consiglionazionaleforense.it/documents/20182/0/Comunicazione+ai+COA+-+Schema+informativa+IA.pdf'],
      ['Ordine degli Avvocati di Milano, Informativa sull’utilizzo di strumenti di IA ex art. 13, 13 ottobre 2025', 'https://www.ordineavvocatimilano.it/it/news/informativa-sullutilizzo-di-strumenti-di-intelligenza-artificiale-ex-art-13-legge-23-settembre-2025-n132/p100-n2904'],
      ['CNDCEC, Guida operativa di intelligenza artificiale n. 3, «L’aiuto intelligente al commercialista», 24 ottobre 2025, Appendice D', 'https://commercialisti.it/documenti-studio/guida-operativa-di-intelligenza-artificiale-3-laiuto-intelligente-al-commercialista/'],
      ['Il Sole 24 Ore, NT+ Fisco, «Pronto il modello di informativa AI per i commercialisti», 9 ottobre 2025', 'https://ntplusfisco.ilsole24ore.com/art/pronto-modello-informativa-per-commercialisti-AHiB7z4C'],
    ],
  },
];

export const GUIDE_UI = {
  back: 'Pagina per gli studi',
  updated: 'Aggiornato il',
  disclaimer: 'Questa guida è informativa e non è un parere legale.',
  faq: 'Domande frequenti',
  sources: 'Fonti',
  final: {
    title: 'Vuoi ridurre i dati che escono dallo studio?',
    text: 'Velami sostituisce codici fiscali, partite IVA, IBAN, nomi e recapiti con etichette prima che il messaggio arrivi a ChatGPT, Claude, Gemini o Perplexity. Gratuito, open source, funziona sul computer dello studio.',
    studi: 'Leggi la pagina per gli studi',
  },
  studiLink: 'Leggi la guida: cosa scrivere nell’informativa al cliente',
};
