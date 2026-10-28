/* Beispiel-Erweiterung: ein Design. Ein Design überschreibt Farben und Masse der Oberfläche (CSS-Variablen ohne --)
   für die helle und die dunkle Systemeinstellung. Die Hauptfarbe bleibt Sache des Menüs «Hauptfarbe».
   Beschreibung und Hilfe je Sprache: Schlüssel klein ('de', 'en', 'fr', 'pt-br' …), wie bei datum-einfuegen.js. */
const SEPIA_TEXTE = {
  de: {
    description: 'Warmes Papier statt kühlem Grau.',
    help: 'Ein Design mit warmem Papier statt kühlem Grau. Auswählen im Menü *Datenbank* unter **Design**; die Wahl wird in der Datenbankdatei gespeichert. Die Hauptfarbe bleibt Sache des Menüs *Hauptfarbe*.',
  },
  en: {
    description: 'Warm paper instead of cool grey.',
    help: 'A theme with warm paper instead of cool grey. Choose it in the *Database* menu under **Theme**; the choice is saved in the database file. The accent colour stays with the *Accent colour* menu.',
  },
  /* <uebersetzungen> */
  'de-de': {
    description: "Warmes Papier statt kühlem Grau.",
    help: "Ein Design mit warmem Papier statt kühlem Grau. Auswählen im Menü *Datenbank* unter **Design**; die Wahl wird in der Datenbankdatei gespeichert. Die Hauptfarbe bleibt Sache des Menüs *Hauptfarbe*.",
  },
  'fr': {
    description: "Du papier chaud au lieu d’un gris froid.",
    help: "Un thème avec du papier chaud au lieu d’un gris froid. À choisir dans le menu *Base de données* sous **Thème** ; le choix est enregistré dans le fichier de base de données. La couleur d’accentuation reste du ressort du menu *Couleur d’accentuation*.",
  },
  'it': {
    description: "Carta calda invece di un grigio freddo.",
    help: "Un tema con carta calda invece di un grigio freddo. Si sceglie nel menu *Database* sotto **Tema**; la scelta viene salvata nel file di database. Il colore principale resta affidato al menu *Colore principale*.",
  },
  'es': {
    description: "Papel cálido en lugar de gris frío.",
    help: "Un tema con papel cálido en lugar de gris frío. Elígelo en el menú *Base de datos*, en **Tema**; la elección se guarda en el archivo de base de datos. El color principal sigue dependiendo del menú *Color principal*.",
  },
  'es-mx': {
    description: "Papel cálido en lugar de gris frío.",
    help: "Un tema con papel cálido en lugar de gris frío. Elígelo en el menú *Base de datos*, en **Tema**; la elección se guarda en el archivo de base de datos. El color principal sigue dependiendo del menú *Color principal*.",
  },
  'pt': {
    description: "Papel quente em vez de cinzento frio.",
    help: "Um tema com papel quente em vez de cinzento frio. Escolha-o no menu *Base de dados*, em **Tema**; a escolha é guardada no ficheiro de base de dados. A cor de destaque continua a ser definida no menu *Cor de destaque*.",
  },
  'pt-br': {
    description: "Papel em tom quente em vez de cinza frio.",
    help: "Um tema com papel em tom quente em vez de cinza frio. Escolha-o no menu *Banco de dados*, em **Tema**; a escolha é salva no arquivo de banco de dados. A cor de destaque continua sendo definida no menu *Cor de destaque*.",
  },
  /* </uebersetzungen> */
};
const sepiaJe = k => Object.fromEntries(Object.entries(SEPIA_TEXTE).map(([l, v]) => [l, v[k]]));

NoNotesPlugins.register({
  id: 'sepia',
  name: 'Sepia',
  version: '1.1.0',
  api: 1,
  description: SEPIA_TEXTE.de.description,
  descriptions: sepiaJe('description'),
  help: sepiaJe('help'),
  theme: {
    name: 'Sepia',
    light: { bg: '#f3ead8', panel: '#fbf6ea', text: '#3b2f1e', muted: '#7a6a52', border: '#e0d3b8', hover: '#efe3c8', radius: '6px' },
    dark: { bg: '#1c1710', panel: '#241e15', text: '#ece1c9', muted: '#b3a37f', border: '#3a3022', hover: '#2d261b' },
  },
});
