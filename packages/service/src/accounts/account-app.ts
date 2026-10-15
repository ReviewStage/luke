import type { DatabaseServices } from "@luke/database/core/query";
import type {
  AccountPreferencesRow,
  AccountPreferencesWrite,
  AccountSeamEffect,
} from "@luke/database/models/account-store";
import type { PlanStoreFailure } from "@luke/database/models/plan-store";
import type { StandingSession } from "@luke/database/models/recorded-session";
import { contextWindowSchema } from "@luke/features/coding-agent-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import { CODING_AGENT_DEFAULT_CHOICE } from "@luke/features/models-wire";
import {
  DEFAULT_PLAN_TEMPLATE,
  PLAN_TEMPLATE_BOUNDS,
  type PlanTemplateAnswer,
  type PlanTemplateRevisionAnswer,
  type PlanTemplateRevisionsAnswer,
  planTemplateWriteRequestSchema,
} from "@luke/features/plan-document-template";
import { planRevisionSeqSchema } from "@luke/features/plan-wire";
import type { FastAccess } from "@luke/features/provider-key-wire";
import { failureKind } from "@luke/runtime/effect";
import { accountPreferencesFromWire, experimentChoicesFrom, NO_EXPERIMENTS } from "@luke/settings";
import { isRecord, type UnparsedWireValue, unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { type EveReach, eveFor } from "../agents/coder-host/stop.js";
import { retireSessions } from "../agents/retire-sessions.js";
import { HostedEnvironment } from "../environment.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedMethod,
  hostedNotFoundRoute,
  hostedRefusalResponse,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import {
  type IntegrationConnect,
  revokeIntegrationGrants,
} from "../integrations/integration-connect.js";
import { readIntegrationConnections } from "../integrations/integration-store.js";
import { acceptedModelChoice, type ModelCatalog } from "../providers/model-catalog.js";
import { forgetPosthogPersonEffect } from "../providers/posthog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";

/**
 * The account group: the signed-in desktop's own delete, preferences, and
 * plan template endpoints. Each resolves the same bearer against the
 * deployment's own account store before touching anything, and answers
 * nothing about any account but the one the bearer names — root AGENTS.md
 * pins that no credential or account secret ever travels in an answer, so
 * what each endpoint answers is a boolean or the caller's own stored value,
 * never a token or a session id.
 *
 * The preferences snapshot is three parts: the settings preferences the
 * desktop syncs, the coding agents' default model, effort, and context
 * window beside them, which Settings and the Start menu both write, and the
 * experiments the account turned on in Settings › Experimental. A write
 * carries any of them, a coding-agent choice is accepted only as the
 * catalog accepts it (`packages/service/src/providers/model-catalog.ts`), so what is stored is
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
 * as a revision of its own, all under the bearer's account alone.
 */

const ACCOUNT_PATH = {
  DELETE: "/api/account/delete",
  PREFERENCES: "/api/account/preferences",
  PLAN_TEMPLATE: "/api/account/plan-template",
  /** GET reads a page of the template's history, before the revision `before` names where it names one. */
  PLAN_TEMPLATE_REVISIONS: "/api/account/plan-template/revisions",
  /** GET reads one revision beside the one before it; the rewrite moves the path's number into the `seq` query. */
  PLAN_TEMPLATE_REVISION: "/api/account/plan-template/revision",
  /** POST restores one revision as the template; the rewrite moves the path's number into the `seq` query. */
  PLAN_TEMPLATE_RESTORE: "/api/account/plan-template/restore",
} as const;

/** The queries naming a revision of the template: the one an older page is read before, and the one a path names. */
const REVISION_QUERY = {
  BEFORE: "before",
  SEQ: "seq",
} as const;

/** A template write is the template at its bound with every character escaped, and the key around it. */
const MAXIMUM_PLAN_TEMPLATE_BODY_BYTES = PLAN_TEMPLATE_BOUNDS.MAX_CHARS * 6 + 1_024;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
} as const;

