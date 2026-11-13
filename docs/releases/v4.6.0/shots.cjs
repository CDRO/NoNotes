// Drehbuch der Screenshots für v4.6.0 (node tools/release-shots.cjs v4.6.0)
// Eine nachgebaute Datenbankdatei, die ein Neuladen übersteht (Inhalt in localStorage) und sich sperren oder bremsen lässt:
// die ruhige Leiste «Noch nicht gespeichert – wird weiter versucht» und die Leiste «Abgleich mit der Datei» beim Öffnen.

function mockFile() {
  const st = { bytes: new Uint8Array(), mtime: 1 };
  try {
    const v = JSON.parse(localStorage.getItem('mock.file') || 'null');
    if (v) { st.bytes = Uint8Array.from(atob(v.b64), c => c.charCodeAt(0)); st.mtime = v.mtime; }
  } catch (e) { /* leer */ }
  const persist = () => {
    let s = '';
    for (let i = 0; i < st.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, st.bytes.subarray(i, i + 0x8000));
    localStorage.setItem('mock.file', JSON.stringify({ b64: btoa(s), mtime: st.mtime }));
  };
  const F = window.__file = { failWrite: false, delay: Number(localStorage.getItem('mock.delay') || 0) };
  window.NONOTES_RETRY_MS = [100, 100, 100, 100, 100, 30000];
  window.NONOTES_READ_CHUNK = 8192;
  const fileObj = () => {
    const f = new File([st.bytes], 'Vorstand.sqlite', { lastModified: st.mtime });
    if (!F.delay) return f;
    return { size: f.size, lastModified: f.lastModified, arrayBuffer: () => f.arrayBuffer(),
      slice: (a, b) => ({ arrayBuffer: async () => { await new Promise(r => setTimeout(r, F.delay)); return f.slice(a, b).arrayBuffer(); } }) };
  };
  const handle = {
    kind: 'file', name: 'Vorstand.sqlite', __mock: true,
    queryPermission: async () => localStorage.getItem('mock.perm') || 'prompt',
    requestPermission: async () => 'granted',
    isSameEntry: async o => !!(o && o.__mock),
    getFile: async () => fileObj(),
    createWritable: async () => {
      if (F.failWrite) throw new DOMException('The request is not allowed by the user agent or the platform in the current context.', 'NoModificationAllowedError');
      const chunks = [];
      return {
        write: async d => { chunks.push(new Uint8Array(d)); },
        close: async () => {
          const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
          let o = 0;
          for (const c of chunks) { out.set(c, o); o += c.length; }
          st.bytes = out; st.mtime++; persist();
        },
        abort: async () => {},
      };
    },
  };
  window.showSaveFilePicker = async () => handle;
  window.showOpenFilePicker = async () => [handle];
  let ns;
  Object.defineProperty(window, 'NoNotesStorage', { configurable: true, get: () => ns, set: v => {
    ns = v;
    v.browserStore.saveHandle = async () => { localStorage.setItem('mock.handle', '1'); };
    v.browserStore.loadHandle = async () => (localStorage.getItem('mock.handle') ? handle : null);
    v.browserStore.clearHandle = async () => { localStorage.removeItem('mock.handle'); };
  } });
}

module.exports = {
  date: '2026-11-13T09:00:00+01:00',
  async run(s) {
    const { page } = s;
    await page.context().addInitScript(mockFile);
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]');
    for (const t of ['Sitzung Vorstand', 'Budget 2027', 'Ferienplan', 'Offerten']) await s.newNote(t);
    await page.click('#menuBtn');
    await page.click('#createFileBtn');
    await s.saved();

    // ---------- die Datei ist gesperrt: ruhige Leiste ----------
    await page.evaluate(() => { window.__file.failWrite = true; });
    await s.newNote('Lieferanten vergleichen', 'Offerten');
    await page.waitForFunction(() => /Noch nicht gespeichert – wird weiter versucht/.test(document.querySelector('#banner').textContent), null, { timeout: 15000 });
    await page.mouse.move(640, 600);
    await s.shot('leiste');
    await page.evaluate(() => { window.__file.failWrite = false; });
    await page.click('#banner button:text("Jetzt erneut versuchen")');
    await s.saved();

    // ---------- Öffnen mit freigegebener Datei: die Kopie gleich, Abgleich mit Fortschritt ----------
    await page.evaluate(() => { localStorage.setItem('mock.perm', 'granted'); localStorage.setItem('mock.delay', '700'); });
    await page.reload();
    await page.waitForSelector('#syncBar:not([hidden])', { timeout: 15000 });
    await page.waitForFunction(() => /KB von/.test(document.querySelector('#syncText').textContent), null, { timeout: 15000 });
    await s.shot('abgleich');
    await page.waitForSelector('#syncBar', { state: 'hidden', timeout: 60000 });
  },
};
