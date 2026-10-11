# Videos einbetten (seit v1.6.0)

Notizen können Videos von **YouTube**, **Vimeo** und **Dailymotion** zeigen. Der Entwurf folgt dem Grundsatz: *beim Öffnen einer Notiz darf keine Anfrage an Dritte gehen.*

## Schreibweise

- Eine Videoadresse **allein auf einer Zeile**: `https://youtu.be/dQw4w9WgXcQ`
- oder als Bild-Schreibweise **allein auf einer Zeile**, mit eigenem Titel: `![Mein Clip](https://vimeo.com/76979871)`

Steht die Adresse mitten im Satz, bleibt sie ein Link (bei der Bild-Schreibweise mit dem Zeichen ▶). Erkannt werden die üblichen Schreibweisen:
YouTube `watch?v=`, `youtu.be/`, `embed/`, `shorts/`, `live/` (mit Startzeit `t=90`, `t=1m30s`), Vimeo `vimeo.com/ID` (auch nicht gelistet mit Kennung) und `player.vimeo.com/video/ID`,
Dailymotion `dailymotion.com/video/ID` (auch ältere Adressen mit Titel) und `dai.ly/ID`.

## Was geschieht

1. Die Vorschau zeigt eine **Karte** mit dem Namen des Anbieters, dem Hinweis «Beim Laden erfährt … deine IP-Adresse», einem Knopf **Video laden** und dem Link «Auf … öffnen».
   Die Karte enthält keinen Rahmen und keine Quelle: der Browser lädt nichts.
2. Erst der **Klick** baut den Rahmen (`iframe`) mit der Adresse zum Einbetten. Der Rahmen
   - ist **abgeschottet** (`sandbox`: Skripte und eigene Herkunft des Anbieters, Vollbild, neue Fenster; kein Wechsel der aufrufenden Seite, keine Dialoge),
   - sendet die **Herkunft** der Seite, nicht den Pfad (`strict-origin-when-cross-origin`; YouTube verlangt eine Herkunft),
   - spielt nach dem Klick sofort ab (`autoplay=1`),
   - nutzt die datensparsamen Adressen: `youtube-nocookie.com`, Vimeo mit `dnt=1`.
3. Beim **Neuzeichnen** der Vorschau (Tippen in der geteilten Ansicht, Wechsel der Ansicht) wird ein schon geladenes Video wieder eingesetzt, in dieser Sitzung.
4. **Druck** und **Listen** (Fragen, Aufgaben) bekommen keine Karte, nur Links. Markdown-Export und Kopie der Datei enthalten die Schreibweise unverändert.

## Genau diese Adressen, sonst nichts

`NoNotesEmbeds.parse(url)` (`packages/core/embeds.js`) lässt nur zu, was Host **und** Kennung genau einem Anbieter zuordnet. Nicht erkannt werden zum Beispiel `youtube.com.boese.example`, `boese-youtube.com`,
Adressen mit Zugangsdaten (`https://youtube.com@boese.example/…`), andere Ports und Schemata, Kennungen ausser Muster. Die Adresse zum Einbetten wird aus festen Bausteinen und der geprüften Kennung gebaut, nie aus Teilen der Eingabe.
Alles andere bleibt ein gewöhnlicher Link. Getestet in `test/embeds.cjs` (Erkennung, Fälschungen, Markdown) und `test/embeds-ui.cjs` (Browser: keine Anfrage vor dem Klick, Rahmen nach dem Klick).

## Einschränkungen

- **YouTube in einer geöffneten Datei (`file://`):** YouTube lässt das Einbetten in Seiten ohne Herkunft nicht zu (Fehler «Video player configuration error»). In der lokalen Version zeigt die Karte darum nur den Link
  «Auf YouTube öffnen». Vimeo und Dailymotion bieten den Ladeknopf an; ob sie in einer geöffneten Datei abspielen, hängt vom Anbieter ab und ist **nicht geprüft**.
- **Nicht gegen die echten Anbieter geprüft:** Die Tests ersetzen die Anbieter durch Platzhalterseiten (kein Netz in der Testumgebung). Von Hand zu prüfen, mit einer https-Adresse (zum Beispiel dem Dienst):
  Abspielen aller drei Anbieter, Vollbild, Startzeit bei YouTube, ein nicht gelistetes Vimeo-Video, Dailymotion mit der Adresse `…/embed/video/ID`.
- **Schutzkopf:** Wer die Seite mit einer Content-Security-Policy ausliefert (der Dienst tut das), muss `frame-src` für `NoNotesEmbeds.frameHosts()` öffnen. Ohne das blockiert der Browser den Rahmen, die Karte bleibt sichtbar.
  Die Hülle kann das Einbetten ausschalten (`shell.embeds = 'off'`), dann gibt es nur Links.
- **Datenschutz:** Mit dem Klick erfährt der Anbieter die IP-Adresse und was der Browser sonst mitschickt, und er kann Cookies setzen (bei YouTube trotz `nocookie` nach eigenem Ermessen). Wer das Werkzeug als Dienst anbietet, muss es in der Datenschutzerklärung nennen.

## Weitere Anbieter

Eine Funktion in `PARSERS` (`embeds.js`), die Hosts in `FRAME_HOSTS`, Tests in `test/embeds.cjs`. Anbieter mit eigenen Servern je Kunde (PeerTube) sind absichtlich nicht dabei: die Liste ist fest.
