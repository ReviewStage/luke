import type { GitHubRepositoriesAnswer } from "@repo/features/github-repositories-wire";
import {
  GITHUB_ACCESS,
  type WorkspaceTokenRepository,
} from "@repo/features/github-repositories-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { noMatchWords, readFailedWords, readingWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import {
  ANNOUNCE,
  Badge,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  ErrorState,
  type MenuRow,
  SETTINGS_ROW_INDENT,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
  useConfirmDialog,
} from "@repo/ui";
import { githubAccountPictureUrl } from "@repo/ui/tasks-model";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile.js";
import { confirmFailure, unreadShown } from "../failure-report.js";
import { SettingsPageLink } from "../open-settings.js";
import { repositoryMenuRow } from "../repository-row.js";
import { useAnnounceShown } from "../use-announce-shown.js";
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
 * (`repository-row.tsx`); a pick adds it, and the service answers the list
 * as it then stands. The list is read, still being read, or refused: while
 * it is read the rows say Reading, and refused they say so with Retry,
 * neither drawn as a workspace with none.
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

/** Reads the workspace's token repositories once, and holds what each change answers. */
export function useTokenRepositories(workspaceId: string): TokenRepositories {
  const { act } = useAct();
  const [listed, setListed] = useState<readonly WorkspaceTokenRepository[]>([]);
  const [read, setRead] = useState<TokenRepositoriesRead>(TOKEN_REPOSITORIES_READ.READING);
  const [attempt, setAttempt] = useState(0);
  // Whether a change has answered since the read began, whose list is newer than the read's.
  const changed = useRef(false);
  useEffect(() => {
    let live = true;
    changed.current = false;
    setRead(TOKEN_REPOSITORIES_READ.READING);
    // Note that a read that fails says so rather than listing none, because a workspace with none is a list read.
    act(ACT_KIND.WORKSPACE_TOKEN_REPOSITORIES_READ, { workspaceId }).then(
      (answer) => {
        if (!live || changed.current) return;
        setListed(answer);
        setRead(TOKEN_REPOSITORIES_READ.READY);
      },
      () => {
        if (live && !changed.current) setRead(TOKEN_REPOSITORIES_READ.FAILED);
      },
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId, attempt]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  const change = useCallback(
    (repository: string, added: boolean) =>
      act(ACT_KIND.WORKSPACE_TOKEN_REPOSITORY_SET, { workspaceId, repository, added }).then(
        (now) => {
          changed.current = true;
          setListed(now);
          setRead(TOKEN_REPOSITORIES_READ.READY);
          return undefined;
        },
        (refused: Error) => refused.message,
      ),
    [act, workspaceId],
  );
  return { read, listed, retry, change };
}

/** The repositories the reader's own token may push to that the workspace lists nowhere yet; nothing while unread, and why where the read failed. */
type Candidates =
  | { readonly kind: "reading" }
  | { readonly kind: "failed" }
  | { readonly kind: "no-token" }
  | { readonly kind: "read"; readonly rows: readonly MenuRow[] };

/** What the member's own token was found to be as the picker last opened: not asked yet, being asked, none saved, or one saved or not known. */
const TOKEN_WORD = {
  UNASKED: "unasked",
  ASKING: "asking",
  NONE: "none",
  HELD: "held",
} as const;

type TokenWord = (typeof TOKEN_WORD)[keyof typeof TOKEN_WORD];

/** What the picker offers, from the token as it was found and the workspace's repositories as the host holds them, less those already listed. */
function candidatesOf(
  token: TokenWord,
  list: { readonly rows: GitHubRepositoriesAnswer | undefined; readonly status: HostReadStatus },
  listed: readonly { readonly fullName: string }[],
): Candidates {
  if (token === TOKEN_WORD.NONE) return { kind: "no-token" };
  if (token === TOKEN_WORD.ASKING || token === TOKEN_WORD.UNASKED) return { kind: "reading" };
  if (list.rows === undefined) {
    return list.status === HOST_READ_STATUS.FAILED ? { kind: "failed" } : { kind: "reading" };
  }
  const added = new Set(listed.map((one) => one.fullName.toLowerCase()));
  // A service older than `addable` lists the token's repositories among the picker's own.
  const { addable, repositories } = list.rows;
  const offered = addable ?? repositories.filter((one) => one.access === GITHUB_ACCESS.TOKEN);
  const rows = offered
    .filter((one) => !added.has(one.fullName.toLowerCase()))
    .map((one) => repositoryMenuRow(one.fullName, true));
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
  const { act } = useAct();
  // Note that the workspace's repositories are held by the host while the picker stands (`LIVE_READ.REPOSITORY_LISTS`), and the token is asked as it opens.
  const list = useHostRead(LIVE_READ.REPOSITORY_LISTS, workspaceId);
  const [token, setToken] = useState<TokenWord>(TOKEN_WORD.UNASKED);
  const read = () => {
    setToken(TOKEN_WORD.ASKING);
    if (list.status === HOST_READ_STATUS.FAILED) list.retry();
    // Note that a token read that fails is taken for no word on the token, because the list alone says what the token may reach.
    act(ACT_KIND.GITHUB_TOKEN_READ).then(
      (answer) =>
        setToken(
          !("failure" in answer) && answer.token === null ? TOKEN_WORD.NONE : TOKEN_WORD.HELD,
        ),
      () => setToken(TOKEN_WORD.HELD),
    );
  };
  const candidates = candidatesOf(token, list, repositories.listed);
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
  const [owner = repository.fullName] = repository.fullName.split("/");
  return (
    <>
      <SettingsRow
        indent={SETTINGS_ROW_INDENT.MARK}
        leading={
          <SettingsRowMark>
            <WorkspaceTile
              workspace={{
                id: `github:${owner}`,
                name: owner,
                pictureUrl: githubAccountPictureUrl(owner),
              }}
              size={TILE_SIZE.NESTED}
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
