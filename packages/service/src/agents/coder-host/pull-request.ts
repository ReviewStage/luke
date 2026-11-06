import type { DatabaseServices } from "@repo/database/core/query";
import {
  type AgentRepositoryEntry,
  readAgentRepositories,
  recordAgentRepositoryHead,
} from "@repo/database/models/agent-repositories";
import {
  type Agent,
  recordAgentAuthor,
  updateAgentBranch,
  type WithRepository,
} from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_AUTHOR, type AgentAuthor } from "@repo/features/agent-wire";
import {
  GITHUB_ACCESS,
  githubRepositoryFullNameSchema,
} from "@repo/features/github-repositories-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { ACTION_RESULT_STATUS, EXCESS_KEYS, type UnparsedWireValue } from "@repo/wire";
import { describeWire, readEither } from "@repo/wire/effect";
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

const PULL_REQUEST_BOUNDS = {
  MAX_TITLE_CHARS: 256,
  MAX_BODY_CHARS: 65_536,
  MAX_BRANCH_CHARS: 255,
  MAX_REFUSAL_CHARS: 500,
} as const;

const openPullRequestInputSchema = Schema.Struct({
  head: Schema.Trim.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_BRANCH_CHARS),
  ),
  title: Schema.Trim.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_TITLE_CHARS),
  ),
  body: Schema.String.check(Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_BODY_CHARS)),
  draft: Schema.optionalKey(Schema.Boolean),
  base: Schema.optionalKey(
    Schema.Trim.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(PULL_REQUEST_BOUNDS.MAX_BRANCH_CHARS),
    ),
  ),
  repository: Schema.optionalKey(
    describeWire(
      githubRepositoryFullNameSchema,
      "The repository to open it in, as owner/name, where you work in several; leave it out where you work in one.",
    ),
  ),
});

type OpenPullRequestInput = typeof openPullRequestInputSchema.Type;

interface PullRequestAsked {
  readonly head: string;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
}

export const OPEN_PULL_REQUEST_TOOL = {
  name: AGENT_TOOL.OPEN_PULL_REQUEST,
  description:
    "Open the pull request for a branch you pushed. head is the branch's name, title its title, body its description in " +
    "Markdown, draft whether it opens as a draft, and base the branch it merges into: the repository's default branch " +
    "where left out, or another branch on GitHub, such as the parent's branch for a stacked pull request. Use this rather than " +
    `\`gh pr create\`: the service opens it as the developer who started you where you write as them, and as ${PRODUCT_NAME}'s GitHub ` +
    "App otherwise, and adds nothing to the description. Where GitHub refuses the developer's " +
    "own access, it is opened as the App instead and the answer says so; tell the developer, who can sign in with GitHub " +
    "again. The call answers with the pull request's address and number, or GitHub's reason it opened none.",
  inputSchema: openPullRequestInputSchema,
} as const;

const PULL_REQUEST_REFUSAL = {
  UNREADABLE: `Not opened: the call needs head, title, and body, the title at most ${PULL_REQUEST_BOUNDS.MAX_TITLE_CHARS} characters.`,
  UNAVAILABLE: "Not opened: GitHub could not be reached. The call may be made again.",
  RATE_LIMITED:
    "Not opened: GitHub is limiting how fast requests may come. Make the call again in a minute.",
  TOKEN_REFUSED:
    "Not opened: GitHub refused the developer's own GitHub token on this repository. Tell them.",
} as const;

function repositoryRefusal(repositories: readonly AgentRepositoryEntry[]): string {
  const listed = repositories.map((each) => `\`${each.repository}\``).join(", ");
  return repositories.length > 1
    ? `Not opened: you work in several repositories, so name the one to open it in as repository: ${listed}.`
    : `Not opened: you work in ${listed} alone; name it as repository, or leave repository out.`;
}

const RATE_LIMIT_HEADER = {
  REMAINING: "x-ratelimit-remaining",
  RETRY_AFTER: "retry-after",
} as const;

export const PULL_REQUEST_UNAVAILABLE = PULL_REQUEST_REFUSAL.UNAVAILABLE;

const OPENED_AS = {
  DEVELOPER: "developer",
  APP: "app",
} as const;

type OpenedAs = (typeof OPENED_AS)[keyof typeof OPENED_AS];

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

