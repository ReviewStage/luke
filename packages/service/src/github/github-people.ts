/**
 * github-people.ts -- who a pull request names, as an agent's changes carry them: each GitHub account by its login and avatar, and a member of the agent's workspace named by the Luke account their GitHub account is linked to.
 *
 * GitHub names everyone by an account of its own, so a login alone would
 * draw a teammate as a stranger. A Luke account that signed in with GitHub
 * keeps a provider row whose `account_id` is GitHub's id for them, and a
 * pull request names that same id, so the two meet by id rather than by a
 * login a person may change. An account is named only where its holder is a
 * member of the agent's own workspace, so the answer never says which Luke
 * account stands behind someone outside it. Luke's own App's bot is named
 * as any other App's bot is: by its login, as GitHub names it.
 *
 * Who a pull request names rides beside its files and is never what the
 * files wait on: a read of the people that fails is said once in the log and
 * leaves them out, as a service before them did. A pull request's overview
 * is named the same way, where naming its people is never what it waits
 * on either: a naming that fails names everyone as themself on GitHub. The
 * overview's two reads that name anyone, the pull request itself and its
 * conversation, are each named on their own, so neither waits on the other.
 */

import { Database, type DatabaseServices } from "@luke/database/core/query";
import { account, member } from "@luke/database/schemas/auth";
import type {
  CodingAgentAuthor,
  CodingAgentChangesPeople,
  CodingAgentOverviewConversation,
  CodingAgentOverviewPullRequest,
  GitHubPerson,
} from "@luke/features/coding-agent-wire";
import { and, eq, inArray } from "drizzle-orm";
import { Effect, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlSchema } from "effect/sql";
import { GITHUB_PROVIDER_ID } from "./github-app.js";
import {
  type GitHubAccount,
  type GitHubOverviewConversation,
  type GitHubOverviewPullRequest,
  type PullRequestPeople,
  pullRequestPeople,
} from "./pull-requests.js";

/** What an agent's changes say of who their pull request names; every key absent where the people could not be read. */
type ChangesPeople = CodingAgentChangesPeople;

const findLinkedMembers = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    githubIds: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({ githubId: Schema.String, userId: Schema.String }),
  execute: ({ organizationId, githubIds }) =>
    Database.use((db) =>
      db
        .select({ githubId: account.accountId, userId: account.userId })
        .from(account)
        .innerJoin(member, eq(member.userId, account.userId))
        .where(
          and(
            eq(account.providerId, GITHUB_PROVIDER_ID),
            inArray(account.accountId, [...githubIds]),
            eq(member.organizationId, organizationId),
          ),
        ),
    ),
});

/** Every GitHub id the accounts name, each once. */
function idsOf(accounts: readonly GitHubAccount[]): readonly number[] {
  return [...new Set(accounts.map((each) => each.id))];
}

/** Every account the people name. */
function accountsOfPeople(people: PullRequestPeople): readonly GitHubAccount[] {
  return [
    ...(people.author === undefined ? [] : [people.author]),
    ...people.reviewers.map((reviewer) => reviewer.account),
    ...people.commitAuthors,
    ...people.comments.map((comment) => comment.account),
  ];
}

/** The workspace's members whose linked GitHub account is one of the ids given, by GitHub's id. */
const linkedMembers = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  githubIds: readonly number[],
) {
  if (githubIds.length === 0) return new Map<number, string>();
  const rows = yield* findLinkedMembers({ organizationId, githubIds: githubIds.map(String) });
  return new Map(rows.map((row) => [Number(row.githubId), row.userId]));
});

/** A person as the wire names them, while what is known of them is added. */
interface PersonBeingNamed {
  login: string;
  bot: boolean;
  avatarUrl?: string;
  userId?: string;
}

/** The people as the wire carries them, while who opened the pull request is added where GitHub names them. */
interface PeopleBeingNamed {
  author?: GitHubPerson;
  reviewers: NonNullable<ChangesPeople["reviewers"]>;
  commitAuthors: NonNullable<ChangesPeople["commitAuthors"]>;
  comments: NonNullable<ChangesPeople["comments"]>;
}

/** One account as the wire names it, and the member it is linked to. */
function personOf(held: GitHubAccount, linked: ReadonlyMap<number, string>): GitHubPerson {
  const person: PersonBeingNamed = {
    login: held.login,
    bot: held.bot,
  };
  if (held.avatarUrl !== undefined) person.avatarUrl = held.avatarUrl;
  const userId = linked.get(held.id);
  if (userId !== undefined) person.userId = userId;
  return person;
}

