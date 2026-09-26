import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dbDelete, dbGet, dbPut } from "@/lib/storage/db";
import { makeJobProgress } from "@/lib/jobs/control";
import { claimJob, listClaimCandidates, type AnalysisJob } from "@/lib/jobs/queue";

const cleanup: string[] = [];
const studyCleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length) await dbDelete("jobs", cleanup.pop()!);
  while (studyCleanup.length) await dbDelete("studies", studyCleanup.pop()!);
});

const T0 = Date.UTC(2026, 0, 1);
const at = (minute: number) => new Date(T0 + minute * 60_000).toISOString();

function job(id: string, status: string, minute: number, extra: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    job_id: id,
    study_id: `study_${id}`,
    kind: "analysis",
    status: status as AnalysisJob["status"],
    state: status as AnalysisJob["status"],
    attempts: status === "queued" ? 0 : 1,
    retry_count: 0,
    version: 0,
    claim_version: 0,
    cancellation_requested: false,
    retry_policy_version: "lease-retry-v1",
    created_at: at(minute),
    progress: makeJobProgress({ stage: "queued", percent: 0, message: "fixture" }),
    ...extra,
  };
}

async function put(record: AnalysisJob): Promise<void> {
  await dbPut("studies", record.study_id, {
    study_id: record.study_id, created_at: record.created_at, modality: "unknown", eye: "unknown",
    source: "test", metadata: {}, files: [], status: "uploaded", original_sha256: "fixture",
  });
  studyCleanup.push(record.study_id);
  await dbPut("jobs", record.job_id, record);
  cleanup.push(record.job_id);
}

/** Candidates restricted to this file's fixtures (the test database is shared per run). */
async function mine(prefix: string, limit = 20, now: number = T0 + 10_000 * 60_000): Promise<string[]> {
  return (await listClaimCandidates(limit, now)).map((c) => c.job_id).filter((id) => id.startsWith(prefix));
}

