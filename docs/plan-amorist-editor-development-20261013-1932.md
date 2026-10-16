# Plan: sviluppo di Amorist come editor di testo con formattazione visuale

## How to work with this plan

Le sezioni *(Reviewer surface)* contengono il comportamento del prodotto e le scelte da approvare. Le sezioni *(Executor surface)* descrivono il lavoro tecnico. La finalizzazione del documento non equivale ad approvazione: il piano autorizzerà l’esecuzione soltanto dopo che il proprietario avrà espresso l’approvazione e accettato o risolto gli elementi ancora non verificati elencati nel reviewer surface. Questa operazione modifica soltanto il piano. Per le operazioni sul documento, consultare l'appendice Operations Guide, mantenuta nella sua forma originale.

## Context *(Reviewer surface)*

Amorist deve restare un editor di testo che rende visibile la formattazione Markdown. Il redattore lavora con cursore, selezione, tastiera e testo; tabelle e codice restano blocchi testuali, senza strumenti da elaboratore di testi. L'obiettivo è rendere affidabile questa impostazione, aggiungere poche preferenze e le normali operazioni sui file, e consegnare anche un installer Windows.

L'applicazione desktop usa Tauri e un backend Rust; l'editor è JavaScript senza una catena di compilazione del frontend. Il modello del documento conserva il sorgente e applica modifiche locali. La visualizzazione durante l'editing è una proiezione per righe: il parser Markdown generale non è il suo unico punto di ingresso. Sono già presenti cambio modalità, ricerca, cronologia delle modifiche, recupero, contenimento di tabelle/codice e salvataggio con controllo delle modifiche esterne.

La raccolta dei problemi è già iniziata. Il registro locale `/home/alessandro/.local/share/dev.elmisi.amorist/problem-reports.jsonl` contiene sette segnalazioni alla rilevazione del 13 ottobre 2026. Ogni segnalazione conserva nota e documento al momento del clic; questi dati sono la fonte originale del problema, anche se il documento sul disco cambia. Una build locale contiene già `--debug`, ma il pulsante è ancora “Segnala problema” e la funzione deve essere consolidata nei rilasci. Il codice diagnostico è modificato/non tracciato e non appartiene ancora a una release: i report indicano 0.10.8, ma non provano che il binario coincida con la release 0.10.8. Il primo intervento conserverà e versionerà questo lavoro esistente, senza rifarlo e senza reinterpretare retroattivamente i vecchi report.

La nuova consegna comprende tutte le segnalazioni disponibili all'avvio dell'implementazione, la base comune di Markdown e le funzioni concordate. Dopo ciascun rilascio il proprietario ripete la revisione dei propri file e aggiunge casi. Non si promette la fine definitiva dei difetti: si rende ogni correzione verificabile e permanente.

### Decisioni già concordate

- Righe e righe vuote originali restano visibili; aprire, cambiare modalità, cambiare preferenze e salvare senza modifiche non riscrivono il documento.
- Una modifica può aggiornare la minima struttura necessaria, conservando esattamente il testo esterno. La pulizia non cambia il significato ed è annullabile insieme alla modifica.
- Durante la scrittura Amorist gestisce automaticamente il Markdown necessario. Enter va a capo; una riga vuota separa i paragrafi. Liste e codice mantengono comportamenti specifici.
- Tab modifica il testo e Shift+Tab riduce il rientro. Le automazioni essenziali continuano liste e rientri; nessuna correzione automatica delle parole.
- Copia/incolla interno conserva Markdown e aspetto; da applicazioni esterne conserva la struttura utile. È disponibile l'incolla come testo semplice.
- Immagini visibili senza una libreria di impaginazione. Collegamenti: clic per modificare, Ctrl+clic per aprire; su macOS Cmd+clic. I collegamenti a Markdown locali aprono sempre una nuova finestra.
- File e Settings sono due accessi separati; Salva resta visibile. Nuovo e Apri usano la finestra corrente, con scelta “Nuova finestra” per la singola operazione. Nessuna scheda o cronologia di navigazione.
- Avvio senza argomenti: documento vuoto in memoria. Anche un percorso inesistente crea il file soltanto al primo salvataggio. Salva con nome passa al nuovo file.
- Preferenze: evidenziazione della sola riga visiva con interruttore e palette finita; dimensione base comune, titoli proporzionati, fattori distinti per tabelle e codice.
- Windows entra nella stessa consegna con installer, verificato anche nella macchina virtuale VMware con Windows 10 indicata dal proprietario.
- `--debug` rimane nei rilasci futuri, con pulsante “Bug” e registro locale in append. Lo script di revisione usa sempre l'ultima versione consegnata e conserva lo storico dei giri precedenti.

## Interpretation Log *(Reviewer surface)*

- **Read “gestione automatica” as a capo visibile senza richiedere marcatori al redattore.**
  - **Context:** il documento esistente va mostrato come testo; quando si scrive nel visuale deve essere Amorist a rendere i nuovi confini compatibili con Markdown.
  - **Why it matters:** determina cosa scrivere quando Enter divide la prosa e cosa rimuovere quando una successiva riga vuota crea un paragrafo.
  - **Options:** inserire automaticamente un ritorno a capo esplicito / scrivere soltanto una nuova riga / creare sempre un nuovo paragrafo.
  - **Trade-offs:** la prima conserva il gesto da editor di testo e richiede una modifica locale automatica; la seconda non conserva il ritorno a capo nel Markdown convenzionale; la terza introduce uno spazio visivo non richiesto.
  - **Recommendation:** usare il ritorno a capo esplicito nella prosa e gestire automaticamente il passaggio al paragrafo; mantenere Enter letterale nel sorgente e nel codice.
  - **Status:** Confirmed. Interpretazione della scelta esplicita del proprietario sul carico affidato al programma.

- **Read “non far esplodere le dipendenze” as estendere il componente attuale prima di introdurre librerie.**
  - **Context:** le immagini devono essere visibili, ma il prodotto deve restare piccolo e semplice.
  - **Why it matters:** impedisce che le nuove funzioni diventino una riscrittura del motore o introducano un sistema di impaginazione.
  - **Options:** usare il browser e il backend esistenti / adottare un editor visuale completo / aggiungere una libreria per ogni funzione.
  - **Trade-offs:** la prima richiede verifiche sulle mappature del testo; le altre ampliano superficie, dimensione e comportamenti da mantenere.
  - **Recommendation:** niente nuovo framework frontend; usare elementi nativi e capacità Tauri esistenti. Per aprire browser e altri file sulle tre piattaforme il piano propone una sola aggiunta mirata: il componente ufficiale di apertura Tauri nel backend Rust, senza pacchetto JavaScript o framework aggiuntivi. Evita di mantenere chiamate native differenti; lock e immagini usano capacità già disponibili. La distinta delle dipendenze e la variazione del pacchetto saranno registrate prima della consegna.
  - **Status:** Confirmed. Vincolo esplicito del proprietario. L’aggiunta mirata per le aperture esterne è una proposta concreta di questo piano, da valutare con il piano prima di implementarla; nessuna libreria per impaginazione o editor completo.

- **Read “ultima versione” as ultima consegna disponibile sul computer, verificata prima di ogni giro.**
  - **Context:** lo script non deve continuare a provare un vecchio eseguibile fissato in `target/release` o nel registro precedente.
  - **Why it matters:** un problema osservato deve essere attribuibile alla versione effettivamente consegnata.
  - **Options:** versione consegnata e installata verificata / qualunque comando trovato nel percorso del sistema / scaricamento e aggiornamento automatico remoto.
  - **Trade-offs:** la prima richiede aggiornare e controllare l'installazione dopo ogni consegna; la seconda può provare un binario vecchio; la terza aggiunge rete, installazione e un sistema di aggiornamento non richiesto.
  - **Recommendation:** risolvere il comando installato, verificare la sua versione rispetto alla consegna locale e fermarsi se è vecchio. Nessuno scaricamento automatico. A nuova versione iniziare un nuovo giro dall'inizio; riprendere nello stesso giro dopo un'interruzione.
  - **Status:** Settled by stated default at finalize. Nessuna conferma esplicita aggiuntiva è stata ricevuta; resta la raccomandazione dichiarata, senza domanda dipendente aperta.

## Approach *(Reviewer surface)*

Conservare il modello sorgente e la proiezione per righe, correggendo le responsabilità che oggi si sovrappongono. Un solo riconoscimento del contesto deve governare visualizzazione, input, selezione e incolla: una riga dentro il codice non può essere trattata contemporaneamente come un titolo o una lista.

Prima registrare la situazione iniziale e aggiornare i requisiti soltanto dove le decisioni del proprietario cambiano il prodotto. Poi correggere i casi raccolti e completare la base comune. Aggiungere preferenze e comandi sui file sul modello verificato, includendo recupero separato per documento e istanza. Integrare Windows e chiudere con prove sul prodotto confezionato e sullo script di revisione.

La base comune comprende paragrafi e righe vuote, titoli con cancelletti e sottolineati, enfasi con asterischi e trattini bassi, enfasi annidata, testo barrato, escape, collegamenti inline e per riferimento, collegamenti automatici, immagini, liste numerate/puntate annidate con righe di continuazione, caselle di spunta, citazioni multilinea e annidate, separatori, codice inline con delimitatori di lunghezza variabile, codice a rientro e delimitato, tabelle con pipe escapati e codice nelle celle. Le interruzioni originali rimangono visibili, anche quando altri strumenti unirebbero le righe.

