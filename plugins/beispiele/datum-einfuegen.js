/* Beispiel-Erweiterung: fügt das heutige Datum in den Text ein und zählt die Notizen.
   Zeigt: Toolleistenknopf, Menüeintrag, Editor-Schnittstelle, Zugriff auf die Daten und ein Ereignis. */
NoNotesPlugins.register({
  id: 'datum-einfuegen',
  name: 'Datum einfügen',
  version: '1.0.0',
  api: 1,
  description: 'Knopf «Datum» in der Toolleiste fügt das heutige Datum ein; Menüeintrag «Notizen zählen».',

  activate(ctx) {
    // Toolleiste des Editors: action bekommt die Editor-Schnittstelle
    ctx.ui.addToolbarButton({
      label: 'Datum',
      title: 'Heutiges Datum einfügen',
      action: async editor => {
        const today = new Date().toLocaleDateString(ctx.language() === 'de' ? 'de-CH' : undefined);
        await editor.replaceSelection(today);
      },
    });

    // Menü Datenbank: Daten lesen über ctx.backend (alles asynchron)
    ctx.ui.addMenuItem({
      label: 'Notizen zählen',
      action: async () => {
        const n = await ctx.backend.countNotes({ archived: false });
        ctx.ui.setStatus(`${n} Notizen (ohne Archiv)`, 'saved');
      },
    });

    // Ereignis: wird gerufen, wenn der Benutzer eine Notiz öffnet
    ctx.on('note:open', ({ id }) => console.log('Notiz geöffnet:', id));
  },
});
