// Practice-chain script for the coin and its founder vault. First run: November 12, 2026.
// Runs in a browser page. It compiles contracts/Coin.sol with the current Solidity compiler,
// starts a practice chain inside the page, and runs the checks below.
// No wallet, no network, no money. Before running, set window.__sworn.coin to the text of
// contracts/Coin.sol; the SHA-256 of the file that was run is in results/chain.json.
const src = window.__sworn.coin;
const out = {};
let compiled = null;
try {
  const list = await fetch('https://binaries.soliditylang.org/bin/list.json').then(r => r.json());
  out.compiler = list.latestRelease;
  const file = list.releases[list.latestRelease];
  const input = { language: 'Solidity', sources: { 'Coin.sol': { content: src } }, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] } } } };
  const workerCode = `importScripts('https://binaries.soliditylang.org/bin/${file}'); onmessage = function (e) { try { var compile = Module.cwrap('solidity_compile', 'string', ['string', 'number', 'number']); postMessage({ ok: true, out: compile(e.data, 0, 0) }); } catch (err) { postMessage({ ok: false, err: String(err) }); } };`;
  const worker = new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' })));
  const result = await new Promise((resolve) => { worker.onmessage = (e) => resolve(e.data); worker.onerror = (e) => resolve({ ok: false, err: 'worker: ' + (e.message || 'error') }); worker.postMessage(JSON.stringify(input)); setTimeout(() => resolve({ ok: false, err: 'timeout after 100s' }), 100000); });
  worker.terminate();
  if (!result.ok) { out.compileError = result.err; } else {
    compiled = JSON.parse(result.out);
    out.messages = (compiled.errors || []).map(e => e.severity + ': ' + String(e.formattedMessage || e.message).slice(0, 200));
    out.contracts = Object.fromEntries(Object.entries((compiled.contracts || {})['Coin.sol'] || {}).map(([n, c]) => [n, c.evm.bytecode.object.length / 2]));
  }
} catch (e) { out.compileError = String(e); }
if (compiled && compiled.contracts && compiled.contracts['Coin.sol']) {
  const steps = [];
  try {
    const evmMod = await import('https://esm.sh/@ethereumjs/evm');
    const util = await import('https://esm.sh/@ethereumjs/util');
    const evm = evmMod.createEVM ? await evmMod.createEVM() : await evmMod.EVM.create();
    const A = (s) => (util.createAddressFromString ? util.createAddressFromString(s) : util.Address.fromString(s));
    const C = compiled.contracts['Coin.sol'];
    const addr = (n) => '0x' + n.toString(16).padStart(40, '0');
    const F = addr(0xf1), PL = addr(0xf2), D = addr(0xf3), DEP = addr(0xd0), X = addr(0xe9);
    const w = (v) => BigInt(v).toString(16).padStart(64, '0');
    const t0 = 1800000000n, DAY = 86400n;
    const zero = A(addr(0));
    const blk = (ts) => ({ header: { number: 1n, coinbase: zero, timestamp: ts, difficulty: 0n, prevRandao: new Uint8Array(32), gasLimit: 30000000n, baseFeePerGas: 0n, excessBlobGas: 0n, cliqueSigner: () => zero, getBlobGasPrice: () => 1n } });
    const reason = (bytes) => { try { if (bytes.length < 68) return util.bytesToHex(bytes); const len = Number(BigInt(util.bytesToHex(bytes.slice(36, 68)))); return new TextDecoder().decode(bytes.slice(68, 68 + len)); } catch (e) { return 'undecoded'; } };
    const run = async (from, to, data, ts) => { const res = await evm.runCall({ caller: A(from), to, gasLimit: 9000000n, data: util.hexToBytes('0x' + data), block: blk(ts) }); const err = res.execResult.exceptionError; return { ok: !err, created: res.createdAddress, ret: util.bytesToHex(res.execResult.returnValue), why: err ? reason(res.execResult.returnValue) : '' }; };
    const note = (name, pass, got) => steps.push({ name, pass, got: String(got) });
    const u = await run(DEP, undefined, C.PracticeUsage.evm.bytecode.object, t0);
    note('usage counter deploys', u.ok, u.ok ? 'deployed' : u.why);
    const usageHex = u.created.toString();
    const c = await run(DEP, undefined, C.Coin.evm.bytecode.object + w(usageHex) + w(F) + w(PL) + w(D), t0);
    note('coin deploys and creates its founder vault', c.ok, c.ok ? 'deployed' : c.why);
    const coin = c.created, ci = C.Coin.evm.methodIdentifiers, vi = C.FounderVault.evm.methodIdentifiers, ui = C.PracticeUsage.evm.methodIdentifiers;
    const view = async (to, id, args, ts) => BigInt((await run(X, to, id + (args || ''), ts || t0)).ret);
    note('total supply is 1 billion coins', (await view(coin, ci['totalSupply()'])) === 10n ** 27n, await view(coin, ci['totalSupply()']));
    const vaultHex = '0x' + (await run(X, coin, ci['founderVault()'], t0)).ret.slice(-40);
    const vault = A(vaultHex);
    const bal = (who, ts) => view(coin, ci['balanceOf(address)'], w(who), ts);
    note('founder vault starts with 10%', (await bal(vaultHex)) === 10n ** 26n, await bal(vaultHex));
    note('community pool starts with 40%', (await bal(PL)) === 4n * 10n ** 26n, await bal(PL));
    note('distribution starts with 50%', (await bal(D)) === 5n * 10n ** 26n, await bal(D));
    const T1 = t0 + 13n * 30n * DAY;
    let r = await run(F, vault, vi['giveNotice(uint256)'] + w(1), t0 + 389n * DAY);
    note('notice refused during the lock', !r.ok && r.why === 'date not reached', r.why);
    r = await run(F, vault, vi['giveNotice(uint256)'] + w(1), T1);
    note('notice refused without the usage milestone', !r.ok && r.why === 'usage milestone not met', r.why);
    r = await run(X, A(usageHex), ui['record(uint256)'] + w(500), T1);
    note('500 checks recorded', r.ok, r.why || 'ok');
    r = await run(X, vault, vi['giveNotice(uint256)'] + w(1), T1);
    note('notice refused from a stranger', !r.ok && r.why === 'founder only', r.why);
    r = await run(F, vault, vi['giveNotice(uint256)'] + w(1), T1);
    note('founder gives notice once date and milestone are met', r.ok, r.why || 'ok');
    r = await run(X, vault, vi['release(uint256)'] + w(1), T1 + 29n * DAY);
    note('release refused before 30 days of notice', !r.ok && r.why === 'notice period running', r.why);
    r = await run(X, vault, vi['release(uint256)'] + w(1), T1 + 30n * DAY);
    note('slice 1 released after the notice', r.ok, r.why || 'ok');
    const slice = 10n ** 26n / 36n;
    note('founder received exactly one slice', (await bal(F)) === slice, await bal(F));
    note('vault balance fell by one slice', (await bal(vaultHex)) === 10n ** 26n - slice, await bal(vaultHex));
    r = await run(X, vault, vi['release(uint256)'] + w(1), T1 + 31n * DAY);
    note('slice 1 cannot be released twice', !r.ok && r.why === 'no notice for this slice', r.why);
    r = await run(F, vault, vi['giveNotice(uint256)'] + w(3), T1 + 400n * DAY);
    note('slices cannot be skipped', !r.ok && r.why === 'wrong slice', r.why);
    r = await run(F, coin, ci['transfer(address,uint256)'] + w(X) + w(slice + 1n), T1 + 31n * DAY);
    note('an account cannot spend more than it has', !r.ok && r.why === 'balance too low', r.why);
    r = await run(F, coin, ci['transfer(address,uint256)'] + w(X) + w(1000n), T1 + 31n * DAY);
    note('a transfer moves coins', r.ok && (await bal(X)) === 1000n, await bal(X));
    // ---- owner veto ----
    const V1 = addr(0xe1), V2 = addr(0xe2), E18 = 10n ** 18n, T2 = t0 + 430n * DAY, MAXU = 2n ** 256n - 1n;
    await run(D, coin, ci['transfer(address,uint256)'] + w(V1) + w(700n * E18), T2);
    await run(D, coin, ci['transfer(address,uint256)'] + w(V2) + w(300n * E18), T2);
    for (const v of [V1, V2, F]) await run(v, coin, ci['approve(address,uint256)'] + w(vaultHex) + w(MAXU), T2);
    await run(X, A(usageHex), ui['record(uint256)'] + w(500), T2);
    r = await run(V1, vault, vi['lockVeto(uint256)'] + w(E18), T2);
    note('coins cannot be locked with no notice open', !r.ok && r.why === 'no notice open', r.why);
    r = await run(F, vault, vi['giveNotice(uint256)'] + w(2), T2);
    note('founder gives notice for slice 2', r.ok, r.why || 'ok');
    note('coins that can vote exclude the founder, the vault, the pool and the distribution account', (await view(vault, vi['votingSupply()'], '', T2)) === 1000n * E18 + 1000n, await view(vault, vi['votingSupply()'], '', T2));
    r = await run(F, vault, vi['lockVeto(uint256)'] + w(E18), T2 + DAY);
    note('the founder has no vote on its own release', !r.ok && r.why === 'no vote', r.why);
    r = await run(V2, vault, vi['lockVeto(uint256)'] + w(100n * E18), T2 + DAY);
    note('an owner locks coins against the release', r.ok && (await view(vault, vi['vetoWeight()'], '', T2 + DAY)) === 100n * E18 && (await view(vault, vi['noticeSlice()'], '', T2 + DAY)) === 2n, await view(vault, vi['vetoWeight()'], '', T2 + DAY));
    r = await run(V2, vault, vi['unlock(uint256)'] + w(2), T2 + 2n * DAY);
    note('locked coins stay locked while the notice runs', !r.ok && r.why === 'notice period running', r.why);
    r = await run(V1, vault, vi['lockVeto(uint256)'] + w(101n * E18), T2 + 2n * DAY);
    note('locked coins reaching 20% block the release', r.ok && (await view(vault, vi['noticeSlice()'], '', T2 + 2n * DAY)) === 0n, await view(vault, vi['noticeSlice()'], '', T2 + 2n * DAY));
    r = await run(X, vault, vi['release(uint256)'] + w(2), T2 + 30n * DAY);
    note('a vetoed slice is not paid', !r.ok && r.why === 'no notice for this slice', r.why);
    r = await run(V2, vault, vi['unlock(uint256)'] + w(2), T2 + 2n * DAY);
    note('locked coins return after the veto', r.ok && (await bal(V2, T2 + 2n * DAY)) === 300n * E18, await bal(V2, T2 + 2n * DAY));
    r = await run(V2, vault, vi['unlock(uint256)'] + w(2), T2 + 3n * DAY);
    note('locked coins return once only', !r.ok && r.why === 'nothing locked', r.why);
    r = await run(F, vault, vi['giveNotice(uint256)'] + w(2), T2 + 31n * DAY);
    note('the founder can give notice again after a veto', r.ok, r.why || 'ok');
    r = await run(V2, vault, vi['lockVeto(uint256)'] + w(150n * E18), T2 + 32n * DAY);
    note('locked coins under 20% leave the notice standing', r.ok && (await view(vault, vi['noticeSlice()'], '', T2 + 32n * DAY)) === 2n, await view(vault, vi['noticeSlice()'], '', T2 + 32n * DAY));
    r = await run(V2, vault, vi['lockVeto(uint256)'] + w(100n * E18), T2 + 61n * DAY);
    note('coins cannot be locked after the 30 days', !r.ok && r.why === 'no notice open', r.why);
    const fBefore = await bal(F, T2 + 61n * DAY);
    r = await run(X, vault, vi['release(uint256)'] + w(2), T2 + 61n * DAY);
    note('slice 2 is paid after a notice with no veto', r.ok && (await bal(F, T2 + 61n * DAY)) === fBefore + slice, (await bal(F, T2 + 61n * DAY)) - fBefore);
    await run(V1, vault, vi['unlock(uint256)'] + w(2), T2 + 62n * DAY);
    await run(V2, vault, vi['unlock(uint256)'] + w(3), T2 + 62n * DAY);
    note('every locked coin is returned and the vault is short exactly two slices', (await bal(vaultHex, T2 + 62n * DAY)) === 10n ** 26n - 2n * slice && (await bal(V1, T2 + 62n * DAY)) === 700n * E18 && (await bal(V2, T2 + 62n * DAY)) === 300n * E18, await bal(vaultHex, T2 + 62n * DAY));
    note('no function creates, destroys, freezes or replaces', !Object.keys(ci).some(k => /mint|burn|pause|freeze|owner|upgrade/i.test(k)), Object.keys(ci).join(' '));
    const text = (hex) => { const h = hex.replace(/^0x/, ''); const len = Number(BigInt('0x' + h.slice(64, 128))); return new TextDecoder().decode(util.hexToBytes('0x' + h.slice(128, 128 + len * 2))); };
    const coinName = text((await run(X, coin, ci['name()'], t0)).ret);
    note('the coin is named Sworn', coinName === 'Sworn', coinName);
    const coinTicker = text((await run(X, coin, ci['symbol()'], t0)).ret);
    note('the ticker is SWORN', coinTicker === 'SWORN', coinTicker);
    out.chain = { passed: steps.filter(s => s.pass).length, total: steps.length, steps };
  } catch (e) { out.chain = { error: String(e).slice(0, 300), steps }; }
}
JSON.stringify(out)
