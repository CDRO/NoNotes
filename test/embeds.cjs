/* Test der Videos (v1.6.0), Teil 1, ohne Browser: Erkennung der Adressen (auch Fälschungen), Adressen zum Einbetten, Karte im Markdown,
   Link statt Bild ohne Einbetten. Ausführen: npm test */
'use strict';

const path = require('node:path');
const assert = require('node:assert/strict');

globalThis.window = globalThis;
for (const f of ['i18n.js', 'embeds.js', 'markdown.js']) require(path.join(__dirname, '..', 'packages', 'core', f));
const E = globalThis.NoNotesEmbeds;
const M = globalThis.NoNotesMarkdown;
const step = name => console.log('  ✓ ' + name);

const ID = 'dQw4w9WgXcQ';

// ---------- Erkennung ----------
for (const url of [
  `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&list=PL1`, `https://m.youtube.com/watch?v=${ID}`, `http://youtu.be/${ID}`,
  `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/live/${ID}`, `www.youtube.com/watch?v=${ID}`, `youtu.be/${ID}`,
  `https://www.youtube-nocookie.com/embed/${ID}`,
]) {
  const v = E.parse(url);
  assert.ok(v, url);
  assert.equal(v.provider, 'youtube');
  assert.equal(v.id, ID);
  assert.equal(v.embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
  assert.equal(v.watchUrl, `https://www.youtube.com/watch?v=${ID}`);
}
assert.equal(E.parse(`https://youtu.be/${ID}?t=90`).embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0&start=90`);
assert.equal(E.parse(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`).embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0&start=3723`);
assert.equal(E.parse(`https://youtu.be/${ID}?t=99999999`).embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0`, 'unsinnige Zeit wird ignoriert');
assert.deepEqual(['0', 'abc', '-5', '1x', ''].map(E.seconds), [0, 0, 0, 0, 0]);
assert.equal(E.seconds('1m30s'), 90);
step('YouTube: alle üblichen Schreibweisen, Startzeit, Adresse ohne Cookies');

const vim = E.parse('https://vimeo.com/76979871');
assert.deepEqual([vim.provider, vim.id, vim.embedUrl], ['vimeo', '76979871', 'https://player.vimeo.com/video/76979871?dnt=1']);
assert.equal(E.parse('https://vimeo.com/76979871/abcdef1234').embedUrl, 'https://player.vimeo.com/video/76979871?dnt=1&h=abcdef1234', 'Vimeo, nicht gelistet');
assert.equal(E.parse('https://player.vimeo.com/video/76979871?h=abcdef1234').watchUrl, 'https://vimeo.com/76979871/abcdef1234');
const dm = E.parse('https://www.dailymotion.com/video/x8abc12');
assert.deepEqual([dm.provider, dm.id, dm.embedUrl], ['dailymotion', 'x8abc12', 'https://www.dailymotion.com/embed/video/x8abc12']);
assert.equal(E.parse('https://www.dailymotion.com/video/x8abc12_titel-des-videos').id, 'x8abc12', 'ältere Adressen mit Titel');
assert.equal(E.parse('https://dai.ly/x8abc12').provider, 'dailymotion');
step('Vimeo (auch nicht gelistet) und Dailymotion (auch kurze und ältere Adressen)');

// Fälschungen und Unsinn: nichts davon wird eingebettet
for (const bad of [
  `https://youtube.com.boese.example/watch?v=${ID}`, `https://boese-youtube.com/watch?v=${ID}`, `https://youtube.com@boese.example/watch?v=${ID}`,
  `https://user:pw@www.youtube.com/watch?v=${ID}`, `https://www.youtube.com:8443/watch?v=${ID}`, `javascript:alert(1)`, `data:text/html,<p>`, `ftp://youtu.be/${ID}`,
  'https://youtu.be/kurz', 'https://youtu.be/' + 'x'.repeat(40), `https://www.youtube.com/watch?v=${ID}"onload="x`, `https://www.youtube.com/watch?v=${ID} x`,
  'https://www.youtube.com/', 'https://www.youtube.com/watch', 'https://vimeo.com/abc', 'https://vimeo.com/12/', 'https://www.dailymotion.com/', 'https://example.com/video/x8abc12',
  '', null, undefined, 'x'.repeat(400),
]) assert.equal(E.parse(bad), null, String(bad).slice(0, 60));
step('Fälschungen und Unsinn werden nicht eingebettet (ähnliche Hosts, Zugangsdaten, andere Schemata, falsche Kennung, Sonderzeichen)');

assert.deepEqual(E.frameHosts(), ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.dailymotion.com', 'https://geo.dailymotion.com']);
step('Hosts für den Schutzkopf');

// ---------- Markdown ----------
const src = `Vorher\nhttps://youtu.be/${ID}\n\n![Mein Clip](https://vimeo.com/76979871)\n![](https://www.dailymotion.com/video/x8abc12 "Titel")\nText mit ![x](https://youtu.be/${ID}) mittendrin\n[Link](https://youtu.be/${ID})`;
const withCards = M.render(src, { embeds: true, lineMap: true });
const cards = [...withCards.matchAll(/<div class="md-embed"[^>]*>/g)].map(m => m[0]);
assert.equal(cards.length, 3, 'drei Karten: eine Adresse allein, zwei Bilder allein auf der Zeile');
assert.match(cards[0], /data-provider="youtube"/);
assert.match(cards[1], /data-provider="vimeo"/);
assert.match(cards[1], /data-title="Mein Clip"/);
assert.match(cards[2], /data-provider="dailymotion"/);
assert.match(cards[0], /data-line="1"/, 'Zeilennummer für das gemeinsame Scrollen');
assert.ok(!/<iframe/i.test(withCards), 'die Karte enthält keinen Rahmen');
assert.ok(!/<img/i.test(withCards), 'kein Bild-Element, das die Seite des Anbieters abruft');
assert.ok(!/src=/i.test(withCards), 'keine Quelle, die der Browser von selbst lädt');
assert.match(withCards, /<button type="button" class="md-embed-load">Video laden<\/button>/);
assert.match(withCards, /<a class="md-embed-open" href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
assert.match(withCards, /<p data-line="5">Text mit <a href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"[^>]*class="md-video-link">▶ x<\/a> mittendrin<br><a /, 'mitten im Satz: Link statt Karte; [Text](Adresse) bleibt ein Link');
step('Markdown: Karte nur für eine Adresse oder ein Bild allein auf der Zeile; kein Rahmen, kein Bild, keine Quelle');

const plain = M.render(src, {});
assert.ok(!/md-embed/.test(plain), 'ohne die Option (Druck, Listen) keine Karte');
assert.ok(!/<img/i.test(plain), 'auch kein Bild: eine Videoadresse ist kein Bild');
assert.match(plain, /<a href="https:\/\/vimeo\.com\/76979871"[^>]*class="md-video-link">▶ Mein Clip<\/a>/);
assert.match(plain, /<a href="https:\/\/youtu\.be\/dQw4w9WgXcQ"[^>]*>https:\/\/youtu\.be\/dQw4w9WgXcQ<\/a>/, 'eine nackte Adresse bleibt ein normaler Link');
// echte Bilder bleiben Bilder
assert.match(M.render('![x](https://beispiel.ch/bild.png)', { embeds: true }), /<img src="https:\/\/beispiel\.ch\/bild\.png"/);
assert.ok(!/md-embed/.test(M.render('![x](https://beispiel.ch/bild.png)\nhttps://beispiel.ch/seite', { embeds: true })));
step('Ohne Einbetten: Link statt Bild; gewöhnliche Bilder und Links bleiben unverändert');

// YouTube kann nicht überall geladen werden: nur der Link
const noLoad = M.render(`https://youtu.be/${ID}`, { embeds: true, embedLoad: p => p !== 'youtube' });
assert.ok(!/md-embed-load/.test(noLoad));
assert.match(noLoad, /lässt YouTube das Einbetten nicht zu|does not allow embedding/);
assert.match(noLoad, /md-embed-open/);
step('Ohne Ladeknopf (zum Beispiel YouTube in einer geöffneten Datei): nur der Link zum Anbieter, mit Erklärung');

// Einschleusen über den Titel
const evil = M.render('![<img src=x onerror=alert(1)>](https://vimeo.com/76979871)', { embeds: true });
assert.ok(!/<img/i.test(evil) && !/onerror=alert/.test(evil.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')), 'der Titel wird maskiert');
step('Titel mit HTML wird maskiert');

console.log('\nVideo-Test (ohne Browser) bestanden.');
