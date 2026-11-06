import { Database, type DatabaseServices } from "@repo/database/core/query";
import { listAgentsOnPullRequest } from "@repo/database/models/agent-store";
import { account, member } from "@repo/database/schemas/auth";
import type {
  AgentAuthor,
  AgentChangesPeople,
  AgentOverviewConversation,
  AgentOverviewPullRequest,
  AgentReviewOptions,
  GitHubPerson,
  PullRequestStackEntry,
  ReactionGroup,
} from "@repo/features/agent-wire";
import { and, eq, inArray } from "drizzle-orm";
import { Effect, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlSchema } from "effect/sql";
import { GITHUB_PROVIDER_ID } from "./github-app.js";
import type { StackEntry } from "./pull-request-stack.js";
import {
  type GitHubAccount,
  type GitHubOverviewConversation,
  type GitHubOverviewPullRequest,
  type GitHubReaction,
  type GitHubReviewOptions,
  type PullRequestPeople,
  pullRequestPeople,
  type ViewerPendingReview,
} from "./pull-requests.js";

type ChangesPeople = AgentChangesPeople;

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

function idsOf(accounts: readonly GitHubAccount[]): readonly number[] {
  return [...new Set(accounts.map((each) => each.id))];
}

function accountsOfPeople(people: PullRequestPeople): readonly GitHubAccount[] {
  return [
    ...(people.author === undefined ? [] : [people.author]),
    ...people.reviewers.map((reviewer) => reviewer.account),
    ...people.comments.map((comment) => comment.account),
  ];
}

const linkedMembers = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  githubIds: readonly number[],
) {
  if (githubIds.length === 0) return new Map<number, string>();
  const rows = yield* findLinkedMembers({ organizationId, githubIds: githubIds.map(String) });
  return new Map(rows.map((row) => [Number(row.githubId), row.userId]));
});

interface PersonBeingNamed {
  login: string;
  bot: boolean;
  avatarUrl?: string;
  userId?: string;
}

interface PeopleBeingNamed {
  author?: GitHubPerson;
  reviewers: NonNullable<ChangesPeople["reviewers"]>;
  comments: NonNullable<ChangesPeople["comments"]>;
}

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

function changesPeopleOf(
  people: PullRequestPeople,
  linked: ReadonlyMap<number, string>,
): ChangesPeople {
  const person = (held: GitHubAccount) => personOf(held, linked);
  const answer: PeopleBeingNamed = {
    reviewers: people.reviewers.map(({ account: held, state }) => ({ by: person(held), state })),
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

type Namer = (held: GitHubAccount) => GitHubPerson;

const overviewNamer = /* @__PURE__ */ Effect.fnUntraced(function* (
  organizationId: string,
  accounts: readonly GitHubAccount[],
  about: string,
): Effect.fn.Return<Namer, never, DatabaseServices> {
  const linked = yield* linkedMembers(organizationId, idsOf(accounts)).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`who ${about} names was not linked: ${failure._tag}`),
        new Map<number, string>(),
      ),
    ),
  );
  return (held) => personOf(held, linked);
});

const AGENTS_PER_STACK_ENTRY = 4;

const STACK_LOOKUPS = 4;

const stackOwnerOf = (
  agent: { readonly organizationId: string; readonly repository: string },
  number: number,
) =>
  listAgentsOnPullRequest(agent.repository, number, AGENTS_PER_STACK_ENTRY).pipe(
    Effect.map((owned) => {
      const owner = owned.find(
        ({ agent: each }) =>
          each.organizationId === agent.organizationId && each.archivedAt === null,
      )?.agent;
      return owner === undefined ? undefined : { id: owner.id, taskId: owner.taskId };
    }),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `the agent of stacked pull request ${number} was not read: ${failure._tag}`,
        ),
        undefined,
      ),
    ),
  );

const namedStack = (
  agent: { readonly organizationId: string; readonly repository: string },
  stack: readonly StackEntry[],
) =>
  Effect.forEach(
    stack,
    (entry) =>
      Effect.map(
        stackOwnerOf(agent, entry.number),
        (owner): PullRequestStackEntry =>
          owner === undefined ? entry : { ...entry, agent: owner },
      ),
    { concurrency: STACK_LOOKUPS },
  );

