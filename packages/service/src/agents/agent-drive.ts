import { createHash } from "node:crypto";
import { Effect } from "effect";
import { BASE_DRIVE, type BaseDriveOf, baseDriveFilled, baseDriveName } from "./base-drive.js";
import type { VercelSandboxApi } from "./vercel-sandbox-api.js";

export const AGENT_DRIVE = {
  NAME_PREFIX: "agent-drive-",
  MOUNT_PATH: BASE_DRIVE.MOUNT_PATH,
} as const;

export const AGENT_DRIVE_FROM = { KEPT: "kept", FORKED: "forked", EMPTY: "empty" } as const;

export type AgentDriveFrom = (typeof AGENT_DRIVE_FROM)[keyof typeof AGENT_DRIVE_FROM];

export interface AgentDrive {
  readonly name: string;
  readonly from: AgentDriveFrom;
}

export function agentDriveName(sessionId: string): string {
  const digest = createHash("sha256").update(sessionId).digest("hex");
  return `${AGENT_DRIVE.NAME_PREFIX}${digest.slice(0, 32)}`;
}

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
