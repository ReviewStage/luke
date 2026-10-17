import type { DatabaseServices } from "@luke/database/core/query";
import {
  type KeyRing,
  openEnvironmentValue,
  sealEnvironmentValue,
} from "@luke/database/models/provider-key-seal";
import {
  listWorkspaceEnvironmentRows,
  removeWorkspaceEnvironmentValue,
  saveWorkspaceEnvironmentValue,
  sealedOf,
  type WorkspaceEnvironmentRow,
} from "@luke/database/models/workspace-environment-store";
import { type Workspace, workspaceOf } from "@luke/database/models/workspace-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import {
  WORKSPACE_ENVIRONMENT_BOUNDS,
  WORKSPACE_ENVIRONMENT_KIND,
  WORKSPACE_ENVIRONMENT_REJECTION,
  type WorkspaceEnvironmentAnswer,
  type WorkspaceEnvironmentEntry,
  type WorkspaceEnvironmentKind,
  workspaceEnvironmentListRequestSchema,
  workspaceEnvironmentRemoveRequestSchema,
  workspaceEnvironmentSaveRequestSchema,
} from "@luke/features/workspace-environment-wire";
import { managesWorkspace } from "@luke/features/workspace-role";
import { readEither } from "@luke/wire/effect";
import { DateTime, Effect, Layer, Option, Redacted, Result, type Schema } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import type { HostedEnvironment } from "../environment.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { keyRingOrUnavailable } from "./key-ring.js";

/**
 * workspace-environment-app.ts -- a workspace's environment variables and secrets: read them, save one, remove one.
 *
 * Three endpoints the signed-in desktop calls with its bearer, each a POST
 * naming the workspace in its body (`workspace-environment-wire.ts`):
 *
 * - `POST /api/workspaces/environment` takes any member, and answers the
 *   list: a variable with its value, a secret by its hint alone.
 * - `POST /api/workspaces/environment/save` takes an owner or admin, seals
 *   the value under the deployment's ring whatever its kind, and keeps it
 *   under the name, replacing what the name held.
 * - `POST /api/workspaces/environment/remove` takes an owner or admin.
 *
 * Every answer is the list as it then stands. The one body that holds a
 * secret's value is the save's own; it is sealed the moment it is read and
 * never logged. A value the ring can no longer open answers unreadable, and
 * reaches no sandbox (`agents/coder-host/workspace-environment.ts`) until it
 * is saved again. A workspace the account is not in is not found, whatever
 * it asked; a deployment holding no ring answers unavailable.
 */

/** The most a request body may hold: a workspace id, a name, and a value at its bound. */
const MAXIMUM_BODY_BYTES = 4 * WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS + 1_024;

/** How many of a secret's last characters its hint shows, and the shortest secret that shows any. */
const SECRET_HINT = { SHOWN_CHARS: 4, MIN_CHARS: 12 } as const;

export interface WorkspaceEnvironmentAppSeams {
  readonly resolveUserId: UserIdResolver;
}

type Requirements = HttpServerRequest.HttpServerRequest | DatabaseServices | HostedEnvironment;

/** The bearer resolved against the deployment's own account store, or the invalid-token refusal; any method but POST refused first. */
const postingAccount = Effect.fn("web/workspaceEnvironmentAccount")(function* (
  seams: WorkspaceEnvironmentAppSeams,
) {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== "POST") return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/** The body read as the schema says, or the invalid-request refusal; its wording is never logged, since it may quote a secret. */
const bodyAs = <A>(schema: Schema.Codec<A, unknown>) =>
  Effect.flatMap(readJsonBodyEffect(MAXIMUM_BODY_BYTES), (body) =>
    Result.match(readEither(schema)(body), {
      onFailure: () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST),
      onSuccess: Effect.succeed,
    }),
  );

