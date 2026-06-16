export type Tid = string;

const TID_LEN = 13;

const B32 = "234567abcdefghijklmnopqrstuvwxyz";

let clockId: number | null = null;

function getClockId(): number {
  if (clockId !== null) return clockId;
  clockId = (Math.random() * 256) | 0;
  return clockId;
}

export function resetClockId(id?: number): void {
  lastMicros = 0;
  if (id !== undefined) {
    if (id < 0 || id > 255) throw new Error("clockId must be 0-255");
    clockId = id;
  } else {
    clockId = null;
  }
}

let lastMicros = 0;

export function nextTid(): Tid {
  const clock = getClockId();

  let micros: number;
  try {
    micros = Math.floor((performance.timeOrigin + performance.now()) * 1000);
  } catch {
    micros = Date.now() * 1000;
  }

  if (micros <= lastMicros) {
    micros = lastMicros + 1;
  }
  lastMicros = micros;

  return packTid(micros, clock);
}

export function tidFromTime(micros: number, clock?: number): Tid {
  return packTid(micros, clock ?? getClockId());
}

function b32encode(bytes: Uint8Array): string {
  let s = "";
  let bits = 0;
  let value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      s += B32[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    s += B32[(value << (5 - bits)) & 0x1f];
  }
  return s;
}

function b32decode(s: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < s.length; i++) {
    const idx = B32.indexOf(s[i]);
    if (idx === -1) throw new Error(`b32decode: invalid character '${s[i]}'`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function packTid(micros: number, clock: number): Tid {
  const HI_MUL = 0x100000000;
  const hi = Math.floor(micros / HI_MUL);
  const lo = micros % HI_MUL;

  const buf = new Uint8Array(8);
  buf[0] = (hi >>> 16) & 0xff;
  buf[1] = (hi >>> 8) & 0xff;
  buf[2] = hi & 0xff;
  buf[3] = (lo >>> 24) & 0xff;
  buf[4] = (lo >>> 16) & 0xff;
  buf[5] = (lo >>> 8) & 0xff;
  buf[6] = lo & 0xff;
  buf[7] = clock & 0xff;

  const encoded = b32encode(buf);
  return encoded.padEnd(TID_LEN, "2").slice(0, TID_LEN) as Tid;
}

export function parseTid(tid: Tid): { micros: number; clockId: number } {
  const buf = b32decode(tid);
  if (buf.length < 8) throw new Error("parseTid: decoded TID too short");

  const HI_MUL = 0x100000000;
  const hi = (buf[0] << 16) | (buf[1] << 8) | buf[2];
  const lo = ((buf[3] << 24) | (buf[4] << 16) | (buf[5] << 8) | buf[6]) >>> 0;
  const micros = hi * HI_MUL + lo;
  const clockId = buf[7];

  return { micros, clockId };
}

export function isValidTid(s: string): s is Tid {
  if (s.length !== TID_LEN) return false;
  for (let i = 0; i < s.length; i++) {
    if (!B32.includes(s[i])) return false;
  }
  return true;
}
