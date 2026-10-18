import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  recordCodingAgentAuthor,
  updateCodingAgentBranch,
} from "@luke/database/models/coding-agent-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { CODING_AGENT_AUTHOR, type CodingAgentAuthor } from "@luke/features/coding-agent-wire";
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, type Redacted, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_PULL_REQUEST_OPENER,
} from "../../events/server-events.js";
import {
  GITHUB_HTTP_STATUS,
  GitHubApp,
  githubPost,
  readBody,
  send,
} from "../../github/github-app.js";
import { AGENT_TOOL } from "../agent-runtime/tools.js";
import { agentRepositoryToken, type CheckoutServices } from "./checkout.js";
import { agentPublished } from "./published.js";

/**
 * pull-request.ts -- the coding agent's `open_pull_request` tool: its pull request opened by the service, as the developer it writes as, or as the App.
 *
 * An agent that writes as its developer (`checkout.ts`) has its pull request
 * opened by the service on the developer's own GitHub App token, read from
 * their sign-in where it is sealed, in one call to GitHub (`POST
 * /repos/{owner}/{name}/pulls`) on the agent's own repository and nowhere
 * else. The token never reaches the sandbox, whose firewall carries the
 * App's token alone, because the sandbox is the workspace's: any member may
 * steer the agent or open a terminal in it, and a developer's token reaches
 * every repository they and the App reach. So the most a teammate can do
 * through the agent as the developer is open a pull request on its one
 * repository. An agent that writes as the App has its pull request opened
 * on the App's token for that repository, as every push already goes.
 *
 * Where GitHub refuses the developer's token, or their sign-in no longer
 * yields one, the pull request is opened as the App instead and the agent's
 * row records why (`recordCodingAgentAuthor`), so the Changes tab says it and
 * the agent's later pull requests go out as the App without asking again;
 * the agent is told, so it can tell the developer. A refusal of the pull
 * request itself, such as one already open from the branch, is the agent's
 * to read and opens nothing. Every description ends on the line saying Luke
 * made it, since its author may be a person. It merges into the
 * repository's default branch unless the agent names another base, such as
 * the branch of the pull request it stacks on; a base GitHub does not know
 * is refused like any other. Once GitHub opens it, its branch and the pull
 * request are written on the agent's row at once rather than only as the
 * turn ends, so a comment on it finds the agent (`github/agent-wakes.ts`);
 * a refused call moves nothing.
 */

/** GitHub's own bounds on what a pull request carries. */
const PULL_REQUEST_BOUNDS = {
  MAX_TITLE_CHARS: 256,
  MAX_BODY_CHARS: 65_536,
  MAX_BRANCH_CHARS: 255,
  /** The most of GitHub's own words on a refusal the agent is told. */
  MAX_REFUSAL_CHARS: 500,
} as const;

/** The line every pull request the agent opens ends its description with. */
const PULL_REQUEST_FOOTER = "Made with [Luke](https://tryluke.dev)";

const openPullRequestInputSchema = Schema.Struct({
  head: Schema.Trim.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_BRANCH_CHARS),
  ),
  title: Schema.Trim.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_TITLE_CHARS),
  ),
  body: Schema.String.check(
    Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_BODY_CHARS - PULL_REQUEST_FOOTER.length - 2),
  ),
  draft: Schema.optionalKey(Schema.Boolean),
  base: Schema.optionalKey(
    Schema.Trim.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_BRANCH_CHARS),
    ),
  ),
});

type OpenPullRequestInput = typeof openPullRequestInputSchema.Type;

/** A pull request as GitHub's API takes one to open: the branch, the branch it merges into, and its words. */
interface PullRequestAsked {
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
}

/** The tool as a coding agent is offered it: its name, its words, and its input. */
export const OPEN_PULL_REQUEST_TOOL = {
  name: AGENT_TOOL.OPEN_PULL_REQUEST,
  description:
    "Open the pull request for a branch you pushed. head is the branch's name, title its title, body its description in " +
    "Markdown, draft whether it opens as a draft, and base the branch it merges into: the repository's default branch " +
    "where left out, or another branch on GitHub, such as the parent's branch for a stacked pull request. Use this rather than " +
    "`gh pr create`: the service opens it as the developer who started you where you write as them, and as Luke's GitHub " +
    `App otherwise, and ends the description with the line "${PULL_REQUEST_FOOTER}". Where GitHub refuses the developer's ` +
    "own access, it is opened as the App instead and the answer says so; tell the developer, who can sign in with GitHub " +
    "again. The call answers with the pull request's address and number, or GitHub's reason it opened none.",
  inputSchema: openPullRequestInputSchema,
} as const;

