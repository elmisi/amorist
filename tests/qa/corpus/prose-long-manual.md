---
title: Manuale di manutenzione dell'impianto idrico
autore: consorzio di valle
revisione: 7
data: 2025-09-14
stato: bozza avanzata
---

# Manutenzione dell'impianto idrico consortile

Questo documento raccoglie le procedure che il consorzio applica agli
impianti di captazione, sollevamento e distribuzione. Sostituisce la
revisione precedente, che descriveva ancora la vecchia centralina
elettromeccanica dismessa nell'autunno del duemilaventitre.

Ogni paragrafo e' mandato a capo a mano attorno alla settantesima
colonna, perche' viene riletto quasi sempre in un terminale stretto
oppure stampato su fogli affiancati durante i sopralluoghi. Chi lo
modifica e' pregato di conservare questa abitudine: una riflussatura
automatica renderebbe illeggibile qualunque revisione successiva.

## Premessa sulla nomenclatura

Le denominazioni usate qui derivano dal catasto consortile del 1978 e
non coincidono sempre con quelle catastali attuali. Dove la differenza
puo' generare equivoci viene indicata fra parentesi quadre.

- Captazione: qualunque opera che preleva acqua dalla sorgente.
- Sollevamento: le stazioni di pompaggio intermedie.
- Compenso: i serbatoi che assorbono le oscillazioni giornaliere.
- Distribuzione: la rete a valle del compenso, fino ai contatori.

## Calendario delle ispezioni

| Opera | Frequenza | Responsabile | Ultima verifica |
| --- | --- | --- | --- |
| Sorgente Barbagianni | mensile | squadra alta valle | 2025-08-30 |
| Stazione Cerreto | settimanale | Fioravanti | 2025-09-08 |
| Serbatoio Malandrino | trimestrale | squadra bassa valle | 2025-07-02 |
| Riduttore Sciamano | annuale | ditta esterna | 2025-03-11 |

Le frequenze indicate sono minimi contrattuali. In presenza di torbidita'
anomala l'ispezione va anticipata senza attendere autorizzazione, e
comunicata entro la giornata al referente reperibile.

## Procedura di spurgo

1. Chiudere la saracinesca di monte e attendere lo svuotamento naturale.
2. Verificare che il manometro scenda sotto la soglia di sicurezza.
3. Aprire lo scarico di fondo procedendo dal ramo piu' distante.
4. Registrare la quantita' di sedimento raccolto nel quaderno di cantiere.
5. Richiudere lo scarico prima di riaprire la saracinesca di monte.

> Lo spurgo eseguito in ordine inverso ha provocato, nel duemiladiciannove,
> il distacco di un tratto di condotta in ghisa presso la localita'
> Pozzomerlo. L'ordine indicato sopra non e' una preferenza: e' la
> conseguenza di quell'episodio.

### Sedimenti ricorrenti

Il sedimento prevalente nella parte alta e' sabbia quarzosa di origine
morenica, che non presenta criticita' particolari. Nella parte bassa
prevalgono invece incrostazioni ferrose, che vanno smaltite secondo il
codice previsto dal regolamento provinciale.

## Telemetria

Le stazioni trasmettono ogni quarto d'ora. Il formato del messaggio e'
il seguente:

```json
{
  "stazione": "cerreto",
  "portata_litri_secondo": 12.4,
  "pressione_bar": 3.1,
  "torbidita_ntu": 0.8,
  "timestamp": "2025-09-14T06:15:00Z"
}
```

La lettura dei messaggi arretrati si ottiene interrogando l'archivio
locale, che conserva novanta giorni:

```bash title="lettura arretrati" {2}
telemetria-cli letture --stazione cerreto \
  --dal 2025-08-01 --al 2025-08-31 --formato tabella
```

Il campo della torbidita' e' il solo che faccia scattare un allarme
automatico. Gli altri vengono registrati e riletti in sede di verifica
mensile, senza generare notifiche.

~~~python
def soglia_allarme(torbidita, pioggia_mm):
    if pioggia_mm > 40:
        return torbidita > 2.5
    return torbidita > 1.2
~~~

## Anomalie osservate e non ancora spiegate

Alcune osservazioni ricorrono da anni senza che sia stata trovata una
spiegazione soddisfacente. Vengono elencate perche' chi subentra non
perda tempo a riscoprirle.

* La stazione Cerreto segnala un calo di pressione ogni martedi'
  mattina, indipendentemente dal prelievo effettivo a valle.
+ Il serbatoio Malandrino perde circa due centimetri di battente nelle
  notti particolarmente fredde, e li' recupera all'alba.
- Il riduttore Sciamano produce un fischio udibile solo quando la
  portata scende sotto i quattro litri al secondo.

Nessuna delle tre anomalie ha finora prodotto conseguenze operative.
Sono annotate qui perche' un giorno potrebbero averne, e perche' il
ricordo verbale di queste cose si perde nel giro di due ricambi di
squadra.

## Interventi straordinari

Un intervento e' straordinario quando modifica la geometria della rete,
non quando e' semplicemente urgente. La distinzione conta per il
regime autorizzativo, e viene sbagliata spesso.

1. Sostituzione di un tratto con diametro diverso.
1. Inserimento o rimozione di un nodo.
1. Modifica della quota di uno sfioro.
1. Collegamento di una nuova utenza superiore ai due litri al secondo.

Tutti gli altri lavori, compresa la sostituzione integrale di una pompa,
restano ordinari anche quando comportano un fermo prolungato.

### Documentazione richiesta

    relazione tecnica firmata
    planimetria aggiornata in scala 1:2000
    dichiarazione di conformita' dei materiali
    verbale di collaudo idraulico

I quattro documenti vanno consegnati insieme. Una consegna parziale non
fa decorrere i termini, e questo e' il motivo piu' frequente di ritardo
nelle pratiche degli ultimi anni.

## Rapporti con i frontisti

I proprietari dei terreni attraversati dalla condotta hanno diritto di
preavviso scritto quarantotto ore prima di qualunque accesso non
urgente. In caso di urgenza il preavviso e' sostituito da una
comunicazione immediata, anche telefonica, seguita da nota scritta.

La casistica degli ultimi anni mostra che quasi tutti i contenziosi
nascono non dall'accesso in se', ma dal ripristino incompleto del
terreno dopo lo scavo. Vale la pena fotografare lo stato dei luoghi
prima di cominciare[^1].

[^1]: Le fotografie vanno archiviate insieme al verbale, non nella
    cartella personale di chi le ha scattate. Sembra ovvio e non lo e'.

## Riferimenti

Il regolamento vigente e' consultabile nell'[area riservata][riservata]
del portale consortile. La versione a stampa distribuita nel duemilaventi
e' superata e va distrutta.

Vedi anche le [note di aggiornamento][note] pubblicate dopo ogni
assemblea.

[riservata]: https://example.invalid/riservata
[note]: https://example.invalid/aggiornamenti "Note di aggiornamento"

<div class="avviso">
  <strong>Attenzione:</strong> le procedure di questo documento non si
  applicano agli impianti antincendio, che seguono un regolamento
  separato.
</div>

Collegamenti interni: [[Catasto consortile]], [[Squadre e turni]],
[[Registro anomalie]]

## Nota finale

Questo documento viene riletto integralmente ogni due anni. La rilettura
del duemilaventisette dovra' verificare in particolare se le anomalie
elencate sopra siano ancora presenti, e se la stazione Barbagianni possa
passare a frequenza trimestrale come richiesto dalla squadra di alta
valle.
