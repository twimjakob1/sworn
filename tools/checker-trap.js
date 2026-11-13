'use strict';
// Tests one statement: "A checker whose finding was true when it was made loses nothing
// if the system changes afterward."
// One person runs three accounts. The first posts a sworn statement that is true. An honest
// checker reads the system and records "true." The person then changes the system and has a
// second account challenge the finding inside the window. The run counts what each side ends with.
// Usage: node tools/checker-trap.js      (writes results/checker-trap.json)
const fs = require('node:fs');
const path = require('node:path');
const P = require('../model/params');
const { Coin } = require('../model/coin');
const { Registry } = require('../model/registry');
const { ReceiptLedger } = require('../model/receipts');

const clock = { now: 0, day() { return this.now; }, advance(n) { this.now += n; } };
const { coin, keys } = Coin.launch({
  'vault:founder': P.FOUNDER_SHARE,
  'pool:community': P.COMMUNITY_POOL,
  distribution: P.FREE_DISTRIBUTION,
});
keys.escrow = coin.openAccount('escrow:stakes');
const registry = new Registry({
  coin, pool: 'pool:community', escrowKey: keys.escrow, clock,
  founderLinked: ['founder', 'founder-company'], receipts: new ReceiptLedger(),
});

const STAKE = 1_000_000; // a large, honest checker
const group = ['trap-issuer', 'trap-challenger'];
for (const name of [...group, 'honest-checker']) keys[name] = coin.openAccount(name);
coin.transfer(keys.distribution, 'trap-issuer', P.MIN_STATEMENT_BOND + P.MIN_CLAIM_FEE);
coin.transfer(keys.distribution, 'trap-challenger', P.CHALLENGE_BOND);
coin.transfer(keys.distribution, 'honest-checker', STAKE);
registry.registerChecker(keys['honest-checker'], STAKE);

const coinsOfGroup = () => group.reduce((sum, name) => sum + coin.balanceOf(name), 0);
const coinsOfChecker = () => coin.balanceOf('honest-checker') + registry.stakeOf('honest-checker');
const before = { group: coinsOfGroup(), checker: coinsOfChecker(), pool: coin.balanceOf('pool:community') };

// The system the statement is about. It reads true through day 2 and false from day 3 on.
const changedOnDay = 3;
const readSystem = (day = clock.day()) => day < changedOnDay;

const id = registry.postStatement({
  issuerKey: keys['trap-issuer'], subject: 'TrapCoin', statement: 'The supply of TrapCoin is fixed',
  bondCoins: P.MIN_STATEMENT_BOND, feeCoins: P.MIN_CLAIM_FEE, termDays: P.MIN_TERM_DAYS, readSystem,
});
clock.advance(1);
registry.attest(keys['honest-checker'], id, readSystem(), 'System state read directly on day 1');
clock.advance(3); // the issuer changes the system on day 3; this is day 4, inside the window
const challenge = registry.challenge(keys['trap-challenger'], id);
clock.advance(P.CHALLENGE_DAYS);
registry.finalize(id);
let reported = null;
if (registry.statementOf(id).state === 'in force') {
  keys.watcher = coin.openAccount('watcher');
  coin.transfer(keys.distribution, 'watcher', P.REPORT_BOND);
  reported = registry.reportBreach(keys.watcher, id);
}

const after = { group: coinsOfGroup(), checker: coinsOfChecker(), pool: coin.balanceOf('pool:community') };
const result = {
  ranAt: new Date().toISOString(),
  node: process.versions.node,
  statement: 'A checker whose finding was true when it was made loses nothing if the system changes afterward.',
  checkerStake: STAKE,
  findingWasTrueWhenMade: true,
  challengeUpheld: challenge.upheld,
  coinsLostByTheHonestChecker: before.checker - after.checker,
  coinsGainedByTheTwoCooperatingAccounts: after.group - before.group,
  coinsAddedToPool: after.pool - before.pool,
  statementEndedAs: registry.statementOf(id).state,
  bondForfeitedAfterTheChange: reported ? reported.broken : false,
  statementStands: before.checker - after.checker <= 0 && after.group - before.group <= 0,
};
fs.writeFileSync(path.join(__dirname, '..', 'results', 'checker-trap.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
