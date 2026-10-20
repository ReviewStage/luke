import assert from "node:assert/strict";
import { verify } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "@luke/database/github-installation-vocabulary";
import { readGitHubTokenRow } from "@luke/database/models/github-token-store";
import { listWorkspaces } from "@luke/database/models/workspace-store";
import { account } from "@luke/database/schemas/auth";
import { getTestDB, openWorkspace } from "@luke/database/testing";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { GITHUB_TOKEN_STATUS } from "@luke/features/github-token-wire";
import { REPOSITORY_UNREACHED } from "@luke/features/repository-reach-wire";
import { generateCodeChallenge } from "better-auth/oauth2";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, vi } from "vitest";
import { AUTH_SECRET_ENVIRONMENT, GITHUB_APP_ENVIRONMENT } from "../auth/auth-deployment.js";
import {
  connectWorkspaceGitHub,
  fakeGitHub,
  GITHUB_APP_PUBLIC_KEY,
  GITHUB_APP_SETTINGS,
  GITHUB_APP_WITH_TOKENS,
  GITHUB_FIXTURE,
  GITHUB_FIXTURE_AUTHORIZED_TOKEN,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  GITHUB_FIXTURE_MEMBER,
  GITHUB_FIXTURE_REFUSED_CODE,
  githubReaching,
  type InstallationFixture,
  memberRepositoryJson,
  openGithubUser,
  openTokenMember,
  type SentToGitHub,
  standingGithubRow,
} from "../testing/github-app-fake.js";
import { GITHUB_REPOSITORY_SELECTION, GitHubApp } from "./github-app.js";
import {
  installationsOfWorkspace,
  mendInstallationStatus,
  setInstallationStatus,
} from "./github-installations.js";

/**
 * The Luke GitHub App's server client with GitHub a fake behind the
 * `HttpClient` and the rows on a real Postgres dialect. What is held here:
 * the App speaks as itself with a JWT its own key signed; an installation is
 * confirmed as the App's own or not at all; a workspace's repositories are
 * those of every installation connected to it, combined, and none where
 * nothing is connected; a repository outside that installation is unreachable, and only
 * one inside it admits the one token the App mints, for that repository
 * alone with contents read; a connect's one-time code is exchanged with its
 * PKCE verifier, read for the installations it sees, and revoked; and a
 * signed-in user's token stays sealed on its row. Every failure carries a
 * kind or a status and never a token.
 *
 * Synthetic keys, secrets, and tokens throughout (`support/github-app-fake.ts`).
 */

const { APP_ID } = GITHUB_FIXTURE;
const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const INSTALLATION_ID = 777;

function installationJson(id: number): Response {
  return Response.json({
    id,
    account: { login: "octo-org", id: 7_001, type: "Organization" },
    repository_selection: GITHUB_REPOSITORY_SELECTION.SELECTED,
    app_id: Number(APP_ID),
  });
}

/** A JWT's three parts, the signature checked against the App's public key. */
function readJwt(jwt: string) {
  const [header, payload, signature] = jwt.split(".");
  assert.ok(header && payload && signature);
  const signed = verify(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    GITHUB_APP_PUBLIC_KEY,
    Buffer.from(signature, "base64url"),
  );
  return {
    signed,
    header: JSON.parse(Buffer.from(header, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload, "base64url").toString()),
  };
}

it.effect(
  "an installation is read as the App, and only one GitHub knows as this App's is an installation",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const fake = fakeGitHub((sent) =>
        sent.url.endsWith(`/app/installations/${INSTALLATION_ID}`)
          ? installationJson(INSTALLATION_ID)
          : Response.json({ message: "Not Found" }, { status: 404 }),
      );
      const app = yield* GitHubApp;

      const found = yield* app.installation(INSTALLATION_ID).pipe(Effect.provide(fake.layer));
      const missing = yield* app.installation(INSTALLATION_ID + 1).pipe(Effect.provide(fake.layer));

      assert.deepEqual(Option.getOrUndefined(found), {
        id: INSTALLATION_ID,
        accountLogin: "octo-org",
        accountId: 7_001,
        accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
        repositorySelection: GITHUB_REPOSITORY_SELECTION.SELECTED,
        ciReadable: false,
        issuesReadable: false,
        suspended: false,
      });
      assert.equal(Option.isNone(missing), true);
      const [read] = fake.sent;
      assert.ok(read);
      assert.equal(read.url, `https://api.github.com/app/installations/${INSTALLATION_ID}`);
      assert.equal(read.headers.get("accept"), "application/vnd.github+json");
      assert.equal(read.headers.get("x-github-api-version"), "2022-11-28");
      assert.ok(read.headers.get("user-agent"));
      const bearer = read.headers.get("authorization") ?? "";
      assert.match(bearer, /^Bearer /u);
      assert.equal(readJwt(bearer.slice("Bearer ".length)).payload.iss, APP_ID);
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
);

const ENVIRONMENT_NAMES = [
  ...Object.values(GITHUB_APP_ENVIRONMENT),
  AUTH_SECRET_ENVIRONMENT.SESSION_SECRET,
];

