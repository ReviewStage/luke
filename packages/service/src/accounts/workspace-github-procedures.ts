import { workspaceOf } from "@repo/database/models/workspace-store";
import { Effect, Option } from "effect";
import { GitHubApp } from "../github/github-app.js";
import { createConnectIntent, GITHUB_CONNECT_ROLES } from "../github/github-installations.js";
import { logGitHubReadFailure } from "../github/github-refusal.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

const INSTALL_STATE_PARAM = "state";

export interface WorkspaceGithubProcedureSeams {
  resolveUserId: UserIdResolver;
}

export function workspaceGithubProcedures(seams: WorkspaceGithubProcedureSeams) {
  const resource = hosted.workspaceGithub.use(accountMiddleware(seams.resolveUserId));
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
