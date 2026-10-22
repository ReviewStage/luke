/**
 * sandbox-retention-sweep.ts -- the scheduled sweep's bound on the snapshot retention of the stopped coding agents' sandboxes no keep-alive reaches.
 *
 * A sandbox opened before Luke bounded its snapshot retention keeps every
 * snapshot its stops wrote, or the newest for thirty days, as long as it
 * stands (`agents/sandbox-retention.ts`). A running one is brought onto the
 * bound as it is kept alive; a stopped one, an idle agent's or an archived
 * one's, is kept alive by nothing, and this sweep brings it onto the bound
 * instead. Which snapshots stay is the bound's rule: the one the sandbox
 * resumes from, where it is the newest, so an agent unarchived or messaged
 * later resumes where it stopped. A sandbox whose snapshot is not its newest
 * is left as it is.
 *
 * Each minute the sweep reads one bucket of the project's sandboxes, those
 * whose names, eve's (`eve-sbx-vercel-` and a hex digest) and a native
 * agent's (`luke-agent-` and a UUID), go on with the two hex digits the
 * minute picks, so every sandbox is read once in 256 minutes with no cursor
 * kept between sweeps, through the list by name prefix Vercel's documented
 * "List sandboxes" takes (https://vercel.com/docs/rest-api/sandboxes/list-sandboxes).
 * Templates (`eve-sbx-tpl-vercel-`, `luke-native-template-`) are never in a
 * bucket, since a template's one snapshot is what every new sandbox opens
 * from. One page of each prefix is read, which holds the 50 sandboxes a
 * bucket has room for, and at most `MAX_UPDATES` are brought onto the bound,
 * the rest left for the bucket's next turn. What is asked of Vercel is a
 * name and a snapshot's id; what is logged of a failure is its status.
 */

import { Effect, Result } from "effect";
import type { HttpClient } from "effect/http";
import { SANDBOX_NAME } from "../agents/coder-host/runner-sessions.js";
import {
  boundSnapshotRetention,
  RETENTION_ENDING,
  type RetentionEnding,
  retentionStands,
} from "../agents/sandbox-retention.js";
import {
  deploymentOidcToken,
  type ListedSandbox,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../agents/vercel-sandbox-api.js";
import { EVE_SESSION_SANDBOX_NAME } from "./eve-sandbox-sweep.js";

export const SANDBOX_RETENTION_SWEEP = {
  /** How many buckets the sandboxes are read in, one a minute: every two-hex-digit name prefix. */
  BUCKETS: 256,
  /** The most sandboxes one sweep brings onto the bound; the rest wait for their bucket's next turn. */
  MAX_UPDATES: 20,
  CONCURRENCY: 5,
} as const;

/** The name prefixes of the coding agents' own sandboxes, eve's and a native agent's. */
const AGENT_SANDBOX_NAMES = [EVE_SESSION_SANDBOX_NAME, SANDBOX_NAME] as const;

/** The status a sandbox is down in, its filesystem kept in its snapshot. */
const STOPPED_STATUS = "stopped";

/** What one sweep came to: sandboxes brought onto the bound, ones left, ones Vercel did not confirm, ones past the bound, and ones whose snapshot went. */
export interface SandboxRetentionSweepOutcome {
  applied: number;
  skipped: number;
  failed: number;
  deferred: number;
  lost: number;
}

/** The two hex digits of the bucket this minute reads. */
function bucketAt(now: Date): string {
  const minute = Math.floor(now.getTime() / 60_000);
  return (minute % SANDBOX_RETENTION_SWEEP.BUCKETS).toString(16).padStart(2, "0");
}

/** The stopped sandboxes of the bucket whose retention is not the bound; a prefix Vercel did not list is logged and read as none. */
const unboundIn = (api: VercelSandboxApi, bucket: string) =>
  Effect.forEach(AGENT_SANDBOX_NAMES, (name) =>
    Effect.result(api.listNamed(`${name}${bucket}`)).pipe(
      Effect.flatMap((listed) =>
        Result.isSuccess(listed)
          ? Effect.succeed(listed.success)
          : Effect.as(
              Effect.logWarning(`a bucket of sandboxes was not listed: ${listed.failure.message}`),
              [] as readonly ListedSandbox[],
            ),
      ),
    ),
  ).pipe(
    Effect.map((pages) =>
      pages
        .flat()
        .filter((sandbox) => sandbox.status === STOPPED_STATUS && !retentionStands(sandbox)),
    ),
  );

/** Brings the stopped sandboxes of this minute's bucket onto the bound, `CONCURRENCY` at a time, `MAX_UPDATES` at most. */
export const sweepSandboxRetention = /* @__PURE__ */ Effect.fn("web/sweepSandboxRetention")(
  function* (
    now: Date,
  ): Effect.fn.Return<SandboxRetentionSweepOutcome, never, HttpClient.HttpClient> {
    const api = yield* vercelSandboxApi(deploymentOidcToken);
    const unbound = yield* unboundIn(api, bucketAt(now));
    const taken = unbound.slice(0, SANDBOX_RETENTION_SWEEP.MAX_UPDATES);
    const endings = yield* Effect.forEach(
      taken,
      (sandbox) => boundSnapshotRetention(api, sandbox),
      {
        concurrency: SANDBOX_RETENTION_SWEEP.CONCURRENCY,
      },
    );
    const count = (ending: RetentionEnding) => endings.filter((each) => each === ending).length;
    return {
      applied: count(RETENTION_ENDING.APPLIED),
      skipped: count(RETENTION_ENDING.SKIPPED),
      failed: count(RETENTION_ENDING.FAILED),
      deferred: unbound.length - taken.length,
      lost: count(RETENTION_ENDING.LOST),
    };
  },
);
