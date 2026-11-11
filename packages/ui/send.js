/* NoNotes – Versand einer Notiz als PDF (seit 4.3.0). Rechtsklick auf einen Knoten → Versand:

   - E-Mail: ein Mail-Entwurf als Datei (.eml, packages/core/mail.js) mit dem Titel als Betreff und dem PDF der Notiz als Anhang wird
     heruntergeladen. Ein Klick darauf öffnet ihn im Mail-Programm als neues Mail (klassisches Outlook, Thunderbird).
   - Teilen: das PDF geht an das Teilen-Fenster des Systems (Web Share mit Datei; Edge und Chrome unter Windows und macOS, Safari,
     Handys), dort wählt die Person das Ziel, etwa das Mail-Programm.

   Welche Wege im Menü stehen, stellt die Person im Menü «Datenbank» unter «Versand» ein (je Browser, weil es vom Mail-Programm des
   Geräts abhängt): beide, nur E-Mail oder nur Teilen. Kann der Browser keine Dateien teilen, bleibt E-Mail.

   Das Teilen-Fenster öffnet der Browser nur kurz nach einem Klick. Dauert das PDF länger (viele Bilder, Dienst über das Netz), steht
   oben «Das PDF … ist bereit» mit «Teilen»: der Klick dort öffnet es.

   create(host): host gibt backend(), pdfOptions(id), download(bytes, name, type), status(text, kind), showBanner(text, actions),
   hideBannerIf(text), errorText(e). */
(function (global) {
  'use strict';

  const { t } = global.NoNotesI18n;
  const KEY = 'nonotes.sendWays';
  const WAYS = ['both', 'mail', 'share'];
  const Mail = () => global.NoNotesMail;
  const PdfExport = () => global.NoNotesPdfExport;

  /** Kann dieser Browser eine PDF-Datei an das Teilen-Fenster geben? */
  function canShareFiles() {
    try {
      if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
      return navigator.canShare({ files: [new File([new Uint8Array([37, 80, 68, 70])], 'probe.pdf', { type: 'application/pdf' })] });
    } catch (e) { return false; }
  }

  function create(host) {
    let busy = false;

    /** Eingestellte Wege: 'both' (Vorgabe), 'mail' oder 'share'. */
    function ways() {
      try { const v = global.localStorage.getItem(KEY); return WAYS.includes(v) ? v : 'both'; } catch (e) { return 'both'; }
    }

    function setWays(v) {
      if (!WAYS.includes(v)) return;
      try { global.localStorage.setItem(KEY, v); } catch (e) { /* ohne Speicher gilt es bis zum Neuladen nicht */ }
    }

    /** Was im Menü steht: { mail, share }. Ohne Teilen im Browser bleibt E-Mail, auch wenn nur Teilen eingestellt ist. */
    function available() {
      const w = ways();
      const share = w !== 'mail' && canShareFiles();
      return { mail: w !== 'share' || !share, share };
    }

    /** Text im Mail und beim Teilen. */
    const message = title => t('Anbei die Notiz «{titel}» als PDF.', { titel: title });

    async function pdfOf(id) {
      host.status(t('PDF wird erstellt…'), '');
      return PdfExport().buildNote(host.backend(), id, host.pdfOptions(id));
    }

    async function mail(id) {
      if (busy) return;
      busy = true;
      try {
        const r = await pdfOf(id);
        const text = Mail().eml({ subject: r.title, text: message(r.title), attachments: [{ name: r.name, type: 'application/pdf', data: r.data }], draft: true });
        const name = (Mail().asciiName(Mail().fileName(r.title, '', t('Notiz'))) || Mail().asciiName(t('Notiz')) || 'note') + '.eml';
        host.download(new TextEncoder().encode(text), name, 'message/rfc822');
        host.status(t('Mail-Entwurf «{datei}» heruntergeladen. Öffne ihn: er geht im Mail-Programm als neues Mail mit dem PDF auf.', { datei: name }), 'saved');
      } catch (e) {
        console.error(e);
        host.status(t('Versand fehlgeschlagen: {fehler}', { fehler: host.errorText(e) }), 'error');
      } finally {
        busy = false;
      }
    }

    async function shareNow(data, name) {
      try {
        await navigator.share(data);
        host.status(t('«{datei}» geteilt.', { datei: name }), 'saved');
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') { host.status(t('Teilen abgebrochen.'), ''); return true; }
        if (e && e.name === 'NotAllowedError') return false; // kein Klick mehr in der Nähe: über den Banner noch einmal
        throw e;
      }
    }

    async function share(id) {
      if (busy) return;
      busy = true;
      try {
        const r = await pdfOf(id);
        const file = new File([r.data], r.name, { type: 'application/pdf', lastModified: Date.now() });
        const data = { files: [file], title: r.title, text: message(r.title) };
        if (await shareNow(data, r.name)) return;
        const text = t('Das PDF «{datei}» ist bereit.', { datei: r.name });
        host.status(text, '');
        host.showBanner(text, [
          { label: t('Teilen'), primary: true, onClick: async () => {
            host.hideBannerIf(text);
            try { await shareNow(data, r.name); } catch (e) { host.status(t('Versand fehlgeschlagen: {fehler}', { fehler: host.errorText(e) }), 'error'); }
          } },
          { label: t('Schliessen'), onClick: () => host.hideBannerIf(text) },
        ]);
      } catch (e) {
        console.error(e);
        host.status(t('Versand fehlgeschlagen: {fehler}', { fehler: host.errorText(e) }), 'error');
      } finally {
        busy = false;
      }
    }

    /** Untermenü «Versand» für den Knoten id: Knöpfe wie im Kontextmenü. close(): das Kontextmenü schliessen. */
    function panel(id, close) {
      const box = document.createElement('div');
      box.className = 'send-panel';
      const a = available();
      const add = (label, title, run, cls) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.title = title;
        const span = document.createElement('span');
        span.textContent = label;
        b.appendChild(span);
        b.addEventListener('click', () => { close(); run(id); });
        box.appendChild(b);
      };
      if (a.mail) add(t('E-Mail'), t('Die Notiz als PDF in einem Mail-Entwurf (.eml) herunterladen; geöffnet geht er als neues Mail mit Anhang auf (klassisches Outlook, Thunderbird)'), mail, 'send-mail');
      if (a.share) add(t('Teilen'), t('Die Notiz als PDF an das Teilen-Fenster des Systems geben, zum Beispiel an das Mail-Programm'), share, 'send-share');
      return box;
    }

    /** Auswahl «Versand» im Menü «Datenbank». */
    function setupSelect(select, row) {
      const can = canShareFiles();
      select.value = ways();
      select.addEventListener('change', () => setWays(select.value));
      for (const o of select.options) if (o.value !== 'mail') o.disabled = !can;
      if (!can) {
        select.value = 'mail';
        row.title = t('Dieser Browser kann keine Dateien teilen; es bleibt der Mail-Entwurf.');
      }
    }

    return { panel, mail, share, ways, setWays, available, setupSelect };
  }

  global.NoNotesSend = { create, canShareFiles, KEY };
})(window);