Metadati iniziali, collegamenti wiki, HTML grezzo, formule e diagrammi non ricevono nuove promesse di resa visuale: restano testo conservato e accessibile. Non aggiungere interpretazioni parziali che nascondano contenuto. La compatibilità della nuova scrittura riguarda la sintassi Markdown; non obbliga la visualizzazione a imitare altri programmi.

**Esito della consegna:** il proprietario apre file esistenti o nuovi, modifica naturalmente testo/liste/codice, usa preferenze e normali comandi sui file, e raccoglie problemi sulla stessa nuova versione nelle tre piattaforme. I comportamenti oggi funzionanti restano verificati. Le modifiche automatiche riguardano soltanto la struttura realmente coinvolta.

## Decisions I Need From You *(Reviewer surface)*

None. Le note sono state risolte usando le decisioni già concordate e scelte tecniche esplicite. Il carattere base è comune anche nel sorgente; i documenti nuovi usano una nuova riga semplice su tutte le piattaforme; aprire un altro file dal sistema non sostituisce un documento in uso; la consegna attende le verifiche di tutte e tre le piattaforme. La scelta marginale sul controllo della versione nello script è stabilita dalla raccomandazione dichiarata nell’Interpretation Log. Non ci sono domande deferred da rilasciare. Gli elementi operativi ancora non verificati e le scelte per procedere sono elencati qui sotto, prima dell’approvazione.

### Inventario degli elementi ancora irrisolti

Sono verifiche di ambiente e situazione iniziale; nessuna scelta di prodotto resta aperta. Ogni voce permette di scegliere **risolvere prima dell’esecuzione** oppure **procedere consapevolmente con la conseguenza indicata**. L’approvazione deve specificare o accettare esplicitamente il trattamento proposto; questa finalizzazione non lo presume.

- **Ambiente Windows nella macchina virtuale.**
  - **What is unresolved:** `unverified:` accesso operativo, architettura, strumenti e runtime webview della macchina VMware Windows 10 indicata dal proprietario.
  - **Why it cannot be settled now:** la macchina non è stata ispezionata; i comandi `vmrun` e `vmware` non sono disponibili nel percorso di questa sessione. Questo non dimostra che VMware o la macchina virtuale siano assenti.
  - **Consequence of proceeding as-is:** il lavoro sul codice condiviso può avanzare, ma l’installer potrebbe richiedere preparazione dell’ambiente e la consegna completa resta bloccata fino alla prova reale Windows.
  - **Recommendation:** procedere consapevolmente con questa limitazione; rilevare l’ambiente all’inizio dell’esecuzione e risolvere l’accesso prima del lavoro specifico Windows. Non autorizza avvio/configurazione arbitraria della macchina né un rilascio parziale.

- **Sessione macOS e comportamento delle aperture.**
  - **What is unresolved:** `unverified:` disponibilità di una sessione macOS per provare il pacchetto; ordine degli eventi Finder, lancio delle nuove istanze, Dock, dialoghi e clipboard effettivi. `lestrade.local` è soltanto il candidato indicato dalla nota di revisione.
  - **Why it cannot be settled now:** nessuna sessione macOS è stata contattata o provata; Linux e la documentazione delle API non possono dimostrare questi comportamenti nativi.
  - **Consequence of proceeding as-is:** l’implementazione segue il modello descritto, ma può richiedere adattamenti del lancio; Safari e una build automatica non bastano a liberare la consegna completa.
  - **Recommendation:** procedere consapevolmente con questa limitazione, reperendo la sessione all’inizio dell’esecuzione e completando le prove prima della pubblicazione. Non autorizza modifiche a un host remoto non ancora identificato nel lavoro.

- **Situazione iniziale completa delle regressioni.**
  - **What is unresolved:** `unverified:` verdetto corrente dell’intera suite nei motori delle piattaforme pubblicate. Il report disponibile è storico; nella sessione Linux manca `WebKitWebDriver`.
  - **Why it cannot be settled now:** i controlli mirati già eseguiti non sostituiscono il giro completo, e i prerequisiti devono essere preparati prima di ottenere quel verdetto.
  - **Consequence of proceeding as-is:** non sarebbe possibile distinguere con affidabilità tutti i fallimenti introdotti da quelli preesistenti.
  - **Recommendation:** risolvere prima delle modifiche funzionali: la prima fase dell’esecuzione deve produrre la baseline completa o indicare precisamente quali risultati mancano. Nel frattempo sono consentite soltanto conservazione del lavoro corrente, inventario e preparazione delle verifiche; nessuna dichiarazione di regressioni assenti.

Non ci sono TODO decisionali residui, assunzioni non dichiarate o domande rilasciate senza risposta. Le tredici attività della Task Breakdown sono il lavoro da implementare, non risultati già ottenuti; la loro mancata esecuzione non viene presentata come una verifica superata.

### Dettagli marginali scelti dal piano

Preferenze globali salvate tra gli avvii; finestra Settings compatta con anteprima, Salva e Annulla. Dimensione base iniziale 16 pixel, intervallo 12–24 a passi di 1; fattori per tabelle e codice 75%, 87,5%, 100%, 112,5%, 125% e 150%. Default codice 100%, tabelle 87,5%, vicini ai 16 e 14 pixel attuali. La modalità sorgente usa lo stesso valore base e conserva il proprio font monospazio: al default passa dai 15 pixel attuali a 16, cambiamento intenzionale dovuto alla dimensione comune scelta dal proprietario. Nessun rapporto nascosto 15/16. I fattori sono per i blocchi visuali, per evitare che lo stesso testo cambi altezza nel mezzo dell’area sorgente. Titoli mantengono i rapporti attuali.

Evidenziazione inizialmente disattivata per mantenere l'aspetto di chi aggiorna; palette Grigio `#eef1f4`, Azzurro `#e8f2ff`, Verde `#e9f5ed`, Giallo `#fff6d8`, Rosa `#faedf2`. Quando abilitata colora tutta la larghezza della riga visiva attiva, senza cambiare il testo. Il testo normale deve conservare un contrasto di almeno 4,5:1 su ogni colore della palette. Nessun selettore di colore libero.

Tutti i testi nuovi e il dialogo Bug saranno in inglese, coerenti con la barra esistente: File, Settings, New, Open, Save As, Save, Bug, New window; Bug dialog con Describe the problem, Cancel, Save report, e messaggi di conferma/errore coerenti. Nessun progetto separato di traduzione. L’opzione New window è esplicita per la singola apertura, non una preferenza nascosta. Installer Windows per utente, a 64 bit se confermato dall'ambiente. Nessun servizio in background o sistema di aggiornamento automatico.

## Detailed Changes *(Executor surface)*

### Evidenze e situazione iniziale

Ricerca svolta il 13 ottobre 2026: TokenSave status/context/search/read, poi letture dirette dei file che segnalavano indice non aggiornato. Non è stato sincronizzato l'indice per questa pianificazione.

| Superficie verificata | Evidenza | Implicazione |
|---|---|---|
| Modello e journal | `web/editor/amorist-document-model.js:7-107`: sorgente originale, mappatura terminatori, transazioni inverse, 100 voci | Estendere le transazioni; niente salvataggio ricostruito da tutta la pagina |
| Proiezione attiva | `web/editor/amorist-editor.js:252-387`: contesto codice assegnato dopo `projectionLine`; classi strutturali applicate prima di `codeContent` | Dare precedenza al codice e condividere il contesto anche con input e metadata |
| Tabelle | `web/editor/amorist-editor.js:424-469`: celle testuali, HTML inline, misure raggruppate e padding visuale | Conservare il sistema testuale; verificare alignment dopo font e immagini |
| Modifiche rapide | `web/editor/amorist-editor.js:486-525`: aggiornamento della sola unità stabile | Preservare identità dei nodi estranei e limiti di prestazione |
| Enter e Tab | `web/editor/amorist-editor.js:620-727`: Enter prosa scrive LF, contesto strutturale indipendente dal codice; Tab solo visuale | Nuovo confine automatico e Tab nel sorgente; proteggere codice e strutture |
| Incolla | `web/editor/amorist-editor.js:227-235,717-727`: handler solo paste visuale, nessun copy/cut; contesto codice euristico | Clipboard da sorgente prima della conversione HTML, gestione di entrambe le modalità |
| Conversione HTML | `web/editor/amorist-html-to-markdown.js:66-92`: LI sempre puntato, titoli senza marcatore, TABLE senza separatore, PRE senza fence | Rafforzare conversione locale con contesto ricorsivo, senza serializzare il file |
| Cambio modalità | `web/editor/amorist-editor.js:808-909`: offset raw/display, ancoraggio alla linea centrale e bordi, fallback sorgente | Riutilizzare le mappature; font/immagini e righe nascoste richiedono prove dedicate |
| File e recupero | `src-tauri/src/lib.rs:189-317`: temporaneo+rename, mtime, `working-copy.json` unico | Recupero separato necessario per nuove finestre; verificare replacement su Windows |
| Avvio | `src-tauri/src/lib.rs`, `resolve_file_arg` e ramo `Ok(None)` in setup | Percorsi mancanti già accettati; nessun argomento oggi fa uscire l'app |
| Preferenze e barra | `web/index.html`, `web/app.js`, `web/editor/amorist-editor.css:87-200` | Nessun settings; font in pixel diversi fra sorgente e visuale |
| Segnalazioni | `web/debug-report.js`, `report_problem`, `scripts/review-markdown-files.py` | Consolidare codice già presente, non duplicarlo |
| Build e verifiche | `.github/workflows/build.yml`, `.github/workflows/qa.yml`, `tests/qa/lib/engines.js` | Linux e macOS soltanto; Windows e relativi risultati vanno aggiunti |
| Requisiti | `.qa/qa-contract.yaml`: località per riga, Enter LF in contrasto con ereditarietà dei terminatori, Windows fuori scope | Emendamento tracciato prima di aggiornare i controlli confliggenti |

