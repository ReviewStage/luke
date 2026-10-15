/**
 * github-install-app.ts -- the install group: the door to GitHub's install page, the Setup URL GitHub returns through, and the callback a workspace's connect is confirmed at.
 *
 * Browser navigations, none carrying an account bearer. The first sends the
 * developer to GitHub to install the Luke GitHub App or choose its
 * repositories. The second is the App's registered Setup URL: GitHub lands
 * the browser here with `installation_id` and `setup_action`, and without a
 * connect's `state` the route only confirms the installation is this App's
 * own by asking GitHub as the App, links nothing, and sends the browser on
 * to the landing page with one word of status.
 *
 * Where the install began as a workspace's connect, the address also carries
 * the connect intent's `state` (`workspaces-app.ts`), and the installation is
 * linked to that intent's workspace. The `installation_id` is never trusted
 * on its own, since anyone can put any id on this address: GitHub's own
 * guidance for the Setup URL is to generate a user access token for the user
 * who installed the App and check the installation is associated with them
 * (https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url).
 * Luke keeps no user's token for that, so the Setup URL sends the browser on
 * through GitHub's web application flow, with PKCE and the App's
 * registered callback URL `GITHUB_INSTALLED_AUTHORIZED` named as its
 * `redirect_uri`
 * (https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app),
 * under the intent's own state, once the installation's id and a random
 * code verifier are written on the intent. GitHub returns the browser to the
 * callback with a one-time code, and only there is the intent spent, which
 * names the account, the workspace, the installation, and the verifier, and
 * refuses a state unknown, used, or expired; the account must still be an
 * owner or admin of the workspace; and the
 * installation must be among those the code's user access token reaches
 * (`GET /user/installations`), read once before the token is revoked
 * (`GitHubApp.authorizedInstallations`). Only then is it linked, and one
 * already standing for another workspace is refused.
 *
 * GitHub's "Request user authorization (OAuth) during installation" is left
 * off: it disables the Setup URL and returns the code to the App's first
 * callback URL, which is the sign-in's, where the docs above say to run the
 * whole web flow with `redirect_uri` to choose the callback instead.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { workspaceOf } from "@luke/database/models/workspace-store";
import {
  GITHUB_INSTALL_STATUS,
  type GitHubInstallStatus,
  githubInstallLandingPath,
  HOSTED_SERVICE_PATH,
} from "@luke/features";
import { generateRandomString } from "better-auth/crypto";
import { Effect, Layer, Option } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { hostedNotFoundRoute } from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import {
  GitHubApp,
  type GitHubAuthorizeReturn,
  type GitHubReadFailure,
  type GitHubWorkspaceReadFailure,
} from "./github-app.js";
import {
  type ConnectedInstallation,
  GITHUB_CONNECT_ROLES,
  LINK_OUTCOME,
  linkInstallation,
  recordConnectAuthorization,
  spendConnectIntent,
} from "./github-installations.js";
import { logGitHubReadFailure, logWorkspaceReadFailure } from "./github-refusal.js";

/** The query GitHub puts on the Setup URL. */
const SETUP_QUERY = {
  INSTALLATION_ID: "installation_id",
  SETUP_ACTION: "setup_action",
  /** The connect intent's state, which the install address carried and GitHub hands back. */
  STATE: "state",
} as const;

