'use strict';
// Rebuilds the ledger from data/receipts.json and checks the chain of fingerprints.
// Usage: node tools/check-ledger.js
const fs = require('node:fs');
const path = require('node:path');
const { ReceiptLedger } = require('../model/receipts');
const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'receipts.json'), 'utf8'));
const ledger = new ReceiptLedger();
for (const body of source) ledger.append(body);
const entries = ledger.entries();
const check = ReceiptLedger.verify(entries);
if (!check.ok) { console.error('The ledger failed its check.'); process.exit(1); }
const count = (s) => entries.filter((e) => e.state === s).length;
console.log(`${entries.length} entries. Chain of fingerprints intact.`);
console.log(`Tested ${count('Tested')}, Fixed ${count('Fixed')}, Failed ${count('Failed')}, Written ${count('Written')}, Live ${count('Live')}.`);
console.log(`Last fingerprint: ${entries[entries.length - 1].hash}`);
