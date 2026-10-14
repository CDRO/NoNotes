/* Gemeinsames für die Testläufe: Playwright laden, Schritte melden, Abschnitte nacheinander ausführen.
   Ein Lauf druckt je Abschnitt eine Zeile; die Teilschritte darin bleiben still (NONOTES_TEST_VERBOSE=1 zeigt sie) und
   werden beim Fehlschlag genannt, damit die Stelle schnell zu finden ist. */
'use strict';

function loadPlaywright() {
  try { return require('playwright'); }
  catch (e) {
    if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
    throw e;
  }
}

const state = { part: null };
const step = name => console.log('  ✓ ' + name);
const part = name => { state.part = name; if (process.env.NONOTES_TEST_VERBOSE) console.log('      · ' + name); };

/** Führt die Abschnitte eines Laufs aus: { name, run(browser, part, step) }. Mit browser: true teilt sich der Lauf ein Chromium. */
async function suite(title, sections, options) {
  let browser = null;
  const started = Date.now();
  try {
    if (options && options.browser) browser = await loadPlaywright().chromium.launch();
    for (const s of sections) {
      state.part = null;
      await s.run(browser, part, step);
      if (s.name) step(s.name);
    }
    console.log(`\n${title} bestanden (${Math.round((Date.now() - started) / 1000)} s).`);
  } catch (e) {
    console.error(`\n${title} FEHLGESCHLAGEN${state.part ? ` – nach Teilschritt: ${state.part}` : ''}`);
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
  if (process.exitCode) process.exit(process.exitCode);
}

module.exports = { loadPlaywright, suite, step, part };
