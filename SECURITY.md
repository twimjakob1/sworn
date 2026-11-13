# Reporting a Fault

No one outside the project has reviewed this code yet. Reports are wanted.

## What to Look For

- A way to create, freeze, take or destroy coins.
- A way to release founder coins early, skip a notice or defeat the owner veto.
- A way for a checker, a challenger, a reporter or an issuer to gain coins by lying or by cooperating with another account.
- A way to lock a bond, a stake or a fee in the registry for good.
- A rule in `docs/RULES.md` that the code fails to enforce.
- A test that passes when the rule it names is broken.

## How to Report

Write to hello@sworncoin.com with:

1. The file and the function.
2. The steps that show the fault, or a failing test.
3. What an attacker gains.

A fault in the rules themselves counts as much as a fault in the code.

## What Happens Next

Each confirmed fault is entered in the ledger as a failed check, with the repair entered after it. The reporter is named in that entry unless the reporter asks otherwise.

Sworn is in testing and the coin has no value. The project pays no reward for reports, in coins or in money.