/** Why a call opened nothing, in the words the model reads. */
const PULL_REQUEST_REFUSAL = {
  UNREADABLE: `Not opened: the call needs head, title, and body, the title at most ${PULL_REQUEST_BOUNDS.MAX_TITLE_CHARS} characters.`,
  UNAVAILABLE: "Not opened: GitHub could not be reached. The call may be made again.",
  RATE_LIMITED:
    "Not opened: GitHub is limiting how fast requests may come. Make the call again in a minute.",
} as const;

/** The headers GitHub marks a rate limit with, which it may answer 403 rather than 429. */
const RATE_LIMIT_HEADER = {
  REMAINING: "x-ratelimit-remaining",
  RETRY_AFTER: "retry-after",
} as const;

/** Why a call opened nothing where the service could not reach GitHub or its store. */
export const PULL_REQUEST_UNAVAILABLE = PULL_REQUEST_REFUSAL.UNAVAILABLE;

/** Who a pull request the service opened is by. */
const OPENED_AS = {
  DEVELOPER: "developer",
  APP: "app",
} as const;

type OpenedAs = (typeof OPENED_AS)[keyof typeof OPENED_AS];

/** What a call answers, as the model reads it: the pull request opened and as whom, or why none was. */
export type PullRequestToolResult =
  | {
      readonly status: typeof ACTION_RESULT_STATUS.ACCEPTED;
      readonly url: string;
      readonly number: number;
      readonly openedAs: OpenedAs;
      readonly note?: string;
    }
  | { readonly status: typeof ACTION_RESULT_STATUS.REJECTED; readonly reason: string };

export function pullRequestRejected(reason: string): PullRequestToolResult {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** What the agent is told where the App opened its pull request in the developer's place, by why. */
const FALLBACK_NOTE = {
  [CODING_AGENT_AUTHOR.APP_UNLINKED]:
    "Opened as Luke's GitHub App: the developer's GitHub sign-in was refused. Tell them; signing in with GitHub again " +
    "lets a later agent open its pull requests as them.",
  [CODING_AGENT_AUTHOR.APP_NO_PUSH]:
    "Opened as Luke's GitHub App: the developer's own GitHub account may not open a pull request on this repository. Tell them.",
} as const satisfies Partial<Record<CodingAgentAuthor, string>>;

type FallbackReason = keyof typeof FALLBACK_NOTE;

const readInput = readEither(openPullRequestInputSchema, { excess: EXCESS_KEYS.DROP });

/** GitHub's answer to an opened pull request, read for its address and number. */
const OpenedSchema = Schema.Struct({ number: Schema.Int, html_url: Schema.String });

/** GitHub's words on a request it refused, as far as the agent is told them. */
const RefusalSchema = Schema.Struct({
  message: Schema.String,
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        message: Schema.optional(Schema.String),
        field: Schema.optional(Schema.String),
        code: Schema.optional(Schema.String),
      }),
    ),
  ),
});

/** How one attempt to open the pull request ended. */
const ATTEMPT = {
  /** GitHub opened it. */
  OPENED: "opened",
  /** GitHub refused the token it went on, or the account behind it. */
  TOKEN_REFUSED: "token-refused",
  /** GitHub refused the pull request itself, or could not be reached. */
  REFUSED: "refused",
} as const;

type Attempt =
  | { readonly kind: typeof ATTEMPT.OPENED; readonly url: string; readonly number: number }
  | { readonly kind: typeof ATTEMPT.TOKEN_REFUSED; readonly reason: FallbackReason }
  | { readonly kind: typeof ATTEMPT.REFUSED; readonly reason: string };

/** An attempt that ended other than with its token refused. */
type Settled = Exclude<Attempt, { readonly kind: typeof ATTEMPT.TOKEN_REFUSED }>;

/**
 * GitHub's refusal of the pull request in its own words, cut to the bound.
 * An error GitHub gives no message for, such as a base it does not know,
 * is said by the field it names and its code (`base invalid`).
 */
function refusalWords(refusal: typeof RefusalSchema.Type): string {
  const details = (refusal.errors ?? []).flatMap((error) => {
    if (error.message !== undefined) return [error.message];
    const named = [error.field, error.code].filter((word) => word !== undefined).join(" ");
    return named === "" ? [] : [named];
  });
  const words = [refusal.message, ...details].join(" ");
  return `Not opened: GitHub said: ${words.slice(0, PULL_REQUEST_BOUNDS.MAX_REFUSAL_CHARS)}`;
}

/**
 * Whether GitHub's 403 is a rate limit rather than a refusal of the
 * account's access: GitHub marks a primary limit with no requests
 * remaining, and a secondary one with a wait to retry after.
 */
