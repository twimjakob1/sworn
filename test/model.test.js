'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dir = process.env.MODEL_DIR || path.join(__dirname, '..', 'model');
const P = require(path.join(dir, 'params'));
const { Coin } = require(path.join(dir, 'coin'));
const { FounderVault } = require(path.join(dir, 'vault'));
const { Registry } = require(path.join(dir, 'registry'));
const { ReceiptLedger, fingerprint } = require(path.join(dir, 'receipts'));
const { reportCard, factsFromScanner } = require(path.join(dir, 'reportcard'));

const SYSTEM = ['vault:founder', 'pool:community', 'escrow:stakes', 'distribution'];
const LINKED = ['founder', 'founder-company'];

function world() {
  const clock = { now: 0, day() { return this.now; }, advance(n) { this.now += n; }, goTo(d) { if (d > this.now) this.now = d; } };
  const { coin, keys } = Coin.launch({
    'vault:founder': P.FOUNDER_SHARE,
    'pool:community': P.COMMUNITY_POOL,
    distribution: P.FREE_DISTRIBUTION,
  });
  keys.founder = coin.openAccount('founder');
  keys.escrow = coin.openAccount('escrow:stakes');
  const receipts = new ReceiptLedger();
  const registry = new Registry({ coin, pool: 'pool:community', escrowKey: keys.escrow, clock, founderLinked: LINKED, receipts });
  const vault = new FounderVault({
    coin, vaultKey: keys['vault:founder'], founderAccount: 'founder',
    nonVoting: [...SYSTEM, ...LINKED], usage: registry, clock,
  });
  const give = (name, amount) => {
    if (!coin.isOpen(name)) keys[name] = coin.openAccount(name);
    if (amount) coin.transfer(keys.distribution, name, amount);
    return keys[name];
  };
  return { clock, coin, keys, receipts, registry, vault, give };
}

function checker(w, name = 'checker') {
  if (!w.registry.stakeOf(name)) {
    w.give(name, P.MIN_CHECKER_STAKE);
    w.registry.registerChecker(w.keys[name], P.MIN_CHECKER_STAKE);
  }
  return w.keys[name];
}

// Posts one claim. The operator is first given the coins for the fee.
function post(w, statement, truth, { operator = 'operator', customer = 'customer', fee = P.MIN_CLAIM_FEE } = {}) {
  w.give(operator, fee);
  return w.registry.postClaim({ operatorKey: w.keys[operator], customer, statement, bondCents: 100, feeCoins: fee, readSystem: () => truth });
}

// Runs n complete checks from claim to settlement.
function runChecks(w, n, { operator = 'operator', customer = 'customer', by = 'checker', truth = true, fee = P.MIN_CLAIM_FEE } = {}) {
  const key = checker(w, by);
  w.registry.fundUsd(operator, 100 * n);
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const id = post(w, `Task ${i + 1} is finished`, truth, { operator, customer, fee });
    w.registry.attest(key, id, truth, 'System state read directly');
    ids.push(id);
  }
  w.clock.advance(P.CHALLENGE_DAYS);
  ids.forEach((id) => w.registry.finalize(id));
  return ids;
}

// Posts one sworn statement. The issuer is first given the coins for the bond and the fee.
function swear(w, text, read, { issuer = 'issuer', bond = P.MIN_STATEMENT_BOND, fee = P.MIN_CLAIM_FEE, term = P.MIN_TERM_DAYS } = {}) {
  w.give(issuer, bond + fee);
  return w.registry.postStatement({ issuerKey: w.keys[issuer], subject: 'ExampleCoin', statement: text, bondCoins: bond, feeCoins: fee, termDays: term, readSystem: read });
}

// Posts a sworn statement and carries it through its first check. It ends in force or refused.
function swearAndCheck(w, text, read, options = {}) {
  const key = checker(w, options.by ?? 'checker');
  const id = swear(w, text, read, options);
  w.registry.attest(key, id, Boolean(read()), 'System state read directly');
  w.clock.advance(P.CHALLENGE_DAYS);
  w.registry.finalize(id);
  return id;
}

// ---------------------------------------------------------------- the coin
test('the supply is one billion and the three starting shares add up to it', () => {
  const w = world();
  assert.equal(w.coin.totalSupply, 1_000_000_000);
  assert.equal(P.FOUNDER_SHARE + P.COMMUNITY_POOL + P.FREE_DISTRIBUTION, P.SUPPLY);
  assert.equal(w.coin.sumOfBalances(), P.SUPPLY);
  assert.equal(w.coin.balanceOf('vault:founder'), 100_000_000);
});

test('a launch whose shares miss the supply is refused', () => {
  assert.throws(() => Coin.launch({ a: 1, b: 2 }), /supply is 1000000000/);
});

test('the coin has no function to create, destroy, freeze, pause or rewrite balances', () => {
  const surface = Object.getOwnPropertyNames(Coin.prototype).sort();
  assert.deepEqual(surface, ['accountOf', 'balanceOf', 'constructor', 'isOpen', 'openAccount', 'snapshot', 'sumOfBalances', 'totalSupply', 'transfer']);
});

test('a transfer moves coins and leaves the supply unchanged', () => {
  const w = world();
  w.give('alice', 500);
  w.give('bob');
  w.coin.transfer(w.keys.alice, 'bob', 200);
  assert.equal(w.coin.balanceOf('alice'), 300);
  assert.equal(w.coin.balanceOf('bob'), 200);
  assert.equal(w.coin.sumOfBalances(), P.SUPPLY);
});

test('an account cannot spend more than it has', () => {
  const w = world();
  w.give('alice', 500);
  w.give('bob');
  assert.throws(() => w.coin.transfer(w.keys.alice, 'bob', 501), /below 501/);
  assert.equal(w.coin.balanceOf('alice'), 500);
});

