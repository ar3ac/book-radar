# Book Radar 📚✨

**Desklet nativa per Cinnamon Desktop (Linux Mint)** per scoprire e sfogliare a schermo le novità librarie appena uscite in libreria, con copertine ad alta risoluzione, rotazione dinamica automatica e link diretto con un clic ad **Amazon** e **Giunti al Punto**.

---

## 🌟 Caratteristiche Principali

- **Design Elegante a Fondo Trasparente**:
  - Ispirato allo stile di *tasks-tw*, si fonde in modo trasparente e moderno con lo sfondo del desktop.
  - Opacità del pannello e larghezza completamente regolabili dalle impostazioni della desklet.
- **Rotazione Dinamica Automatica (Slideshow)**:
  - Cambia automaticamente libro ogni $N$ secondi (configurabile da 5 a 300 secondi, default: 20s).
  - Barra dei comandi integrata per mettere in **Pausa/Riprendi** la rotazione, passare al libro precedente (**◀**) o successivo (**▶**).
- **Integrazione API Nativa (Giunti al Punto)**:
  - Utilizza l'API JSON nativa di *Giunti al Punto* (`/products.json`), garantendo sincronizzazioni istantanee senza scraping HTML fragile.
  - Estrazione automatica e pulita di: titolo, autore/i, ISBN, prezzo e copertina originale ad alta risoluzione (CDN).
- **Link Diretto con 1 Clic (Amazon / Giunti)**:
  - Cliccando sulla copertina o sul titolo si apre direttamente il browser.
  - Nelle impostazioni puoi scegliere se cercare il libro direttamente su **Amazon** (tramite ISBN per trovare subito recensioni, disponibilità Prime o Kindle) oppure aprire la scheda di **Giunti al Punto**.
- **Cache Locale & Offline-Friendly**:
  - Il modulo `fetcher.py` memorizza le copertine in locale (`~/.cache/book-radar/covers/`) per non consumare banda ad ogni cambio di slide e consentire la visualizzazione istantanea anche offline.
  - Aggiornamento periodico in background ogni $X$ ore (configurabile).
- **Menu Contestuale Completo**:
  - Tasto destro sulla desklet per accedere rapidamente a: *Cerca su Amazon*, *Apri su Giunti*, *Prossimo libro*, *Pausa/Riprendi*, *Aggiorna catalogo* e *Configura*.

---

## 📁 Struttura del Progetto

```text
book-radar/
├── fetcher.py                         # Script Python per sincronizzare il feed e scaricare le copertine
├── desklet/
│   └── book-radar@ar3ac/              # La Desklet Cinnamon vera e propria
│       ├── metadata.json              # Metadati e compatibilità versioni Cinnamon
│       ├── desklet.js                 # Logica GJS, carosello e gestione eventi
│       ├── stylesheet.css             # Stili grafici, tipografia e trasparenze
│       ├── settings-schema.json       # Configurazione grafica (GUI impostazioni Desklet)
│       └── icon.png                   # Icona per la gestione desklet di Cinnamon
└── README.md
```

---

## 🛠️ Installazione su Linux Mint (Cinnamon)

1. **Clona o copia il progetto**:
   ```bash
   git clone git@github.com:ar3ac/book-radar.git ~/projects/book-radar
   ```

2. **Crea il collegamento simbolico nella cartella delle desklet**:
   ```bash
   ln -sfn ~/projects/book-radar/desklet/book-radar@ar3ac ~/.local/share/cinnamon/desklets/book-radar@ar3ac
   ```

3. **Esegui la prima sincronizzazione delle copertine**:
   ```bash
   python3 ~/projects/book-radar/fetcher.py
   ```

4. **Abilita la Desklet**:
   - Apri il menu delle applicazioni $\rightarrow$ **Desklet**.
   - Cerca **Book Radar** e clicca su **+** (Aggiungi al desktop).
   - *Oppure abilitala direttamente da terminale:*
     ```bash
     gsettings set org.cinnamon enabled-desklets "['book-radar@ar3ac:0:1280:25']"
     ```

---

## ⚙️ Opzioni di Configurazione

Facendo clic destro sulla desklet $\rightarrow$ **Configura...** puoi personalizzare:

| Opzione | Descrizione | Default |
| :--- | :--- | :--- |
| **Intervallo di rotazione** | Secondi di permanenza su ciascun libro | `20 s` |
| **Azione al clic** | *Cerca su Amazon* oppure *Apri scheda su Giunti* | `Amazon` |
| **Mostra controlli** | Visualizza la barra con pulsanti ◀ ⏸ ▶ 🔗 🔄 | `Attivo` |
| **Mostra prezzo** | Badge con prezzo di copertina (es. € 18,50) | `Attivo` |
| **Sfondo trasparente** | Attiva o disattiva la trasparenza totale dello sfondo | `Attivo` |
| **Opacità sfondo** | Percentuale opacità quando la trasparenza totale è disattivata | `20%` |
| **Larghezza desklet** | Larghezza in pixel del widget | `260 px` |
| **Dimensione font** | Dimensione del testo del titolo del libro | `11 pt` |
| **Frequenza aggiornamento** | Frequenza con cui riscaricare le novità dal web | `4 ore` |

---

## 📄 Licenza

Rilasciato sotto licenza MIT.
