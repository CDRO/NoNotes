/* NoNotes – gemeinsame Datumslogik für Fälligkeiten von Fragen und Aufgaben.
   Schreibweise im Text am Zeilenende: "@15.10.2026", "@2026-10-15", optional mit Uhrzeit
   "@15.10.2026 14:30" (auch "14.30"). Gespeichert wird "YYYY-MM-DD" oder "YYYY-MM-DDTHH:MM",
   lokale Zeit ohne Zeitzone. */
(function (global) {
  'use strict';

  const DUE_RE = /\s*@(?:(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2}))(?:[ T](\d{1,2})[:.](\d{2}))?\s*$/;

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Trennt eine Fälligkeit am Zeilenende ab: { text, due } mit due als ISO oder null. */
  function splitDue(raw) {
    const m = DUE_RE.exec(raw);
    if (!m) return { text: String(raw).trim(), due: null };
    let y, mo, d;
    if (m[1]) { d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]); }
    else { y = Number(m[4]); mo = Number(m[5]); d = Number(m[6]); }
    const valid = mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
    let due = valid ? `${y}-${pad(mo)}-${pad(d)}` : null;
    if (due && m[7] != null) {
      const h = Number(m[7]), mi = Number(m[8]);
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) due += `T${pad(h)}:${pad(mi)}`;
    }
    return { text: String(raw).slice(0, m.index).trim(), due };
  }

  function hasTime(iso) { return !!iso && iso.length > 10; }
  function datePart(iso) { return iso ? iso.slice(0, 10) : ''; }
  function timePart(iso) { return hasTime(iso) ? iso.slice(11, 16) : null; }

  /** Heutiges Datum als ISO (lokale Zeit). */
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Jetzt als ISO mit Uhrzeit (lokale Zeit), z. B. 2026-10-15T14:30. */
  function nowIso() {
    const d = new Date();
    return `${todayIso()}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** ISO → "15.10.2026" bzw. "15.10.2026, 14:30". */
  function formatDue(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    const date = `${Number(m[3])}.${Number(m[2])}.${m[1]}`;
    return hasTime(iso) ? `${date}, ${timePart(iso)}` : date;
  }

  /** ISO → Date-Objekt in lokaler Zeit (ohne Zeit: Mitternacht). */
  function toDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(iso || '');
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0);
  }

  /** Dringlichkeit: 'overdue' | 'today' | 'week' | 'later' | 'none'.
   *  now darf ein Datum ("2026-10-15") oder Datum mit Uhrzeit ("2026-10-15T14:30") sein. */
  function urgency(iso, now) {
    if (!iso) return 'none';
    const ref = now || nowIso();
    const today = datePart(ref);
    const day = datePart(iso);
    if (day < today) return 'overdue';
    if (day === today) {
      if (hasTime(iso) && hasTime(ref) && timePart(iso) < timePart(ref)) return 'overdue';
      return 'today';
    }
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    const week = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return day <= week ? 'week' : 'later';
  }

  const URGENCY_LABELS = { overdue: 'Überfällig', today: 'Heute', week: 'Diese Woche', later: 'Später', none: 'Ohne Termin', done: 'Erledigt', answered: 'Beantwortet' };

  /** Text für ein Fälligkeits-Abzeichen, z. B. "überfällig · 4.10.2026, 14:30" oder "heute · 14:30". */
  function dueLabel(iso, now) {
    const u = urgency(iso, now);
    if (u === 'today') return 'heute · ' + (hasTime(iso) ? timePart(iso) : formatDue(iso));
    return (u === 'overdue' ? 'überfällig · ' : '') + formatDue(iso);
  }

  global.NoNotesDates = { splitDue, todayIso, nowIso, formatDue, toDate, urgency, dueLabel, hasTime, datePart, timePart, pad, URGENCY_LABELS, DUE_RE };
})(window);