test('only the key of an account can move its coins', () => {
  const w = world();
  w.give('thief');
  assert.throws(() => w.coin.transfer(Symbol('vault:founder'), 'thief', 1), /opens no account/);
  assert.equal(w.coin.balanceOf('thief'), 0);
  assert.equal(w.coin.balanceOf('vault:founder'), P.FOUNDER_SHARE);
});

test('zero, negative and fractional amounts are refused', () => {
  const w = world();
  w.give('alice', 10);
  w.give('bob');
  for (const bad of [0, -5, 1.5, Number.NaN, '3']) {
    assert.throws(() => w.coin.transfer(w.keys.alice, 'bob', bad), /positive whole number/);
  }
});

test('a snapshot is a copy; editing it changes no balance', () => {
  const w = world();
  w.give('alice', 10);
  const snap = w.coin.snapshot();
  snap.set('alice', 1_000_000);
  assert.equal(w.coin.balanceOf('alice'), 10);
});

// ---------------------------------------------------------------- the founder vault
test('nothing leaves the founder vault during the lock, even with the usage milestone met', () => {
  const w = world();
  runChecks(w, 500);
  w.clock.goTo(w.vault.earliestDay(1) - 1);
  assert.throws(() => w.vault.giveNotice(1), /opens on day 390/);
});

test('the calendar alone releases nothing; the usage milestone is also required', () => {
  const w = world();
  w.clock.goTo(w.vault.earliestDay(1));
  assert.throws(() => w.vault.giveNotice(1), /needs 500 independent verified checks; the count is 0/);
});

test('checks involving the founder or the founder company do not count toward the milestone', () => {
  const w = world();
  runChecks(w, 200, { by: 'founder-company' });
  runChecks(w, 200, { operator: 'founder' });
  runChecks(w, 200, { customer: 'founder-company' });
  assert.equal(w.registry.independentChecks(), 0);
  runChecks(w, 3);
  assert.equal(w.registry.independentChecks(), 3);
});

test('a slice is paid only after a 30-day public notice', () => {
  const w = world();
  runChecks(w, 500);
  w.clock.goTo(w.vault.earliestDay(1));
  assert.throws(() => w.vault.release(1), /no notice on record/);
  const { releaseDay } = w.vault.giveNotice(1);
  assert.equal(releaseDay, 420);
  w.clock.goTo(419);
  assert.throws(() => w.vault.release(1), /can be paid on day 420/);
  w.clock.goTo(420);
  const paid = w.vault.release(1);
  assert.equal(paid, Math.floor(P.FOUNDER_SHARE / 36));
  assert.equal(w.coin.balanceOf('founder'), paid);
  assert.equal(w.vault.slicesReleased, 1);
});

test('coin owners with 20% of the non-founder coins can block a release', () => {
  const w = world();
  runChecks(w, 500);
  w.give('whale', 1_000_000);
  w.give('minnow', 10);
  w.clock.goTo(w.vault.earliestDay(1));
  w.vault.giveNotice(1);
  assert.equal(w.vault.veto(w.keys.minnow), false);
  assert.equal(w.vault.veto(w.keys.whale), true);
  w.clock.advance(P.NOTICE_DAYS);
  assert.throws(() => w.vault.release(1), /vetoed by coin owners/);
  assert.equal(w.coin.balanceOf('founder'), 0);
});

test('a small objection leaves the release standing', () => {
  const w = world();
  runChecks(w, 500);
  w.give('whale', 1_000_000);
  w.give('minnow', 10);
  w.clock.goTo(w.vault.earliestDay(1));
  w.vault.giveNotice(1);
  w.vault.veto(w.keys.minnow);
  w.clock.advance(P.NOTICE_DAYS);
  assert.equal(w.vault.release(1), w.vault.sliceAmount(1));
});

test('founder-linked accounts cannot vote; nobody votes twice or after the window', () => {
  const w = world();
  runChecks(w, 500);
  w.give('founder-company', 5_000_000);
  w.give('alice', 10);
  w.give('late', 10);
  w.clock.goTo(w.vault.earliestDay(1));
  w.vault.giveNotice(1);
  assert.throws(() => w.vault.veto(w.keys['founder-company']), /no vote on a founder release/);
  assert.throws(() => w.vault.veto(w.keys.founder), /no vote on a founder release/);
  w.vault.veto(w.keys.alice);
  assert.throws(() => w.vault.veto(w.keys.alice), /already voted/);
  w.clock.advance(P.NOTICE_DAYS);
  assert.throws(() => w.vault.veto(w.keys.late), /notice period has ended/);
});

test('votes weigh by the balance on the notice day, so coins moved afterward add nothing', () => {
  const w = world();
  runChecks(w, 500);
  w.give('whale', 1_000_000);
  w.give('helper');
  w.clock.goTo(w.vault.earliestDay(1));
  w.vault.giveNotice(1);
  w.coin.transfer(w.keys.whale, 'helper', 999_990);
  assert.equal(w.vault.veto(w.keys.helper), false);
});

test('slices are paid in order and each one once', () => {
  const w = world();
  runChecks(w, 1000);
  w.clock.goTo(w.vault.earliestDay(2));
  assert.throws(() => w.vault.giveNotice(2), /Slice 1 is next/);
  w.vault.giveNotice(1);
  w.clock.advance(P.NOTICE_DAYS);
  w.vault.release(1);
  assert.throws(() => w.vault.release(1), /no notice on record/);
  assert.throws(() => w.vault.giveNotice(1), /Slice 2 is next/);
});

test('over 48 months with steady use, all 36 slices pay out and total exactly the founder share', () => {
  const w = world();
  for (let n = 1; n <= P.RELEASE_SLICES; n += 1) {
    runChecks(w, P.CHECKS_PER_SLICE);
    w.clock.goTo(w.vault.earliestDay(n));
    w.vault.giveNotice(n);
    w.clock.advance(P.NOTICE_DAYS);
    w.vault.release(n);
  }
  assert.equal(w.coin.balanceOf('founder'), P.FOUNDER_SHARE);
  assert.equal(w.coin.balanceOf('vault:founder'), 0);
  assert.equal(w.registry.independentChecks(), 18_000);
  assert.throws(() => w.vault.giveNotice(37), /outside 1 to 36/);
  assert.equal(w.coin.sumOfBalances(), P.SUPPLY);
});

