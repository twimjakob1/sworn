'use strict';
const crypto = require('node:crypto');

// Writes an object the same way every time, so its fingerprint is repeatable.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(record) {
  return crypto.createHash('sha256').update(canonical(record)).digest('hex');
}

const FIRST = '0'.repeat(64);

// The public record. Each receipt carries the fingerprint of the one before it,
// so a change to any earlier receipt shows up in every later one.
class ReceiptLedger {
  #entries = [];

  append(body) {
    const previous = this.#entries.length ? this.#entries[this.#entries.length - 1].hash : FIRST;
    const record = { seq: this.#entries.length + 1, previous, ...body };
    const entry = Object.freeze({ ...record, hash: fingerprint(record) });
    this.#entries.push(entry);
    return entry;
  }

  entries() { return this.#entries.map((e) => ({ ...e })); }
  get length() { return this.#entries.length; }

  // Rechecks a list of receipts from the first to the last.
  static verify(entries) {
    let previous = FIRST;
    for (let i = 0; i < entries.length; i += 1) {
      const { hash, ...record } = entries[i];
      if (record.seq !== i + 1 || record.previous !== previous || fingerprint(record) !== hash) {
        return { ok: false, brokenAt: i + 1 };
      }
      previous = hash;
    }
    return { ok: true, brokenAt: null };
  }
}

module.exports = { ReceiptLedger, fingerprint, canonical };
