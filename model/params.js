'use strict';
// Every number the rules depend on, in one place. Each is a proposal until launch.
module.exports = Object.freeze({
  SUPPLY: 1_000_000_000,            // fixed for good
  FOUNDER_SHARE: 100_000_000,       // 10%, locked in the founder vault
  COMMUNITY_POOL: 400_000_000,      // 40%, receives a share of every fee and every forfeiture
  FREE_DISTRIBUTION: 500_000_000,   // 50%, given to users at no charge

  DAYS_PER_MONTH: 30,
  LOCK_MONTHS: 12,                  // nothing leaves the founder vault before this
  RELEASE_SLICES: 36,               // then 36 equal monthly slices
  CHECKS_PER_SLICE: 500,            // slice n also needs 500 x n independent verified checks
  NOTICE_DAYS: 30,                  // public notice before each release
  VETO_PCT: 20,                     // share of non-founder coins that blocks a release

  MIN_CHECKER_STAKE: 10_000,        // coins a checker posts before verifying anything
  MIN_CLAIM_FEE: 20,                // coins the poster of a claim pays for its check, at the least
  FEE_POOL_PCT: 20,                 // share of each fee that goes to the community pool; the rest pays the checker
  OPEN_DAYS: 30,                    // days a claim waits for a checker before its poster may withdraw it
  CHALLENGE_DAYS: 7,                // window to dispute a checker's finding
  CHALLENGE_BOND: 100,              // coins a challenger posts; lost if the challenge fails
  SLASH_PCT: 50,                    // share of stake a checker loses for a false finding

  MIN_STATEMENT_BOND: 10_000,       // coins an issuer puts behind one sworn statement, at the least
  MIN_TERM_DAYS: 30,                // shortest term a sworn statement can cover
  MAX_TERM_DAYS: 365,               // longest term a sworn statement can cover
  REPORT_BOND: 100,                 // coins a reporter puts up; they go to the issuer if the statement still reads true
  REPORTER_PCT: 20,                 // share of a forfeited bond paid to the reporter; the rest goes to the community pool
});