test('with slow use, the founder is paid slowly whatever the calendar says', () => {
  const w = world();
  runChecks(w, 1000);
  w.clock.goTo(48 * P.DAYS_PER_MONTH);
  for (const n of [1, 2]) {
    w.vault.giveNotice(n);
    w.clock.advance(P.NOTICE_DAYS);
    w.vault.release(n);
  }
  assert.throws(() => w.vault.giveNotice(3), /needs 1500 independent verified checks; the count is 1000/);
  assert.equal(w.coin.balanceOf('founder'), 2 * w.vault.sliceAmount(1));
});

// ---------------------------------------------------------------- checkers, claims and bonds
test('a checker posts at least the minimum stake, and the stake sits in escrow', () => {
  const w = world();
  w.give('carol', 50_000);
  assert.throws(() => w.registry.registerChecker(w.keys.carol, 9_999), /at least 10000/);
  w.registry.registerChecker(w.keys.carol, 10_000);
  assert.equal(w.registry.stakeOf('carol'), 10_000);
  assert.equal(w.coin.balanceOf('escrow:stakes'), w.registry.totalStaked());
  assert.throws(() => w.registry.registerChecker(w.keys.carol, 10_000), /already registered/);
});

test('work that was done: the bond returns to the operator, and the fee pays the checker and the pool', () => {
  const w = world();
  const [id] = runChecks(w, 1);
  assert.equal(w.registry.usdOf('operator'), 100);
  assert.equal(w.registry.usdOf('customer'), 0);
  assert.equal(w.coin.balanceOf('operator'), 0);
  assert.equal(w.coin.balanceOf('checker'), 16);
  assert.equal(w.coin.balanceOf('pool:community'), P.COMMUNITY_POOL + 4);
  const receipt = w.receipts.entries().at(-1);
  assert.equal(receipt.claim, id);
  assert.equal(receipt.finding, 'done');
  assert.equal(receipt.bondPaidTo, 'operator');
  assert.equal(receipt.feePaidTo, 'checker');
  assert.equal(receipt.feeCoins, 20);
  assert.equal(receipt.feeToPool, 4);
});

test('a claim carries a fee in coins: a fee below the minimum is refused, and so is a poster without the coins', () => {
  const w = world();
  w.registry.fundUsd('operator', 300);
  w.give('operator', 15);
  const claim = (feeCoins) => w.registry.postClaim({ operatorKey: w.keys.operator, customer: 'customer', statement: 'A', bondCents: 100, feeCoins, readSystem: () => true });
  for (const bad of [0, 19, 20.5, Number.NaN, '20', undefined]) {
    assert.throws(() => claim(bad), /fee of at least 20 coins/);
  }
  assert.throws(() => claim(20), /operator has 15 coins; the fee is 20/);
  assert.equal(w.registry.usdOf('operator'), 300);
  assert.equal(w.coin.balanceOf('operator'), 15);
  w.give('operator', 5);
  claim(20);
  assert.equal(w.coin.balanceOf('operator'), 0);
  assert.equal(w.registry.usdOf('operator'), 200);
});

test('only the key of the operator posts its claim', () => {
  const w = world();
  w.registry.fundUsd('operator', 100);
  w.give('operator', 20);
  assert.throws(() => w.registry.postClaim({ operatorKey: Symbol('operator'), customer: 'customer', statement: 'A', bondCents: 100, feeCoins: 20, readSystem: () => true }), /opens no account/);
  assert.equal(w.coin.balanceOf('operator'), 20);
  assert.equal(w.registry.usdOf('operator'), 100);
});

test('the fee waits in escrow until the check settles', () => {
  const w = world();
  const key = checker(w);
  w.registry.fundUsd('operator', 100);
  const id = post(w, 'A', true, { fee: 1_000 });
  assert.equal(w.registry.feesInEscrow(), 1_000);
  assert.equal(w.coin.balanceOf('escrow:stakes'), w.registry.totalStaked() + 1_000);
  w.registry.attest(key, id, true, 'read');
  assert.equal(w.coin.balanceOf('checker'), 0);
  w.clock.advance(P.CHALLENGE_DAYS);
  w.registry.finalize(id);
  assert.equal(w.registry.feesInEscrow(), 0);
  assert.equal(w.coin.balanceOf('escrow:stakes'), w.registry.totalStaked());
});

test('four fifths of the fee pay the checker and one fifth goes to the pool, whatever the fee', () => {
  for (const [fee, toPool] of [[20, 4], [21, 4], [24, 4], [25, 5], [1_000, 200], [99_999, 19_999]]) {
    const w = world();
    runChecks(w, 1, { fee });
    assert.equal(w.coin.balanceOf('pool:community'), P.COMMUNITY_POOL + toPool);
    assert.equal(w.coin.balanceOf('checker'), fee - toPool);
    assert.equal(w.coin.sumOfBalances(), P.SUPPLY);
  }
});

test('the registry is built without the key to the community pool, and the pool only grows', () => {
  const w = world();
  assert.throws(() => new Registry({ coin: w.coin, pool: 'no-such-account', escrowKey: w.keys.escrow, clock: w.clock, founderLinked: LINKED, receipts: w.receipts }), /community pool account is not open/);
  let pool = w.coin.balanceOf('pool:community');
  runChecks(w, 50);
  assert.equal(w.coin.balanceOf('pool:community'), pool + 50 * 4);
  pool = w.coin.balanceOf('pool:community');
  runChecks(w, 50, { truth: false });
  assert.equal(w.coin.balanceOf('pool:community'), pool + 50 * 4);
});

