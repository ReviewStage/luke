/**
 * workspace-linear-procedures.ts -- a workspace's one Linear connection begun and ended, and the issues it reaches read.
 *
 * Three procedures the signed-in desktop calls with its bearer:
 *
 * - `POST /api/workspaces/linear/connect` takes an owner or admin of the
 *   workspace, asks Vercel Connect to begin a browser sign-in to Linear
 *   under the workspace's own id as the grant's subject, on the workspace
 *   Linear connector (`WorkspaceLinearConnect`), records the
 *   sign-in's one-time state on the workspace's row, and answers the address
 *   the desktop opens. The grant is the workspace's: every member reads
 *   every issue it reaches, a private team's among them, which the desktop
 *   says before the admin goes on. Where Connect returns the browser stays a
 *   redirect of its own (`workspace-linear-app.ts`).
 * - `POST /api/workspaces/linear/disconnect` takes an owner or admin, deletes
 *   the workspace's row before anything else, which stops every read
 *   through the grant, then asks Connect to revoke it; it answers the
 *   workspace. What plans already kept of an issue stays with them.
 * - `POST /api/workspaces/linear/issues` takes any member, and answers the
 *   issues the grant reaches, newest changed first, or those a search
 *   matches (`linear-issues.ts`).
 *
 * A workspace the account is not in is not found, whatever it asked. The
 * bearer is resolved before the body is read, by the middleware on the
 * resource, so an unsigned caller is refused as unauthenticated whatever it
 * sent.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { type Workspace, workspaceOf } from "@luke/database/models/workspace-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { managesWorkspace } from "@luke/features/workspace-role";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { accountIntegrationConnect, WorkspaceLinearConnect } from "./integration-connect.js";
import {
  linearIssueByIdentifier,
  linearOrRefused,
  listLinearIssues,
  throughWorkspaceLinear,
} from "./linear-issues.js";
import {
  beginWorkspaceIntegrationSignIn,
  deleteWorkspaceIntegration,
} from "./workspace-integration-store.js";

/** The query Connect returns the browser with, which is the one Luke put on the callback. */
const STATE_QUERY = "state";

const LINEAR = INTEGRATION_PROVIDER.LINEAR;

export interface WorkspaceLinearProcedureSeams {
  resolveUserId: UserIdResolver;
  /** A fresh sign-in state; random in production, fixed in a test. */
  mintState: () => string;
}

/** The workspace named, as the account sees it; one it is not in is not found. */
const memberWorkspace = Effect.fn("web/workspaceLinearWorkspace")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<Workspace, HostedRefusal, DatabaseServices> {
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
  if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspace.value;
});

/** The workspace named, where the account is an owner or admin of it. */
const administeredWorkspace = Effect.fn("web/workspaceLinearAdministered")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* memberWorkspace(userId, workspaceId);
  if (!managesWorkspace(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  return workspace;
});

/** The callback Connect returns the browser to, on the host the desktop asked through. */
function callbackUrl(requestUrl: string, state: string): string {
  const url = new URL(HOSTED_SERVICE_PATH.WORKSPACE_LINEAR_CONNECTED, requestUrl);
  url.searchParams.set(STATE_QUERY, state);
  return url.toString();
}

/** The workspace Linear resource: connect and disconnect to an owner or admin, and the issues to any member. */
export function workspaceLinearProcedures(seams: WorkspaceLinearProcedureSeams) {
  const resource = hosted.workspaceLinear.use(accountMiddleware(seams.resolveUserId));
  return {
    /**
     * Begins the workspace's Linear sign-in, on the workspace Linear
     * connector. Linear must be offered to the admin's own account here
     * (`accountIntegrationConnect`), so a deployment that keeps Linear to some
     * accounts keeps its workspaces to them too. Connect is asked first, so a
     * sign-in it refused leaves the row as it stood.
     */
    connect: resource.connect.effect(function* ({ input, context }) {
      const { userId } = context;
      const workspace = yield* administeredWorkspace(userId, input.workspaceId);
      const offered = (yield* hostedStoreOrUnavailable(accountIntegrationConnect(userId)))[LINEAR];
      const connector = yield* WorkspaceLinearConnect;
      if (!offered.configured || !connector.configured) {
        return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
      }
      const state = seams.mintState();
      const { url, verifier } = yield* connector
        .authorize(workspace.id, callbackUrl(context.request.url, state))
        .pipe(
          Effect.tapError((failure) =>
            Effect.logWarning(
              "Vercel Connect could not begin a workspace Linear sign-in",
              failure.message,
            ),
          ),
          Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
        );
      yield* hostedStoreOrUnavailable(
        beginWorkspaceIntegrationSignIn(workspace.id, LINEAR, userId, state, verifier),
      );
      return { url };
    }),
    /**
     * Ends the workspace's Linear. The row goes first, so whatever Connect
     * answers, nobody reads through the grant again; a failed revoke is
     * logged rather than answered.
     */
    disconnect: resource.disconnect.effect(function* ({ input, context }) {
      const { userId } = context;
      const workspace = yield* administeredWorkspace(userId, input.workspaceId);
      yield* hostedStoreOrUnavailable(deleteWorkspaceIntegration(workspace.id, LINEAR));
      const connector = yield* WorkspaceLinearConnect;
      if (connector.configured) {
        yield* connector
          .revoke(workspace.id)
          .pipe(
            Effect.catch((failure) =>
              Effect.logWarning(
                "Vercel Connect could not revoke a workspace Linear grant",
                failure.message,
              ),
            ),
          );
      }
      return { workspace: yield* memberWorkspace(userId, workspace.id) };
    }),
    /** The issues the workspace's grant reaches, or the one an identifier names, to any member of it. */
    issues: resource.issues.effect(function* ({ input, context }) {
      const workspace = yield* memberWorkspace(context.userId, input.workspaceId);
      const { identifier } = input;
      const issues = yield* linearOrRefused(
        throughWorkspaceLinear(workspace.id, (token) =>
          identifier === undefined
            ? listLinearIssues(token, input.query)
            : linearIssueByIdentifier(token, identifier),
        ),
        "Linear listed no issues",
      );
      return { issues };
    }),
  };
}
