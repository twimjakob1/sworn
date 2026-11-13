'use strict';
const P = require('./params');

const USD_ESCROW = 'escrow:usd';

// The registry of claims, checks and checkers.
// An operator states that work is finished and posts a dollar bond.
// A checker with coins at stake reads the real system and records what it shows.
// A wrong "done" sends the bond to the customer. A false finding costs the checker stake.
// The poster of a claim pays a fee in coins. Most of it pays the checker whose finding stands,
// and the rest goes to the community pool. The registry is built without the pool's key,
// so it can add to the pool and can take nothing out.
// An issuer can also post a sworn statement about its own coin for a stated term, with a bond
// in coins behind it. A statement shown false during its term forfeits the bond: one fifth to
// the account that reported it, the rest to the community pool.
class Registry {
  #coin; #escrowKey; #pool; #escrow; #clock; #linked; #receipts;
  #stakes = new Map();
  #openWork = new Map();
  #claims = new Map();
  #usd = new Map();
  #fees = 0;
  #bonds = 0;
  #independent = 0;
  #nextId = 1;

  constructor({ coin, pool, escrowKey, clock, founderLinked, receipts }) {
    if (!coin.isOpen(pool)) throw new Error('The community pool account is not open');
    this.#coin = coin;
    this.#escrowKey = escrowKey;
    this.#pool = pool;
    this.#escrow = coin.accountOf(escrowKey);
    this.#clock = clock;
    this.#linked = new Set(founderLinked);
    this.#receipts = receipts;
  }

  // ---- dollars (customer restitution is paid in dollars, never in the coin) ----
  fundUsd(account, cents) {
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Dollar amount must be a positive whole number of cents');
    this.#usd.set(account, this.usdOf(account) + cents);
  }
  usdOf(account) { return this.#usd.get(account) ?? 0; }
  #moveUsd(from, to, cents) {
    if (this.usdOf(from) < cents) throw new Error(`${from} has ${this.usdOf(from)} cents; ${cents} are required`);
    this.#usd.set(from, this.usdOf(from) - cents);
    this.#usd.set(to, this.usdOf(to) + cents);
  }

