import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@sidecar/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "@sidecar/database/github-installation-vocabulary";
import {
  type CodingAgent,
  createCodingAgent,
  listPublishedCodingAgents,
  updateCodingAgentBranch,
} from "@sidecar/database/models/coding-agent-store";
import { listWorkspaces } from "@sidecar/database/models/workspace-store";
import { account, user } from "@sidecar/database/schemas/auth";
import { githubInstallation } from "@sidecar/database/schemas/github-installation";
import { getTestDB } from "@sidecar/database/testing";
import type { CodingAgentPullRequest } from "@sidecar/hosted/coding-agent-wire";
import type { WireBoundaryInput } from "@sidecar/wire";
import { eq } from "drizzle-orm";
import { Clock, DateTime, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { GITHUB_PROVIDER_ID } from "../server/github/github-app";
import { githubWebhookApp } from "../server/github-webhook-app";
import { HostedEnvironment, type HostedEnvironmentValues } from "../server/hosted/environment";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import {
  type FakeGitHub,
  githubReaching,
  openGithubUser,
  type SentToGitHub,
} from "./support/github-app-fake";
import { fakeWorkspaceSeams, startPlan } from "./support/workspaces";

/**
 * The Luke GitHub App's webhook, answered by its group the way a function
 * answers it, over a real dialect and a GitHub the test scripts: nothing of
 * a delivery is read before its signature over the body's own bytes holds
 * under the deployment's secret, a deployment with no secret refuses every
 * delivery, and a delivery about a pull request or its checks reads what the
 * agents on that branch published again on the owner's own token, which
 * the agent's row keeps for the plan list.
 *
 * Synthetic accounts, secrets, repositories, and deliveries throughout.
 */

const ORIGIN = "https://luke.test";
const WEBHOOK = "/api/github/webhook";
const SECRET = "whsec-fixture-luke";

const RELAY = { owner: "Acme", name: "Relay" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;
/** The head's commit; each test cuts a branch of its own, since the agents of every test share the database. */
const HEAD_SHA = "0123abcd";

/** The pull request as the test's GitHub holds it, changed by the test between deliveries. */
interface PullRequestFixture {
  state: "open" | "closed";
  merged: boolean;
  conclusion: string;
}

/** The repository's pull request from the agent's branch, read by number or by its head, with its head's one check run. */
function relayRepository(pull: PullRequestFixture, ref: string) {
  const base = `/repos/${RELAY.owner}/${RELAY.name}`;
  const pullJson = () => ({
    number: 41,
    title: "Teammate invitations",
    html_url: `https://github.com/${RELAY_FULL_NAME}/pull/41`,
    state: pull.state,
    draft: false,
    merged: pull.merged,
    additions: 210,
    deletions: 14,
    changed_files: 6,
    head: { ref, sha: HEAD_SHA },
  });
  return (sent: SentToGitHub): Response | undefined => {
    const url = new URL(sent.url);
    if (!url.pathname.startsWith(base)) return undefined;
    const path = url.pathname.slice(base.length);
    if (path === "/pulls") return Response.json([pullJson()]);
    if (path === "/pulls/41") return Response.json(pullJson());
    if (path === `/commits/${HEAD_SHA}/check-runs`) {
      return Response.json({
        total_count: 1,
        check_runs: [{ status: "completed", conclusion: pull.conclusion }],
      });
    }
    if (path === `/commits/${HEAD_SHA}/status`) {
      return Response.json({ state: "pending", total_count: 0, statuses: [] });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  };
}

/** The environment a deployment holds, with the webhook's secret or without it. */
function environment(secret: string | undefined): HostedEnvironmentValues {
  return {
    openAiKey: undefined,
    anthropicKey: undefined,
    posthogPersonalApiKey: undefined,
    posthogProjectId: undefined,
    posthogApiHost: undefined,
    posthogProjectApiKey: undefined,
    posthogIngestHost: undefined,
    cronSecret: undefined,
    githubWebhookSecret: secret === undefined ? undefined : Redacted.make(secret),
    providerKeyEncryptionKeys: undefined,
  };
}

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The group over the test's database, the GitHub given, and the secret given, answering one request. */
const answer = (github: FakeGitHub, secret: string | undefined, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, environment(secret)),
      github.layer,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      githubWebhookApp().pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body } satisfies Answer;
  });

/** A delivery of the event given, signed under the secret given, or carrying the signature given. */
function delivery(
  event: string,
  payload: WireBoundaryInput,
  signing: { readonly secret: string } | { readonly signature: string } = { secret: SECRET },
): Request {
  const body = JSON.stringify(payload);
  const signature =
    "signature" in signing
      ? signing.signature
      : `sha256=${createHmac("sha256", signing.secret).update(body).digest("hex")}`;
  return new Request(new URL(WEBHOOK, ORIGIN), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": randomUUID(),
      "x-hub-signature-256": signature,
    },
    body,
  });
}

const repository = { full_name: RELAY_FULL_NAME, private: true };

/** GitHub's delivery of a pull request's action, as much of it as matters and a little that does not. */
function pullRequestDelivery(action: string, ref: string) {
  return { action, repository, pull_request: { number: 41, title: "Ignored", head: { ref } } };
}