const FALLBACK_NOTE = {
  [AGENT_AUTHOR.APP_UNLINKED]:
    `Opened as ${PRODUCT_NAME}'s GitHub App: the developer's GitHub sign-in was refused. Tell them; signing in with GitHub again ` +
    "lets a later agent open its pull requests as them.",
  [AGENT_AUTHOR.APP_NO_PUSH]: `Opened as ${PRODUCT_NAME}'s GitHub App: the developer's own GitHub account may not open a pull request on this repository. Tell them.`,
} as const satisfies Partial<Record<AgentAuthor, string>>;

type FallbackReason = keyof typeof FALLBACK_NOTE;

const readInput = readEither(openPullRequestInputSchema, { excess: EXCESS_KEYS.DROP });

const OpenedSchema = Schema.Struct({ number: Schema.Int, html_url: Schema.String });

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

const ATTEMPT = {
  OPENED: "opened",
  TOKEN_REFUSED: "token-refused",
  REFUSED: "refused",
} as const;

type Attempt =
  | { readonly kind: typeof ATTEMPT.OPENED; readonly url: string; readonly number: number }
  | { readonly kind: typeof ATTEMPT.TOKEN_REFUSED; readonly reason: FallbackReason }
  | { readonly kind: typeof ATTEMPT.REFUSED; readonly reason: string };

type Settled = Exclude<Attempt, { readonly kind: typeof ATTEMPT.TOKEN_REFUSED }>;

function refusalWords(refusal: typeof RefusalSchema.Type): string {
  const details = (refusal.errors ?? []).flatMap((error) => {
    if (error.message !== undefined) return [error.message];
    const named = [error.field, error.code].filter((word) => word !== undefined).join(" ");
    return named === "" ? [] : [named];
  });
  const words = [refusal.message, ...details].join(" ");
  return `Not opened: GitHub said: ${words.slice(0, PULL_REQUEST_BOUNDS.MAX_REFUSAL_CHARS)}`;
}

function rateLimited(headers: Readonly<Record<string, string | undefined>>): boolean {
  return (
    headers[RATE_LIMIT_HEADER.REMAINING] === "0" ||
    headers[RATE_LIMIT_HEADER.RETRY_AFTER] !== undefined
  );
}

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
          return { kind: ATTEMPT.TOKEN_REFUSED, reason: AGENT_AUTHOR.APP_UNLINKED };
        case GITHUB_HTTP_STATUS.FORBIDDEN:
          return rateLimited(response.headers)
            ? { kind: ATTEMPT.REFUSED, reason: PULL_REQUEST_REFUSAL.RATE_LIMITED }
            : { kind: ATTEMPT.TOKEN_REFUSED, reason: AGENT_AUTHOR.APP_NO_PUSH };
        case GITHUB_HTTP_STATUS.NOT_FOUND:
          return { kind: ATTEMPT.TOKEN_REFUSED, reason: AGENT_AUTHOR.APP_NO_PUSH };
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

