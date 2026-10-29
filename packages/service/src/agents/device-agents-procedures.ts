/**
 * device-agents-procedures.ts -- a local agent's Mac registers and beats, takes its agents' lines and its tools' requests, and says what came of each.
 *
 * Every procedure but the enrolls reads the device's bearer alone, never a
 * browser's session cookie (`deviceMiddleware`), since a line carries a
 * runner's secrets and an answer is the word of the device that ran it, and
 * names the device's id: the machine's device secret, which acts for its
 * own device alone and answers not found for any other. A desktop's own
 * sign-in, which released desktop builds followed the queue on, is refused
 * there as needing an upgrade.
 * The enroll's bearer is an install token instead (`installTokenMiddleware`),
 * which it trades for a host and the secret it calls on from then on
 * (`@luke/features/host-wire`), answered this once; it refuses an unknown,
 * revoked, or expired token as an invalid token, and the id of one of the
 * token's member's standing hosts as still enrolled. The own enroll's
 * bearer is the desktop's sign-in alone (`bearerOnlyMiddleware`, never a
 * browser's cookie, since it mints a credential), and it converts a device
 * the member's account registered in place under its id, or creates one
 * under the account with the name, platform and architecture the enroll
 * sends where the account never registered the id, answering its new
 * secret this once; it answers not found for another account's id, and
 * for an id the account never registered where the enroll sent no
 * machine, and refuses an enroll naming only some of the machine's fields
 * as invalid. A host's every call,
 * the enroll's included, is refused as needing an upgrade where its daemon
 * is below the floor (`auth/device-secret.ts`). Each answers not found,
 * before it touches a row, where the account has the `local-agents`
 * experiment off, and every one but the
 * register where the account holds no such Mac (`agents/device-agent.ts`); a
 * register under an id another account holds writes nothing and answers
 * not found too, and a register keeps only the capabilities this service
 * knows (`DEVICE_CAPABILITY`), so a newer follower's list is never refused.
 * The live agents' read answers the ids of the account's agents pinned to
 * that Mac and not archived (`GET /api/device-agents/live-agents`), which
 * the Mac keeps and removes everything else of Luke's it holds against.
 * A held read answers what waits for that Mac (`GET /api/device-agents/lines`,
 * `GET /api/device-agents/requests`), a claim takes one row by its id, a
 * launch line's secrets with it, a line's claim asked again under the
 * token it first carried answers that line again, and a settle or an answer keeps what the
 * Mac said of a row it claimed.
 *
 * A save of an agent's state (`POST /api/device-agents/state/save`) is
 * granted one upload to a fresh path of the store (`./agent-state-blobs.ts`),
 * the grant kept, and the agent's state key, minted where it has none, and
 * its commit (`POST /api/device-agents/state/commit`) keeps what the device
 * uploaded as the agent's next generation, through the model's check-and-set
 * (`@luke/database/models/agent-state-store`), then deletes the blob of the
 * generation it replaced, which the sweep deletes in its stead where that
 * fails. Each answers not found for an agent not the account's or not
 * pinned to the device, and refuses as stale a save from a generation no
 * longer the agent's newest; a commit naming a path no upload was granted
 * for its agent is refused as invalid, and one asked again after its
 * answer was lost is answered the generation it was kept as. A deployment without a
 * store or a key ring answers both unavailable. The key travels in the
 * save's answer alone, and no log names more of a save than its generation
 * and its size.
 */

