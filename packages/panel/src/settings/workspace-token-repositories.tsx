import { signedInAccountId } from "@repo/credentials/snapshot";
import type { GitHubRepositoriesAnswer } from "@repo/features/github-repositories-wire";
import {
  GITHUB_ACCESS,
  type WorkspaceTokenRepository,
} from "@repo/features/github-repositories-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { noMatchWords, readFailedWords, readingWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  ANNOUNCE,
  CONFIRM_LOSS,
  ConfirmDialog,
  ErrorState,
  type MenuRow,
  repositoryMenuRow,
  SettingsLine,
  useConfirmDialog,
} from "@repo/ui";
import { neverBusyAct } from "@repo/ui/confirm-state";
import { GLYPH } from "@repo/ui/icons";
import { type UseQueryResult, useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { actMutation, pressMutation } from "../act-mutations.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import {
  githubTokenQuery,
  repositoryListsQuery,
  repositoryListsRetryMutation,
  repositoryScope,
  tokenRepositoriesQuery,
  tokenRepositoriesRetryMutation,
} from "../live-reads.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { CheckedRepositoryChip } from "../tasks/repository-chip.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { AddMenuButton } from "./add-menu-button.js";
import { GitHubOwnerRow, repositoryCount } from "./workspace-github-accounts.js";

const WORDS = {
  ADD: "Add repository",
  ADD_SEVERAL: "Add repositories",
  MENU: "Repositories",
  NOT_YOURS: "Added by a teammate",
  REMOVE: "Remove",
  REMOVING: "Removing",
  SEARCH: "Search repositories",
  NO_MATCH: noMatchWords(TERM.REPOSITORY),
  NONE: "No repositories",
  READING: readingWords(TERM.REPOSITORY.many),
  NOT_READ: readFailedWords("the repositories"),
  ROWS_READING: readingWords("token repositories"),
  ROWS_NOT_READ: readFailedWords("the token repositories"),
} as const;

export const TOKEN_REPOSITORIES_READ = {
  READING: "reading",
  FAILED: "failed",
  READY: "ready",
} as const;

export type TokenRepositoriesRead =
  (typeof TOKEN_REPOSITORIES_READ)[keyof typeof TOKEN_REPOSITORIES_READ];

export interface TokenRepositories {
  readonly read: TokenRepositoriesRead;
  readonly listed: readonly WorkspaceTokenRepository[];
  readonly retry: () => void;
  readonly change: (repository: string, added: boolean) => Promise<string | undefined>;
  readonly remove: (repository: string) => void;
}

function tokenRepositoriesReadOf(
  read: UseQueryResult<readonly WorkspaceTokenRepository[]>,
): TokenRepositoriesRead {
  if (read.data !== undefined) return TOKEN_REPOSITORIES_READ.READY;
  return read.isError ? TOKEN_REPOSITORIES_READ.FAILED : TOKEN_REPOSITORIES_READ.READING;
}

const NONE_LISTED: readonly WorkspaceTokenRepository[] = [];

export function useTokenRepositories(workspaceId: string): TokenRepositories {
  const { mutateAsync: changeTokenRepository } = useMutation(
    actMutation(ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET),
  );
  const { mutate: removeTokenRepository } = useMutation(
    pressMutation(ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET),
  );
  const read = useQuery(tokenRepositoriesQuery(workspaceId));
  const { mutate: retry } = useMutation(tokenRepositoriesRetryMutation());
  const change = useCallback(
    (repository: string, added: boolean) =>
      changeTokenRepository({ workspaceId, repository, added }).then(
        () => undefined,
        (refused: Error) => refused.message,
      ),
    [changeTokenRepository, workspaceId],
  );
  const remove = useCallback(
    (repository: string) =>
      removeTokenRepository({
        workspaceId,
        repository,
        added: false,
      }),
    [removeTokenRepository, workspaceId],
  );
  return {
    read: tokenRepositoriesReadOf(read),
    listed: read.data ?? NONE_LISTED,
    retry: () => retry({ workspaceId }),
    change,
    remove,
  };
}

type Candidates =
  | { readonly kind: "reading" }
  | { readonly kind: "failed" }
  | { readonly kind: "read"; readonly rows: readonly MenuRow[] };

