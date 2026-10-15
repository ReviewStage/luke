import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type CodingAgent,
  createCodingAgent,
  readCodingAgent,
  settleCodingAgentAuthor,
  updateCodingAgentBranch,
} from "@luke/database/models/coding-agent-store";
import { getTestDB, startTask } from "@luke/database/testing";
import { CODING_AGENT_AUTHOR, type CodingAgentAuthor } from "@luke/features/coding-agent-wire";
import { ACTION_RESULT_STATUS, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Clock, Effect, Option } from "effect";
import {
  connectWorkspaceGitHub,
  GITHUB_FIXTURE,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  type GitHubAccountRow,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
  type SentToGitHub,
} from "../../testing/github-app-fake.js";
import { openPullRequest } from "./pull-request.js";

/**
 * A coding agent's pull request, opened by the service: as the developer it
 * writes as, on their own token, in one call on the agent's repository; as
 * the App where it writes as the App; and as the App in the developer's
 * place where GitHub refuses their token, the agent's row recording why. A
 * refusal of the pull request itself opens nothing and moves nothing.
 * GitHub is a script and the store PGlite; synthetic accounts and tokens
 * throughout.
 */

const RELAY = { owner: "Acme", name: "Relay", defaultBranch: "trunk" } as const;
const RELAY_FULL_NAME = `${RELAY.owner}/${RELAY.name}`;
const PULLS = `/repos/${RELAY_FULL_NAME}/pulls`;

/** The token the developer's GitHub sign-in left on their row (`standingGithubRow`). */
const DEVELOPER_TOKEN = "ghu_standing";

const INPUT = {
  head: "luke/teammate-invitations",
  title: "Expire teammate invitations",
  body: "Invitations now expire after a week.",
};

/** How GitHub answers an opening, by the bearer it came on. */
type Opening = (bearer: string) => Response;

const opened = () =>
  Response.json(
    { number: 12, html_url: `https://github.com/${RELAY_FULL_NAME}/pull/12` },
    { status: 201 },
  );

/** GitHub answering a pull request's opening as given, every opening written down. */
function repository(answer: Opening) {
  const openings: SentToGitHub[] = [];
  const script = (sent: SentToGitHub): Response | undefined => {
    if (new URL(sent.url).pathname !== PULLS || sent.method !== "POST") return undefined;
    openings.push(sent);
    return answer(sent.headers.get("authorization") ?? "");
  };
  return { openings, script };
}

/** An agent of a signed-in developer on the repository, its author settled as given. */
const openAgent = (
  installationId: number,
  author: CodingAgentAuthor | null,
  row?: GitHubAccountRow,
) =>
  Effect.gen(function* () {
    const installation: InstallationFixture = {
      id: installationId,
      login: RELAY.owner,
      repositories: [RELAY],
    };
    const userId = yield* openGithubUser(row);
    const plan = yield* startTask(userId, { name: "Invitations", repository: RELAY_FULL_NAME });
    yield* connectWorkspaceGitHub(plan.workspaceId, installation);
    const started = yield* createCodingAgent(userId, {
      taskId: plan.id,
      idempotencyKey: "start-1",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Invitations\n",
      prompt: null,
      repository: RELAY_FULL_NAME,
    });
    const { agent } = Option.getOrThrow(started);
    if (author !== null) yield* settleCodingAgentAuthor(userId, agent.id, author);
    const settled = Option.getOrThrow(yield* readCodingAgent(userId, agent.id));
    return {
      installation,
      agent: settled,
      target: { userId, conversationId: agent.conversationId },
    };
  });

/** Opens the agent's pull request against the GitHub given. */
const open = (
  opened: { readonly installation: InstallationFixture; readonly agent: CodingAgent },
  target: { readonly userId: string; readonly conversationId: string },
  answer: Opening,
  input: WireBoundaryInput = INPUT,
) =>
  Effect.gen(function* () {
    const github = repository(answer);
    const result = yield* openPullRequest(target, opened.agent, unparsedWire(input)).pipe(
      Effect.provide(githubReaching([opened.installation], undefined, {}, github.script).layer),
    );
    const row = Option.getOrThrow(yield* readCodingAgent(target.userId, opened.agent.id));
    return { result, openings: github.openings, author: row.author, branch: row.branch };
  });