import { accountExperimentOn } from "@luke/database/models/account-store";
import {
  type AgentStateGeneration,
  commitAgentState,
  ensureAgentStateKey,
  grantAgentStateUpload,
  newestAgentState,
  pinnedAgentState,
} from "@luke/database/models/agent-state-store";
import {
  answerDeviceAgentRequest,
  claimDeviceAgentRequest,
  liveDeviceAgents,
  openDeviceAgentLaunches,
} from "@luke/database/models/device-agent-store";
import { beatDevice, registerDevice } from "@luke/database/models/device-store";
import { enrollHost, enrollOwnDevice, HOST_ENROLL_REFUSAL } from "@luke/database/models/host-store";
import { openAgentStateKey, parseKeyRing } from "@luke/database/models/provider-key-seal";
import {
  DEVICE_CAPABILITY,
  type deviceAgentStateCommitRequestSchema,
} from "@luke/features/device-agent-wire";
import { HOST_WIRE, type OwnDeviceEnrollRequest } from "@luke/features/host-wire";
import { EXPERIMENT } from "@luke/settings";
import { Clock, Effect, Option, Redacted, Result } from "effect";
import {
  admittedHostVersion,
  hostSecretHash,
  mintHostSecret,
  presentedHostVersion,
} from "../auth/device-secret.js";
import { HostedEnvironment } from "../environment.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import {
  actsForDevice,
  bearerOnlyMiddleware,
  type DeviceCaller,
  deviceMiddleware,
  hosted,
  installTokenMiddleware,
} from "../orpc/base.js";
import { AgentStateBlobs, freshAgentStatePath } from "./agent-state-blobs.js";
import {
  claimedDeviceAgentLine,
  deviceAgentDeviceOf,
  deviceAgentLinesFor,
  deviceAgentRequestsFor,
  settledDeviceAgentLine,
} from "./device-agent.js";

export interface DeviceAgentsProcedureSeams {
  /** The account behind a desktop's request, read from its bearer alone: the own enroll's caller, and a released desktop build's, refused elsewhere as needing an upgrade (`deviceMiddleware`). */
  resolveUserId: UserIdResolver;
}

const DONE = { done: true } as const;

/** The device named, where the caller may act for it (`actsForDevice`); not found otherwise. */
const ownDevice = (caller: DeviceCaller, deviceId: string) =>
  actsForDevice(caller, deviceId) ? Effect.void : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/** Not found where the account has the `local-agents` experiment off. */
const experimentOn = (userId: string) =>
  Effect.gen(function* () {
    if (!(yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.LOCAL_AGENTS)))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
  });

/** The caller's own device under its account's experiment, or not found. */
const followed = (caller: DeviceCaller, deviceId: string) =>
  Effect.gen(function* () {
    yield* ownDevice(caller, deviceId);
    const { userId } = caller;
    if (!(yield* hostedStoreOrUnavailable(deviceAgentDeviceOf(userId, deviceId)))) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
  });

/** The machine an own enroll names, all of its name, platform and architecture or none; refused as invalid where it names only some. */
const enrollingMachine = ({ name, platform, arch }: OwnDeviceEnrollRequest) => {
  if (name !== undefined && platform !== undefined && arch !== undefined) {
    return Effect.succeed({ name, platform, arch });
  }
  return name === undefined && platform === undefined && arch === undefined
    ? Effect.succeed(undefined)
    : Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
};

/** The store of agents' saved state, or unavailable where the deployment has none. */
const stateStore = Effect.gen(function* () {
  const blobs = yield* AgentStateBlobs;
  return blobs.configured ? blobs : yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
});

/** The deployment's key ring, which every agent's state key is sealed under; unavailable where it has none. */
const keyRing = Effect.gen(function* () {
  const keys = (yield* HostedEnvironment).providerKeyEncryptionKeys;
  const ring = keys === undefined ? undefined : parseKeyRing(keys);
  return ring === undefined || Result.isFailure(ring)
    ? yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)
    : ring.success;
});

/** What a commit came to: the generation it was kept as, or the refusal it is answered. */
type CommitOutcome = Result.Result<AgentStateGeneration, HostedRefusal>;

/**
 * The generation a commit was kept as, through the model's check: a stale
 * one answered the newest where that is this very save, asked again after
 * its answer was lost, since its path was fresh; refused as stale
 * otherwise, and not found for an agent not the account's on this device.
 */
