// Drehbuch der Screenshots für v4.3.0 (node tools/release-shots.cjs v4.3.0)
// Das Kontextmenü mit «Versand», die Einstellung im Menü «Datenbank» und die erste Seite des PDF aus dem Mail-Entwurf (pdftoppm,
// Poppler, nur auf dem Rechner, der die Release-Notizen macht). Chromium unter Linux hat kein Teilen-Fenster: das Drehbuch baut
// navigator.share und navigator.canShare nach, damit «Teilen» wie unter Windows im Menü steht.

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const BODY = [
  'Traktanden der Sitzung vom 5. November.',
  '',
  '## Budget 2027',
  'Der Entwurf liegt vor, die Zahlen der Abteilungen fehlen noch.',
  '- [ ] Zahlen einholen @anna >13.11.2026',
  '- [x] Entwurf verteilen',
  '',
  '? Besetzen wir die zweite Stelle intern?',
  '! Ja, Ausschreibung zuerst intern',
  '',
  '| Posten | Betrag |',
  '| --- | ---: |',
  '| Server | 18 400 CHF |',
  '| Fahrzeuge | 64 000 CHF |',
].join('\n');

module.exports = {
  date: '2026-11-11T09:00:00+01:00',
  async run(s) {
    const { page } = s;
    await page.context().addInitScript(() => {
      navigator.canShare = d => !!(d && Array.isArray(d.files));
      navigator.share = async () => {};
    });
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]');
    await s.newNote('Sitzung Vorstand');
    await s.edit('Sitzung Vorstand', { body: BODY });
    await s.back();
    await s.newNote('Budget 2027', 'Sitzung Vorstand');
    await s.newNote('Personal', 'Sitzung Vorstand');

    // ---------- Kontextmenü mit Versand ----------
    await s.node('Sitzung Vorstand').click({ button: 'right' });
    await page.hover('#contextMenu button:has-text("Versand")');
    await page.waitForSelector('.context-sub .send-panel');
    const box = await page.evaluate(() => {
      const a = document.querySelector('#contextMenu').getBoundingClientRect();
      const b = document.querySelector('.context-sub').getBoundingClientRect();
      return { x: Math.min(a.left, b.left), y: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
    });
    await page.evaluate(b => {
      const d = document.createElement('div');
      d.id = 'shotFrame';
      Object.assign(d.style, { position: 'fixed', left: b.x + 'px', top: b.y + 'px', width: (b.right - b.x) + 'px', height: (b.bottom - b.y) + 'px', pointerEvents: 'none' });
      document.body.appendChild(d);
    }, box);
    await s.shot('menu', { locator: '#shotFrame', pad: 12 });
    await page.evaluate(() => document.querySelector('#shotFrame').remove());
    await page.keyboard.press('Escape');

    // ---------- Einstellung ----------
    await page.click('#menuBtn');
    await page.waitForSelector('#sendRow');
    await s.shot('einstellung', { locator: '#menu', pad: 8 });
    await page.click('#menuBtn');

    // ---------- PDF aus dem Mail-Entwurf ----------
    await s.node('Sitzung Vorstand').click({ button: 'right' });
    await page.click('#contextMenu button:has-text("Versand")');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.context-sub button:has-text("E-Mail")')]);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nonotes-shots-'));
    try {
      const eml = path.join(tmp, 'entwurf.eml');
      await dl.saveAs(eml);
      const text = fs.readFileSync(eml, 'latin1');
      const boundary = /boundary="([^"]+)"/.exec(text)[1];
      const part = text.split(`--${boundary}`).find(p => /application\/pdf/.test(p));
      const pdf = path.join(tmp, 'notiz.pdf');
      fs.writeFileSync(pdf, Buffer.from(part.split('\r\n\r\n').slice(1).join('').replace(/\s+/g, ''), 'base64'));
      try { execFileSync('pdftoppm', ['-png', '-r', '70', '-f', '1', '-l', '1', '-singlefile', pdf, path.join(__dirname, 'pdf')]); }
      catch (e) { throw new Error('pdftoppm (Poppler) fehlt oder scheitert: ' + e.message); }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
};
