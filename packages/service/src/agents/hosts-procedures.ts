/**
 * hosts-procedures.ts -- the account's hosts as Settings › Agents › Hosts reads and changes them: listed, removed, and the install tokens that add them kept and revoked.
 *
 * Every procedure is the account's own, on its bearer or its browser's
 * session (`accountMiddleware`), so the Hosts list works in a browser and on
 * a phone as in the desktop, and answers not found, before it touches a row,
 * where the account has the `local-agents` experiment off. An install token
 * reaches here as its SHA-256 alone: the member's own Luke mints the token
 * and shows it where the member is, so the service never holds it. A host
 * removed is refused at once on its secret (`auth/device-secret.ts`), and its
 * agents' running turns are settled lost with it; a token
 * revoked enrolls no box again and touches none it already enrolled. Each
 * host is listed with whether its daemon is below the floor, and every
 * answer names the install script on the service's own origin, which the
 * install and upgrade commands name (`@luke/features/host-wire`).
 */

import { runningTurnIds, settleRunnerLostTurns } from "@luke/database/models/abandoned-turns";
import { accountExperimentOn } from "@luke/database/models/account-store";
import {
  hostAgentConversations,
  hostsOf,
  mintHostInstallToken,
  removeHost,
  revokeHostInstallToken,
} from "@luke/database/models/host-store";
import { storeWriter } from "@luke/database/models/writer";
import { HOST_WIRE, hostVersionMeets } from "@luke/features/host-wire";
import { EXPERIMENT } from "@luke/settings";
import { Clock, Effect } from "effect";
import { HOST_VERSION } from "../auth/device-secret.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

export interface HostsProcedureSeams {
  /** The account behind a request: its bearer, or a browser's session cookie (`accountMiddleware`). */
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

/** Not found where the account has the `local-agents` experiment off, which hosts sit behind as This Mac does. */
const experimentOn = (userId: string) =>
  Effect.gen(function* () {
    if (!(yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.LOCAL_AGENTS)))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
  });

/** The install script's address on the origin the request reached, so a Preview's command names its own. */
function installScriptUrlOf(request: Request): string {
  return new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, new URL(request.url).origin).href;
}

/** Why a removed host's agents' turns read as failed. */
const HOST_REMOVED_DETAIL = "the host this agent ran on was removed";

/**
 * Settles every turn still running of the agents pinned to a host just
 * removed as lost, as a runner gone without its end is settled
 * (`settleRunnerLostTurns`): the host's secret is refused from now on, so no
 * runner there can end them, and without this they would read as running
 * until `TURN_ABANDON`. Note that every agent's running turns are read once,
 * before any is settled, and only those are settled, because a removed host
 * may enroll again under its id and begin a turn while this runs, and that
 * turn is the new enrollment's. A failure here is logged and the remove
 * still answers done, because the host is already removed and a retry would
 * find no host to remove; the sweep's bound settles whatever was left.
 */
const endedHostAgents = (userId: string, deviceId: string) =>
  Effect.gen(function* () {
    const conversations = yield* hostAgentConversations(userId, deviceId);
    if (conversations.length === 0) return;
    const lost = yield* Effect.forEach(conversations, (conversationId) =>
      Effect.map(runningTurnIds(conversationId), (ids) => ({ conversationId, ids })),
    );
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const now = yield* Clock.currentTimeMillis;
    for (const { conversationId, ids } of lost) {
      if (ids.length === 0) continue;
      yield* settleRunnerLostTurns(writer, conversationId, now, HOST_REMOVED_DETAIL, new Set(ids));
    }
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning("a removed host's agents' turns were not settled", failure),
    ),
  );

/** Kept, or not found where the account holds no such row. */
const keptOrNotFound = (kept: boolean) =>
  kept ? Effect.succeed(DONE) : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/** The hosts resource, on the account's bearer or session. */
export function hostsProcedures(seams: HostsProcedureSeams) {
  const hosts = hosted.hosts.use(accountMiddleware(seams.resolveUserId));
  return {
    list: hosts.list.effect(function* ({ context }) {
      yield* experimentOn(context.userId);
      const rows = yield* hostedStoreOrUnavailable(hostsOf(context.userId));
      return {
        hosts: rows.map((row) => ({
          id: row.id,
          name: row.name,
          seenAt: row.lastSeenAt.getTime(),
          version: row.version,
          upgradeNeeded: row.version === null || !hostVersionMeets(row.version, HOST_VERSION.FLOOR),
        })),
        installScriptUrl: installScriptUrlOf(context.request),
      };
    }),
    remove: hosts.remove.effect(function* ({ context, input }) {
      yield* experimentOn(context.userId);
      const removed = yield* hostedStoreOrUnavailable(removeHost(context.userId, input.id));
      if (removed) yield* endedHostAgents(context.userId, input.id);
      return yield* keptOrNotFound(removed);
    }),
    keepInstallToken: hosts.keepInstallToken.effect(function* ({ context, input }) {
      yield* experimentOn(context.userId);
      const minted = yield* hostedStoreOrUnavailable(
        mintHostInstallToken(context.userId, input.tokenHash),
      );
      return {
        id: minted.id,
        expiresAt: minted.expiresAt.getTime(),
        installScriptUrl: installScriptUrlOf(context.request),
      };
    }),
    revokeInstallToken: hosts.revokeInstallToken.effect(function* ({ context, input }) {
      yield* experimentOn(context.userId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(revokeHostInstallToken(context.userId, input.id)),
      );
    }),
  };
}