export interface AccountAppSeams extends EveReach {
  resolveUserId: UserIdResolver;
  /** The eve sessions the account's standing conversations run in, which the delete retires first. */
  standingSessions: (userId: string) => AccountSeamEffect<readonly StandingSession[]>;
  /** Deletes the user row, every dependent row cascading with it, and queues the sandboxes of every session the account ran. */
  deleteUser: (userId: string) => AccountSeamEffect<void>;
  readPreferences: (userId: string) => AccountSeamEffect<AccountPreferencesRow | undefined>;
  /** Whether the Anthropic key the account's agents run on may run fast mode, by which its coding-agent choice may name a fast version (`offeredToAccount`). */
  anthropicFastAccess: (
    userId: string,
  ) => Effect.Effect<FastAccess | undefined, PlanStoreFailure, DatabaseServices | ModelCatalog>;
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

/** The snapshot as the group answers it, the preferences' instant beside it where the preferences were ever written. */
function snapshotAnswer(row: AccountPreferencesRow | undefined) {
  const updatedAt = row?.updatedAt;
  return {
    preferences: row?.preferences ?? {},
    codingAgent: row?.codingAgent ?? CODING_AGENT_DEFAULT_CHOICE,
    experiments: row?.experiments ?? NO_EXPERIMENTS,
    ...(updatedAt === undefined ? undefined : { updatedAt: updatedAt.getTime() }),
  };
}

/** The bearer resolved against the deployment's own account store, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountAppSeams,
): Effect.fn.Return<string, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

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
 * POST: erases the signed-in desktop's account. The bearer token is the
 * whole authority, so nothing a caller sends can choose a different account
 * to erase. Where the deployment can, the analytics person is asked to be
 * erased first, because nothing after the delete would still name it; a
 * refusal or an outage there must not hold up the delete, so it is logged as
 * a status and the delete proceeds. Every eve session the account's
 * standing conversations run in is retired before anything is deleted, as
 * the developer, while eve's door still admits them to it
 * (`retire-sessions.ts`); a session eve did not retire is logged and the
 * delete proceeds, and the delete itself queues the sandbox of every session
 * the account ran for the sweep. Every grant the account's integration rows
 * name is revoked at Vercel Connect once the rows are gone, as a Disconnect
 * revokes one, so no grant outlives the account; a revoke that fails is logged by its
 * word and the account is deleted all the same.
 */
const accountDeleteEndpoint = /* @__PURE__ */ Effect.fn("web/accountDeleteEndpoint")(function* (
  seams: AccountAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  | HostedEnvironment
  | HttpClient.HttpClient
  | DatabaseServices
  | IntegrationConnect
  | HttpServerRequest.HttpServerRequest
> {
  yield* hostedMethod(HTTP_METHOD.POST);
  const userId = yield* resolvedUserId(seams);
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const sessions = yield* hostedStoreOrUnavailable(seams.standingSessions(userId));
  yield* retireSessions((mount) => eveFor(seams, request, mount), sessions);
  yield* forgetAnalytics(userId);
  // Note that the grants are read before the delete, because an added account's subject is no id the account still names after it.
  const grants = yield* hostedStoreOrUnavailable(readIntegrationConnections(userId));
  yield* hostedStoreOrUnavailable(seams.deleteUser(userId));
  yield* revokeIntegrationGrants(userId, grants);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted: true });
});

/** GET: the caller's own stored snapshot, or the defaults for a user with none stored. */
const preferencesReadEndpoint = /* @__PURE__ */ Effect.fn("web/preferencesReadEndpoint")(function* (
  seams: AccountAppSeams,
): Effect.fn.Return<
  ReturnType<typeof hostedJsonResponse>,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  const userId = yield* resolvedUserId(seams);
  const row = yield* hostedStoreOrUnavailable(seams.readPreferences(userId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, snapshotAnswer(row));
});

/**
 * The write's coding-agent part, as the catalog accepts it for the
 * account (`offeredToAccount`): a choice it does not offer is a bad request, and a catalog the instance
 * cannot read is an outage the caller may retry.
 */
const acceptedCodingAgent = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountAppSeams,
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

/**
 * PUT: writes each part the body carries — `preferences`, a validated
 * settings snapshot that replaces the stored one whole, `codingAgent`, a
 * choice the catalog accepts, and `experiments`, each experiment's on or
 * off merged over what stood — and answers the snapshot as it then stands.
 * A body carrying none of them asks for nothing and is refused.
 */