Verifiche correnti passate: sette comandi Node per codec Markdown, tabelle, conversione HTML, journal, toolbar, positioning e delega piattaforme. Sono controlli mirati, non prova di una release completa. Il report `.qa/reports/last-run.json` è del 18 agosto 2026 con exitCode 0: evidenza storica, non stato corrente. `WebKitWebDriver` non è disponibile in questa sessione; il giro completo delle tre piattaforme non è stato eseguito.

Sonda Chromium sul componente e sui documenti delle segnalazioni: documento invariato; segnalazione titoli nel codice riprodotta con 36 righe di codice che hanno anche stili strutturali, inclusi commenti visualizzati a 32 pixel. I delimitatori nascosti contengono una nuova riga e misurano 18 pixel nella pagina di prova. I conteggi dipendono dal documento e dal contenitore; la causa strutturale è verificata, non si generalizza la misura al prodotto.

### Conservazione del lavoro diagnostico e identità della situazione iniziale

Files: `VERSION`, `CHANGELOG.md`, `src-tauri/build.rs`, `.gitignore`, file diagnostici già modificati e nuovi `web/debug-report.js`, `scripts/review-markdown-files.py`.

- Primo passo dell’implementazione: conservare patch dei soli file diagnostici, hash del binario locale e inventario dei report in una cartella privata. Registrare separatamente il commit di partenza e il lavoro non committato: non descriverlo come release 0.10.8.
- Integrare il codice diagnostico esistente in un commit locale dedicato, dopo le verifiche pertinenti, includendo i due sorgenti non tracciati. Incrementare VERSION e aggiornare CHANGELOG per la baseline diagnostica; numero proposto 0.10.9: al controllo locale di finalizzazione risultano VERSION 0.10.8 e il solo tag v0.10.8 nel gruppo v0.10.*, ma prima di assegnarlo verificare anche i tag remoti e le release già pubblicate. Se occupato, usare il primo numero successivo libero; niente riuso o sovrascrittura. Non pubblicare questa baseline come consegna completa: la versione con tutte le funzioni avrà un numero successivo distinto.
- Escludere dalla versione i percorsi personali, il registro di revisione, le copie di recovery e gli screenshot locali non relativi al codice. Aggiungere le due esclusioni esatte `/markdown-file-paths.txt` e `/markdown-review-state.json` a `.gitignore`, mantenendoli dove sono per non interrompere l’uso dello script. Niente staging indiscriminato.
- I sette vecchi record restano byte-identici: riportano 0.10.8 senza identità build. L’inventario li associa alla sessione diagnostica dichiarata, senza attribuire un commit/binario che il report non ha misurato.

**User-visible success criterion:** il codice già usato per segnalare problemi viene mantenuto e le prossime build sono distinguibili; nessun elenco personale viene incluso nei commit.

### Requisiti, regressioni e raccolta casi

Files: `.qa/qa-contract.yaml`, `.qa/decisions.yaml`, `.qa/risk-register.yaml`, `.qa/tools/render-eval-matrix.py`, `.qa/contract.json`, `.qa/eval-matrix.md`, `tests/qa/checks/`, `tests/qa/corpus/`, `tests/qa/paste/`, `tests/qa/README.md`.

- Aggiornare `.qa/risk-register.yaml` per i nuovi rischi e le relative verifiche; `.qa/risks.yaml` resta il registro storico congelato, come stabilisce `.qa/architecture.md:12-21`. Il generatore legge il primo: non duplicare né riscrivere le evidenze di Discovery.
- Registrare baseline prima delle modifiche: versione, piattaforma, risultati, fixture e fallimenti. Non usare i campi storici `currently_holds` come verdetto corrente.
- Emendamento che sostituisce la località per sola riga con minima struttura necessaria e specifica confini per ogni gesto. Non autorizza normalizzazione del file intero, cambi alle zone estranee o riscrittura al cambio modalità.
- Aggiornare insieme REQ-B3 e REQ-A9: oggi il primo prescrive bare LF e il secondo eredita il terminatore della riga corrente. La nuova regola inserisce l’eventuale backslash prima del terminatore ereditato, senza normalizzare le altre righe; in un documento nuovo il terminatore iniziale è LF. Conservare sorgente letterale e undo completo. Aggiornare le aspettative soltanto per gli esiti cambiati dal proprietario, lasciando visibili le differenze prima/dopo.
- Aggiungere requisiti per base comune, immagini, clipboard interna, preferenze, file/finestre, Bug, Windows e runner per versione. Rigenerare le proiezioni col comando esistente; non duplicare regole in test e implementazione.
- Importare tutte le segnalazioni disponibili all'avvio dell'implementazione: conservare il registro originale localmente; in repository soltanto esempi minimi sintetici e depurati, ciascuno collegato a data/nota e test pertinente. Nessun test legge i file privati sotto `~/elmisi` o dipende dal registro locale.
- La nuova consegna non può far fallire un controllo della baseline che non sia esplicitamente sostituito dalle nuove decisioni. Fallimenti preesistenti restano visibili e si risolvono se bloccanti; non vengono mascherati dal confronto con la baseline.

**User-visible success criterion:** ogni caso ha un esito spiegabile e un controllo che fallisce reintroducendo il difetto; le parti non modificate del documento rimangono identiche.

### Rendering, struttura e base comune

Files: `web/editor/amorist-editor.js`, `web/editor/amorist-markdown-codec.js`, `web/editor/amorist-table-codec.js`, `web/editor/amorist-editor.css`. Se necessario estrarre il riconoscimento in `web/editor/amorist-projection.js`, senza un secondo motore concorrente.

- Classificare prima blocchi delimitati, codice a rientro, liste/citazioni e relative continuazioni; poi interpretare l'inline fuori dal codice. I descrittori devono portare intervallo raw, contesto, unità e mapping testo/marker.
- Nel codice: proiezione letterale con prefix zero, nessuna classe heading/list/quote/task e nessun pseudo-marcatore; stessa precedenza per Enter, Tab, Backspace e paste.
- Nascondere i delimitatori senza altezza testuale aggiunta; mantenere offset raggiungibili nel sorgente e una destinazione deterministica per il cambio modalità. Conservare le vere righe vuote dentro il codice.
- Generare fence più lunghi della maggiore sequenza nel contenuto quando l'utente crea un blocco di codice o incolla codice strutturato. I delimitatori identici annidati in un documento esistente sono interpretati secondo le regole Markdown; non correggere quel file all'apertura. Il primo feedback è quindi un caso di delimitazione da spiegare e di creazione da rendere sicura, non una richiesta di inventare annidamento ambiguo.
- Liste: allineare righe avvolte al primo carattere del testo; collegare le righe di continuazione all'item e rispettare livelli misti, numero iniziale, paragrafi e quote/code dentro item. Rientrare un item muove le sottovoci necessarie nella stessa transazione e non le voci vicine.
- Citazioni: bordo continuo per righe consecutive dello stesso blocco, comprese la nota multilinea dell'ultima segnalazione; non introdurre separazioni senza righe vuote reali.
- Tabelle: restano Markdown visibile e modificabile; mantenere frame e scroll attuali. Contare le pipe soltanto fuori da escape/code inline. Verificare allineamento entro 1 pixel anche con codice, emoji, stili misti e nuovi fattori carattere; ricalcolare solo la tabella interessata.
- Render inline: tokenizer con intervalli raw e mapping, evitando sola ricerca euristica nel testo per escape, delimitatori variabili, immagini e collegamenti. Il markup non deve trasformare le stringhe del documento in HTML eseguibile.
- Coprire ogni famiglia elencata nella base comune con casi di apertura, editing, undo e cambio modalità; nesting e continuazioni richiedono esempi dedicati, non soltanto test sul vecchio codec isolato.

**User-visible success criterion:** commenti e numeri dentro codice restano letterali, non appaiono righe vuote aggiunte, liste hanno allineamento continuo, note multilinea restano unite, e la base comune è utilizzabile senza perdere il punto di editing.

**Exit clause:** se l'estensione locale non consente mapping reversibili per un costrutto, mantenerlo leggibile come sorgente mentre si corregge il supporto. Un costrutto della base comune ancora degradato blocca la consegna; non sostituire il motore né ampliare le dipendenze senza una proposta concreta.

### Nuova scrittura, ritorni a capo e tastiera

Files: `web/editor/amorist-editor.js`, `web/editor/amorist-document-model.js`, controlli di famiglia A/B/C.

Target shape: `editingContextAt(rawOffset)` condiviso con la proiezione; `planEdit(gesture, selection)` restituisce un solo replacement raw, selection e struttura coinvolta; il journal registra anche la pulizia necessaria.

