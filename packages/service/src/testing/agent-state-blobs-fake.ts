/**
 * agent-state-blobs-fake.ts -- the store of device agents' saved state as a suite holds it, for the suites that save, launch, and sweep an agent's state with no store behind them.
 *
 * The double is a layer on `AgentStateBlobs`: an upload or a read is
 * granted at once, as a URL on a host no one answers that names the path
 * and the grant, and every delete is written down in the order asked, for
 * the suite to read back. A deployment with no store is a layer of its
 * own, whose every grant is unavailable.
 */

import { DEVICE_AGENT_BOUNDS } from "@luke/features/device-agent-wire";
import { Duration, Effect, Layer } from "effect";
import {
  AGENT_STATE_BLOBS,
  AgentStateBlobs,
  AgentStateBlobsUnavailable,
} from "../agents/agent-state-blobs.js";

/** The host every URL the double grants is on. */
const AGENT_STATE_BLOBS_FAKE = { ORIGIN: "https://agent-state.test" } as const;

/** What the double grants a URL for, which the URL names. */
export const AGENT_STATE_GRANT = { UPLOAD: "upload", READ: "read" } as const;

type AgentStateGrant = (typeof AGENT_STATE_GRANT)[keyof typeof AGENT_STATE_GRANT];

/** The URL the double grants for the path and operation given. */
export function agentStateBlobUrl(operation: AgentStateGrant, path: string): string {
  const url = new URL(`/${path}`, AGENT_STATE_BLOBS_FAKE.ORIGIN);
  url.searchParams.set("grant", operation);
  return url.toString();
}

/** A store that grants every upload and read, and the paths it was asked to delete, in order. */
export function agentStateBlobsFake() {
  const removed: string[] = [];
  const layer = Layer.succeed(AgentStateBlobs, {
    configured: true,
    mintUpload: (path) =>
      Effect.map(
        Effect.clockWith((clock) => clock.currentTimeMillis),
        (now) => ({
          url: agentStateBlobUrl(AGENT_STATE_GRANT.UPLOAD, path),
          headers: { "content-type": "application/octet-stream" },
          expiresAt: new Date(now + Duration.toMillis(AGENT_STATE_BLOBS.UPLOAD_FOR)),
          maxBytes: DEVICE_AGENT_BOUNDS.MAX_STATE_BYTES,
        }),
      ),
    mintRead: (path) =>
      Effect.map(
        Effect.clockWith((clock) => clock.currentTimeMillis),
        (now) => ({
          url: agentStateBlobUrl(AGENT_STATE_GRANT.READ, path),
          expiresAt: new Date(now + Duration.toMillis(AGENT_STATE_BLOBS.READ_FOR)),
        }),
      ),
    remove: (paths) =>
      Effect.sync(() => {
        removed.push(...paths);
      }),
  });
  return { layer, removed };
}

/** A deployment with no store: nothing configured, and every grant and delete unavailable. */
export const NO_AGENT_STATE_STORE = Layer.succeed(AgentStateBlobs, {
  configured: false,
  mintUpload: () => Effect.fail(new AgentStateBlobsUnavailable({})),
  mintRead: () => Effect.fail(new AgentStateBlobsUnavailable({})),
  remove: () => Effect.fail(new AgentStateBlobsUnavailable({})),
});