/** The query GitHub puts on the callback its web flow returns through. */
const AUTHORIZED_QUERY = {
  CODE: "code",
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

/** A PKCE code verifier's length, as Better Auth's own OAuth flows make one. */
const CODE_VERIFIER_LENGTH = 128;

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

/**
 * A workspace's connect at the Setup URL: the installation named and a new
 * code verifier written on the intent, and on to GitHub to authorize the App
 * once under the intent's own state; a request, a malformed id, or a state
 * no intent stands for lands at once.
 */
const authorizeConnect = /* @__PURE__ */ Effect.fn("web/authorizeConnect")(function* (
  state: string,
  installationId: string | undefined,
  action: string | undefined,
  callback: string,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  GitHubWorkspaceReadFailure,
  GitHubApp | DatabaseServices
> {
  if (action === SETUP_ACTION.REQUEST) return landing(GITHUB_INSTALL_STATUS.REQUESTED);
  if (installationId === undefined || !INSTALLATION_ID.test(installationId)) {
    return landing(GITHUB_INSTALL_STATUS.NOT_FOUND);
  }
  const codeVerifier = generateRandomString(CODE_VERIFIER_LENGTH);
  const recorded = yield* recordConnectAuthorization(state, Number(installationId), codeVerifier);
  if (!recorded) return landing(GITHUB_INSTALL_STATUS.EXPIRED);
  const app = yield* GitHubApp;
  const url = yield* app.authorizeUrl({ redirectUri: callback, state, codeVerifier });
  return HttpServerResponse.redirect(url, { status: HTTP_STATUS.SEE_OTHER });
});

/** The installation named, as the user who authorized reaches it; nothing where they do not, where GitHub refused the code, or where its account is none a workspace is linked to. */
const authorizedInstallation = /* @__PURE__ */ Effect.fn("web/authorizedInstallation")(function* (
  installationId: number,
  returned: GitHubAuthorizeReturn,
): Effect.fn.Return<
  Option.Option<ConnectedInstallation>,
  GitHubReadFailure,
  GitHubApp | HttpClient.HttpClient
> {
  const app = yield* GitHubApp;
  const installations = yield* app.authorizedInstallations(returned);
  const reached = Option.getOrElse(installations, () => []).find(
    (installation) => installation.id === installationId,
  );
  if (reached === undefined) return Option.none();
  const { accountId, accountLogin, accountType } = reached;
  if (accountId === undefined || accountLogin === undefined || accountType === undefined) {
    return Option.none();
  }
  return Option.some({ installationId, accountId, accountLogin, accountType });
});

/** The status a workspace's connect settles on at the callback, once its intent is spent and the installation confirmed with the user who authorized. */
const connectInstallation = /* @__PURE__ */ Effect.fn("web/connectInstallation")(function* (
  code: string | null,
  state: string | null,
  callback: string,
): Effect.fn.Return<
  GitHubInstallStatus,
  GitHubWorkspaceReadFailure,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  if (state === null) return GITHUB_INSTALL_STATUS.EXPIRED;
  const intent = yield* spendConnectIntent(state);
  if (Option.isNone(intent)) return GITHUB_INSTALL_STATUS.EXPIRED;
  const { userId, organizationId, installationId, codeVerifier } = intent.value;
  if (installationId === null || codeVerifier === null) return GITHUB_INSTALL_STATUS.EXPIRED;
  // A declined authorization returns no code.
  if (code === null) return GITHUB_INSTALL_STATUS.NOT_FOUND;
  const workspace = yield* workspaceOf(userId, organizationId);
  if (Option.isNone(workspace) || !GITHUB_CONNECT_ROLES.has(workspace.value.role)) {
    return GITHUB_INSTALL_STATUS.EXPIRED;
  }
  const installation = yield* authorizedInstallation(installationId, {
    code,
    codeVerifier,
    redirectUri: callback,
  });
  if (Option.isNone(installation)) return GITHUB_INSTALL_STATUS.NOT_FOUND;
  const outcome = yield* linkInstallation(organizationId, installation.value);
  return outcome === LINK_OUTCOME.LINKED
    ? GITHUB_INSTALL_STATUS.CONNECTED
    : GITHUB_INSTALL_STATUS.ALREADY_CONNECTED;
});

/** A failure on the way to a status, as the status it lands on: GitHub or the store unavailable. */
function landedOnFailure(failure: GitHubWorkspaceReadFailure): Effect.Effect<GitHubInstallStatus> {
  return Effect.as(logWorkspaceReadFailure(failure), GITHUB_INSTALL_STATUS.UNAVAILABLE);
}

/**
 * The request's query, and the callback on the host the browser came
 * through, which is the `redirect_uri` the flow names and the exchange
 * repeats.
 */
const requestQuery = Effect.gen(function* () {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const url = new URL(request.url);
  return {
    callback: new URL(HOSTED_SERVICE_PATH.GITHUB_INSTALLED_AUTHORIZED, url.origin).toString(),
    query: url.searchParams,
  };
});

/** GET: the Setup URL. Whatever GitHub sent, the browser lands on the page with a status, or goes on to GitHub to confirm a connect. */
const installedEndpoint = Effect.gen(function* () {
  const { callback, query } = yield* requestQuery;
  const installationId = query.get(SETUP_QUERY.INSTALLATION_ID) ?? undefined;
  const action = query.get(SETUP_QUERY.SETUP_ACTION) ?? undefined;
  const state = query.get(SETUP_QUERY.STATE);
  if (state === null) {
    return landing(
      yield* Effect.catch(confirmInstallation(installationId, action), landedOnFailure),
    );
  }
  return yield* authorizeConnect(state, installationId, action, callback).pipe(
    Effect.catch((failure) => Effect.map(landedOnFailure(failure), landing)),
  );
});

/** GET: the callback a connect's one-time authorization returns through. Whatever GitHub sent, the browser lands on the page with a status. */
const authorizedEndpoint = Effect.gen(function* () {
  const { callback, query } = yield* requestQuery;
  const settled = connectInstallation(
    query.get(AUTHORIZED_QUERY.CODE),
    query.get(AUTHORIZED_QUERY.STATE),
    callback,
  );
  return landing(yield* Effect.catch(settled, landedOnFailure));
});

/** The group: the three navigations, and the hosted vocabulary's own refusal for any other path. */
export function githubInstallApp(): WebRoutes<
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.GITHUB_INSTALL, installEndpoint),
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.GITHUB_INSTALLED, installedEndpoint),
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.GITHUB_INSTALLED_AUTHORIZED, authorizedEndpoint),
    hostedNotFoundRoute,
  );
}
