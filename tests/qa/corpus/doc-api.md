# Interfaccia HTTP

Tutte le risposte sono JSON. I codici seguono la semantica usuale.

## Leggere un documento

```json
{
  "path": "/tmp/nota.md",
  "line_ending": "lf"
}
```

Esempio di chiamata:

```bash title="richiesta" {2}
curl -s http://127.0.0.1:8080/api/document \
  -H "Authorization: Bearer $TOKEN"
```

~~~python
def leggi(percorso):
    with open(percorso, "rb") as f:
        return f.read()
~~~

````
Un blocco con quattro apici, che dentro contiene
```
tre apici
```
e resta un blocco solo.
````

## Codici

| Codice | Significato          | Ritentabile |
| ------ | -------------------- | ----------- |
| 200    | tutto bene           | -           |
| 409    | conflitto su disco   | si          |
| 500    | errore non previsto  | no          |

1. Prima si legge.
2. Poi si scrive.
3. Poi si rinomina.
