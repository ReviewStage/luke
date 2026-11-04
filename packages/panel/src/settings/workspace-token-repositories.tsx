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
import type { AppGitHubToken } from "@repo/host/app-state";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import {
  ANNOUNCE,
  AVATAR_SIZE,
  Badge,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  ErrorState,
  type MenuRow,
  RepositoryPicture,
  repositoryMenuRow,
  SETTINGS_ROW_INDENT,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
  useConfirmDialog,
} from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useCallback } from "react";
import { useAct } from "../act.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { SettingsPageLink } from "../open-settings.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { HOST_READ_STATUS, type HostReadStatus, useHostRead } from "../use-host-read.js";
import { AddMenuButton } from "./add-menu-button.js";

/**
 * workspace-token-repositories.tsx -- the repositories members added to a workspace on their own GitHub tokens, under GitHub's row on Settings › Workspace.
 *
 * Each stands inset under GitHub's row, as a connected account does, led by
 * its owner's picture on GitHub and marked Token, with Remove for its adder
 * and for a workspace's owner or admin, which asks first, in the accent
 * rather than red: adding it again undoes it, but its agents stop reaching
 * it for every member meanwhile. One the workspace's App reaches is
 * left out by the service, since the App wins. Add repository drops the
 * app's searched menu over the repositories the reader's own token may
 * push to that neither the App nor the workspace's list already holds, read
 * as the menu opens from the addable the repository picker's listing
 * answers beside its own, each drawn as the repository chip's menu draws one
 * (`repositoryMenuRow`); a pick adds it, and the list the service then
 * answers lands where the host holds it. With no token of the reader's
 * saved, as the host holds it, the menu says to add one. The list is the
 * host's (`LIVE_READ.TOKEN_REPOSITORIES`), read, still being read, or
 * refused: while it is read the rows say Reading, and refused they say so
 * with Retry, neither drawn as a workspace with none.
 */

/** The words the rows and the menu say: labels and facts alone. */
const WORDS = {
  ADD: "Add repository",
  TOKEN: "Token",
  REMOVE: "Remove",
  REMOVING: "Removing",
  SEARCH: "Search repositories",
  NO_MATCH: noMatchWords(TERM.REPOSITORY),
  NONE: "No repositories",
  NO_TOKEN_BEFORE: "Add a GitHub token in",
  NO_TOKEN_AFTER: "settings to add repositories.",
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
  const { act } = useAct();
  const { rows, status, retry } = useHostRead(LIVE_READ.TOKEN_REPOSITORIES, workspaceId);
  const change = useCallback(
    (repository: string, added: boolean) =>
      act(ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET, { workspaceId, repository, added }).then(
        () => undefined,
        (refused: Error) => refused.message,
      ),
    [act, workspaceId],
  );
  return { read: TOKEN_REPOSITORIES_READ_OF[status], listed: rows ?? NONE_LISTED, retry, change };
}

/** The repositories the reader's own token may push to that the workspace lists nowhere yet; nothing while unread, and why where the read failed. */
type Candidates =
  | { readonly kind: "reading" }
  | { readonly kind: "failed" }
  | { readonly kind: "no-token" }
  | { readonly kind: "read"; readonly rows: readonly MenuRow[] };

/**
 * What the picker offers, from the reader's token and the workspace's
 * repositories as the host holds them, less those already listed. Note that
 * a token read that fails is taken for no word on the token, because the
 * list alone says what the token may reach.
 */
function candidatesOf(
  token: { readonly rows: AppGitHubToken | undefined; readonly status: HostReadStatus },
  list: { readonly rows: GitHubRepositoriesAnswer | undefined; readonly status: HostReadStatus },
  listed: readonly { readonly fullName: string }[],
  pictures: boolean,
): Candidates {
  if (token.rows?.token === null) return { kind: "no-token" };
  if (token.status === HOST_READ_STATUS.LOADING) return { kind: "reading" };
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
 * app's searched menu hung from it at a Settings picker's width.
 */
export function AddTokenRepository({
  workspaceId,
  repositories,
  onRefused,
}: {
  workspaceId: string;
  repositories: TokenRepositories;
  onRefused: (refusal: string | undefined) => void;
}): React.JSX.Element {
  const accountId = signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
  // Note that the workspace's repositories and the reader's token are held by the host while the picker stands (`LIVE_READ.REPOSITORY_LISTS`, `LIVE_READ.GITHUB_TOKEN`).
  const pictures = useRepositoryPictures();
  const list = useHostRead(LIVE_READ.REPOSITORY_LISTS, workspaceId);
  const token = useHostRead(LIVE_READ.GITHUB_TOKEN, accountId);
  const read = () => {
    if (list.status === HOST_READ_STATUS.FAILED) list.retry();
  };
  const candidates = candidatesOf(token, list, repositories.listed, pictures);
  const rows = candidates.kind === "read" ? candidates.rows : [];
  const note = (close: () => void) =>
    candidates.kind === "reading" ? (
      WORDS.READING
    ) : candidates.kind === "failed" ? (
      WORDS.NOT_READ
    ) : candidates.kind === "no-token" ? (
      <>
        {WORDS.NO_TOKEN_BEFORE} <SettingsPageLink page={SETTINGS_VIEW.ACCOUNT} onLeave={close} />{" "}
        {WORDS.NO_TOKEN_AFTER}
      </>
    ) : rows.length === 0 ? (
      WORDS.NONE
    ) : undefined;
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

/** One token repository's row, inset under GitHub's: its owner's picture, its name marked Token, and Remove where the reader may, asked first, its refusal said in the question. */
function TokenRepositoryRow({
  repository,
  onRemove,
}: {
  repository: WorkspaceTokenRepository;
  onRemove: () => Promise<string | undefined>;
}): React.JSX.Element {
  const removal = useConfirmDialog(
    { subject: repository.removable, surfaceOpen: true },
    () =>
      onRemove().then(
        (refused): ActionResult =>
          refused === undefined
            ? { status: ACTION_RESULT_STATUS.ACCEPTED }
            : { status: ACTION_RESULT_STATUS.REJECTED, reason: refused },
      ),
    confirmFailure(FAILURE_SURFACE.WORKSPACE_REPOSITORY_REMOVE),
  );
  const pictures = useRepositoryPictures();
  return (
    <>
      <SettingsRow
        indent={SETTINGS_ROW_INDENT.MARK}
        leading={
          <SettingsRowMark>
            <RepositoryPicture
              repository={repository.fullName}
              pictures={pictures}
              size={AVATAR_SIZE.STACK}
            />
          </SettingsRowMark>
        }
        label={repository.fullName}
        adornment={<Badge>{WORDS.TOKEN}</Badge>}
      >
        {() =>
          repository.removable ? (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              busy={removal.busy}
              busyLabel={WORDS.REMOVING}
              onClick={removal.ask}
            >
              {WORDS.REMOVE}
            </Button>
          ) : null
        }
      </SettingsRow>
      <ConfirmDialog
        open
        confirm={removal}
        question={{
          title: `Remove ${repository.fullName}?`,
          body: "Agents in this workspace stop reaching it until someone adds it again.",
          verb: WORDS.REMOVE,
          running: WORDS.REMOVING,
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
        }}
      />
    </>
  );
}

/** Every token repository of the workspace, a row each, newest added first. */
export function TokenRepositoryRows({
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
      {repositories.listed.map((repository) => (
        <TokenRepositoryRow
          key={repository.fullName.toLowerCase()}
          repository={repository}
          onRemove={() => repositories.change(repository.fullName, false)}
        />
      ))}
    </>
  );
}
