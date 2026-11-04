/**
 * token-repository-writes.ts -- a token repository's addition or removal drawn over its workspace's list the moment it is asked, through the sync engine's pool, over the lists the host fetches for the windows.
 *
 * A workspace's token repositories are fetched rather than followed
 * (`held-fetch.ts`), and laid whole from each addition's or removal's own
 * answer, so the fetch keeps them as it answered them: its read stands
 * beside the pool (`PoolRead.beside`), holding none of the kind's rows, and
 * every change standing is drawn over the lists it tells (`drawn`). A
 * change names its workspace, since the read beside the pool takes it with
 * no key of its own. The service answers each write with the list as it
 * then stands, which its send lays on the fetch before the write stands
 * down, so a refusal takes back only what the write drew.
 */

import type { WorkspaceTokenRepository } from "@repo/features/github-repositories-wire";
import type { TasksWorkspaceTokenRepositorySetParams } from "@repo/features/tasks-view";
import type {
  EntityKind,
  EntityPool,
  HeldRows,
  Refused,
  WriteDeclaration,
  Written,
} from "@repo/sync";
import { Effect, Equal, type Scope } from "effect";
import type { AppTokenRepositories } from "./app-state.js";

/** One workspace's token repositories, newest added first. */
interface TokenRepositoriesRow {
  readonly workspaceId: string;
  readonly repositories: readonly WorkspaceTokenRepository[];
}

/** A change to one workspace's token repositories: the list as it leaves it. */
interface TokenRepositoriesChange {
  readonly workspaceId: string;
  readonly listed: (
    repositories: readonly WorkspaceTokenRepository[],
  ) => readonly WorkspaceTokenRepository[];
}

/** A workspace's token repositories, by the workspace, every addition and removal a change of its list. */
const TOKEN_REPOSITORIES: EntityKind<TokenRepositoriesRow, TokenRepositoriesChange> = {
  key: (row) => row.workspaceId,
  drawn: (change, row) => {
    if (row === undefined) return undefined;
    const repositories = change.listed(row.repositories);
    return Equal.equals(repositories, row.repositories) ? undefined : { ...row, repositories };
  },
};

/** An addition or a removal as it is asked: the repository, whether it is added, and who added it when, which an addition is drawn with. */
export interface TokenRepositorySet extends TasksWorkspaceTokenRepositorySetParams {
  readonly addedBy: string;
  readonly addedAt: number;
}

/** What an addition's or a removal's service answered: the caller's answer and the list as it then stands, or the caller's answer for a refusal. */
export type TokenRepositorySetWritten<Answer> =
  | { readonly answer: Answer; readonly repositories: readonly WorkspaceTokenRepository[] }
  | { readonly refused: Answer };

export interface TokenRepositoryWritesDependencies {
  readonly pool: EntityPool;
  /** The lists as the fetch last told them, with no write drawn over them. */
  readonly fetched: () => AppTokenRepositories;
  /** Tells the lists again, as `drawn` draws them now. */
  readonly tell: Effect.Effect<void>;
  /** Lays the list the service answered as the workspace's, as the fetch's own answer would. */
  readonly answered: (
    workspaceId: string,
    repositories: readonly WorkspaceTokenRepository[],
  ) => Effect.Effect<void>;
}

/** The token repository writes, and the lists drawn with them. */
export interface TokenRepositoryWrites {
  /** `lists` with every change standing drawn over its workspace's list. */
  readonly drawn: (lists: AppTokenRepositories) => AppTokenRepositories;
  /** An addition or a removal sent as `send` asks, drawn on its workspace's list at once, standing until the service answers its list. */
  readonly set: <Answer>(
    send: (set: TokenRepositorySet) => Effect.Effect<TokenRepositorySetWritten<Answer>>,
  ) => WriteDeclaration<TokenRepositoriesRow, TokenRepositoriesChange, TokenRepositorySet, Answer>;
}

/** Whether `repository` names `fullName`, as GitHub reads a name, whatever its case. */
function names(repository: WorkspaceTokenRepository, fullName: string): boolean {
  return repository.fullName.toLowerCase() === fullName.toLowerCase();
}

/** The list as `set` leaves it: an addition first, as the newest, unless listed already, and a removal left out. */
function listedAfter(set: TokenRepositorySet): TokenRepositoriesChange["listed"] {
  return (repositories) => {
    const kept = repositories.filter((each) => !names(each, set.repository));
    if (!set.added) return kept.length === repositories.length ? repositories : kept;
    if (kept.length !== repositories.length) return repositories;
    const { repository: fullName, addedBy, addedAt } = set;
    return [{ fullName, addedBy, addedAt, removable: true }, ...repositories];
  };
}

/** The token repository writes, their read standing beside the pool for the caller's scope. */
export function tokenRepositoryWrites(
  dependencies: TokenRepositoryWritesDependencies,
): Effect.Effect<TokenRepositoryWrites, never, Scope.Scope> {
  return Effect.gen(function* () {
    const beside: HeldRows<TokenRepositoriesRow, TokenRepositoriesChange> =
      yield* dependencies.pool.stand(TOKEN_REPOSITORIES, {
        redraw: () => dependencies.tell,
        confirmation: () => undefined,
        beside: {
          shows: (workspaceId) => dependencies.fetched()[workspaceId]?.rows !== undefined,
          // Note that the write's send lays the list the service answered itself (`answered`), so nothing is taken here.
          take: () => undefined,
        },
      });
    const drawn = (lists: AppTokenRepositories): AppTokenRepositories => {
      const standing = beside.standing();
      if (standing.length === 0) return lists;
      return Object.fromEntries(
        Object.entries(lists).map(([workspaceId, read]) => {
          const { rows } = read;
          if (rows === undefined) return [workspaceId, read];
          const listed = standing
            .filter((change) => change.workspaceId === workspaceId)
            .reduce((each, change) => change.listed(each), rows);
          return [workspaceId, listed === rows ? read : { ...read, rows: listed }];
        }),
      );
    };
    const set = <Answer>(
      send: (set: TokenRepositorySet) => Effect.Effect<TokenRepositorySetWritten<Answer>>,
    ): WriteDeclaration<
      TokenRepositoriesRow,
      TokenRepositoriesChange,
      TokenRepositorySet,
      Answer
    > => ({
      kind: TOKEN_REPOSITORIES,
      keys: ({ workspaceId }) => [workspaceId],
      change: (input) => ({ workspaceId: input.workspaceId, listed: listedAfter(input) }),
      send: (input) =>
        Effect.flatMap(
          send(input),
          (sent): Effect.Effect<Written<TokenRepositoriesChange, Answer> | Refused<Answer>> =>
            "refused" in sent
              ? Effect.succeed(sent)
              : Effect.as(dependencies.answered(input.workspaceId, sent.repositories), {
                  answer: sent.answer,
                  txid: undefined,
                }),
        ),
    });
    return { drawn, set };
  });
}
