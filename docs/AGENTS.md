# KI-Agenten: Werkzeuge für Claude Code, Copilot, ChatGPT und andere

Seit v2.1.0 beschreibt NoNotes seine Daten als **Werkzeuge für Agenten**: «Übersicht», «Notizen suchen», «Frage 12 beantworten»,
«Aufgabe 5 abschliessen». Ein Agent, der Werkzeuge aufrufen kann, liest und ändert damit Notizen, Fragen, Entscheide, Aufgaben
und Tags, ohne die Oberfläche zu bedienen. Der Standard dafür heisst MCP (Model Context Protocol); im Browser heisst die
dazugehörige Schnittstelle WebMCP.

## Was heute geht

| Weg | Für wen | Stand |
| --- | --- | --- |
| **WebMCP in der Seite** (`packages/agent/webmcp.js`) | den Agenten des Browsers, zum Beispiel Copilot in Edge oder Gemini in Chrome | gebaut und getestet gegen einen Nachbau der Schnittstelle. Die Browser bauen WebMCP gerade ein (Stand Oktober 2026: Chrome im öffentlichen Testlauf, Edge in den Vorabversionen hinter einer Schaltfläche); ein Browser-Agent, der die Werkzeuge einer Seite tatsächlich aufruft, ist noch nicht ausgeliefert. Sobald einer kommt, funktioniert NoNotes ohne Änderung. |
| **MCP über das Netz** (`packages/agent/protocol.js`) | Agenten, die einen Server ansprechen (Microsoft 365 Copilot, Copilot Studio, Claude, ChatGPT, VS Code) | der Protokollteil ist gebaut und getestet; eine Ausprägung mit Server (ein Dienst) hängt ihn an eine Adresse mit Anmeldung. Die lokale Version hat keinen Server. |
| **Programm auf dem eigenen Rechner** (`agent/nonotes-mcp.cjs`, seit v2.2.0) | Agenten, die lokale Programme starten: Claude Code, VS Code mit GitHub Copilot, Claude Desktop, Copilot CLI | gebaut und getestet; arbeitet auf derselben `NoNotes.sqlite` wie die App. Braucht Node 18 oder neuer auf dem Rechner (Claude Code bringt es mit). |

Alle drei Wege benutzen **denselben Werkzeugkatalog** (`packages/agent/catalog.js`), der auf der Backend-Schnittstelle
(`docs/BACKEND.md`) aufsetzt. Was ein Agent im Browser kann, kann er über einen Server auch.

## Die Werkzeuge

Namen und Beschreibungen sind Englisch, weil Agenten sie lesen. Inhalte bleiben, wie sie in den Notizen stehen.

| Werkzeug | Tut |
| --- | --- |
| `get_overview` | Titel der Karte, Zahl der Notizen, offene Fragen, Entscheide und Aufgaben (mit Überfälligem), Tags, Personen |
| `list_notes` | der Baum oder ein Teilbaum als eingerückte Liste mit Kennungen und Marken (offene Fragen, Entscheide, Aufgaben) |
| `search_notes` | Volltext über Titel und Text, wahlweise Tag; `scope` `archive` oder `trash`; ohne Suchbegriff die zuletzt geänderten Notizen |
| `get_note` | Titel, Text, Pfad, Tags, Link am Knoten (seit 3.2.0), Zeitstempel, Bilder (nur Namen), dazu die Fragen, Entscheide und Aufgaben der Notiz mit ihren Kennungen |
| `create_note` | neue Notiz mit Titel, Text und Tags, unter einer Notiz oder an der Wurzel |
| `update_note` | Titel und/oder Text ersetzen, mit `base_updated_at` gegen gleichzeitige Änderungen |
| `append_to_note` | Text anhängen (der sicherste Schreibweg) |
| `move_note`, `delete_note`, `restore_note`, `archive_note`, `unarchive_note`, `set_tags` | Baum, Papierkorb, Archiv, Tags |
| `list_questions`, `answer_question` | Fragen (`?`-Zeilen) auflisten, filtern nach Text, Tag, Person, Notiz; Antwort als `!`-Zeilen schreiben |
| `list_decisions`, `record_decision` | Entscheide (`?!`-Zeilen, auch in Listen und als Block) auflisten, mit Beschreibung (`details`), Block (`parent_id`) und Zählern der Unter-Einträge (`sub_entries`); Entscheid als `!!`-Zeile mit Datum festhalten, auch im Block |
| `list_tasks`, `complete_task`, `reopen_task` | Aufgaben mit Frist (`due`), Erinnerungen (`reminders`, seit v3.0.0) und Unteraufgaben; abschliessen erst, wenn die Unteraufgaben erledigt sind |
| `list_people` | alle `@kürzel` aus Fragen und Entscheiden |
| `list_templates`, `create_note_from_template` | Vorlagen auflisten; neue Notiz samt Unternotizen aus einer Vorlage, Platzhalter ersetzt (seit v2.5.0; nur, wo es Vorlagen gibt: lokal der Ordner `templates/` neben der App oder `--templates <Ordner>`, im Dienst die Vorlagen des Arbeitsbereichs). Seit v2.12.0 nennt `list_templates` die ausfüllbaren Platzhalter `{{?Name}}` als `fields` (Name, Vorschlag, Beschreibung), und `create_note_from_template` nimmt ihre Werte als `values`; was fehlt, bleibt für den Menschen offen |
| `get_history` | frühere Fassungen einer Notiz lesen |

