/**
 * github-install-app.ts -- the install group: the door to GitHub's install page, and the Setup URL GitHub returns through.
 *
 * Two browser navigations, neither carrying an account bearer. The first
 * sends the developer to GitHub to install the Luke GitHub App or choose its
 * repositories. The second is the App's registered Setup URL: GitHub lands
 * the browser here with `installation_id` and `setup_action`, and the route
 * sends it on to the landing page with one word of status.
 *
 * Where the install began as a workspace's connect, the address also carries
 * the connect intent's `state` (`workspaces-app.ts`), and the installation is
 * linked to that intent's workspace. The `installation_id` is never trusted
 * on its own, since anyone can put any id on this address: GitHub's own
 * guidance for the Setup URL is to confirm the installation is associated
 * with the user who installed it, on that user's token
 * (https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url).
 * So the intent is spent first, which names the account and the workspace
 * and refuses a state unknown, used, or expired; the account must still be
 * an owner or admin of the workspace, which must not be its personal one; and the installation must be among
 * those the account's own GitHub token reaches (`GET /user/installations`).
 * Only then is it linked, and one already standing for another workspace is
 * refused. Without a state, the route only confirms the installation is
 * this App's own by asking GitHub as the App, and links nothing.
 */

import type { DatabaseServices } from "@sidecar/database/core/query";
import { workspaceOf } from "@sidecar/database/models/workspace-store";
import {
  GITHUB_INSTALL_STATUS,
  type GitHubInstallStatus,
  githubInstallLandingPath,
  HOSTED_SERVICE_PATH,
} from "@sidecar/hosted";
import { Effect, Layer, Option } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import {
  GitHubApp,
  type GitHubReadFailure,
  type GitHubUserReadFailure,
} from "./github/github-app.js";
import { logGitHubReadFailure } from "./github/github-refusal.js";
import {
  type ConnectedInstallation,
  GITHUB_CONNECT_ROLES,
  LINK_OUTCOME,
  linkInstallation,
  spendConnectIntent,
} from "./hosted/github-installations.js";
import { hostedNotFoundRoute } from "./hosted/http-effect.js";
import { logStoreFailure } from "./hosted/store-failure.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/** The query GitHub puts on the Setup URL. */
const SETUP_QUERY = {
  INSTALLATION_ID: "installation_id",
  SETUP_ACTION: "setup_action",
  /** The connect intent's state, which the install address carried and GitHub hands back. */
  STATE: "state",
} as const;

/** What GitHub says brought the browser here. */
const SETUP_ACTION = {
  INSTALL: "install",
  UPDATE: "update",
  /** A member asked an organization's owner to install; there is no installation yet. */
  REQUEST: "request",
} as const;

/** A browser is sent on with 303, so a POST GitHub might one day send becomes the GET the page is. */
const HTTP_STATUS = { SEE_OTHER: 303 } as const;

const INSTALLATION_ID = /^\d{1,15}$/u;

function landing(status: GitHubInstallStatus): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.redirect(githubInstallLandingPath(status), {
    status: HTTP_STATUS.SEE_OTHER,
  });
}

/** GET: to GitHub's install page for the App; a deployment without the App lands on the page saying so. */
const installEndpoint = Effect.gen(function* () {
  const app = yield* GitHubApp;
  return yield* app.installUrl.pipe(
    Effect.map((url) => HttpServerResponse.redirect(url)),
    Effect.catch((failure) =>
      Effect.as(logGitHubReadFailure(failure), landing(GITHUB_INSTALL_STATUS.UNAVAILABLE)),
    ),
  );
});

/** The status an install or update settles on: the installation confirmed as this App's, or not found. */
const confirmInstallation = /* @__PURE__ */ Effect.fn("web/confirmInstallation")(function* (
  installationId: string | undefined,
  action: string | undefined,
): Effect.fn.Return<GitHubInstallStatus, GitHubReadFailure, GitHubApp | HttpClient.HttpClient> {
  if (action === SETUP_ACTION.REQUEST) return GITHUB_INSTALL_STATUS.REQUESTED;
  if (installationId === undefined || !INSTALLATION_ID.test(installationId)) {
    return GITHUB_INSTALL_STATUS.NOT_FOUND;
  }
  const app = yield* GitHubApp;
  const installation = yield* app.installation(Number(installationId));
  if (Option.isNone(installation)) return GITHUB_INSTALL_STATUS.NOT_FOUND;
  return action === SETUP_ACTION.UPDATE
    ? GITHUB_INSTALL_STATUS.UPDATED
    : GITHUB_INSTALL_STATUS.INSTALLED;
});