it.layer(getTestDB())("a coding agent's pull request", (it) => {
  it.effect(
    "an agent writing as its developer has its pull request opened on their token, once, against the default branch, ending on Luke's line, its branch recorded on the agent as it opens",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent(21, CODING_AGENT_AUTHOR.DEVELOPER);

        const { result, openings, author, branch } = yield* open(agent, agent.target, opened);

        assert.deepEqual(result, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          url: `https://github.com/${RELAY_FULL_NAME}/pull/12`,
          number: 12,
          openedAs: "developer",
        });
        assert.deepEqual(
          openings.map((sent) => sent.headers.get("authorization")),
          [`Bearer ${DEVELOPER_TOKEN}`],
        );
        assert.deepEqual(JSON.parse(openings[0]?.body ?? "{}"), {
          head: INPUT.head,
          base: RELAY.defaultBranch,
          title: INPUT.title,
          body: `${INPUT.body}\n\nMade with [Luke](https://tryluke.dev)`,
          draft: false,
        });
        assert.equal(author, CODING_AGENT_AUTHOR.DEVELOPER);
        // The branch stands on the row at once, so GitHub's delivery about the opening finds the agent mid-turn.
        assert.equal(branch, INPUT.head);
      }),
  );

  it.effect(
    "where GitHub refuses the developer's token or their account's access, the App opens it in their place and the row records why",
    () =>
      Effect.gen(function* () {
        const refusedToken = yield* openAgent(22, CODING_AGENT_AUTHOR.DEVELOPER);
        const noAccess = yield* openAgent(23, CODING_AGENT_AUTHOR.DEVELOPER);
        const appOnly = (status: number) => (bearer: string) =>
          bearer === `Bearer ${DEVELOPER_TOKEN}`
            ? Response.json({ message: "Refused" }, { status })
            : opened();

        const unlinked = yield* open(refusedToken, refusedToken.target, appOnly(401));
        const forbidden = yield* open(noAccess, noAccess.target, appOnly(403));

        for (const { result, openings } of [unlinked, forbidden]) {
          assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
          assert.ok(result.status === ACTION_RESULT_STATUS.ACCEPTED);
          assert.equal(result.openedAs, "app");
          assert.match(result.note ?? "", /Opened as Luke's GitHub App/u);
          assert.deepEqual(
            openings.map((sent) => sent.headers.get("authorization")),
            [`Bearer ${DEVELOPER_TOKEN}`, `Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`],
          );
        }
        assert.deepEqual(
          [unlinked.author, forbidden.author],
          [CODING_AGENT_AUTHOR.APP_UNLINKED, CODING_AGENT_AUTHOR.APP_NO_PUSH],
        );
      }),
  );

  it.effect(
    "an agent writing as the App, or from before its author was settled, opens on the App's token and never reads the developer's",
    () =>
      Effect.gen(function* () {
        const automated = yield* openAgent(24, CODING_AGENT_AUTHOR.APP_AUTOMATION);
        const unsettled = yield* openAgent(25, null);

        for (const agent of [automated, unsettled]) {
          const { result, openings, author } = yield* open(agent, agent.target, opened);
          assert.ok(result.status === ACTION_RESULT_STATUS.ACCEPTED);
          assert.equal(result.openedAs, "app");
          assert.equal(result.note, undefined);
          assert.deepEqual(
            openings.map((sent) => sent.headers.get("authorization")),
            [`Bearer ${GITHUB_FIXTURE_INSTALLATION_TOKEN}`],
          );
          assert.equal(author, agent.agent.author, "the row is left as it stood");
        }
      }),
  );

  it.effect(
    "GitHub refusing the pull request itself opens nothing and moves nothing, the agent's branch among it, and a call without a title is refused before GitHub hears of it",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent(26, CODING_AGENT_AUTHOR.DEVELOPER);
        // The agent already stands on a branch of its own, with its pull request from it.
        yield* updateCodingAgentBranch(agent.target.userId, agent.agent.id, "luke/ready");
        const exists = () =>
          Response.json(
            {
              message: "Validation Failed",
              errors: [
                { message: "A pull request already exists for Acme:luke/teammate-invitations." },
              ],
            },
            { status: 422 },
          );

        const refused = yield* open(agent, agent.target, exists);
        const untitled = yield* open(agent, agent.target, opened, { head: INPUT.head, body: "" });

        assert.deepEqual(refused.result, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason:
            "Not opened: GitHub said: Validation Failed A pull request already exists for Acme:luke/teammate-invitations.",
        });
        assert.equal(refused.openings.length, 1, "the App does not try in the developer's place");
        assert.equal(refused.author, CODING_AGENT_AUTHOR.DEVELOPER);
        assert.equal(
          refused.branch,
          "luke/ready",
          "a refused call leaves the agent's branch as it stood",
        );
        assert.equal(untitled.result.status, ACTION_RESULT_STATUS.REJECTED);
        assert.deepEqual(untitled.openings, []);
      }),
  );

  it.effect(
    "a rate limit on the developer's request, or their token not refreshing while GitHub is down, opens nothing and leaves the agent theirs, for the call to be made again",
    () =>
      Effect.gen(function* () {
        const limited = yield* openAgent(27, CODING_AGENT_AUTHOR.DEVELOPER);
        const now = yield* Clock.currentTimeMillis;
        const expired = yield* openAgent(28, CODING_AGENT_AUTHOR.DEVELOPER, {
          accessToken: "ghu_expired",
          refreshToken: "ghr_standing",
          accessTokenExpiresAt: new Date(now - GITHUB_FIXTURE.HOUR_MS),
          refreshTokenExpiresAt: new Date(now + 170 * 24 * GITHUB_FIXTURE.HOUR_MS),
        });
        const rateLimit = (bearer: string) =>
          bearer === `Bearer ${DEVELOPER_TOKEN}`
            ? Response.json(
                { message: "You have exceeded a secondary rate limit." },
                { status: 403, headers: { "retry-after": "60" } },
              )
            : opened();

        const throttled = yield* open(limited, limited.target, rateLimit);
        const outage = yield* open(expired, expired.target, opened);

        assert.deepEqual(throttled.result, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason:
            "Not opened: GitHub is limiting how fast requests may come. Make the call again in a minute.",
        });
        assert.equal(throttled.openings.length, 1, "the App does not open it in their place");
        assert.deepEqual(outage.result, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: "Not opened: GitHub could not be reached. The call may be made again.",
        });
        assert.deepEqual(outage.openings, []);
        assert.deepEqual(
          [throttled.author, outage.author],
          [CODING_AGENT_AUTHOR.DEVELOPER, CODING_AGENT_AUTHOR.DEVELOPER],
        );
      }),
  );
});