- Prosa visuale: Enter inserisce un confine hard-break con backslash prima del terminatore, aggiungendolo soltanto quando serve e senza duplicare un hard-break già presente. Se Enter successivo crea una riga vuota, eliminare nella minima struttura il marcatore automatico non più necessario. Se Backspace riunisce il testo, togliere soltanto il marcatore diventato inutile. Quando la nuova riga diventa lista, titolo, citazione, codice o altro blocco, rivalutare il confine precedente: se il marcatore automatico non è più necessario, eliminarlo nella stessa transazione della scorciatoia di blocco, con lo stesso undo. Non togliere un backslash letterale o un escape scritto intenzionalmente. Conservare la provenienza dei confini automatici nella sessione e nel recovery, senza metadati nel Markdown. Inserire il backslash prima del terminatore della riga corrente, che può essere LF, CRLF o CR; a fine documento senza terminatore usare l’ultimo terminatore precedente, e LF se assente. Escape di un backslash literal e fine documento coperti da casi.

- Esempio di modifica minima su prosa originale senza hard-break: prima `prima riga\nseconda parte\nterza riga`; Enter tra “seconda” e “parte” produce `prima riga\nseconda\\\nparte\nterza riga`. In questa notazione `\n` indica una nuova riga e `\\` un backslash nel testo. Solo il confine creato riceve il marcatore: le righe vecchie restano come sono. Amorist mostra tutte le righe; altri renderer possono unire le vecchie. Non uniformare il paragrafo preesistente per renderlo coerente altrove.
- Sorgente: Enter letterale; nessuna conversione implicita del resto del paragrafo. Codice: newline e rientro corrente, nessun marker di prosa. Tabelle e strutture: Enter secondo contesto; non introdurre marcatori nelle celle o nella sintassi dei separatori.
- Conservare marker shortcuts esistenti, Enter su item pieno/vuoto, Backspace al bordo, numerazione e caselle nuove non spuntate. Ogni automatismo si annulla insieme al gesto che l'ha prodotto.
- Tab/Shift+Tab in entrambe le modalità. Nelle liste agire su item/sottovoci; nel codice e nel testo Tab al cursore inserisce un rientro, su selezione indentare le righe; Shift+Tab rimuove fino a un livello. Default 2 spazi, nessun setting aggiuntivo. Nessun limite artificiale nella prosa: se a inizio riga due Tab producono un rientro che Markdown riconosce come codice, la proiezione cambia in codice. È l’effetto intenzionale dell’editing testuale; uno Shift+Tab o undo lo rimuove. Verificare che il cursore non salti e che il testo non venga riordinato. Escape riporta il focus alla toolbar quando non c'è già un pannello da chiudere.

- Conservare input composto, caratteri Unicode, selezioni orientate, taglia/incolla e cronologia. Le azioni dei dialoghi non attivano i comandi del documento sottostante.

**User-visible success criterion:** il proprietario scrive a capo senza marcatori, ottiene il layout atteso e Markdown strutturato; undo ripristina esattamente il testo prima del gesto, compresa la pulizia locale.

### Copia/incolla fedele e contenuti esterni

Files: `web/editor/amorist-editor.js`, `web/editor/amorist-html-to-markdown.js`, `tests/editor-html-to-markdown.test.js`, `tests/qa/paste/`.

- Gestire copy/cut/paste nelle due modalità. Copia interna porta il frammento Markdown raw e i delimitatori necessari per una selezione che attraversa formattazione, senza copiare metadati privati dei report. Usare un formato clipboard dedicato quando supportato, con plain Markdown disponibile e HTML semantico di fallback.
- Preferire il payload interno validato alla conversione HTML; dopo paste, struttura e aspetto equivalenti al frammento copiato, salvo destinazione codice/sorgente che rimane letterale. Anche il passaggio fra finestre/modalità è coperto.
- Trasformare HTML esterno con contesto ricorsivo: livelli liste e numerazione, titoli, quote, enfasi, link, immagini referenziate, PRE con fence sicure, tabelle con intestazione/separatore ed escape. Non perdere testo dei contenuti non supportati; renderlo letterale con avviso se occorre.
- Incolla semplice con Ctrl/Cmd+Shift+V; nessuna rilettura o ricostruzione dell'intero documento. Nel codice e nel sorgente privilegiare text/plain.
- Regola deterministica senza payload dedicato: HTML presente viene convertito come struttura utile; solo text/plain viene inserito verbatim come sorgente Markdown, senza interpretare la provenienza. Nel visuale i marcatori verranno resi dalla normale proiezione; nel sorgente/codice restano letterali. Anche il testo esterno contenente `*`, `_` o `#` segue questa regola da editor Markdown. L’incolla semplice sceglie text/plain senza conversione HTML, non introduce escape automatici dei marcatori.
- Testare clipboard reale nei webview pubblicati: se il formato dedicato viene rifiutato, il plain Markdown resta il fallback e l’HTML semantico assicura la struttura. Nessuna cache globale che possa incollare contenuto vecchio; le istanze condividono solo il clipboard di sistema.

**User-visible success criterion:** copiare una lista, una tabella o un testo formattato nello stesso file e incollarlo riproduce contenuto e struttura; un testo esterno conserva titoli, link e annidamento utili.

### Settings, dimensioni e riga attiva

Files: `web/index.html`, `web/app.js`, `web/app.css`, nuovo `web/settings.js`, `web/editor/amorist-editor.js`, `web/editor/amorist-editor.css`, `src-tauri/src/lib.rs`.

Target shape: `{highlightCurrentLine, highlightColor, baseFontSize, tableScale, codeScale}`; backend load/save validati in `app_local_data_dir()/settings.json`, con scrittura atomica. La stessa cartella contiene registro Bug, `recovery/` e `locks/`; su Linux è `~/.local/share/dev.elmisi.amorist/`. Il vecchio recupero in `app_data_home()/working-copy.json` viene letto solo per migrazione e conservato fino a importazione verificata. Non migrare o spostare il log Bug. Nessuna dipendenza per una raccolta di cinque preferenze. Scritture concorrenti delle preferenze serializzate col lock dedicato; vince l’ultimo salvataggio riuscito e i reader vedono un file completo.

- Tra processi distinti rileggere le preferenze quando la finestra riprende il focus; confronto con ultima configurazione applicata e ricalcolo solo se cambia. Chi salva applica immediatamente nella propria finestra. Nessun evento Tauri presunto globale, watcher o bus aggiuntivo.
- Dialogo Settings con anteprima isolata e ripristino dei default; applicare al salvataggio, annullare senza cambiare preferenze. Valori e palette definiti nel reviewer surface.
- Variabili CSS per base/rapporti, nessun effetto sulle dimensioni della toolbar. Font e fattori ricalcolano le tabelle e l'ancoraggio mantenendo offset sorgente, selezione e documento invariati. I fattori non cambiano rientri o testo.
- Riga attiva: overlay non editabile dietro il testo, nessuna classe di sfondo sull'intero paragrafo. Visuale: rettangolo della riga contenente il caret, inclusi soft-wrap; sorgente: geometria del textarea con wrap off già esistente, senza sostituirlo con un componente editor esterno.
- Una sola riga evidenziata: per selezione non collassata usare l'estremità attiva. Nascondere senza focus, nei dialoghi, oltre viewport o sui soli marker invisibili; nei blocchi orizzontali tagliare al loro viewport.
- Aggiornare tramite un solo frame su selezione, scroll, input, resize e preferenze; nessuna scansione dell'intero documento per ciascun movimento. Registrare anche settings effettivi nei report Bug.

**User-visible success criterion:** cambiando colore/font/fattori si vede l'effetto previsto, resta evidenziata soltanto la riga visiva al cursore e riaprendo l'app le preferenze sono mantenute; nessun byte Markdown cambia.

### File, finestre e recupero