test('a claim no checker has taken up can be withdrawn after 30 days; the fee and the bond return', () => {
  const w = world();
  const key = checker(w);
  w.registry.fundUsd('operator', 200);
  const first = post(w, 'A', true, { fee: 50 });
  w.give('stranger');
  assert.throws(() => w.registry.withdrawClaim(w.keys.operator, first), /can be withdrawn on day 30/);
  w.clock.advance(P.OPEN_DAYS);
  assert.throws(() => w.registry.withdrawClaim(w.keys.stranger, first), /Only the operator/);
  w.registry.withdrawClaim(w.keys.operator, first);
  assert.equal(w.coin.balanceOf('operator'), 50);
  assert.equal(w.registry.usdOf('operator'), 200);
  assert.equal(w.registry.feesInEscrow(), 0);
  assert.equal(w.registry.stateOf(first), 'withdrawn');
  assert.throws(() => w.registry.attest(key, first, true, 'read'), /is withdrawn/);
  assert.throws(() => w.registry.withdrawClaim(w.keys.operator, first), /is withdrawn/);
  const second = post(w, 'B', false);
  w.registry.attest(key, second, false, 'read');
  w.clock.advance(P.OPEN_DAYS);
  assert.throws(() => w.registry.withdrawClaim(w.keys.operator, second), /is attested/);
});

test('three cooperating accounts that check their own claims end with fewer coins, and the pool with more', () => {
  const w = world();
  const rounds = 100;
  const start = P.MIN_CHECKER_STAKE + rounds * P.MIN_CLAIM_FEE;
  const pool = w.coin.balanceOf('pool:community');
  runChecks(w, rounds, { operator: 'one', customer: 'two', by: 'three' });
  w.registry.unstake(w.keys.three);
  const end = ['one', 'two', 'three'].reduce((sum, name) => sum + (w.coin.isOpen(name) ? w.coin.balanceOf(name) : 0), 0);
  assert.equal(end, start - rounds * 4);
  assert.equal(w.coin.balanceOf('pool:community'), pool + rounds * 4);
});

test('work reported done that the system shows undone: the bond goes to the customer', () => {
  const w = world();
  runChecks(w, 1, { truth: false });
  assert.equal(w.registry.usdOf('operator'), 0);
  assert.equal(w.registry.usdOf('customer'), 100);
  assert.equal(w.receipts.entries().at(-1).finding, 'not done');
});

test('a false finding costs the checker half its stake, split between the challenger and the pool, and the fee pays the challenger', () => {
  const w = world();
  const key = checker(w);
  w.give('watchdog', P.CHALLENGE_BOND);
  w.registry.fundUsd('operator', 100);
  const id = post(w, 'Refund issued', false);
  w.registry.attest(key, id, true, 'Operator said so');
  const poolBefore = w.coin.balanceOf('pool:community');
  const result = w.registry.challenge(w.keys.watchdog, id);
  assert.deepEqual(result, { upheld: true, penalty: 5_000 });
  assert.equal(w.registry.stakeOf('checker'), 5_000);
  assert.equal(w.coin.balanceOf('watchdog'), P.CHALLENGE_BOND + 2_500);
  assert.equal(w.coin.balanceOf('pool:community'), poolBefore + 2_500);
  w.clock.advance(P.CHALLENGE_DAYS);
  w.registry.finalize(id);
  assert.equal(w.registry.usdOf('customer'), 100);
  assert.equal(w.coin.balanceOf('checker'), 0);
  assert.equal(w.coin.balanceOf('watchdog'), P.CHALLENGE_BOND + 2_500 + 16);
  assert.equal(w.coin.balanceOf('pool:community'), poolBefore + 2_500 + 4);
  assert.equal(w.receipts.entries().at(-1).feePaidTo, 'watchdog');
  assert.equal(w.registry.independentChecks(), 0);
  assert.equal(w.coin.balanceOf('escrow:stakes'), w.registry.totalStaked());
});

test('an overturned finding cannot be challenged a second time', () => {
  const w = world();
  const key = checker(w);
  w.give('watchdog', P.CHALLENGE_BOND);
  w.give('latecomer', P.CHALLENGE_BOND);
  w.registry.fundUsd('operator', 100);
  const id = post(w, 'Refund issued', false);
  w.registry.attest(key, id, true, 'Operator said so');
  w.registry.challenge(w.keys.watchdog, id);
  assert.throws(() => w.registry.challenge(w.keys.latecomer, id), /already overturned/);
  assert.equal(w.coin.balanceOf('latecomer'), P.CHALLENGE_BOND);
  assert.equal(w.coin.balanceOf('checker'), 0);
});

test('a challenge against a correct finding costs the challenger its bond', () => {
  const w = world();
  const key = checker(w);
  w.give('troll', P.CHALLENGE_BOND);
  w.registry.fundUsd('operator', 100);
  const id = post(w, 'Report sent', true);
  w.registry.attest(key, id, true, 'Outbox entry read');
  assert.deepEqual(w.registry.challenge(w.keys.troll, id), { upheld: false, penalty: 0 });
  assert.equal(w.coin.balanceOf('troll'), 0);
  assert.equal(w.coin.balanceOf('checker'), P.CHALLENGE_BOND);
  assert.equal(w.registry.stakeOf('checker'), P.MIN_CHECKER_STAKE);
});

test('the challenge window: a late challenge is refused and an early settlement is refused', () => {
  const w = world();
  const key = checker(w);
  w.give('watchdog', P.CHALLENGE_BOND);
  w.registry.fundUsd('operator', 100);
  const id = post(w, 'Invoice filed', false);
  w.registry.attest(key, id, true, 'Operator said so');
  assert.throws(() => w.registry.finalize(id), /challenge window is still open/);
  w.clock.advance(P.CHALLENGE_DAYS);
  assert.throws(() => w.registry.challenge(w.keys.watchdog, id), /challenge window has closed/);
  assert.equal(w.registry.stakeOf('checker'), P.MIN_CHECKER_STAKE);
});

