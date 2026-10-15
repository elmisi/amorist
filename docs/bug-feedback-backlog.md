# Feedback Bug e continuità della revisione

Il registro locale completo e append-only è `~/.local/share/dev.elmisi.amorist/pending-bug-reports.jsonl`; la lista leggibile è `pending-bug-reports.md` nella stessa cartella. Le catture originali restano intatte. Reimportare con `python3 scripts/queue-bug-reports.py` accoda solo nuovi record completi, identificati da SHA256; non modifica stato, contatore o cronologia del loop.

| ID | Segnalazione | Stato |
| --- | --- | --- |
| BUG-001–010 | Feedback precedenti | Verifiche esistenti in `.qa/reports/editor-problem-cases-20261013.json`; conservati nel registro completo |
| BUG-011 | Riga vuota aggiuntiva nel WYSIWYG tra separatore e punto elenco | Corretto nel sorgente; verifica pacchetti in attesa |
| BUG-012 | Dialogo di modifica link spartano e poco ordinato | Impaginazione migliorata; verifica pacchetti in attesa |
| BUG-013 | Fence con backtick annidate ancora problematiche | Comportamento spiegato; cattura originale e regressione verificate |

Il loop considera completati i percorsi presenti in qualsiasi build precedente e nel registro legacy. Le nuove build mantengono la posizione nella lista; la cronologia per build rimane distinta. Un file interrotto o fallito viene riproposto, senza perdere quelli già completati. Non azzerare mai il contatore né riscrivere lo stato personale per un cambio di versione.

Verifica: 8 test del runner passati, inclusi migrazione legacy, cambio versione, nuova voce al terzo posto, lock concorrente e conservazione dello stato corrotto. Importazione provata due volte: 13 record accodati, poi zero duplicati; stato personale e report originali invariati byte per byte.

## Prima analisi dei nuovi record

- BUG-011: il sorgente catturato contiene esattamente `---\n\n- ...`, quindi una sola riga vuota. La regola CSS del separatore aggiunge `margin: 0.65em 0`, coerente con lo spazio visivo aggiuntivo segnalato. Serve un riproduttore geometrico prima della correzione.
- BUG-012: richiesta di riordinare e rifinire il dialogo link; il flusso funzionale esistente è verificato, ma questo feedback visivo non è risolto da quelle prove.
- BUG-013: la cattura contiene una fence iniziale a tre backtick con info `text`, seguita da altre fence identiche. La prima fence identica chiude il blocco iniziale; il solo testo della nota non distingue questo comportamento Markdown dall'eventuale problema di interazione. Occorre riprodurre la cattura e distinguere riconoscimento, modifica e delimitatori generati; non classificare automaticamente la segnalazione come risolta.

## Esito delle verifiche sul sorgente

BUG-011 fallisce prima della correzione e passa dopo: il separatore non aggiunge spazio rispetto a tre righe fisiche equivalenti, con dimensioni 12/16/24 e CRLF conservati. BUG-012 ha ora campo a tutta larghezza, azioni allineate, focus visibile e spaziatura uniforme; i controlli funzionali dei link restano verdi, con controllo visivo anche a 380 pixel di viewport. La verifica dei nuovi pacchetti resta aperta.

Per BUG-013 la prima fence identica chiude il blocco, anche con info `text`; le fence non si annidano usando lo stesso delimitatore. La cattura completa passa senza riscrittura, e la regressione ridotta include CRLF e intestazioni letterali. Per includere tripli backtick come testo in un unico blocco, usare almeno quattro backtick per i delimitatori esterni. I delimitatori generati dall'editor scelgono già una lunghezza sicura. Questa spiegazione non modifica il file personale.
