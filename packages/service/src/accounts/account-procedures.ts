import type { DatabaseServices } from "@repo/database/core/query";
import type {
  AccountAccessRow,
  AccountPreferencesRow,
  AccountPreferencesWrite,
  AccountPreferencesWritten,
  AccountSeamEffect,
} from "@repo/database/models/account-store";
import type { StandingSession } from "@repo/database/models/recorded-session";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import { contextWindowSchema } from "@repo/features/agent-wire";
import { CHAPTERS_MODEL_DEFAULT, isChaptersModel } from "@repo/features/chapters-model-choice";
import type { ModelChoice } from "@repo/features/models-wire";
import { AGENT_DEFAULT_CHOICE } from "@repo/features/models-wire";
import { failureKind } from "@repo/runtime/effect";
import {
  accountPreferencesFromWire,
  accountPreferencesParts,
  experimentChoicesFrom,
  NO_EXPERIMENTS,
  ownPreferenceFromWire,
} from "@repo/settings";
import type { UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, Effect, Redacted, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { isAdminRole } from "../admin/admin-access.js";
import { unconnectedProviders } from "../agents/coder-host/agent-runtime-choice.js";
import { accountModelChoices } from "../agents/coder-host/start.js";
import { retireSessions, retiringReach } from "../agents/retire-sessions.js";
import { standingSupportAccess } from "../auth/auth-policy.js";
import { HostedEnvironment } from "../environment.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { revokeIntegrationGrants } from "../integrations/integration-connect.js";
import { readIntegrationConnections } from "../integrations/integration-store.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  type AccountFastOffer,
  acceptedModelChoice,
  type ModelCatalog,
  providerModelOf,
} from "../providers/model-catalog.js";
import { forgetPosthogPersonEffect } from "../providers/posthog.js";
import { memoriesProcedures } from "./memories-procedures.js";
import { providerKeysProcedures } from "./provider-keys-procedures.js";

export interface AccountProcedureSeams {
  resolveUserId: UserIdResolver;
  standingSessions: (userId: string) => AccountSeamEffect<readonly StandingSession[]>;
  deleteUser: (userId: string) => AccountSeamEffect<void>;
  readPreferences: (userId: string) => AccountSeamEffect<AccountPreferencesRow | undefined>;
  readAccess: (userId: string) => AccountSeamEffect<AccountAccessRow>;
  accountFastOffer: (
    userId: string,
  ) => Effect.Effect<AccountFastOffer, TaskStoreFailure, DatabaseServices | ModelCatalog>;
  writePreferences: (
    userId: string,
    write: AccountPreferencesWrite,
  ) => AccountSeamEffect<AccountPreferencesWritten>;
}

const ModelChoiceSchema = Schema.Struct({
  model: Schema.String,
  effort: Schema.String,
  contextWindow: Schema.optionalKey(contextWindowSchema),
});

const readModelChoice = readEither(ModelChoiceSchema);

const snapshotAgent = (
  userId: string,
  row: AccountPreferencesRow | undefined,
): Effect.Effect<ModelChoice, never, DatabaseServices | ModelCatalog> =>
  row?.agent === undefined
    ? accountModelChoices(userId).pipe(
        Effect.map((choices) => choices.defaultChoice),
        Effect.catch(() => Effect.succeed(AGENT_DEFAULT_CHOICE)),
      )
    : Effect.succeed(row.agent);

function snapshotAnswer(row: AccountPreferencesRow | undefined, agent: ModelChoice) {
  const updatedAt = row?.updatedAt;
  return {
    ...accountPreferencesParts(row?.preferences ?? {}),
    agent,
    chaptersModel: row?.chaptersModel ?? CHAPTERS_MODEL_DEFAULT,
    experiments: row?.experiments ?? NO_EXPERIMENTS,
    ...(updatedAt === undefined ? undefined : { updatedAt: updatedAt.getTime() }),
  };
}

const forgetAnalytics = /* @__PURE__ */ Effect.fn("web/forgetAnalytics")(function* (
  userId: string,
): Effect.fn.Return<void, never, HostedEnvironment | HttpClient.HttpClient> {
  const environment = yield* HostedEnvironment;
  if (!environment.posthogPersonalApiKey || !environment.posthogProjectId) return;
  const personalApiKey = Redacted.value(environment.posthogPersonalApiKey);
  const projectId = environment.posthogProjectId;
  const host = environment.posthogApiHost;
  yield* forgetPosthogPersonEffect(userId, {
    personalApiKey,
    projectId,
    ...(host ? { host } : undefined),
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() =>
        process.stderr.write(`Analytics erasure did not complete: ${error.message}\n`),
      ),
    ),
  );
});

const acceptedAgentChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountProcedureSeams,
  userId: string,
  value: UnparsedWireValue,
): Effect.fn.Return<ModelChoice, HostedRefusal, ModelCatalog | DatabaseServices> {
  const read = readModelChoice(value);
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const fastOffer = yield* hostedStoreOrUnavailable(seams.accountFastOffer(userId));
  const accepted = yield* acceptedModelChoice(read.success, fastOffer).pipe(
    Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
    Effect.catchTag("ModelCatalogUnavailable", (unavailable) =>
      Effect.logWarning(
        `the model catalog could not be read: ${failureKind(unavailable.cause)}`,
      ).pipe(Effect.andThen(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE))),
    ),
  );
  const row = yield* hostedStoreOrUnavailable(seams.readPreferences(userId));
  const standing = yield* snapshotAgent(userId, row);
  if (accepted.model === standing.model) return accepted;
  const unconnected = yield* hostedStoreOrUnavailable(unconnectedProviders(userId));
  const provider = providerModelOf(accepted.model)?.provider;
  if (provider !== undefined && unconnected.has(provider)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return accepted;
});

export function accountProcedures(seams: AccountProcedureSeams) {
  const signedIn = hosted.account.use(accountMiddleware(seams.resolveUserId));
  return {
    delete: signedIn.delete.effect(function* ({ context }) {
      const { userId } = context;
      const retiring = yield* retiringReach(userId);
      const sessions = yield* hostedStoreOrUnavailable(seams.standingSessions(userId));
      yield* retireSessions(retiring, sessions);
      yield* forgetAnalytics(userId);
      const grants = yield* hostedStoreOrUnavailable(readIntegrationConnections(userId));
      yield* hostedStoreOrUnavailable(seams.deleteUser(userId));
      yield* revokeIntegrationGrants(userId, grants);
      return { deleted: true } as const;
    }),

    preferences: signedIn.preferences.effect(function* ({ context }) {
      const row = yield* hostedStoreOrUnavailable(seams.readPreferences(context.userId));
      return snapshotAnswer(row, yield* snapshotAgent(context.userId, row));
    }),

    access: signedIn.access.effect(function* ({ context }) {
      const access = yield* hostedStoreOrUnavailable(seams.readAccess(context.userId));
      const now = yield* Clock.currentTimeMillis;
      return {
        admin: isAdminRole(access.role),
        supportAccessUntil: standingSupportAccess(access.supportAccessUntil, now),
      };
    }),

    writePreferences: signedIn.writePreferences.effect(function* ({ context, input }) {
      const body = input as Readonly<Record<keyof typeof input, UnparsedWireValue>>;
      if (
        body.preferences === undefined &&
        body.linkOpen === undefined &&
        body.agentEnter === undefined &&
        body.commitAuthor === undefined &&
        body.setupFinished === undefined &&
        body.setupPlace === undefined &&
        body.agent === undefined &&
        body.chaptersModel === undefined &&
        body.experiments === undefined
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }

      const write: AccountPreferencesWrite = {};
      if (body.preferences !== undefined) {
        const preferences = accountPreferencesFromWire(body.preferences);
        if (preferences === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
        write.preferences = preferences;
      }
      if (body.linkOpen !== undefined) {
        const linkOpen = ownPreferenceFromWire("linkOpen", body.linkOpen);
        if (linkOpen === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
        write.linkOpen = linkOpen;
      }
      if (body.agentEnter !== undefined) {
        const agentEnter = ownPreferenceFromWire("agentEnter", body.agentEnter);
        if (agentEnter === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
        write.agentEnter = agentEnter;
      }
      if (body.commitAuthor !== undefined) {
        const commitAuthor = ownPreferenceFromWire("commitAuthor", body.commitAuthor);
        if (commitAuthor === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
        write.commitAuthor = commitAuthor;
      }
      if (body.setupFinished !== undefined) {
        const setupFinished = ownPreferenceFromWire("setupFinished", body.setupFinished);
        if (setupFinished === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
        write.setupFinished = setupFinished;
      }
      if (body.setupPlace !== undefined) {
        const setupPlace = ownPreferenceFromWire("setupPlace", body.setupPlace);
        if (setupPlace === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
        write.setupPlace = setupPlace;
      }
      if (body.agent !== undefined) {
        write.agent = yield* acceptedAgentChoice(seams, context.userId, body.agent);
      }
      if (body.chaptersModel !== undefined) {
        if (!isChaptersModel(body.chaptersModel)) {
          return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
        }
        write.chaptersModel = body.chaptersModel;
      }
      if (body.experiments !== undefined) {
        const experiments = experimentChoicesFrom(body.experiments);
        if (experiments === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
        write.experiments = experiments;
      }

      const row = yield* hostedStoreOrUnavailable(seams.writePreferences(context.userId, write));
      return { ...snapshotAnswer(row, yield* snapshotAgent(context.userId, row)), txid: row.txid };
    }),

    ...providerKeysProcedures(seams),
    ...memoriesProcedures(seams),
  };
}