const preferencesWriteEndpoint = /* @__PURE__ */ Effect.fn("web/preferencesWriteEndpoint")(
  function* (
    seams: AccountAppSeams,
  ): Effect.fn.Return<
    ReturnType<typeof hostedJsonResponse>,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices | ModelCatalog
  > {
    const userId = yield* resolvedUserId(seams);
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    const parsed = yield* incoming.json.pipe(Effect.mapError(() => HOSTED_REFUSAL.INVALID_REQUEST));
    // SAFETY: Request JSON is untrusted boundary data; each part's reader validates it before use.
    const body = parsed as UnparsedWireValue;
    if (!isRecord(body)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    if (
      body.preferences === undefined &&
      body.codingAgent === undefined &&
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
    if (body.codingAgent !== undefined) {
      write.codingAgent = yield* acceptedCodingAgent(seams, userId, body.codingAgent);
    }
    if (body.experiments !== undefined) {
      const experiments = experimentChoicesFrom(body.experiments);
      if (experiments === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      write.experiments = experiments;
    }

    const row = yield* hostedStoreOrUnavailable(seams.writePreferences(userId, write));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, snapshotAnswer(row));
  },
);

/** GET or PUT on the same path; any other method is the same refusal the two branches would answer separately. */
const accountPreferencesEndpoint = /* @__PURE__ */ Effect.fn("web/accountPreferencesEndpoint")(
  function* (
    seams: AccountAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    DatabaseServices | HttpServerRequest.HttpServerRequest | ModelCatalog
  > {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method === HTTP_METHOD.GET) return yield* preferencesReadEndpoint(seams);
    if (incoming.method === HTTP_METHOD.PUT) return yield* preferencesWriteEndpoint(seams);
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  },
);

/** The template as the group answers it: the account's own, or the default where it holds none. */
function planTemplateAnswer(stored: string | null): PlanTemplateAnswer {
  return { template: stored ?? DEFAULT_PLAN_TEMPLATE, custom: stored !== null };
}

/** GET: the caller's own template, or the default for an account that kept none. */
const planTemplateReadEndpoint = /* @__PURE__ */ Effect.fn("web/planTemplateReadEndpoint")(
  function* (
    seams: AccountAppSeams,
  ): Effect.fn.Return<
    ReturnType<typeof hostedJsonResponse>,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices
  > {
    const userId = yield* resolvedUserId(seams);
    const stored = yield* hostedStoreOrUnavailable(seams.readPlanTemplate(userId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, planTemplateAnswer(stored));
  },
);

/**
 * PUT: keeps the body's template verbatim, untrimmed and possibly empty, or
 * goes back to the default on null, and answers the template as it then
 * stands. A body naming any other key, or a template past the bound, is
 * refused and nothing is written.
 */
const planTemplateWriteEndpoint = /* @__PURE__ */ Effect.fn("web/planTemplateWriteEndpoint")(
  function* (
    seams: AccountAppSeams,
  ): Effect.fn.Return<
    ReturnType<typeof hostedJsonResponse>,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices
  > {
    const userId = yield* resolvedUserId(seams);
    const body = yield* readJsonBodyEffect(MAXIMUM_PLAN_TEMPLATE_BODY_BYTES);
    const asked = readEither(planTemplateWriteRequestSchema)(body);
    if (Result.isFailure(asked)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    const stored = yield* hostedStoreOrUnavailable(
      seams.writePlanTemplate(userId, asked.success.template),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, planTemplateAnswer(stored));
  },
);

/** GET or PUT on the template's path; any other method is refused. */
const accountPlanTemplateEndpoint = /* @__PURE__ */ Effect.fn("web/accountPlanTemplateEndpoint")(
  function* (
    seams: AccountAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    DatabaseServices | HttpServerRequest.HttpServerRequest
  > {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method === HTTP_METHOD.GET) return yield* planTemplateReadEndpoint(seams);
    if (incoming.method === HTTP_METHOD.PUT) return yield* planTemplateWriteEndpoint(seams);
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  },
);

/**
 * The revision number the query `name` holds, named once, or nothing where
 * it is absent. A number that is not a whole number from one names no
 * revision, and is refused as a request that does not read.
 */
const revisionSeqOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  name: string,
): Effect.fn.Return<number | undefined, HostedRefusal, HttpServerRequest.HttpServerRequest> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const named = new URL(request.url).searchParams.getAll(name);
  const [seq] = named;
  if (seq === undefined) return undefined;
  const read = readEither(planRevisionSeqSchema)(unparsedWire(Number(seq)));
  if (named.length !== 1 || Result.isFailure(read)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return read.success;
});

/** The revision the path names, which a revision's routes cannot do without. */
const namedRevisionOf = /* @__PURE__ */ Effect.fnUntraced(function* (): Effect.fn.Return<
  number,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest
> {
  const seq = yield* revisionSeqOf(REVISION_QUERY.SEQ);
  if (seq === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return seq;
});

/** GET reads a page of the caller's template history, the newest first; an account with none answers an empty page. */
const planTemplateRevisionsEndpoint = /* @__PURE__ */ Effect.fn(
  "web/planTemplateRevisionsEndpoint",
)(function* (
  seams: AccountAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  yield* hostedMethod(HTTP_METHOD.GET);
  const userId = yield* resolvedUserId(seams);
  const before = yield* revisionSeqOf(REVISION_QUERY.BEFORE);
  const page = yield* hostedStoreOrUnavailable(seams.listPlanTemplateRevisions(userId, before));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/** GET reads one revision of the caller's template beside the one before it. */
const planTemplateRevisionEndpoint = /* @__PURE__ */ Effect.fn("web/planTemplateRevisionEndpoint")(
  function* (
    seams: AccountAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices
  > {
    yield* hostedMethod(HTTP_METHOD.GET);
    const seq = yield* namedRevisionOf();
    const userId = yield* resolvedUserId(seams);
    const revision = yield* hostedStoreOrUnavailable(seams.readPlanTemplateRevision(userId, seq));
    if (Option.isNone(revision)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { revision: revision.value });
  },
);

/**
 * POST puts one revision back as the caller's template, a revision of its
 * own naming it, and answers the template as a write does. It names nothing
 * in a body: the revision is the path's.
 */
const planTemplateRestoreEndpoint = /* @__PURE__ */ Effect.fn("web/planTemplateRestoreEndpoint")(
  function* (
    seams: AccountAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices
  > {
    yield* hostedMethod(HTTP_METHOD.POST);
    const seq = yield* namedRevisionOf();
    const userId = yield* resolvedUserId(seams);
    const restored = yield* hostedStoreOrUnavailable(seams.restorePlanTemplate(userId, seq));
    if (Option.isNone(restored)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, planTemplateAnswer(restored.value));
  },
);

/**
 * An endpoint's refusal carried back onto the answer channel. A refusal is
 * failed with rather than returned, so an endpoint's steps read as the early
 * returns they are; a route answers on one channel, so the group makes the
 * two one before it registers the path.
 */
function refusing<R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return Effect.catch(endpoint, (refusal) => Effect.succeed(hostedRefusalResponse(refusal)));
}

/**
 * The group: the account endpoints on their own paths, and the hosted
 * vocabulary's own refusal for a method the matched path does not answer or a
 * path the group declares no route for.
 */
export function accountApp(
  seams: AccountAppSeams,
): WebRoutes<
  HostedEnvironment | HttpClient.HttpClient | DatabaseServices | ModelCatalog | IntegrationConnect
> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, ACCOUNT_PATH.DELETE, refusing(accountDeleteEndpoint(seams))),
    HttpRouter.add(
      ANY_METHOD,
      ACCOUNT_PATH.PREFERENCES,
      refusing(accountPreferencesEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      ACCOUNT_PATH.PLAN_TEMPLATE,
      refusing(accountPlanTemplateEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      ACCOUNT_PATH.PLAN_TEMPLATE_REVISIONS,
      refusing(planTemplateRevisionsEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      ACCOUNT_PATH.PLAN_TEMPLATE_REVISION,
      refusing(planTemplateRevisionEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      ACCOUNT_PATH.PLAN_TEMPLATE_RESTORE,
      refusing(planTemplateRestoreEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
