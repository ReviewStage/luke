/**
 * agent-sandbox-open.ts -- the one way an agent's sandbox is opened, by whichever caller opens it: `Sandbox.getOrCreate` under its session's name, on its session's drive, from the agents' image.
 *
 * An agent's sandbox is named after its session (`agentSandboxName`) and
 * opened as Vercel's persistent sandboxes are
 * (https://vercel.com/docs/sandbox/concepts/persistent-sandboxes): the one
 * standing under the name is resumed, one is created where none stands, and
 * one whose snapshot is gone is deleted and created again under the same
 * name, its session's drive mounted at the workspace (`agent-drive.ts`),
 * which holds the checkout through it. Whichever caller opens it, a message's
 * launch (`machine/vercel-machine.ts`), the Terminal, or the agent's browser,
 * opens it here, so a sandbox any of them creates is the same sandbox: the
 * `agent` user made in its `onCreate`, as the SDK makes one, beside what the
 * caller's own `onCreate` adds, which only a launch adds (the checkout).
 */

import { createHash } from "node:crypto";
import { AGENT_USER, CODEX_PIN } from "@repo/agent-runner/pins";
import { Duration, Effect, Schedule } from "effect";
import { AGENT_DRIVE, agentDriveName } from "./agent-drive.js";
import { AgentImage } from "./coder-host/agent-image.js";
import { CODER } from "./coder-host/bounds.js";
import {
  IMAGE_NOT_READY,
  type OpenedSandbox,
  SandboxUnavailable,
  SESSION_TAG,
  type VercelSandboxApi,
} from "./vercel-sandbox-api.js";

/**
 * What a sandbox we open is named as, beside a digest of its session's id
 * (`agentSandboxName`), or a fresh UUID for one opened before `getOrCreate`;
 * the sweep tells a native sandbox from eve's by it.
 */
export const SANDBOX_NAME = "agent-sandbox-";

/**
 * The tag a sandbox we open carries beside its session's: the agent it was
 * opened for, so a later call and the sweep tell whose it is. Its runner is
 * recorded in our store instead (`@repo/database/models/agent-runner-record`).
 */
export const AGENT_TAG = "agentId";

/** The variables the sandbox opens with, as eve's coding-agent environment sets them. */
export const SANDBOX_ENV = { NO_COLOR: "1", GH_STACK_NO_UPDATE_NOTIFIER: "1" } as const;

/** Why a sandbox could not be opened where its build named no agents' image (`coder-host/agent-image.ts`). */
const IMAGE_MISSING = "the agents' image could not be read";

/** The folders the `agent` user's home holds from its making: Codex's `CODEX_HOME`, which Codex refuses to start without. */
const AGENT_HOME_FOLDERS = [CODEX_PIN.HOME];

/**
 * How a create on an image the registry is still preparing is asked again:
 * every `SPACED`, at most `TIMES` times, as Vercel's docs say to retry once
 * the preparation finishes. Note that CI pushes each image and waits for
 * Vercel to prepare it before the deploy that names it lands, so only a
 * Preview opened as its image is pushed waits here.
 */
const IMAGE_RETRY = {
  SPACED: Duration.seconds(10),
  TIMES: 18,
} as const;

/**
 * The session's sandbox's name, which `getOrCreate` opens it under: the
 * prefix and a digest of the session's id, as its drive is named
 * (`agentDriveName`), so every open of the session finds the one sandbox
 * standing under it.
 */
export function agentSandboxName(sessionId: string): string {
  const digest = createHash("sha256").update(sessionId).digest("hex");
  return `${SANDBOX_NAME}${digest.slice(0, 32)}`;
}

/** The tags a sandbox we open carries: its session's, and the agent it is opened for. */
export function agentSandboxTags(sessionId: string, agentId: string): Record<string, string> {
  return { [SESSION_TAG]: sessionId, [AGENT_TAG]: agentId };
}

/**
 * What an agent's sandbox is opened as: its session, its tags, and how many
 * vCPUs it runs on, Vercel's default where unsaid. A launch names the
 * agent's own (`agentSandboxTags`, `sandboxVcpus`); a caller that opens one
 * already standing again names those it stands with.
 */
export interface AgentSandboxOf {
  readonly sessionId: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly vcpus: number | undefined;
}

/**
 * The agent's sandbox opened through `getOrCreate`, as above, from the
 * agents' image, asked again while the registry still prepares the image
 * (`IMAGE_RETRY`): running, with whether this call created it. A sandbox it
 * creates has the `agent` user made in it, and is then handed to the
 * caller's `onCreate` where it gives one; a failure of either fails the open,
 * as does an image the build named none of, which reads as the sandbox
 * unavailable.
 */
export const openAgentSandbox = (
  api: Pick<VercelSandboxApi, "getOrCreate">,
  of: AgentSandboxOf,
  onCreate?: (created: OpenedSandbox) => Promise<void>,
) =>
  Effect.gen(function* () {
    const image = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference).pipe(
      Effect.catchTag("AgentImageMissing", () =>
        Effect.fail(new SandboxUnavailable({ detail: IMAGE_MISSING })),
      ),
    );
    let created = false;
    const sandbox = yield* api
      .getOrCreate(
        {
          name: agentSandboxName(of.sessionId),
          image,
          tags: of.tags,
          timeoutMs: CODER.SANDBOX_TIMEOUT_MS,
          ...(of.vcpus === undefined ? undefined : { vcpus: of.vcpus }),
          keepLastSnapshots: {
            count: CODER.SANDBOX_SNAPSHOTS.count,
            expiration: Duration.toMillis(CODER.SANDBOX_SNAPSHOTS.expiration),
            deleteEvicted: CODER.SANDBOX_SNAPSHOTS.deleteEvicted,
          },
          env: SANDBOX_ENV,
          mounts: { [AGENT_DRIVE.MOUNT_PATH]: agentDriveName(of.sessionId) },
          user: { name: AGENT_USER, homeFolders: AGENT_HOME_FOLDERS },
        },
        async (opened) => {
          created = true;
          await onCreate?.(opened);
        },
      )
      .pipe(
        Effect.retry({
          schedule: Schedule.spaced(IMAGE_RETRY.SPACED),
          times: IMAGE_RETRY.TIMES,
          while: (failure) => failure.code === IMAGE_NOT_READY,
        }),
      );
    return { sandbox, created };
  });
