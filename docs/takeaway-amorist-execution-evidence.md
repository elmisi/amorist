# Retrospettiva dell'esecuzione Amorist

Data: 2026-10-15. Stato: valutazione iniziale basata sul piano approvato,
sul registro della sessione e sulle prove locali; implementazione in pausa.
Ambito: processo di pianificazione, implementazione e verifica.

## Dati verificati e limiti

- Primo campione del thread: quota usata 2%; arresto: 40% alle
  2026-10-14T23:13:49Z. Delta osservato: 38 punti percentuali.
  Il proprietario ha confermato il2026-10-15 che non erano attive altre sessioni:
  il consumo precedente è interamente attribuito a questa task.
- Dalla baseline diagnostica 385f953 all'arresto: 239 commit;
  61 solo documentazione/report, 117 con codice frontend/backend,
  61 con test, infrastruttura o altri file. Le categorie non misurano il costo.
- L'ultimo contatore cumulativo prima dell'arresto riporta 642.715.815 token
  input, di cui 636.943.488 in cache, e 2.096.137 output. Non sommare il totale
  input come se fosse nuovo lavoro: la parte non in cache è 5.772.327.
  Non esiste qui una conversione verificata di questi contatori in quota settimanale.
- Il piano descrive tredici attività, un insieme esteso di sintassi Markdown,
  recupero e clipboard, più pacchetti e accettazione reale su tre piattaforme.
  Non era una piccola modifica alle preferenze.

## Pattern 1: ampiezza senza budget operativo

Principio candidato: associare ai requisiti un limite di spesa e una sequenza
di candidati verificabili prima di iniziare un'esecuzione lunga.

Il piano specifica dettagliatamente comportamento e gate, inclusi i rischi
Windows, macOS e baseline. Mancano una stima di costo per fase, un budget di
indagine e punti obbligatori di rivalutazione. L'ampiezza tecnica era dichiarata,
ma non tradotta in costo comprensibile. Osservato in questa esecuzione.

## Pattern 2: verifiche e stato frammentati

Principio candidato: mantenere una sola matrice aggiornata requisito-prova e
raggruppare cambiamenti coerenti prima delle verifiche di rilascio.

Il registro editor-development-progress.json conservava descrizioni storiche
con funzionalità ancora dichiarate pending e Windows non implementato, benché
sezioni successive registrassero avanzamenti. Gli ultimi turni hanno corretto
parte di questa incoerenza. I 61 commit solo di documentazione/report sono
un indicatore di granularità eccessiva, non una misura diretta di spreco.
Ripetizioni di suite, build, letture e ricostruzioni del contesto hanno aumentato
l'attività dell'agente. Non tutta la ripetizione era inutile: cambiamenti al
runtime richiedevano nuove prove. Frequenza: ripetuta nella stessa esecuzione.

## Pattern 3: ambiente e automazione confusi con difetti del prodotto

Principio candidato: dimostrare il funzionamento dell'ambiente e riprodurre
un guasto attraverso un percorso indipendente prima di modificare il prodotto.

Esempi documentati: preparazione SSH/toolchain Windows; gestione stderr ed
exit code PowerShell; Safari senza frame con sessione macOS bloccata; plugin
AVIF mancanti nell'AppImage; necessità di un ambiente Linux isolato per installare
senza privilegi sull'host. Questi sono costi reali di piattaforma e QA.

Esempio finale discriminante: Ctrl+Shift+V tramite Edge WebDriver produceva due
eventi paste; Windows SendKeys ne produceva uno e il contenuto era corretto.
Il test è stato adattato conservando le asserzioni, senza cambiare il runtime.
Frequenza: ostacoli di ambiente diversi e ripetuti nella stessa esecuzione.

## Cosa mantenere

Conservazione di file e diagnostica originali; baseline prima delle modifiche;
identità e hash dei candidati; gate che distinguono prova parziale e completa;
nessun push/pubblicazione; preview Linux esplicitamente autorizzata.

## Valutazione delle cause

La responsabilità principale dell'eccesso evitabile è la conduzione dell'agente:
troppa frammentazione e indagine, poco controllo preventivo del costo.
Il piano era forte sul comportamento e debole come contratto economico.
Rust aggiunge compilazione e complessità del backend, ma molte difficoltà erano
nel mapping DOM/sorgente JavaScript e nell'interazione con webview e sistema.
Gli installer e le prove native hanno inciso; i pochi minuti di una singola
compilazione non spiegano da soli l'attività sostenuta dell'agente.
Non sono disponibili dati sufficienti per percentuali causali affidabili.

## Previsione residua, non impegno

Stima di pianificazione: ulteriori 5–10 punti di quota settimanale con sessioni
grafiche disponibili, verifiche raggruppate e senza rifacimenti sostanziali.
Se emergono difetti nativi o lacune funzionali nell'audit, 10–15 punti sono uno
scenario di rischio, non un tetto garantito. L'audit completo resta da fare:
non è dimostrato che manchi soltanto il packaging.

Restano: accettazione nativa Windows e migrazione/uninstall attuali; Safari e
pacchetto macOS con Finder/Dock, dialoghi, clipboard, immagini e preferenze;
DMG; audit di tutti i requisiti, documentazione, dipendenze e distinta finale.
App universale macOS costruita per entrambe le architetture; runtime ARM non provato.

Prima di riprendere: negoziare un budget aggiuntivo esplicito, controllare il
delta di quota per lotto e fermare l'indagine al punto concordato riportando
il difetto residuo. Non indebolire i gate per rispettare il budget.
