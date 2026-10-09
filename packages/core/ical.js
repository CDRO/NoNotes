/* NoNotes – Kalenderexport (iCalendar, RFC 5545).
   Jede Aufgabe und Frage mit Termin wird ein VEVENT mit fester UID. Die UID setzt sich aus
   einer Kennung der Datenbank und der Nummer im Index zusammen und bleibt über Textänderungen
   stabil; die SEQUENCE steigt mit jedem Export, damit Kalenderprogramme Änderungen übernehmen
   statt zu duplizieren. Erledigte und beantwortete Einträge werden als abgesagt mitgeschrieben,
   ebenso früher exportierte Einträge, die es nicht mehr gibt (umformuliert, gelöscht, Papierkorb). */
(function (global) {
  'use strict';

  const { t } = global.NoNotesI18n;

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
  async function calendarId(backend) {
    let id = await backend.getMeta('calendar_uid');
    if (!id) { id = randomId(); await backend.setMeta('calendar_uid', id); }
    return id;
  }

  function uidFor(calId, kind, id) { return `nonotes-${calId}-${kind}-${id}@nonotes.local`; }

  async function loadKnown(backend) {
    try {
      const v = JSON.parse(await backend.getMeta(KNOWN_KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }
  }

  /** Früher exportierte Termine, die es nicht mehr gibt: umformuliert, gelöscht oder Notiz im Papierkorb.
      Sie werden als abgesagt mitgeschrieben, damit sie auch in importierten Kalendern verschwinden. */
  async function removedSince(backend, calId, items) {
    if (!calId) return [];
    const known = await loadKnown(backend);
    const current = new Set(items.map(it => uidFor(calId, it.kind, it.id)));
    const cutoff = plusDays(D().todayIso(), -KEEP_DAYS);
    return Object.entries(known)
      .filter(([uid, k]) => !current.has(uid) && k && typeof k.due === 'string' && D().toDate(k.due) && k.due.slice(0, 10) >= cutoff)
      .map(([uid, k]) => ({ uid, text: String(k.text || ''), due: k.due, kind: k.kind === 'question' ? 'question' : 'task' }));
  }

  async function nextSequence(backend) {
    const n = Number(await backend.getMeta('calendar_sequence') || 0) + 1;
    await backend.setMeta('calendar_sequence', n);
    return n;
  }

  /** Alle Aufgaben und Fragen mit Termin, vereinheitlicht. */
  async function collect(backend, includeDone) {
    const items = [];
    const path = async noteId => (await backend.getPath(noteId)).map(p => p.title.trim() || t('Ohne Titel'));
    for (const task of await backend.listTasks({ status: includeDone ? 'all' : 'open', sort: 'due' })) {
      if (!task.due) continue;
      items.push({ kind: 'task', id: task.id, text: task.text, due: task.due, closed: !!task.done, noteId: task.note_id, noteTitle: task.note_title, path: await path(task.note_id), tags: await backend.getTags(task.note_id), answer: null });
    }
    for (const q of await backend.listQuestions({ status: includeDone ? 'all' : 'open', sort: 'due' })) {
      if (!q.due) continue;
      items.push({ kind: 'question', id: q.id, text: q.text, due: q.due, closed: !!q.answer, noteId: q.note_id, noteTitle: q.note_title, path: await path(q.note_id), tags: await backend.getTags(q.note_id), answer: q.answer });
    }
    items.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    return items;
  }

  /** Baut die .ics. options: { includeDone, alarms, dryRun }. Ohne dryRun steigt die SEQUENCE. */
  async function build(backend, options) {
    options = options || {};
    const includeDone = options.includeDone !== false;
    const alarms = options.alarms !== false;
    const items = await collect(backend, includeDone);
    const calId = options.dryRun ? (await backend.getMeta('calendar_uid') || 'vorschau') : await calendarId(backend);
    const removed = await removedSince(backend, calId, items);
    const seq = options.dryRun ? Number(await backend.getMeta('calendar_sequence') || 0) + 1 : await nextSequence(backend);
    const stamp = utcStamp(options.now ? new Date(options.now) : new Date());
    const mapTitle = await backend.getMapTitle();
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
    push('X-WR-CALDESC:' + escapeText(t('Termine von Aufgaben und Fragen aus NoNotes')));

    let open = 0, cancelled = 0;
    for (const it of items) {
      const timed = D().hasTime(it.due);
      const isTask = it.kind === 'task';
      const label = isTask ? t('Aufgabe') : t('Frage');
      const summary = it.closed
        ? (isTask ? t('Erledigt: {text}', { text: it.text }) : t('Beantwortet: {text}', { text: it.text }))
        : (isTask ? t('Aufgabe: {text}', { text: it.text }) : t('Frage: {text}', { text: it.text }));
      const desc = [
        isTask ? t('Aufgabe aus NoNotes') : t('Frage aus NoNotes'),
        t('Notiz: {titel}', { titel: it.noteTitle.trim() || t('Ohne Titel') }),
        t('Pfad: {pfad}', { pfad: [mapTitle, ...it.path].join(' › ') }),
        it.tags.length ? t('Tags: {tags}', { tags: it.tags.join(', ') }) : null,
        it.answer ? t('Antwort: {antwort}', { antwort: it.answer }) : null,
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
        push(`SUMMARY:${escapeText(t('Entfernt: {text}', { text: r.text }))}`);
        pushDates(r.due);
        push('STATUS:CANCELLED');
        push(`CATEGORIES:NoNotes,${r.kind === 'task' ? t('Aufgabe') : t('Frage')}`);
        push(`DESCRIPTION:${escapeText(t('Dieser Eintrag existiert in NoNotes nicht mehr (umformuliert, gelöscht oder Notiz im Papierkorb).'))}`);
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
      await backend.setMeta(KNOWN_KEY, JSON.stringify(next));
    }
    const removedCount = includeDone ? removed.length : 0;
    return { ics: lines.join('\r\n') + '\r\n', total: items.length + removedCount, open, cancelled, removed: removedCount, sequence: seq };
  }

  /** Nur zählen, ohne die SEQUENCE zu erhöhen oder etwas zu speichern. */
  async function count(backend, includeDone) {
    includeDone = includeDone !== false;
    const items = await collect(backend, includeDone);
    const removed = includeDone ? (await removedSince(backend, await backend.getMeta('calendar_uid'), items)).length : 0;
    return { total: items.length + removed, open: items.filter(i => !i.closed).length, cancelled: items.filter(i => i.closed).length, removed };
  }

  global.NoNotesCalendar = { build, count, escapeText, fold };
})(window);
