'use strict';
const P = require('./params');

// The founder vault. It pays the founder share in 36 slices.
// A slice is paid only when four things are true:
//   1. its date has arrived (12-month lock, then one slice a month),
//   2. enough independent verified checks have been recorded,
//   3. a public notice has stood for 30 days,
//   4. coin owners outside the founder's circle have left it standing.
class FounderVault {
  #coin; #key; #founder; #usage; #clock; #nonVoting;
  #released = 0;
  #notice = null;

  constructor({ coin, vaultKey, founderAccount, nonVoting, usage, clock }) {
    this.#coin = coin;
    this.#key = vaultKey;
    this.#founder = founderAccount;
    this.#nonVoting = new Set(nonVoting);
    this.#usage = usage;
    this.#clock = clock;
  }

  get slicesReleased() { return this.#released; }

  sliceAmount(n) {
    const base = Math.floor(P.FOUNDER_SHARE / P.RELEASE_SLICES);
    return n === P.RELEASE_SLICES ? P.FOUNDER_SHARE - base * (P.RELEASE_SLICES - 1) : base;
  }

  earliestDay(n) { return (P.LOCK_MONTHS + n) * P.DAYS_PER_MONTH; }
  checksNeeded(n) { return P.CHECKS_PER_SLICE * n; }

  #assertEligible(n) {
    if (!Number.isInteger(n) || n < 1 || n > P.RELEASE_SLICES) {
      throw new Error(`Slice ${n} is outside 1 to ${P.RELEASE_SLICES}`);
    }
    if (n !== this.#released + 1) {
      throw new Error(`Slice ${this.#released + 1} is next; slice ${n} was requested`);
    }
    const day = this.#clock.day();
    if (day < this.earliestDay(n)) {
      throw new Error(`Slice ${n} opens on day ${this.earliestDay(n)}; today is day ${day}`);
    }
    const checks = this.#usage.independentChecks();
    if (checks < this.checksNeeded(n)) {
      throw new Error(`Slice ${n} needs ${this.checksNeeded(n)} independent verified checks; the count is ${checks}`);
    }
  }

  // Starts the 30-day public notice for the next slice.
  giveNotice(n) {
    this.#assertEligible(n);
    if (this.#notice && !this.#notice.vetoed) {
      throw new Error(`Slice ${this.#notice.slice} already has an open notice`);
    }
    this.#notice = {
      slice: n,
      day: this.#clock.day(),
      snapshot: this.#coin.snapshot(),
      vetoWeight: 0,
      voters: new Set(),
      vetoed: false,
    };
    return { slice: n, releaseDay: this.#notice.day + P.NOTICE_DAYS };
  }

  #votingSupply(snapshot) {
    let supply = 0;
    for (const [account, balance] of snapshot) {
      if (!this.#nonVoting.has(account)) supply += balance;
    }
    return supply;
  }

  // A coin owner objects to the open notice. Votes weigh by the balance on the notice day.
  veto(key) {
    const notice = this.#notice;
    if (!notice || notice.vetoed) throw new Error('No release notice is open');
    if (this.#clock.day() >= notice.day + P.NOTICE_DAYS) throw new Error('The notice period has ended');
    const account = this.#coin.accountOf(key);
    if (account === undefined) throw new Error('This key opens no account');
    if (this.#nonVoting.has(account)) throw new Error(`${account} has no vote on a founder release`);
    if (notice.voters.has(account)) throw new Error(`${account} has already voted`);
    notice.voters.add(account);
    notice.vetoWeight += notice.snapshot.get(account) ?? 0;
    if (notice.vetoWeight * 100 >= P.VETO_PCT * this.#votingSupply(notice.snapshot)) notice.vetoed = true;
    return notice.vetoed;
  }

  // Pays the slice to the founder once every condition is met.
  release(n) {
    const notice = this.#notice;
    if (!notice || notice.slice !== n) throw new Error(`Slice ${n} has no notice on record`);
    if (notice.vetoed) throw new Error(`Slice ${n} was vetoed by coin owners`);
    const day = this.#clock.day();
    if (day < notice.day + P.NOTICE_DAYS) {
      throw new Error(`Slice ${n} can be paid on day ${notice.day + P.NOTICE_DAYS}; today is day ${day}`);
    }
    this.#assertEligible(n);
    const amount = this.sliceAmount(n);
    this.#coin.transfer(this.#key, this.#founder, amount);
    this.#released = n;
    this.#notice = null;
    return amount;
  }
}

module.exports = { FounderVault };