/** The workspace named, as the account sees it; one it is not in is not found, and one it does not manage is refused where it must. */
const workspaceFor = Effect.fn("web/workspaceEnvironmentWorkspace")(function* (
  userId: string,
  workspaceId: string,
  managing: boolean,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  if (managing && !managesWorkspace(workspace.value)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  return workspace.value;
});

/** A secret's hint: its last characters, where it is long enough that they give nothing away. */
function secretHint(value: string): string {
  if (value.length < SECRET_HINT.MIN_CHARS) return "";
  return `…${value.slice(-SECRET_HINT.SHOWN_CHARS)}`;
}

/** One row as a member is shown it: a variable's value opened, a secret's hint alone. */
function entryOf(ring: KeyRing, organizationId: string, row: WorkspaceEnvironmentRow) {
  const opened = openEnvironmentValue(ring, { organizationId, name: row.name }, sealedOf(row));
  const entry: WorkspaceEnvironmentEntry = {
    name: row.name,
    kind: row.kind,
    readable: Result.isSuccess(opened),
    updatedAt: row.updatedAt.getTime(),
  };
  if (row.kind === WORKSPACE_ENVIRONMENT_KIND.SECRET) return { ...entry, hint: row.hint };
  return Result.isSuccess(opened) ? { ...entry, value: Redacted.value(opened.success) } : entry;
}

const listResponse = Effect.fn("web/workspaceEnvironmentList")(function* (
  ring: KeyRing,
  organizationId: string,
  rejected?: WorkspaceEnvironmentAnswer["rejected"],
) {
  const rows = yield* hostedStoreOrUnavailable(listWorkspaceEnvironmentRows(organizationId));
  const answer: WorkspaceEnvironmentAnswer = {
    entries: rows.map((row) => entryOf(ring, organizationId, row)),
    ...(rejected === undefined ? undefined : { rejected }),
  };
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, answer);
});

const listEndpoint = Effect.fn("web/workspaceEnvironmentListEndpoint")(function* (
  seams: WorkspaceEnvironmentAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const userId = yield* postingAccount(seams);
  const asked = yield* bodyAs(workspaceEnvironmentListRequestSchema);
  const workspace = yield* workspaceFor(userId, asked.workspaceId, false);
  const ring = yield* keyRingOrUnavailable;
  return yield* listResponse(ring, workspace.id);
});

/** Keeps the value sealed under the name, unless it names a new one past the workspace's bound. */
const saveEndpoint = Effect.fn("web/workspaceEnvironmentSaveEndpoint")(function* (
  seams: WorkspaceEnvironmentAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const userId = yield* postingAccount(seams);
  const asked = yield* bodyAs(workspaceEnvironmentSaveRequestSchema);
  const workspace = yield* workspaceFor(userId, asked.workspaceId, true);
  const ring = yield* keyRingOrUnavailable;
  const standing = yield* hostedStoreOrUnavailable(listWorkspaceEnvironmentRows(workspace.id));
  const isNew = !standing.some((row) => row.name === asked.name);
  if (isNew && standing.length >= WORKSPACE_ENVIRONMENT_BOUNDS.MAX_ENTRIES) {
    return yield* listResponse(ring, workspace.id, WORKSPACE_ENVIRONMENT_REJECTION.TOO_MANY);
  }
  const kind: WorkspaceEnvironmentKind = asked.kind;
  const value = Redacted.make(asked.value);
  const sealed = sealEnvironmentValue(
    ring,
    { organizationId: workspace.id, name: asked.name },
    value,
  );
  const hint = kind === WORKSPACE_ENVIRONMENT_KIND.SECRET ? secretHint(asked.value) : "";
  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(
    saveWorkspaceEnvironmentValue(workspace.id, asked.name, kind, sealed, hint, userId, now),
  );
  return yield* listResponse(ring, workspace.id);
});

const removeEndpoint = Effect.fn("web/workspaceEnvironmentRemoveEndpoint")(function* (
  seams: WorkspaceEnvironmentAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, Requirements> {
  const userId = yield* postingAccount(seams);
  const asked = yield* bodyAs(workspaceEnvironmentRemoveRequestSchema);
  const workspace = yield* workspaceFor(userId, asked.workspaceId, true);
  const ring = yield* keyRingOrUnavailable;
  yield* hostedStoreOrUnavailable(removeWorkspaceEnvironmentValue(workspace.id, asked.name));
  return yield* listResponse(ring, workspace.id);
});

/** The group: the three environment paths, and the hosted vocabulary's own refusal for any other. */
export function workspaceEnvironmentApp(
  seams: WorkspaceEnvironmentAppSeams,
): WebRoutes<DatabaseServices | HostedEnvironment> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT,
      hostedRefusing(listEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_SAVE,
      hostedRefusing(saveEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_REMOVE,
      hostedRefusing(removeEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
