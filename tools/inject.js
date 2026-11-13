'use strict';
// Proves the tests have teeth. Each run breaks one rule in a copy of the model
// and confirms the test suite fails. A fault the suite misses is reported as missed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const modelDir = path.join(root, 'model');

const faults = [
  { rule: 'An account cannot spend more than it has', file: 'coin.js', find: 'if (balance < amount) throw new Error(`Balance of ${balance} is below ${amount}`);', replace: '' },
  { rule: 'Only the key of an account can move its coins', file: 'coin.js', find: "if (from === undefined) throw new Error('This key opens no account');", replace: 'if (from === undefined) return;' },
  { rule: 'The coin has no function that creates coins', file: 'coin.js', find: '  sumOfBalances() {', replace: '  mint(to, amount) { this.#balances.set(to, this.balanceOf(to) + amount); }\n  sumOfBalances() {' },
  { rule: 'The founder vault observes the 12-month lock and the monthly calendar', file: 'vault.js', find: 'if (day < this.earliestDay(n)) {', replace: 'if (false) {' },
  { rule: 'The founder vault requires the usage milestone', file: 'vault.js', find: 'if (checks < this.checksNeeded(n)) {', replace: 'if (false) {' },
  { rule: 'The founder vault waits out the 30-day notice', file: 'vault.js', find: 'if (day < notice.day + P.NOTICE_DAYS) {', replace: 'if (false) {' },
  { rule: 'A vetoed slice stays unpaid', file: 'vault.js', find: 'if (notice.vetoed) throw new Error(`Slice ${n} was vetoed by coin owners`);', replace: '' },
  { rule: 'Founder-linked accounts have no vote on a founder release', file: 'vault.js', find: 'if (this.#nonVoting.has(account)) throw new Error(`${account} has no vote on a founder release`);', replace: '' },
  { rule: 'Votes weigh by the balance on the notice day', file: 'vault.js', find: 'notice.vetoWeight += notice.snapshot.get(account) ?? 0;', replace: 'notice.vetoWeight += this.#coin.balanceOf(account);' },
  { rule: 'Founder-linked checks stay out of the milestone count', file: 'registry.js', find: 'if (independent && !claim.overturned) this.#independent += 1;', replace: 'this.#independent += 1;' },
  { rule: 'The bond goes to the customer when the work was not done', file: 'registry.js', find: 'const bondPaidTo = claim.finding ? claim.operator : claim.customer;', replace: 'const bondPaidTo = claim.operator;' },
  { rule: 'A false finding costs the checker stake', file: 'registry.js', find: 'const penalty = Math.floor((stake * P.SLASH_PCT) / 100);', replace: 'const penalty = 0;' },
  { rule: 'A challenge is accepted only inside the window', file: 'registry.js', find: "if (this.#clock.day() >= claim.attestedDay + P.CHALLENGE_DAYS) throw new Error('The challenge window has closed');", replace: '' },
  { rule: 'A party to a claim cannot check it', file: 'registry.js', find: "if (checker === claim.operator || checker === claim.customer) throw new Error('A party to the claim cannot check it');", replace: '' },
  { rule: 'A checker with unfinished checks cannot withdraw its stake', file: 'registry.js', find: 'if (this.#openWork.get(account) > 0) throw new Error(`${account} has unfinished checks`);', replace: '' },
  { rule: 'Only the key of the operator posts its claim', file: 'registry.js', find: "if (operator === undefined) throw new Error('This key opens no account');", replace: '' },
  { rule: 'A claim carries a fee of at least the minimum', file: 'registry.js', find: 'if (!Number.isSafeInteger(feeCoins) || feeCoins < P.MIN_CLAIM_FEE) throw new Error(`A claim carries a fee of at least ${P.MIN_CLAIM_FEE} coins`);', replace: '' },
  { rule: 'A claim that cannot pay its fee moves no dollars', file: 'registry.js', find: 'if (this.#coin.balanceOf(operator) < feeCoins) throw new Error(`${operator} has ${this.#coin.balanceOf(operator)} coins; the fee is ${feeCoins}`);', replace: '' },
  { rule: 'The fee leaves the poster when the claim is posted', file: 'registry.js', find: 'this.#coin.transfer(operatorKey, this.#escrow, feeCoins);', replace: '' },
  { rule: 'One fifth of every fee goes to the community pool', file: 'registry.js', find: 'const toPool = Math.floor((claim.feeCoins * P.FEE_POOL_PCT) / 100);', replace: 'const toPool = 0;' },
  { rule: 'An overturned finding pays the fee to the challenger', file: 'registry.js', find: 'const feePaidTo = claim.overturned ? claim.challenger : claim.checker;', replace: 'const feePaidTo = claim.checker;' },
  { rule: 'An overturned finding cannot be challenged again', file: 'registry.js', find: 'if (claim.overturned) throw new Error(`The finding on claim ${id} was already overturned`);', replace: '' },
  { rule: 'A claim waits 30 days for a checker before it can be withdrawn', file: 'registry.js', find: 'if (this.#clock.day() < claim.postedDay + P.OPEN_DAYS) throw new Error(`Claim ${id} can be withdrawn on day ${claim.postedDay + P.OPEN_DAYS}`);', replace: '' },
  { rule: 'Only the operator can withdraw its claim', file: 'registry.js', find: "if (this.#coin.accountOf(operatorKey) !== claim.operator) throw new Error('Only the operator can withdraw its claim');", replace: '' },
  { rule: 'The fee returns to the poster when a claim is withdrawn', file: 'registry.js', find: 'this.#coin.transfer(this.#escrowKey, claim.operator, claim.feeCoins);', replace: '' },
  { rule: 'A finding is judged against the system as it stood on the day of the finding', file: 'registry.js', find: 'const actual = Boolean(claim.readSystem(claim.attestedDay));', replace: 'const actual = Boolean(claim.readSystem());' },
  { rule: 'A sworn statement carries a bond of at least the minimum', file: 'registry.js', find: 'if (!Number.isSafeInteger(bondCoins) || bondCoins < P.MIN_STATEMENT_BOND) throw new Error(`A sworn statement carries a bond of at least ${P.MIN_STATEMENT_BOND} coins`);', replace: '' },
  { rule: 'A sworn statement covers 30 to 365 days', file: 'registry.js', find: 'if (!Number.isSafeInteger(termDays) || termDays < P.MIN_TERM_DAYS || termDays > P.MAX_TERM_DAYS) throw new Error(`A sworn statement covers ${P.MIN_TERM_DAYS} to ${P.MAX_TERM_DAYS} days`);', replace: '' },
  { rule: 'An issuer without the coins for the bond and the fee cannot post', file: 'registry.js', find: 'if (this.#coin.balanceOf(issuer) < bondCoins + feeCoins) throw new Error(`${issuer} has ${this.#coin.balanceOf(issuer)} coins; the bond and the fee come to ${bondCoins + feeCoins}`);', replace: '' },
  { rule: 'The bond and the fee leave the issuer when the statement is posted', file: 'registry.js', find: 'this.#coin.transfer(issuerKey, this.#escrow, bondCoins + feeCoins);', replace: '' },
  { rule: 'Only the key of the issuer posts its sworn statement', file: 'registry.js', find: "if (issuer === undefined) throw new Error('This key opens no account');", replace: '' },
  { rule: 'A statement goes in force only when its first check reads true', file: 'registry.js', find: 'if (claim.finding) {', replace: 'if (true) {' },
  { rule: 'A report is accepted only during the term', file: 'registry.js', find: 'if (this.#clock.day() > claim.endsDay) throw new Error(`The term of statement ${id} ended on day ${claim.endsDay}`);', replace: '' },
  { rule: 'A reporter puts up the report bond', file: 'registry.js', find: 'if (this.#coin.balanceOf(reporter) < P.REPORT_BOND) throw new Error(`A report carries a bond of ${P.REPORT_BOND} coins`);', replace: '' },
  { rule: 'A statement that still reads true stays in force', file: 'registry.js', find: 'if (readsTrue) {', replace: 'if (false) {' },
  { rule: 'One fifth of a forfeited bond pays the reporter and the rest goes to the community pool', file: 'registry.js', find: 'const toReporter = Math.floor((claim.bondCoins * P.REPORTER_PCT) / 100);', replace: 'const toReporter = claim.bondCoins;' },
  { rule: 'The bond returns only after the term', file: 'registry.js', find: 'if (this.#clock.day() <= claim.endsDay) throw new Error(`The term of statement ${id} runs through day ${claim.endsDay}`);', replace: '' },
  { rule: 'The bond returns when an untaken statement is withdrawn', file: 'registry.js', find: "if (claim.kind === 'statement') this.#returnBond(claim);", replace: '' },
  { rule: 'Reports and closings apply to sworn statements only', file: 'registry.js', find: "if (claim.kind !== 'statement') throw new Error(`Record ${id} is a claim about finished work`);", replace: '' },
  { rule: 'Each receipt is linked to the one before it', file: 'receipts.js', find: 'if (record.seq !== i + 1 || record.previous !== previous || fingerprint(record) !== hash) {', replace: 'if (record.seq !== i + 1 || fingerprint(record) !== hash) {' },
  { rule: 'The report card flags a coin whose accounts can be frozen', file: 'reportcard.js', find: "if (f.canFreeze === true) powers.push('freeze individual accounts');", replace: '' },
  { rule: 'The report card reports unread facts as unread', file: 'reportcard.js', find: "return { question, status: 'unknown', finding: 'This could not be read.' };", replace: "return { question, status: 'clear', finding: 'No. The supply is fixed.' };" },
];

