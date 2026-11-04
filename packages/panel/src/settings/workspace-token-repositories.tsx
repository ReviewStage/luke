import { signedInAccountId } from "@repo/credentials/snapshot";
import type { GitHubRepositoriesAnswer } from "@repo/features/github-repositories-wire";
import {
  GITHUB_ACCESS,
  type WorkspaceTokenRepository,
} from "@repo/features/github-repositories-wire";
import { LIVE_READ } from "@repo/features/live-wire";
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
import { GLYPH } from "@repo/ui/icons";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { useCallback, useState } from "react";
import { useAct } from "../act.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { HOST_READ_STATUS, type HostReadStatus, useHostRead } from "../use-host-read.js";
import { AddMenuButton } from "./add-menu-button.js";
import { GitHubOwnerRow, repositoryCount } from "./workspace-github-accounts.js";

/**
 * workspace-token-repositories.tsx -- the repositories members added to a workspace on their own GitHub tokens, under GitHub's row on Settings › Workspace.
 *
 * They stand under GitHub's row by owner, after the App's accounts and in
 * order of the owners' logins, each owner the same row every account is
 * (`GitHubOwnerRow`), with nothing saying how its repositories got there.
 * An owner's ⋯ holds Remove for each repository its adder or a workspace's
 * owner or admin reads, and stands nowhere where the reader may remove
 * none; Remove asks first, in the accent rather than red: adding it again
 * undoes it, but its agents stop reaching it for every member meanwhile. One the workspace's App reaches is
 * left out by the service, since the App wins. Add repository drops the
 * app's searched menu over the repositories the reader's own token may
 * push to that neither the App nor the workspace's list already holds, read
 * as the menu opens from the addable the repository picker's listing
 * answers beside its own, each drawn as the repository chip's menu draws one
 * (`repositoryMenuRow`); a pick adds it, and the list the service then
 * answers lands where the host holds it. Add repository is drawn only while
 * a token of the reader's is saved, as the host holds it: not while that is
 * still being read, nor once its read failed, nor with none saved. The list is the
 * host's (`LIVE_READ.TOKEN_REPOSITORIES`), read, still being read, or
 * refused: while it is read the rows say Reading, and refused they say so
 * with Retry, neither drawn as a workspace with none.
 */

