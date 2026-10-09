import type {
  CodingAgentPullRequest,
  CodingAgentPullRequestAnswer,
} from "@sidecar/hosted/coding-agent-wire";
import { Cache, Data, Duration, Effect, Exit, type Layer, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import {
  isRecord,
  isWireString,
  MESSAGE_ROLE,
  type StoredUIMessage,
  type UnparsedWireValue,
} from "../../core.js";
import { GitHubApp, type GitHubUserReadFailure, sameName } from "../../github/github-app.js";
import {
  branchStands,
  checkSummaryOf,
  type GitHubPullRequest,
  type PullRequestReadFailure,
  pullRequestByNumber,
  pullRequestOfBranch,
} from "../../github/pull-requests.js";
import { type CodingAgent, readCodingAgent } from "../coding-agent-store.js";
import { listMessagesPast, type MessageCursor } from "../store/index.js";
import type { StoreFailure } from "../store-failure.js";
import { CODER } from "./bounds.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import { CURSOR_START } from "./transcript.js";

/**
 * published.ts -- what a coding agent published: the branch it pushed and the pull request from it, found in its own transcript and confirmed on GitHub.
 *
 * The agent reaches GitHub through `git` and `gh` in its shell alone, so
 * its own transcript rows, every page of them, are where its branch and
 * pull request are named, and are named for this agent and no other: a
 * second agent on the same repository has rows of its own. The branch is
 * read off the commands the agent ran (a push, a branch cut, a pull
 * request opened on a head, or any branch spelled under
 * `CODER.BRANCH_PREFIX`), the newest naming winning; the pull request off
 * any address of one on the agent's repository in its words or in a
 * tool's answer, case aside, the newest winning. The branch is the anchor:
 * an agent whose commands named none published nothing, whatever
 * addresses its reads turned up, and a pull request named by number is
 * the agent's only where its head is that branch, so a link in a file the
 * agent read is never worn as its own. GitHub then says what stands, once
 * the developer's reach of the repository through the App is confirmed as
 * a Start confirms it: the pull request by its number on that head, else
 * the newest from the branch, else whether the branch was pushed at all,
 * with the pull request's head's checks. The answer is kept per agent for
 * `CODER.PUBLISHED_TTL` so a tab reading it beside every page of a held
 * transcript asks GitHub a few times a minute at most, under a key that
 * says whether the agent had ended, so the first read after a turn ends
 * is a fresh one rather than the running turn's kept answer; a read that
 * failed is kept for no time, so the next ask tries again.
 */

/** The branch and the pull request number the agent's own transcript names, each where it does. */
export interface PublishedInTranscript {
  readonly branch: string | undefined;
  readonly pullRequestNumber: number | undefined;
}

/** The commands that name the branch an agent works on, each with the branch as its one capture. */
const BRANCH_COMMANDS: readonly RegExp[] = [
  // `git push [-u] origin <branch>` or `… origin HEAD:<branch>`; a bare HEAD names nothing.
  /\bgit\s+push\b[^;&|\n]*?\s(?:origin|upstream)\s+(?:HEAD:)?["']?([^\s;&|"']+)/gu,
  /\bgit\s+(?:switch\s+(?:-c|-C|--create)|checkout\s+(?:-b|-B)|branch)\s+["']?([^\s;&|"']+)/gu,
  /\bgh\s+pr\s+create\b[^;&|\n]*?--head[\s=]+["']?([^\s;&|"']+)/gu,
];

/** A branch name the agent was told to use, wherever it is spelled in a command. */
const PREFIXED_BRANCH = new RegExp(`\\b${CODER.BRANCH_PREFIX}[\\w.\\-/]+`, "gu");

/** Names a push with no branch of its own, which the capture above may read. */
const HEAD = "HEAD";

/** A pull request's own address: the repository, then the number. */
const PULL_REQUEST_ADDRESS = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\b/gu;

/** Every string a JSON value holds, in document order. */
function strings(value: UnparsedWireValue): string[] {
  if (isWireString(value)) return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isRecord(value)) return Object.values(value).flatMap(strings);
  return [];
}

/** The strings of one part the scan reads: its words for a text part, its input and its answer for a tool call. */
interface PartStrings {
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
}

function partStrings(part: UnparsedWireValue): PartStrings {
  if (!isRecord(part) || !isWireString(part.type)) return { inputs: [], outputs: [] };
  if (part.type === "text") return { inputs: [], outputs: strings(part.text) };
  if (part.type.startsWith("tool-")) {
    return { inputs: strings(part.input), outputs: strings(part.output) };
  }
  return { inputs: [], outputs: [] };
}

/** The last branch a command names, by where it is named, or none. */
function branchNamedIn(command: string): string | undefined {
  let last: { at: number; name: string } | undefined;
  const consider = (at: number, name: string) => {
    if (name === HEAD || name.startsWith("-")) return;
    if (last === undefined || at >= last.at) last = { at, name };
  };
  for (const pattern of BRANCH_COMMANDS) {
    for (const match of command.matchAll(pattern)) {
      const name = match[1];
      if (name !== undefined) consider(match.index + match[0].indexOf(name), name);
    }
  }
  for (const match of command.matchAll(PREFIXED_BRANCH)) consider(match.index, match[0]);
  return last?.name;
}

/** The last pull request of the repository a string addresses, or none. */
function pullRequestNamedIn(text: string, repository: string): number | undefined {
  let last: number | undefined;
  for (const match of text.matchAll(PULL_REQUEST_ADDRESS)) {
    const [, owner = "", name = "", number = ""] = match;
    if (sameName(`${owner}/${name}`, repository)) last = Number(number);
  }
  return last;
}

/**
 * The branch and the pull request the agent's own rows name: the newest
 * naming of each, read across its own turns in order and never from the
 * plan it was handed.
 */
export function publishedInTranscript(
  messages: readonly StoredUIMessage[],
  repository: string,
): PublishedInTranscript {
  let branch: string | undefined;
  let pullRequestNumber: number | undefined;
  for (const message of messages) {
    if (message.role !== MESSAGE_ROLE.ASSISTANT) continue;
    for (const part of message.parts) {
      // SAFETY: a stored part is JSON the row carried; the scan reads it as such and trusts no field.
      const { inputs, outputs } = partStrings(part as UnparsedWireValue);
      for (const input of inputs) branch = branchNamedIn(input) ?? branch;
      for (const text of [...inputs, ...outputs]) {
        pullRequestNumber = pullRequestNamedIn(text, repository) ?? pullRequestNumber;
      }
    }
  }
  return { branch, pullRequestNumber };
}

/** The developer no longer reaches the agent's repository through the App, so nothing of it is read. */
class RepositoryNotReachable extends Data.TaggedError("RepositoryNotReachable")<{
  readonly repository: string;
}> {}

/** What a read of what an agent published may fail with: the store, GitHub on the developer's token, or a repository out of reach. */
type PublishedReadFailure = StoreFailure | GitHubUserReadFailure | RepositoryNotReachable;

type PublishedServices = SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp;

/** The most pages of an agent's rows the scan walks: fifty of two hundred rows is far past any agent's conversation, and a scan past it has stopped reading rather than stopped quietly. */
const SCAN_PAGES = 50;

/** Every readable row of the agent's conversation, page after page from the start, in order. */
const allMessages = (
  userId: string,
  agent: CodingAgent,
): Effect.Effect<readonly StoredUIMessage[], StoreFailure, SqlClient.SqlClient> =>
  Effect.gen(function* () {
    const messages: StoredUIMessage[] = [];
    let cursor: MessageCursor = CURSOR_START;
    for (let page = 0; page < SCAN_PAGES; page += 1) {
      const read = yield* listMessagesPast(userId, agent.conversationId, CODER_TOOL_SET, cursor);
      // A page the vocabulary refuses holds nothing readable past the cursor; the scan ends on what it has.
      if (!read.read.ok || read.read.value.length === 0) return messages;
      messages.push(...read.read.value.map((record) => record.message));
      cursor = read.cursor;
    }
    return yield* Effect.die(new Error(`an agent's conversation ran past ${SCAN_PAGES} pages`));
  });

/** The wire's pull request from GitHub's, with its head's checks read beside it. */
function withChecks(
  token: Redacted.Redacted,
  agent: CodingAgent,
  found: GitHubPullRequest,
): Effect.Effect<CodingAgentPullRequestAnswer, PullRequestReadFailure, HttpClient.HttpClient> {
  return Effect.map(checkSummaryOf(token, agent.repository, found.headSha), (checks) => {
    const pullRequest: CodingAgentPullRequest = {
      number: found.number,
      title: found.title,
      url: found.url,
      state: found.state,
      checks,
      additions: found.additions,
      deletions: found.deletions,
      changedFiles: found.changedFiles,
    };
    return { repository: agent.repository, branch: found.headRef, pullRequest };
  });
}

/** Nothing published: neither a branch GitHub holds nor a pull request. */
function nothing(agent: CodingAgent): CodingAgentPullRequestAnswer {
  return { repository: agent.repository, branch: null, pullRequest: null };
}

/**
 * What the agent published as GitHub holds it now: the pull request its
 * rows name on the branch they name, else the newest from that branch,
 * else the branch alone where GitHub holds it, else nothing.
 */
const agentPublished = /* @__PURE__ */ Effect.fn("web/agentPublished")(function* (
  userId: string,
  agent: CodingAgent,
): Effect.fn.Return<CodingAgentPullRequestAnswer, PublishedReadFailure, PublishedServices> {
  const named = publishedInTranscript(yield* allMessages(userId, agent), agent.repository);
  // No branch of its own, no publication: an address its reads turned up is someone else's.
  if (named.branch === undefined) return nothing(agent);
  const app = yield* GitHubApp;
  const reached = yield* app.userRepository(userId, agent.repository);
  if (Option.isNone(reached)) {
    return yield* new RepositoryNotReachable({ repository: agent.repository });
  }
  const token = yield* app.userToken(userId);
  if (named.pullRequestNumber !== undefined) {
    const byNumber = yield* pullRequestByNumber(token, agent.repository, named.pullRequestNumber);
    // The number is the agent's only on its own head; any other is a link it read, not a pull request it opened.
    if (Option.isSome(byNumber) && byNumber.value.headRef === named.branch) {
      return yield* withChecks(token, agent, byNumber.value);
    }
  }
  const ofBranch = yield* pullRequestOfBranch(token, agent.repository, named.branch);
  if (Option.isSome(ofBranch)) return yield* withChecks(token, agent, ofBranch.value);
  const pushed = yield* branchStands(token, agent.repository, named.branch);
  return pushed
    ? { repository: agent.repository, branch: named.branch, pullRequest: null }
    : nothing(agent);
});

/** One agent of one account, as the kept answers are keyed, and whether it had ended as asked: the first ask after a turn ends is its own key, so it reads afresh. */
export class PublishedKey extends Data.Class<{
  readonly userId: string;
  readonly agentId: string;
  readonly ended: boolean;
}> {}

/** The kept answers of one function instance: an agent's answer for the TTL, a failure for no time. */
export type PublishedCache = Cache.Cache<
  PublishedKey,
  CodingAgentPullRequestAnswer,
  PublishedReadFailure | NoSuchAgent,
  PublishedServices
>;

/** The key names an agent the account does not hold, which an ownership check before the ask already refused. */
class NoSuchAgent extends Data.TaggedError("NoSuchAgent")<{ readonly agentId: string }> {}

/** The most agents one instance keeps answers for at once. */
const KEPT_AGENTS = 1_024;

/** One agent's answer looked up afresh: the row, then what it published. */
const lookupPublished = (
  key: PublishedKey,
): Effect.Effect<
  CodingAgentPullRequestAnswer,
  PublishedReadFailure | NoSuchAgent,
  PublishedServices
> =>
  Effect.gen(function* () {
    const agent = yield* readCodingAgent(key.userId, key.agentId);
    if (Option.isNone(agent)) return yield* new NoSuchAgent({ agentId: key.agentId });
    return yield* agentPublished(key.userId, agent.value);
  });

/** The cache, built once where the routes are composed. */
const publishedCache: Effect.Effect<PublishedCache> = Cache.makeWith(lookupPublished, {
  capacity: KEPT_AGENTS,
  requireServicesAt: "lookup",
  timeToLive: (exit) => (Exit.isSuccess(exit) ? CODER.PUBLISHED_TTL : Duration.zero),
});

/** The routes composed over a cache of their own. */
export function withPublishedCache<A, E, R>(
  routes: (cache: PublishedCache) => Layer.Layer<A, E, R>,
): Effect.Effect<Layer.Layer<A, E, R>> {
  return Effect.map(publishedCache, routes);
}
