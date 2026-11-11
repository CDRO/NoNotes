/* NoNotes – Mail-Entwurf als Datei (seit 4.3.0). i18n-ignore-file

   Baut eine Nachricht nach RFC 5322 mit MIME (.eml): Betreff, Text und Anhänge, auf Wunsch als Entwurf markiert (X-Unsent: 1). Das
   klassische Outlook und Thunderbird (ab 91) öffnen so eine Datei als neues Mail zum Bearbeiten, mit Anhang; andere Programme zeigen
   sie zum Lesen. Der Browser kann einem Mail-Programm keinen Anhang direkt geben (mailto: kennt keine Anhänge); der Weg über die Datei
   kommt ohne Server aus.

   Namen und Betreff mit Umlauten stehen als RFC-2047-Wörter in UTF-8 (=?UTF-8?B?…?=), so wie Outlook sie selbst schreibt, auch im
   Namen des Anhangs. Zeilen enden auf CRLF. Reine Funktionen ohne DOM; läuft auch in Node. */
(function (global) {
  'use strict';

  const str = v => String(v == null ? '' : v);

  function utf8(s) {
    return new TextEncoder().encode(str(s));
  }

  function base64(bytes) {
    if (typeof global.btoa === 'function') {
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return global.btoa(bin);
    }
    return Buffer.from(bytes).toString('base64'); // Node ohne btoa
  }

  /** Base64 in Zeilen zu 76 Zeichen (RFC 2045). */
  const wrap76 = s => s.replace(/.{76}/g, '$&\r\n');

  /** Text für eine Kopfzeile: reines ASCII bleibt, sonst RFC-2047-Wörter (UTF-8, Base64), je höchstens 75 Zeichen, gefaltet. */
  function headerText(s) {
    const v = str(s).replace(/[\r\n]+/g, ' ');
    if (/^[\x20-\x7e]*$/.test(v)) return v;
    const words = [];
    let chunk = '';
    for (const ch of v) {
      if (chunk && utf8(chunk + ch).length > 42) { words.push(chunk); chunk = ''; }
      chunk += ch;
    }
    if (chunk) words.push(chunk);
    return words.map(w => `=?UTF-8?B?${base64(utf8(w))}?=`).join('\r\n ');
  }

  /** Dateiname aus einem Titel: ohne Zeichen, die Windows nicht erlaubt, ohne Zeilenumbrüche, höchstens 120 Zeichen; ohne Titel
   *  fallback (übersetzt vom Aufrufer). */
  function fileName(title, ext, fallback) {
    const base = str(title).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^[.\s-]+|[.\s]+$/g, '').slice(0, 120).trim();
    return (base || str(fallback).trim() || 'note') + (ext || '');
  }

  /** Derselbe Name nur mit ASCII (ä → ae, – → -): Browser verwerfen Download-Namen mit Umlauten aus file://-Seiten teils. */
  function asciiName(name) {
    return str(name).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss').replace(/[–—]/g, '-').replace(/[«»„“”]/g, '"').replace(/[‘’‚]/g, "'").normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/"/g, '').replace(/\s+/g, ' ').trim();
  }

  /** Die Nachricht als Text (CRLF). o: { subject, text, attachments: [{ name, type, data (Uint8Array) }], draft, boundary }. */
  function eml(o) {
    const opts = o || {};
    const boundary = opts.boundary || 'nonotes-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const lines = [];
    if (opts.draft) lines.push('X-Unsent: 1');
    lines.push(`Subject: ${headerText(opts.subject)}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      'This is a multi-part message in MIME format.', '');
    lines.push(`--${boundary}`, 'Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: base64', '',
      wrap76(base64(utf8(str(opts.text).replace(/\r?\n/g, '\r\n')))), '');
    for (const a of opts.attachments || []) {
      const name = headerText(a.name);
      lines.push(`--${boundary}`, `Content-Type: ${a.type || 'application/octet-stream'}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`, 'Content-Transfer-Encoding: base64', '', wrap76(base64(a.data)), '');
    }
    lines.push(`--${boundary}--`, '');
    return lines.join('\r\n');
  }

  global.NoNotesMail = { eml, headerText, fileName, asciiName };
})(window);
