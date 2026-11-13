'use strict';
const P = require('./params');

function assertAmount(n) {
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`Amount must be a positive whole number; received ${n}`);
  }
}

// The coin: a fixed supply and a table of balances.
// There is no function to create coins, freeze an account, reverse a transfer or change a balance.
class Coin {
  #balances = new Map();   // account -> coins
  #keys = new Map();       // secret key -> account (stands in for a wallet's signature)

  // Creates the whole supply once and hands back one key per starting account.
  static launch(allocations) {
    const coin = new Coin();
    const keys = {};
    let total = 0;
    for (const [account, amount] of Object.entries(allocations)) {
      assertAmount(amount);
      keys[account] = coin.#open(account, amount);
      total += amount;
    }
    if (total !== P.SUPPLY) {
      throw new Error(`Allocations total ${total}; the supply is ${P.SUPPLY}`);
    }
    return { coin: Object.freeze(coin), keys };
  }

  #open(account, amount) {
    if (this.#balances.has(account)) throw new Error(`Account ${account} is already open`);
    this.#balances.set(account, amount);
    const key = Symbol(account);
    this.#keys.set(key, account);
    return key;
  }

  // Opens an empty account and returns its key.
  openAccount(account) { return this.#open(account, 0); }

  get totalSupply() { return P.SUPPLY; }
  balanceOf(account) { return this.#balances.get(account) ?? 0; }
  accountOf(key) { return this.#keys.get(key); }
  isOpen(account) { return this.#balances.has(account); }

  // Moves coins. Only the key of the sending account can do it.
  transfer(key, to, amount) {
    const from = this.#keys.get(key);
    if (from === undefined) throw new Error('This key opens no account');
    assertAmount(amount);
    if (!this.#balances.has(to)) throw new Error(`Account ${to} is not open`);
    if (from === to) throw new Error('Sender and recipient are the same account');
    const balance = this.#balances.get(from);
    if (balance < amount) throw new Error(`Balance of ${balance} is below ${amount}`);
    this.#balances.set(from, balance - amount);
    this.#balances.set(to, this.#balances.get(to) + amount);
  }

  // A fixed copy of every balance at this moment, used to weigh votes.
  snapshot() { return new Map(this.#balances); }

  sumOfBalances() {
    let sum = 0;
    for (const value of this.#balances.values()) sum += value;
    return sum;
  }
}

module.exports = { Coin };
