# Check It Yourself

Everything the project says about Sworn can be rerun from this repository.

## 1. Run the Tests

```
npm test
```

62 tests of the coin, the founder vault, the checker registry, sworn statements and the ledger. Each test names the rule it checks.

## 2. Confirm the Tests Can Fail

A test that always passes proves nothing. This run breaks one rule at a time in a copy of the model and confirms that at least one test fails each time.

```
npm run verify
```

42 rules are broken. The run prints CAUGHT or MISSED for each.

## 3. Check the Ledger

```
npm run ledger
```

Each entry in `data/receipts.json` carries the fingerprint of the entry before it. The run rebuilds the chain and prints the last fingerprint. Change any earlier entry and every later fingerprint changes.

## 4. Attack the Rules

Two runs try to profit by cheating.

```
node tools/reward-farming.js
node tools/checker-trap.js
```

- In the first, three cooperating accounts post claims that are trivially true and check them for each other. Before the fee rule they took 1,000 coins from the community pool. Under the fee rule they end 400 coins poorer.
- In the second, an issuer changes its system after a true finding and has a second account challenge the honest checker. Before the repair the checker lost 500,000 coins. After it the checker loses nothing.

Both failures and both repairs are in the ledger.

## 5. Read the Blockchain Code

- `contracts/Coin.sol`: the coin has no function that creates, destroys, freezes or replaces coins after launch. The founder vault releases one slice at a time and enforces the 12-month lock, the usage milestone, the 30-day notice and the owner veto.
- `contracts/Registry.sol`: the registry takes fees, stakes and bonds from a wallet and pays them out under its rules. The account that deploys it names the coin once and has no other power.

## 6. Find a Fault

See [SECURITY.md](../SECURITY.md).
