# Stato della verifica del candidato 0.10.10

La sorgente dell'app confezionata è `636464301cd52410c784eb5d6e0cbc1f01614f2c`. La consegna locale è verificata: tutti i 38 requisiti bloccanti hanno evidenze passate e tutti i 13 feedback inventariati hanno una correzione verificata o una spiegazione esplicita. Le modifiche successive riguardano soltanto strumenti QA e documentazione. Nessun push o pubblicazione è autorizzato.

## Evidenze correnti

Il registro `.qa/reports/editor-development-requirement-audit.json` associa tutti i 38 requisiti bloccanti alle prove delle tre piattaforme. Le suite complete hanno exit code zero, nessun motore richiesto indisponibile e nessun errore del runner. REQ-H4 è delegato dalle suite: la sua prova è composta dai controlli macOS nativi, non dal solo risultato Safari. REQ-G3 rimane una verifica manuale advisory, senza attribuire al proprietario un passaggio manuale che non ha eseguito.

| Piattaforma | Prove |
| --- | --- |
| Linux | Suite completa; 14 controlli su eseguibile, deb e AppImage; immagini senza decoder AV1 dell'host; clipboard e loop reali; recupero con scritture misurate; aggiornamento installato 0.10.8 → 0.10.10 con dati conservati |
| Windows 10 VMware | Suite su app WebView2 installata ed Edge; clipboard reale; dialoghi Open/Save As reali; crash/recovery e CLI; immagini; Settings/Bug; Ctrl+clic verso Markdown, file di testo e browser predefinito; installazione, disinstallazione e reinstallazione con 130 file di dati conservati nel ciclo uninstall/reinstall e 136 conservati nell’ultimo aggiornamento del candidato |
| macOS Lestrade | Suite Safari/Chromium; DMG universale verificato, montato in sola lettura e app copiata; avvio a freddo di due file con scelta di recupero; Cmd+clic Markdown con ancora, TextEdit e browser; attivazione delle due finestre dal Dock; sorgente e file invariati |

Il DMG corrente è stato verificato anche con apertura a freddo di due file, scelta di continuare senza recupero, esattamente due processi, sorgente esatto, dialogo link nativo, Annulla e Cmd+clic con ancora. Le prove macOS precedenti di dialoghi file, clipboard, Settings/Bug, immagine, salvataggio negato, chiusura dirty, Dock e apertura a caldo mantengono la propria attribuzione (`dda92bf`/`ba1f626`). Dal precedente candidato `ba1f626` al corrente è cambiato soltanto `web/editor/amorist-editor.css`: il confronto del runtime è verificato e registrato nell'audit. Le prove precedenti non vengono riscritte come se fossero nuove.

L'aggiornamento numerico Windows usa una registrazione precedente 0.10.9 simulata sul candidato 0.10.10; non dimostra l'aggiornamento da un vecchio binario Windows pubblicato. La sostituzione del precedente candidato reale, la conservazione dei dati, la disinstallazione e la reinstallazione sono invece prove effettive. Il binario macOS contiene x86_64 e arm64; il runtime nativo è stato verificato sul Mac Intel disponibile.

I report storici contengono una descrizione troppo ampia della copertura mancante, che non riconosceva l'app Windows WebView2 già esercitata. Sono conservati intatti; il testo dei report futuri è stato corretto senza modificare esiti o severità.

## Artefatti locali

Il manifest `.qa/reports/editor-development-candidate-artifacts.json` conserva checksum, identità e storico dei candidati. Sono disponibili localmente:

- `src-tauri/target/release/amorist`
- `src-tauri/target/release/bundle/deb/amorist_0.10.10_amd64.deb`
- `src-tauri/target/release/bundle/appimage/amorist_0.10.10_amd64.AppImage`
- `src-tauri/target/release/bundle/nsis/amorist_0.10.10_x64-setup.exe`
- `src-tauri/target/release/bundle/dmg/amorist_0.10.10_universal.dmg`

Il comando di anteprima Linux rimane:

```bash
python3 scripts/review-markdown-files.py --debug --amorist src-tauri/target/release/amorist
```

La successiva istruzione del proprietario sostituisce la precedente scelta del piano sul nuovo giro: non azzerare mai il contatore per una nuova versione. Il runner unisce i percorsi completati nella cronologia legacy e nelle build precedenti, conservando l'attribuzione storica. I test verificano aggiornamento, interruzione, lock e conservazione dei dati; il loop con app Linux reale è passato nuovamente. Lo stato personale non è stato riscritto.

## Feedback e chiusura

Vedere `docs/bug-feedback-backlog.md` e il registro locale completo indicato lì. BUG-011 è corretto: il separatore non aggiunge righe vuote visive oltre a quelle del sorgente. BUG-012 ha un dialogo ordinato, campo a tutta larghezza e azioni allineate. BUG-013 è spiegato e coperto: una fence identica chiude il blocco corrente; per contenere tripli backtick in un solo blocco occorre un delimitatore esterno più lungo. La cattura originale resta intatta.

Sono passati la suite completa sulle tre piattaforme, 14 gruppi sui pacchetti Linux, sette gruppi sull'app Windows installata, i nuovi controlli nativi del DMG e le regressioni mirate. Le misure di recupero correnti comprendono 80 checkpoint effettivi per la suite Linux e altri 80 sull'AppImage, entro i limiti già approvati. Gli errori iniziali di ambiente/sonda sono conservati separatamente e non vengono scambiati per prove superate.

Lo stato corrente è in `currentCrossPlatformSource`, `requirementAudit` e nel manifest; il registro di avanzamento conserva anche tappe, blocchi ed errori storici. I campi `currently_holds` del contratto descrivono l'audit originario: i verdetti correnti sono nell'audit della consegna e nei report associati.


Le sonde Windows validate sono ora nel repository: `tests/editor-native-windows-smoke.test.js`, `tests/editor-native-windows-links.test.js` e il test immagini nativo condiviso. Richiedono una sessione interattiva e `AMORIST_QA_APPLICATION`/`AMORIST_QA_EDGE_DRIVER` rivolti al candidato e al driver compatibile. Gli opener avviano le applicazioni associate ed `https://example.com`; usarle nella sessione QA preparata. Le preferenze originali vengono ripristinate e i report QA restano in append.