beforeEach(() => {
  for (const name of ENVIRONMENT_NAMES) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The octo-org installation under the id given, since one installation connects to one workspace and the suite's tests share a database. */
const relayInstallation = (id: number): InstallationFixture => ({
  id,
  login: "octo-org",
  repositories: [
    { owner: "octo-org", name: "relay", defaultBranch: "trunk", updatedAt: "2026-10-02T00:00:00Z" },
    { owner: "octo-org", name: "ledger", updatedAt: "2026-10-03T00:00:00Z" },
  ],
});

/** The permissions of every token GitHub was asked to mint for a repository, in the order asked. */
function repositoryMints(sent: readonly SentToGitHub[]): readonly unknown[] {
  return sent
    .filter((one) => one.url.endsWith("/access_tokens") && "repositories" in JSON.parse(one.body))
    .map((one) => JSON.parse(one.body).permissions);
}

const OTHER_INSTALLATION: InstallationFixture = {
  id: 3,
  login: "octocat",
  repositories: [{ owner: "octocat", name: "dotfiles" }],
};

it.layer(getTestDB())("a workspace's repositories through its installation", (it) => {
  it.effect(
    "a workspace's repositories are its installation's, listed on a token minted for the listing alone, and a workspace with nothing connected has none",
    () =>
      Effect.gen(function* () {
        const relay = relayInstallation(2);
        const fake = githubReaching([relay, OTHER_INSTALLATION]);
        const owner = yield* openGithubUser();
        const connected = yield* openWorkspace(owner);
        const bare = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(connected, relay);
        const app = yield* GitHubApp;

        const listed = yield* app.workspaceRepositories(connected).pipe(Effect.provide(fake.layer));
        const none = yield* app.workspaceRepositories(bare).pipe(Effect.provide(fake.layer));

        assert.deepEqual(
          Option.map(listed, (repositories) => repositories.map((one) => one.fullName)),
          Option.some(["octo-org/ledger", "octo-org/relay"]),
        );
        assert.ok(Option.isNone(none));
        const [mint] = fake.sent.filter((sent) => sent.url.endsWith("/access_tokens"));
        assert.ok(mint);
        assert.equal(mint.url, "https://api.github.com/app/installations/2/access_tokens");
        assert.deepEqual(JSON.parse(mint.body), { permissions: { metadata: "read" } });
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a read token is minted as the App for one repository of the workspace's installation, with contents read, and none for a repository outside it",
    () =>
      Effect.gen(function* () {
        const relay = relayInstallation(4);
        const fake = githubReaching([relay, OTHER_INSTALLATION]);
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(workspace, relay);
        const app = yield* GitHubApp;

        const minted = yield* app
          .repositoryReadToken(workspace, "Octo-Org/Relay", undefined)
          .pipe(Effect.provide(fake.layer));
        const missing = yield* app
          .repositoryReadToken(workspace, "octo-org/absent", undefined)
          .pipe(Effect.provide(fake.layer));
        const elsewhere = yield* app
          .repositoryReadToken(workspace, "octocat/dotfiles", undefined)
          .pipe(Effect.provide(fake.layer));

        assert.ok(Option.isSome(minted));
        assert.equal(minted.value.repository.fullName, "octo-org/relay");
        assert.equal(minted.value.repository.defaultBranch, "trunk");
        assert.equal(Redacted.value(minted.value.token), GITHUB_FIXTURE_INSTALLATION_TOKEN);
        assert.equal(String(minted.value.token).includes(GITHUB_FIXTURE_INSTALLATION_TOKEN), false);
        assert.ok(Option.isNone(missing));
        assert.ok(Option.isNone(elsewhere));
        // The repository's mint is the App's own request, under its JWT, naming the one repository and contents read.
        const mints = fake.sent.filter(
          (sent) => sent.url.endsWith("/access_tokens") && "repositories" in JSON.parse(sent.body),
        );
        assert.equal(mints.length, 1);
        const [mint] = mints;
        assert.ok(mint);
        assert.equal(mint.method, "POST");
        assert.equal(mint.url, "https://api.github.com/app/installations/4/access_tokens");
        assert.deepEqual(JSON.parse(mint.body), {
          repositories: ["relay"],
          permissions: { contents: "read" },
        });
        assert.equal(
          readJwt((mint.headers.get("authorization") ?? "").slice("Bearer ".length)).payload.iss,
          APP_ID,
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("a mint GitHub refuses is unavailable by status, never a token", () =>
    Effect.gen(function* () {
      const relay = relayInstallation(6);
      const refusing = githubReaching([relay], undefined, {}, (sent) =>
        sent.url.endsWith("/access_tokens") && "repositories" in JSON.parse(sent.body)
          ? Response.json({ message: "Resource not accessible by integration" }, { status: 403 })
          : undefined,
      );
      const owner = yield* openGithubUser();
      const workspace = yield* openWorkspace(owner);
      yield* connectWorkspaceGitHub(workspace, relay);
      const app = yield* GitHubApp;

      const failure = yield* app
        .repositoryReadToken(workspace, "octo-org/relay", undefined)
        .pipe(Effect.provide(refusing.layer), Effect.flip);

      assert.ok(failure._tag === "GitHubUnavailable");
      assert.equal(failure.status, 403);
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("a repository the workspace reaches is its reach, spelled as GitHub spells it", () =>
    Effect.gen(function* () {
      const relay = relayInstallation(20);
      const fake = githubReaching([relay]);
      const workspace = yield* openWorkspace(yield* openGithubUser());
      yield* connectWorkspaceGitHub(workspace, relay);
      const app = yield* GitHubApp;

      const reach = yield* app
        .repositoryReach(workspace, "Octo-Org/Relay", undefined)
        .pipe(Effect.provide(fake.layer));

      assert.equal(
        Result.getOrUndefined(Result.map(reach, (reached) => reached.repository.fullName)),
        "octo-org/relay",
      );
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect("a workspace with nothing connected reaches no repository, and says so", () =>
    Effect.gen(function* () {
      const fake = githubReaching([relayInstallation(22)]);
      const workspace = yield* openWorkspace(yield* openGithubUser());
      const app = yield* GitHubApp;

      const reach = yield* app
        .repositoryReach(workspace, "octo-org/relay", undefined)
        .pipe(Effect.provide(fake.layer));

      assert.deepEqual(
        Result.getFailure(reach),
        Option.some({
          reason: REPOSITORY_UNREACHED.NOT_CONNECTED,
          repository: "octo-org/relay",
        }),
      );
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "an installation GitHub no longer knows, or one its account suspended, is a connection that lapsed",
    () =>
      Effect.gen(function* () {
        const uninstalled = relayInstallation(24);
        const suspended = { ...relayInstallation(26), suspendedAt: "2026-10-10T00:00:00Z" };
        const fake = githubReaching([suspended]);
        const owner = yield* openGithubUser();
        const gone = yield* openWorkspace(owner);
        const paused = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(gone, uninstalled);
        yield* connectWorkspaceGitHub(paused, suspended);
        const app = yield* GitHubApp;

        const reaches = yield* Effect.forEach([gone, paused], (workspace) =>
          app
            .repositoryReach(workspace, "octo-org/relay", undefined)
            .pipe(Effect.provide(fake.layer)),
        );

        assert.deepEqual(
          reaches.map(Result.getFailure),
          [gone, paused].map(() =>
            Option.some({
              reason: REPOSITORY_UNREACHED.CONNECTION_LAPSED,
              repository: "octo-org/relay",
            }),
          ),
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a read that finds the installation suspended or gone leaves its workspace's GitHub inactive, and one that finds it running again active, so a delivery GitHub never made is mended",
    () =>
      Effect.gen(function* () {
        const running = relayInstallation(40);
        const suspended = { ...running, suspendedAt: "2026-10-10T00:00:00Z" };
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(workspace, running);
        const app = yield* GitHubApp;
        const active = () =>
          Effect.map(listWorkspaces(owner), (workspaces) =>
            workspaces.filter((each) => each.id === workspace).map((each) => each.github?.active),
          );

        yield* app
          .workspaceRepositories(workspace)
          .pipe(Effect.provide(githubReaching([suspended]).layer));
        const afterSuspension = yield* active();
        yield* app
          .repositoryReach(workspace, "octo-org/relay", undefined)
          .pipe(Effect.provide(githubReaching([running]).layer));
        const afterReturn = yield* active();
        yield* app.workspaceRepositories(workspace).pipe(Effect.provide(githubReaching([]).layer));
        const afterRemoval = yield* active();

        assert.deepEqual([afterSuspension, afterReturn, afterRemoval], [[false], [true], [false]]);
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a read's mend leaves a status a webhook moved while GitHub was being asked as the webhook left it",
    () =>
      Effect.gen(function* () {
        const running = relayInstallation(42);
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(workspace, running);
        const [read] = yield* installationsOfWorkspace(workspace);
        assert.ok(read !== undefined);

        yield* TestClock.adjust("1 second");
        yield* setInstallationStatus(running.id, GITHUB_INSTALLATION_STATUS.SUSPENDED);
        yield* mendInstallationStatus(read, GITHUB_INSTALLATION_STATUS.DELETED);
        const listed = yield* listWorkspaces(owner);

        assert.deepEqual(
          listed.filter((each) => each.id === workspace).map((each) => each.github?.active),
          [false],
        );
        const [after] = yield* installationsOfWorkspace(workspace);
        assert.equal(after?.status, GITHUB_INSTALLATION_STATUS.SUSPENDED);
      }),
  );

  it.effect(
    "a repository of another account than the installation's is out of reach, naming the account it is on",
    () =>
      Effect.gen(function* () {
        const relay = relayInstallation(28);
        const fake = githubReaching([relay]);
        const workspace = yield* openWorkspace(yield* openGithubUser());
        yield* connectWorkspaceGitHub(workspace, relay);
        const app = yield* GitHubApp;

        const reach = yield* app
          .repositoryReach(workspace, "octocat/dotfiles", undefined)
          .pipe(Effect.provide(fake.layer));

        assert.deepEqual(
          Result.getFailure(reach),
          Option.some({
            reason: REPOSITORY_UNREACHED.OTHER_OWNER,
            repository: "octocat/dotfiles",
            connectedTo: "octo-org",
          }),
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a repository an installation of chosen repositories was not given is out of reach, with the settings page where it is given",
    () =>
      Effect.gen(function* () {
        const organization = {
          ...relayInstallation(30),
          accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
        };
        const personal = {
          id: 32,
          login: "octocat",
          repositories: [{ owner: "octocat", name: "dotfiles" }],
        };
        const fake = githubReaching([organization, personal]);
        const owner = yield* openGithubUser();
        const ofOrganization = yield* openWorkspace(owner);
        const ofUser = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(ofOrganization, organization);
        yield* connectWorkspaceGitHub(ofUser, personal);
        const app = yield* GitHubApp;

        const fromOrganization = yield* app
          .repositoryReach(ofOrganization, "octo-org/absent", undefined)
          .pipe(Effect.provide(fake.layer));
        const fromUser = yield* app
          .repositoryReach(ofUser, "octocat/absent", undefined)
          .pipe(Effect.provide(fake.layer));

        assert.deepEqual(
          Result.getFailure(fromOrganization),
          Option.some({
            reason: REPOSITORY_UNREACHED.NOT_SELECTED,
            repository: "octo-org/absent",
            settingsUrl: "https://github.com/organizations/octo-org/settings/installations/30",
          }),
        );
        assert.deepEqual(
          Result.getFailure(fromUser),
          Option.some({
            reason: REPOSITORY_UNREACHED.NOT_SELECTED,
            repository: "octocat/absent",
            settingsUrl: "https://github.com/settings/installations/32",
          }),
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a repository an installation of every repository does not list is gone: renamed, transferred, or deleted",
    () =>
      Effect.gen(function* () {
        const relay = { ...relayInstallation(34), repositorySelection: "all" as const };
        const fake = githubReaching([relay]);
        const workspace = yield* openWorkspace(yield* openGithubUser());
        yield* connectWorkspaceGitHub(workspace, relay);
        const app = yield* GitHubApp;

        const reach = yield* app
          .repositoryReach(workspace, "octo-org/renamed", undefined)
          .pipe(Effect.provide(fake.layer));

        assert.deepEqual(
          Result.getFailure(reach),
          Option.some({
            reason: REPOSITORY_UNREACHED.GONE,
            repository: "octo-org/renamed",
          }),
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a workspace holding installations on several accounts lists every one's repositories, all their pages, as one list newest first, each repository once however it is cased",
    () =>
      Effect.gen(function* () {
        const many = Array.from({ length: 150 }, (_, index) => ({
          owner: "octo-org",
          name: `service-${String(index).padStart(3, "0")}`,
          updatedAt: "2026-09-01T00:00:00Z",
        }));
        const organization: InstallationFixture = {
          id: 140,
          login: "octo-org",
          repositories: [
            ...many,
            { owner: "octo-org", name: "relay", updatedAt: "2026-10-05T00:00:00Z" },
          ],
        };
        const personal: InstallationFixture = {
          id: 142,
          login: "octocat",
          repositories: [
            { owner: "octocat", name: "dotfiles", updatedAt: "2026-10-06T00:00:00Z" },
            // A transfer GitHub has not settled both installations on yet lists one repository twice.
            { owner: "Octo-Org", name: "Relay", updatedAt: "2026-10-04T00:00:00Z" },
          ],
        };
        const fake = githubReaching([organization, personal]);
        const workspace = yield* openWorkspace(yield* openGithubUser());
        yield* connectWorkspaceGitHub(workspace, organization);
        yield* connectWorkspaceGitHub(workspace, personal);
        const app = yield* GitHubApp;

        const listed = yield* app.workspaceRepositories(workspace).pipe(Effect.provide(fake.layer));

        const names = Option.getOrElse(
          Option.map(listed, (repositories) => repositories.map((one) => one.fullName)),
          () => [],
        );
        assert.equal(names.length, 152);
        assert.deepEqual(names.slice(0, 3), [
          "octocat/dotfiles",
          "octo-org/relay",
          "octo-org/service-000",
        ]);
        assert.equal(names.filter((name) => name.toLowerCase() === "octo-org/relay").length, 1);
        assert.deepEqual(
          fake.sent
            .filter((sent) => sent.url.endsWith("/access_tokens"))
            .map((sent) => sent.url.split("/").at(-2)),
          ["140", "142"],
        );
        assert.equal(
          fake.sent.filter((sent) => sent.url.includes("/installation/repositories")).length,
          3,
          "the organization's two pages and the account's one",
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "one installation's listing GitHub refuses fails the whole read, and a workspace whose every installation lapsed lists none",
    () =>
      Effect.gen(function* () {
        const organization = relayInstallation(144);
        const personal: InstallationFixture = {
          id: 146,
          login: "octocat",
          repositories: [{ owner: "octocat", name: "dotfiles" }],
        };
        const refusing = githubReaching([organization, personal], undefined, {}, (sent) =>
          sent.url.endsWith("/app/installations/146/access_tokens")
            ? Response.json({ message: "Server Error" }, { status: 502 })
            : undefined,
        );
        const suspended = { ...relayInstallation(148), suspendedAt: "2026-10-10T00:00:00Z" };
        const lapsing = githubReaching([suspended]);
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const lapsed = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(workspace, organization);
        yield* connectWorkspaceGitHub(workspace, personal);
        yield* connectWorkspaceGitHub(lapsed, suspended);
        yield* connectWorkspaceGitHub(lapsed, { ...relayInstallation(150), login: "gone-org" });
        const app = yield* GitHubApp;

        const failure = yield* app
          .workspaceRepositories(workspace)
          .pipe(Effect.provide(refusing.layer), Effect.flip);
        const none = yield* app.workspaceRepositories(lapsed).pipe(Effect.provide(lapsing.layer));

        assert.ok(failure._tag === "GitHubUnavailable");
        assert.equal(failure.status, 502);
        assert.ok(Option.isNone(none));
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a repository's token is minted on the workspace's own installation on its owner, however the owner is cased, and never on another workspace's",
    () =>
      Effect.gen(function* () {
        const organization = relayInstallation(152);
        const personal: InstallationFixture = {
          id: 154,
          login: "octocat",
          repositories: [{ owner: "octocat", name: "dotfiles" }],
        };
        const elsewhere: InstallationFixture = {
          id: 156,
          login: "third-org",
          repositories: [{ owner: "third-org", name: "secret" }],
        };
        const fake = githubReaching([organization, personal, elsewhere]);
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const other = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(workspace, organization);
        yield* connectWorkspaceGitHub(workspace, personal);
        yield* connectWorkspaceGitHub(other, elsewhere);
        const app = yield* GitHubApp;

        const dotfiles = yield* app
          .repositoryReadToken(workspace, "OctoCat/Dotfiles", undefined)
          .pipe(Effect.provide(fake.layer));
        const relay = yield* app
          .repositoryReadToken(workspace, "OCTO-ORG/relay", undefined)
          .pipe(Effect.provide(fake.layer));
        const secret = yield* app
          .repositoryReach(workspace, "third-org/secret", undefined)
          .pipe(Effect.provide(fake.layer));

        assert.deepEqual(
          [dotfiles, relay].map((minted) => Option.map(minted, (one) => one.repository.fullName)),
          [Option.some("octocat/dotfiles"), Option.some("octo-org/relay")],
        );
        assert.deepEqual(
          fake.sent
            .filter(
              (sent) =>
                sent.url.endsWith("/access_tokens") && "repositories" in JSON.parse(sent.body),
            )
            .map((sent) => sent.url.split("/").at(-2)),
          ["154", "152"],
        );
        assert.deepEqual(
          Result.getFailure(secret),
          Option.some({ reason: REPOSITORY_UNREACHED.OTHER_OWNER, repository: "third-org/secret" }),
        );
        assert.equal(
          fake.sent.some((sent) => sent.url.includes("/installations/156")),
          false,
          "another workspace's installation is never asked",
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "the sign-in's token stays sealed on its row: what the table holds is not the token",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const now = yield* Clock.currentTimeMillis;
        const userId = yield* openGithubUser(standingGithubRow(now));
        const [row] = yield* db
          .select({ accessToken: account.accessToken, refreshToken: account.refreshToken })
          .from(account)
          .where(eq(account.userId, userId));
        assert.ok(row);
        assert.notEqual(row.accessToken, standingGithubRow(0).accessToken);
        assert.notEqual(row.refreshToken, standingGithubRow(0).refreshToken);
      }),
  );

  it.effect(
    "a repository token is kept for the instance's next asks of its workspace, a write token is minted afresh at every ask, and another workspace asking the same repository is answered by its own reach alone",
    () =>
      Effect.gen(function* () {
        const relay = relayInstallation(200);
        const fake = githubReaching([relay]);
        const owner = yield* openGithubUser();
        const workspace = yield* openWorkspace(owner);
        const bare = yield* openWorkspace(owner);
        yield* connectWorkspaceGitHub(workspace, relay);
        const app = yield* GitHubApp;
        const ask = <A, E, R>(read: Effect.Effect<A, E, R>) =>
          read.pipe(Effect.provide(fake.layer));

        const first = yield* ask(
          app.repositoryPullRequestToken(workspace, "octo-org/relay", undefined),
        );
        const again = yield* ask(
          app.repositoryPullRequestToken(workspace, "octo-org/relay", undefined),
        );
        const read = yield* ask(app.repositoryReadToken(workspace, "octo-org/relay", undefined));
        yield* ask(app.repositoryWriteToken(workspace, "octo-org/relay", undefined));
        yield* ask(app.repositoryWriteToken(workspace, "octo-org/relay", undefined));
        const elsewhere = yield* ask(
          app.repositoryPullRequestToken(bare, "octo-org/relay", undefined),
        );

        assert.ok(Option.isSome(first) && Option.isSome(again) && Option.isSome(read));
        assert.equal(Redacted.value(again.value.token), GITHUB_FIXTURE_INSTALLATION_TOKEN);
        assert.ok(Option.isNone(elsewhere));
        assert.deepEqual(repositoryMints(fake.sent), [
          { contents: "read", pull_requests: "read" },
          { contents: "read" },
          { contents: "write", pull_requests: "write" },
          { contents: "write", pull_requests: "write" },
        ]);
        // The installation is read and its repositories listed once, for every mint after the first.
        assert.equal(fake.sent.filter((sent) => sent.url.endsWith("/installations/200")).length, 1);
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a kept reach whose installation the account reinstalled since mints through the installation the workspace now links, at once",
    () =>
      Effect.gen(function* () {
        const before: InstallationFixture = { ...relayInstallation(210), accountId: 60_210 };
        const after: InstallationFixture = { ...relayInstallation(211), accountId: 60_210 };
        const installations = [before];
        const fake = githubReaching(installations);
        const workspace = yield* openWorkspace(yield* openGithubUser());
        yield* connectWorkspaceGitHub(workspace, before);
        const app = yield* GitHubApp;
        const ask = () =>
          app
            .repositoryPullRequestToken(workspace, "octo-org/relay", undefined)
            .pipe(Effect.provide(fake.layer));

        const first = yield* ask();
        installations.splice(0, 1, after);
        yield* connectWorkspaceGitHub(workspace, after);
        const reinstalled = yield* ask();

        assert.ok(Option.isSome(first) && Option.isSome(reinstalled));
        assert.deepEqual(
          fake.sent
            .filter(
              (one) => one.url.endsWith("/access_tokens") && "repositories" in JSON.parse(one.body),
            )
            .map((one) => new URL(one.url).pathname),
          ["/app/installations/210/access_tokens", "/app/installations/211/access_tokens"],
        );
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a reach of an installation the store holds suspended but GitHub runs mends the store and is kept as it is, reading the installation once",
    () =>
      Effect.gen(function* () {
        const relay = relayInstallation(212);
        const fake = githubReaching([relay]);
        const workspace = yield* openWorkspace(yield* openGithubUser());
        yield* connectWorkspaceGitHub(workspace, relay);
        yield* setInstallationStatus(relay.id, GITHUB_INSTALLATION_STATUS.SUSPENDED);
        const app = yield* GitHubApp;

        const minted = yield* app
          .repositoryReadToken(workspace, "octo-org/relay", undefined)
          .pipe(Effect.provide(fake.layer));

        assert.ok(Option.isSome(minted));
        assert.deepEqual(
          (yield* installationsOfWorkspace(workspace)).map((one) => one.status),
          [GITHUB_INSTALLATION_STATUS.ACTIVE],
        );
        // What GitHub is asked is the behavior here: the mended reach is kept rather than read again.
        assert.equal(fake.sent.filter((one) => one.url.endsWith("/installations/212")).length, 1);
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );

  it.effect(
    "a mint GitHub refused, a repository not yet reached, and a token GitHub expires within the margin are never kept: the next ask asks GitHub again",
    () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const relay = relayInstallation(202);
        const repositories = [...relay.repositories];
        let refusing = true;
        const fake = githubReaching([{ ...relay, repositories }], undefined, {}, (sent) => {
          if (!sent.url.endsWith("/access_tokens") || !("repositories" in JSON.parse(sent.body))) {
            return undefined;
          }
          if (refusing) return Response.json({ message: "Bad Gateway" }, { status: 502 });
          return Response.json(
            {
              token: GITHUB_FIXTURE_INSTALLATION_TOKEN,
              expires_at: new Date(now + 5 * 60_000).toISOString(),
            },
            { status: 201 },
          );
        });
        const workspace = yield* openWorkspace(yield* openGithubUser());
        yield* connectWorkspaceGitHub(workspace, relay);
        const app = yield* GitHubApp;
        const ask = (fullName: string) =>
          app.repositoryReadToken(workspace, fullName, undefined).pipe(Effect.provide(fake.layer));

        const refused = yield* Effect.flip(ask("octo-org/relay"));
        refusing = false;
        const soonExpiring = yield* ask("octo-org/relay");
        const again = yield* ask("octo-org/relay");
        const unreached = yield* ask("octo-org/beacon");
        repositories.push({ owner: "octo-org", name: "beacon" });
        const reached = yield* ask("octo-org/beacon");

        assert.equal(refused._tag, "GitHubUnavailable");
        assert.ok(Option.isSome(soonExpiring) && Option.isSome(again));
        assert.ok(Option.isNone(unreached));
        assert.ok(Option.isSome(reached));
        assert.equal(repositoryMints(fake.sent).length, 4);
      }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
  );
});

/** A repository the member's own token reads, and whether it may push there. */
const MEMBER_REPOSITORIES = new Map([
  ["/repos/octo-member/side", { fixture: { owner: "octo-member", name: "side" }, push: true }],
  ["/repos/octo-org/relay", { fixture: { owner: "octo-org", name: "relay" }, push: true }],
  ["/repos/octo-member/fork", { fixture: { owner: "octo-member", name: "fork" }, push: false }],
]);

/** GitHub answering the member's own token, the fixture's, on the repositories above, and refusing it 401 where `refused` says so. */
const memberToken =
  (refused: () => boolean = () => false) =>
  (sent: SentToGitHub): Response | undefined => {
    if (sent.headers.get("authorization") !== `Bearer ${GITHUB_FIXTURE_MEMBER.TOKEN}`) {
      return sent.url.startsWith("https://api.github.com/repos/")
        ? Response.json({ message: "Not Found" }, { status: 404 })
        : undefined;
    }
    if (refused()) return Response.json({ message: "Bad credentials" }, { status: 401 });
    // GitHub folds case in a repository's path, as it does in its name.
    const known = MEMBER_REPOSITORIES.get(new URL(sent.url).pathname.toLowerCase());
    return known === undefined
      ? Response.json({ message: "Not Found" }, { status: 404 })
      : Response.json(memberRepositoryJson(known.fixture, known.push));
  };

/** Whether GitHub was asked anything on the member's own token. */
const askedOnToken = (sent: readonly SentToGitHub[]) =>
  sent.some((one) => one.headers.get("authorization") === `Bearer ${GITHUB_FIXTURE_MEMBER.TOKEN}`);

it.layer(getTestDB())("a repository on a member's own token", (it) => {
  it.effect(
    "the workspace's installation wins: a repository it reaches is reached and minted through it, and the member's token is never asked",
    () =>
      Effect.gen(function* () {
        const relay = relayInstallation(300);
        const fake = githubReaching([relay], GITHUB_APP_WITH_TOKENS, {}, memberToken());
        const member = yield* openTokenMember();
        const workspace = yield* openWorkspace(member);
        yield* connectWorkspaceGitHub(workspace, relay);
        const app = yield* GitHubApp;
        const ask = <A, E, R>(read: Effect.Effect<A, E, R>) =>
          read.pipe(Effect.provide(fake.layer));

        const reach = yield* ask(app.repositoryReach(workspace, "octo-org/relay", member));
        const write = yield* ask(app.repositoryWriteToken(workspace, "octo-org/relay", member));

        assert.equal(Result.getOrUndefined(reach)?.access, GITHUB_ACCESS.APP);
        assert.ok(Option.isSome(write));
        assert.equal(Redacted.value(write.value.token), GITHUB_FIXTURE_INSTALLATION_TOKEN);
        assert.deepEqual(write.value.access, { kind: GITHUB_ACCESS.APP });
        assert.equal(askedOnToken(fake.sent), false);
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );

  it.effect(
    "where no installation reaches a repository, the member's own token does where it may push, and hands back that token; one it may not push to or does not see is refused as the token's, and no member, or one who keeps no token, is answered as the installation answers",
    () =>
      Effect.gen(function* () {
        const fake = githubReaching([], GITHUB_APP_WITH_TOKENS, {}, memberToken());
        const member = yield* openTokenMember();
        const tokenless = yield* openGithubUser();
        const workspace = yield* openWorkspace(member);
        const app = yield* GitHubApp;
        const ask = <A, E, R>(read: Effect.Effect<A, E, R>) =>
          read.pipe(Effect.provide(fake.layer));
        const reason = (reach: Result.Result<unknown, { readonly reason: string }>) =>
          Result.isFailure(reach) ? reach.failure.reason : undefined;

        const reach = yield* ask(app.repositoryReach(workspace, "Octo-Member/Side", member));
        const write = yield* ask(app.repositoryWriteToken(workspace, "octo-member/side", member));
        const ci = yield* ask(app.repositoryCiReadable(workspace, "octo-member/side", member));
        const fork = yield* ask(app.repositoryReach(workspace, "octo-member/fork", member));
        const hidden = yield* ask(app.repositoryReach(workspace, "octo-member/hidden", member));
        const automation = yield* ask(
          app.repositoryReach(workspace, "octo-member/side", undefined),
        );
        const noToken = yield* ask(app.repositoryReach(workspace, "octo-member/side", tokenless));

        assert.deepEqual(
          Result.map(reach, (reached) => [reached.access, reached.repository.fullName]),
          Result.succeed([GITHUB_ACCESS.TOKEN, "octo-member/side"]),
        );
        assert.ok(Option.isSome(write));
        assert.equal(Redacted.value(write.value.token), GITHUB_FIXTURE_MEMBER.TOKEN);
        assert.deepEqual(write.value.access, {
          kind: GITHUB_ACCESS.TOKEN,
          githubLogin: GITHUB_FIXTURE_MEMBER.LOGIN,
          githubUserId: GITHUB_FIXTURE_MEMBER.ID,
        });
        assert.equal(ci, true);
        assert.equal(reason(fork), REPOSITORY_UNREACHED.TOKEN_CANNOT_PUSH);
        assert.equal(reason(hidden), REPOSITORY_UNREACHED.TOKEN_NO_ACCESS);
        assert.equal(reason(automation), REPOSITORY_UNREACHED.NOT_CONNECTED);
        assert.equal(reason(noToken), REPOSITORY_UNREACHED.NOT_CONNECTED);
        const read = fake.sent.find((one) => one.url.endsWith("/repos/Octo-Member/Side"));
        assert.ok(read);
        assert.equal(read.headers.get("accept"), "application/vnd.github+json");
        assert.equal(read.headers.get("x-github-api-version"), "2022-11-28");
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );

  it.effect(
    "a reach kept on the member's token gives way at once to an installation connected since on the repository's owner",
    () =>
      Effect.gen(function* () {
        const relay = relayInstallation(310);
        const fake = githubReaching([relay], GITHUB_APP_WITH_TOKENS, {}, memberToken());
        const member = yield* openTokenMember();
        const workspace = yield* openWorkspace(member);
        const app = yield* GitHubApp;
        const ask = () =>
          app
            .repositoryReadToken(workspace, "octo-org/relay", member)
            .pipe(Effect.provide(fake.layer));

        const before = yield* ask();
        yield* connectWorkspaceGitHub(workspace, relay);
        const after = yield* ask();

        assert.ok(Option.isSome(before) && Option.isSome(after));
        assert.equal(before.value.access.kind, GITHUB_ACCESS.TOKEN);
        assert.deepEqual(after.value.access, { kind: GITHUB_ACCESS.APP });
        assert.equal(Redacted.value(after.value.token), GITHUB_FIXTURE_INSTALLATION_TOKEN);
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );

  it.effect("a token GitHub answers 401 is marked invalid, and is not sent again", () =>
    Effect.gen(function* () {
      const fake = githubReaching(
        [],
        GITHUB_APP_WITH_TOKENS,
        {},
        memberToken(() => true),
      );
      const member = yield* openTokenMember();
      const workspace = yield* openWorkspace(member);
      const app = yield* GitHubApp;
      const ask = <A, E, R>(read: Effect.Effect<A, E, R>) => read.pipe(Effect.provide(fake.layer));

      const refused = yield* ask(app.repositoryReach(workspace, "octo-member/side", member));
      const sentBefore = fake.sent.length;
      const again = yield* ask(app.repositoryReadToken(workspace, "octo-member/side", member));
      const row = yield* readGitHubTokenRow(member);

      assert.deepEqual(
        Result.getFailure(refused),
        Option.some({
          reason: REPOSITORY_UNREACHED.TOKEN_INVALID,
          repository: "octo-member/side",
        }),
      );
      assert.ok(Option.isNone(again));
      assert.equal(row?.status, GITHUB_TOKEN_STATUS.INVALID);
      assert.equal(askedOnToken(fake.sent.slice(sentBefore)), false);
    }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );

  it.effect(
    "a reach kept for one member is never another's: a member whose own token does not see the repository is refused after another's token reached it",
    () =>
      Effect.gen(function* () {
        const fake = githubReaching([], GITHUB_APP_WITH_TOKENS, {}, memberToken());
        const member = yield* openTokenMember();
        const other = yield* openTokenMember({ token: "ghp_fixture_other_token" });
        const workspace = yield* openWorkspace(member);
        const app = yield* GitHubApp;
        const ask = <A, E, R>(read: Effect.Effect<A, E, R>) =>
          read.pipe(Effect.provide(fake.layer));

        const reached = yield* ask(app.repositoryReadToken(workspace, "octo-member/side", member));
        const theirs = yield* ask(app.repositoryReadToken(workspace, "octo-member/side", other));
        const none = yield* ask(app.repositoryReadToken(workspace, "octo-member/side", undefined));

        assert.ok(Option.isSome(reached));
        assert.ok(Option.isNone(theirs));
        assert.ok(Option.isNone(none));
      }).pipe(Effect.provide(GITHUB_APP_WITH_TOKENS)),
  );
});

const CALLBACK = "https://tryluke.dev/api/github/installed/authorized";
const VERIFIER = "fixture-code-verifier-of-enough-length-for-pkce-0123456789abcdef";

it.effect(
  "a connect is authorized on GitHub's web flow with the verifier's S256 challenge, and its code is exchanged with that verifier, read once for its installations, and revoked",
  () =>
    Effect.gen(function* () {
      const relay = relayInstallation(8);
      const fake = githubReaching([relay]);
      const app = yield* GitHubApp;

      const address = new URL(
        yield* app.authorizeUrl({
          redirectUri: CALLBACK,
          state: "intent-state",
          codeVerifier: VERIFIER,
        }),
      );
      const seen = yield* app
        .authorizedInstallations({
          code: "one-time",
          codeVerifier: VERIFIER,
          redirectUri: CALLBACK,
        })
        .pipe(Effect.provide(fake.layer));
      const refused = yield* app
        .authorizedInstallations({
          code: GITHUB_FIXTURE_REFUSED_CODE,
          codeVerifier: VERIFIER,
          redirectUri: CALLBACK,
        })
        .pipe(Effect.provide(fake.layer));

      assert.equal(
        `${address.origin}${address.pathname}`,
        "https://github.com/login/oauth/authorize",
      );
      assert.deepEqual(Object.fromEntries(address.searchParams), {
        client_id: GITHUB_FIXTURE.CLIENT_ID,
        redirect_uri: CALLBACK,
        state: "intent-state",
        code_challenge: yield* Effect.promise(() => generateCodeChallenge(VERIFIER)),
        code_challenge_method: "S256",
      });
      assert.deepEqual(
        Option.map(seen, (installations) => installations.map((one) => one.id)),
        Option.some([relayInstallation(8).id]),
      );
      assert.ok(Option.isNone(refused));
      const [exchange] = fake.sent;
      assert.ok(exchange);
      assert.equal(exchange.url, "https://github.com/login/oauth/access_token");
      const asked = new URLSearchParams(exchange.body);
      assert.equal(asked.get("code"), "one-time");
      assert.equal(asked.get("code_verifier"), VERIFIER);
      assert.equal(asked.get("redirect_uri"), CALLBACK);
      const read = fake.sent.find((sent) => sent.url.includes("/user/installations"));
      assert.equal(read?.headers.get("authorization"), `Bearer ${GITHUB_FIXTURE_AUTHORIZED_TOKEN}`);
      const revoked = fake.sent.filter((sent) => sent.method === "DELETE");
      assert.equal(revoked.length, 1);
      assert.equal(
        revoked[0]?.url,
        `https://api.github.com/applications/${GITHUB_FIXTURE.CLIENT_ID}/token`,
      );
      assert.deepEqual(JSON.parse(revoked[0]?.body ?? ""), {
        access_token: GITHUB_FIXTURE_AUTHORIZED_TOKEN,
      });
    }).pipe(Effect.provide(GitHubApp.layer(GITHUB_APP_SETTINGS))),
);