export const namedOverviewPullRequest = /* @__PURE__ */ Effect.fn("web/namedOverviewPullRequest")(
  function* (
    agent: {
      readonly organizationId: string;
      readonly repository: string;
      readonly author: AgentAuthor | null;
    },
    read: GitHubOverviewPullRequest,
  ): Effect.fn.Return<AgentOverviewPullRequest, never, DatabaseServices> {
    const { pullRequest, author, requested, stack, ...rest } = read;
    const accounts = [...(author === undefined ? [] : [author]), ...requested];
    const [person, named] = yield* Effect.all(
      [
        overviewNamer(agent.organizationId, accounts, `pull request ${pullRequest.number}`),
        namedStack(agent, stack),
      ],
      { concurrency: "unbounded" },
    );
    return {
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      state: pullRequest.state,
      ...rest,
      ...(author === undefined ? undefined : { author: person(author) }),
      ...(agent.author === null ? undefined : { writtenAs: agent.author }),
      requested: requested.map(person),
      stack: named,
    };
  },
);

function accountsOfConversation(read: GitHubOverviewConversation): readonly GitHubAccount[] {
  return [
    ...read.reviewers.map((reviewer) => reviewer.account),
    ...accountsOfReactions(read.descriptionReactions),
    ...read.conversation.flatMap((entry) => [
      entry.account,
      ...accountsOfReactions(entry.reactions),
      ...entry.threads.flatMap((thread) =>
        thread.comments.flatMap((comment) => [
          comment.account,
          ...accountsOfReactions(comment.reactions),
        ]),
      ),
    ]),
  ];
}

function accountsOfReactions(reactions: readonly GitHubReaction[]): readonly GitHubAccount[] {
  return reactions.flatMap((reaction) => reaction.accounts ?? []);
}

function namedReactions(
  reactions: readonly GitHubReaction[],
  person: (held: GitHubAccount) => GitHubPerson,
): readonly ReactionGroup[] | undefined {
  if (reactions.length === 0) return undefined;
  return reactions.map(({ content, count, accounts, mine }) => ({
    content,
    count,
    ...(accounts === undefined ? undefined : { by: accounts.map(person) }),
    ...(mine === undefined ? undefined : { mine }),
  }));
}

export const namedOverviewConversation = /* @__PURE__ */ Effect.fn("web/namedOverviewConversation")(
  function* (
    agent: { readonly organizationId: string },
    number: number,
    read: GitHubOverviewConversation,
  ): Effect.fn.Return<AgentOverviewConversation, never, DatabaseServices> {
    const person = yield* overviewNamer(
      agent.organizationId,
      accountsOfConversation(read),
      `pull request ${number}`,
    );
    const reacted = (given: readonly GitHubReaction[], subject: string | undefined) => {
      const named = namedReactions(given, person);
      return {
        ...(named === undefined ? undefined : { reactions: named }),
        ...(subject === undefined ? undefined : { subject }),
      };
    };
    const description = namedReactions(read.descriptionReactions, person);
    return {
      earlier: read.earlier,
      reviewers: read.reviewers.map(({ account: held, state }) => ({ by: person(held), state })),
      conversation: read.conversation.map(
        ({ account: held, state, threads, reactions, subject, ...entry }) => ({
          ...entry,
          by: person(held),
          ...(state === undefined ? undefined : { state }),
          ...(threads.length === 0
            ? undefined
            : {
                threads: threads.map(({ reviewId: _review, comments, ...thread }) => ({
                  ...thread,
                  comments: comments.map(
                    ({ account: author, reactions: given, subject: on, ...comment }) => ({
                      ...comment,
                      by: person(author),
                      ...reacted(given, on),
                    }),
                  ),
                })),
              }),
          ...reacted(reactions, subject),
        }),
      ),
      ...(description === undefined ? undefined : { descriptionReactions: description }),
      ...(read.descriptionSubject === undefined
        ? undefined
        : { descriptionSubject: read.descriptionSubject }),
    };
  },
);

type NamedPendingReview = NonNullable<AgentOverviewConversation["pendingReview"]>;

export const namedPendingReview = /* @__PURE__ */ Effect.fn("web/namedPendingReview")(function* (
  agent: { readonly organizationId: string },
  number: number,
  read: ViewerPendingReview | null,
): Effect.fn.Return<NamedPendingReview | null, never, DatabaseServices> {
  if (read === null) return null;
  const person = yield* overviewNamer(
    agent.organizationId,
    read.drafts.map((draft) => draft.account),
    `the pending review on pull request ${number}`,
  );
  return {
    comments: read.comments,
    drafts: read.drafts.map(({ account: held, threadId, ...draft }) => ({
      ...draft,
      ...(threadId === undefined ? undefined : { threadId }),
      by: person(held),
    })),
  };
});

export const namedReviewOptions = /* @__PURE__ */ Effect.fn("web/namedReviewOptions")(function* (
  agent: { readonly organizationId: string },
  read: GitHubReviewOptions,
): Effect.fn.Return<AgentReviewOptions, never, DatabaseServices> {
  const person = yield* overviewNamer(
    agent.organizationId,
    read.users,
    "the repository's assignable users",
  );
  return { labels: read.labels, users: read.users.map(person), teams: read.teams };
});