Files: `web/index.html`, `web/app.js`, nuovo `web/file-actions.js`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`.

- Mantenere un processo/documento per finestra: le nuove finestre lanciano lo stesso pacchetto con argomenti strutturati e `--debug` ereditato. Linux AppImage usa `$APPIMAGE`, riutilizzando la logica verificata di `exec_path()` anziché il binario del mount temporaneo; la nuova istanza ha vita indipendente dalla prima. Su macOS usare `open -n <bundle.app> --args ...` quando si parte dal pacchetto; binario diretto soltanto nello sviluppo senza bundle. Su Windows e Linux non AppImage usare il percorso dell’eseguibile. Non costruire un workspace multi-documento o un backend globale per più finestre.

- Aperture macOS dal Finder: gestire `RunEvent::Opened` nel lifecycle dell’app, non soltanto gli argomenti in setup. Un file ricevuto durante l’avvio riempie la finestra iniziale ancora inutilizzata; ogni ulteriore file o evento verso un’istanza già in uso apre una nuova istanza, senza sostituire o chiedere di scartare il documento corrente. Gli eventi iniziali e gli argomenti duplicati devono essere deduplicati. I file mancanti arrivati da Finder producono un errore, non un documento vuoto implicito. Ordine eventi e comportamento Dock devono essere verificati sul pacchetto macOS, come dichiarato nell’inventario del reviewer surface; `lestrade.local` è il candidato indicato dalla nota, non un host già ispezionato o autorizzato a modifiche.
- Stato sessione esplicito per documento nominato o senza nome. Comandi Rust per creare sessione, aprire percorso, save-as e spawn altra istanza; path nel backend, non soltanto nella barra.
- Avvio senza argomenti e New: documento senza percorso; nessun file su disco prima del salvataggio. Save di un documento senza nome apre Save As. I nomi ed estensioni seguono i filtri attuali, con proposta `.md`. Un documento nuovo o percorso inesistente parte con terminatore LF su tutte le piattaforme, compreso Windows. Nei documenti esistenti restano invariati i terminatori per riga; non aggiungere una preferenza per questo dettaglio.

- Open/New nella finestra corrente: chiedere Save/Discard/Cancel se dirty, con dialogo reale; cancellare qualsiasi dialogo o fallire un salvataggio conserva documento, path, undo e recupero. Nuova finestra non scarta né chiede di salvare il documento di partenza.
- Save As: scegliere path nativamente, confermare replacement, scrivere, poi soltanto dopo successo cambiare identità/path/mtime e saved source. Mantiene cronologia; se fallisce continua sull'originale. Controllare anche la modifica esterna della destinazione durante il dialogo, senza usare l'mtime del file precedente.
- Open riuscito resetta undo, saved source, ricerca e recovery della nuova sessione; lettura fallita non smonta l'editor precedente. Trasferimento di contesto non deve far persistere timer rimasti dal documento precedente.
- Recupero: record separati per sessione/documento e recupero degli untitled, senza sovrascrittura fra istanze anche sullo stesso percorso. Migrare il vecchio working-copy.json senza cancellarlo finché il record non è importato. All'avvio mostrare le copie recuperabili e scelta esplicita se più sessioni dello stesso file esistono. Salvare/discard rimuove soltanto il proprio record.
- Conferma di chiusura e warning modifiche esterne restano attivi. Sostituire il nome temporaneo fisso del writer con un temporaneo adiacente univoco e serializzare salvataggi concorrenti dello stesso path fra istanze, ricontrollando il timestamp dentro il lock: il secondo salvataggio vede il conflitto invece di sovrascrivere il primo. Verificare replacement atomico su Windows, percorsi con spazi/accenti e accesso negato: mai usare delete-original-then-write come fallback.

- Lock condivisi: usare `std::fs::File::try_lock` su file separati in `app_local_data_dir()/locks/`, aperti read/write. Chiave persistente derivata dal percorso canonico con algoritmo FNV-1a a 64 bit fissato nel codice; il lockfile memorizza anche il percorso completo e una collisione usa un suffisso libero dopo confronto sotto lock. Non assumere il digest privo di collisioni; per file ancora inesistenti, antenato esistente canonico + segmenti restanti normalizzati secondo il filesystem. Verificare equivalenza degli alias di path, incluso casing su Windows, prima di scegliere la chiave; se l’identità non è risolvibile dare errore prima di scrivere. Non usare `DefaultHasher` come identità persistente. Il file di lock non sta accanto al documento e non viene cancellato a ogni unlock, per non creare lock su inode diversi. Rilasciare chiudendo il handle; tentativi non bloccanti con timeout 5 secondi. Il documento resta libero per il rename di replacement; usare la stessa primitiva per il log Bug. Rust minimo 1.89 per queste API; documentare e verificare nel toolchain delle tre piattaforme. [API standard dei lock Rust](https://doc.rust-lang.org/std/fs/struct.File.html#method.try_lock).
- File menu: New, Open, Save As, più Reload esistente; Settings separato e Save visibile. Scorciatoie convenzionali, focus/titoli riconoscibili, Escape chiude pannelli senza toccare il contenuto.

**User-visible success criterion:** l'utente crea/apre/salva/rinomina senza terminale, annulla senza perdere lavoro, sceglie una nuova finestra e recupera ciascun documento dopo un'interruzione.

### Immagini e collegamenti

Files: renderer/proiezione, `web/editor/amorist-editor.js`, `web/file-actions.js`, `src-tauri/src/lib.rs`, capabilities/config.

- Immagini: `<img>` nativo con larghezza massima del contenitore e dimensioni proporzionate; niente resize handles, dati binari dentro il Markdown o download gestiti. URL remote via webview; file relativi risolti rispetto alla directory del documento corrente. Save As ricalcola la base senza riscrivere le destinazioni originali.
- Immagini locali: la verifica nel sorgente Tauri 2.11.2 (`src/scope/fs.rs:278-343` nella crate installata) trova allow e forbid, ma nessuna API pubblica per rimuovere un pattern; forbid ha precedenza permanente. Non usare quindi la concessione/revoca dello scope asset per le aperture successive nella stessa finestra. Usare il fallback già previsto: protocollo applicativo `amorist-image` registrato nel backend Tauri, con risorse opache riferite alla sola sessione/documento corrente. Nessuna nuova crate o feature `protocol-asset` necessaria per questa scelta.
- Il backend risolve i riferimenti originali, valida il file immagine e registra un identificativo opaco; il protocollo risponde soltanto per identificativi presenti nella mappa della sessione corrente. Open/New/Save As sostituiscono la mappa ed invalidano gli identificativi precedenti. Il frontend non sceglie path arbitrari nella richiesta; assenti o scaduti rispondono not found e producono il fallback alt/path. Servire con tipo immagine corretto, non come HTML; verificare PNG, JPEG, GIF, WebP, SVG, AVIF e BMP, link relativi con `../`, path escapati e Unicode, drive Windows. Non esporre un comando generale di lettura/scrittura filesystem. In documento senza path base, un riferimento relativo resta leggibile.
- **Exit clause immagini locali:** se il protocollo non funziona in un webview pubblicato, mantenere alt/path e il documento integro, correggere trasporto/configurazione prima della consegna. Non aprire lo scope all’intero filesystem o introdurre un server HTTP locale per aggirare il problema.

- Immagini sono atomi non editabili con mapping ai limiti del sorgente; il source mostra l'intero riferimento. Fallimento caricamento mostra alt/path, senza far sparire testo o cambiare il file. Caricamenti tardivi non spostano inutilmente il punto di editing.
- Intercettare link: clic semplice mantiene editing, Ctrl/Cmd+clic richiama apertura. Markdown locale apre una nuova istanza con destinazione risolta rispetto al file corrente e ancoraggio a heading se presente. Solo ancoraggio nello stesso documento scorre nella finestra corrente. Browser predefinito per http/https/mailto, sistema per altri file esistenti; argomenti senza passare da una shell.

- Aperture esterne: aggiungere soltanto `tauri-plugin-opener` lato Rust, chiamato da un comando backend che valida tipo/percorso/destinazione; non usare `cmd /c start` né costruire comandi shell. Il plugin gestisce l’apertura nativa su Windows/Linux/macOS e sostituisce una chiamata di sistema mantenuta a mano; niente pacchetto JavaScript e nessun permesso opener generico al frontend. Prima fissare la versione compatibile con Tauri/toolchain, registrare le nuove dipendenze transitive e la differenza in byte dei tre pacchetti; se incompatibile o trascina funzionalità estranee, proporre l’adapter nativo minimo prima di sostituire questa scelta. [Plugin ufficiale Opener](https://v2.tauri.app/plugin/opener/).
- Link inesistente: messaggio col percorso e nessun file creato automaticamente. Gestire UI per inserire/modificare destinazione con dialogo proprio, sostituendo entrambi i `window.prompt` in `web/editor/amorist-editor.js:738` e `web/editor/amorist-editing-policy.js:239` con lo stesso dialogo accessibile; i prompt JavaScript attuali non vengono usati come garanzia di funzionamento multipiattaforma.

**User-visible success criterion:** immagini locali/remote compaiono senza alterare i riferimenti; il link locale apre una seconda finestra e il documento di partenza resta nello stesso punto.

### Bug permanente e revisione per rilascio

Files: `web/debug-report.js`, `web/index.html`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `scripts/review-markdown-files.py`, documentazione.

- Rinominare l’etichetta del pulsante in Bug e uniformare in inglese dialogo e messaggi come nel reviewer surface; modalità `--debug` in pacchetti di release, nessun requisito di build non ottimizzata. Non attivarlo di default nell'uso normale.
- Conservare e leggere i record schemaVersion 1; nuovi record aggiungono versione effettiva, identità build, settings, nota, timestamp, path, modello completo e last-saved, modalità, offset/selection direction, viewport, scroll, intervalli raw dei blocchi visibili, HTML e geometria. Snapshot prima del focus del dialogo anche nell'apertura da tastiera. Nessun autosave del documento causato dalla segnalazione.

- Identità build concreta: `build.rs`, dopo la sincronizzazione della versione, incorpora versione, commit, target e fingerprint dei contenuti di tutti i sorgenti/runtime/configurazioni che entrano nel pacchetto, inclusi file non tracciati della relativa allowlist, più indicatore dirty riferito a questi file. Una diversa patch locale deve cambiare fingerprint anche con stesso commit e stesso numero versione: il solo suffisso dirty non basta. Usare Git `hash-object` su manifest ordinato di path+contenuto, con rerun-if-changed sui file, sulle directory della allowlist per rilevare aggiunte/rimozioni, e sui riferimenti Git del commit e dell’index; esclusi piani, report e percorsi personali. Una build di release senza identità misurabile fallisce, non assume un hash. Scrivere lo stesso buildId in report, manifest di consegna e risposta macchina del runner.
- Registro append-only nello stesso percorso dati corrente; lock fra processi, non soltanto il Mutex della singola app. Ogni record è una riga JSON completa, flush prima di confermare. Prima di appendere, sotto lock controllare l’ultimo byte: se un crash ha lasciato un record senza newline, appendere soltanto il separatore prima del nuovo record, senza riscrivere la coda danneggiata. Il lettore segnala quel record come incompleto e continua dai record validi successivi. Verificare crash in mezzo a un record e due writer concorrenti. Niente rotazione automatica o upload.
- Ctrl/Cmd+S e altri shortcut non agiscono sul documento dietro la modale. Errore mantiene nota e snapshot e consente Retry/Cancel. Il percorso log resta consultabile, non soltanto in un messaggio fugace.
- Gestire le richieste di identità in `src-tauri/src/main.rs` prima di `amorist_lib::run()`/`tauri::Builder`, leggendo `std::env::args`; nessuna webview/display richiesti. `--version` è la risposta umana su stdout quando disponibile. Il runner usa `--build-info <output.json>`: scrittura di metadata in un file temporaneo nuovo scelto dal runner e uscita, funzionante anche con `windows_subsystem = "windows"` senza console. Non dipendere da AttachConsole o dall’output interattivo di Windows per identificare la build. Nel rilascio Windows non introdurre un ramo AttachConsole: `--build-info` è l’interfaccia documentata per verificare l’identità; il runner deve attendere l’uscita e leggere il file con timeout 10 secondi. Nel ramo macchina applicare create-new al file e rifiutare la sovrascrittura; un file assente/malformato o exit non zero è un errore, senza fallback alla versione nel nome del pacchetto. Conservare VERSION come fonte unica.

- Runner: non fissare il binario della prima esecuzione. La procedura di consegna scrive un piccolo riferimento locale a versione attesa, buildId e installazione in `app_local_data_dir()/review-release.json`; il runner risolve e verifica il comando prima dell'avvio e prima di ogni file. Confrontare versione e fingerprint della build, non soltanto il numero. Se differisce, fermarsi e indicare come usare/installare la nuova consegna, senza aprire silenziosamente una vecchia build.
- Stato per versione e giro: a nuova versione comincia dalla prima voce; sulla stessa versione riprende dove interrotto. Log storico di opened/closed/failed/skipped con versione e path. Chiudere una finestra non equivale a certificare il documento corretto.
- Una sola istanza del runner per stato; paths con spazi, file rimossi, lista aggiornata e stato malformato hanno esiti espliciti. Ctrl+C richiede arresto della sequenza lasciando chiudere normalmente l'editor corrente; non terminare forzatamente una finestra con lavoro non salvato.
- Riutilizzare l'elenco `markdown-file-paths.txt` di 5.888 percorsi, senza aprire/modificare in massa i documenti durante i test automatici. Nuovi giri manuali possono lavorare su copie se si intende provare modifiche.

**User-visible success criterion:** dopo un aggiornamento il giro usa la nuova versione dall'inizio; una segnalazione è riproducibile anche se il file originale cambia; interruzione e ripresa non perdono lo storico.

### Windows e rilascio sulle tre piattaforme

Files: `.github/workflows/build.yml`, `.github/workflows/qa.yml`, `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`, `tests/qa/lib/engines.js`, `tests/qa/lib/engine-tauri.js`, nuovo adapter Windows, `tests/qa/lib/keys.js`, `tests/qa/checks/family-g.js`, `README.md`, scripts installazione/consegna.

- Build Windows su runner Windows e macchina virtuale, target nativo Microsoft; installer setup.exe con il sistema di packaging Tauri, per utente e associazioni Markdown. Una build fatta su Linux non sostituisce la prova Windows. [Documentazione installer Tauri](https://v2.tauri.app/distribute/windows-installer/).
- Usare packaging con bootstrapper del runtime webview, senza distribuire un intero browser incorporato; verificare installazione, aggiornamento e uninstall nella macchina virtuale. Sistema operativo, architettura, strumenti, canale di trasferimento e runtime della VM devono essere rilevati all’inizio dell’esecuzione; accesso ancora non verificato nell’inventario del reviewer surface.
- Audit cfg Rust, path, argomenti shell, dialoghi, apertura file dal sistema, titoli e chiusura. Conservare pacchetti Linux deb/AppImage e macOS universale dmg.
- Aggiungere Windows alla mappa delle piattaforme pubblicate e ai report. Per il webview effettivo usare tauri-driver con driver Edge compatibile, riutilizzando il client WebDriver esistente. Tauri documenta il supporto diretto su Windows/Linux; il driver diretto non copre macOS. [Documentazione delle verifiche Tauri](https://v2.tauri.app/develop/tests/webdriver/).
- Su macOS conservare Safari e controlli già presenti, aggiungendo verifica manuale del pacchetto per dialoghi, clipboard, immagini, impostazioni e nuove istanze. La disponibilità della sessione macOS resta aperta nell’inventario del reviewer surface; la build automatica da sola non certifica questi gesti.
- Conservare il runner leggero: Node builtins, Rust e driver esterni come strumenti di verifica; niente nuovo framework di test soltanto per Windows.
- Pubblicazione: nuova versione unica, incrementata, artefatti completi e verifiche bloccanti passate. Non sovrascrivere una release già pubblicata con comportamento diverso sotto lo stesso numero. Inserire versione Windows anche nell'upload/download artefatti e nella condizione di rilascio.
- La consegna è unica: Linux, macOS e Windows attendono tutti i risultati richiesti, compresa la prova del pacchetto Windows 10. Un prerequisito mancante o una prova fallita blocca subito la pubblicazione completa, senza una scadenza che autorizzi automaticamente una consegna parziale. Diagnosticare la causa, proseguire il lavoro indipendente e riportare l’ostacolo; separare le piattaforme richiede una nuova scelta esplicita del proprietario. [Evento macOS di apertura risorse](https://docs.rs/tauri/2.11.2/tauri/enum.RunEvent.html#variant.Opened).
- La prova locale sul pacchetto candidato precede la consegna. I cicli successivi riusano gli stessi gate e riproducono i nuovi Bug su esempi sintetici. La finalizzazione non esegue né autorizza da sola installazione, push o pubblicazione. La futura istruzione di esecuzione stabilirà l’autorità di consegna; il gate automatico resta comunque obbligatorio.

**User-visible success criterion:** l'installer Windows 10 installa e aggiorna Amorist, apre Markdown e documenti vuoti, esegue l'intero flusso File/Settings/Bug/clipboard, e non altera i file nelle prove senza modifiche; gli stessi esiti sono verificati nei pacchetti Linux e macOS.

### Verifica complessiva e prestazioni

- Test significativi nuovi per modifiche locali, source spans, hard-break automatici, nesting/continuazioni, clipboard reale, settings senza edit, recovery isolato, Save As fallito/cancellato e append concorrente. Non aggiungere test che ricopiano semplicemente la formula della produzione.
- Migrazione del contratto verificata con diff e generatore; requisiti invariati conservano gli stessi esiti, nomi e severità.
- Cambio modalità: stesso offset logico e selezione, linea centrale conservata quando possibile, stessi bordi naturali all'inizio/fine; nessun padding fittizio. Ripetere con font 12/16/24, fattori estremi, immagini, liste avvolte e blocchi scorrevoli.
- Prestazioni esistenti non allentate: 3 tasti di warm-up, 20 misurati; novantacinquesimo percentile non oltre 50 ms per 500 righe e 100 ms per 1.500 righe. Conservare nodi esterni all'unità modificata per typing stabile. La riga attiva non aggiunge render completi o misure di tutte le tabelle.
- Recupero: il contratto attuale chiede di dichiarare e verificare l’intervallo, non prescrive 2 secondi. Conservare la scrittura dopo 2 secondi di inattività e aggiungere una scadenza non rinviabile di 5 secondi dalla prima modifica non ancora persistita, anche durante input continuo. Completata la scrittura, se sono arrivate nuove modifiche far ripartire la scadenza dal primo evento non coperto; una sola scrittura in volo per sessione. Registrare timestamp/revisione: la scadenza di 2/5 secondi riguarda l’avvio della persistenza; completamento entro ulteriori 100 ms nelle prove dei documenti da 500/1.500 righe, quindi perdita massima verificata 2,1 secondi dopo inattività o 5,1 secondi durante input continuo. Misurare venti scritture per scenario e nessuna può superare il limite; nessun timer del documento precedente deve scrivere in un altro record. Esplicitare questi valori nell’emendamento REQ-E1 e testare crash durante scrittura continua, dopo inattività e durante cambio file. Se la persistenza supera il budget misurato, mostrarla come failure e correggere scheduler/backend, senza allentare silenziosamente la soglia.

- Check di non regressione: find, toggle task, toolbar inline e block, Unicode, file UTF-8, terminatori misti, limite 10 MB, salvataggio conflict/forced, chiusura dirty, source fallback e scroll blocchi.
- Sonda del prodotto confezionato per ciascuna piattaforma; il browser simulato è supporto al debug, non certificazione della GUI nativa.

## Edge Cases and Risks *(Executor surface)*

| Rischio | Likelihood / Impact | Mitigation | Exit clause |
|---|---|---|---|
| Mapping errato con inline, immagini e marker nascosti | Già fragile per ricerca testuale; può inserire/cancellare nel punto sbagliato | Span raw espliciti, selezioni ai bordi, undo e sorgente confrontati | Costrutto resta sorgente leggibile finché mapping verificato; blocca base comune |
| Confine automatico cambia testo lontano | Possibile; diff e significato non corrispondono al gesto | Replacement minimo e journal unico, test bytes esterni | Rifiutare il gesto con messaggio e source disponibile, non serializzare tutto |
| Liste e quote raggruppate perdono righe originali | Possibile; regressione del layout scelto | Raggruppamento visuale mantiene tutti i confini raw e solo righe vuote reali | Correggere il raggruppamento, non modificare il documento per adattarlo |
| Font/riga attiva degradano input e cambio modalità | Possibile e misurabile | Overlay, frame unico, unità incrementali, budget attuali | Ridurre misure/invalidazione prima della consegna; nessun ritorno all'highlight di paragrafo |
| Più finestre si sovrascrivono recovery/log | Recovery unico verificato; perdita di lavoro possibile | Sessioni separate e lock del log tra processi | Non consegnare nuove finestre senza prove simultanee |
| Windows apparentemente verde tramite browser proxy | Nessuna copertura oggi; può nascondere failure di dialoghi/path | Prova WebView reale e VM installer | Non pubblicare la consegna completa se una piattaforma o la VM richiesta non è verificata |
| Convertitore HTML perde struttura o frammenti | Limiti concreti verificati | Conversione ricorsiva e plain fallback con avviso | Conservare testo originale, segnalare struttura non convertibile |
| Stesso numero versione riusato | Pipeline oggi permette clobber; review attribuita a build errata | Versione incrementata e identità build nel report | Fermare consegna/runner se identità non determinabile |
| Espansione dipendenze per base comune | Possibile se la parser roadmap diventa riscrittura | Moduli piccoli sul motore presente, costo dichiarato | Presentare proposta separata prima di introdurre framework |

## Failure Modes and Degradation *(Executor surface)*

- Rendering fallito: mostrare sorgente integro con avviso e mantenere selezione; 0 byte cambiati. Nessun editor bianco. Un errore su un caso della base comune blocca il rilascio.
- Settings mancanti: default; file malformato: default con avviso, conservando il file originale per diagnosi. Save preferenze fallito: mantenere ultima configurazione salvata e dialogo disponibile, niente successo fittizio.
- Open/Save/Save As falliti o annullati: mantenere documento e identità precedenti; nessun originale eliminato. Il limite esistente resta 10 MB, encoding UTF-8. Quando file inexistent e parent non scrivibile, errore al salvataggio senza creare file vuoti.
- Recovery non persistibile: avviso visibile e documento modificabile, nessun file utente aggiornato. Non dichiarare il recupero affidabile sulla piattaforma finché non passa la prova.
- Bug non scrivibile: conservare nota/snapshot, Retry/Cancel. Lock registro non acquisibile entro 5 secondi: stesso errore recuperabile, nessun loop o seconda scrittura indistinguibile.
- Immagine fallita: alt/path visibile; nessun tentativo di riparare/salvare il riferimento. Nessuna attesa sincrona sul caricamento per aprire o modificare il file.
- Driver/prerequisito mancante: risultato bloccante nominato; mai skipped-and-green per una piattaforma pubblicata. VM o macOS non accessibili: completare lavoro indipendente e bloccare l’intera consegna finché le prove richieste non sono concluse; nessun rilascio parziale automatico.
- Runner con versione errata/stato corrotto: fermarsi prima del prossimo file, mantenere storico; indicare percorso/versione rilevati. App chiusa con codice non zero: registrare fallimento e fermare la sequenza. File rimosso: skipped registrato, nessun nuovo file creato dall'app.

## Task Breakdown *(Executor surface)*

- [ ] Conservare/versionare il lavoro diagnostico già presente, aggiornare VERSION/CHANGELOG e ignorare i due file personali; risultato: baseline distinta, nessun codice rifatto né dati personali tracciati.
- [ ] Registrare baseline corrente e rileggere tutte le segnalazioni fino all'avvio; risultato: inventario completo con riproduttori e stato non ambiguo.
- [ ] Aggiornare contratto e proiezioni per le sole scelte nuove; risultato: limiti delle modifiche e regole Enter/Windows verificabili senza indebolire requisiti estranei.
- [ ] Correggere contesto codice, marker/righe vuote e delimitatori generati; risultato: codice letterale, nessuna numerazione doppia e nessuna riga inventata.
- [ ] Completare riconoscimento e mapping della base comune, liste/quote e tabelle; risultato: nesting, continuazioni e note allineati e modificabili con offset corretti.
- [ ] Implementare Enter/Tab e pulizia della struttura minima; risultato: nuova scrittura Markdown naturale e undo esatto.
- [ ] Implementare copy/cut/paste interno ed esterno; risultato: frammenti conservati tra modalità/finestre e struttura utile dall'esterno.
- [ ] Aggiungere Settings, font/fattori e riga visiva attiva; risultato: preferenze persistenti e documento invariato.
- [ ] Separare recupero per sessione, implementare File e nuove istanze; risultato: New/Open/Save As, cancellazione e recupero simultaneo senza perdita.
- [ ] Mostrare immagini e gestire collegamenti/click; risultato: riferimenti conservati e Markdown locale aperto in un'altra finestra.
- [ ] Consolidare Bug, append concorrente, versione headless e runner per versione; risultato: giro sulla consegna giusta, storico conservato e segnalazioni riproducibili.
- [ ] Integrare installer/build/verifiche Windows, rilevare accesso VM e sessione macOS e provare gli eventi Finder; risultato: flusso reale verificato su Windows 10 nella stessa consegna.
- [ ] Eseguire regressioni, prestazioni e prove dei tre pacchetti, aggiornare README e procedura di consegna; risultato: evidenze correnti, nessun fallimento bloccante e script pronto per il nuovo giro.

### Ordine e confini di esecuzione

Conservazione del lavoro diagnostico e identità della baseline precedono le nuove funzioni; nessuna baseline diagnostica viene pubblicata come consegna completa. Contratto e baseline precedono ogni modifica ai test. Mapping e contesto precedono Enter, clipboard e immagini. Recupero separato precede nuove finestre. Settings richiede mapping stabile e precede la verifica finale delle geometrie. Windows viene predisposto durante questi interventi, non dopo la consegna Linux/macOS. Versione e runner vengono verificati sul pacchetto candidato prima di aprire il giro dei documenti personali.

Non implementare browser mode deprecato, schede, cloud, collaborazione, impaginazione, formule/diagrammi, syntax highlighting nuovo o auto-update. Non cancellare/modificare i vecchi piani e gli screenshot locali già presenti. Lavorare sui sorgenti del progetto, non sui file privati della raccolta.

### Verifiche di chiusura e tracciamento delle segnalazioni

Gli elementi non verificati sono elencati una sola volta nel reviewer surface con conseguenze e scelta proposta. La chiusura esige evidenze per tutti: baseline corrente, ambienti operativi e prove dei pacchetti; il lavoro indipendente non elimina questi gate.

- Sette segnalazioni è la fotografia iniziale, non un conteggio immutabile. Rileggere il registro all’avvio e prima delle verifiche finali. Ogni record nell’inventario del candidato ha esito fixed con test, comportamento corretto spiegato, oppure unresolved che blocca la consegna se nella base comune. Se arrivano nuove note durante il candidato, includerle nella verifica senza dichiararle automaticamente risolte; i record successivi alla consegna aprono il ciclo seguente.
- Scrivere l’elenco artefatti/versioni/buildId e i risultati delle tre piattaforme in un manifest di consegna; nessun risultato può essere solo una build o un codice HTTP riuscito.
- Completare una prova di fine flusso: aggiornare l’installazione con il candidato, far risolvere al runner il nuovo buildId, aprire due file in sequenza, salvare un Bug e interrompere/riprendere il giro. Farlo su copie temporanee, non modificando i documenti personali.

### Riepilogo della finalizzazione

Le undici regole dell’appendice sono state controllate su tutte le sezioni del corpo. Nessuna annotazione rimasta; nessuna domanda Waiting on o Released at finalize nel corpo. La raccomandazione sul runner è stabilita per default dichiarato, senza registrare una conferma inesistente. L’appendice è invariata.

Aggiornate **11 sezioni esistenti**, aggiunte **3 sezioni**.

| Sezione aggiornata | Esito della finalizzazione |
|---|---|
| How to work with this plan | Distinte finalizzazione, approvazione ed esecuzione |
| Interpretation Log | Stabilito il default dichiarato del runner senza conferma fittizia |
| Decisions I Need From You | Nessuna domanda dipendente; verifiche aperte rese visibili prima dell’approvazione |
| Conservazione del lavoro diagnostico | Versione candidata verificata localmente, controllo remoto e fallback espliciti |
| Settings | Definita la scrittura concorrente e la rilettura al focus |
| File, finestre e recupero | Definite identità dei lock, collisioni e limiti di acquisizione |
| Immagini e collegamenti | Scelto il protocollo minimo dopo verifica delle API di revoca mancanti |
| Bug e revisione per rilascio | Gestiti record troncati, rilevazione nuovi file e identità senza console Windows |
| Windows e rilascio | Distinta autorità di pubblicazione dai risultati tecnici del candidato |
| Verifica complessiva e prestazioni | Resi misurabili scadenze e completamento del recupero |
| Task Breakdown | Incluse prove macOS/Finder nella fase delle piattaforme |

Sezioni aggiunte: inventario dei tre elementi irrisolti nel reviewer surface; verifiche di chiusura con tracciamento di ogni segnalazione; questo riepilogo della finalizzazione.

---

## Operations Guide *(Appendix — instructions for any agent operating on this plan)*

Operations available on this plan. Any coding agent can follow these instructions.

## Operation Dispatch Rule

Identify the requested operation by the user's **exact** wording:

- `plan-cycle-annotate` → run section `## plan-cycle-annotate`.
- `plan-cycle-review` → run section `## plan-cycle-review`.
- `plan-cycle-finalize` → run section `## plan-cycle-finalize`.

