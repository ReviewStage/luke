import { randomUUID } from "node:crypto";
import { runningTurnIds } from "@repo/database/models/abandoned-turns";
import { devicesSeenSince } from "@repo/database/models/device-store";
import {
  approveHostPairing,
  denyHostPairing,
  HOST_PAIRING_GUESS,
  type HostPairingGuessed,
  readHostPairing,
} from "@repo/database/models/host-pairing-store";
import { hostAgentConversations, hostsOf, removeHost } from "@repo/database/models/host-store";
import { HOST_WIRE, hostUserCodeOf, hostVersionMeets } from "@repo/features/host-wire";
import { Clock, Effect } from "effect";
import { HOST_VERSION } from "../auth/device-secret.js";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_HOST_PAIRING_ACTION,
} from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  hostPairingHeld,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { settleLostHostTurns } from "./lost-host-turns.js";

export interface HostsProcedureSeams {
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

export function installScriptUrlOf(request: Request): string {
  return new URL(HOST_WIRE.INSTALL_SCRIPT_PATH, new URL(request.url).origin).href;
}

const endedHostAgents = (userId: string, deviceId: string) =>
  Effect.gen(function* () {
    const conversations = yield* hostAgentConversations(userId, deviceId);
    const lost = yield* Effect.forEach(conversations, (conversationId) =>
      Effect.map(runningTurnIds(conversationId), (ids) => ({
        conversationId,
        runningTurnIds: ids,
      })),
    );
    yield* settleLostHostTurns(lost);
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning("a removed host's agents' turns were not settled", failure),
    ),
  );

export const removeAccountHost = (userId: string, id: string) =>
  Effect.gen(function* () {
    const removed = yield* hostedStoreOrUnavailable(removeHost(userId, id));
    if (removed === undefined) return undefined;
    yield* endedHostAgents(userId, id);
    yield* recordServerEvent(
      SERVER_EVENT.HOST_PAIRING_CHANGE,
      { userId },
      { action: SERVER_HOST_PAIRING_ACTION.REMOVE },
    );
    return removed;
  });

const removedOrNotFound = (txid: string | undefined) =>
  txid === undefined ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.succeed({ ...DONE, txid });

const codeOf = (typed: string) => {
  const code = hostUserCodeOf(typed);
  return code === undefined ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST) : Effect.succeed(code);
};

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

export function hostsProcedures(seams: HostsProcedureSeams) {
  const hosts = hosted.hosts.use(accountMiddleware(seams.resolveUserId));
  return {
    list: hosts.list.effect(function* ({ context }) {
      const rows = yield* hostedStoreOrUnavailable(hostsOf(context.userId));
      return {
        hosts: rows.map((row) => ({
          id: row.id,
          name: row.name,
          platform: row.platform,
          seenAt: row.lastSeenAt.getTime(),
          version: row.version,
          upgradeNeeded: row.version === null || !hostVersionMeets(row.version, HOST_VERSION.FLOOR),
          ...(row.setup === null ? undefined : { setup: row.setup }),
          ...(row.setupFailure === null ? undefined : { setupFailure: row.setupFailure }),
          ...(row.update === null ? undefined : { update: row.update }),
          ...(row.updateFailure === null ? undefined : { updateFailure: row.updateFailure }),
          ...(row.machineId === null ? undefined : { machineId: row.machineId }),
          ...(row.model === null ? undefined : { model: row.model }),
          calledIn: row.home !== null,
        })),
        installScriptUrl: installScriptUrlOf(context.request),
      };
    }),
    presence: hosts.presence.effect(function* ({ context }) {
      const owned = yield* hostedStoreOrUnavailable(devicesSeenSince(context.userId, new Date(0)));
      const now = yield* Clock.currentTimeMillis;
      return {
        devices: owned.map((row) => ({
          deviceId: row.id,
          ageMs: Math.max(0, now - row.lastSeenAt.getTime()),
        })),
      };
    }),
    remove: hosts.remove.effect(function* ({ context, input }) {
      return yield* removedOrNotFound(yield* removeAccountHost(context.userId, input.id));
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
      const deviceId = yield* foundOrRefused(
        yield* hostedStoreOrUnavailable(approveHostPairing(context.userId, code, randomUUID())),
      );
      yield* recordServerEvent(
        SERVER_EVENT.HOST_PAIRING_CHANGE,
        { userId: context.userId },
        { action: SERVER_HOST_PAIRING_ACTION.APPROVE },
      );
      return { deviceId };
    }),
    denyPairing: hosts.denyPairing.effect(function* ({ context, input }) {
      const code = yield* codeOf(input.code);
      yield* foundOrRefused(yield* hostedStoreOrUnavailable(denyHostPairing(context.userId, code)));
      yield* recordServerEvent(
        SERVER_EVENT.HOST_PAIRING_CHANGE,
        { userId: context.userId },
        { action: SERVER_HOST_PAIRING_ACTION.DENY },
      );
      return DONE;
    }),
  };
}
