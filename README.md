# Book Radar 📚✨

**Desklet nativa per Cinnamon Desktop (Linux Mint)** per scoprire e sfogliare a schermo i libri più interessanti del momento: le **novità appena uscite in libreria** e la **classifica dei Bestseller su Amazon Italia**, con copertine ad alta risoluzione, rotazione dinamica automatica con dissolvenza, integrazione con **tasks-tw** e link diretto con un clic ad **Amazon** e **Giunti al Punto**.

---

## 🌟 Caratteristiche Principali

- **Design Elegante a Fondo Trasparente**:
  - Ispirato allo stile moderno e minimale di *tasks-tw*, si fonde perfettamente con lo sfondo del desktop.
  - Opacità del pannello e larghezza completamente regolabili dalle impostazioni della desklet.
- **Transizioni Fluide con Dissolvenza (Fade-In/Out)**:
  - Ad ogni cambio di libro la copertina e i dettagli sfumano morbidamente senza scatti bruschi (configurabile nelle preferenze).
- **Integrazione con tasks-tw (To Do List)**:
  - Pulsante dedicato **📋 Task** nella barra dei controlli e nel menu contestuale per aggiungere istantaneamente il libro alla tua lista (default: `"To Do"`) con titolo formattato, autore, prezzo e link diretto nelle note.
- **Sinossi e Trama con Clic Centrale (Scrollable Dialog)**:
  - Fai un **clic centrale** (rotellina del mouse) sulla copertina o sul titolo per aprire una finestra modale scrollabile con la **trama completa** del libro, pulsante per aprirne la pagina o aggiungerlo al volo a *tasks-tw*.
- **Sorgenti Feed Selezionabili**:
  - 🔄 **Misto (Bestseller Amazon + Novità)** *(default)*: alterna in sequenza i libri in cima alle classifiche di vendita e le novità fresche di stampa, con deduplicazione automatica dei titoli.
  - 🏆 **Classifica Bestseller Amazon**: i primi libri più venduti in tempo reale su Amazon.it, con badge indicatore di posizione (es. `🏆 #1 AMAZON`) e sinossi estratte in parallelo.
  - 📖 **Novità in Libreria (Giunti al Punto)**: le novità della settimana tramite catalogo Giunti al Punto.
- **Rotazione Dinamica Automatica (Slideshow)**:
  - Cambia automaticamente libro ogni $N$ secondi (configurabile da 5 a 300 secondi, default: 20s).
  - Barra dei comandi integrata: Precedente (**◀**), Pausa/Riprendi (**⏸**), Successivo (**▶**), Aggiungi Task (**📋**), Sinossi (**ℹ**), Apri nel browser (**🔗**) e Aggiorna feed (**🔄**).
- **Link Diretto con 1 Clic (Amazon / Giunti)**:
  - Cliccando con il tasto sinistro sulla copertina o sul titolo si apre direttamente il browser con la scheda del libro.
- **Cache Locale & Offline-Friendly**:
  - Il sincronizzatore `fetcher.py` memorizza le copertine in locale (`~/.cache/book-radar/covers/`) a pieno formato per minimizzare il traffico di rete e garantire fluidità istantanea anche offline.
- **Menu Contestuale Completo**:
  - Tasto destro sulla desklet per accedere rapidamente a: *Aggiungi a tasks-tw*, *Leggi sinossi / trama*, *Cerca su Amazon*, *Apri su Giunti*, *Prossimo*, *Precedente*, *Pausa* e *Configura*.

---

## 📁 Struttura del Progetto

```text
book-radar/
├── fetcher.py                         # Script Python per sincronizzare Amazon Bestsellers, Giunti e sinossi
├── desklet/
│   └── book-radar@ar3ac/              # La Desklet Cinnamon vera e propria
│       ├── metadata.json              # Metadati e compatibilità versioni Cinnamon
│       ├── desklet.js                 # Logica GJS, dissolvenza, dialog modale e integrazione tasks-tw
│       ├── stylesheet.css             # Stili grafici, tipografia, sinossi e trasparenze
│       ├── settings-schema.json       # Configurazione grafica (GUI impostazioni Desklet)
│       └── icon.png                   # Icona per la gestione desklet di Cinnamon
└── README.md
```

---

## 🛠️ Installazione su Linux Mint (Cinnamon)

1. **Requisiti di sistema**:
   - Python 3 con `beautifulsoup4` (`pip install beautifulsoup4`).
   - *Opzionale*: `tasks-tw` per salvare i libri promemoria nella propria to-do list.

2. **Clona o copia il repository**:
   ```bash
   git clone git@github.com:ar3ac/book-radar.git ~/projects/book-radar
   ```

3. **Crea il collegamento simbolico nella cartella delle desklet**:
   ```bash
   ln -sfn ~/projects/book-radar/desklet/book-radar@ar3ac ~/.local/share/cinnamon/desklets/book-radar@ar3ac
   ```

4. **Esegui la prima sincronizzazione delle copertine**:
   ```bash
   python3 ~/projects/book-radar/fetcher.py --source mixed
   ```

5. **Abilita la Desklet**:
   - Apri il menu delle applicazioni $\rightarrow$ **Desklet**.
   - Cerca **Book Radar** e clicca su **+** (Aggiungi al desktop).
   - *Oppure abilitala direttamente da terminale:*
     ```bash
     gsettings set org.cinnamon enabled-desklets "['book-radar@ar3ac:0:1575:225']"
     ```

---

## ⚙️ Opzioni di Configurazione

Facendo clic destro sulla desklet $\rightarrow$ **Configura...** puoi personalizzare:

| Opzione | Descrizione | Default |
| :--- | :--- | :--- |
| **Sorgente catalogo** | *Misto*, *Classifica Bestseller Amazon*, *Novità Libreria (Giunti)* | `Misto` |
| **Intervallo di rotazione** | Secondi di permanenza su ciascun libro | `20 s` |
| **Dissolvenza fluida** | Transizione fade-in/out tra le copertine | `Attivo` |
| **Lista tasks-tw** | Nome della lista in cui aggiungere i libri (es. `To Do` o `Libri`) | `To Do` |
| **Azione al clic** | *Cerca su Amazon* oppure *Apri scheda su Giunti* | `Amazon` |
| **Mostra controlli** | Barra con pulsanti (◀ ⏸ ▶ 📋 ℹ 🔗 🔄) | `Attivo` |
| **Mostra prezzo** | Badge con prezzo di copertina (es. 19,95 €) | `Attivo` |
| **Sfondo trasparente** | Attiva o disattiva la trasparenza totale dello sfondo | `Attivo` |
| **Opacità sfondo** | Percentuale opacità quando lo sfondo trasparente è disattivato | `20%` |
| **Larghezza desklet** | Larghezza in pixel del widget | `260 px` |
| **Dimensione font** | Dimensione del testo del titolo del libro | `11 pt` |
| **Frequenza aggiornamento** | Frequenza con cui riscaricare i libri dal web | `4 ore` |

---

## 🖱️ Scorciatoie Mouse

- **Clic Sinistro** sulla cover o sul titolo: apre il link al libro (Amazon o Giunti).
- **Clic Centrale (rotellina)** sulla cover o sul titolo: apre il pannello modale con la **sinossi / trama**.
- **Clic Destro**: apre il menu contestuale con tutte le azioni rapide.

---

## 📄 Licenza

Rilasciato sotto licenza MIT.
