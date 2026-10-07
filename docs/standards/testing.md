# Testing

- **TEST-1 — The domain package is tested hardest.** Unit tests from fixtures plus property-based tests
  for invariants ("everyone completes their plan → every balance changes by zero", "never assigned
  while unavailable", "same inputs, same plan") ([ADR-0008](../adr/0008-tech-stack.md) §3).
- **TEST-2 — Tests are deterministic.** The clock, random seeds and IDs are injected; no test depends
  on the current date, the time zone of the machine or test order. Time-based rules are tested across
  daylight-saving changes and midnight.
- **TEST-3 — Components are found by role and accessible name**
  (`getByRole('button', { name: … })`), never by class, test ID or text alone.
- **TEST-4 — Every use case has authorisation tests**: a member of another household gets nothing, and
  each role gets exactly what the permission matrix allows; every route has a test that it passes the
  guard and maps results correctly ([ADR-0017](../adr/0017-security-baseline.md) §10,
  [ADR-0023](../adr/0023-application-layer.md)).
- **TEST-11 — Use cases are tested directly**, against a real test database with fake ports, without
  HTTP or a browser.
- **TEST-5 — Every user flow has an end-to-end test** with axe checks, at phone and desktop size, in
  light and dark ([ADR-0011](../adr/0011-accessibility-and-responsive-baseline.md) §8). Every variant of
  an experiment gets the same.
- **TEST-6 — A bug fix starts with a failing test** that reproduces it.
- **TEST-7 — Never skip, disable or weaken a test to get green.** A flaky test is a bug to fix, not to
  retry.
- **TEST-8 — Test data is invented.** No real names, e-mail addresses or household data, in tests,
  fixtures, seeds or screenshots ([SEC-1](security-privacy.md)).
- **TEST-9 — Tests run against flag defaults** and set other values explicitly; they never talk to
  Flipt ([ADR-0015](../adr/0015-feature-flags-and-experiments.md) §10).
- **TEST-10 — Concurrency paths are tested** with two browser contexts: conflicting edits and double
  completions ([ADR-0019](../adr/0019-live-updates-and-concurrent-edits.md)).
