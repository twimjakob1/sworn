'use strict';
// Tests one statement: "Cooperating accounts gain nothing from checks that involve no real work."
// One person runs three accounts: the first posts a claim that is trivially true, the second is
// named as customer, and the third checks it. The run counts what the three accounts end with.
// Usage: node tools/reward-farming.js      (writes results/reward-farming.json)
const fs = require('node:fs');
const path = require('node:path');
const P = require('../model/params');
const { Coin } = require('../model/coin');
const { Registry } = require('../model/registry');
const { ReceiptLedger } = require('../model/receipts');

const ROUNDS = 100;
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

// One person, three accounts. None is on the founder list.
const group = ['account-one', 'account-two', 'account-three'];
for (const name of group) keys[name] = coin.openAccount(name);
coin.transfer(keys.distribution, 'account-one', ROUNDS * P.MIN_CLAIM_FEE);
coin.transfer(keys.distribution, 'account-three', P.MIN_CHECKER_STAKE);
registry.fundUsd('account-one', ROUNDS);
const coinsOfGroup = () => group.reduce((sum, name) => sum + coin.balanceOf(name), 0) + registry.stakeOf('account-three');

const before = {
  group: coinsOfGroup(),
  pool: coin.balanceOf('pool:community'),
  dollarsInCents: registry.usdOf('account-one'),
  independentChecks: registry.independentChecks(),
};

registry.registerChecker(keys['account-three'], P.MIN_CHECKER_STAKE);
const ids = [];
for (let i = 0; i < ROUNDS; i += 1) {
  const id = registry.postClaim({
    operatorKey: keys['account-one'], customer: 'account-two',
    statement: 'One plus one equals two', bondCents: 1, feeCoins: P.MIN_CLAIM_FEE, readSystem: () => true,
  });
  registry.attest(keys['account-three'], id, true, 'Read directly');
  ids.push(id);
}
clock.advance(P.CHALLENGE_DAYS);
ids.forEach((id) => registry.finalize(id));
const stakeReturned = registry.unstake(keys['account-three']);

const after = {
  group: coinsOfGroup(),
  pool: coin.balanceOf('pool:community'),
  dollarsInCents: registry.usdOf('account-one'),
  independentChecks: registry.independentChecks(),
};

const result = {
  ranAt: new Date().toISOString(),
  node: process.versions.node,
  statement: 'Cooperating accounts gain nothing from checks that involve no real work.',
  rounds: ROUNDS,
  feePerCheck: P.MIN_CLAIM_FEE,
  coinsLostByTheThreeAccounts: before.group - after.group,
  coinsAddedToPool: after.pool - before.pool,
  stakeReturnedInFull: stakeReturned === P.MIN_CHECKER_STAKE,
  dollarsLostInCents: before.dollarsInCents - after.dollarsInCents,
  checksAddedToFounderMilestone: after.independentChecks - before.independentChecks,
  coinsPaidPerCheckAddedToMilestone: (before.group - after.group) / ROUNDS,
  statementStands: after.group < before.group && after.pool >= before.pool,
};
fs.writeFileSync(path.join(__dirname, '..', 'results', 'reward-farming.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