  // ---- checkers ----
  registerChecker(key, amount) {
    const account = this.#coin.accountOf(key);
    if (account === undefined) throw new Error('This key opens no account');
    if (this.#stakes.has(account)) throw new Error(`${account} is already registered`);
    if (!(amount >= P.MIN_CHECKER_STAKE)) throw new Error(`A checker posts at least ${P.MIN_CHECKER_STAKE} coins`);
    this.#coin.transfer(key, this.#escrow, amount);
    this.#stakes.set(account, amount);
    this.#openWork.set(account, 0);
  }

  addStake(key, amount) {
    const account = this.#coin.accountOf(key);
    if (!this.#stakes.has(account)) throw new Error(`${account} is not a registered checker`);
    this.#coin.transfer(key, this.#escrow, amount);
    this.#stakes.set(account, this.#stakes.get(account) + amount);
  }

  stakeOf(account) { return this.#stakes.get(account) ?? 0; }
  totalStaked() { let sum = 0; for (const v of this.#stakes.values()) sum += v; return sum; }

  unstake(key) {
    const account = this.#coin.accountOf(key);
    if (!this.#stakes.has(account)) throw new Error(`${account} is not a registered checker`);
    if (this.#openWork.get(account) > 0) throw new Error(`${account} has unfinished checks`);
    const stake = this.#stakes.get(account);
    this.#stakes.delete(account);
    this.#openWork.delete(account);
    if (stake > 0) this.#coin.transfer(this.#escrowKey, account, stake);
    return stake;
  }

  // ---- claims ----
  // readSystem stands for the real system the claim is about. The check reads it
  // and gives no weight to what the operator said. Called with a day, it returns
  // what the system showed on that day.
  // The operator posts with its own key and pays the fee for the check in coins.
  postClaim({ operatorKey, customer, statement, bondCents, feeCoins, readSystem }) {
    const operator = this.#coin.accountOf(operatorKey);
    if (operator === undefined) throw new Error('This key opens no account');
    if (!statement || typeof readSystem !== 'function') throw new Error('A claim needs a statement and a system to check it against');
    if (operator === customer) throw new Error('Operator and customer are the same party');
    if (!Number.isSafeInteger(feeCoins) || feeCoins < P.MIN_CLAIM_FEE) throw new Error(`A claim carries a fee of at least ${P.MIN_CLAIM_FEE} coins`);
    if (this.#coin.balanceOf(operator) < feeCoins) throw new Error(`${operator} has ${this.#coin.balanceOf(operator)} coins; the fee is ${feeCoins}`);
    this.#moveUsd(operator, USD_ESCROW, bondCents);
    this.#coin.transfer(operatorKey, this.#escrow, feeCoins);
    this.#fees += feeCoins;
    const id = this.#nextId;
    this.#nextId += 1;
    this.#claims.set(id, { id, operator, customer, statement, bondCents, feeCoins, readSystem, postedDay: this.#clock.day(), state: 'open' });
    return id;
  }

  // A claim no checker has taken up can be withdrawn by its operator after the waiting period.
  // The fee and the bond return in full.
  withdrawClaim(operatorKey, id) {
    const claim = this.#claim(id);
    if (this.#coin.accountOf(operatorKey) !== claim.operator) throw new Error('Only the operator can withdraw its claim');
    if (claim.state !== 'open') throw new Error(`Claim ${id} is ${claim.state}`);
    if (this.#clock.day() < claim.postedDay + P.OPEN_DAYS) throw new Error(`Claim ${id} can be withdrawn on day ${claim.postedDay + P.OPEN_DAYS}`);
    this.#moveUsd(USD_ESCROW, claim.operator, claim.bondCents);
    this.#coin.transfer(this.#escrowKey, claim.operator, claim.feeCoins);
    this.#fees -= claim.feeCoins;
    if (claim.kind === 'statement') this.#returnBond(claim);
    claim.state = 'withdrawn';
  }

  feesInEscrow() { return this.#fees; }
  bondsInEscrow() { return this.#bonds; }

  // ---- sworn statements ----
  // An issuer states a fact about its own coin, for a term, and puts coins behind it.
  // A checker reads the system first. A statement that reads true goes in force for the term.
  // readSystem stands for the real system the statement is about.
  postStatement({ issuerKey, subject, statement, bondCoins, feeCoins, termDays, readSystem }) {
    const issuer = this.#coin.accountOf(issuerKey);
    if (issuer === undefined) throw new Error('This key opens no account');
    if (!subject || !statement || typeof readSystem !== 'function') throw new Error('A sworn statement needs a subject, a statement and a system to check it against');
    if (!Number.isSafeInteger(bondCoins) || bondCoins < P.MIN_STATEMENT_BOND) throw new Error(`A sworn statement carries a bond of at least ${P.MIN_STATEMENT_BOND} coins`);
    if (!Number.isSafeInteger(feeCoins) || feeCoins < P.MIN_CLAIM_FEE) throw new Error(`A sworn statement carries a fee of at least ${P.MIN_CLAIM_FEE} coins`);
    if (!Number.isSafeInteger(termDays) || termDays < P.MIN_TERM_DAYS || termDays > P.MAX_TERM_DAYS) throw new Error(`A sworn statement covers ${P.MIN_TERM_DAYS} to ${P.MAX_TERM_DAYS} days`);
    if (this.#coin.balanceOf(issuer) < bondCoins + feeCoins) throw new Error(`${issuer} has ${this.#coin.balanceOf(issuer)} coins; the bond and the fee come to ${bondCoins + feeCoins}`);
    this.#coin.transfer(issuerKey, this.#escrow, bondCoins + feeCoins);
    this.#bonds += bondCoins;
    this.#fees += feeCoins;
    const id = this.#nextId;
    this.#nextId += 1;
    this.#claims.set(id, { id, kind: 'statement', operator: issuer, customer: undefined, subject, statement, bondCents: 0, bondCoins, feeCoins, termDays, readSystem, postedDay: this.#clock.day(), state: 'open' });
    return id;
  }

  #statement(id) {
    const claim = this.#claim(id);
    if (claim.kind !== 'statement') throw new Error(`Record ${id} is a claim about finished work`);
    return claim;
  }

  #returnBond(claim) {
    this.#coin.transfer(this.#escrowKey, claim.operator, claim.bondCoins);
    this.#bonds -= claim.bondCoins;
  }

  statementOf(id) {
    const { operator, subject, statement, bondCoins, termDays, state, endsDay } = this.#statement(id);
    return { id, issuer: operator, subject, statement, bondCoins, termDays, state, endsDay };
  }

  // During the term anyone may report that the statement no longer reads true.
  // The system is read again. A statement that reads false forfeits its bond.
  // A statement that still reads true costs the reporter its report bond, paid to the issuer.
  reportBreach(key, id) {
    const reporter = this.#coin.accountOf(key);
    const claim = this.#statement(id);
    if (reporter === undefined) throw new Error('This key opens no account');
    if (claim.state !== 'in force') throw new Error(`Statement ${id} is ${claim.state}`);
    if (this.#clock.day() > claim.endsDay) throw new Error(`The term of statement ${id} ended on day ${claim.endsDay}`);
    if (this.#coin.balanceOf(reporter) < P.REPORT_BOND) throw new Error(`A report carries a bond of ${P.REPORT_BOND} coins`);
    const readsTrue = Boolean(claim.readSystem(this.#clock.day()));
    if (readsTrue) {
      this.#coin.transfer(key, claim.operator, P.REPORT_BOND);
      this.#receipts.append({ type: 'report-failed', statement: id, issuer: claim.operator, reporter, day: this.#clock.day() });
      return { broken: false, toReporter: 0, toPool: 0 };
    }
    const toReporter = Math.floor((claim.bondCoins * P.REPORTER_PCT) / 100);
    const bondToPool = claim.bondCoins - toReporter;
    if (toReporter > 0) this.#coin.transfer(this.#escrowKey, reporter, toReporter);
    if (bondToPool > 0) this.#coin.transfer(this.#escrowKey, this.#pool, bondToPool);
    this.#bonds -= claim.bondCoins;
    claim.state = 'broken';
    this.#receipts.append({ type: 'statement-broken', statement: id, subject: claim.subject, text: claim.statement, issuer: claim.operator, reporter, bondCoins: claim.bondCoins, toReporter, toPool: bondToPool, day: this.#clock.day() });
    return { broken: true, toReporter, toPool: bondToPool };
  }

  // After the term anyone may close a statement that stood throughout. The bond returns to the issuer.
  closeStatement(id) {
    const claim = this.#statement(id);
    if (claim.state !== 'in force') throw new Error(`Statement ${id} is ${claim.state}`);
    if (this.#clock.day() <= claim.endsDay) throw new Error(`The term of statement ${id} runs through day ${claim.endsDay}`);
    this.#returnBond(claim);
    claim.state = 'honored';
    return this.#receipts.append({ type: 'statement-honored', statement: id, subject: claim.subject, text: claim.statement, issuer: claim.operator, bondCoins: claim.bondCoins, day: this.#clock.day() });
  }

  #claim(id) {
    const claim = this.#claims.get(id);
    if (!claim) throw new Error(`Claim ${id} is not on record`);
    return claim;
  }

  stateOf(id) { return this.#claim(id).state; }

  attest(key, id, finding, evidence) {
    const checker = this.#coin.accountOf(key);
    const claim = this.#claim(id);
    if (this.stakeOf(checker) < P.MIN_CHECKER_STAKE) throw new Error(`${checker} has less than ${P.MIN_CHECKER_STAKE} coins at stake`);
    if (claim.state !== 'open') throw new Error(`Claim ${id} is ${claim.state}`);
    if (checker === claim.operator || checker === claim.customer) throw new Error('A party to the claim cannot check it');
    if (!evidence) throw new Error('A finding needs evidence');
    Object.assign(claim, { checker, finding: Boolean(finding), evidence, attestedDay: this.#clock.day(), state: 'attested' });
    this.#openWork.set(checker, this.#openWork.get(checker) + 1);
  }

  // Anyone may dispute a finding inside the window by posting a bond and rereading the system.
  challenge(key, id) {
    const challenger = this.#coin.accountOf(key);
    const claim = this.#claim(id);
    if (challenger === undefined) throw new Error('This key opens no account');
    if (claim.state !== 'attested') throw new Error(`Claim ${id} is ${claim.state}`);
    if (this.#clock.day() >= claim.attestedDay + P.CHALLENGE_DAYS) throw new Error('The challenge window has closed');
    if (challenger === claim.checker) throw new Error('A checker cannot challenge its own finding');
    if (claim.overturned) throw new Error(`The finding on claim ${id} was already overturned`);
    this.#coin.transfer(key, this.#escrow, P.CHALLENGE_BOND);
    // A finding is judged against the system as it stood on the day the finding was made.
    // A change made afterward leaves a finding that was true that day standing.
    const actual = Boolean(claim.readSystem(claim.attestedDay));
    if (actual !== claim.finding) {
      const stake = this.#stakes.get(claim.checker);
      const penalty = Math.floor((stake * P.SLASH_PCT) / 100);
      const toChallenger = Math.floor(penalty / 2);
      const toPool = penalty - toChallenger;
      this.#stakes.set(claim.checker, stake - penalty);
      this.#coin.transfer(this.#escrowKey, challenger, P.CHALLENGE_BOND + toChallenger);
      if (toPool > 0) this.#coin.transfer(this.#escrowKey, this.#pool, toPool);
      claim.finding = actual;
      claim.overturned = true;
      claim.challenger = challenger;
      this.#receipts.append({ type: 'finding-overturned', claim: id, checker: claim.checker, challenger, penalty, day: this.#clock.day() });
      return { upheld: true, penalty };
    }
    this.#coin.transfer(this.#escrowKey, claim.checker, P.CHALLENGE_BOND);
    this.#receipts.append({ type: 'challenge-failed', claim: id, checker: claim.checker, challenger, day: this.#clock.day() });
    return { upheld: false, penalty: 0 };
  }

  // Closes a check after the challenge window and settles the bond and the fee.
  finalize(id) {
    const claim = this.#claim(id);
    if (claim.state !== 'attested') throw new Error(`Claim ${id} is ${claim.state}`);
    if (this.#clock.day() < claim.attestedDay + P.CHALLENGE_DAYS) throw new Error('The challenge window is still open');
    const isStatement = claim.kind === 'statement';
    const bondPaidTo = claim.finding ? claim.operator : claim.customer;
    if (!isStatement) this.#moveUsd(USD_ESCROW, bondPaidTo, claim.bondCents);
    // The fee pays whoever established what the system shows: the checker whose finding stood,
    // or the challenger who proved it false. The community pool receives its share either way.
    const toPool = Math.floor((claim.feeCoins * P.FEE_POOL_PCT) / 100);
    const feePaidTo = claim.overturned ? claim.challenger : claim.checker;
    this.#coin.transfer(this.#escrowKey, feePaidTo, claim.feeCoins - toPool);
    if (toPool > 0) this.#coin.transfer(this.#escrowKey, this.#pool, toPool);
    this.#fees -= claim.feeCoins;
    const independent = ![claim.operator, claim.customer, claim.checker].some((a) => this.#linked.has(a));
    if (independent && !claim.overturned) this.#independent += 1;
    this.#openWork.set(claim.checker, this.#openWork.get(claim.checker) - 1);
    if (isStatement) return this.#settleStatement(claim, { feePaidTo, toPool, independent });
    claim.state = 'final';
    return this.#receipts.append({
      type: 'check-final',
      claim: id,
      statement: claim.statement,
      finding: claim.finding ? 'done' : 'not done',
      evidence: claim.evidence,
      checker: claim.checker,
      bondPaidTo,
      feeCoins: claim.feeCoins,
      feePaidTo,
      feeToPool: toPool,
      independent,
      day: this.#clock.day(),
    });
  }

  // A statement that read true goes in force for its term. One that read false is refused
  // and its bond returns: the issuer has sworn to nothing.
  #settleStatement(claim, { feePaidTo, toPool, independent }) {
    const day = this.#clock.day();
    if (claim.finding) {
      claim.state = 'in force';
      claim.endsDay = day + claim.termDays;
    } else {
      this.#returnBond(claim);
      claim.state = 'refused';
    }
    return this.#receipts.append({
      type: 'statement-checked',
      statement: claim.id,
      subject: claim.subject,
      text: claim.statement,
      finding: claim.finding ? 'true' : 'false',
      evidence: claim.evidence,
      issuer: claim.operator,
      checker: claim.checker,
      bondCoins: claim.bondCoins,
      inForceThroughDay: claim.finding ? claim.endsDay : null,
      feeCoins: claim.feeCoins,
      feePaidTo,
      feeToPool: toPool,
      independent,
      day,
    });
  }

  independentChecks() { return this.#independent; }
}

module.exports = { Registry, USD_ESCROW };
