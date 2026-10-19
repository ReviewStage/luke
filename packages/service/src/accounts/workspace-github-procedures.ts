/**
 * workspace-github-procedures.ts -- a workspace's GitHub connected by an owner or an admin of it, and the old disconnect refused.
 *
 * `POST /api/workspaces/github/connect` answers where the browser goes to
 * connect GitHub: the Luke GitHub App's install address with a single-use
 * intent as its `state`, which the connect's callback spends
 * (`github-install-app.ts`), adding the installation beside any the
 * workspace holds; it takes an owner or admin of the workspace, and a
 * workspace the account is not in answers as none does. Which
 * installations and repositories a workspace holds is managed on GitHub,
 * so `.../disconnect`, which a Mac from before several installations still
 * sends, is refused as not permitted to every signed-in account and removes
 * nothing: a workspace's installations are now managed on GitHub, where
 * uninstalling one reaches the webhook, so the old press must not remove
 * every installation the workspace holds.
 *
 * The bearer is resolved before the body is read, by the middleware on the
 * resource, so an unsigned caller is refused as unauthenticated whatever it
 * sent.
 */

import { workspaceOf } from "@luke/database/models/workspace-store";
import { Effect, Option } from "effect";
import { GitHubApp } from "../github/github-app.js";
import { createConnectIntent, GITHUB_CONNECT_ROLES } from "../github/github-installations.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, bodyLimit, hosted } from "../orpc/base.js";

/** A workspace's id is a few dozen characters, so a body past this is not one. */
const MAXIMUM_BODY_BYTES = 1_024;

/** The query GitHub carries back to the Setup URL, which is the connect intent's state. */
const INSTALL_STATE_PARAM = "state";

export interface WorkspaceGithubProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace GitHub resource: connect to an owner or admin, and disconnect refused to everyone signed in. */
export function workspaceGithubProcedures(seams: WorkspaceGithubProcedureSeams) {
  const resource = hosted.workspaceGithub
    .use(accountMiddleware(seams.resolveUserId))
    .use(bodyLimit(MAXIMUM_BODY_BYTES));
  return {
    connect: resource.connect.effect(function* ({ input, context }) {
      const workspace = yield* hostedStoreOrUnavailable(
        workspaceOf(context.userId, input.workspaceId),
      );
      if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      if (!GITHUB_CONNECT_ROLES.has(workspace.value.role)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      }
      const app = yield* GitHubApp;
      const installUrl = yield* app.installUrl.pipe(
        Effect.catch((failure) =>
          Effect.andThen(logGitHubReadFailure(failure), Effect.fail(HOSTED_REFUSAL.UNAVAILABLE)),
        ),
      );
      const state = yield* hostedStoreOrUnavailable(
        createConnectIntent(context.userId, workspace.value.id),
      );
      const url = new URL(installUrl);
      url.searchParams.set(INSTALL_STATE_PARAM, state);
      return { url: url.toString() };
    }),
    disconnect: resource.disconnect.effect(function* () {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
    }),
  };
}
