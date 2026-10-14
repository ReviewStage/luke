import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { noDatabase } from "@luke/database/testing/no-database";
import { GITHUB_INSTALL_STATUS, HOSTED_SERVICE_PATH } from "@luke/features";
import { HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { test } from "vitest";
import { GitHubApp, type GitHubAppSettings } from "../server/github/github-app.js";
import { githubInstallApp } from "../server/github-install-app.js";

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
          noDatabase,
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