**No aliases.** If wording doesn't exactly match one of the three, do NOT execute: reply

> Operazione non riconosciuta. Le operazioni valide su questo piano sono: `plan-cycle-annotate`, `plan-cycle-review`, `plan-cycle-finalize`.

Existing `> **NOTE**:` lines don't change the requested operation. For `plan-cycle-annotate`, never edit/remove/resolve/rewrite existing plan content.

## Grilling discipline

When an operation needs decisions from you, it grills. The discipline has **two renditions of one criterion**. Which rendition applies is decided by where the questions are delivered — never by the agent's judgement of the moment.

- **Interactive rendition** — live conversation, no document in front of the reader: **one question at a time**, wait for the answer before asking the next.
- **Document rendition** — this plan, reviewed over multiple passes. This is the default here. The first pass carries **every question that has no dependency on another**. When answers open new branches, the next pass carries every newly-unblocked question that has no dependency on another. Repeat until no branch is left open.

Two questions are dependent — and MUST NOT share a pass — if the answer to one would change the answer to the other, or change whether the other still needs asking.

**Ordering.** Within a pass, most critical first — the questions whose answers change the most other answers — then the marginal ones.

**Scope fence.** Only the request under discussion. Do not drift into adjacent topics, however tempting.

**Explore before asking.** If the codebase or the plan can answer it, investigate and state the finding instead of asking.