Dazu zwei **Ressourcen** für Agenten, die lieber lesen als Werkzeuge rufen: `nonotes://overview` und `nonotes://note/<id>`
(die Notiz als Markdown). Der Katalog gibt dem Agenten ausserdem eine kurze Anleitung mit (`NoNotesAgent.INSTRUCTIONS`): was
`?`, `?!`, `!`, `!!`, `- [ ]`, `>Datum` (seit v3.0.0; mehrere am Zeilenende: der späteste ist die Frist, die früheren sind Erinnerungen) und `@kürzel` bedeuten, was Pfade auf Dateien und ausfüllbare Platzhalter sind (seit v2.12.0), wie Einträge in Listen und mehrzeilige Blöcke `?!```` … ```` ``` ```` mit Unterentscheiden aussehen (auch als Listenpunkt `- ?!````), und dass er die passenden Werkzeuge einem Umschreiben der
ganzen Notiz vorziehen soll.

**Regeln, die für Agenten wie für Menschen gelten:**

- Der Text ist die einzige Wahrheit. `answer_question` schreibt die Antwort als `!`-Zeilen unter die Frage, `record_decision`
  den Entscheid als `!!`-Zeile mit Datum, `complete_task` setzt das Kästchen. Es gibt keinen zweiten Datenbestand.
- `update_note` und `append_to_note` nehmen `base_updated_at` entgegen (den Zeitstempel aus `get_note`). Hat jemand die Notiz
  inzwischen geändert, bekommt der Agent `NOTE_CONFLICT` und nichts wird geschrieben; er liest neu und versucht es wieder.
  `append_to_note` prüft den Stand immer.
- Archivierte Notizen sind schreibgeschützt, Notizen im Papierkorb ebenso; im Lesemodus der Oberfläche (`readOnly`) gibt es nur
  die lesenden Werkzeuge.
- Jedes Werkzeug prüft seine Eingaben gegen ein Schema und meldet Fehler als Ergebnis (`isError`), nie als Absturz. Zahlen als
  Text («12») werden verstanden.
- Bilder liefern die Werkzeuge nicht (nur Namen und Grössen), der Verlauf lässt sich lesen, nicht zurücksetzen; Export und
  Import bleiben der Oberfläche vorbehalten.

## Das Programm für den eigenen Rechner

Im ausgelieferten Ordner liegt `agent/nonotes-mcp.cjs`. Ein Agent startet es und spricht mit ihm MCP über die Standardeingabe und
-ausgabe; es arbeitet auf der Datenbankdatei der App (`Datenbank → Datenbankdatei anlegen…`). Die App darf dieselbe Datei
gleichzeitig offen haben.

**Einrichten** (einmal, im Terminal des eigenen Rechners; die Pfade zeigt `--config` fertig an):

```
node <Ordner der App>/agent/nonotes-mcp.cjs --config "<Pfad zur NoNotes.sqlite>"
```

| Agent | Eintrag |
| --- | --- |
| Claude Code | `claude mcp add --scope user nonotes -- node "<Ordner>/agent/nonotes-mcp.cjs" --file "<Pfad>/NoNotes.sqlite"` |
| VS Code mit GitHub Copilot | `.vscode/mcp.json`: `{ "servers": { "nonotes": { "type": "stdio", "command": "node", "args": ["<Ordner>/agent/nonotes-mcp.cjs", "--file", "<Pfad>/NoNotes.sqlite"] } } }` |
| Claude Desktop | `claude_desktop_config.json`: `{ "mcpServers": { "nonotes": { "command": "node", "args": [ … wie oben … ] } } }` |
| GitHub Copilot CLI | `~/.copilot/mcp-config.json`: `{ "mcpServers": { "nonotes": { "type": "local", "command": "node", "args": [ … ] } } }` |

Danach den Agenten neu starten und fragen, zum Beispiel «Welche Fragen sind in NoNotes offen?» oder «Beantworte die Frage zur
Bank mit Raiffeisen». Der Agent zeigt jeden Werkzeugaufruf an und fragt vor Änderungen nach (das regelt der Agent, nicht NoNotes).

**Optionen:** `--read-only` meldet nur lesende Werkzeuge und schreibt nie; `--create` legt die Datei an, wenn sie fehlt;
`--verbose` meldet jeden Aufruf auf der Fehlerausgabe; `--help`, `--version`.

**Dateien von NoNotes 2.x** (seit v3.0.0): Das Programm liest sie wie die App (Termine `@Datum` gelten als `>Datum`). Bevor es eine
solche Datei zum ersten Mal schreibt, legt es den alten Stand als `<Name>-vor-3.0.0.sqlite` daneben, denn danach öffnet nur noch
NoNotes 3 die Datei. `--dir` lässt diese Sicherungen aus.

**Mehrere Bereiche** (seit v2.3.0): `--file` lässt sich mehrmals angeben, `--dir <Ordner>` nimmt alle `.sqlite`-Dateien eines Ordners
(beim Start gelesen). Jede Datei wird ein «workspace» mit der Kennung aus ihrem Namen, gleich gebildet wie die Bereiche der App
(`Arbeit.sqlite` → `arbeit`, `Privat Ä.sqlite` → `privat-ae`, doppelte Namen bekommen `-2`). Dann gibt es das Werkzeug
`list_workspaces`, jedes andere Werkzeug nimmt den Parameter `workspace`, und die Ressourcen heissen `nonotes://<workspace>/overview`
und `nonotes://<workspace>/note/<id>`. Mit einer Datei bleibt alles wie zuvor (ohne `workspace`). Tipp: die Dateien so nennen wie die
Bereiche in der App, dann sprechen Agent und App dieselbe Sprache.

```
node <Ordner der App>/agent/nonotes-mcp.cjs --config --dir "<Ordner mit den .sqlite-Dateien>"
claude mcp add --scope user nonotes -- node "<Ordner>/agent/nonotes-mcp.cjs" --dir "<Ordner mit den .sqlite-Dateien>"
```

**Wie Programm und App sich vertragen:**

- Vor jedem Aufruf prüft das Programm, ob die Datei sich geändert hat (Grösse, Zeitstempel, Prüfsumme), und liest sie dann neu.
  Was die App schreibt, sieht der Agent also beim nächsten Aufruf (die App speichert 1,5 Sekunden nach der letzten Eingabe).
- Nach einer Änderung schreibt das Programm die Datei atomar (temporäre Datei daneben, dann umbenennen), unter einer Sperre
  (`NoNotes.sqlite.lock`), damit mehrere Agenten sich nicht überschreiben. Hat die App zwischen Lesen und Schreiben die Datei
  geändert, läuft das Werkzeug auf dem frischen Stand noch einmal.
- Die App prüft beim Zurückkehren in den Tab, beim Fokus, alle 30 Sekunden und kurz vor jedem eigenen Schreiben, ob die Datei
  von aussen geändert wurde. Ohne eigene ungesicherte Änderungen lädt sie den neuen Stand still. Mit ungesicherten Änderungen
  **führt sie Notiz für Notiz zusammen** (seit v2.2.0): eigene Änderungen an Titel, Text, Tags, Auf-/Zuklappen und Einstellungen
  kommen auf den neuen Stand; hat der Agent dieselbe Notiz geändert, wird zeilenweise zusammengeführt. Nur wenn dieselbe Stelle
  betroffen ist oder die eigene Änderung den Baum, Bilder, Papierkorb oder Archiv betrifft, fragt die App wie bisher
  («Datei laden» oder «Meine Fassung behalten»).
- Das Programm hält keine Verbindung und keinen Port; es lebt nur, solange der Agent es laufen lässt. Es öffnet nur die Dateien
  aus `--file` und `--dir`, jede mit eigener Sperre. Zugriffsrechte sind die des Benutzerkontos, unter dem der Agent läuft.
- Der Browser-Speicher (ohne Datenbankdatei) ist für das Programm nicht erreichbar: ohne Datei kein Agent.

## WebMCP: der Agent des Browsers

Beim Start meldet die Seite ihre Werkzeuge bei `document.modelContext` an (ältere Fassungen der Schnittstelle heissen
`navigator.modelContext`; manche kennen nur `provideContext`). Gibt es die Schnittstelle nicht, passiert nichts. Der Agent des
Browsers sieht die Werkzeuge des offenen Tabs, zeigt Aufrufe an und fragt vor Änderungen; `execute()` ruft den Katalog, der
Katalog das Backend der Seite. Netz und Dateien sind nicht beteiligt: Gespeichert wird wie bei jeder Eingabe (Browser-Speicher
und, wenn verbunden, die Datenbankdatei), die Oberfläche zeichnet danach neu.

Grenzen: Es geht nur, solange die Seite offen ist, und nur mit dem Agenten dieses Browsers. Auf verwalteten Rechnern entscheidet
die Administration, ob der Browser die Funktion anbietet. Lesende Werkzeuge tragen `readOnlyHint: true`, `delete_note` trägt
`destructiveHint: true`, damit der Browser passend nachfragt.

## Für Entwicklerinnen und Entwickler

```js
const catalog = NoNotesAgent.create(backend, { readOnly: false, author: 'Name', now: () => new Date().toISOString() });
catalog.list();                                        // Werkzeuge mit name, description, inputSchema, annotations
await catalog.call('answer_question', { id: 12, answer: 'Ja.' });   // → { content: [{ type: 'text', text }], structuredContent, isError? }
await catalog.readResource('nonotes://note/3');       // → { uri, mimeType, text }

const server = NoNotesMcp.createServer({ catalog, name: 'nonotes', version: '2.1.0' });
await server.handleText('{"jsonrpc":"2.0","id":1,"method":"tools/list"}');   // → Antwort als Objekt
```

- `NoNotesAgent.create(backend, options)`: `backend` ist ein Objekt nach `docs/BACKEND.md` (lokal, über das Netz oder ein
  Nachbau); `options.readOnly` lässt nur lesende Werkzeuge zu, `options.author` wird als Autor in Notiz und Verlauf geschrieben
  (ein Backend, das Namen kennt, setzt ihn selbst), `options.now` liefert die Zeit für «überfällig» (Tests).
- `NoNotesMcp.createServer({ catalog, name, version, instructions, log })`: MCP ohne Transport. `handle(message)` nimmt eine
  JSON-RPC-Nachricht (oder eine Liste) und liefert die Antwort, `handleText` dasselbe aus rohem JSON. Verstanden werden die
  Protokollfassungen 2024-11-05 bis 2025-11-25 und der zustandslose Entwurf 2026-07-28: keine Sitzungen, keine Pflicht zur
  Begrüssung. Wer den Server an HTTP oder die Standardeingabe hängt, kümmert sich um Transport, Anmeldung und Begrenzungen.
- Eine Erweiterung (`docs/PLUGINS.md`) kann den Katalog mit `ctx.backend` selbst bauen, etwa um Werkzeuge an einen eigenen
  Transport zu geben.
- **Neues Werkzeug:** ein Eintrag in `TOOLS` in `packages/agent/catalog.js` mit `name`, `title`, englischer `description`,
  `inputSchema` (Teilmenge von JSON Schema: `type`, `properties`, `required`, `enum`, `minimum`, `maximum`, `minLength`,
  `maxLength`, `maxItems`, `pattern`, `additionalProperties: false`), `readOnly` und `run(backend, input, ctx)`, das `result(text,
  structured)` liefert oder einen Fehler mit `code` wirft. Dazu ein Test in `test/core.cjs` (Abschnitt «Agenten»). Die Datei
  trägt `i18n-ignore-file`, weil ihre Texte bewusst englisch sind (`docs/LANGUAGES.md`).

## Tests

- `test/core.cjs`, Abschnitt «Agenten»: jedes Werkzeug gegen eine Datenbank ohne Browser, Prüfung der Eingaben, Fehlerfälle,
  Lesemodus, Ressourcen; das Protokoll mit Begrüssung je Fassung, Benachrichtigungen, Fehlercodes, Listen und zustandslosen Anfragen.
- `test/core.cjs`, Abschnitt «Programm für den eigenen Rechner»: das gebaute `agent/nonotes-mcp.cjs` als Prozess: Hilfe und Einträge,
  Datei anlegen, Notiz über MCP schreiben und auf der Platte wiederfinden, Änderung von aussen beim nächsten Aufruf, zwei Prozesse
  abwechselnd und gleichzeitig ohne Verlust, Lesemodus, kaputtes JSON, sauberes Ende.
- `test/collab.cjs`, Abschnitt «Von aussen geändert»: die App führt Änderungen von aussen mit eigenen ungesicherten zusammen
  (Datei und anderer Tab), fragt nur bei derselben Notiz.
- `test/extend.cjs`, Abschnitt «WebMCP»: ein Nachbau von `document.modelContext` nimmt die Werkzeuge der Seite an; Aufrufe legen
  eine Notiz an, beantworten eine Frage, schliessen eine Aufgabe ab; die Oberfläche folgt, gespeichert wird, nach dem Neuladen
  ist alles da; im Lesemodus nur lesende Werkzeuge; ohne Schnittstelle nichts.
