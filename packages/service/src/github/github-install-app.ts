import type { DatabaseServices } from "@repo/database/core/query";
import { workspaceOf } from "@repo/database/models/workspace-store";
import {
  GITHUB_INSTALL_STATUS,
  type GitHubInstallStatus,
  githubInstallLandingPath,
  HOSTED_SERVICE_PATH,
} from "@repo/features";
import { generateRandomString } from "better-auth/crypto";
import { Effect, Layer, Option } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { sessionCredential } from "../auth/session-credential.js";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import { hostedNotFoundRoute, type SessionUserIdResolver } from "../http/http-effect.js";
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
  installationsOfWorkspace,
  LINK_OUTCOME,
  type LinkOutcome,
  linkInstallationAs,
  recordConnectAuthorization,
  spendConnectIntent,
} from "./github-installations.js";
import { logGitHubReadFailure, logWorkspaceReadFailure } from "./github-refusal.js";

const SETUP_QUERY = {
  INSTALLATION_ID: "installation_id",
  SETUP_ACTION: "setup_action",
  STATE: "state",
} as const;

const AUTHORIZED_QUERY = {
  CODE: "code",
  STATE: "state",
} as const;

const SETUP_ACTION = {
  INSTALL: "install",
  UPDATE: "update",
  REQUEST: "request",
} as const;

const LANDED_ON_LINK = {
  [LINK_OUTCOME.LINKED]: GITHUB_INSTALL_STATUS.CONNECTED,
  [LINK_OUTCOME.ALREADY_CONNECTED]: GITHUB_INSTALL_STATUS.ALREADY_CONNECTED,
  [LINK_OUTCOME.NOT_PERMITTED]: GITHUB_INSTALL_STATUS.EXPIRED,
} as const satisfies Readonly<Record<LinkOutcome, GitHubInstallStatus>>;

export interface GitHubInstallSeams {
  readonly resolveSessionUserId: SessionUserIdResolver;
}

const HTTP_STATUS = { SEE_OTHER: 303 } as const;

const INSTALLATION_ID = /^\d{1,15}$/u;

const CODE_VERIFIER_LENGTH = 128;

function landing(status: GitHubInstallStatus): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.redirect(githubInstallLandingPath(status), {
    status: HTTP_STATUS.SEE_OTHER,
  });
}

const installEndpoint = Effect.gen(function* () {
  const app = yield* GitHubApp;
  return yield* app.installUrl.pipe(
    Effect.map((url) => HttpServerResponse.redirect(url)),
    Effect.catch((failure) =>
      Effect.as(logGitHubReadFailure(failure), landing(GITHUB_INSTALL_STATUS.UNAVAILABLE)),
    ),
  );
});

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

const authorizedInstallation = /* @__PURE__ */ Effect.fn("web/authorizedInstallation")(function* (
  installationId: number,
  returned: GitHubAuthorizeReturn,
  installer: Option.Option<string>,
): Effect.fn.Return<
  Option.Option<ConnectedInstallation>,
  GitHubWorkspaceReadFailure,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  const app = yield* GitHubApp;
  const installations = yield* app.authorizedInstallations(returned, installer);
  const reached = Option.getOrElse(installations, () => []).find(
    (installation) => installation.id === installationId,
  );
  if (reached === undefined) return Option.none();
  const { accountId, accountLogin, accountType, suspended } = reached;
  if (accountId === undefined || accountLogin === undefined || accountType === undefined) {
    return Option.none();
  }
  return Option.some({ installationId, accountId, accountLogin, accountType, suspended });
});

function signedInAs(
  seams: GitHubInstallSeams,
  request: Request,
  userId: string,
): Effect.Effect<Option.Option<string>> {
  const credential = sessionCredential(request.headers);
  if (credential === undefined) return Effect.succeedNone;
  return seams.resolveSessionUserId(new Request(request.url, { headers: credential })).pipe(
    Effect.map(Option.filter((signedIn) => signedIn === userId)),
    Effect.catch((failure) =>
      Effect.as(Effect.logWarning("the auth service read no session", failure), Option.none()),
    ),
  );
}

const connectInstallation = /* @__PURE__ */ Effect.fn("web/connectInstallation")(function* (
  seams: GitHubInstallSeams,
  request: Request,
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
  if (code === null) return GITHUB_INSTALL_STATUS.NOT_FOUND;
  const workspace = yield* workspaceOf(userId, organizationId);
  if (Option.isNone(workspace) || !GITHUB_CONNECT_ROLES.has(workspace.value.role)) {
    return GITHUB_INSTALL_STATUS.EXPIRED;
  }
  const installer = yield* signedInAs(seams, request, userId);
  const installation = yield* authorizedInstallation(
    installationId,
    { code, codeVerifier, redirectUri: callback },
    installer,
  );
  if (Option.isNone(installation)) return GITHUB_INSTALL_STATUS.NOT_FOUND;
  const held = yield* installationsOfWorkspace(organizationId);
  const linked = yield* linkInstallationAs(userId, organizationId, installation.value);
  if (
    linked === LINK_OUTCOME.LINKED &&
    !held.some((each) => each.installationId === installationId)
  ) {
    yield* recordServerEvent(
      SERVER_EVENT.GITHUB_APP_INSTALL,
      { userId, workspaceId: organizationId },
      {},
    );
  }
  return LANDED_ON_LINK[linked];
});

function landedOnFailure(failure: GitHubWorkspaceReadFailure): Effect.Effect<GitHubInstallStatus> {
  return Effect.as(logWorkspaceReadFailure(failure), GITHUB_INSTALL_STATUS.UNAVAILABLE);
}

const requestQuery = Effect.gen(function* () {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const url = new URL(request.url);
  return {
    request,
    callback: new URL(HOSTED_SERVICE_PATH.GITHUB_INSTALLED_AUTHORIZED, url.origin).toString(),
    query: url.searchParams,
  };
});

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

const authorizedEndpoint = (seams: GitHubInstallSeams) =>
  Effect.gen(function* () {
    const { request, callback, query } = yield* requestQuery;
    const settled = connectInstallation(
      seams,
      request,
      query.get(AUTHORIZED_QUERY.CODE),
      query.get(AUTHORIZED_QUERY.STATE),
      callback,
    );
    return landing(yield* Effect.catch(settled, landedOnFailure));
  });

export function githubInstallApp(
  seams: GitHubInstallSeams,
): WebRoutes<GitHubApp | HttpClient.HttpClient | DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.GITHUB_INSTALL, installEndpoint),
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.GITHUB_INSTALLED, installedEndpoint),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.GITHUB_INSTALLED_AUTHORIZED,
      authorizedEndpoint(seams),
    ),
    hostedNotFoundRoute,
  );
}
