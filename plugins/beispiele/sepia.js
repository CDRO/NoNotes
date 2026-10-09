/* Beispiel-Erweiterung: ein Design. Ein Design überschreibt Farben und Masse der Oberfläche (CSS-Variablen ohne --)
   für die helle und die dunkle Systemeinstellung. Die Hauptfarbe bleibt Sache des Menüs «Hauptfarbe». */
NoNotesPlugins.register({
  id: 'sepia',
  name: 'Sepia',
  version: '1.0.0',
  api: 1,
  description: 'Warmes Papier statt kühlem Grau.',
  theme: {
    name: 'Sepia',
    light: { bg: '#f3ead8', panel: '#fbf6ea', text: '#3b2f1e', muted: '#7a6a52', border: '#e0d3b8', hover: '#efe3c8', radius: '6px' },
    dark: { bg: '#1c1710', panel: '#241e15', text: '#ece1c9', muted: '#b3a37f', border: '#3a3022', hover: '#2d261b' },
  },
});
