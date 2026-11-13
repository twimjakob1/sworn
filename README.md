# Sworn

Sworn is a coin for proving that a claim is true. Someone posts a claim and locks coins behind it. An independent checker reads the system the claim is about and records what it shows. Anyone can challenge that finding for 7 days.

The first claims Sworn checks are promises that the issuers of other coins make about their own coins, for example that the supply is fixed. The issuer loses the bond if the statement turns false during its term.

- Site: https://sworncoin.com
- Rules in plain English: [docs/RULES.md](docs/RULES.md)
- How to check the work yourself: [docs/CHECK-IT-YOURSELF.md](docs/CHECK-IT-YOURSELF.md)
- How to report a fault: [SECURITY.md](SECURITY.md)

**Standing.** Sworn is in testing. The rules run in a tested model and as blockchain code on a practice chain. The coin trades nowhere. Any coin offered for sale under the Sworn name today is a counterfeit, and the project sells no coins.

## What Is Here

| Folder | Contents |
| --- | --- |
| `contracts/` | The blockchain code. `Coin.sol` is the coin and the founder vault. `Registry.sol` is the checker registry and sworn statements. |
| `model/` | The working model the rules were first written in: the coin, the founder vault, the registry and the ledger. `params.js` states every number in the rules. |
| `test/` | The automated tests of the model. |
| `tools/` | The runs that break each rule on purpose, two runs that attack the rules with cooperating accounts, the practice-chain scripts, and the ledger check. |
| `results/` | The output of the most recent runs. |
| `data/receipts.json` | The ledger: every statement the project has made about Sworn, the check that was run and what it showed. Failed checks stay in it. |

## Run the Checks

Node 22 or later. Nothing to install.

```
npm test          # the tests of the model
npm run verify    # breaks each rule in a copy of the model and confirms the tests fail
npm run ledger    # rebuilds the ledger and checks its chain of fingerprints
node tools/reward-farming.js   # three cooperating accounts try to profit from checks with no real work
node tools/checker-trap.js     # an issuer changes its system after a true finding and attacks the checker
```

The blockchain code runs in a browser page. `tools/practice-chain.browser.js` and `tools/practice-registry.browser.js` compile the two files with the current Solidity compiler, start a practice chain inside the page and run the checks. `tools/faults.browser.js` breaks each rule listed in `tools/chain-faults.json` and `tools/registry-faults.json` and confirms the checks fail.

## Results on File

| What was checked | Result |
| --- | --- |
| Tests of the model | 62 of 62 pass |
| Rules broken on purpose in the model | 42 of 42 caught |
| Coin and founder vault on a practice chain | 37 of 37 checks pass; 23 of 23 broken rules caught |
| Checker registry on a practice chain | 52 of 52 checks pass; 30 of 30 broken rules caught |
| Ledger | 32 entries, 7 of them failed checks, chain of fingerprints intact |

## What Has Not Been Done

- No one outside the project has reviewed this code.
- The code has not run on a public network.
- The registry will have no owner key, so a fault found after launch stays. Starting limits on bond size are unwritten.
- The rule for the free distribution is unwritten.
- A dispute is settled by reading the system again, so Sworn covers only systems anyone can read. Work inside a private system has no solution in this build.

## Who Builds It

Sworn is a registered name of VitalEdge, LLC, a Tennessee company. The founder is Jakob Taylor. The code and the record are written by an AI agent working for the founder. The agent receives no coins.

## Rights

© 2026 VitalEdge, LLC. This code is published so that anyone can read it, run it and test it. No license to reuse it has been granted yet. SWORN and the Sworn mark are trademarks of VitalEdge, LLC.