const committed = (userId: string, commit: typeof deviceAgentStateCommitRequestSchema.Type) =>
  Effect.gen(function* () {
    const { agentId, fromGeneration, path, bytes, sha256, baseCommit, deviceId } = commit;
    const now = new Date(yield* Clock.currentTimeMillis);
    const kept = { agentId, fromGeneration, path, bytes, sha256, baseCommit, deviceId };
    const outcome = yield* hostedStoreOrUnavailable(
      commitAgentState(userId, kept, now).pipe(
        Effect.map((generation): CommitOutcome => Result.succeed(generation)),
        Effect.catchTag("AgentStateStale", () =>
          Effect.succeed<CommitOutcome>(Result.fail(HOSTED_REFUSAL.AGENT_STATE_STALE)),
        ),
        Effect.catchTag("AgentStateUnreachable", () =>
          Effect.succeed<CommitOutcome>(Result.fail(HOSTED_REFUSAL.NOT_FOUND)),
        ),
        Effect.catchTag("AgentStateUngranted", () =>
          Effect.succeed<CommitOutcome>(Result.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
        ),
      ),
    );
    if (Result.isSuccess(outcome)) return outcome.success;
    if (outcome.failure !== HOSTED_REFUSAL.AGENT_STATE_STALE) {
      return yield* Effect.fail(outcome.failure);
    }
    const newest = yield* hostedStoreOrUnavailable(newestAgentState(userId, agentId));
    return Option.isSome(newest) && newest.value.path === path
      ? newest.value
      : yield* Effect.fail(HOSTED_REFUSAL.AGENT_STATE_STALE);
  });

/** Kept, or not found where the account holds no such row. */
const keptOrNotFound = (kept: boolean) =>
  kept ? Effect.succeed(DONE) : Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

/** The device-agents resource: the enroll on an install token, and every other procedure on the device's bearer. */
export function deviceAgentsProcedures(seams: DeviceAgentsProcedureSeams) {
  const deviceAgents = hosted.deviceAgents.use(deviceMiddleware(seams.resolveUserId));
  // Note that each caller middleware is used on the resource rather than its procedure, so it refuses before the input is read, as every procedure's does.
  const enrolling = hosted.deviceAgents.use(installTokenMiddleware);
  const signedIn = hosted.deviceAgents.use(bearerOnlyMiddleware(seams.resolveUserId));
  return {
    enroll: enrolling.enroll.effect(function* ({ context, input }) {
      const { deviceId, ...box } = input;
      const minted = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
      const enrolled = yield* hostedStoreOrUnavailable(
        enrollHost(hostSecretHash(context.installToken), {
          id: deviceId,
          ...box,
          version: context.hostVersion,
          secretHash: minted.hash,
        }),
      );
      if ("refused" in enrolled) {
        return yield* Effect.fail(
          enrolled.refused === HOST_ENROLL_REFUSAL.STILL_ENROLLED
            ? HOSTED_REFUSAL.HOST_STILL_ENROLLED
            : HOSTED_REFUSAL.INVALID_TOKEN,
        );
      }
      return { deviceId, deviceSecret: minted.secret };
    }),
    enrollOwn: signedIn.enrollOwn.effect(function* ({ context, input }) {
      const { userId } = context;
      yield* experimentOn(userId);
      const version = yield* admittedHostVersion(presentedHostVersion(context.request));
      const minted = mintHostSecret(HOST_WIRE.DEVICE_SECRET_PREFIX);
      const machine = yield* enrollingMachine(input);
      const enrolled = yield* hostedStoreOrUnavailable(
        enrollOwnDevice(userId, {
          id: input.deviceId,
          version,
          secretHash: minted.hash,
          ...(machine === undefined ? undefined : { machine }),
        }),
      );
      if (!enrolled) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { deviceId: input.deviceId, deviceSecret: minted.secret };
    }),
    register: deviceAgents.register.effect(function* ({ context, input }) {
      yield* ownDevice(context, input.deviceId);
      const { userId } = context;
      yield* experimentOn(userId);
      const { deviceId, capabilities, ...device } = input;
      const known = Object.values(DEVICE_CAPABILITY).filter((capability) =>
        capabilities?.includes(capability),
      );
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          registerDevice(userId, { id: deviceId, ...device, capabilities: known }),
        ),
      );
    }),
    beat: deviceAgents.beat.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(beatDevice(context.userId, input.deviceId, input.signedIn)),
      );
      // Note that the launches are read after the beat is written, so a claim the device finished before it sent the beat is among them.
      const openLaunches = yield* hostedStoreOrUnavailable(
        openDeviceAgentLaunches(context.userId, input.deviceId),
      );
      return { ...DONE, openLaunches };
    }),
    liveAgents: deviceAgents.liveAgents.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const agentIds = yield* hostedStoreOrUnavailable(
        liveDeviceAgents(context.userId, input.deviceId),
      );
      return { agentIds };
    }),
    lines: deviceAgents.lines.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const lines = yield* hostedStoreOrUnavailable(
        deviceAgentLinesFor(context.userId, input.deviceId),
      );
      return { lines };
    }),
    claimLine: deviceAgents.claimLine.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const claimed = yield* hostedStoreOrUnavailable(
        claimedDeviceAgentLine(context.userId, input.deviceId, input.id, input.claimToken),
      );
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return claimed.value;
    }),
    settleLine: deviceAgents.settleLine.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          settledDeviceAgentLine(
            context.userId,
            input.deviceId,
            input.id,
            input.exitCode,
            input.refusal,
          ),
        ),
      );
    }),
    requests: deviceAgents.requests.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const requests = yield* hostedStoreOrUnavailable(
        deviceAgentRequestsFor(context.userId, input.deviceId),
      );
      return { requests };
    }),
    claimRequest: deviceAgents.claimRequest.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const claimed = yield* hostedStoreOrUnavailable(
        claimDeviceAgentRequest(context.userId, input.deviceId, input.id),
      );
      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return { request: claimed.value };
    }),
    answerRequest: deviceAgents.answerRequest.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      return yield* keptOrNotFound(
        yield* hostedStoreOrUnavailable(
          answerDeviceAgentRequest(context.userId, input.deviceId, input.id, input.answer),
        ),
      );
    }),
    saveState: deviceAgents.saveState.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const { userId } = context;
      const { agentId } = input;
      const [blobs, ring] = yield* Effect.all([stateStore, keyRing]);
      const pinned = yield* hostedStoreOrUnavailable(
        pinnedAgentState(userId, agentId, input.deviceId),
      );
      if (Option.isNone(pinned)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      // Note that a stale save is refused before its device uploads, since its commit would be refused after.
      if (pinned.value.newest !== input.fromGeneration) {
        return yield* Effect.fail(HOSTED_REFUSAL.AGENT_STATE_STALE);
      }
      const sealed = yield* hostedStoreOrUnavailable(ensureAgentStateKey(ring, userId, agentId));
      if (Option.isNone(sealed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const key = openAgentStateKey(ring, { userId, agentId }, sealed.value);
      if (Result.isFailure(key)) {
        yield* Effect.logError("an agent's state key did not open under the key ring");
        return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      }
      const path = freshAgentStatePath(agentId);
      // Note that the grant is kept before the upload is minted, so no upload stands that the sweep could not find.
      const now = new Date(yield* Clock.currentTimeMillis);
      const grant = { agentId, deviceId: input.deviceId, path };
      if (!(yield* hostedStoreOrUnavailable(grantAgentStateUpload(userId, grant, now)))) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }
      const upload = yield* blobs.mintUpload(path).pipe(
        Effect.tapError((failure) => Effect.logWarning(failure.message)),
        Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
      );
      return {
        path,
        upload: {
          url: upload.url,
          headers: upload.headers,
          expiresAt: upload.expiresAt.getTime(),
          maxBytes: upload.maxBytes,
        },
        key: Redacted.value(key.success),
      };
    }),
    commitState: deviceAgents.commitState.effect(function* ({ context, input }) {
      yield* followed(context, input.deviceId);
      const { userId } = context;
      const { agentId, fromGeneration, path } = input;
      const blobs = yield* stateStore;
      // Note that the newest is read before the commit, because once it lands this read answers the commit itself.
      const replaced = yield* hostedStoreOrUnavailable(newestAgentState(userId, agentId));
      const kept = yield* committed(userId, input);
      yield* Effect.logInfo(`kept an agent's state as generation ${kept.generation}`).pipe(
        Effect.annotateLogs({ generation: kept.generation, bytes: kept.bytes }),
      );
      // A blob whose delete fails here is the sweep's to delete, since its generation is superseded.
      const superseded = Option.filter(
        replaced,
        (generation) => generation.generation === fromGeneration && generation.path !== path,
      );
      if (Option.isSome(superseded) && kept.generation !== superseded.value.generation) {
        yield* blobs
          .remove([superseded.value.path])
          .pipe(Effect.catch((failure) => Effect.logWarning(failure.message)));
      }
      return { generation: kept.generation };
    }),
  };
}