test('who may check: a registered checker with full stake who is no party to the claim', () => {
  const w = world();
  w.give('operator', 20_000);
  w.registry.registerChecker(w.keys.operator, 10_000);
  w.give('outsider', 5);
  w.registry.fundUsd('operator', 300);
  const id = post(w, 'Backup verified', true);
  assert.throws(() => w.registry.attest(w.keys.operator, id, true, 'x'), /party to the claim/);
  assert.throws(() => w.registry.attest(w.keys.outsider, id, true, 'x'), /less than 10000 coins at stake/);
  assert.throws(() => w.registry.attest(checker(w), id, true, ''), /needs evidence/);
});

test('a checker cut below the minimum cannot check again until the stake is restored', () => {
  const w = world();
  const key = checker(w);
  w.give('watchdog', P.CHALLENGE_BOND);
  w.registry.fundUsd('operator', 200);
  const first = post(w, 'A', false);
  w.registry.attest(key, first, true, 'Operator said so');
  w.registry.challenge(w.keys.watchdog, first);
  const second = post(w, 'B', true);
  assert.throws(() => w.registry.attest(key, second, true, 'read'), /less than 10000 coins at stake/);
  w.give('checker', 5_000);
  w.registry.addStake(key, 5_000);
  w.registry.attest(key, second, true, 'read');
  assert.equal(w.registry.stateOf(second), 'attested');
});

test('a checker with unfinished checks cannot withdraw its stake', () => {
  const w = world();
  const key = checker(w);
  w.registry.fundUsd('operator', 100);
  const id = post(w, 'A', true);
  w.registry.attest(key, id, true, 'read');
  assert.throws(() => w.registry.unstake(key), /unfinished checks/);
  w.clock.advance(P.CHALLENGE_DAYS);
  w.registry.finalize(id);
  assert.equal(w.registry.unstake(key), P.MIN_CHECKER_STAKE);
  assert.equal(w.coin.balanceOf('escrow:stakes'), 0);
});

test('an operator without the dollars for the bond cannot post a claim', () => {
  const w = world();
  assert.throws(() => post(w, 'A', true), /100 are required/);
  assert.equal(w.coin.balanceOf('operator'), P.MIN_CLAIM_FEE);
  assert.equal(w.registry.feesInEscrow(), 0);
});

// ---------------------------------------------------------------- sworn statements
test('a sworn statement that reads true goes in force for its term, with the bond in escrow and the fee paid', () => {
  const w = world();
  const pool = w.coin.balanceOf('pool:community');
  const id = swearAndCheck(w, 'The supply of ExampleCoin is fixed at 1,000,000', () => true, { term: 90 });
  const s = w.registry.statementOf(id);
  assert.equal(s.state, 'in force');
  assert.equal(s.issuer, 'issuer');
  assert.equal(s.endsDay, P.CHALLENGE_DAYS + 90);
  assert.equal(w.registry.bondsInEscrow(), P.MIN_STATEMENT_BOND);
  assert.equal(w.registry.feesInEscrow(), 0);
  assert.equal(w.coin.balanceOf('issuer'), 0);
  assert.equal(w.coin.balanceOf('checker'), 16);
  assert.equal(w.coin.balanceOf('pool:community'), pool + 4);
  assert.equal(w.coin.balanceOf('escrow:stakes'), P.MIN_CHECKER_STAKE + P.MIN_STATEMENT_BOND);
  assert.equal(w.registry.independentChecks(), 1);
  const receipt = w.receipts.entries().at(-1);
  assert.equal(receipt.type, 'statement-checked');
  assert.equal(receipt.finding, 'true');
  assert.equal(receipt.inForceThroughDay, P.CHALLENGE_DAYS + 90);
});

test('a sworn statement needs a bond of at least the minimum, a fee, a term of 30 to 365 days, and the coins for both', () => {
  const w = world();
  w.give('issuer', 50_000);
  const base = { issuerKey: w.keys.issuer, subject: 'ExampleCoin', statement: 'S', bondCoins: P.MIN_STATEMENT_BOND, feeCoins: P.MIN_CLAIM_FEE, termDays: 30, readSystem: () => true };
  assert.throws(() => w.registry.postStatement({ ...base, bondCoins: P.MIN_STATEMENT_BOND - 1 }), /bond of at least 10000/);
  assert.throws(() => w.registry.postStatement({ ...base, bondCoins: 10_000.5 }), /bond of at least 10000/);
  assert.throws(() => w.registry.postStatement({ ...base, feeCoins: P.MIN_CLAIM_FEE - 1 }), /fee of at least 20/);
  assert.throws(() => w.registry.postStatement({ ...base, termDays: P.MIN_TERM_DAYS - 1 }), /covers 30 to 365 days/);
  assert.throws(() => w.registry.postStatement({ ...base, termDays: P.MAX_TERM_DAYS + 1 }), /covers 30 to 365 days/);
  assert.throws(() => w.registry.postStatement({ ...base, subject: '' }), /needs a subject/);
  assert.throws(() => w.registry.postStatement({ ...base, bondCoins: 50_000 }), /bond and the fee come to 50020/);
  assert.equal(w.coin.balanceOf('issuer'), 50_000);
  assert.equal(w.registry.bondsInEscrow(), 0);
  assert.equal(w.registry.feesInEscrow(), 0);
  w.registry.postStatement(base);
  assert.equal(w.coin.balanceOf('issuer'), 50_000 - P.MIN_STATEMENT_BOND - P.MIN_CLAIM_FEE);
});

