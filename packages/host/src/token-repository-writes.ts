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

interface TokenRepositoriesRow {
  readonly workspaceId: string;
  readonly repositories: readonly WorkspaceTokenRepository[];
}

interface TokenRepositoriesChange {
  readonly workspaceId: string;
  readonly listed: (
    repositories: readonly WorkspaceTokenRepository[],
  ) => readonly WorkspaceTokenRepository[];
}

const TOKEN_REPOSITORIES: EntityKind<TokenRepositoriesRow, TokenRepositoriesChange> = {
  key: (row) => row.workspaceId,
  drawn: (change, row) => {
    if (row === undefined) return undefined;
    const repositories = change.listed(row.repositories);
    return Equal.equals(repositories, row.repositories) ? undefined : { ...row, repositories };
  },
};

export interface TokenRepositorySet extends TasksWorkspaceTokenRepositorySetParams {
  readonly addedBy: string;
  readonly addedAt: number;
  readonly session: number;
}

export type TokenRepositorySetWritten<Answer> =
  | { readonly answer: Answer; readonly repositories: readonly WorkspaceTokenRepository[] }
  | { readonly refused: Answer };

export interface TokenRepositoryWritesDependencies {
  readonly pool: EntityPool;
  readonly fetched: () => AppTokenRepositories;
  readonly tell: Effect.Effect<void>;
  readonly answered: (
    workspaceId: string,
    repositories: readonly WorkspaceTokenRepository[],
  ) => Effect.Effect<void>;
}

export interface TokenRepositoryWrites {
  readonly drawn: (lists: AppTokenRepositories) => AppTokenRepositories;
  readonly set: <Answer>(
    send: (set: TokenRepositorySet) => Effect.Effect<TokenRepositorySetWritten<Answer>>,
    unsent: Answer,
  ) => WriteDeclaration<TokenRepositoriesRow, TokenRepositoriesChange, TokenRepositorySet, Answer>;
  readonly session: () => number;
  readonly letGo: Effect.Effect<void>;
}

function names(repository: WorkspaceTokenRepository, fullName: string): boolean {
  return repository.fullName.toLowerCase() === fullName.toLowerCase();
}

function listedAfter(set: TokenRepositorySet): TokenRepositoriesChange["listed"] {
  return (repositories) => {
    const kept = repositories.filter((each) => !names(each, set.repository));
    if (!set.added) return kept.length === repositories.length ? repositories : kept;
    if (kept.length !== repositories.length) return repositories;
    const { repository: fullName, addedBy, addedAt } = set;
    return [{ fullName, addedBy, addedAt, removable: true }, ...repositories];
  };
}

export function tokenRepositoryWrites(
  dependencies: TokenRepositoryWritesDependencies,
): Effect.Effect<TokenRepositoryWrites, never, Scope.Scope> {
  return Effect.gen(function* () {
    let session = 0;
    const beside: HeldRows<TokenRepositoriesRow, TokenRepositoriesChange> =
      yield* dependencies.pool.stand(TOKEN_REPOSITORIES, {
        redraw: () => dependencies.tell,
        confirmation: () => undefined,
        beside: {
          shows: (workspaceId) => dependencies.fetched()[workspaceId]?.rows !== undefined,
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
      unsent: Answer,
    ): WriteDeclaration<
      TokenRepositoriesRow,
      TokenRepositoriesChange,
      TokenRepositorySet,
      Answer
    > => ({
      kind: TOKEN_REPOSITORIES,
      keys: ({ workspaceId }) => [workspaceId],
      change: (input) => {
        const listed = listedAfter(input);
        return {
          workspaceId: input.workspaceId,
          listed: (repositories) =>
            session === input.session ? listed(repositories) : repositories,
        };
      },
      send: (input) =>
        Effect.suspend(
          (): Effect.Effect<Written<TokenRepositoriesChange, Answer> | Refused<Answer>> => {
            if (session !== input.session) return Effect.succeed({ refused: unsent });
            return Effect.flatMap(
              send(input),
              (sent): Effect.Effect<Written<TokenRepositoriesChange, Answer> | Refused<Answer>> => {
                if ("refused" in sent) return Effect.succeed(sent);
                const kept = { answer: sent.answer, txid: undefined };
                if (session !== input.session) return Effect.succeed(kept);
                return Effect.as(dependencies.answered(input.workspaceId, sent.repositories), kept);
              },
            );
          },
        ),
    });
    const letGo = Effect.sync(() => {
      session += 1;
    });
    return { drawn, set, session: () => session, letGo };
  });
}
