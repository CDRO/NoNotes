/* NoNotes – gemeinsame Datumslogik für Fälligkeiten von Fragen und Aufgaben.
   Schreibweise im Text: "@15.10.2026" oder "@2026-10-15" am Zeilenende. */
(function (global) {
  'use strict';

  const DUE_RE = /\s*@(?:(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2}))\s*$/;

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Trennt eine Fälligkeit am Zeilenende ab: { text, due } mit due als ISO-Datum oder null. */
  function splitDue(raw) {
    const m = DUE_RE.exec(raw);
    if (!m) return { text: String(raw).trim(), due: null };
    let y, mo, d;
    if (m[1]) { d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]); }
    else { y = Number(m[4]); mo = Number(m[5]); d = Number(m[6]); }
    const valid = mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
    return { text: String(raw).slice(0, m.index).trim(), due: valid ? `${y}-${pad(mo)}-${pad(d)}` : null };
  }

  /** Heutiges Datum als ISO (lokale Zeit). */
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** ISO → "15.10.2026". */
  function formatDue(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : '';
  }

  /** Dringlichkeit: 'overdue' | 'today' | 'week' | 'later' | 'none'. */
  function urgency(iso, today) {
    if (!iso) return 'none';
    const t = today || todayIso();
    if (iso < t) return 'overdue';
    if (iso === t) return 'today';
    const d = new Date(t + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    const week = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return iso <= week ? 'week' : 'later';
  }

  const URGENCY_LABELS = { overdue: 'Überfällig', today: 'Heute', week: 'Diese Woche', later: 'Später', none: 'Ohne Termin', done: 'Erledigt', answered: 'Beantwortet' };

  /** Text für ein Fälligkeits-Abzeichen, z. B. "überfällig · 4.10.2026". */
  function dueLabel(iso, today) {
    const u = urgency(iso, today);
    return (u === 'overdue' ? 'überfällig · ' : u === 'today' ? 'heute · ' : '') + formatDue(iso);
  }

  global.NoNotesDates = { splitDue, todayIso, formatDue, urgency, dueLabel, pad, URGENCY_LABELS, DUE_RE };
})(window);