test('only the key of the issuer posts its sworn statement', () => {
  const w = world();
  w.give('issuer', 50_000);
  assert.throws(() => w.registry.postStatement({ issuerKey: 'a guessed key', subject: 'ExampleCoin', statement: 'S', bondCoins: P.MIN_STATEMENT_BOND, feeCoins: P.MIN_CLAIM_FEE, termDays: 30, readSystem: () => true }), /opens no account/);
  assert.equal(w.registry.bondsInEscrow(), 0);
});

test('the issuer cannot check its own sworn statement', () => {
  const w = world();
  const id = swear(w, 'S', () => true);
  w.give('issuer', P.MIN_CHECKER_STAKE);
  w.registry.registerChecker(w.keys.issuer, P.MIN_CHECKER_STAKE);
  assert.throws(() => w.registry.attest(w.keys.issuer, id, true, 'read'), /party to the claim/);
});

test('a sworn statement that reads false at its first check is refused: the bond returns and the fee is paid', () => {
  const w = world();
  const id = swearAndCheck(w, 'The team wallet has at least 5,000,000 ExampleCoin', () => false);
  assert.equal(w.registry.statementOf(id).state, 'refused');
  assert.equal(w.coin.balanceOf('issuer'), P.MIN_STATEMENT_BOND);
  assert.equal(w.registry.bondsInEscrow(), 0);
  assert.equal(w.coin.balanceOf('checker'), 16);
  assert.throws(() => w.registry.reportBreach(w.give('reporter', 500), id), /is refused/);
  assert.throws(() => w.registry.closeStatement(id), /is refused/);
});

test('a statement shown false during its term forfeits the bond: one fifth to the reporter, four fifths to the pool', () => {
  const w = world();
  let supplyFixed = true;
  const id = swearAndCheck(w, 'The supply of ExampleCoin is fixed', () => supplyFixed, { bond: 25_000, term: 180 });
  const pool = w.coin.balanceOf('pool:community');
  const reporterKey = w.give('reporter', 500);
  w.clock.advance(60);
  supplyFixed = false;
  const outcome = w.registry.reportBreach(reporterKey, id);
  assert.deepEqual(outcome, { broken: true, toReporter: 5_000, toPool: 20_000 });
  assert.equal(w.registry.statementOf(id).state, 'broken');
  assert.equal(w.coin.balanceOf('reporter'), 500 + 5_000);
  assert.equal(w.coin.balanceOf('pool:community'), pool + 20_000);
  assert.equal(w.coin.balanceOf('issuer'), 0);
  assert.equal(w.registry.bondsInEscrow(), 0);
  const receipt = w.receipts.entries().at(-1);
  assert.equal(receipt.type, 'statement-broken');
  assert.equal(receipt.reporter, 'reporter');
  assert.throws(() => w.registry.reportBreach(reporterKey, id), /is broken/);
  assert.throws(() => w.registry.closeStatement(id), /is broken/);
});

test('a report against a statement that still reads true costs the reporter 100 coins, paid to the issuer', () => {
  const w = world();
  const id = swearAndCheck(w, 'The supply of ExampleCoin is fixed', () => true);
  const reporterKey = w.give('reporter', 500);
  const outcome = w.registry.reportBreach(reporterKey, id);
  assert.deepEqual(outcome, { broken: false, toReporter: 0, toPool: 0 });
  assert.equal(w.coin.balanceOf('reporter'), 400);
  assert.equal(w.coin.balanceOf('issuer'), P.REPORT_BOND);
  assert.equal(w.registry.statementOf(id).state, 'in force');
  assert.equal(w.registry.bondsInEscrow(), P.MIN_STATEMENT_BOND);
  assert.equal(w.receipts.entries().at(-1).type, 'report-failed');
  assert.throws(() => w.registry.reportBreach(w.give('poor', 99), id), /bond of 100 coins/);
  assert.throws(() => w.registry.reportBreach('a guessed key', id), /opens no account/);
});

test('an issuer that reports its own broken statement recovers one fifth of the bond and no more', () => {
  const w = world();
  let truth = true;
  const id = swearAndCheck(w, 'S', () => truth, { bond: 10_000 });
  w.give('issuer', P.REPORT_BOND);
  truth = false;
  w.registry.reportBreach(w.keys.issuer, id);
  assert.equal(w.coin.balanceOf('issuer'), P.REPORT_BOND + 2_000);
});

test('a statement that stands through its term is honored: the bond returns, and only after the term', () => {
  const w = world();
  const id = swearAndCheck(w, 'S', () => true, { term: 30 });
  const ends = w.registry.statementOf(id).endsDay;
  w.clock.goTo(ends);
  assert.throws(() => w.registry.closeStatement(id), /runs through day/);
  assert.equal(w.registry.reportBreach(w.give('reporter', 500), id).broken, false);
  w.clock.advance(1);
  assert.throws(() => w.registry.reportBreach(w.keys.reporter, id), /term of statement .* ended/);
  const receipt = w.registry.closeStatement(id);
  assert.equal(receipt.type, 'statement-honored');
  assert.equal(w.registry.statementOf(id).state, 'honored');
  assert.equal(w.coin.balanceOf('issuer'), P.MIN_STATEMENT_BOND + P.REPORT_BOND);
  assert.equal(w.registry.bondsInEscrow(), 0);
  assert.throws(() => w.registry.closeStatement(id), /is honored/);
});

test('a sworn statement no checker takes up can be withdrawn after 30 days; the bond and the fee return', () => {
  const w = world();
  const id = swear(w, 'S', () => true);
  assert.throws(() => w.registry.withdrawClaim(w.keys.issuer, id), /can be withdrawn on day 30/);
  w.clock.advance(P.OPEN_DAYS);
  w.registry.withdrawClaim(w.keys.issuer, id);
  assert.equal(w.coin.balanceOf('issuer'), P.MIN_STATEMENT_BOND + P.MIN_CLAIM_FEE);
  assert.equal(w.registry.bondsInEscrow(), 0);
  assert.equal(w.registry.feesInEscrow(), 0);
  assert.equal(w.coin.balanceOf('escrow:stakes'), 0);
});

