# Lezioni per esecuzioni con budget limitato

Data: 2026-10-15. Ambito: processo riutilizzabile.
Evidenza: documento di retrospettiva affiancato a questo file.

## Principio guida

Trattare il costo dell'esecuzione come un requisito operativo: rendere visibili
ampiezza, incertezza e consumo, senza ridurre implicitamente la qualità promessa.

## Budget e incertezza

Distinguere la precisione del comportamento desiderato dalla prevedibilità
del costo. Definire prima del lavoro lotti, budget di indagine e punti di
rivalutazione. Segnalare quando un lotto esce dalle ipotesi concordate.

Principio generale: un piano dettagliato richiede comunque limiti operativi.
Copre il pattern 1 dell'evidenza.

## Stato e validazione

Mantenere un solo quadro corrente dei requisiti e delle prove. Conservare lo
storico separatamente, senza lasciare che stati obsoleti guidino nuove indagini.
Raggruppare correzioni coerenti, eseguire verifiche mirate durante lo sviluppo
e verifiche complete sul candidato. Ripeterle quando cambia ciò che certificano.

Principio generale: ogni verifica aggiuntiva deve risolvere un'incertezza corrente.
Copre il pattern 2 dell'evidenza.

## Ambiente e prodotto

Verificare accesso, sessione, strumenti e un gesto rappresentativo prima di
estendere l'automazione. Quando una prova fallisce, confrontare un percorso
indipendente e conservare la prima evidenza negativa prima di correggere.

Principio generale: attribuire il guasto prima di modificare il sistema provato.
Copre il pattern 3 dell'evidenza.

## Istruzioni operative

1. Preparare gli ambienti e dimostrare un caso rappresentativo per piattaforma.
2. Presentare ampiezza, stima e condizioni che possono invalidarla.
3. Collegare ogni requisito a una prova e ogni prova alla revisione verificata.
4. Usare lotti coerenti e aggiornare lo stato al termine del lotto.
5. Interrompere indagini ripetitive al budget concordato e rendere il residuo visibile.
6. Conservare dati originali, diagnosi e requisiti di accettazione.

## Esclusioni dalla distillazione

Comandi specifici, nomi di strumenti, percorsi, metriche della sessione e singoli
workaround restano nel documento di evidenza: non sono regole universali.

## Questione aperta

Scegliere prima della ripresa quanto budget aggiuntivo assegnare e quando
rivalutare l'opportunità di proseguire. Un limite di spesa non autorizza una
dichiarazione di completamento priva delle prove richieste.