function candidatesOf(
  list: UseQueryResult<GitHubRepositoriesAnswer>,
  listed: readonly { readonly fullName: string }[],
  pictures: boolean,
): Candidates {
  if (list.data === undefined) {
    return list.isError ? { kind: "failed" } : { kind: "reading" };
  }
  const added = new Set(listed.map((one) => one.fullName.toLowerCase()));
  const { addable, repositories } = list.data;
  const offered = addable ?? repositories.filter((one) => one.access === GITHUB_ACCESS.TOKEN);
  const rows = offered
    .filter((one) => !added.has(one.fullName.toLowerCase()))
    .map((one) => repositoryMenuRow(one.fullName, pictures));
  return { kind: "read", rows };
}

export function AddTokenRepository(props: {
  workspaceId: string;
  repositories: TokenRepositories;
  onRefused: (refusal: string | undefined) => void;
}): React.JSX.Element | null {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const token = useQuery(githubTokenQuery(accountId));
  return token.data?.token ? <AddRepositoryMenu {...props} /> : null;
}

function AddRepositoryMenu({
  workspaceId,
  repositories,
  onRefused,
}: {
  workspaceId: string;
  repositories: TokenRepositories;
  onRefused: (refusal: string | undefined) => void;
}): React.JSX.Element {
  const pictures = useRepositoryPictures();
  const list = useQuery(repositoryListsQuery(workspaceId));
  const { mutate: retry } = useMutation(repositoryListsRetryMutation());
  const read = () => {
    if (list.isError) retry(repositoryScope(workspaceId));
  };
  const candidates = candidatesOf(list, repositories.listed, pictures);
  const rows = candidates.kind === "read" ? candidates.rows : [];
  const note =
    candidates.kind === "reading"
      ? WORDS.READING
      : candidates.kind === "failed"
        ? WORDS.NOT_READ
        : rows.length === 0
          ? WORDS.NONE
          : undefined;
  return (
    <AddMenuButton
      label={WORDS.ADD}
      placeholder={WORDS.SEARCH}
      noMatch={WORDS.NO_MATCH}
      rows={rows}
      note={note}
      onOpen={read}
      onPick={(id) => {
        onRefused(undefined);
        repositories.change(id, true).then(onRefused, () => undefined);
      }}
    />
  );
}

interface PickerRepository {
  readonly fullName: string;
  readonly updatedAt: number;
}

function pickerRepositories(
  rows: GitHubRepositoriesAnswer | undefined,
): readonly PickerRepository[] | undefined {
  if (rows === undefined) return undefined;
  const byName = new Map<string, PickerRepository>();
  const onToken = rows.repositories.filter((one) => one.access === GITHUB_ACCESS.TOKEN);
  for (const one of [...onToken, ...(rows.addable ?? [])]) {
    byName.set(one.fullName.toLowerCase(), one);
  }
  return [...byName.values()].sort((one, other) => other.updatedAt - one.updatedAt);
}

export function TokenRepositoryPicker({
  workspaceId,
  repositories,
  onRefused,
}: {
  workspaceId: string;
  repositories: TokenRepositories;
  onRefused: (refusal: string | undefined) => void;
}): React.JSX.Element {
  const pictures = useRepositoryPictures();
  const list = useQuery(repositoryListsQuery(workspaceId));
  const { mutate: retry } = useMutation(repositoryListsRetryMutation());
  const [pending, setPending] = useState<ReadonlyMap<string, boolean>>(new Map());
  const presses = useRef(new Map<string, number>());
  const listed = new Map(repositories.listed.map((one) => [one.fullName.toLowerCase(), one]));
  const isOn = (fullName: string) =>
    pending.get(fullName.toLowerCase()) ?? listed.has(fullName.toLowerCase());
  const offered = pickerRepositories(list.data);
  const rows: MenuRow[] = (offered ?? []).map((one) => {
    const row = repositoryMenuRow(one.fullName, pictures);
    const held = listed.get(one.fullName.toLowerCase());
    return held !== undefined && !held.removable ? { ...row, disabled: WORDS.NOT_YOURS } : row;
  });
  const settle = (key: string) =>
    setPending((was) => {
      const next = new Map(was);
      next.delete(key);
      return next;
    });
  const toggle = (fullName: string) => {
    const key = fullName.toLowerCase();
    const added = !isOn(fullName);
    const press = (presses.current.get(key) ?? 0) + 1;
    presses.current.set(key, press);
    const latest = () => presses.current.get(key) === press;
    setPending((was) => new Map(was).set(key, added));
    onRefused(undefined);
    repositories.change(fullName, added).then(
      (refusal) => {
        if (!latest()) return;
        settle(key);
        onRefused(refusal);
      },
      () => {
        if (latest()) settle(key);
      },
    );
  };
  return (
    <CheckedRepositoryChip
      rows={rows}
      picked={(offered ?? []).map((one) => one.fullName).filter(isOn)}
      pictures={pictures}
      empty={WORDS.ADD_SEVERAL}
      note={
        offered === undefined
          ? list.isError
            ? WORDS.NOT_READ
            : WORDS.READING
          : rows.length === 0
            ? WORDS.NONE
            : undefined
      }
      onToggle={toggle}
      onOpen={() => {
        if (list.isError) retry(repositoryScope(workspaceId));
      }}
    />
  );
}

