/**
 * agent-drive.ts -- the drive an agent's work stands on: its session's own, mounted at the workspace of each sandbox the session opens, forked from its repository's base drive where that is filled.
 *
 * A persistent sandbox keeps its files in its own snapshots, which lapse
 * seven days after its last use (`CODER.SANDBOX_SNAPSHOTS`), and whatever
 * the agent never pushed lapses with them. A drive persists until it is
 * deleted (https://vercel.com/docs/sandbox/concepts/drives), so a session's
 * checkout stands on a drive of its own, mounted read-write at the
 * workspace, and a sandbox opened in place of one whose snapshot lapsed
 * mounts the same drive again, the checkout as the agent left it. A new
 * session's drive is forked from its workspace's repository's base drive
 * (`base-drive.ts`) where that is filled, so its checkout and `node_modules`
 * are there before its sandbox opens: "a fleet of agents, each working
 * independently on their own read-write copy forked from a base drive".
 * Where none is, the drive is made empty and the repository cloned onto it.
 * A sandbox opened before agents had drives mounts none, and resumes as it
 * always did until its snapshot lapses.
 *
 * The drive outlives each sandbox of its session: a sandbox thrown away for
 * its lapsed snapshot leaves it, as an archive's stop does. It is deleted
 * once the session is let go of for good, at a task's, an agent's, or an
 * account's delete, by the queue that deletes the session's sandboxes
 * (`session-sandboxes.ts`), after them. Note that a running sandbox just
 * deleted holds its drive a few seconds more, and Vercel refuses the
 * drive's delete until it lets go, so a pass of the queue that meets it
 * still held leaves the session queued for the next.
 */

import { createHash } from "node:crypto";
import { Effect } from "effect";
import { BASE_DRIVE, type BaseDriveOf, baseDriveFilled, baseDriveName } from "./base-drive.js";
import type { VercelSandboxApi } from "./vercel-sandbox-api.js";

export const AGENT_DRIVE = {
  /** Every agent drive is named with this, a digest of its session's id after it. */
  NAME_PREFIX: "agent-drive-",
  /** Where the drive is mounted: where a base drive is, so a fork's checkout stands where its fill cloned it. */
  MOUNT_PATH: BASE_DRIVE.MOUNT_PATH,
} as const;

/** How the session's drive came to be mounted: kept from an earlier sandbox of the session, forked from the base drive, or made empty. */
export const AGENT_DRIVE_FROM = { KEPT: "kept", FORKED: "forked", EMPTY: "empty" } as const;

export type AgentDriveFrom = (typeof AGENT_DRIVE_FROM)[keyof typeof AGENT_DRIVE_FROM];

/** The session's drive: its name, and how it came to be. */
export interface AgentDrive {
  readonly name: string;
  readonly from: AgentDriveFrom;
}

/** The session's drive's name: the prefix and a digest of the session's id, as a base drive's is named. */
export function agentDriveName(sessionId: string): string {
  const digest = createHash("sha256").update(sessionId).digest("hex");
  return `${AGENT_DRIVE.NAME_PREFIX}${digest.slice(0, 32)}`;
}

/**
 * The session's drive: the one standing, kept from an earlier sandbox of
 * the session; else a fork of the base drive given, where it is filled;
 * else made empty.
 */
export const agentDrive = Effect.fn("web/agentDrive")(function* (
  api: VercelSandboxApi,
  sessionId: string,
  base: BaseDriveOf | undefined,
) {
  const name = agentDriveName(sessionId);
  if ((yield* api.getDrive(name)) !== undefined) {
    return { name, from: AGENT_DRIVE_FROM.KEPT } satisfies AgentDrive;
  }
  if (base !== undefined && (yield* baseDriveFilled(api, base))) {
    yield* api.forkDrive(baseDriveName(base), name);
    return { name, from: AGENT_DRIVE_FROM.FORKED } satisfies AgentDrive;
  }
  yield* api.getOrCreateDrive(name);
  return { name, from: AGENT_DRIVE_FROM.EMPTY } satisfies AgentDrive;
});