/** The words the rows and the menu say: labels and facts alone. */
const WORDS = {
  ADD: "Add repository",
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

/** Where the workspace's list of token repositories stands: still being read, refused, or read, empty or not. */
export const TOKEN_REPOSITORIES_READ = {
  READING: "reading",
  FAILED: "failed",
  READY: "ready",
} as const;

export type TokenRepositoriesRead =
  (typeof TOKEN_REPOSITORIES_READ)[keyof typeof TOKEN_REPOSITORIES_READ];

/** The workspace's token repositories as last read, and the change that moves them. */
export interface TokenRepositories {
  /** Whether `listed` is still being read or was refused, in which case it stands for nothing. */
  readonly read: TokenRepositoriesRead;
  readonly listed: readonly WorkspaceTokenRepository[];
  /** Reads the list again after a failure. */
  readonly retry: () => void;
  /** Adds or removes one, answering what the service refused with, or nothing where it took it. */
  readonly change: (repository: string, added: boolean) => Promise<string | undefined>;
  /** Removes one at once, as the host draws it on the press, a refusal said in a toast. */
  readonly remove: (repository: string) => void;
}

/** Where the list stands, by where the host's read of it stands. */
const TOKEN_REPOSITORIES_READ_OF = {
  [HOST_READ_STATUS.LOADING]: TOKEN_REPOSITORIES_READ.READING,
  [HOST_READ_STATUS.FAILED]: TOKEN_REPOSITORIES_READ.FAILED,
  [HOST_READ_STATUS.READY]: TOKEN_REPOSITORIES_READ.READY,
} as const satisfies Record<HostReadStatus, TokenRepositoriesRead>;

/** No token repositories, while none is read. */
const NONE_LISTED: readonly WorkspaceTokenRepository[] = [];

/**
 * The workspace's token repositories as the host holds them while the
 * surface draws them (`LIVE_READ.TOKEN_REPOSITORIES`), where each change's
 * own answer lands too. Note that a read that fails says so rather than
 * listing none, because a workspace with none is a list read.
 */
export function useTokenRepositories(workspaceId: string): TokenRepositories {
  const { act, press } = useAct();
  const { rows, status, retry } = useHostRead(LIVE_READ.TOKEN_REPOSITORIES, workspaceId);
  const change = useCallback(
    (repository: string, added: boolean) =>
      act(ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET, { workspaceId, repository, added }).then(
        () => undefined,
        (refused: Error) => refused.message,
      ),
    [act, workspaceId],
  );
  const remove = useCallback(
    (repository: string) =>
      void press(ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET, {
        workspaceId,
        repository,
        added: false,
      }),
    [press, workspaceId],
  );
  return {
    read: TOKEN_REPOSITORIES_READ_OF[status],
    listed: rows ?? NONE_LISTED,
    retry,
    change,
    remove,
  };
}

/** The repositories the reader's own token may push to that the workspace lists nowhere yet; nothing while unread, and why where the read failed. */
type Candidates =
  | { readonly kind: "reading" }
  | { readonly kind: "failed" }
  | { readonly kind: "read"; readonly rows: readonly MenuRow[] };

/** What the picker offers, from the workspace's repositories as the host holds them, less those already listed. */
function candidatesOf(
  list: { readonly rows: GitHubRepositoriesAnswer | undefined; readonly status: HostReadStatus },
  listed: readonly { readonly fullName: string }[],
  pictures: boolean,
): Candidates {
  if (list.rows === undefined) {
    return list.status === HOST_READ_STATUS.FAILED ? { kind: "failed" } : { kind: "reading" };
  }
  const added = new Set(listed.map((one) => one.fullName.toLowerCase()));
  // A service older than `addable` lists the token's repositories among the picker's own.
  const { addable, repositories } = list.rows;
  const offered = addable ?? repositories.filter((one) => one.access === GITHUB_ACCESS.TOKEN);
  const rows = offered
    .filter((one) => !added.has(one.fullName.toLowerCase()))
    .map((one) => repositoryMenuRow(one.fullName, pictures));
  return { kind: "read", rows };
}

/**
 * Add repository and its menu: the outline `Button`, and under it the
 * app's searched menu hung from it at a Settings picker's width. Drawn only
 * while the reader's own GitHub token is saved (`LIVE_READ.GITHUB_TOKEN`),
 * so a reader with none, or whose token is unread, is offered no press.
 */
export function AddTokenRepository(props: {
  workspaceId: string;
  repositories: TokenRepositories;
  onRefused: (refusal: string | undefined) => void;
}): React.JSX.Element | null {
  const accountId = signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
  const token = useHostRead(LIVE_READ.GITHUB_TOKEN, accountId);
  return token.rows?.token ? <AddRepositoryMenu {...props} /> : null;
}

/** The menu itself, mounted only once a token is saved, so the workspace's repositories are read for no one else. */
function AddRepositoryMenu({
  workspaceId,
  repositories,
  onRefused,
}: {
  workspaceId: string;
  repositories: TokenRepositories;
  onRefused: (refusal: string | undefined) => void;
}): React.JSX.Element {
  // Note that the workspace's repositories are held by the host while the picker stands (`LIVE_READ.REPOSITORY_LISTS`).
  const pictures = useRepositoryPictures();
  const list = useHostRead(LIVE_READ.REPOSITORY_LISTS, workspaceId);
  const read = () => {
    if (list.status === HOST_READ_STATUS.FAILED) list.retry();
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

/** The token repositories of one owner, as their row lists them: the owner as first spelled, and its repositories, newest added first. */
interface TokenOwner {
  readonly login: string;
  readonly repositories: readonly WorkspaceTokenRepository[];
}

/** The repository's own name, past its owner's. */
function nameOf(repository: WorkspaceTokenRepository): string {
  return repository.fullName.slice(repository.fullName.indexOf("/") + 1);
}

/** The token repositories by owner, each owner keyed as no case spells it, the owners in order of their logins. */
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

/**
 * One owner's token repositories, drawn as every GitHub account under
 * GitHub's row is (`GitHubOwnerRow`): its picture, its login, its count, and
 * the names folded under it; its ⋯ holds Remove for each the reader may
 * remove and stands nowhere where they may remove none. Remove asks first;
 * the removal takes the name away at once, as the host draws it on the
 * press, so the question lets go with it, and a refusal, its name back, is
 * said in a toast.
 */
function TokenOwnerRow({
  owner,
  onRemove,
}: {
  owner: TokenOwner;
  onRemove: (repository: string) => void;
}): React.JSX.Element {
  const [asked, setAsked] = useState<WorkspaceTokenRepository>();
  // Note that the question stands only while the repository it names is still listed and removable, so a read that drops it dismisses it.
  const standing =
    asked !== undefined &&
    owner.repositories.some((one) => one.fullName === asked.fullName && one.removable);
  const removal = useConfirmDialog(
    { subject: standing, surfaceOpen: true },
    () => {
      if (asked !== undefined) onRemove(asked.fullName);
      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
    confirmFailure(FAILURE_SURFACE.WORKSPACE_REPOSITORY_REMOVE),
  );
  const actions = owner.repositories
    .filter((repository) => repository.removable)
    .map((repository) => ({
      label: `${WORDS.REMOVE} ${nameOf(repository)}`,
      icon: <GLYPH.DELETE />,
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
          verb: WORDS.REMOVE,
          running: WORDS.REMOVING,
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </>
  );
}

/** Every owner of the workspace's token repositories, a row each, in order of their logins, after the App's accounts. */
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