function rateLimited(headers: Readonly<Record<string, string | undefined>>): boolean {
  return (
    headers[RATE_LIMIT_HEADER.REMAINING] === "0" ||
    headers[RATE_LIMIT_HEADER.RETRY_AFTER] !== undefined
  );
}

/**
 * One attempt to open the pull request on the token given. A token GitHub
 * will not take (401), or whose account may not write the repository (403,
 * or 404 for a repository it cannot see), is told apart from a refusal of
 * the pull request itself, which GitHub answers 422 with its reason, and
 * from a rate limit, which GitHub may answer 403 too and which passes.
 */
const attempt = /* @__PURE__ */ Effect.fn("web/openPullRequestAttempt")(function* (
  token: Redacted.Redacted,
  fullName: string,
  pullRequest: PullRequestAsked,
): Effect.fn.Return<Attempt, never, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
  return yield* Effect.scoped(
    Effect.gen(function* (): Effect.fn.Return<Attempt, unknown, HttpClient.HttpClient> {
      const response = yield* send(githubPost(path, token, pullRequest));
      switch (response.status) {
        case GITHUB_HTTP_STATUS.UNAUTHORIZED:
          return { kind: ATTEMPT.TOKEN_REFUSED, reason: CODING_AGENT_AUTHOR.APP_UNLINKED };
        case GITHUB_HTTP_STATUS.FORBIDDEN:
          return rateLimited(response.headers)
            ? { kind: ATTEMPT.REFUSED, reason: PULL_REQUEST_REFUSAL.RATE_LIMITED }
            : { kind: ATTEMPT.TOKEN_REFUSED, reason: CODING_AGENT_AUTHOR.APP_NO_PUSH };
        case GITHUB_HTTP_STATUS.NOT_FOUND:
          return { kind: ATTEMPT.TOKEN_REFUSED, reason: CODING_AGENT_AUTHOR.APP_NO_PUSH };
        case GITHUB_HTTP_STATUS.UNPROCESSABLE: {
          const refusal = yield* HttpClientResponse.schemaBodyJson(RefusalSchema)(response);
          return { kind: ATTEMPT.REFUSED, reason: refusalWords(refusal) };
        }
        default: {
          const opened = yield* readBody(response, OpenedSchema);
          return { kind: ATTEMPT.OPENED, url: opened.html_url, number: opened.number };
        }
      }
    }),
  ).pipe(
    Effect.catch(() =>
      Effect.succeed<Attempt>({ kind: ATTEMPT.REFUSED, reason: PULL_REQUEST_REFUSAL.UNAVAILABLE }),
    ),
  );
});

/**
 * The attempt as the developer, where the agent writes as them, on their
 * own token; nothing for an agent that writes as the App. A sign-in that
 * yields no token is one GitHub no longer honours, and is refused as their
 * token would be; any other failure to read it, the store or GitHub's
 * refresh not answering, refuses the call to be made again, so a passing
 * outage never writes the developer out of their agent. Note that the
 * author is read off the row and never settled here, because an agent from
 * before the column, whose standing session and checkout are the App's,
 * must open as the App too.
 */
const attemptAsDeveloper = /* @__PURE__ */ Effect.fn("web/openPullRequestAsDeveloper")(function* (
  target: ConversationTarget,
  agent: CodingAgent,
  fullName: string,
  pullRequest: PullRequestAsked,
): Effect.fn.Return<Attempt | undefined, never, CheckoutServices> {
  if (agent.author !== CODING_AGENT_AUTHOR.DEVELOPER) return undefined;
  const app = yield* GitHubApp;
  return yield* app.userToken(target.userId).pipe(
    Effect.flatMap((token) => attempt(token, fullName, pullRequest)),
    Effect.catchTag("GitHubSignInRequired", () =>
      Effect.succeed<Attempt>({
        kind: ATTEMPT.TOKEN_REFUSED,
        reason: CODING_AGENT_AUTHOR.APP_UNLINKED,
      }),
    ),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `The developer's GitHub token for conversation ${target.conversationId} was not read: ${failure._tag}`,
        ),
        { kind: ATTEMPT.REFUSED, reason: PULL_REQUEST_REFUSAL.UNAVAILABLE } satisfies Attempt,
      ),
    ),
  );
});

/** The pull request GitHub is asked to open: the agent's branch against the base it named or the default branch, its description ending on Luke's line. */
function pullRequestOf(input: OpenPullRequestInput, defaultBranch: string): PullRequestAsked {
  const body = input.body.trimEnd();
  return {
    head: input.head,
    base: input.base ?? defaultBranch,
    title: input.title,
    body: body.endsWith(PULL_REQUEST_FOOTER) ? body : `${body}\n\n${PULL_REQUEST_FOOTER}`.trim(),
    draft: input.draft ?? false,
  };
}