describe("external worker claim candidates", () => {
  it("finds a new queued job behind more than 32 terminal jobs", async () => {
    // Regression: the worker used to read the 32 oldest jobs and filter them,
    // so any queue history longer than 32 terminal jobs starved new work.
    for (let i = 0; i < 40; i += 1) await put(job(`wccA_done_${String(i).padStart(2, "0")}`, ["completed", "failed", "cancelled"][i % 3], i));
    await put(job("wccA_new_queued", "queued", 50));
    expect(await mine("wccA_")).toEqual(["wccA_new_queued"]);
  });

  it("returns queued and retryable jobs oldest first, never running/stale/terminal ones", async () => {
    // Rows are inserted in creation order, as in production; the scan orders
    // by the row's insertion key, exactly like the paged job listing.
    await put(job("wccB_c_queued", "queued", 1));
    for (const [i, status] of ["running", "stale", "completed", "failed", "cancelled", "claimed", "error"].entries()) {
      await put(job(`wccB_x_${status}`, status, 1));
      if (i === 3) await put(job("wccB_b_retryable", "retryable", 2));
    }
    await put(job("wccB_a_queued", "queued", 3));
    expect(await mine("wccB_")).toEqual(["wccB_c_queued", "wccB_b_retryable", "wccB_a_queued"]);
  });

  it("treats a missing or unknown legacy status as queued, as normalizeJob does", async () => {
    const legacy = job("wccC_legacy", "queued", 0);
    delete (legacy as Partial<AnalysisJob>).status;
    await put(legacy);
    await put(job("wccC_weird", "LEGACY_PENDING", 1));
    expect(await mine("wccC_")).toEqual(["wccC_legacy", "wccC_weird"]);
  });

  it("uses the legacy state field when status is absent, so old finished rows cannot fill the limit", async () => {
    for (let i = 0; i < 10; i += 1) {
      const legacyDone = job(`wccG_legacy_done_${i}`, "completed", i);
      delete (legacyDone as Partial<AnalysisJob>).status;
      await put(legacyDone);
    }
    await put(job("wccG_new_queued", "queued", 20));
    // Max page: other test files may leave older queued rows in the shared run database.
    const ids = (await listClaimCandidates(100, T0 + 10_000 * 60_000)).map((c) => c.job_id);
    expect(ids.filter((id) => id.startsWith("wccG_legacy"))).toEqual([]);
    expect(ids).toContain("wccG_new_queued");
  });

  it("leaves out a retry that is not yet due so it cannot hold newer queued work", async () => {
    await put(job("wccD_retry_later", "retryable", 0, { retry_after_at: at(500) }));
    await put(job("wccD_queued", "queued", 5));
    expect(await mine("wccD_", 1, T0 + 100 * 60_000)).toEqual(["wccD_queued"]);
    // Once due, the older retry is first again.
    expect(await mine("wccD_", 20, T0 + 600 * 60_000)).toEqual(["wccD_retry_later", "wccD_queued"]);
  });

  it("returns no candidates for a large terminal history within the local runtime budget", async () => {
    for (let i = 0; i < 250; i += 1) await put(job(`wccE_done_${String(i).padStart(3, "0")}`, "completed", i));
    const started = performance.now();
    expect(await mine("wccE_")).toEqual([]);
    const second = await listClaimCandidates(8, T0);
    expect(second.every((c) => !c.job_id.startsWith("wccE_"))).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
  }, 120_000);

  it("lets exactly one of several concurrent claims win", async () => {
    await put(job("wccF_contended", "queued", 0, { created_at: new Date().toISOString() }));
    const results = await Promise.all(["w1", "w2", "w3", "w4"].map((worker) => claimJob("wccF_contended", worker)));
    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);
    const stored = await dbGet<AnalysisJob>("jobs", "wccF_contended");
    expect(stored?.status).toBe("running");
    expect(stored?.worker_id).toBe(winners[0]!.worker_id);
    // A claimed job is no longer a candidate.
    expect(await mine("wccF_", 20, Date.now())).toEqual([]);
  });

  it("serializes a claim race across separate SQLite worker processes", async () => {
    const id = `wccH_process_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await put(job(id, "queued", 0, { created_at: new Date().toISOString() }));
    const repoRoot = path.resolve(process.cwd());
    const gateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "visionscan-worker-claim-race-"));
    const scriptPath = path.join(gateRoot, "claim-worker.ts");
    const queueModule = pathToFileURL(path.join(repoRoot, "lib", "jobs", "queue.ts")).href;
    const dbModule = pathToFileURL(path.join(repoRoot, "lib", "storage", "db.ts")).href;
    const releasePath = path.join(gateRoot, "release");
    const script = `
import fs from "node:fs";
const { claimJob } = await import(${JSON.stringify(queueModule)});
const { closeDatabase, initializeDatabase } = await import(${JSON.stringify(dbModule)});
const workerId = process.env.CLAIM_WORKER_ID!;
const gateRoot = process.env.CLAIM_GATE_ROOT!;
const releasePath = process.env.CLAIM_RELEASE_PATH!;
const readyPath = process.env.CLAIM_READY_PATH!;
const startedPath = process.env.CLAIM_STARTED_PATH!;
const claimStartPath = process.env.CLAIM_START_PATH!;
try {
  await initializeDatabase();
  fs.writeFileSync(startedPath, "started");
  while (!fs.existsSync(claimStartPath)) await new Promise((resolve) => setTimeout(resolve, 10));
  const claimed = await claimJob(process.env.CLAIM_JOB_ID!, workerId, {
    canClaim: () => {
      fs.writeFileSync(readyPath, "ready");
      const waitCell = new Int32Array(new SharedArrayBuffer(4));
      const deadline = Date.now() + 15000;
      while (!fs.existsSync(releasePath) && Date.now() < deadline) Atomics.wait(waitCell, 0, 0, 10);
      return fs.existsSync(releasePath);
    },
  });
  console.log("CLAIM_RESULT " + JSON.stringify({ workerId, claimed: Boolean(claimed) }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
`;
    await fs.writeFile(scriptPath, script, "utf8");
    const runner = path.join(repoRoot, "node_modules", "vite-node", "dist", "cli.mjs");
    const startWorker = (workerId: string) => {
      const readyPath = path.join(gateRoot, `${workerId}.ready`);
      const startedPath = path.join(gateRoot, `${workerId}.started`);
      const claimStartPath = path.join(gateRoot, `${workerId}.claim`);
      const completed = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn(process.execPath, [runner, scriptPath], {
          cwd: repoRoot,
          windowsHide: true,
          env: { ...process.env, CLAIM_JOB_ID: id, CLAIM_WORKER_ID: workerId, CLAIM_GATE_ROOT: gateRoot, CLAIM_RELEASE_PATH: releasePath, CLAIM_READY_PATH: readyPath, CLAIM_STARTED_PATH: startedPath, CLAIM_START_PATH: claimStartPath },
        });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (result: { code: number | null; stdout: string; stderr: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        };
        const timeout = setTimeout(() => {
          child.kill();
          finish({ code: null, stdout, stderr: `${stderr}\nworker process timed out` });
        }, 20000);
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on("error", (error) => finish({ code: null, stdout, stderr: `${stderr}\n${String(error)}` }));
        child.on("exit", (code) => finish({ code, stdout, stderr }));
      });
      return { readyPath, startedPath, claimStartPath, completed };
    };
    const waitForFile = async (file: string, timeoutMs: number) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try { await fs.access(file); return true; } catch { /* Keep waiting for the worker transaction. */ }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    };
    const workers: Array<ReturnType<typeof startWorker>> = [];
    try {
      workers.push(startWorker("process-one"), startWorker("process-two"));
      const [firstStarted, secondStarted] = await Promise.all(workers.map((worker) => waitForFile(worker.startedPath, 10000)));
      // Both processes initialize the shared SQLite database before the first
      // process takes the write lock.
      await fs.writeFile(workers[0].claimStartPath, "claim", "utf8");
      const firstRead = await waitForFile(workers[0].readyPath, 10000);
      await fs.writeFile(workers[1].claimStartPath, "claim", "utf8");
      let secondReachedCanClaim = false;
      let secondFinishedBeforeRelease = false;
      if (secondStarted) {
        // Give process two time to enter claimJob while process one holds
        // BEGIN IMMEDIATE. It must not reach canClaim or finish before release.
        secondFinishedBeforeRelease = await Promise.race([
          workers[1].completed.then(() => true),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
        ]);
        try { await fs.access(workers[1].readyPath); secondReachedCanClaim = true; } catch { /* The transaction lock should keep it out. */ }
      }
      await fs.writeFile(releasePath, "release", "utf8");
      const outcomes = await Promise.all(workers.map((worker) => worker.completed));
      expect(firstStarted).toBe(true);
      expect(secondStarted).toBe(true);
      expect(firstRead).toBe(true);
      expect(secondReachedCanClaim).toBe(false);
      expect(secondFinishedBeforeRelease).toBe(false);
      expect(outcomes.map((outcome) => outcome.code), outcomes.map((outcome) => outcome.stderr).join("\n")).toEqual([0, 0]);
      const results = outcomes.flatMap((outcome) => outcome.stdout.split(/\r?\n/)
        .filter((line) => line.startsWith("CLAIM_RESULT "))
        .map((line) => JSON.parse(line.slice("CLAIM_RESULT ".length)) as { workerId: string; claimed: boolean }));
      expect(results).toHaveLength(2);
      expect(results.filter((result) => result.claimed)).toHaveLength(1);
      const stored = await dbGet<AnalysisJob>("jobs", id);
      expect(stored?.status).toBe("running");
      expect(results.map((result) => result.workerId)).toContain(stored?.worker_id);
    } finally {
      await fs.writeFile(releasePath, "cleanup", "utf8").catch(() => undefined);
      await Promise.all(workers.map((worker) => fs.writeFile(worker.claimStartPath, "cleanup", "utf8").catch(() => undefined)));
      await Promise.all(workers.map((worker) => worker.completed));
      await fs.rm(gateRoot, { recursive: true, force: true });
    }
  }, 45000);

  it("fails closed when the external worker is configured with the legacy JSON backend", async () => {
    const repoRoot = path.resolve(process.cwd());
    const runner = path.join(repoRoot, "node_modules", "vite-node", "dist", "cli.mjs");
    const childResult = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [runner, path.join(repoRoot, "scripts", "worker.ts")], {
        cwd: repoRoot,
        windowsHide: true,
        env: { ...process.env, VISIONSCAN_PERSISTENCE_BACKEND: "json", VISIONSCAN_WORKER_ONCE: "1" },
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
        resolve({ code: null, stdout, stderr: `${stderr}\nworker process timed out` });
      }, 10000);
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", (error) => {
        clearTimeout(timeout);
        resolve({ code: null, stdout, stderr: `${stderr}\n${String(error)}` });
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        resolve({ code, stdout, stderr });
      });
    });
    const result = await childResult;
    expect(result.code, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("External worker requires SQLite persistence");
  }, 15000);
});