interface TokenOwner {
  readonly login: string;
  readonly repositories: readonly WorkspaceTokenRepository[];
}

function nameOf(repository: WorkspaceTokenRepository): string {
  return repository.fullName.slice(repository.fullName.indexOf("/") + 1);
}

function tokenOwners(listed: readonly WorkspaceTokenRepository[]): readonly TokenOwner[] {
  const byOwner = new Map<string, { login: string; repositories: WorkspaceTokenRepository[] }>();
  for (const repository of listed) {
    const login = repository.fullName.slice(0, repository.fullName.indexOf("/"));
    const key = login.toLowerCase();
    const owner = byOwner.get(key);
    if (owner === undefined) byOwner.set(key, { login, repositories: [repository] });
    else owner.repositories.push(repository);
  }
  return [...byOwner.values()].sort((one, other) =>
    one.login.localeCompare(other.login, undefined, { sensitivity: "base" }),
  );
}

function TokenOwnerRow({
  owner,
  onRemove,
}: {
  owner: TokenOwner;
  onRemove: (repository: string) => void;
}): React.JSX.Element {
  const [asked, setAsked] = useState<WorkspaceTokenRepository>();
  const standing =
    asked !== undefined &&
    owner.repositories.some((one) => one.fullName === asked.fullName && one.removable);
  const removal = useConfirmDialog(
    { subject: standing, surfaceOpen: true },
    neverBusyAct(() => {
      if (asked !== undefined) onRemove(asked.fullName);
    }),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_REPOSITORY_REMOVE),
  );
  const actions = owner.repositories
    .filter((repository) => repository.removable)
    .map((repository) => ({
      label: `${WORDS.REMOVE} ${nameOf(repository)}`,
      replayMasked: true,
      icon: <GLYPH.REMOVE />,
      danger: true,
      onSelect: () => {
        setAsked(repository);
        removal.ask();
      },
    }));
  return (
    <>
      <GitHubOwnerRow
        login={owner.login}
        line={repositoryCount(owner.repositories.length)}
        names={owner.repositories.map(nameOf)}
        actions={actions}
      />
      <ConfirmDialog
        open
        confirm={removal}
        question={{
          title: `Remove ${asked?.fullName ?? ""}?`,
          body: "Agents in this workspace stop reaching it until someone adds it again.",
          verb: "Remove repository",
          running: WORDS.REMOVING,
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </>
  );
}

export function TokenOwnerRows({
  repositories,
}: {
  repositories: TokenRepositories;
}): React.JSX.Element {
  const reading = repositories.read === TOKEN_REPOSITORIES_READ.READING;
  useAnnounceShown(ANNOUNCE.POLITE, reading ? WORDS.ROWS_READING : "");
  if (reading) {
    return (
      <SettingsLine>
        <span>{WORDS.ROWS_READING}</span>
      </SettingsLine>
    );
  }
  if (repositories.read === TOKEN_REPOSITORIES_READ.FAILED) {
    return (
      <SettingsLine>
        <ErrorState
          failure={unreadShown(FAILURE_SURFACE.WORKSPACE_REPOSITORIES_READ)}
          onRetry={repositories.retry}
        >
          {WORDS.ROWS_NOT_READ}
        </ErrorState>
      </SettingsLine>
    );
  }
  return (
    <>
      {tokenOwners(repositories.listed).map((owner) => (
        <TokenOwnerRow
          key={owner.login.toLowerCase()}
          owner={owner}
          onRemove={repositories.remove}
        />
      ))}
    </>
  );
}