/** The answer for an attempt that ended other than with a token refused. */
function answerOf(ended: Settled, openedAs: OpenedAs, note?: string): PullRequestToolResult {
  if (ended.kind === ATTEMPT.REFUSED) return pullRequestRejected(ended.reason);
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    url: ended.url,
    number: ended.number,
    openedAs,
    ...(note === undefined ? undefined : { note }),
  };
}

/**
 * One call's opening: the pull request opened as the developer where the
 * agent writes as them and GitHub takes their token, and as the App
 * otherwise, the App's opening in the developer's place recorded on the
 * agent's row with why; or GitHub's reason it opened none.
 */
const attemptOpening = /* @__PURE__ */ Effect.fn("web/attemptPullRequestOpening")(function* (
  target: ConversationTarget,
  agent: CodingAgent,
  input: UnparsedWireValue,
): Effect.fn.Return<PullRequestToolResult, never, CheckoutServices | DatabaseServices> {
  const read = readInput(input);
  if (Result.isFailure(read)) return pullRequestRejected(PULL_REQUEST_REFUSAL.UNREADABLE);
  const minted = yield* Effect.result(agentRepositoryToken(target, agent));
  if (Result.isFailure(minted)) return pullRequestRejected(`Not opened: ${minted.failure.reason}`);
  const { token: appToken, fullName, defaultBranch } = minted.success;
  const pullRequest = pullRequestOf(read.success, defaultBranch);
  const asDeveloper = yield* attemptAsDeveloper(target, agent, fullName, pullRequest);
  if (asDeveloper !== undefined && asDeveloper.kind !== ATTEMPT.TOKEN_REFUSED) {
    return answerOf(asDeveloper, OPENED_AS.DEVELOPER);
  }
  const asApp = yield* attempt(appToken, fullName, pullRequest);
  if (asApp.kind === ATTEMPT.TOKEN_REFUSED) {
    return pullRequestRejected(PULL_REQUEST_REFUSAL.UNAVAILABLE);
  }
  if (asDeveloper === undefined || asApp.kind === ATTEMPT.REFUSED) {
    return answerOf(asApp, OPENED_AS.APP);
  }
  yield* recordCodingAgentAuthor(target.userId, agent.id, asDeveloper.reason).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(
        `Why conversation ${target.conversationId}'s pull request was opened as the App was not recorded: ${failure._tag}`,
      ),
    ),
  );
  return answerOf(asApp, OPENED_AS.APP, FALLBACK_NOTE[asDeveloper.reason]);
});

/**
 * What an opening GitHub took leaves on the agent's row: the branch it was
 * opened from, and the pull request read back from GitHub onto the row, as
 * a turn's end and a delivery about the branch would, so a comment on it
 * finds the agent at once. Either failing is logged by its kind and the
 * call still answers as opened.
 */
const recordOpened = (target: ConversationTarget, agent: CodingAgent, head: string) =>
  Effect.gen(function* () {
    yield* updateCodingAgentBranch(target.userId, agent.id, head);
    yield* agentPublished(target.userId, { ...agent, branch: head });
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(
        `Conversation ${target.conversationId}'s opened pull request was not recorded on its agent: ${failure._tag}`,
      ),
    ),
  );

/**
 * Runs one call: the opening above, and where GitHub opened it, its branch
 * and pull request recorded on the agent. A refused call leaves the row as
 * it stood, the branch and pull request the agent already had among it.
 */
export const openPullRequest = /* @__PURE__ */ Effect.fn("web/openPullRequest")(function* (
  target: ConversationTarget,
  agent: CodingAgent,
  input: UnparsedWireValue,
): Effect.fn.Return<PullRequestToolResult, never, CheckoutServices | DatabaseServices> {
  const result = yield* attemptOpening(target, agent, input);
  const read = readInput(input);
  if (result.status === ACTION_RESULT_STATUS.ACCEPTED && Result.isSuccess(read)) {
    yield* recordOpened(target, agent, read.success.head);
    yield* recordServerEvent(SERVER_EVENT.PULL_REQUEST_CREATE, target.userId, {
      opened_as:
        result.openedAs === OPENED_AS.DEVELOPER
          ? SERVER_PULL_REQUEST_OPENER.DEVELOPER
          : SERVER_PULL_REQUEST_OPENER.APP,
      is_draft: read.success.draft ?? false,
    });
  }
  return result;
});