function runTests(dir) {
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(root, 'test', 'model.test.js')], {
    env: { ...process.env, MODEL_DIR: dir }, encoding: 'utf8',
  });
  const read = (label) => Number((run.stdout.match(new RegExp(`^# ${label} (\\d+)`, 'm')) || [])[1] ?? -1);
  return { status: run.status, tests: read('tests'), pass: read('pass'), fail: read('fail') };
}

const baseline = runTests(modelDir);
const results = [];
for (const fault of faults) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-fault-'));
  fs.cpSync(modelDir, copy, { recursive: true });
  const target = path.join(copy, fault.file);
  const source = fs.readFileSync(target, 'utf8');
  const occurrences = source.split(fault.find).length - 1;
  if (occurrences !== 1) {
    results.push({ rule: fault.rule, file: fault.file, caught: false, failingTests: 0, note: `The line to break was found ${occurrences} times; expected once` });
  } else {
    fs.writeFileSync(target, source.replace(fault.find, fault.replace));
    const outcome = runTests(copy);
    results.push({ rule: fault.rule, file: fault.file, caught: outcome.status !== 0 && outcome.fail > 0, failingTests: outcome.fail });
  }
  fs.rmSync(copy, { recursive: true, force: true });
}

const summary = {
  ranAt: new Date().toISOString(),
  node: process.version,
  baseline,
  faultsInjected: results.length,
  faultsCaught: results.filter((r) => r.caught).length,
  results,
};
fs.mkdirSync(path.join(root, 'results'), { recursive: true });
fs.writeFileSync(path.join(root, 'results', 'verification.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Baseline: ${baseline.pass} of ${baseline.tests} tests pass, ${baseline.fail} fail`);
for (const r of results) console.log(`${r.caught ? 'CAUGHT' : 'MISSED'}  ${r.rule}  (${r.failingTests} failing)${r.note ? `  ${r.note}` : ''}`);
console.log(`Faults caught: ${summary.faultsCaught} of ${summary.faultsInjected}`);
process.exit(baseline.fail === 0 && baseline.status === 0 && summary.faultsCaught === summary.faultsInjected ? 0 : 1);
