/**
 * github-people.ts -- who a pull request names, as an agent's changes carry them: each GitHub account by its login and avatar, Luke's own App's bot marked, and a member of the agent's workspace named by the Luke account their GitHub account is linked to.
 *
 * GitHub names everyone by an account of its own, so a login alone would
 * draw a teammate as a stranger. A Luke account that signed in with GitHub
 * keeps a provider row whose `account_id` is GitHub's id for them, and a
 * pull request names that same id, so the two meet by id rather than by a
 * login a person may change. An account is named only where its holder is a
 * member of the agent's own workspace, so the answer never says which Luke
 * account stands behind someone outside it. The App's bot is told apart by
 * GitHub's id for it, read on the same token (`appBot`), since it is the
 * account an agent's commits and pull requests are by, or, where the agent
 * writes as its developer, the co-author its commits name.
 *
 * Who a pull request names rides beside its files and is never what the
 * files wait on: a read of the people that fails is said once in the log and
 * leaves them out, as a service before them did.
 */

import { Database, type DatabaseServices } from "@luke/database/core/query";
import { account, member } from "@luke/database/schemas/auth";
import type { CodingAgentChangesPeople, GitHubPerson } from "@luke/features/coding-agent-wire";
import { and, eq, inArray } from "drizzle-orm";
import { Effect, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlSchema } from "effect/sql";
import { GITHUB_PROVIDER_ID, GitHubApp } from "./github-app.js";
import { type GitHubAccount, type PullRequestPeople, pullRequestPeople } from "./pull-requests.js";

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

/** Every GitHub id the people name, each once. */
function idsOf(people: PullRequestPeople): readonly number[] {
  const accounts = [
    ...(people.author === undefined ? [] : [people.author]),
    ...people.reviewers.map((reviewer) => reviewer.account),
    ...people.commitAuthors,
    ...people.comments.map((comment) => comment.account),
  ];
  return [...new Set(accounts.map((each) => each.id))];
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
  luke?: boolean;
  userId?: string;
}

/** The people as the wire carries them, while who opened the pull request is added where GitHub names them. */
interface PeopleBeingNamed {
  author?: GitHubPerson;
  reviewers: NonNullable<ChangesPeople["reviewers"]>;
  commitAuthors: NonNullable<ChangesPeople["commitAuthors"]>;
  comments: NonNullable<ChangesPeople["comments"]>;
}

/** One account as the wire names it, the member it is linked to and Luke's own bot marked. */
function personOf(
  held: GitHubAccount,
  linked: ReadonlyMap<number, string>,
  lukeBotId: number | undefined,
): GitHubPerson {
  const person: PersonBeingNamed = {
    login: held.login,
    bot: held.bot,
  };
  if (held.avatarUrl !== undefined) person.avatarUrl = held.avatarUrl;
  if (held.id === lukeBotId) person.luke = true;
  const userId = linked.get(held.id);
  if (userId !== undefined) person.userId = userId;
  return person;
}

/** The people as the wire carries them. */
function changesPeopleOf(
  people: PullRequestPeople,
  linked: ReadonlyMap<number, string>,
  lukeBotId: number | undefined,
): ChangesPeople {
  const person = (held: GitHubAccount) => personOf(held, linked, lukeBotId);
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
): Effect.fn.Return<ChangesPeople, never, GitHubApp | HttpClient.HttpClient | DatabaseServices> {
  const app = yield* GitHubApp;
  return yield* Effect.gen(function* () {
    const people = yield* pullRequestPeople(token, agent.repository, number);
    // Note that a bot GitHub would not name leaves Luke's own commits a stranger's, not the read failed.
    const bot = yield* Effect.option(app.appBot(token));
    const linked = yield* linkedMembers(agent.organizationId, idsOf(people));
    return changesPeopleOf(people, linked, Option.getOrUndefined(bot)?.id);
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`who pull request ${number} names was not read: ${failure._tag}`),
        {},
      ),
    ),
  );
});