test('a checker that calls a false statement true is overturned inside the window, and the statement is refused', () => {
  const w = world();
  const key = checker(w);
  const id = swear(w, 'S', () => false);
  w.registry.attest(key, id, true, 'read');
  const challengerKey = w.give('challenger', P.CHALLENGE_BOND);
  assert.equal(w.registry.challenge(challengerKey, id).upheld, true);
  w.clock.advance(P.CHALLENGE_DAYS);
  w.registry.finalize(id);
  assert.equal(w.registry.statementOf(id).state, 'refused');
  assert.equal(w.coin.balanceOf('issuer'), P.MIN_STATEMENT_BOND);
  assert.equal(w.registry.independentChecks(), 0);
});

test('a finding is judged against the day it was made: changing the system afterward cannot cost an honest checker its stake', () => {
  const w = world();
  const key = checker(w);
  const changedOnDay = 3;
  const read = (day = w.clock.day()) => day < changedOnDay;
  const id = swear(w, 'The supply of ExampleCoin is fixed', read);
  w.clock.advance(1);
  w.registry.attest(key, id, read(), 'read on day 1');
  w.clock.advance(3);
  assert.equal(read(), false);
  const challengerKey = w.give('challenger', P.CHALLENGE_BOND);
  assert.equal(w.registry.challenge(challengerKey, id).upheld, false);
  assert.equal(w.registry.stakeOf('checker'), P.MIN_CHECKER_STAKE);
  assert.equal(w.coin.balanceOf('challenger'), 0);
  w.clock.advance(P.CHALLENGE_DAYS);
  w.registry.finalize(id);
  assert.equal(w.registry.statementOf(id).state, 'in force');
  const outcome = w.registry.reportBreach(w.give('reporter', P.REPORT_BOND), id);
  assert.equal(outcome.broken, true);
  assert.equal(w.coin.balanceOf('issuer'), 0);
});

test('reports and closings apply to sworn statements only', () => {
  const w = world();
  w.registry.fundUsd('operator', 100);
  const id = post(w, 'Task is finished', true);
  assert.throws(() => w.registry.reportBreach(w.give('reporter', 500), id), /claim about finished work/);
  assert.throws(() => w.registry.closeStatement(id), /claim about finished work/);
  assert.throws(() => w.registry.statementOf(id), /claim about finished work/);
});

// ---------------------------------------------------------------- the receipt ledger
test('the receipt ledger verifies from first to last', () => {
  const w = world();
  runChecks(w, 25);
  const entries = w.receipts.entries();
  assert.equal(entries.length, 25);
  assert.deepEqual(ReceiptLedger.verify(entries), { ok: true, brokenAt: null });
});

test('an edited receipt is detected at the receipt that was edited', () => {
  const w = world();
  runChecks(w, 10, { truth: false });
  const entries = w.receipts.entries();
  entries[3].finding = 'done';
  assert.deepEqual(ReceiptLedger.verify(entries), { ok: false, brokenAt: 4 });
});

test('a rewritten receipt with a fresh fingerprint is detected by the receipt after it', () => {
  const w = world();
  runChecks(w, 10, { truth: false });
  const entries = w.receipts.entries();
  const { hash, ...record } = entries[3];
  record.finding = 'done';
  entries[3] = { ...record, hash: fingerprint(record) };
  assert.deepEqual(ReceiptLedger.verify(entries), { ok: false, brokenAt: 5 });
});

test('a removed receipt is detected', () => {
  const w = world();
  runChecks(w, 10);
  const entries = w.receipts.entries();
  entries.splice(4, 1);
  assert.equal(ReceiptLedger.verify(entries).ok, false);
});

// ---------------------------------------------------------------- the coin report card
test('report card: a dollar-coin with issuer controls draws three concerns', () => {
  const card = reportCard({ name: 'Example Dollar', canMint: true, canFreeze: true, canPause: true, canSeize: false, ownerPct: 0, creatorPct: 0, poolLockedPct: null, upgradeable: true, ownerActive: true, canReclaimOwnership: false });
  assert.deepEqual(card.answers.map((a) => a.status), ['concern', 'concern', 'clear', 'unknown', 'concern']);
  assert.match(card.answers[1].finding, /freeze individual accounts and pause all transfers/);
});

test('report card: a fixed, ownerless coin with a locked pool is clear on all five', () => {
  const card = reportCard({ name: 'Example Fixed', canMint: false, canFreeze: false, canPause: false, canSeize: false, ownerPct: 0, creatorPct: 1.5, poolLockedPct: 97.4, upgradeable: false, ownerActive: false, canReclaimOwnership: false });
  assert.equal(card.clear, 5);
  assert.equal(card.concerns, 0);
});