**Termination.** Continue until shared understanding is reached and no branch is left open.

### Question format, by kind of request

There are two kinds. The **operation that produces the request** decides which — not the agent's assessment of length or importance.

**Decision question** — produced by a freshly written plan, by `plan-cycle-review` when an annotation is unclear, or whenever the planner is uncertain. Five fields, all mandatory:

- **Context** — the situation in plain language.
- **Why it matters** — what changes depending on the answer.
- **Options** — the possible choices, named.
- **Trade-offs** — the concrete consequence of each option.
- **Recommendation** — the suggested answer with a one-line reason; it is also what the planner assumes if you do not answer.

**Unresolved item** — produced only by the closing inventory of `plan-cycle-finalize`. Not an open question but a known gap with a binary choice, so it carries a shorter format. Four fields:

- **What is unresolved** — the item, quoted or cited.
- **Why it cannot be settled now** — the verification that is missing.
- **Consequence of proceeding as-is** — concrete, never "may cause issues".
- **Recommendation** — resolve before execution, or proceed knowingly.

### Humanized context

The plan stays rigorous: paths, signatures, thresholds and markers are mandatory wherever they belong. But **wherever the document asks instead of describing** — the Interpretation Log, Decisions I Need From You, the unresolved-items inventory, and any question raised during review — the context must be humanized:

