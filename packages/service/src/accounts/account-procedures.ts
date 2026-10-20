/**
 * account-procedures.ts -- the signed-in account's own procedures: its deletion, its preferences, its access, its plan template, and its provider keys.
 *
 * Each resolves the caller before touching anything, and answers nothing
 * about any account but the one the caller is: root AGENTS.md pins that no
 * credential or account secret ever travels in an answer, so what each
 * answers is a boolean or the caller's own stored value, never a token or
 * a session id. The caller is resolved on the resource itself, before any
 * input is read, so an unsigned caller is refused as unsigned whatever it
 * sent; but for a revision's two procedures, which read the revision their
 * path names first, as they always did.
 *
 * The preferences snapshot is five parts: the settings preferences the
 * desktop syncs, where the account's Luke links open, a synced setting of
 * its own part so a build that predates it neither refuses the snapshot nor
 * clears the choice by writing the shared part back whole, the coding
 * agents' default model, effort, and context window, which Settings and the
 * Start menu both write, the Claude model the account's Generate chapters
 * runs on, one of a fixed set (`@luke/features/chapters-model-choice`), and the experiments the account turned on in
 * Settings › Experimental. A write carries any of them, a coding-agent
 * choice is accepted only as the catalog accepts it
 * (`packages/service/src/providers/model-catalog.ts`), so what is stored is
 * always a choice a Start could run, and the experiments are a patch read
 * as tolerantly as they are answered: a key this deployment does not list
 * is passed over rather than refused, because it is an older or newer
 * build's experiment and refusing it would refuse the build's every other
 * choice too.
 *
 * The plan template is a path of its own rather than a third part of the
 * snapshot, because the desktop syncs the snapshot and applies it over its
 * own settings, and a twenty-thousand-character text has no place in that
 * loop. It is kept verbatim, and null stands for the built-in default.
 * Every write that changes it is kept as a revision, which its history
 * reads a page at a time and one at a time, and which a restore puts back
 * as a revision of its own, all under the caller's account alone.
 *
 * The access is whether the caller is an admin, read off its own role, so a
 * client can offer the admin dashboard to the account that may open it. It
 * says nothing of any other account and authorizes nothing: the dashboard's
 * own gate (`admin/gate.ts`) decides every admin read on its own.
 *
 * The provider keys are `provider-keys-procedures.ts`'s.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import type {
  AccountPreferencesRow,
  AccountPreferencesWrite,
  AccountSeamEffect,
} from "@luke/database/models/account-store";
import type { StandingSession } from "@luke/database/models/recorded-session";
import type { TaskStoreFailure } from "@luke/database/models/task-store";
import { CHAPTERS_MODEL_DEFAULT, isChaptersModel } from "@luke/features/chapters-model-choice";
import { contextWindowSchema } from "@luke/features/coding-agent-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import { CODING_AGENT_DEFAULT_CHOICE } from "@luke/features/models-wire";
import {
  DEFAULT_PLAN_TEMPLATE,
  type PlanTemplateAnswer,
  type PlanTemplateRevisionAnswer,
  type PlanTemplateRevisionsAnswer,
} from "@luke/features/plan-document-template";
import type { FastAccess } from "@luke/features/provider-key-wire";
import { failureKind } from "@luke/runtime/effect";
import {
  accountPreferencesFromWire,
  accountPreferencesParts,
  experimentChoicesFrom,
  linkOpenFromWire,
  NO_EXPERIMENTS,
} from "@luke/settings";
import type { UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Option, Redacted, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { isAdminRole } from "../admin/admin-access.js";
import type { EveReach } from "../agents/coder-host/stop.js";
import { retireSessions, retiringReach } from "../agents/retire-sessions.js";
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
import { acceptedModelChoice, type ModelCatalog } from "../providers/model-catalog.js";
import { forgetPosthogPersonEffect } from "../providers/posthog.js";
import { providerKeysProcedures } from "./provider-keys-procedures.js";

export interface AccountProcedureSeams extends EveReach {
  resolveUserId: UserIdResolver;
  /** The eve sessions the account's standing conversations run in, which the delete retires first. */
  standingSessions: (userId: string) => AccountSeamEffect<readonly StandingSession[]>;
  /** Deletes the user row, every dependent row cascading with it, and queues the sandboxes of every session the account ran. */
  deleteUser: (userId: string) => AccountSeamEffect<void>;
  readPreferences: (userId: string) => AccountSeamEffect<AccountPreferencesRow | undefined>;
  /** The role on the account's own row, as Better Auth stores it; nothing where it holds none. */
  readRole: (userId: string) => AccountSeamEffect<string | undefined>;
  /** Whether the Anthropic key the account's agents run on may run fast mode, by which its coding-agent choice may name a fast version (`offeredToAccount`). */
  anthropicFastAccess: (
    userId: string,
  ) => Effect.Effect<FastAccess | undefined, TaskStoreFailure, DatabaseServices | ModelCatalog>;
  /** Writes each part the write carries and answers the snapshot as it then stands. */
  writePreferences: (
    userId: string,
    write: AccountPreferencesWrite,
  ) => AccountSeamEffect<AccountPreferencesRow>;
  /** The account's own template, or null where it holds the default. */
  readPlanTemplate: (userId: string) => AccountSeamEffect<string | null>;
  /** Keeps the template verbatim, or null for the default, and answers what is then kept. */
  writePlanTemplate: (userId: string, template: string | null) => AccountSeamEffect<string | null>;
  /** A page of the template's revisions, the newest first, before the one `before` names where it names one. */
  listPlanTemplateRevisions: (
    userId: string,
    before?: number,
  ) => AccountSeamEffect<PlanTemplateRevisionsAnswer>;
  /** One revision beside the one before it; nothing where the account has no such revision. */
  readPlanTemplateRevision: (
    userId: string,
    seq: number,
  ) => AccountSeamEffect<Option.Option<PlanTemplateRevisionAnswer["revision"]>>;
  /** Puts one revision back as the template and answers what is then kept; nothing where the account has no such revision. */
  restorePlanTemplate: (
    userId: string,
    seq: number,
  ) => AccountSeamEffect<Option.Option<string | null>>;
}

