const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Mainloop = imports.mainloop;
const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const Clutter = imports.gi.Clutter;
const Util = imports.misc.util;
const Pango = imports.gi.Pango;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const Dialog = imports.ui.dialog;

class BookRadarDesklet extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);
        this.metadata = metadata;
        this.desklet_id = desklet_id;

        this._books = [];
        this._currentIndex = 0;
        this._isPaused = false;
        this._rotationTimerId = 0;
        this._syncTimerId = 0;
        this._fileMonitor = null;
        this._fileMonitorId = 0;
        this._isTransitioning = false;

        // Disabilita decorazioni opache di default di Cinnamon
        this.metadata["prevent-decorations"] = true;
        this._updateDecoration();

        // Bind impostazioni
        this.settings = new Settings.DeskletSettings(this, this.metadata.uuid, desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN, "rotation-interval", "rotationInterval", this._onRotationIntervalChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "fade-transitions", "fadeTransitions", () => {});
        this.settings.bindProperty(Settings.BindingDirection.IN, "tasks-list-name", "tasksListName", () => {});
        this.settings.bindProperty(Settings.BindingDirection.IN, "feed-source", "feedSource", this._onFeedConfigChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "feed-refresh-hours", "feedRefreshHours", this._onFeedConfigChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "click-action", "clickAction", () => {});
        this.settings.bindProperty(Settings.BindingDirection.IN, "collection", "collection", this._onFeedConfigChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-price", "showPrice", this._onDisplaySettingChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "show-controls", "showControls", this._onDisplaySettingChanged.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "transparent-background", "transparentBackground", this._applyCustomStyle.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-opacity", "deskletOpacity", this._applyCustomStyle.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "desklet-width", "deskletWidth", this._applyCustomStyle.bind(this));
        this.settings.bindProperty(Settings.BindingDirection.IN, "font-size", "fontSize", this._applyCustomStyle.bind(this));

        // Percorso cache
        this._cacheDir = GLib.build_filenamev([GLib.get_home_dir(), ".cache", "book-radar"]);
        this._feedPath = GLib.build_filenamev([this._cacheDir, "feed.json"]);
        this._fetcherScript = GLib.build_filenamev([GLib.get_home_dir(), "projects", "book-radar", "fetcher.py"]);

        this._buildUI();
        this._applyCustomStyle();
        this._setupContextMenu();
        this._setupFileMonitor();

        // Caricamento iniziale e avvio timer
        this._loadBooksFromCache();
        this._checkAndTriggerSync();
        this._startRotationTimer();
        this._startSyncTimer();
    }

    _updateDecoration() {
        try {
            if (this._header) this._header.hide();
            if (this.content) {
                this.content.style_class = "";
                this.content.set_style("background-color: transparent; border: none; padding: 0; box-shadow: none;");
            }
        } catch (e) {}
    }

    _buildUI() {
        this._updateDecoration();

        this.window = new St.BoxLayout({
            vertical: true,
            style_class: "book-radar-container"
        });
        this.setContent(this.window);

        // Header: badge dinamico (Bestseller / Novità) + contatore
        this.headerBox = new St.BoxLayout({
            vertical: false,
            style_class: "book-header"
        });
        this.window.add_actor(this.headerBox);

        this.headerTag = new St.Label({
            text: "📖 NOVITÀ IN LIBRERIA",
            style_class: "book-badge-tag",
            x_expand: true
        });
        this.headerBox.add_actor(this.headerTag);

        this.counterLabel = new St.Label({
            text: "--/--",
            style_class: "book-counter"
        });
        this.headerBox.add_actor(this.counterLabel);

        // Area Copertina
        this.coverButton = new St.Button({
            style_class: "book-cover-btn",
            reactive: true
        });
        // Clic sinistro: apri libro | Clic centrale: sinossi
        this.coverButton.connect("button-press-event", (actor, event) => {
            let btn = event.get_button();
            if (btn === 1) {
                this._onOpenBook();
                return Clutter.EVENT_STOP;
            } else if (btn === 2) {
                this._showSynopsisDialog();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.window.add_actor(this.coverButton);

        this.coverBin = new St.Bin({
            style_class: "book-cover-frame",
            x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE
        });
        this.coverButton.set_child(this.coverBin);

        // Dettagli libro (Titolo, Autore, Prezzo)
        this.infoBox = new St.BoxLayout({
            vertical: true
        });
        this.window.add_actor(this.infoBox);

        // Barra con autore e prezzo
        this.metaBox = new St.BoxLayout({
            vertical: false,
            style: "padding-top: 4px;"
        });
        this.infoBox.add_actor(this.metaBox);

        this.authorLabel = new St.Label({
            text: "Caricamento...",
            style_class: "book-author",
            x_expand: true
        });
        this.metaBox.add_actor(this.authorLabel);

        this.priceBadge = new St.Label({
            text: "",
            style_class: "book-price-badge"
        });
        this.metaBox.add_actor(this.priceBadge);

        // Titolo (cliccabile sinistro/centrale)
        this.titleButton = new St.Button({
            reactive: true,
            style: "padding: 0; margin: 0; background-color: transparent; border: none; text-align: left;"
        });
        this.titleButton.connect("button-press-event", (actor, event) => {
            let btn = event.get_button();
            if (btn === 1) {
                this._onOpenBook();
                return Clutter.EVENT_STOP;
            } else if (btn === 2) {
                this._showSynopsisDialog();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.infoBox.add_actor(this.titleButton);

        this.titleLabel = new St.Label({
            text: "Sincronizzazione libri...",
            style_class: "book-title"
        });
        this.titleLabel.clutter_text.set_line_wrap(true);
        this.titleLabel.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
        this.titleLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        this.titleButton.set_child(this.titleLabel);

        // Barra Controlli (Precedente, Pausa, Successivo, Task, Sinossi, Goodreads, Link, Sync)
        this.controlsBox = new St.BoxLayout({
            vertical: false,
            style_class: "book-controls-bar",
            x_align: St.Align.MIDDLE
        });
        this.window.add_actor(this.controlsBox);

        this.btnPrev = new St.Button({
            label: "◀",
            style_class: "book-control-btn",
            reactive: true
        });
        this.btnPrev.connect("clicked", () => this._prevBook());
        this.controlsBox.add_actor(this.btnPrev);

        this.btnPause = new St.Button({
            label: "⏸",
            style_class: "book-control-btn",
            reactive: true
        });
        this.btnPause.connect("clicked", () => this._togglePause());
        this.controlsBox.add_actor(this.btnPause);

        this.btnNext = new St.Button({
            label: "▶",
            style_class: "book-control-btn",
            reactive: true
        });
        this.btnNext.connect("clicked", () => this._nextBook());
        this.controlsBox.add_actor(this.btnNext);

        // Tasto Sinossi / Trama
        this.btnInfo = new St.Button({
            label: "ℹ",
            style_class: "book-control-btn",
            reactive: true
        });
        this.btnInfo.connect("clicked", () => this._showSynopsisDialog());
        this.controlsBox.add_actor(this.btnInfo);

        // Tasto Aggiungi a Tasks-TW
        this.btnTask = new St.Button({
            label: "📋",
            style_class: "book-control-btn",
            reactive: true
        });
        this.btnTask.connect("clicked", () => this._addToTasksTw());
        this.controlsBox.add_actor(this.btnTask);

        // Tasto Goodreads (Want to Read)
        this.btnGoodreads = new St.Button({
            label: "📚",
            style_class: "book-control-btn",
            reactive: true
        });
        this.btnGoodreads.connect("clicked", () => this._openCurrentBook("goodreads"));
        this.controlsBox.add_actor(this.btnGoodreads);

        this.btnLink = new St.Button({
            label: "🔗",
            style_class: "book-control-btn",
            reactive: true
        });
        this.btnLink.connect("clicked", () => this._onOpenBook());
        this.controlsBox.add_actor(this.btnLink);

        this.btnSync = new St.Button({
            label: "🔄",
            style_class: "book-control-btn",
            reactive: true
        });
        this.btnSync.connect("clicked", () => this._triggerSync(true));
        this.controlsBox.add_actor(this.btnSync);
    }

    _applyCustomStyle() {
        let width = this.deskletWidth || 260;
        let fontSize = this.fontSize || 11;
        let opacity = this.transparentBackground ? 0 : (this.deskletOpacity || 20) / 100;
        let bg = this.transparentBackground
            ? "background-color: transparent; border: none; box-shadow: none;"
            : `background-color: rgba(15, 23, 42, ${opacity}); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);`;

        this.window.set_style(`${bg} width: ${width}px; border-radius: 12px; padding: 12px;`);
        this.titleLabel.set_style(`font-size: ${fontSize}pt;`);
        this._updateDisplay();
    }

    _setupContextMenu() {
        let addTaskItem = new PopupMenu.PopupMenuItem("Aggiungi a tasks-tw");
        addTaskItem.connect("activate", () => this._addToTasksTw());
        this._menu.addMenuItem(addTaskItem);

        let showSynopsisItem = new PopupMenu.PopupMenuItem("Leggi sinossi / trama");
        showSynopsisItem.connect("activate", () => this._showSynopsisDialog());
        this._menu.addMenuItem(showSynopsisItem);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let openGoodreadsItem = new PopupMenu.PopupMenuItem("Apri su Goodreads (Want to Read)");
        openGoodreadsItem.connect("activate", () => this._openCurrentBook("goodreads"));
        this._menu.addMenuItem(openGoodreadsItem);

        let openAmazonItem = new PopupMenu.PopupMenuItem("Cerca libro su Amazon");
        openAmazonItem.connect("activate", () => this._openCurrentBook("amazon"));
        this._menu.addMenuItem(openAmazonItem);

        let openGiuntiItem = new PopupMenu.PopupMenuItem("Apri scheda su Giunti al Punto");
        openGiuntiItem.connect("activate", () => this._openCurrentBook("giunti"));
        this._menu.addMenuItem(openGiuntiItem);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let nextItem = new PopupMenu.PopupMenuItem("Prossimo libro");
        nextItem.connect("activate", () => this._nextBook());
        this._menu.addMenuItem(nextItem);

        let prevItem = new PopupMenu.PopupMenuItem("Libro precedente");
        prevItem.connect("activate", () => this._prevBook());
        this._menu.addMenuItem(prevItem);

        this.pauseMenuItem = new PopupMenu.PopupMenuItem("Metti in pausa rotazione");
        this.pauseMenuItem.connect("activate", () => this._togglePause());
        this._menu.addMenuItem(this.pauseMenuItem);

        let syncItem = new PopupMenu.PopupMenuItem("Aggiorna catalogo dal web");
        syncItem.connect("activate", () => this._triggerSync(true));
        this._menu.addMenuItem(syncItem);
    }

    _setupFileMonitor() {
        try {
            let feedFile = Gio.file_new_for_path(this._feedPath);
            this._fileMonitor = feedFile.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitorId = this._fileMonitor.connect("changed", (monitor, file, other_file, event_type) => {
                if (event_type === Gio.FileMonitorEvent.CHANGES_DONE_HINT || event_type === Gio.FileMonitorEvent.CREATED) {
                    this._loadBooksFromCache();
                }
            });
        } catch (e) {
            global.logError(`[BookRadar] Errore monitor file: ${e}`);
        }
    }

    _loadBooksFromCache() {
        if (!GLib.file_test(this._feedPath, GLib.FileTest.EXISTS)) {
            return;
        }

        try {
            let [ok, contents] = GLib.file_get_contents(this._feedPath);
            if (ok) {
                let text = imports.byteArray ? imports.byteArray.toString(contents) : contents.toString();
                let parsed = JSON.parse(text);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    this._books = parsed;
                    if (this._currentIndex >= this._books.length) {
                        this._currentIndex = 0;
                    }
                    this._updateDisplay();
                }
            }
        } catch (e) {
            global.logError(`[BookRadar] Errore lettura cache feed: ${e}`);
        }
    }

    _renderBookContent(book) {
        this.titleLabel.set_text(book.title || "Senza Titolo");
        this.authorLabel.set_text(book.author || "");
        this.counterLabel.set_text(`${this._currentIndex + 1} / ${this._books.length}`);

        // Badge della testata dinamico in base alla fonte del libro
        if (book.badge) {
            this.headerTag.set_text(book.badge.toUpperCase());
        } else if (book.source === "amazon") {
            this.headerTag.set_text("🏆 BESTSELLER AMAZON");
        } else {
            this.headerTag.set_text("📖 NOVITÀ IN LIBRERIA");
        }

        // Prezzo
        if (this.showPrice && book.price) {
            this.priceBadge.set_text(book.price);
            this.priceBadge.show();
        } else {
            this.priceBadge.hide();
        }

        // Barra controlli
        if (this.showControls) {
            this.controlsBox.show();
        } else {
            this.controlsBox.hide();
        }

        // Caricamento Copertina
        let coverWidth = Math.max(160, (this.deskletWidth || 260) - 24);
        let coverHeight = Math.round(coverWidth * 1.52);
        this.coverBin.set_size(coverWidth, coverHeight);

        let coverPath = book.cover_path;
        if (coverPath && GLib.file_test(coverPath, GLib.FileTest.EXISTS)) {
            let fileUri = GLib.filename_to_uri(coverPath, null);
            let imageActor = St.TextureCache.get_default().load_uri_async(fileUri, coverWidth, coverHeight);
            this.coverBin.set_child(imageActor);
        } else {
            let placeholder = new St.Icon({
                icon_name: "accessories-dictionary",
                icon_size: 80,
                style: "color: rgba(255, 255, 255, 0.4);"
            });
            this.coverBin.set_child(placeholder);
        }
    }

    _updateDisplay(animated = false) {
        if (!this._books || this._books.length === 0) {
            this.headerTag.set_text("📚 BOOK RADAR");
            this.titleLabel.set_text("Nessun libro disponibile. Aggiornamento in corso...");
            this.authorLabel.set_text("");
            this.counterLabel.set_text("--/--");
            this.priceBadge.hide();
            return;
        }

        let book = this._books[this._currentIndex];
        let useFade = animated && (this.fadeTransitions !== false);

        if (!useFade) {
            this.coverBin.opacity = 255;
            this.infoBox.opacity = 255;
            this._renderBookContent(book);
            return;
        }

        // Transizione con dissolvenza (Fade-out -> render -> Fade-in)
        if (this._isTransitioning) return;
        this._isTransitioning = true;

        this.coverBin.ease({
            opacity: 40,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._renderBookContent(book);
                this.coverBin.ease({
                    opacity: 255,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        this._isTransitioning = false;
                    }
                });
            }
        });

        this.infoBox.ease({
            opacity: 40,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.infoBox.ease({
                    opacity: 255,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD
                });
            }
        });
    }

    _nextBook() {
        if (!this._books || this._books.length === 0) return;
        this._currentIndex = (this._currentIndex + 1) % this._books.length;
        this._updateDisplay(true);
    }

    _prevBook() {
        if (!this._books || this._books.length === 0) return;
        this._currentIndex = (this._currentIndex - 1 + this._books.length) % this._books.length;
        this._updateDisplay(true);
    }

    _togglePause() {
        this._isPaused = !this._isPaused;
        if (this._isPaused) {
            this.btnPause.set_label("▶");
            this.pauseMenuItem.label.set_text("Riprendi rotazione automatica");
            if (this._rotationTimerId) {
                Mainloop.source_remove(this._rotationTimerId);
                this._rotationTimerId = 0;
            }
        } else {
            this.btnPause.set_label("⏸");
            this.pauseMenuItem.label.set_text("Metti in pausa rotazione");
            this._startRotationTimer();
        }
    }

    _startRotationTimer() {
        if (this._rotationTimerId) {
            Mainloop.source_remove(this._rotationTimerId);
            this._rotationTimerId = 0;
        }

        if (this._isPaused) return;

        let interval = Math.max(5, this.rotationInterval || 20);
        this._rotationTimerId = Mainloop.timeout_add_seconds(interval, () => {
            if (!this._isPaused) {
                this._nextBook();
            }
            return true;
        });
    }

    _onRotationIntervalChanged() {
        this._startRotationTimer();
    }

    _startSyncTimer() {
        if (this._syncTimerId) {
            Mainloop.source_remove(this._syncTimerId);
            this._syncTimerId = 0;
        }

        let hours = Math.max(1, this.feedRefreshHours || 4);
        this._syncTimerId = Mainloop.timeout_add_seconds(hours * 3600, () => {
            this._triggerSync(false);
            return true;
        });
    }

    _onFeedConfigChanged() {
        this._startSyncTimer();
        this._triggerSync(true);
    }

    _onDisplaySettingChanged() {
        this._updateDisplay(false);
    }

    _checkAndTriggerSync() {
        if (!GLib.file_test(this._feedPath, GLib.FileTest.EXISTS)) {
            this._triggerSync(true);
            return;
        }

        try {
            let file = Gio.file_new_for_path(this._feedPath);
            let info = file.query_info("time::modified", Gio.FileQueryInfoFlags.NONE, null);
            let modTime = info.get_attribute_uint64("time::modified");
            let now = GLib.DateTime.new_now_local().to_unix();
            let hoursPassed = (now - modTime) / 3600;
            let targetHours = this.feedRefreshHours || 4;
            if (hoursPassed >= targetHours) {
                this._triggerSync(false);
            }
        } catch (e) {
            this._triggerSync(false);
        }
    }

    _triggerSync(forceCovers) {
        if (!GLib.file_test(this._fetcherScript, GLib.FileTest.EXISTS)) {
            global.logError(`[BookRadar] Fetcher non trovato in: ${this._fetcherScript}`);
            return;
        }

        let source = this.feedSource || "mixed";
        let collection = this.collection || "novita-da-non-perdere";
        let forceFlag = forceCovers ? "--force-covers" : "";
        let cmd = `python3 "${this._fetcherScript}" --source "${source}" --collection "${collection}" ${forceFlag} --quiet`;

        try {
            Util.spawnCommandLine(cmd);
        } catch (e) {
            global.logError(`[BookRadar] Errore esecuzione fetcher: ${e}`);
        }
    }

    _onOpenBook() {
        let action = this.clickAction || "amazon";
        this._openCurrentBook(action);
    }

    _openCurrentBook(action) {
        if (!this._books || this._books.length === 0) return;
        let book = this._books[this._currentIndex];
        let url = "";

        if (action === "goodreads") {
            if (book.goodreads_url) {
                url = book.goodreads_url;
            } else if (book.isbn) {
                url = `https://www.goodreads.com/search?q=${book.isbn}`;
            } else {
                let q = (book.author ? `${book.title} ${book.author}` : book.title).trim();
                url = `https://www.goodreads.com/search?q=${encodeURIComponent(q)}`;
            }
        } else if (action === "giunti") {
            url = book.giunti_url;
        } else {
            url = book.amazon_url || book.giunti_url;
        }

        if (url) {
            try {
                Gio.AppInfo.launch_default_for_uri(url, null);
            } catch (e) {
                Util.spawn(["xdg-open", url]);
            }
        }
    }

    // Integrazione Tasks-TW
    _findTasksCli() {
        let candidates = [
            GLib.find_program_in_path("tasks-tw"),
            GLib.build_filenamev([GLib.get_home_dir(), ".local", "bin", "tasks-tw"]),
            GLib.build_filenamev([GLib.get_home_dir(), "projects", "tasks-tw", ".venv", "bin", "tasks-tw"])
        ];
        for (let cand of candidates) {
            if (cand && GLib.file_test(cand, GLib.FileTest.IS_EXECUTABLE)) {
                return cand;
            }
        }
        return null;
    }

    _addToTasksTw() {
        if (!this._books || this._books.length === 0) return;
        let book = this._books[this._currentIndex];
        let cli = this._findTasksCli();

        if (!cli) {
            Main.notify("Book Radar", "Comando tasks-tw non trovato in PATH o ~/.local/bin");
            return;
        }

        let taskTitle = `Libro: ${book.title}`;
        let grLink = book.goodreads_url ? `\nGoodreads: ${book.goodreads_url}` : "";
        let notes = `Autore: ${book.author}\nPrezzo: ${book.price || 'N/D'}\nLink: ${book.amazon_url || book.giunti_url}${grLink}`;
        let listName = this.tasksListName || "To Do";

        let argv = [cli, "add", taskTitle, "--notes", notes, "--list", listName, "--json"];

        try {
            let proc = new Gio.Subprocess({
                argv: argv,
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });
            proc.init(null);

            // Feedback visuale sul pulsante
            let prevLabel = this.btnTask.get_label();
            this.btnTask.set_label("⏳ ...");

            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    let [ok, stdout, stderr] = p.communicate_utf8_finish(res);
                    if (p.get_successful()) {
                        this.btnTask.set_label("✓");
                        this.btnTask.add_style_class_name("book-control-btn-active");
                        Main.notify("Book Radar", `Aggiunto a tasks-tw: "${book.title}"`);
                        Mainloop.timeout_add_seconds(2, () => {
                            this.btnTask.set_label("📋");
                            this.btnTask.remove_style_class_name("book-control-btn-active");
                            return false;
                        });
                    } else {
                        this.btnTask.set_label("📋");
                        Main.notify("Book Radar", `Errore creazione task: ${stderr || p.get_exit_status()}`);
                    }
                } catch (err) {
                    this.btnTask.set_label("📋");
                    Main.notify("Book Radar", `Errore tasks-tw: ${err.message}`);
                }
            });
        } catch (e) {
            Main.notify("Book Radar", `Errore avvio tasks-tw: ${e.message}`);
        }
    }

    // Modal Sinossi / Trama
    _showSynopsisDialog() {
        if (!this._books || this._books.length === 0) return;
        let book = this._books[this._currentIndex];

        let dlg = new ModalDialog.ModalDialog();

        let headerText = `${book.badge ? book.badge + ' • ' : ''}${book.title}`;
        let content = new Dialog.MessageDialogContent({
            title: headerText,
            description: `Autore: ${book.author} ${book.price ? '  |  ' + book.price : ''}`
        });
        dlg.contentLayout.add_child(content);

        let scrollView = new St.ScrollView({
            style_class: "synopsis-scroll-view",
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC
        });
        scrollView.set_mouse_scrolling(true);
        scrollView.set_height(250);
        scrollView.set_width(470);

        let box = new St.BoxLayout({ vertical: true });
        box.set_width(450);

        let synopsisText = book.description && book.description.trim()
            ? book.description.trim()
            : "Nessuna sinossi disponibile per questo libro.";

        let label = new St.Label({
            text: synopsisText,
            style: "color: #f1f5f9; font-size: 10pt; line-height: 1.45;"
        });
        label.clutter_text.set_line_wrap(true);
        label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD);
        label.show();
        box.add_actor(label);
        box.show();

        scrollView.add_actor(box);
        scrollView.show();

        content.add_child(scrollView);

        dlg.setButtons([
            {
                label: "📚 Goodreads",
                action: () => {
                    this._openCurrentBook("goodreads");
                }
            },
            {
                label: "📋 Tasks-TW",
                action: () => {
                    this._addToTasksTw();
                }
            },
            {
                label: "🔗 Apri Pagina",
                action: () => {
                    this._onOpenBook();
                    dlg.close();
                }
            },
            {
                label: "Chiudi",
                action: () => dlg.close(),
                default: true,
                key: Clutter.KEY_Escape
            }
        ]);

        dlg.open();
    }

    on_desklet_removed() {
        if (this._rotationTimerId) {
            Mainloop.source_remove(this._rotationTimerId);
            this._rotationTimerId = 0;
        }
        if (this._syncTimerId) {
            Mainloop.source_remove(this._syncTimerId);
            this._syncTimerId = 0;
        }
        if (this._fileMonitorId && this._fileMonitor) {
            this._fileMonitor.disconnect(this._fileMonitorId);
            this._fileMonitorId = 0;
            this._fileMonitor = null;
        }
    }
}

function main(metadata, desklet_id) {
    return new BookRadarDesklet(metadata, desklet_id);
}
