# Stato della verifica del candidato 0.10.10

La sorgente dell'app confezionata è `ba1f626b1ed21bc5d7d47ac4c88540c79f096eb3`. Le modifiche successive riguardano runner di revisione, strumenti QA e documentazione; non cambiano il codice dell'app nei pacchetti. La consegna finale resta bloccata: le nuove segnalazioni BUG-011–013 sono conservate e accodate, con riproduzione e classificazione ancora da completare. Nessun push o pubblicazione è autorizzato.

## Evidenze correnti

Il registro `.qa/reports/editor-development-requirement-audit.json` associa tutti i 38 requisiti bloccanti alle prove delle tre piattaforme. Le suite complete hanno exit code zero, nessun motore richiesto indisponibile e nessun errore del runner. REQ-H4 è delegato dalle suite: la sua prova è composta dai controlli macOS nativi, non dal solo risultato Safari. REQ-G3 rimane una verifica manuale advisory, senza attribuire al proprietario un passaggio manuale che non ha eseguito.

| Piattaforma | Prove |
| --- | --- |
| Linux | Suite completa; 11 controlli su eseguibile, deb e AppImage; immagini senza decoder AV1 dell'host; clipboard e loop reali; recupero con scritture misurate; aggiornamento installato 0.10.8 → 0.10.10 con dati conservati |
| Windows 10 VMware | Suite su app WebView2 installata ed Edge; clipboard reale; dialoghi Open/Save As reali; crash/recovery e CLI; immagini; Settings/Bug; Ctrl+clic verso Markdown, file di testo e browser predefinito; installazione, disinstallazione e reinstallazione con 130 file di dati conservati |
| macOS Lestrade | Suite Safari/Chromium; DMG universale verificato, montato in sola lettura e app copiata; avvio a freddo di due file con scelta di recupero; Cmd+clic Markdown con ancora, TextEdit e browser; attivazione delle due finestre dal Dock; sorgente e file invariati |

Le prove native macOS di dialoghi, clipboard, Settings/Bug, immagine, salvataggio negato, chiusura dirty e apertura a caldo restano attribuite alla precedente sorgente `dda92bf`. La modifica runtime successiva riguarda la disponibilità della finestra iniziale durante il recupero: quel percorso è stato ricostruito e riprovato sul DMG `ba1f626`, con esattamente due finestre e nessuna Untitled aggiuntiva. Le evidenze originali non sono riscritte per farle apparire più recenti.

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

## Nuovi feedback

Vedere `docs/bug-feedback-backlog.md` e il registro locale completo indicato lì. BUG-011 riguarda la geometria della riga vuota dopo un separatore, BUG-012 l'ordine del dialogo link, BUG-013 l'interpretazione di fence annidate. Non sono dichiarati risolti dalle suite già verdi: vanno riprodotti sui dati catturati e classificati prima di liberare la consegna. I problemi della base comune restano bloccanti.

Le sonde Windows validate sono ora nel repository: `tests/editor-native-windows-smoke.test.js`, `tests/editor-native-windows-links.test.js` e il test immagini nativo condiviso. Richiedono una sessione interattiva e `AMORIST_QA_APPLICATION`/`AMORIST_QA_EDGE_DRIVER` rivolti al candidato e al driver compatibile. Gli opener avviano le applicazioni associate ed `https://example.com`; usarle nella sessione QA preparata. Le preferenze originali vengono ripristinate e i report QA restano in append.
