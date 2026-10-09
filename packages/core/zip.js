/* NoNotes – minimaler ZIP-Writer (Methode "Store", ohne Kompression, UTF-8-Dateinamen).
   Reicht für den Export: wenige Markdown-Dateien und zwei Bilder. */
(function (global) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date) {
    const d = date || new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xFFFF, date: day & 0xFFFF };
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new TextEncoder().encode(String(data));
  }

  /** files: [{ path: 'ordner/datei.md', data: Uint8Array | string }] → Uint8Array (ZIP). */
  function create(files, date) {
    const enc = new TextEncoder();
    const { time, date: dosDate } = dosDateTime(date);
    const parts = [];
    const central = [];
    let offset = 0;

    const u16 = (v, out, pos) => { out[pos] = v & 0xFF; out[pos + 1] = (v >>> 8) & 0xFF; };
    const u32 = (v, out, pos) => { u16(v & 0xFFFF, out, pos); u16((v >>> 16) & 0xFFFF, out, pos + 2); };

    for (const f of files) {
      const name = enc.encode(f.path.replace(/^\/+/, ''));
      const data = toBytes(f.data);
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length);
      u32(0x04034B50, local, 0);
      u16(20, local, 4);          // Version
      u16(0x0800, local, 6);      // UTF-8-Namen
      u16(0, local, 8);           // Store
      u16(time, local, 10);
      u16(dosDate, local, 12);
      u32(crc, local, 14);
      u32(data.length, local, 18);
      u32(data.length, local, 22);
      u16(name.length, local, 26);
      u16(0, local, 28);
      local.set(name, 30);

      const cd = new Uint8Array(46 + name.length);
      u32(0x02014B50, cd, 0);
      u16(20, cd, 4);
      u16(20, cd, 6);
      u16(0x0800, cd, 8);
      u16(0, cd, 10);
      u16(time, cd, 12);
      u16(dosDate, cd, 14);
      u32(crc, cd, 16);
      u32(data.length, cd, 20);
      u32(data.length, cd, 24);
      u16(name.length, cd, 28);
      u16(0, cd, 30);
      u16(0, cd, 32);
      u16(0, cd, 34);
      u16(0, cd, 36);
      u32(0, cd, 38);
      u32(offset, cd, 42);
      cd.set(name, 46);

      parts.push(local, data);
      central.push(cd);
      offset += local.length + data.length;
    }

    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    u32(0x06054B50, end, 0);
    u16(0, end, 4);
    u16(0, end, 6);
    u16(files.length, end, 8);
    u16(files.length, end, 10);
    u32(cdSize, end, 12);
    u32(offset, end, 16);
    u16(0, end, 20);

    const total = offset + cdSize + end.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    for (const c of central) { out.set(c, pos); pos += c.length; }
    out.set(end, pos);
    return out;
  }

  global.NoNotesZip = { create, crc32 };
})(window);
