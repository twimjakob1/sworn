// Broken-rule runner for the blockchain code. First run: November 13, 2026.
// Runs in a browser page after these are set on the page:
//   window.__sworn   { coin, reg }: the text of contracts/Coin.sol and contracts/Registry.sol
//   RUN              a practice-chain script (tools/practice-chain.browser.js or
//                    tools/practice-registry.browser.js) wrapped as a function
//   FILE             'coin' or 'reg': the file whose rules are broken
//   FAULTS           the array in tools/chain-faults.json or tools/registry-faults.json
// It first runs the checks against the files as written. It then breaks one rule at a time in
// a copy of the file, compiles the copy, and runs the same checks against it.
// A broken rule counts as caught when the copy compiles and at least one check fails.
// No wallet, no network, no money.
async function (RUN, FILE, FAULTS) {
  const original = window.__sworn[FILE];
  const baselineRanAt = new Date().toISOString();
  const baseline = JSON.parse(await RUN());
  const checks = ((baseline.chain && baseline.chain.steps) || []).length;
  const results = [];
  for (const f of FAULTS) {
    const n = original.split(f.find).length - 1;
    if (n !== 1) { results.push({ rule: f.rule, caught: false, note: 'The line to break was found ' + n + ' times; expected once' }); continue; }
    window.__sworn[FILE] = original.replace(f.find, () => f.replace);
    let r;
    try { r = JSON.parse(await RUN()); } catch (e) { r = { compileError: 'run failed: ' + String(e).slice(0, 200) }; }
    window.__sworn[FILE] = original;
    const steps = (r.chain && r.chain.steps) || [];
    const failing = steps.filter((s) => !s.pass).map((s) => s.name);
    const compiled = !r.compileError && !!r.contracts && Object.keys(r.contracts).length > 0 && !(r.messages || []).some((m) => /^error/i.test(m));
    results.push({ rule: f.rule, compiled, compileError: r.compileError || null, chainError: (r.chain && r.chain.error) || null, checksRun: steps.length, failingChecks: failing, caught: compiled && !(steps.length === checks && failing.length === 0) });
  }
  return JSON.stringify({ baseline, baselineRanAt, faultsRanAt: new Date().toISOString(), faultsInjected: results.length, faultsCaught: results.filter((r) => r.caught).length, results });
}