/** A coding-agent choice as a write names it; the catalog decides whether it is one. */
const ModelChoiceSchema = Schema.Struct({
  model: Schema.String,
  effort: Schema.String,
  contextWindow: Schema.optionalKey(contextWindowSchema),
});

const readModelChoice = readEither(ModelChoiceSchema);

/**
 * The snapshot as the account answers it, the preferences' instant beside
 * it where the preferences were ever written, and the link choice as a part
 * of its own where the account made one.
 */
function snapshotAnswer(row: AccountPreferencesRow | undefined) {
  const updatedAt = row?.updatedAt;
  return {
    ...accountPreferencesParts(row?.preferences ?? {}),
    codingAgent: row?.codingAgent ?? CODING_AGENT_DEFAULT_CHOICE,
    chaptersModel: row?.chaptersModel ?? CHAPTERS_MODEL_DEFAULT,
    experiments: row?.experiments ?? NO_EXPERIMENTS,
    ...(updatedAt === undefined ? undefined : { updatedAt: updatedAt.getTime() }),
  };
}

/** The template as the account answers it: its own, or the default where it holds none. */
function planTemplateAnswer(stored: string | null): PlanTemplateAnswer {
  return { template: stored ?? DEFAULT_PLAN_TEMPLATE, custom: stored !== null };
}

/**
 * Without both halves of the analytics configuration there is no person to
 * erase and nothing to erase it with, so the erasure is simply skipped.
 */
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

/**
 * The write's coding-agent part, as the catalog accepts it for the
 * account (`offeredToAccount`): a choice it does not offer is a bad request, and a catalog the instance
 * cannot read is an outage the caller may retry.
 */
const acceptedCodingAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountProcedureSeams,
  userId: string,
  value: UnparsedWireValue,
): Effect.fn.Return<ModelChoice, HostedRefusal, ModelCatalog | DatabaseServices> {
  const read = readModelChoice(value);
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const fastAccess = yield* hostedStoreOrUnavailable(seams.anthropicFastAccess(userId));
  return yield* acceptedModelChoice(read.success, fastAccess).pipe(
    Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
    Effect.catchTag("ModelCatalogUnavailable", (unavailable) =>
      Effect.logWarning(
        `the model catalog could not be read: ${failureKind(unavailable.cause)}`,
      ).pipe(Effect.andThen(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE))),
    ),
  );
});

