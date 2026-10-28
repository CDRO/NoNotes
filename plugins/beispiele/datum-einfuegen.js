/* Beispiel-Erweiterung: fügt das heutige Datum in den Text ein und zählt die Notizen.
   Zeigt: Toolleistenknopf, Menüeintrag, Editor-Schnittstelle, Zugriff auf die Daten, ein Ereignis und Texte je Sprache. */

/* Texte je Sprache: Schlüssel klein ('de', 'de-de', 'en', 'fr', 'it', 'es', 'es-mx', 'pt', 'pt-br'). Gewählt wird die genaue
   Sprache der Oberfläche, dann die Sprache vor dem Bindestrich, dann Englisch (siehe docs/PLUGINS.md, «Texte der Erweiterung»).
   Namen auf oberster Ebene teilen sich die Seite mit anderen Erweiterungen: darum der Vorsatz DATUM_. */
const DATUM_TEXTE = {
  de: {
    name: 'Datum einfügen',
    description: 'Knopf «Datum» in der Toolleiste fügt das heutige Datum ein; Menüeintrag «Notizen zählen».',
    help: 'Der Knopf **Datum** in der Toolleiste des Editors fügt das heutige Datum an der Markierung ein. Im Menü *Datenbank* zählt **Notizen zählen** alle Notizen ohne Archiv.',
    ui: { knopf: 'Datum', knopfTitel: 'Heutiges Datum einfügen', zaehlen: 'Notizen zählen', ergebnis: 'Notizen ohne Archiv: {n}' },
  },
  en: {
    name: 'Insert date',
    description: 'The “Date” button in the toolbar inserts today’s date; menu item “Count notes”.',
    help: 'The **Date** button in the editor toolbar inserts today\'s date at the selection. In the *Database* menu, **Count notes** counts all notes excluding the archive.',
    ui: { knopf: 'Date', knopfTitel: 'Insert today\'s date', zaehlen: 'Count notes', ergebnis: 'Notes without the archive: {n}' },
  },
  /* <uebersetzungen> */
  'de-de': {
    name: "Datum einfügen",
    description: "Knopf „Datum“ in der Toolleiste fügt das heutige Datum ein; Menüeintrag „Notizen zählen“.",
    help: "Der Knopf **Datum** in der Toolleiste des Editors fügt das heutige Datum an der Markierung ein. Im Menü *Datenbank* zählt **Notizen zählen** alle Notizen ohne Archiv.",
    ui: {"knopf":"Datum","knopfTitel":"Heutiges Datum einfügen","zaehlen":"Notizen zählen","ergebnis":"Notizen ohne Archiv: {n}"},
  },
  'fr': {
    name: "Insérer la date",
    description: "Le bouton « Date » de la barre d’outils insère la date du jour ; élément de menu « Compter les notes ».",
    help: "Le bouton **Date** de la barre d’outils de l’éditeur insère la date du jour à l’emplacement de la sélection. Dans le menu *Base de données*, **Compter les notes** compte toutes les notes, sans les archives.",
    ui: {"knopf":"Date","knopfTitel":"Insérer la date du jour","zaehlen":"Compter les notes","ergebnis":"Notes sans les archives : {n}"},
  },
  'it': {
    name: "Inserisci data",
    description: "Il pulsante «Data» nella barra degli strumenti inserisce la data di oggi; voce di menu «Conta note».",
    help: "Il pulsante **Data** nella barra degli strumenti dell’editor inserisce la data di oggi al posto della selezione. Nel menu *Database*, **Conta note** conta tutte le note, archivio escluso.",
    ui: {"knopf":"Data","knopfTitel":"Inserisci la data di oggi","zaehlen":"Conta note","ergebnis":"Note, archivio escluso: {n}"},
  },
  'es': {
    name: "Insertar fecha",
    description: "El botón «Hoy» de la barra de herramientas inserta la fecha de hoy; elemento de menú «Contar notas».",
    help: "El botón **Hoy** de la barra de herramientas del editor inserta la fecha de hoy en la selección. En el menú *Base de datos*, **Contar notas** cuenta todas las notas que no están archivadas.",
    ui: {"knopf":"Hoy","knopfTitel":"Insertar la fecha de hoy","zaehlen":"Contar notas","ergebnis":"Notas no archivadas: {n}"},
  },
  'es-mx': {
    name: "Insertar fecha",
    description: "El botón “Hoy” de la barra de herramientas inserta la fecha de hoy; elemento de menú “Contar notas”.",
    help: "El botón **Hoy** de la barra de herramientas del editor inserta la fecha de hoy en la posición del cursor. En el menú *Base de datos*, **Contar notas** cuenta todas las notas sin las archivadas.",
    ui: {"knopf":"Hoy","knopfTitel":"Insertar la fecha de hoy","zaehlen":"Contar notas","ergebnis":"Notas sin las archivadas: {n}"},
  },
  'pt': {
    name: "Inserir data",
    description: "O botão «Data de hoje» na barra de ferramentas insere a data de hoje; opção de menu «Contar notas».",
    help: "O botão **Data de hoje** na barra de ferramentas do editor insere a data de hoje no local da seleção. No menu *Base de dados*, **Contar notas** conta todas as notas, sem o arquivo.",
    ui: {"knopf":"Data de hoje","knopfTitel":"Inserir a data de hoje","zaehlen":"Contar notas","ergebnis":"Notas sem o arquivo: {n}"},
  },
  'pt-br': {
    name: "Inserir data",
    description: "O botão “Data” na barra de ferramentas insere a data de hoje; item de menu “Contar notas”.",
    help: "O botão **Data** na barra de ferramentas do editor insere a data de hoje na posição do cursor. No menu *Banco de dados*, **Contar notas** conta todas as notas, sem as arquivadas.",
    ui: {"knopf":"Data","knopfTitel":"Inserir a data de hoje","zaehlen":"Contar notas","ergebnis":"Notas não arquivadas: {n}"},
  },
  /* </uebersetzungen> */
};
const datumJe = k => Object.fromEntries(Object.entries(DATUM_TEXTE).map(([l, v]) => [l, v[k]]));

NoNotesPlugins.register({
  id: 'datum-einfuegen',
  name: DATUM_TEXTE.de.name,
  version: '1.1.0',
  api: 1,
  description: DATUM_TEXTE.de.description,
  names: datumJe('name'),               // Name und Beschreibung je Sprache (NoNotes ab 3.1.1; ältere nehmen name und description)
  descriptions: datumJe('description'),
  help: datumJe('help'),

  activate(ctx) {
    const l = String(ctx.language() || 'de').toLowerCase();
    const T = (DATUM_TEXTE[l] || DATUM_TEXTE[l.split('-')[0]] || DATUM_TEXTE.en).ui;

    // Toolleiste des Editors: action bekommt die Editor-Schnittstelle
    ctx.ui.addToolbarButton({
      label: T.knopf,
      title: T.knopfTitel,
      action: async editor => {
        const today = new Date().toLocaleDateString(ctx.language() === 'de' ? 'de-CH' : ctx.language());
        await editor.replaceSelection(today);
      },
    });

    // Menü Datenbank: Daten lesen über ctx.backend (alles asynchron)
    ctx.ui.addMenuItem({
      label: T.zaehlen,
      action: async () => {
        const n = await ctx.backend.countNotes({ archived: false });
        ctx.ui.setStatus(T.ergebnis.replace('{n}', n), 'saved');
      },
    });

    // Ereignis: wird gerufen, wenn der Benutzer eine Notiz öffnet
    ctx.on('note:open', ({ id }) => console.log('Notiz geöffnet:', id));
  },
});