- **A citation is a pointer, not an explanation.** Never rely on naming a thing to make it understood.
- If a question depends on a constraint, a decision or another section, **restate its substance in plain words inside the question**, then put the reference next to it.
- No internal codes, section numbers or question numbers standing in for the thing itself. A sentence such as "constraint A2 conflicts with S3 in the solution to Q1" carries a cognitive load that makes it useless, however accurate it is.

No pass re-checks this automatically. If a question is unclear or badly framed, annotate it — see the **Unclear question** intent below. That annotation is the correction mechanism.

### First wave

The **Interpretation Log** and **Decisions I Need From You** sections of a freshly written plan *are* the first wave of the document rendition; `plan-cycle-review` and `plan-cycle-finalize` carry the waves that follow. All of them use the same Decision question format above — there is one question format across the whole cycle.

**Dependencies inside the first wave.** The two sections share one pass, so the dependency rule binds across them. A `Decisions I Need From You` entry whose answer — or whose very relevance — depends on how an `Interpretation Log` entry is confirmed **MUST NOT** be asked in this wave. Instead, list it with a plain-language **Context** — the Humanized context rule still binds, so a bare cross-reference is not enough — plus `**Waiting on:** <the Interpretation Log entry it depends on>`, and no options and no recommendation. Step 5 of `plan-cycle-review` asks it as a full Decision question once the entry it waits on reads **Status:** `Confirmed.` — the marker in the document, not the agent's memory of the conversation, is what unblocks it. Any question still waiting when `plan-cycle-finalize` runs is released there: an unconfirmed reading stands as written, so it counts as settled and the question is finally asked.

## plan-cycle-annotate

**Purpose.** Annotations are the review channel on this plan. They exist to **find what is wrong with it and to make it better before anyone executes it** — errors, gaps, unstated assumptions, weak criteria, missed improvements. An annotation *marks* the plan; it never changes it. Multiple annotation passes may run before a single review pass, so a pass is worth running even when it finds one thing.

**What to annotate.** Use this as a checklist on every pass — a plan that reads well is not the same as a plan that is right:

- **Factual error** — a claim about the codebase that is wrong. *"This file does not export that symbol."*
- **Gap** — something the plan must cover and does not. *"Nothing says what happens to records that already exist."*
- **Assumption sold as certainty** — a claim stated flatly that was never verified. *"Was this checked, or assumed?"*
- **Disagreement with the approach** — the plan is coherent but the strategy is wrong. *"This should extend the existing pipeline, not add a second one."*
- **Success criterion that is not user-observable** — the criterion checks infrastructure, not outcome. *"'Service starts' does not prove a user can do anything."*
- **Risk without an exit clause** — a risk is named but nothing says when to abandon it. *"When do we give up on this, and switch to what?"*
- **Request for clarification** — something you cannot evaluate because you do not understand it. *"What does 'compatible' mean here, concretely?"*
- **Unclear question** — a question the plan asks *you* that you cannot decide on as written. *"Explain this better."* Nothing re-checks question quality automatically; this annotation is the correction mechanism.
- **Improvement proposal** — the plan is not wrong, but it could be better. *"Doing this in the same pass would halve the work."*

**Format:** `> **NOTE**: [tag?] comment`. Tags: `[impact]` (plan-impact skill), `[quality: <criterion>]` (plan-quality skill), none (user). `plan-cycle-review` processes all uniformly — the list above classifies **intent**, not syntax, and introduces no new tags.

Add annotations below the section/task they refer to. Do NOT modify plan content — only add notes.

**Safety check:** before editing, state "plan-cycle-annotate mode: I will only add `> **NOTE**:` lines." After editing, verify the diff only adds notes + blank spacing; if it removes/modifies non-note text, revert and redo.

## plan-cycle-review

1. Read the entire plan.
2. Find all `> **NOTE**:` lines.
3. For each: understand, update plan, remove annotation. If the annotation confirms an `Interpretation Log` reading, set that entry's **Status** to `Confirmed.` **before** removing the note — step 5 reads that marker, and removing the note destroys the only other evidence that the reading was settled.
4. If unclear, keep the annotation and resolve it via the **Grilling discipline** (above), using the **Decision question** format.
5. **Deferred questions** — scan `Decisions I Need From You` for entries marked `Waiting on:`. Ask, in this pass and as a full **Decision question** (all five fields), every one whose blocking `Interpretation Log` entry now reads **Status:** `Confirmed.`, and drop its `Waiting on:` marker; leave the others waiting. The test is the marker in the document, never your recollection of the conversation — a fresh agent has no recollection, and this step must work for it too. Without this step a deferred question is never posed and merely resurfaces in the closing inventory.

## plan-cycle-finalize

Make the plan operative, self-contained, coherent, robust — a fresh agent must execute it without prior context.

1. Read the entire plan.
2. For each section, check ALL 11 rules: Self-contained, Operative, Outcome-layer success, Numbers-not-adjectives, Exit clauses, Explicit degradation, Verify-before-claim, Enumerate-universals, Mark-unverifiable, Coherent, Robust.
3. Rewrite every failing section — do not annotate.
4. Report: sections updated count + one-line summary per section.
5. **Release the still-waiting questions** — an `Interpretation Log` entry whose **Status** never became `Confirmed.` stands as written; its own Recommendation says so. It is therefore settled now, by default, and nothing is gained by waiting further. Ask every remaining `Waiting on:` question as a full **Decision question**, replacing its `Waiting on:` line with `**Released at finalize.**` — swap the marker, never simply delete it: that line is how step 6 finds the question, and a silently dropped marker hides it from the inventory. A question left waiting forever is a question never asked.
6. **Unresolved Items Inventory** — list every remaining TODO, `assumed:`, `unverified:`, and every question marked `**Released at finalize.**` that is still unanswered. That last category is not redundant with step 5: a question deferred across passes and then asked in the same breath as the approval can otherwise be settled by your silence without ever being surfaced — the exact shape this step exists to prevent. Its inventory entry is the binary framing of the question above it: what stays undecided, and what the default costs. Present them as **one single list in one pass** (document rendition of the **Grilling discipline** above): these items are independent by construction, so none of them waits on another. Each item uses the **Unresolved item** format — what is unresolved, why it cannot be settled now, consequence of proceeding as-is, recommendation between *resolve before execution* and *proceed knowingly with consequence stated*. If an answer opens a real question, that question becomes the next wave, in the Decision question format. Approval is invalid without this step.

## General Principles

- `plan-cycle-annotate` may only add `> **NOTE**:` annotations — never rewrites.
- `plan-cycle-review` and `plan-cycle-finalize` rewrite plan content directly.
- Multiple annotate passes can run before a single review pass.
- The plan is approved only when the owner explicitly says so.
