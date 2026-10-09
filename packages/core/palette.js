/* NoNotes – Hauptfarbe. Acht Farben zur Wahl, jede mit einer hellen und einer dunklen Fassung.
   Pro Fassung gehören vier Werte zusammen:
     accent    Fläche (Wurzelknoten, Knöpfe, Abzeichen)
     contrast  Schrift auf dieser Fläche
     ink       die Farbe als Schrift auf dem Hintergrund (Links, Hinweise); bei Gelb dunkler als die Fläche
     tint      zarte Tönung (Auswahl, Tags)
   Gespeichert wird nur die Kennung (meta 'accent' in der Datenbank, dazu ein Zwischenspeicher im Browser).
   Dieses Modul kennt weder Datenbank noch Seite; die Oberfläche setzt css() ein, Export und Druck
   benutzen light() für das Mindmap-Bild. Blau ist die Vorgabe und entspricht dem Stylesheet. */
(function (global) {
  'use strict';

  const { t } = global.NoNotesI18n;

  const DEFAULT = 'blue';

  const COLORS = [
    { id: 'blue',   light: { accent: '#2563eb', contrast: '#ffffff', ink: '#2563eb', tint: '#e3ecfd' }, dark: { accent: '#6ea8fe', contrast: '#0b1220', ink: '#6ea8fe', tint: '#1d2a45' } },
    { id: 'teal',   light: { accent: '#0f766e', contrast: '#ffffff', ink: '#0f766e', tint: '#d8f1ee' }, dark: { accent: '#2dd4bf', contrast: '#04211e', ink: '#2dd4bf', tint: '#123230' } },
    { id: 'green',  light: { accent: '#15803d', contrast: '#ffffff', ink: '#15803d', tint: '#dcf2e2' }, dark: { accent: '#4ade80', contrast: '#052e16', ink: '#4ade80', tint: '#14301f' } },
    { id: 'yellow', light: { accent: '#eab308', contrast: '#1c1500', ink: '#a16207', tint: '#fbf0c7' }, dark: { accent: '#facc15', contrast: '#1c1500', ink: '#facc15', tint: '#3a3210' } },
    { id: 'orange', light: { accent: '#c2410c', contrast: '#ffffff', ink: '#c2410c', tint: '#fde8d9' }, dark: { accent: '#fb923c', contrast: '#1f0e03', ink: '#fb923c', tint: '#3b2412' } },
    { id: 'red',    light: { accent: '#dc2626', contrast: '#ffffff', ink: '#dc2626', tint: '#fde2e2' }, dark: { accent: '#f87171', contrast: '#2a0a0a', ink: '#f87171', tint: '#3d1919' } },
    { id: 'violet', light: { accent: '#7c3aed', contrast: '#ffffff', ink: '#7c3aed', tint: '#ece4fd' }, dark: { accent: '#a78bfa', contrast: '#140a2e', ink: '#a78bfa', tint: '#2a2147' } },
    { id: 'gray',   light: { accent: '#4b5563', contrast: '#ffffff', ink: '#4b5563', tint: '#e5e7eb' }, dark: { accent: '#9ca3af', contrast: '#111827', ink: '#9ca3af', tint: '#2b303a' } },
  ];

  const byId = new Map(COLORS.map(c => [c.id, c]));

  /** Gültige Kennung oder die Vorgabe. */
  function normalize(id) {
    return byId.has(id) ? id : DEFAULT;
  }

  /** Anzeigename einer Farbe in der Sprache der Oberfläche. */
  function name(id) {
    switch (normalize(id)) {
      case 'teal': return t('Türkis');
      case 'green': return t('Grün');
      case 'yellow': return t('Gelb');
      case 'orange': return t('Orange');
      case 'red': return t('Rot');
      case 'violet': return t('Violett');
      case 'gray': return t('Grau');
      default: return t('Blau');
    }
  }

  /** Werte der hellen Fassung (Export und Druck haben weissen Grund). */
  function light(id) { return Object.assign({}, byId.get(normalize(id)).light); }
  function dark(id) { return Object.assign({}, byId.get(normalize(id)).dark); }

  const declarations = v => `--accent: ${v.accent}; --accent-contrast: ${v.contrast}; --accent-ink: ${v.ink}; --active: ${v.tint};`;

  /** Stylesheet-Text, der die Farbvariablen der Seite überschreibt. Für die Vorgabe leer (das Stylesheet gilt). */
  function css(id) {
    id = normalize(id);
    if (id === DEFAULT) return '';
    const c = byId.get(id);
    return `:root { ${declarations(c.light)} }\n@media (prefers-color-scheme: dark) { :root { ${declarations(c.dark)} } }\n`;
  }

  global.NoNotesPalette = { DEFAULT, COLORS, ids: COLORS.map(c => c.id), normalize, name, light, dark, css };
})(window);
