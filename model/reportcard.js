'use strict';
// The coin report card: five questions answered in ordinary words.
// Each fact is true, false, a number, or null when it could not be read.

const INSIDER_CONCERN_PCT = 20;   // creator and controlling accounts together
const POOL_CLEAR_PCT = 80;        // share of the trading pool that is locked or destroyed
const POOL_SINGLE_OWNER_PCT = 50; // one unlocked account with this much of the pool can empty it

const anyTrue = (...v) => v.some((x) => x === true);
const allFalse = (...v) => v.every((x) => x === false);
const pctText = (n) => `${Number(n.toFixed(2))}%`;

function supply(f) {
  const question = 'Can more coins be created?';
  if (f.canMint === true) return { question, status: 'concern', finding: 'Yes. A controlling account can create new coins after launch.' };
  if (f.canMint === false) return { question, status: 'clear', finding: 'No. The supply is fixed.' };
  return { question, status: 'unknown', finding: 'This could not be read.' };
}

function freezing(f) {
  const question = 'Can anyone freeze or take your coins?';
  const powers = [];
  if (f.canFreeze === true) powers.push('freeze individual accounts');
  if (f.canPause === true) powers.push('pause all transfers');
  if (f.canSeize === true) powers.push('change account balances');
  if (powers.length) {
    if (f.ownerActive === false && f.canReclaimOwnership === false) {
      return { question, status: 'clear', finding: `The code contains functions to ${powers.join(' and ')}. The owner account has been given up, so no one can use them.` };
    }
    return { question, status: 'concern', finding: `Yes. A controlling account can ${powers.join(' and ')}.` };
  }
  if (allFalse(f.canFreeze, f.canPause, f.canSeize)) return { question, status: 'clear', finding: 'No. No account can freeze, pause or change balances.' };
  return { question, status: 'unknown', finding: 'This could not be read in full.' };
}

function insiders(f) {
  const question = 'How much do insiders own?';
  if (typeof f.ownerPct !== 'number' || typeof f.creatorPct !== 'number') {
    return { question, status: 'unknown', finding: 'Insider balances could not be read.' };
  }
  const total = f.ownerPct + f.creatorPct;
  const status = total >= INSIDER_CONCERN_PCT ? 'concern' : 'clear';
  return { question, status, finding: `The creator and controlling accounts own ${pctText(total)} of the supply. Their selling schedule could not be read.` };
}

function pool(f) {
  const question = 'Can the trading pool be withdrawn?';
  if (typeof f.poolLockedPct !== 'number') return { question, status: 'unknown', finding: 'The trading pool could not be read.' };
  if (f.poolLockedPct >= POOL_CLEAR_PCT) return { question, status: 'clear', finding: `${pctText(f.poolLockedPct)} of the pool is locked or destroyed and stays in place.` };
  if (typeof f.poolLargestOwnerPct !== 'number') {
    return { question, status: 'unknown', finding: `${pctText(f.poolLockedPct)} of the pool is locked. Ownership of the remainder could not be read.` };
  }
  if (f.poolLargestOwnerPct >= POOL_SINGLE_OWNER_PCT) {
    return { question, status: 'concern', finding: `One account controls ${pctText(f.poolLargestOwnerPct)} of the pool, and that share is unlocked.` };
  }
  return { question, status: 'clear', finding: `The pool is spread across ${f.poolOwners ?? 'several'} accounts. The largest controls ${pctText(f.poolLargestOwnerPct)}.` };
}

function rules(f) {
  const question = 'Who can change the rules?';
  const powers = [];
  if (f.upgradeable === true) powers.push('the code can be replaced');
  if (f.ownerActive === true) powers.push('an owner account is active');
  if (f.canReclaimOwnership === true) powers.push('ownership can be taken back after it is given up');
  if (powers.length) return { question, status: 'concern', finding: `A controlling party can: ${powers.join('; ')}.` };
  if (allFalse(f.upgradeable, f.ownerActive, f.canReclaimOwnership)) return { question, status: 'clear', finding: 'No one. The code is final and no owner account exists.' };
  return { question, status: 'unknown', finding: 'This could not be read in full.' };
}

function reportCard(facts) {
  const answers = [supply(facts), freezing(facts), insiders(facts), pool(facts), rules(facts)];
  const count = (s) => answers.filter((a) => a.status === s).length;
  return {
    coin: facts.name ?? 'Unnamed coin',
    symbol: facts.symbol ?? null,
    address: facts.address ?? null,
    answers,
    clear: count('clear'),
    concerns: count('concern'),
    unknown: count('unknown'),
  };
}

// ---- reading a public scanner's raw fields into facts ----
const flag = (v) => (v === '1' || v === 1 ? true : v === '0' || v === 0 ? false : null);
const pct = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v) * 100);
const ZERO = /^0x0{40}$/i;

function factsFromScanner(raw, address) {
  const owner = raw.owner_address;
  const lp = Array.isArray(raw.lp_holders) ? raw.lp_holders : null;
  return {
    name: raw.token_name ?? null,
    symbol: raw.token_symbol ?? null,
    address: address ?? null,
    canMint: flag(raw.is_mintable),
    canFreeze: flag(raw.is_blacklisted),
    canPause: flag(raw.transfer_pausable),
    canSeize: flag(raw.owner_change_balance),
    upgradeable: flag(raw.is_proxy),
    ownerActive: owner === undefined || owner === null ? null : !(owner === '' || ZERO.test(owner)),
    canReclaimOwnership: anyTrue(flag(raw.can_take_back_ownership), flag(raw.hidden_owner))
      ? true
      : allFalse(flag(raw.can_take_back_ownership), flag(raw.hidden_owner)) ? false : null,
    ownerPct: pct(raw.owner_percent),
    creatorPct: pct(raw.creator_percent),
    poolLockedPct: lp ? lp.filter((h) => flag(h.is_locked) === true).reduce((s, h) => s + Number(h.percent) * 100, 0) : null,
    poolLargestOwnerPct: lp ? lp.filter((h) => flag(h.is_locked) !== true).reduce((m, h) => Math.max(m, Number(h.percent) * 100), 0) : null,
    poolOwners: raw.lp_holder_count !== undefined && raw.lp_holder_count !== null ? Number(raw.lp_holder_count) : (lp ? lp.length : null),
  };
}

module.exports = { reportCard, factsFromScanner };
