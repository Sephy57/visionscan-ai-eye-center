# Test-runner compatibility record

The release lock remains on **Vitest 3.2.6**. A no-lockfile isolated
experiment with **Vitest 4.1.11** was performed in a temporary checkout and
was not copied into `package.json` or `package-lock.json`.

## Root cause

`tests/job-lease-recovery.test.ts` intentionally crosses a real process
boundary. It spawns the repository's `node_modules/vite-node/dist/cli.mjs`
entrypoint so the child can load the TypeScript queue modules, claim a job,
close its database, and exit with code 17. The Vitest 4 package no longer
ships the standalone `vite-node` package as a top-level dependency; its
package exposes the Vitest runner and Vite, but not that child entrypoint.
After the experiment's dependency tree was resolved, the spawned child could
not start and exited with code 1, before it reached the intentional
`process.exit(17)`. The failing assertion is therefore a test-runner
dependency/layout incompatibility, not a change in lease ownership,
recovery, cancellation, or late-worker fencing semantics.

During the later future-write FK hardening, the main Vitest 3 run briefly
reported the same observed child exit code (1). That was a separate fixture
failure: the child attempted to insert a job whose `study_id` did not yet
exist, and the new `MISSING_TYPED_REFERENCE` guard correctly rejected it.
Seeding that synthetic study in the child fixture restored the intentional
exit-17 crash phase; the focused Vitest 3 run then passed all 11/11 tests.
This distinction is why the FK test fixture was repaired rather than the
lease assertions or the future-write invariant being weakened.

The experiment also confirmed that the project invocation's
`--minWorkers` option is removed in Vitest 4. The compatible invocation is
`--pool=forks --maxWorkers=1`; removing the obsolete flag does not repair the
missing child runner. The earlier full isolated experiment completed the
ordinary suites but retained the process-boundary lease failure; TypeScript,
lint, and build were independently green.

## Decision

Vitest 4 is **not adopted**. No production dependency or runtime path uses
Vitest, and the observed incompatibility is development/test-only. Vitest
3.2.6 remains the release-tested runner, with the durable-worker process
boundary and its intentional non-zero child exit assertion unchanged. A
future upgrade must either provide an explicitly supported child TypeScript
runner (with its own compatibility and integrity review) or update the test
harness only after proving identical process-death/recovery semantics; it must
not weaken the recovery assertions merely to obtain a green test count.

The two moderate `npm audit` advisories associated with the Vitest development
toolchain remain disclosed and are not remediated with `npm audit fix --force`.
