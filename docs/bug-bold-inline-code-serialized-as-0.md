# Bug: bold che avvolge inline-code viene serializzato come `**0**` al salvataggio

**Tipo:** corruzione dati silenziosa al salvataggio
**Gravità:** alta — l'utente perde contenuto senza accorgersene; il file resta valido (nessun errore), ma il testo è alterato
**Data osservazione:** 2026-05-25
**Binario:** `/usr/bin/amorist` — `BuildID[sha1]=43c1bea07cc905a20040bb0a7625fd8f15d35ce3` (`amorist --version` non disponibile)

## Sommario

Quando un file markdown contiene del **grassetto che avvolge un inline-code** (asterischi doppi attorno a un code span), al salvataggio amorist lo riscrive come la stringa letterale `**0**`, perdendo del tutto il contenuto originale. Succede in prosa e in liste, con o senza spazi interni. **Non** succede dentro le celle di tabella, dove il costrutto sopravvive intatto.

Questo dimostra che il salvataggio NON è pass-through del sorgente: amorist fa un round-trip attraverso un AST e ri-serializza. Il bug è nel serializer del nodo emphasis/strong quando il suo contenuto è (o contiene solo) un nodo code.

## Riproduzione

1. Creare un file con questo contenuto:

   ```markdown
   1. bold+code attaccato: **`PROVA1`**
   2. bold+code dentro frase: prefisso **`PROVA2`** suffisso
   3. code da solo (controllo): `PROVA3`
   4. bold da solo (controllo): **PROVA4**
   5. bold con spazio prima del code: ** `PROVA5` **
   6. lista:
      - voce **`PROVA6`** nella lista

   | Col A | Col B |
   |---|---|
   | x | **`PROVA7`** |
   ```

2. Aprire il file in amorist.
3. **Senza modificare nulla**, salvare (Ctrl+S) e chiudere.
4. Confrontare il file con l'originale (`diff`).

## Comportamento osservato vs atteso

| Caso | Sorgente | Atteso (round-trip identità) | Osservato |
|---|---|---|---|
| PROVA1 — bold+code attaccato | `**` + code + `**` | invariato | `**0**` |
| PROVA2 — bold+code in frase | `…**`+code+`**…` | invariato | `**0**` |
| PROVA5 — bold con spazi attorno al code | `**` ` ` code ` ` `**` | invariato | `**0**` |
| PROVA6 — bold+code in lista | `- voce **`+code+`**` | invariato | `- voce **0**` |
| PROVA3 — code da solo | code span | invariato | invariato (ok) |
| PROVA4 — bold da solo | `**PROVA4**` | invariato | invariato (ok) |
| PROVA7 — bold+code in cella tabella | `**`+code+`**` | invariato | invariato (ok) |

Diff reale osservato (estratto):

```diff
< 1. bold+code attaccato: **`PROVA1`**
< 2. bold+code dentro frase: prefisso **`PROVA2`** suffisso
---
> 1. bold+code attaccato: **0**
> 2. bold+code dentro frase: prefisso **0** suffisso
```

## Ambito e indizi per il debug

- Colpisce **strong (bold) il cui figlio è un inline-code**, in **prosa e liste**, con o senza spazi interni.
- **Non** colpisce: code da solo, bold da solo (su testo semplice).
- **Non** colpisce lo stesso costrutto dentro le **celle di tabella** → il path di rendering/serializzazione delle celle è diverso e corretto. Confrontare i due path è probabilmente la via più rapida alla causa.
- Il valore prodotto è la cifra `0`: suggerisce che il serializer, di fronte a un nodo strong il cui unico figlio è un code span, emetta `0` (valore falsy / indice / lunghezza?) invece di ri-emettere `` **`...`** ``. Punto da ispezionare: la funzione che serializza i nodi emphasis/strong → markdown, ramo "figlio è inline-code".

## Normalizzazioni aggiuntive osservate (stesso salvataggio)

Probabilmente volute, ma segnalate per completezza — confermano il round-trip via AST:
- Tabelle ri-allineate (padding a larghezza colonna + riga separatrice normalizzata a trattini).
- Liste riflesse (riga vuota inserita prima della lista; indentazione delle voci modificata).
- Newline finale del file rimosso (`\ No newline at end of file`).

## Impatto pratico

Qualsiasi documento markdown tecnico — che usa spesso `` **`nome`** `` per evidenziare nomi di comandi/file/parametri in grassetto-codice — viene corrotto silenziosamente alla prima apertura+salvataggio in amorist. L'utente non vede l'errore finché non rilegge il sorgente o un diff.

## Verifica della fix suggerita

Aggiungere un test di round-trip che apra e ri-serializzi il file di riproduzione sopra e asserisca l'identità byte-per-byte (escluse le normalizzazioni volute, se confermate). Casi minimi da coprire: bold+code in prosa, in lista, con/senza spazi, in cella di tabella (deve restare il path corretto).