/** The people as the wire carries them. */
function changesPeopleOf(
  people: PullRequestPeople,
  linked: ReadonlyMap<number, string>,
): ChangesPeople {
  const person = (held: GitHubAccount) => personOf(held, linked);
  const answer: PeopleBeingNamed = {
    reviewers: people.reviewers.map(({ account: held, state }) => ({ by: person(held), state })),
    commitAuthors: people.commitAuthors.map(person),
    comments: people.comments.map(({ account: held, state, excerpt, at }) => ({
      by: person(held),
      state,
      excerpt,
      at,
    })),
  };
  if (people.author !== undefined) answer.author = person(people.author);
  return answer;
}

/**
 * Who the agent's pull request names, read on the token minted for its
 * repository and named against its workspace's members; nothing, said once
 * in the log, where any part of the read fails.
 */
export const changesPeople = /* @__PURE__ */ Effect.fn("web/changesPeople")(function* (
  token: Redacted.Redacted,
  agent: { readonly repository: string; readonly organizationId: string },
  number: number,
): Effect.fn.Return<ChangesPeople, never, HttpClient.HttpClient | DatabaseServices> {
  return yield* Effect.gen(function* () {
    const people = yield* pullRequestPeople(token, agent.repository, number);
    const linked = yield* linkedMembers(agent.organizationId, idsOf(accountsOfPeople(people)));
    return changesPeopleOf(people, linked);
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`who pull request ${number} names was not read: ${failure._tag}`),
        {},
      ),
    ),
  );
});

/** How an overview's read names a GitHub account: as the wire carries a person. */
type Namer = (held: GitHubAccount) => GitHubPerson;

/**
 * How the accounts given are named, against the agent's workspace's
 * members; where linking them fails, said once in the log, each is named as
 * themself on GitHub.
 */
const overviewNamer = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  accounts: readonly GitHubAccount[],
  number: number,
): Effect.fn.Return<Namer, never, DatabaseServices> {
  const linked = yield* linkedMembers(organizationId, idsOf(accounts)).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`who pull request ${number} names was not linked: ${failure._tag}`),
        new Map<number, string>(),
      ),
    ),
  );
  return (held) => personOf(held, linked);
});

/**
 * A pull request itself as the wire carries it for its overview, who opened
 * it and who it asks for a review named as `overviewNamer` names them, with
 * who the agent writes as.
 */
export const namedOverviewPullRequest = /* @__PURE__ */ Effect.fn("web/namedOverviewPullRequest")(
  function* (
    agent: {
      readonly organizationId: string;
      readonly author: CodingAgentAuthor | null;
    },
    read: GitHubOverviewPullRequest,
  ): Effect.fn.Return<CodingAgentOverviewPullRequest, never, DatabaseServices> {
    const { pullRequest, author, requested, ...rest } = read;
    const accounts = [...(author === undefined ? [] : [author]), ...requested];
    const person = yield* overviewNamer(agent.organizationId, accounts, pullRequest.number);
    return {
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      state: pullRequest.state,
      ...rest,
      ...(author === undefined ? undefined : { author: person(author) }),
      ...(agent.author === null ? undefined : { writtenAs: agent.author }),
      requested: requested.map(person),
    };
  },
);

/** Every account a conversation names. */
function accountsOfConversation(read: GitHubOverviewConversation): readonly GitHubAccount[] {
  return [
    ...read.reviewers.map((reviewer) => reviewer.account),
    ...read.conversation.flatMap((entry) => [
      entry.account,
      ...entry.threads.flatMap((thread) => thread.comments.map((comment) => comment.account)),
    ]),
  ];
}

/**
 * A pull request's conversation as the wire carries it for its overview,
 * where each reviewer stands and every comment, review, and thread comment
 * named as `overviewNamer` names them.
 */
export const namedOverviewConversation = /* @__PURE__ */ Effect.fn("web/namedOverviewConversation")(
  function* (
    agent: { readonly organizationId: string },
    number: number,
    read: GitHubOverviewConversation,
  ): Effect.fn.Return<CodingAgentOverviewConversation, never, DatabaseServices> {
    const person = yield* overviewNamer(agent.organizationId, accountsOfConversation(read), number);
    return {
      earlier: read.earlier,
      reviewers: read.reviewers.map(({ account: held, state }) => ({ by: person(held), state })),
      conversation: read.conversation.map(({ account: held, state, threads, ...entry }) => ({
        ...entry,
        by: person(held),
        ...(state === undefined ? undefined : { state }),
        ...(threads.length === 0
          ? undefined
          : {
              threads: threads.map(({ reviewId: _review, comments, ...thread }) => ({
                ...thread,
                comments: comments.map(({ account: author, ...comment }) => ({
                  ...comment,
                  by: person(author),
                })),
              })),
            }),
      })),
    };
  },
);