const attemptAsDeveloper = /* @__PURE__ */ Effect.fn("web/openPullRequestAsDeveloper")(function* (
  target: ConversationTarget,
  agent: Agent,
  fullName: string,
  pullRequest: PullRequestAsked,
): Effect.fn.Return<Attempt | undefined, never, CheckoutServices> {
  if (agent.author !== AGENT_AUTHOR.DEVELOPER) return undefined;
  const app = yield* GitHubApp;
  return yield* app.userToken(target.userId).pipe(
    Effect.flatMap((token) => attempt(token, fullName, pullRequest)),
    Effect.catchTag("GitHubSignInRequired", () =>
      Effect.succeed<Attempt>({
        kind: ATTEMPT.TOKEN_REFUSED,
        reason: AGENT_AUTHOR.APP_UNLINKED,
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

function pullRequestOf(input: OpenPullRequestInput, base: string): PullRequestAsked {
  return {
    head: input.head,
    base: input.base ?? base,
    title: input.title,
    body: input.body.trimEnd(),
    draft: input.draft ?? false,
  };
}

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

const attemptOpening = /* @__PURE__ */ Effect.fn("web/attemptPullRequestOpening")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
  input: OpenPullRequestInput,
  extra: AgentRepositoryEntry | undefined,
): Effect.fn.Return<PullRequestToolResult, never, CheckoutServices | DatabaseServices> {
  const minted = yield* Effect.result(agentRepositoryToken(target, agent, extra?.repository));
  if (Result.isFailure(minted)) return pullRequestRejected(`Not opened: ${minted.failure.reason}`);
  const { token, fullName, defaultBranch, access } = minted.success;
  const pullRequest = pullRequestOf(input, extra?.baseBranch ?? defaultBranch);
  if (access.kind === GITHUB_ACCESS.TOKEN) {
    const asMember = yield* attempt(token, fullName, pullRequest);
    return asMember.kind === ATTEMPT.TOKEN_REFUSED
      ? pullRequestRejected(PULL_REQUEST_REFUSAL.TOKEN_REFUSED)
      : answerOf(asMember, OPENED_AS.DEVELOPER);
  }
  const asDeveloper = yield* attemptAsDeveloper(target, agent, fullName, pullRequest);
  if (asDeveloper !== undefined && asDeveloper.kind !== ATTEMPT.TOKEN_REFUSED) {
    return answerOf(asDeveloper, OPENED_AS.DEVELOPER);
  }
  const asApp = yield* attempt(token, fullName, pullRequest);
  if (asApp.kind === ATTEMPT.TOKEN_REFUSED) {
    return pullRequestRejected(PULL_REQUEST_REFUSAL.UNAVAILABLE);
  }
  if (asDeveloper === undefined || asApp.kind === ATTEMPT.REFUSED) {
    return answerOf(asApp, OPENED_AS.APP);
  }
  yield* recordAgentAuthor(target.userId, agent.id, asDeveloper.reason).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(
        `Why conversation ${target.conversationId}'s pull request was opened as the App was not recorded: ${failure._tag}`,
      ),
    ),
  );
  return answerOf(asApp, OPENED_AS.APP, FALLBACK_NOTE[asDeveloper.reason]);
});

const recordOpened = (
  target: ConversationTarget,
  agent: Agent,
  head: string,
  extra: AgentRepositoryEntry | undefined,
) =>
  Effect.gen(function* () {
    if (extra === undefined) {
      yield* updateAgentBranch(target.userId, agent.id, head);
      yield* agentPublished(target.userId, { ...agent, branch: head });
      return;
    }
    yield* recordAgentRepositoryHead(target.userId, agent.id, extra.repository, head);
    yield* agentPublished(target.userId, agent);
  }).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(
        `Conversation ${target.conversationId}'s opened pull request was not recorded on its agent: ${failure._tag}`,
      ),
    ),
  );

function chosenExtra(
  named: string | undefined,
  repositories: readonly AgentRepositoryEntry[],
): Result.Result<AgentRepositoryEntry | undefined, string> {
  const [own, ...extras] = repositories;
  if (named === undefined) {
    return extras.length === 0
      ? Result.succeed(undefined)
      : Result.fail(repositoryRefusal(repositories));
  }
  const lowered = named.toLowerCase();
  if (own === undefined || own.repository.toLowerCase() === lowered)
    return Result.succeed(undefined);
  const extra = extras.find((each) => each.repository.toLowerCase() === lowered);
  return extra === undefined ? Result.fail(repositoryRefusal(repositories)) : Result.succeed(extra);
}

export const openPullRequest = /* @__PURE__ */ Effect.fn("web/openPullRequest")(function* (
  target: ConversationTarget,
  agent: WithRepository<Agent>,
  input: UnparsedWireValue,
): Effect.fn.Return<PullRequestToolResult, never, CheckoutServices | DatabaseServices> {
  const read = readInput(input);
  if (Result.isFailure(read)) return pullRequestRejected(PULL_REQUEST_REFUSAL.UNREADABLE);
  const repositories = yield* Effect.result(readAgentRepositories(target.userId, agent.id));
  if (Result.isFailure(repositories)) return pullRequestRejected(PULL_REQUEST_REFUSAL.UNAVAILABLE);
  const chosen = chosenExtra(read.success.repository, repositories.success);
  if (Result.isFailure(chosen)) return pullRequestRejected(chosen.failure);
  const extra = chosen.success;
  const result = yield* attemptOpening(target, agent, read.success, extra);
  if (result.status === ACTION_RESULT_STATUS.ACCEPTED) {
    yield* recordOpened(target, agent, read.success.head, extra);
    yield* recordServerEvent(
      SERVER_EVENT.PULL_REQUEST_CREATE,
      { userId: target.userId, workspaceId: agent.organizationId },
      {
        opened_as:
          result.openedAs === OPENED_AS.DEVELOPER
            ? SERVER_PULL_REQUEST_OPENER.DEVELOPER
            : SERVER_PULL_REQUEST_OPENER.APP,
        is_draft: read.success.draft ?? false,
      },
    );
  }
  return result;
});