/** An account reaching the repository, with one agent on a plan about it, its row on the pull request's branch. */
const openAgent = (pull: PullRequestFixture) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const plan = yield* startPlan(owner, {
      name: "Teammate invitations",
      repository: RELAY_FULL_NAME,
    });
    const started = yield* createCodingAgent(owner, {
      planId: plan.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Teammate invitations\n",
      task: null,
      repository: RELAY_FULL_NAME,
    });
    const agent: CodingAgent = Option.getOrElse(started, () =>
      assert.fail("the start made no agent"),
    ).agent;
    const ref = `luke/teammate-invitations-${randomUUID()}`;
    yield* updateCodingAgentBranch(owner, agent.id, ref);
    const github = githubReaching([INSTALLATION], undefined, undefined, relayRepository(pull, ref));
    /** What the agent's row keeps of its pull request now. */
    const kept = (): Effect.Effect<
      CodingAgentPullRequest | null | undefined,
      unknown,
      DatabaseServices
    > =>
      Effect.map(
        listPublishedCodingAgents(owner, [plan.id]),
        (agents) => agents.find((each) => each.agent.id === agent.id)?.published,
      );
    return { github, kept, ref };
  });

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

it.layer(getTestDB())("the GitHub App's webhook", (it) => {
  it.effect(
    "a deployment holding no secret refuses every delivery, and a delivery whose signature does not hold is refused, each before GitHub is asked",
    () =>
      Effect.gen(function* () {
        const pull = { state: "closed", merged: true, conclusion: "success" } as const;
        const { github, kept, ref } = yield* openAgent({ ...pull });

        assert.deepEqual(
          yield* answer(
            github,
            undefined,
            delivery("pull_request", pullRequestDelivery("closed", ref)),
          ),
          refusal(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE),
        );
        for (const signing of [
          { secret: "not-the-secret" },
          { signature: "sha256=" },
          { signature: "" },
        ]) {
          assert.deepEqual(
            yield* answer(
              github,
              SECRET,
              delivery("pull_request", pullRequestDelivery("closed", ref), signing),
            ),
            refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
          );
        }
        assert.deepEqual(github.sent, []);
        assert.equal(yield* kept(), null);
        assert.deepEqual(
          yield* answer(github, SECRET, new Request(new URL(WEBHOOK, ORIGIN))),
          refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
        );
      }),
  );

  it.effect(
    "an installation removed or suspended leaves its workspace's GitHub account inactive, and one brought back active again",
    () =>
      Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const installationId = 900_000 + Math.floor(Math.random() * 90_000);
        const login = `acme-${randomUUID()}`;
        const github = githubReaching([{ id: installationId, login, repositories: [] }]);
        const { id: workspaceId } = yield* (yield* fakeWorkspaceSeams).createOrganization({
          name: "Acme",
          slug: login,
          userId: owner,
          metadata: {},
        });
        const now = yield* DateTime.nowAsDate;
        yield* Database.use((db) =>
          db.insert(githubInstallation).values({
            organizationId: workspaceId,
            installationId,
            accountId: installationId + 1,
            accountLogin: login,
            accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
            status: GITHUB_INSTALLATION_STATUS.ACTIVE,
            createdAt: now,
            updatedAt: now,
          }),
        );
        const connected = () =>
          Effect.map(listWorkspaces(owner), (workspaces) =>
            workspaces
              .filter((workspace) => workspace.id === workspaceId)
              .map(({ github: account }) => account),
          );
        const deliver = (action: string) =>
          answer(
            github,
            SECRET,
            delivery("installation", { action, installation: { id: installationId } }),
          );
        assert.deepEqual(yield* connected(), [{ login, active: true }]);

        yield* deliver("suspend");
        const suspended = yield* connected();
        yield* deliver("unsuspend");
        const unsuspended = yield* connected();
        yield* deliver("deleted");
        const deleted = yield* connected();

        assert.deepEqual(suspended, [{ login, active: false }]);
        assert.deepEqual(unsuspended, [{ login, active: true }]);
        assert.deepEqual(deleted, [{ login, active: false }]);
      }),
  );

  it.effect(
    "a user revoking the App's authorization unlinks that GitHub user alone, and the account keeps its Google sign-in",
    () =>
      Effect.gen(function* () {
        const githubUserIdOf = () => 800_000 + Math.floor(Math.random() * 90_000);
        const revoked = githubUserIdOf();
        const kept = revoked + 1;
        const accountWith = (githubUserId: number) =>
          Effect.gen(function* () {
            const userId = `user-${randomUUID()}`;
            yield* Database.use((db) =>
              db
                .insert(user)
                .values({ id: userId, name: "Test User", email: `${userId}@luke.test` }),
            );
            for (const [providerId, accountId] of [
              [GITHUB_PROVIDER_ID, String(githubUserId)],
              ["google", `google-${userId}`],
            ] as const) {
              yield* Database.use((db) =>
                db.insert(account).values({
                  id: `account-${randomUUID()}`,
                  accountId,
                  providerId,
                  userId,
                }),
              );
            }
            return userId;
          });
        const providersOf = (userId: string) =>
          Effect.map(
            Database.use((db) =>
              db
                .select({ providerId: account.providerId })
                .from(account)
                .where(eq(account.userId, userId)),
            ),
            (rows) => rows.map((row) => row.providerId).sort(),
          );
        const revoking = yield* accountWith(revoked);
        const other = yield* accountWith(kept);

        const answered = yield* answer(
          githubReaching([]),
          SECRET,
          delivery("github_app_authorization", {
            action: "revoked",
            sender: { id: revoked, login: "octo" },
          }),
        );

        assert.equal(answered.status, 200);
        assert.deepEqual(yield* providersOf(revoking), ["google"]);
        assert.deepEqual(yield* providersOf(other), ["github", "google"]);
      }),
  );
});
