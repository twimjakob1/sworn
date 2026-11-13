// Practice-chain script for the registry. First run: November 13, 2026.
// Runs in a browser page. It compiles contracts/Coin.sol and contracts/Registry.sol with the
// current Solidity compiler, starts a practice chain inside the page, and runs the checks below.
// No wallet, no network, no money. Before running, set window.__sworn to { coin, reg }: the text
// of the two files. The SHA-256 of each file that was run is in results/registry-chain.json.
const SRC = window.__sworn;
const out = {};
let compiled = null;
try {
  const list = await fetch('https://binaries.soliditylang.org/bin/list.json').then(r => r.json());
  out.compiler = list.latestRelease;
  const file = list.releases[list.latestRelease];
  out.compilerBuild = file;
  const input = { language: 'Solidity', sources: { 'Coin.sol': { content: SRC.coin }, 'Registry.sol': { content: SRC.reg } }, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
  const workerCode = `importScripts('https://binaries.soliditylang.org/bin/${file}'); onmessage = function (e) { try { var compile = Module.cwrap('solidity_compile', 'string', ['string', 'number', 'number']); postMessage({ ok: true, out: compile(e.data, 0, 0) }); } catch (err) { postMessage({ ok: false, err: String(err) }); } };`;
  const worker = new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' })));
  const result = await new Promise((resolve) => { worker.onmessage = (e) => resolve(e.data); worker.onerror = (e) => resolve({ ok: false, err: 'worker: ' + (e.message || 'error') }); worker.postMessage(JSON.stringify(input)); setTimeout(() => resolve({ ok: false, err: 'timeout after 100s' }), 100000); });
  worker.terminate();
  if (!result.ok) { out.compileError = result.err; } else {
    compiled = JSON.parse(result.out);
    out.messages = (compiled.errors || []).map(e => e.severity + ': ' + String(e.formattedMessage || e.message).slice(0, 300));
    out.contracts = Object.fromEntries(Object.entries((compiled.contracts || {})['Registry.sol'] || {}).map(([n, c]) => [n, c.evm.bytecode.object.length / 2]));
  }
} catch (e) { out.compileError = String(e); }
if (compiled && compiled.contracts && compiled.contracts['Registry.sol'] && compiled.contracts['Registry.sol'].Registry) {
  const steps = [];
  try {
    const evmMod = await import('https://esm.sh/@ethereumjs/evm');
    const util = await import('https://esm.sh/@ethereumjs/util');
    const { Interface } = await import('https://esm.sh/ethers@6');
    const evm = evmMod.createEVM ? await evmMod.createEVM() : await evmMod.EVM.create();
    const A = (s) => (util.createAddressFromString ? util.createAddressFromString(s) : util.Address.fromString(s));
    const CC = compiled.contracts['Coin.sol'], RC = compiled.contracts['Registry.sol'];
    const I = { coin: new Interface(CC.Coin.abi), vault: new Interface(CC.FounderVault.abi), reg: new Interface(RC.Registry.abi), sys: new Interface(RC.PracticeSystem.abi) };
    const addr = (n) => '0x' + n.toString(16).padStart(40, '0');
    const [DEP, F, PL, D, OP, CU, CH, CH2, X, IS, RP] = [0xd0, 0xf1, 0xf2, 0xf3, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7].map(addr);
    const E = 10n ** 18n, DAY = 86400n, t0 = 1800000000n;
    const zero = A(addr(0));
    const blk = (ts) => ({ header: { number: 1n, coinbase: zero, timestamp: ts, difficulty: 0n, prevRandao: new Uint8Array(32), gasLimit: 30000000n, baseFeePerGas: 0n, excessBlobGas: 0n, cliqueSigner: () => zero, getBlobGasPrice: () => 1n } });
    const reason = (bytes) => { try { if (bytes.length < 68) return util.bytesToHex(bytes); const len = Number(BigInt(util.bytesToHex(bytes.slice(36, 68)))); return new TextDecoder().decode(bytes.slice(68, 68 + len)); } catch (e) { return 'undecoded'; } };
    const raw = async (from, to, data, ts) => { const res = await evm.runCall({ caller: A(from), to, gasLimit: 9000000n, data: util.hexToBytes(data), block: blk(ts) }); const err = res.execResult.exceptionError; return { ok: !err, created: res.createdAddress, ret: util.bytesToHex(res.execResult.returnValue), why: err ? reason(res.execResult.returnValue) : '' }; };
    const note = (name, pass, got) => steps.push({ name, pass: Boolean(pass), got: String(got) });
    const deploy = async (iface, code, args, ts) => raw(DEP, undefined, '0x' + code + iface.encodeDeploy(args).slice(2), ts);
    const send = (from, c, fn, args, ts) => raw(from, c.at, c.i.encodeFunctionData(fn, args), ts);
    const read = async (c, fn, args, ts) => { const r = await raw(X, c.at, c.i.encodeFunctionData(fn, args || []), ts || t0); const v = c.i.decodeFunctionResult(fn, r.ret); return v.length === 1 ? v[0] : v; };
    const refused = (r, why) => !r.ok && r.why === why;

    let d = await deploy(I.reg, RC.Registry.evm.bytecode.object, [PL, [F]], t0);
    note('registry deploys', d.ok, d.ok ? 'deployed' : d.why);
    const reg = { at: d.created, i: I.reg, hex: d.created.toString() };
    d = await deploy(I.coin, CC.Coin.evm.bytecode.object, [reg.hex, F, PL, D], t0);
    note('coin deploys with the registry as its usage counter', d.ok, d.ok ? 'deployed' : d.why);
    const coin = { at: d.created, i: I.coin, hex: d.created.toString() };
    const bal = (who, ts) => read(coin, 'balanceOf', [who], ts);
    const vaultHex = await read(coin, 'founderVault');
    const vault = { at: A(vaultHex), i: I.vault };
    note('the founder vault reads its usage count from the registry', String(await read(vault, 'usage')).toLowerCase() === reg.hex.toLowerCase(), await read(vault, 'usage'));

    let r = await send(X, reg, 'bind', [coin.hex], t0);
    note('a stranger cannot name the coin', refused(r, 'deployer only'), r.why);
    r = await send(DEP, reg, 'bind', [coin.hex], t0);
    note('the deployer names the coin', r.ok, r.why || 'ok');
    r = await send(DEP, reg, 'bind', [X], t0);
    note('the coin cannot be named twice', refused(r, 'already bound'), r.why);

    const MAX = 2n ** 256n - 1n;
    for (const who of [OP, CU, CH, CH2, X, IS, RP]) { await send(D, coin, 'transfer', [who, 100000n * E], t0); await send(who, coin, 'approve', [reg.hex, MAX], t0); }
    await send(F, coin, 'approve', [reg.hex, MAX], t0);
    const mk = async (value, ts) => { const s = await raw(DEP, undefined, '0x' + RC.PracticeSystem.evm.bytecode.object, ts); const sys = { at: s.created, i: I.sys, hex: s.created.toString() }; await send(DEP, sys, 'set', [value], ts); return sys; };
    const poolStart = await bal(PL);

    // ---- checkers ----
    r = await send(CH, reg, 'registerChecker', [9999n * E], t0);
    note('a stake under 10,000 coins is refused', refused(r, 'stake too low'), r.why);
    r = await send(CH, reg, 'registerChecker', [10000n * E], t0);
    note('a checker registers with 10,000 coins', r.ok && (await bal(reg.hex)) === 10000n * E, await bal(reg.hex));
    await send(CH2, reg, 'registerChecker', [10000n * E], t0);

    // ---- claim 1: true finding, failed challenge ----
    const s1 = await mk(true, t0);
    r = await send(OP, reg, 'postClaim', [CU, s1.hex, 'Work order 1 is finished', 19n * E], t0);
    note('a fee under 20 coins is refused', refused(r, 'fee too low'), r.why);
    r = await send(OP, reg, 'postClaim', [CH2, s1.hex, 'Work order 1 is finished', 20n * E], t0);
    note('a claim is posted and its fee is in escrow', r.ok && (await read(reg, 'feesInEscrow')) === 20n * E, await read(reg, 'feesInEscrow'));
    r = await send(CH2, reg, 'attest', [1, true, 'read by the customer'], t0 + DAY);
    note('a party to the claim cannot check it', refused(r, 'party to the claim'), r.why);
    r = await send(X, reg, 'attest', [1, true, 'read by a stranger'], t0 + DAY);
    note('an account with no stake cannot check', refused(r, 'stake too low'), r.why);
    r = await send(OP, reg, 'withdraw', [1], t0 + 29n * DAY);
    note('a claim cannot be withdrawn before 30 days', refused(r, 'waiting period running'), r.why);
    r = await send(CH, reg, 'attest', [1, true, ''], t0 + DAY);
    note('a finding needs evidence', refused(r, 'evidence required'), r.why);
    r = await send(CH, reg, 'attest', [1, true, 'system read: done'], t0 + DAY);
    note('a checker records a finding', r.ok, r.why || 'ok');
    r = await send(CH, reg, 'unstake', [], t0 + DAY);
    note('a checker with unfinished checks cannot unstake', refused(r, 'unfinished checks'), r.why);
    r = await send(X, reg, 'finalize', [1], t0 + 7n * DAY);
    note('a check cannot close inside the 7-day window', refused(r, 'window open'), r.why);
    r = await send(CH, reg, 'challenge', [1], t0 + 2n * DAY);
    note('a checker cannot challenge its own finding', refused(r, 'own finding'), r.why);
    let b0 = await bal(CH), x0 = await bal(X);
    r = await send(X, reg, 'challenge', [1], t0 + 2n * DAY);
    note('a failed challenge pays the 100-coin bond to the checker', r.ok && (await bal(CH)) === b0 + 100n * E && (await bal(X)) === x0 - 100n * E, (await bal(CH)) - b0);
    b0 = await bal(CH);
    r = await send(X, reg, 'finalize', [1], t0 + 8n * DAY);
    note('closing pays the checker 16 coins and the pool 4', r.ok && (await bal(CH)) === b0 + 16n * E && (await bal(PL)) === poolStart + 4n * E, (await bal(CH)) - b0);
    note('one independent check is counted', (await read(reg, 'independentChecks')) === 1n, await read(reg, 'independentChecks'));
    r = await send(X, reg, 'challenge', [1], t0 + 8n * DAY);
    note('a closed check cannot be challenged', refused(r, 'not attested'), r.why);

    // ---- claim 2: false finding overturned ----
    const s2 = await mk(false, t0);
    await send(OP, reg, 'postClaim', [CU, s2.hex, 'Work order 2 is finished', 20n * E], t0 + 10n * DAY);
    await send(CH, reg, 'attest', [2, true, 'system read: done'], t0 + 10n * DAY);
    x0 = await bal(X); let p0 = await bal(PL);
    r = await send(X, reg, 'challenge', [2], t0 + 11n * DAY);
    note('a false finding costs the checker half its stake', r.ok && (await read(reg, 'stakeOf', [CH])) === 5000n * E, await read(reg, 'stakeOf', [CH]));
    note('the challenger receives its bond back and 2,500 coins; the pool receives 2,500', (await bal(X)) === x0 + 2500n * E && (await bal(PL)) === p0 + 2500n * E, (await bal(X)) - x0);
    r = await send(RP, reg, 'challenge', [2], t0 + 12n * DAY);
    note('an overturned finding cannot be challenged again', refused(r, 'already overturned'), r.why);
    x0 = await bal(X);
    r = await send(X, reg, 'finalize', [2], t0 + 17n * DAY);
    note('the fee on an overturned finding pays the challenger', r.ok && (await bal(X)) === x0 + 16n * E, (await bal(X)) - x0);
    note('an overturned finding adds no independent check', (await read(reg, 'independentChecks')) === 1n, await read(reg, 'independentChecks'));
    await send(OP, reg, 'postClaim', [CU, s1.hex, 'Work order 3 is finished', 20n * E], t0 + 18n * DAY);
    r = await send(CH, reg, 'attest', [3, true, 'system read: done'], t0 + 18n * DAY);
    note('a checker under 10,000 coins of stake cannot check', refused(r, 'stake too low'), r.why);
    r = await send(CH, reg, 'addStake', [5000n * E], t0 + 18n * DAY);
    note('a checker restores its stake', r.ok && (await read(reg, 'stakeOf', [CH])) === 10000n * E, await read(reg, 'stakeOf', [CH]));

    // ---- claim 3: true on the day of the finding, changed afterward ----
    const s3 = await mk(true, t0);
    await send(OP, reg, 'postClaim', [CU, s3.hex, 'Work order 4 is finished', 20n * E], t0 + 20n * DAY);
    await send(CH2, reg, 'attest', [4, true, 'system read: done'], t0 + 20n * DAY);
    await send(DEP, s3, 'set', [false], t0 + 21n * DAY);
    r = await send(X, reg, 'challenge', [4], t0 + 22n * DAY);
    note('a finding true on its day stands after the system changes', r.ok && (await read(reg, 'stakeOf', [CH2])) === 10000n * E, await read(reg, 'stakeOf', [CH2]));

    // ---- claim 5: a system that refuses to answer ----
    const silent = await raw(DEP, undefined, '0x' + RC.PracticeSilentSystem.evm.bytecode.object, t0);
    await send(OP, reg, 'postClaim', [CU, silent.created.toString(), 'Work order 5 is finished', 20n * E], t0 + 20n * DAY);
    await send(CH2, reg, 'attest', [5, true, 'system read: done'], t0 + 20n * DAY);
    r = await send(X, reg, 'challenge', [5], t0 + 21n * DAY);
    note('a system that refuses to answer reads false', r.ok && (await read(reg, 'stakeOf', [CH2])) === 5000n * E, await read(reg, 'stakeOf', [CH2]));
    await send(CH2, reg, 'addStake', [5000n * E], t0 + 21n * DAY);
    r = await send(RP, reg, 'challenge', [4], t0 + 27n * DAY);
    note('a finding cannot be challenged after 7 days', refused(r, 'window closed'), r.why);
    await send(X, reg, 'finalize', [4], t0 + 28n * DAY);
    await send(X, reg, 'finalize', [5], t0 + 28n * DAY);

    // ---- claim 3 again: never checked, withdrawn ----
    r = await send(X, reg, 'withdraw', [3], t0 + 60n * DAY);
    note('only the poster can withdraw a claim', refused(r, 'poster only'), r.why);
    b0 = await bal(OP);
    r = await send(OP, reg, 'withdraw', [3], t0 + 60n * DAY);
    note('an unchecked claim returns its fee after 30 days', r.ok && (await bal(OP)) === b0 + 20n * E, (await bal(OP)) - b0);

    // ---- claim by the founder: counted as not independent ----
    await send(D, coin, 'transfer', [F, 1000n * E], t0);
    await send(F, reg, 'postClaim', [CU, s1.hex, 'Founder work order', 20n * E], t0 + 60n * DAY);
    await send(CH2, reg, 'attest', [6, true, 'system read: done'], t0 + 60n * DAY);
    let n0 = await read(reg, 'independentChecks');
    await send(X, reg, 'finalize', [6], t0 + 67n * DAY);
    note('a check on a founder-linked claim adds no independent check', (await read(reg, 'independentChecks')) === n0, await read(reg, 'independentChecks'));

    // ---- sworn statements ----
    const T = t0 + 100n * DAY;
    const q1 = await mk(true, T);
    r = await send(IS, reg, 'postStatement', [q1.hex, 'Coin ABC', 'No account can freeze a balance', 9999n * E, 20n * E, 90n * DAY], T);
    note('a statement bond under 10,000 coins is refused', refused(r, 'bond too low'), r.why);
    r = await send(IS, reg, 'postStatement', [q1.hex, 'Coin ABC', 'No account can freeze a balance', 10000n * E, 20n * E, 29n * DAY], T);
    note('a term under 30 days is refused', refused(r, 'term out of range'), r.why);
    r = await send(IS, reg, 'postStatement', [q1.hex, 'Coin ABC', 'No account can freeze a balance', 10000n * E, 20n * E, 366n * DAY], T);
    note('a term over 365 days is refused', refused(r, 'term out of range'), r.why);
    r = await send(IS, reg, 'postStatement', [q1.hex, 'Coin ABC', 'No account can freeze a balance', 10000n * E, 20n * E, 90n * DAY], T);
    note('a sworn statement is posted and its bond is in escrow', r.ok && (await read(reg, 'bondsInEscrow')) === 10000n * E, await read(reg, 'bondsInEscrow'));
    await send(CH2, reg, 'attest', [7, true, 'code read: no freeze function'], T);
    r = await send(RP, reg, 'reportBreach', [7], T + DAY);
    note('a statement cannot be reported before it is in force', refused(r, 'not in force'), r.why);
    r = await send(X, reg, 'finalize', [7], T + 7n * DAY);
    note('a statement that reads true goes in force', r.ok && Number((await read(reg, 'recordOf', [7])).state) === 5, (await read(reg, 'recordOf', [7])).state);
    b0 = await bal(IS); let rp0 = await bal(RP);
    r = await send(RP, reg, 'reportBreach', [7], T + 20n * DAY);
    note('a report on a statement that still reads true pays 100 coins to the issuer', r.ok && (await bal(IS)) === b0 + 100n * E && (await bal(RP)) === rp0 - 100n * E, (await bal(IS)) - b0);
    r = await send(X, reg, 'closeStatement', [7], T + 20n * DAY);
    note('a statement cannot be closed during its term', refused(r, 'term running'), r.why);
    await send(DEP, q1, 'set', [false], T + 30n * DAY);
    rp0 = await bal(RP); p0 = await bal(PL);
    r = await send(RP, reg, 'reportBreach', [7], T + 31n * DAY);
    note('a broken statement forfeits its bond: 2,000 coins to the reporter, 8,000 to the pool', r.ok && (await bal(RP)) === rp0 + 2000n * E && (await bal(PL)) === p0 + 8000n * E, (await bal(RP)) - rp0);
    r = await send(RP, reg, 'reportBreach', [7], T + 32n * DAY);
    note('a broken statement cannot be reported again', refused(r, 'not in force'), r.why);

    const q2 = await mk(true, T);
    await send(IS, reg, 'postStatement', [q2.hex, 'Coin ABC', 'Supply is fixed', 10000n * E, 20n * E, 30n * DAY], T);
    await send(CH2, reg, 'attest', [8, true, 'code read: no mint function'], T);
    await send(X, reg, 'finalize', [8], T + 7n * DAY);
    r = await send(RP, reg, 'reportBreach', [8], T + 38n * DAY);
    note('a statement cannot be reported after its term', refused(r, 'term ended'), r.why);
    b0 = await bal(IS);
    r = await send(X, reg, 'closeStatement', [8], T + 38n * DAY);
    note('a statement that stood through its term returns its bond', r.ok && (await bal(IS)) === b0 + 10000n * E, (await bal(IS)) - b0);

    const q3 = await mk(false, T);
    await send(IS, reg, 'postStatement', [q3.hex, 'Coin ABC', 'The owner key is destroyed', 10000n * E, 20n * E, 30n * DAY], T);
    await send(CH2, reg, 'attest', [9, false, 'code read: owner key present'], T);
    b0 = await bal(IS);
    r = await send(X, reg, 'finalize', [9], T + 7n * DAY);
    note('a statement that reads false is refused and its bond returns', r.ok && (await bal(IS)) === b0 + 10000n * E && Number((await read(reg, 'recordOf', [9])).state) === 6, (await bal(IS)) - b0);

    // ---- closing checks ----
    b0 = await bal(CH2);
    r = await send(CH2, reg, 'unstake', [], T + 40n * DAY);
    note('a checker with no unfinished checks takes its stake back', r.ok && (await bal(CH2)) === b0 + 10000n * E, (await bal(CH2)) - b0);
    const held = await bal(reg.hex), owed = (await read(reg, 'totalStaked')) + (await read(reg, 'feesInEscrow')) + (await read(reg, 'bondsInEscrow'));
    note('the registry balance equals stakes plus fees plus bonds', held === owed, held + ' / ' + owed);
    note('the pool only gained', (await bal(PL)) > poolStart, (await bal(PL)) - poolStart);
    const names = I.reg.fragments.filter(f => f.type === 'function').map(f => f.name);
    note('no function creates, destroys, freezes, pauses or replaces', !names.some(k => /mint|burn|pause|freeze|owner|upgrade|destroy/i.test(k)), names.join(' '));
    out.chain = { passed: steps.filter(s => s.pass).length, total: steps.length, steps };
  } catch (e) { out.chain = { error: String(e && e.stack || e).slice(0, 500), steps }; }
}
JSON.stringify(out)
