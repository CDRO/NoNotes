/* NoNotes – Kalenderexport (iCalendar, RFC 5545).
   Jede Aufgabe und Frage mit Termin wird ein VEVENT mit fester UID. Die UID setzt sich aus
   einer Kennung der Datenbank und der Nummer im Index zusammen und bleibt über Textänderungen
   stabil; die SEQUENCE steigt mit jedem Export, damit Kalenderprogramme Änderungen übernehmen
   statt zu duplizieren. Erledigte und beantwortete Einträge werden als abgesagt mitgeschrieben,
   ebenso früher exportierte Einträge, die es nicht mehr gibt (umformuliert, gelöscht, Papierkorb). */
(function (global) {
  'use strict';

  const DB = () => global.NoNotesDB;
  const D = () => global.NoNotesDates;

  const DURATION_MIN = 30;
  const KNOWN_KEY = 'calendar_known'; // JSON { uid: { text, due, kind } } aller je exportierten Termine
  const KEEP_DAYS = 365;              // so lange bleiben entfernte Termine als abgesagt in der Datei

  function pad(n) { return String(n).padStart(2, '0'); }

  function escapeText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
  }

  /** Zeilen auf höchstens 75 Oktette falten (Fortsetzung mit führendem Leerzeichen). */
  function fold(line) {
    const enc = new TextEncoder();
    const out = [];
    let current = '';
    let bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > 75) { out.push(current); current = ' ' + ch; bytes = 1 + b; }
      else { current += ch; bytes += b; }
    }
    out.push(current);
    return out.join('\r\n');
  }

  function utcStamp(date) {
    const d = date || new Date();
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }

  function icsDate(iso) { return iso.slice(0, 10).replace(/-/g, ''); }
  function icsDateTime(iso) { return `${icsDate(iso)}T${iso.slice(11, 13)}${iso.slice(14, 16)}00`; }

  function plusMinutes(iso, minutes) {
    const d = D().toDate(iso);
    d.setMinutes(d.getMinutes() + minutes);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function plusDays(iso, days) {
    const d = D().toDate(iso);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function randomId() {
    const bytes = new Uint8Array(8);
    (global.crypto || {}).getRandomValues ? global.crypto.getRandomValues(bytes) : bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** Kennung der Datenbank für stabile UIDs; wird beim ersten Export angelegt. */
  function calendarId(db) {
    let id = DB().getMeta(db, 'calendar_uid');
    if (!id) { id = randomId(); DB().setMeta(db, 'calendar_uid', id); }
    return id;
  }

  function uidFor(calId, kind, id) { return `nonotes-${calId}-${kind}-${id}@nonotes.local`; }

  function loadKnown(db) {
    try {
      const v = JSON.parse(DB().getMeta(db, KNOWN_KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  }

  /** Früher exportierte Termine, die es nicht mehr gibt: umformuliert, gelöscht oder Notiz im Papierkorb.
      Sie werden als abgesagt mitgeschrieben, damit sie auch in importierten Kalendern verschwinden. */
  function removedSince(db, calId, items) {
    if (!calId) return [];
    const known = loadKnown(db);
    const current = new Set(items.map(it => uidFor(calId, it.kind, it.id)));
    const cutoff = plusDays(D().todayIso(), -KEEP_DAYS);
    return Object.entries(known)
      .filter(([uid, k]) => !current.has(uid) && k && typeof k.due === 'string' && D().toDate(k.due) && k.due.slice(0, 10) >= cutoff)
      .map(([uid, k]) => ({ uid, text: String(k.text || ''), due: k.due, kind: k.kind === 'question' ? 'question' : 'task' }));
  }

  function nextSequence(db) {
    const n = Number(DB().getMeta(db, 'calendar_sequence') || 0) + 1;
    DB().setMeta(db, 'calendar_sequence', n);
    return n;
  }

  /** Alle Aufgaben und Fragen mit Termin, vereinheitlicht. */
  function collect(db, includeDone) {
    const items = [];
    const path = noteId => DB().getPath(db, noteId).map(p => p.title.trim() || 'Ohne Titel');
    for (const t of DB().listTasks(db, { status: includeDone ? 'all' : 'open', sort: 'due' })) {
      if (!t.due) continue;
      items.push({ kind: 'task', id: t.id, text: t.text, due: t.due, closed: !!t.done, noteId: t.note_id, noteTitle: t.note_title, path: path(t.note_id), tags: DB().getTags(db, t.note_id), answer: null });
    }
    for (const q of DB().listQuestions(db, { status: includeDone ? 'all' : 'open', sort: 'due' })) {
      if (!q.due) continue;
      items.push({ kind: 'question', id: q.id, text: q.text, due: q.due, closed: !!q.answer, noteId: q.note_id, noteTitle: q.note_title, path: path(q.note_id), tags: DB().getTags(db, q.note_id), answer: q.answer });
    }
    items.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    return items;
  }

  /** Baut die .ics. options: { includeDone, alarms, dryRun }. Ohne dryRun steigt die SEQUENCE. */
  function build(db, options) {
    options = options || {};
    const includeDone = options.includeDone !== false;
    const alarms = options.alarms !== false;
    const items = collect(db, includeDone);
    const calId = options.dryRun ? (DB().getMeta(db, 'calendar_uid') || 'vorschau') : calendarId(db);
    const removed = removedSince(db, calId, items);
    const seq = options.dryRun ? Number(DB().getMeta(db, 'calendar_sequence') || 0) + 1 : nextSequence(db);
    const stamp = utcStamp(options.now ? new Date(options.now) : new Date());
    const mapTitle = DB().getMapTitle(db);
    const lines = [];
    const push = l => lines.push(fold(l));
    const pushDates = due => {
      if (D().hasTime(due)) {
        push(`DTSTART:${icsDateTime(due)}`);
        push(`DTEND:${icsDateTime(plusMinutes(due, DURATION_MIN))}`);
      } else {
        push(`DTSTART;VALUE=DATE:${icsDate(due)}`);
        push(`DTEND;VALUE=DATE:${icsDate(plusDays(due, 1))}`);
      }
    };

    push('BEGIN:VCALENDAR');
    push('VERSION:2.0');
    push('PRODID:-//NoNotes//Kalenderexport//DE');
    push('CALSCALE:GREGORIAN');
    push('METHOD:PUBLISH');
    push(`X-WR-CALNAME:${escapeText('NoNotes · ' + mapTitle)}`);
    push('X-WR-CALDESC:Termine von Aufgaben und Fragen aus NoNotes');

    let open = 0, cancelled = 0;
    for (const it of items) {
      const timed = D().hasTime(it.due);
      const label = it.kind === 'task' ? 'Aufgabe' : 'Frage';
      const summary = it.closed ? `${it.kind === 'task' ? 'Erledigt' : 'Beantwortet'}: ${it.text}` : `${label}: ${it.text}`;
      const desc = [
        `${label} aus NoNotes`,
        `Notiz: ${it.noteTitle.trim() || 'Ohne Titel'}`,
        it.path.length ? `Pfad: ${[mapTitle, ...it.path].join(' › ')}` : `Pfad: ${mapTitle}`,
        it.tags.length ? `Tags: ${it.tags.join(', ')}` : null,
        it.answer ? `Antwort: ${it.answer}` : null,
      ].filter(Boolean).join('\n');
      if (it.closed) cancelled++; else open++;

      push('BEGIN:VEVENT');
      push(`UID:${uidFor(calId, it.kind, it.id)}`);
      push(`DTSTAMP:${stamp}`);
      push(`LAST-MODIFIED:${stamp}`);
      push(`SEQUENCE:${seq}`);
      push(`SUMMARY:${escapeText(summary)}`);
      pushDates(it.due);
      push(`STATUS:${it.closed ? 'CANCELLED' : 'CONFIRMED'}`);
      push(`CATEGORIES:NoNotes,${label}`);
      push(`DESCRIPTION:${escapeText(desc)}`);
      push(`X-NONOTES-KIND:${it.kind}`);
      push(`X-NONOTES-NOTE:${it.noteId}`);
      if (alarms && !it.closed) {
        push('BEGIN:VALARM');
        push('ACTION:DISPLAY');
        push(`DESCRIPTION:${escapeText(summary)}`);
        // Mit Uhrzeit 30 Minuten vorher, ganztägig am Vortag um 9 Uhr (15 Stunden vor Mitternacht).
        push(timed ? 'TRIGGER:-PT30M' : 'TRIGGER:-PT15H');
        push('END:VALARM');
      }
      push('END:VEVENT');
    }
    if (includeDone) {
      for (const r of removed) {
        push('BEGIN:VEVENT');
        push(`UID:${r.uid}`);
        push(`DTSTAMP:${stamp}`);
        push(`LAST-MODIFIED:${stamp}`);
        push(`SEQUENCE:${seq}`);
        push(`SUMMARY:${escapeText('Entfernt: ' + r.text)}`);
        pushDates(r.due);
        push('STATUS:CANCELLED');
        push(`CATEGORIES:NoNotes,${r.kind === 'task' ? 'Aufgabe' : 'Frage'}`);
        push(`DESCRIPTION:${escapeText('Dieser Eintrag existiert in NoNotes nicht mehr (umformuliert, gelöscht oder Notiz im Papierkorb).')}`);
        push(`X-NONOTES-KIND:${r.kind}`);
        push('END:VEVENT');
      }
    }
    push('END:VCALENDAR');
    if (!options.dryRun) {
      // Alles Exportierte merken, damit ein späterer Export Verschwundenes absagen kann.
      const next = {};
      for (const it of items) next[uidFor(calId, it.kind, it.id)] = { text: it.text, due: it.due, kind: it.kind };
      for (const r of removed) next[r.uid] = { text: r.text, due: r.due, kind: r.kind };
      DB().setMeta(db, KNOWN_KEY, JSON.stringify(next));
    }
    const removedCount = includeDone ? removed.length : 0;
    return { ics: lines.join('\r\n') + '\r\n', total: items.length + removedCount, open, cancelled, removed: removedCount, sequence: seq };
  }

  /** Nur zählen, ohne die SEQUENCE zu erhöhen oder etwas zu speichern. */
  function count(db, includeDone) {
    includeDone = includeDone !== false;
    const items = collect(db, includeDone);
    const removed = includeDone ? removedSince(db, DB().getMeta(db, 'calendar_uid'), items).length : 0;
    return { total: items.length + removed, open: items.filter(i => !i.closed).length, cancelled: items.filter(i => i.closed).length, removed };
  }

  global.NoNotesCalendar = { build, count, escapeText, fold };
})(window);
