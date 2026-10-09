/**
 * github-install-app.ts -- the install group: the door to GitHub's install page, and the Setup URL GitHub returns through.
 *
 * Two browser navigations, neither carrying an account bearer. The first
 * sends the developer to GitHub to install the Luke GitHub App or choose its
 * repositories. The second is the App's registered Setup URL: GitHub lands
 * the browser here with `installation_id` and `setup_action`, the route
 * confirms the installation is this App's own by asking GitHub as the App,
 * and sends the browser on to the landing page with one word of status. The
 * desktop will later read that landing; until then the page says to return
 * to Luke. Nothing is stored: which installations a signed-in user can reach
 * is read from GitHub on the user's own token when a repository is chosen.
 */

import {
  GITHUB_INSTALL_STATUS,
  type GitHubInstallStatus,
  githubInstallLandingPath,
  HOSTED_SERVICE_PATH,
} from "@sidecar/hosted";
import { Effect, Layer, Option } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { GitHubApp, type GitHubReadFailure } from "./github/github-app.js";
import { hostedNotFoundRoute } from "./hosted/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/** The query GitHub puts on the Setup URL. */
const SETUP_QUERY = {
  INSTALLATION_ID: "installation_id",
  SETUP_ACTION: "setup_action",
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

/** The failure written down by its kind alone: nothing of the App's JWT or GitHub's body reaches a line. */
function logReadFailure(failure: GitHubReadFailure): Effect.Effect<void> {
  return Effect.logWarning(`GitHub App read failed: ${failure.message}`);
}

/** GET: to GitHub's install page for the App; a deployment without the App lands on the page saying so. */
const installEndpoint = Effect.gen(function* () {
  const app = yield* GitHubApp;
  return yield* app.installUrl.pipe(
    Effect.map((url) => HttpServerResponse.redirect(url)),
    Effect.catch((failure) =>
      Effect.as(logReadFailure(failure), landing(GITHUB_INSTALL_STATUS.UNAVAILABLE)),
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

/** GET: the Setup URL. Whatever GitHub sent, the browser lands on the page with a status. */
const installedEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const query = new URL(request.url, "https://localhost").searchParams;
  const status = yield* confirmInstallation(
    query.get(SETUP_QUERY.INSTALLATION_ID) ?? undefined,
    query.get(SETUP_QUERY.SETUP_ACTION) ?? undefined,
  ).pipe(
    Effect.catch((failure) =>
      Effect.as(logReadFailure(failure), GITHUB_INSTALL_STATUS.UNAVAILABLE),
    ),
  );
  return landing(status);
});

/** The group: the two navigations, and the hosted vocabulary's own refusal for any other path. */
export function githubInstallApp(): WebRoutes<GitHubApp | HttpClient.HttpClient> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.GITHUB_INSTALL, installEndpoint),
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.GITHUB_INSTALLED, installedEndpoint),
    hostedNotFoundRoute,
  );
}
