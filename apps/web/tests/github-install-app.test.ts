import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { GITHUB_INSTALL_STATUS, HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Layer, Redacted } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { test } from "vitest";
import { GitHubApp, type GitHubAppSettings } from "../server/github/github-app.js";
import { githubInstallApp } from "../server/github-install-app.js";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http.js";

/**
 * The install group over the real `GitHubApp` with GitHub a fake behind the
 * `HttpClient`. Both routes are browser navigations, so what each case holds
 * is where the browser is sent: to GitHub's install page, or on to the
 * landing page with the one status word the route settled on, whatever
 * GitHub sent or failed to send.
 *
 * Synthetic key and secrets throughout.
 */

const ORIGIN = "https://luke.test";
const INSTALLATION_ID = 777;
const LANDING = "/github-installed.html?status=";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const SETTINGS: GitHubAppSettings = {
  appId: "4242",
  slug: "luke",
  clientId: "Iv1.fixture-client-id",
  clientSecret: Redacted.make("fixture-client-secret"),
  privateKey: Redacted.make(privateKey.export({ type: "pkcs1", format: "pem" }).toString()),
  sessionSecret: Redacted.make("fixture-session-secret-of-enough-length"),
};

interface Sent {
  readonly url: string;
  readonly authorization: string | null;
}

/** GitHub knowing one installation of the App, every request written down. */
function githubKnowing(installationId: number | undefined, status: number = HOSTED_HTTP_STATUS.OK) {
  const sent: Sent[] = [];
  const layer = fakeHttpClientLayer((url, init) => {
    sent.push({ url, authorization: new Headers(init.headers).get("authorization") });
    if (status !== HOSTED_HTTP_STATUS.OK) return new Response(null, { status });
    return url.endsWith(`/app/installations/${installationId}`)
      ? Response.json({
          id: installationId,
          account: { login: "octocat" },
          repository_selection: "all",
        })
      : Response.json({ message: "Not Found" }, { status: HOSTED_HTTP_STATUS.NOT_FOUND });
  });
  return { layer, sent };
}

/** The group's answer over the fake GitHub, with the App configured or, for a deployment without one, not. */
function answer(
  path: string,
  github: ReturnType<typeof githubKnowing>,
  configured = true,
): Promise<Response> {
  const { handler } = HttpRouter.toWebHandler(
    githubInstallApp().pipe(
      HttpRouter.provideRequest(
        Layer.mergeAll(
          github.layer,
          GitHubApp.layer(configured ? SETTINGS : undefined, ["GITHUB_APP_SLUG"]),
        ),
      ),
    ),
    { disableLogger: true },
  );
  return handler(new Request(`${ORIGIN}${path}`, { redirect: "manual" }));
}

function setupUrl(query: Record<string, string>): string {
  return `${HOSTED_SERVICE_PATH.GITHUB_INSTALLED}?${new URLSearchParams(query)}`;
}

test("the install door sends the browser to GitHub's install page for the App", async () => {
  const github = githubKnowing(INSTALLATION_ID);
  const response = await answer(HOSTED_SERVICE_PATH.GITHUB_INSTALL, github);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://github.com/apps/luke/installations/new");
  assert.equal(github.sent.length, 0);
});

test("without the App configured, both doors land on the page saying GitHub could not be reached", async () => {
  const github = githubKnowing(INSTALLATION_ID);
  const install = await answer(HOSTED_SERVICE_PATH.GITHUB_INSTALL, github, false);
  const installed = await answer(
    setupUrl({ installation_id: String(INSTALLATION_ID), setup_action: "install" }),
    github,
    false,
  );
  for (const response of [install, installed]) {
    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("location"),
      `${LANDING}${GITHUB_INSTALL_STATUS.UNAVAILABLE}`,
    );
  }
  assert.equal(github.sent.length, 0);
});

test("an install GitHub confirms as this App's lands as installed, asked for as the App itself", async () => {
  const github = githubKnowing(INSTALLATION_ID);
  const response = await answer(
    setupUrl({ installation_id: String(INSTALLATION_ID), setup_action: "install" }),
    github,
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${LANDING}${GITHUB_INSTALL_STATUS.INSTALLED}`);
  const [read] = github.sent;
  assert.equal(read?.url, `https://api.github.com/app/installations/${INSTALLATION_ID}`);
  // The App's JWT, never its client secret, is what asks.
  assert.match(
    read?.authorization ?? "",
    /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u,
  );
  assert.equal(read?.authorization?.includes("fixture-client-secret"), false);
});

test("a repository change on a standing installation lands as updated", async () => {
  const response = await answer(
    setupUrl({ installation_id: String(INSTALLATION_ID), setup_action: "update" }),
    githubKnowing(INSTALLATION_ID),
  );
  assert.equal(response.headers.get("location"), `${LANDING}${GITHUB_INSTALL_STATUS.UPDATED}`);
});

test("an install request to an organization's owner lands as requested, with nothing to confirm", async () => {
  const github = githubKnowing(INSTALLATION_ID);
  const response = await answer(setupUrl({ setup_action: "request" }), github);
  assert.equal(response.headers.get("location"), `${LANDING}${GITHUB_INSTALL_STATUS.REQUESTED}`);
  assert.equal(github.sent.length, 0);
});

test("an installation GitHub does not know as this App's, a missing id, and a malformed id all land as not found", async () => {
  const github = githubKnowing(INSTALLATION_ID);
  const unknown = await answer(
    setupUrl({ installation_id: String(INSTALLATION_ID + 1), setup_action: "install" }),
    github,
  );
  const missing = await answer(setupUrl({ setup_action: "install" }), github);
  const malformed = await answer(
    setupUrl({ installation_id: "../app", setup_action: "install" }),
    github,
  );
  for (const response of [unknown, missing, malformed]) {
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), `${LANDING}${GITHUB_INSTALL_STATUS.NOT_FOUND}`);
  }
  assert.equal(github.sent.length, 1);
});

test("GitHub refusing the read lands as unavailable, not as a failure the browser sees", async () => {
  const response = await answer(
    setupUrl({ installation_id: String(INSTALLATION_ID), setup_action: "install" }),
    githubKnowing(INSTALLATION_ID, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), `${LANDING}${GITHUB_INSTALL_STATUS.UNAVAILABLE}`);
});

test("a path the group declares no route for is the hosted not-found", async () => {
  const response = await answer("/api/github/elsewhere", githubKnowing(INSTALLATION_ID));
  assert.equal(response.status, HOSTED_HTTP_STATUS.NOT_FOUND);
  assert.deepEqual(await response.json(), { error: "not-found" });
});
