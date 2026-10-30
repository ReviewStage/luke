/**
 * hosts-procedures.ts -- the account's enrolled machines as Settings › Hosts reads and changes them: listed, removed, the install tokens that add Linux servers kept and revoked, and a box's pairing read, approved, or denied by its code.
 *
 * A machine is any device of the account's that holds a device secret, a
 * Linux box that traded an install token and a Mac its desktop enrolled
 * alike (`@luke/database/models/host-store`), so each is listed, judged
 * against the floor, and removed the same way; a desktop that never
 * enrolled is not listed.
 *
 * Every procedure is the account's own, on its bearer or its browser's
 * session (`accountMiddleware`), so the Hosts list works in a browser and on
 * a phone as in the desktop. An install token
 * reaches here as its SHA-256 alone: the member's own Luke mints the token
 * and shows it where the member is, so the service never holds it. A host
 * removed is refused at once on its secret (`auth/device-secret.ts`), and its
 * agents' running turns are settled lost with it; a token
 * revoked enrolls no box again and touches none it already enrolled. Each
 * host is listed with whether its daemon is below the floor, where its
 * setup stands, and, for a Mac, the user it runs as, and every
 * answer names the install script on the service's own origin, which the
 * install and upgrade commands name (`@luke/features/host-wire`).
 *
 * A box's pairing is read, approved, or denied by its user code, whatever
 * its case and dash, and only while it is pending and its code has not
 * lapsed (`@luke/database/models/host-pairing-store`). The read answers
 * what the approve screen shows: the box as it named itself and the
 * address its start came from, so a member sees whose box they would let
 * run their agents. An approve makes the account's host under an id minted
 * here, never one the box named, listed from that moment and keyed with a
 * secret on its box's next poll. Each of the three is a guess: one that
 * finds no pending pairing is answered not found and counts against the
 * account, and an account past the limit is refused as held, with when its
 * window ends, until it does.
 */

import { randomUUID } from "node:crypto";
import { runningTurnIds, settleRunnerLostTurns } from "@luke/database/models/abandoned-turns";
import { devicesSeenSince } from "@luke/database/models/device-store";
import {
  approveHostPairing,
  denyHostPairing,
  HOST_PAIRING_GUESS,
  type HostPairingGuessed,
  readHostPairing,
} from "@luke/database/models/host-pairing-store";
import {
  hostAgentConversations,
  hostsOf,
  mintHostInstallToken,
  removeHost,
  revokeHostInstallToken,
} from "@luke/database/models/host-store";
import { storeWriter } from "@luke/database/models/writer";
import { DEVICE_PLATFORM, type DevicePlatform } from "@luke/features/device-agent-wire";
import { HOST_WIRE, hostUserCodeOf, hostVersionMeets } from "@luke/features/host-wire";
import { Clock, Effect } from "effect";
import { HOST_VERSION } from "../auth/device-secret.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  hostPairingHeld,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

export interface HostsProcedureSeams {
  /** The account behind a request: its bearer, or a browser's session cookie (`accountMiddleware`). */
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

/** Where a Mac keeps its users' home folders, each named for its user. */
const MAC_HOMES = "/Users/";

/** The install script's address on the origin the request reached, so a Preview's command names its own. */
function installScriptUrlOf(request: Request): string {
  return new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, new URL(request.url).origin).href;
}

/** The user a Mac's host runs as, by its home folder's name under `/Users`; none for a Linux machine, or a home that names no one there. */
function loginNameOf(platform: DevicePlatform, home: string | null): string | undefined {
  if (platform !== DEVICE_PLATFORM.DARWIN || home === null || !home.startsWith(MAC_HOMES)) {
    return undefined;
  }
  const name = home.slice(MAC_HOMES.length).replace(/\/+$/u, "");
  return name === "" || name.includes("/") ? undefined : name;
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

/** A code's eight letters, or the request refused as invalid where it is none, which its schema already refused. */
const codeOf = (typed: string) => {
  const code = hostUserCodeOf(typed);
  return code === undefined ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST) : Effect.succeed(code);
};

/** What a guess found, or its refusal: not found where it found no pending pairing, held, with until when, where the account is past the limit. */
const foundOrRefused = <A>(guessed: HostPairingGuessed<A>) => {
  switch (guessed.guess) {
    case HOST_PAIRING_GUESS.FOUND:
      return Effect.succeed(guessed.found);
    case HOST_PAIRING_GUESS.MISSED:
      return Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    case HOST_PAIRING_GUESS.HELD:
      return Effect.fail(hostPairingHeld(guessed.heldUntil.getTime()));
  }
};

/** The hosts resource, on the account's bearer or session. */
export function hostsProcedures(seams: HostsProcedureSeams) {
  const hosts = hosted.hosts.use(accountMiddleware(seams.resolveUserId));
  return {
    list: hosts.list.effect(function* ({ context }) {
      const rows = yield* hostedStoreOrUnavailable(hostsOf(context.userId));
      return {
        hosts: rows.map((row) => {
          const loginName = loginNameOf(row.platform, row.home);
          return {
            id: row.id,
            name: row.name,
            platform: row.platform,
            seenAt: row.lastSeenAt.getTime(),
            version: row.version,
            upgradeNeeded:
              row.version === null || !hostVersionMeets(row.version, HOST_VERSION.FLOOR),
            ...(row.setup === null ? undefined : { setup: row.setup }),
            ...(row.setupFailure === null ? undefined : { setupFailure: row.setupFailure }),
            ...(loginName === undefined ? undefined : { loginName }),
          };
        }),
        installScriptUrl: installScriptUrlOf(context.request),
      };
    }),
    presence: hosts.presence.effect(function* ({ context }) {
      const owned = yield* hostedStoreOrUnavailable(devicesSeenSince(context.userId, new Date(0)));
      const now = yield* Clock.currentTimeMillis;
      return {
        devices: owned.map((row) => ({
          deviceId: row.id,
          // Note that the age is taken on this clock, which wrote the beat, so a reader's clock never enters it.
          ageMs: Math.max(0, now - row.lastSeenAt.getTime()),
        })),
      };
    }),
    remove: hosts.remove.effect(function* ({ context, input }) {
      const removed = yield* hostedStoreOrUnavailable(removeHost(context.userId, input.id));
      if (removed) yield* endedHostAgents(context.userId, input.id);
      return yield* keptOrNotFound(removed);
    }),
    keepInstallToken: hosts.keepInstallToken.effect(function* ({ context, input }) {
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
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(revokeHostInstallToken(context.userId, input.id)),
      );
    }),
    readPairing: hosts.readPairing.effect(function* ({ context, input }) {
      const code = yield* codeOf(input.code);
      const pending = yield* foundOrRefused(
        yield* hostedStoreOrUnavailable(readHostPairing(context.userId, code)),
      );
      return { ...pending, expiresAt: pending.expiresAt.getTime() };
    }),
    approvePairing: hosts.approvePairing.effect(function* ({ context, input }) {
      const code = yield* codeOf(input.code);
      // Note that the host's id is minted here, so a pairing never names a device that stands.
      const deviceId = yield* foundOrRefused(
        yield* hostedStoreOrUnavailable(approveHostPairing(context.userId, code, randomUUID())),
      );
      return { deviceId };
    }),
    denyPairing: hosts.denyPairing.effect(function* ({ context, input }) {
      const code = yield* codeOf(input.code);
      yield* foundOrRefused(yield* hostedStoreOrUnavailable(denyHostPairing(context.userId, code)));
      return DONE;
    }),
  };
}