/** The installation GitHub named, as the account's own token reaches it; nothing where it does not, or where its account is none a workspace is linked to. */
const installationOnAccount = /* @__PURE__ */ Effect.fn("web/installationOnAccount")(function* (
  userId: string,
  installationId: number,
): Effect.fn.Return<
  Option.Option<ConnectedInstallation>,
  GitHubUserReadFailure,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const app = yield* GitHubApp;
  const reached = (yield* app.userInstallations(userId)).find(
    (installation) => installation.id === installationId,
  );
  if (reached === undefined) return Option.none();
  const { accountId, accountLogin, accountType } = reached;
  if (accountId === undefined || accountLogin === undefined || accountType === undefined) {
    return Option.none();
  }
  return Option.some({ installationId, accountId, accountLogin, accountType });
});

/** The status a workspace's connect settles on, once its intent is spent and the installation confirmed on the account's own token. */
const connectInstallation = /* @__PURE__ */ Effect.fn("web/connectInstallation")(function* (
  state: string,
  installationId: string | undefined,
  action: string | undefined,
): Effect.fn.Return<
  GitHubInstallStatus,
  GitHubUserReadFailure,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  if (action === SETUP_ACTION.REQUEST) return GITHUB_INSTALL_STATUS.REQUESTED;
  const intent = yield* spendConnectIntent(state);
  if (Option.isNone(intent)) return GITHUB_INSTALL_STATUS.EXPIRED;
  const { userId, organizationId } = intent.value;
  const workspace = yield* workspaceOf(userId, organizationId);
  if (
    Option.isNone(workspace) ||
    workspace.value.personal ||
    !GITHUB_CONNECT_ROLES.has(workspace.value.role)
  ) {
    return GITHUB_INSTALL_STATUS.EXPIRED;
  }
  if (installationId === undefined || !INSTALLATION_ID.test(installationId)) {
    return GITHUB_INSTALL_STATUS.NOT_FOUND;
  }
  const installation = yield* installationOnAccount(userId, Number(installationId));
  if (Option.isNone(installation)) return GITHUB_INSTALL_STATUS.NOT_FOUND;
  const outcome = yield* linkInstallation(organizationId, installation.value);
  return outcome === LINK_OUTCOME.LINKED
    ? GITHUB_INSTALL_STATUS.CONNECTED
    : GITHUB_INSTALL_STATUS.ALREADY_CONNECTED;
});

/** A failure on the way to a status, as the status it lands on: an account with no readable GitHub token is asked to connect one, and every other failure is GitHub or the store unavailable. */
function landedOnFailure(failure: GitHubUserReadFailure): Effect.Effect<GitHubInstallStatus> {
  switch (failure._tag) {
    case "GitHubSignInRequired":
      return Effect.succeed(GITHUB_INSTALL_STATUS.GITHUB_SIGN_IN_REQUIRED);
    case "GitHubAppNotConfigured":
    case "GitHubUnavailable":
      return Effect.as(logGitHubReadFailure(failure), GITHUB_INSTALL_STATUS.UNAVAILABLE);
    default:
      return Effect.as(logStoreFailure(failure), GITHUB_INSTALL_STATUS.UNAVAILABLE);
  }
}

/** GET: the Setup URL. Whatever GitHub sent, the browser lands on the page with a status. */
const installedEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const query = new URL(request.url, "https://localhost").searchParams;
  const installationId = query.get(SETUP_QUERY.INSTALLATION_ID) ?? undefined;
  const action = query.get(SETUP_QUERY.SETUP_ACTION) ?? undefined;
  const state = query.get(SETUP_QUERY.STATE);
  const settled =
    state === null
      ? confirmInstallation(installationId, action)
      : connectInstallation(state, installationId, action);
  return landing(yield* Effect.catch(settled, landedOnFailure));
});

/** The group: the two navigations, and the hosted vocabulary's own refusal for any other path. */
export function githubInstallApp(): WebRoutes<
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.GITHUB_INSTALL, installEndpoint),
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.GITHUB_INSTALLED, installedEndpoint),
    hostedNotFoundRoute,
  );
}
