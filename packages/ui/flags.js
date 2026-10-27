/* NoNotes – Flaggen für den Sprachwechsel (v3.1.0).
   Eigene, vereinfachte Zeichnungen im Seitenverhältnis 3:2 (Fläche 30 × 20), damit sie überall gleich aussehen: Emoji-Flaggen
   zeigt Windows nur als zwei Buchstaben. Ohne ids (die Flaggen stehen mehrmals auf der Seite). Unbekannte Länder bekommen eine
   Weltkugel. Ein Sprachpaket nennt sein Land mit register(…, { flag: 'CH' }). */
(function (global) {
  'use strict';

  const FLAGS = {
    // Schweiz: rot mit weissem Kreuz (Arme 1/6 länger als breit), in der Mitte der Fläche
    CH: '<rect width="30" height="20" fill="#da291c"/><path fill="#fff" d="M13.125 3.75h3.75v4.375h4.375v3.75h-4.375v4.375h-3.75v-4.375H8.75v-3.75h4.375z"/>',
    // Deutschland: Schwarz, Rot, Gold
    DE: '<rect width="30" height="20" fill="#ffce00"/><rect width="30" height="13.334" fill="#dd0000"/><rect width="30" height="6.667" fill="#000"/>',
    // Vereinigtes Königreich (englisches Paket, britische Schreibweise): Union Jack, vereinfacht (rote Diagonalen mittig)
    GB: '<rect width="30" height="20" fill="#012169"/><path d="M0 0l30 20M30 0L0 20" stroke="#fff" stroke-width="4"/>'
      + '<path d="M0 0l30 20M30 0L0 20" stroke="#c8102e" stroke-width="1.4"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="6"/>'
      + '<path d="M15 0v20M0 10h30" stroke="#c8102e" stroke-width="3.4"/>',
    // Spanien: Rot, Gelb (doppelt breit), Rot; ohne Wappen (Handelsflagge)
    ES: '<rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/>',
    // Mexiko: Grün, Weiss, Rot, in der Mitte das Wappen (vereinfacht: Adler als brauner Kreis, Zweige als grüner Bogen)
    MX: '<rect width="30" height="20" fill="#fff"/><rect width="10" height="20" fill="#006847"/><rect x="20" width="10" height="20" fill="#ce1126"/>'
      + '<circle cx="15" cy="9.4" r="2.5" fill="#8c5a2b"/><path d="M12 10.6a3 3 0 0 0 6 0" fill="none" stroke="#006847" stroke-width="1"/>',
    // Portugal: Grün (2/5), Rot (3/5), auf der Grenze Armillarsphäre und Schild (vereinfacht)
    PT: '<rect width="30" height="20" fill="#ff0000"/><rect width="12" height="20" fill="#006600"/>'
      + '<circle cx="12" cy="10" r="4.2" fill="none" stroke="#ffe000" stroke-width="1.3"/>'
      + '<path d="M9.8 7.4h4.4v3.4a2.2 2.2 0 0 1-4.4 0z" fill="#ff0000"/><path d="M10.7 8.3h2.6v2.4a1.3 1.3 0 0 1-2.6 0z" fill="#fff"/>'
      + '<circle cx="12" cy="9.6" r=".55" fill="#003399"/>',
    // Brasilien: Grün, gelbe Raute, blaue Kugel mit weissem Band
    BR: '<rect width="30" height="20" fill="#009c3b"/><path d="M15 2.2L27.8 10L15 17.8L2.2 10z" fill="#ffdf00"/>'
      + '<circle cx="15" cy="10" r="4.6" fill="#002776"/><path d="M10.6 9a10 10 0 0 1 8.9 2.6" fill="none" stroke="#fff" stroke-width=".9"/>',
  };

  // Weltkugel für Sprachen ohne Flagge (Linien in der Textfarbe)
  const GLOBE = '<g fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="15" cy="10" r="8"/><path d="M7 10h16M15 2c-3.2 3.4-3.2 12.6 0 16M15 2c3.2 3.4 3.2 12.6 0 16"/></g>';

  /** Die Flagge eines Landes als <span class="flag"> mit SVG (Markup, keine Benutzereingabe). */
  function html(country) {
    const c = String(country || '').toUpperCase();
    const body = Object.prototype.hasOwnProperty.call(FLAGS, c) ? FLAGS[c] : null;
    return `<span class="flag${body ? '' : ' flag-none'}" aria-hidden="true"><svg viewBox="0 0 30 20" preserveAspectRatio="none" focusable="false">${body || GLOBE}</svg></span>`;
  }

  /** Dasselbe als Element. */
  function element(country) {
    const box = document.createElement('span');
    box.innerHTML = html(country);
    return box.firstChild;
  }

  global.NoNotesFlags = { html, element, countries: () => Object.keys(FLAGS) };
})(window);