/** The account resource: every procedure but the provider keys' own, which are `provider-keys-procedures.ts`'s. */
export function accountProcedures(seams: AccountProcedureSeams) {
  const signedIn = hosted.account.use(accountMiddleware(seams.resolveUserId));
  return {
    /**
     * Erases the signed-in account. The caller's bearer, or for a request
     * that carries none the browser's session cookie, is the whole
     * authority, so nothing a caller sends can choose a different account
     * to erase. Where the deployment can, the analytics person is asked to
     * be erased first, because nothing after the delete would still name
     * it; a refusal or an outage there must not hold up the delete, so it
     * is logged as a status and the delete proceeds. Every eve session the
     * account's standing conversations run in is retired before anything is
     * deleted, as the request's own caller (`coder-host/stop.ts`'s
     * `eveFor`: over the bearer, or as the deployment acting for the
     * account the cookie named), while eve's door still admits them to it
     * (`retire-sessions.ts`); a session eve did not retire is logged and the
     * delete proceeds, though a cookie's deletion on a deployment that
     * cannot reach eve as itself is refused as unavailable before anything
     * is erased (`retiringReach`); the delete itself queues the sandbox of
     * every session the account ran for the sweep. Every grant the
     * account's integration rows name is revoked at Vercel Connect once the
     * rows are gone, as a Disconnect revokes one, so no grant outlives the
     * account; a revoke that fails is logged by its word and the account is
     * deleted all the same.
     */
    delete: signedIn.delete.effect(function* ({ context }) {
      const { userId } = context;
      const eveAt = yield* retiringReach(seams, context.request, userId);
      const sessions = yield* hostedStoreOrUnavailable(seams.standingSessions(userId));
      yield* retireSessions(eveAt, sessions);
      yield* forgetAnalytics(userId);
      // Note that the grants are read before the delete, because an added account's subject is no id the account still names after it.
      const grants = yield* hostedStoreOrUnavailable(readIntegrationConnections(userId));
      yield* hostedStoreOrUnavailable(seams.deleteUser(userId));
      yield* revokeIntegrationGrants(userId, grants);
      return { deleted: true } as const;
    }),

    /** The caller's own stored snapshot, or the defaults for a user with none stored. */
    preferences: signedIn.preferences.effect(function* ({ context }) {
      const row = yield* hostedStoreOrUnavailable(seams.readPreferences(context.userId));
      return snapshotAnswer(row);
    }),

    /** Whether the caller's own account is an admin; any role but the admin role is not. */
    access: signedIn.access.effect(function* ({ context }) {
      const role = yield* hostedStoreOrUnavailable(seams.readRole(context.userId));
      return { admin: isAdminRole(role) };
    }),

    /**
     * Writes each part the body carries — `preferences`, a validated
     * settings snapshot that replaces the stored one whole, `linkOpen`,
     * where the account's links open, `codingAgent`, a choice the catalog
     * accepts, `chaptersModel`, one of the chapters' fixed set, and `experiments`, each experiment's on or off merged over
     * what stood — and answers the snapshot as it then stands. A body
     * carrying none of them asks for nothing and is refused.
     */
    writePreferences: signedIn.writePreferences.effect(function* ({ context, input }) {
      // SAFETY: Request JSON is untrusted boundary data; each part's reader validates it before use.
      const body = input as Readonly<Record<keyof typeof input, UnparsedWireValue>>;
      if (
        body.preferences === undefined &&
        body.linkOpen === undefined &&
        body.codingAgent === undefined &&
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
        const linkOpen = linkOpenFromWire(body.linkOpen);
        if (linkOpen === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
        write.linkOpen = linkOpen;
      }
      if (body.codingAgent !== undefined) {
        write.codingAgent = yield* acceptedCodingAgent(seams, context.userId, body.codingAgent);
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
      return snapshotAnswer(row);
    }),

    /** The caller's own template, or the default for an account that kept none. */
    planTemplate: signedIn.planTemplate.effect(function* ({ context }) {
      const stored = yield* hostedStoreOrUnavailable(seams.readPlanTemplate(context.userId));
      return planTemplateAnswer(stored);
    }),

    /**
     * Keeps the body's template verbatim, untrimmed and possibly empty, or
     * goes back to the default on null, and answers the template as it then
     * stands. A body naming any other key, or a template past the bound, is
     * refused and nothing is written.
     */
    writePlanTemplate: signedIn.writePlanTemplate.effect(function* ({ context, input }) {
      const stored = yield* hostedStoreOrUnavailable(
        seams.writePlanTemplate(context.userId, input.template),
      );
      return planTemplateAnswer(stored);
    }),

    /** A page of the caller's template history, the newest first; an account with none answers an empty page. */
    planTemplateRevisions: signedIn.planTemplateRevisions.effect(function* ({ context, input }) {
      return yield* hostedStoreOrUnavailable(
        seams.listPlanTemplateRevisions(context.userId, input.before),
      );
    }),

    /** One revision of the caller's template beside the one before it. */
    planTemplateRevision: hosted.account.planTemplateRevision
      .use(accountMiddleware(seams.resolveUserId))
      .effect(function* ({ context, input }) {
        const revision = yield* hostedStoreOrUnavailable(
          seams.readPlanTemplateRevision(context.userId, input.seq),
        );
        if (Option.isNone(revision)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        return { revision: revision.value };
      }),

    /**
     * Puts one revision back as the caller's template, a revision of its
     * own naming it, and answers the template as a write does. It names
     * nothing in a body: the revision is the path's.
     */
    restorePlanTemplate: hosted.account.restorePlanTemplate
      .use(accountMiddleware(seams.resolveUserId))
      .effect(function* ({ context, input }) {
        const restored = yield* hostedStoreOrUnavailable(
          seams.restorePlanTemplate(context.userId, input.seq),
        );
        if (Option.isNone(restored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        return planTemplateAnswer(restored.value);
      }),

    ...providerKeysProcedures(seams),
  };
}