test('report card: what could not be read is reported as unread, never as clear', () => {
  const card = reportCard({ name: 'Unread' });
  assert.deepEqual(card.answers.map((a) => a.status), ['unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
});

test('report card: scanner fields are read into facts', () => {
  const facts = factsFromScanner({
    token_name: 'Sample', token_symbol: 'SMP', is_mintable: '1', is_blacklisted: '0', transfer_pausable: '0', owner_change_balance: '0',
    is_proxy: '0', owner_address: '0x0000000000000000000000000000000000000000', can_take_back_ownership: '0', hidden_owner: '0',
    owner_percent: '0.000000', creator_percent: '0.250000',
    lp_holders: [{ percent: '0.90', is_locked: 1 }, { percent: '0.10', is_locked: 0 }],
  }, '0xabc');
  assert.equal(facts.canMint, true);
  assert.equal(facts.ownerActive, false);
  assert.equal(facts.creatorPct, 25);
  assert.equal(facts.poolLockedPct, 90);
  const card = reportCard(facts);
  assert.deepEqual(card.answers.map((a) => a.status), ['concern', 'clear', 'concern', 'clear', 'clear']);
});

test('report card: freeze and pause functions with the owner account given up are reported as unusable', () => {
  const base = { name: 'Given Up', canMint: false, canFreeze: true, canPause: true, canSeize: false, ownerPct: 0, creatorPct: 0, poolLockedPct: 100, upgradeable: false, canReclaimOwnership: false };
  const givenUp = reportCard({ ...base, ownerActive: false });
  assert.equal(givenUp.answers[1].status, 'clear');
  assert.match(givenUp.answers[1].finding, /owner account has been given up/);
  assert.equal(reportCard({ ...base, ownerActive: true }).answers[1].status, 'concern');
  assert.equal(reportCard({ ...base, ownerActive: null }).answers[1].status, 'concern');
});

test('report card: an unlocked pool is a concern when one account controls half of it, and clear when it is spread out', () => {
  const base = { name: 'Pool', poolLockedPct: 0 };
  assert.equal(reportCard({ ...base, poolLargestOwnerPct: 99.37, poolOwners: 82 }).answers[3].status, 'concern');
  const spread = reportCard({ ...base, poolLargestOwnerPct: 25.45, poolOwners: 247 }).answers[3];
  assert.equal(spread.status, 'clear');
  assert.match(spread.finding, /spread across 247 accounts\. The largest controls 25\.45%/);
  assert.equal(reportCard(base).answers[3].status, 'unknown');
});

test('report card number one: this project coin, graded on the rules in this model', () => {
  const card = reportCard({ name: 'Project coin', canMint: false, canFreeze: false, canPause: false, canSeize: false, ownerPct: 0, creatorPct: (P.FOUNDER_SHARE / P.SUPPLY) * 100, poolLockedPct: null, upgradeable: false, ownerActive: false, canReclaimOwnership: false });
  assert.deepEqual(card.answers.map((a) => a.status), ['clear', 'clear', 'clear', 'unknown', 'clear']);
  assert.match(card.answers[2].finding, /own 10% of the supply/);
});

// ---------------------------------------------------------------- the whole system under random use
test('5,000 random actions: the supply never changes, escrow always equals the stakes, fees and bonds on record, and the pool never pays out', () => {
  let seed = 20261111;
  const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const w = world();
  const users = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
  users.forEach((u) => w.give(u, 200_000));
  ['c1', 'c2', 'c3'].forEach((c) => checker(w, c));
  w.registry.fundUsd('operator', 10_000_000);
  w.give('operator', 1_000_000);
  let poolFloor = w.coin.balanceOf('pool:community');
  const open = [];
  const sworn = [];
  const facts = new Map();
  for (let i = 0; i < 5000; i += 1) {
    const roll = rand();
    try {
      if (roll < 0.3) {
        w.coin.transfer(w.keys[pick(users)], pick(users), 1 + Math.floor(rand() * 5000));
      } else if (roll < 0.38) {
        const issuer = pick(users);
        const fact = { truth: rand() < 0.8 };
        const id = w.registry.postStatement({ issuerKey: w.keys[issuer], subject: `Coin ${i}`, statement: `Statement ${i}`, bondCoins: P.MIN_STATEMENT_BOND + Math.floor(rand() * 20_000), feeCoins: P.MIN_CLAIM_FEE + Math.floor(rand() * 200), termDays: P.MIN_TERM_DAYS + Math.floor(rand() * 60), readSystem: () => fact.truth });
        facts.set(id, fact);
        w.registry.attest(w.keys[pick(['c1', 'c2', 'c3'])], id, rand() < 0.9 ? fact.truth : !fact.truth, 'read');
        open.push(id);
        sworn.push(id);
      } else if (roll < 0.44 && sworn.length) {
        const id = pick(sworn);
        if (rand() < 0.3) facts.get(id).truth = false;
        w.registry.reportBreach(w.keys[pick(users)], id);
      } else if (roll < 0.48 && sworn.length) {
        w.registry.closeStatement(pick(sworn));
      } else if (roll < 0.6) {
        const truth = rand() < 0.7;
        const feeCoins = P.MIN_CLAIM_FEE + Math.floor(rand() * 200);
        const id = w.registry.postClaim({ operatorKey: w.keys.operator, customer: 'customer', statement: `Task ${i}`, bondCents: 100, feeCoins, readSystem: () => truth });
        const said = rand() < 0.9 ? truth : !truth;
        w.registry.attest(w.keys[pick(['c1', 'c2', 'c3'])], id, said, 'read');
        open.push(id);
      } else if (roll < 0.7 && open.length) {
        w.registry.challenge(w.keys[pick(users)], pick(open));
      } else if (roll < 0.93 && open.length) {
        w.registry.finalize(open[0]);
        open.shift();
      } else if (roll < 0.96) {
        const name = pick(['c1', 'c2', 'c3']);
        const short = P.MIN_CHECKER_STAKE - w.registry.stakeOf(name);
        if (short > 0) { w.give(name, short); w.registry.addStake(w.keys[name], short); }
      } else {
        w.clock.advance(1 + Math.floor(rand() * 4));
      }
    } catch (error) {
      // A refused action is part of normal use. The two rules below must stand regardless.
    }
    assert.equal(w.coin.sumOfBalances(), P.SUPPLY);
    assert.equal(w.coin.balanceOf('escrow:stakes'), w.registry.totalStaked() + w.registry.feesInEscrow() + w.registry.bondsInEscrow());
    const pool = w.coin.balanceOf('pool:community');
    assert.ok(pool >= poolFloor);
    poolFloor = pool;
  }
  assert.equal(ReceiptLedger.verify(w.receipts.entries()).ok, true);
  assert.ok(w.receipts.length > 100);
  const kinds = new Set(w.receipts.entries().map((e) => e.type));
  for (const kind of ['check-final', 'statement-checked', 'statement-broken', 'statement-honored', 'report-failed']) assert.ok(kinds.has(kind), `the run produced no ${kind} receipt`);
});
