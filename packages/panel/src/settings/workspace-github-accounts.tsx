import {
  GITHUB_ACCESS,
  GITHUB_REPOSITORY_SELECTION,
  type GitHubRepositoriesAnswer,
  type GitHubRepository,
} from "@repo/features/github-repositories-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { countWords, readFailedWords, readingWords, TERM } from "@repo/features/words";
import type { WorkspaceGithubInstallation } from "@repo/features/workspace-wire";
import {
  ANNOUNCE,
  ErrorState,
  SETTINGS_ROW_INDENT,
  SettingsFoldFoot,
  SettingsFoldLine,
  SettingsLine,
  SettingsRowMark,
  TEXT_BUTTON_TONE,
  TextButton,
  useSettingsPageScroll,
} from "@repo/ui";
import { githubAccountPictureUrl } from "@repo/ui/tasks-model";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { type ReactNode, useState } from "react";
import type { MenuAction } from "../desktop/action-menu.js";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile.js";
import { unreadShown } from "../failure-report.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { MenuRow } from "./menu-row.js";

/**
 * workspace-github-accounts.tsx -- every GitHub account under GitHub's row on Settings › Workspace, each with the repositories agents reach on it.
 *
 * Every account stands as the same row (`GitHubOwnerRow`), inset under
 * GitHub's so it reads as one of GitHub's accounts rather than an
 * integration of its own: its picture on GitHub, its login, how many
 * repositories it holds as its one line, and a chevron folding their names
 * open under its words. Every account starts closed, and a long list shows
 * its first lines and then Show all, which draws only the names near the
 * view of an account's thousands (`VirtualRows`). A row's ⋯,
 * where it holds acts at all, is the only way one row differs from another
 * (`workspace-token-repositories.tsx`).
 *
 * The accounts here are those whose installation of our GitHub App is
 * connected and active; one suspended or removed on GitHub draws no row,
 * since agents reach none of it and the store never forgets a removed one.
 * Their repositories are the App's from the list the repository picker
 * reads for the workspace (`LIVE_READ.REPOSITORY_LISTS`), grouped by owner,
 * which GitHub spells as it pleases, so an account's are those whose owner
 * is its login in any case: the login the listing read from GitHub now
 * (`installations`), which the row is named by too, since the store keeps
 * an account's old one after a rename, else the stored one. Where the
 * listing says the installation was given every repository, the line says
 * All; a service older than it says nothing of it, and the line counts
 * alone. While the list is read each account's line says so, and a read
 * that failed says so once under the accounts with Retry, neither drawn as
 * an account with none. Members read the same as owners and admins.
 */

/** What an account's line says while its repositories are not yet known. */
const WORDS = {
  READING: readingWords(TERM.REPOSITORY.many),
  NOT_READ: readFailedWords(TERM.REPOSITORY.many),
} as const;

/** How many repositories a long list shows before Show all. */
const FIRST_SHOWN = 6;

/** No repositories, for an account the list names none of. */
const NONE: readonly GitHubRepository[] = [];

/** No names, for a row whose repositories are not yet known. */
const NO_NAMES: readonly string[] = [];

/** One connected GitHub account as the page lists it: its login, whether its installation is active, and its id where the service named it. */
export type ShownConnection = Pick<WorkspaceGithubInstallation, "login" | "active"> &
  Partial<Pick<WorkspaceGithubInstallation, "installationId">>;

/** A row's line: how many repositories it holds, all of them where its installation was given every one. */
export function repositoryCount(count: number, all = false): string {
  const counted = countWords(count, TERM.REPOSITORY);
  return all ? `All ${counted}` : counted;
}

/**
 * The App's repositories by owner, each owner keyed as no case spells it,
 * in the listing's order. Note that a service older than tokens lists the
 * App's alone and marks none.
 */
function repositoriesByOwner(
  repositories: readonly GitHubRepository[],
): ReadonlyMap<string, readonly GitHubRepository[]> {
  const byOwner = new Map<string, GitHubRepository[]>();
  for (const one of repositories) {
    if (one.access === GITHUB_ACCESS.TOKEN) continue;
    const key = one.owner.toLowerCase();
    const owned = byOwner.get(key);
    if (owned === undefined) byOwner.set(key, [one]);
    else owned.push(one);
  }
  return byOwner;
}

/** What the listing read of the connection's installation, where it names it: its login now and what it was given. */
function listedOf(answer: GitHubRepositoriesAnswer, connection: ShownConnection) {
  return answer.installations?.find((one) => one.installationId === connection.installationId);
}

/** The account's picture on GitHub, a workspace's tile keyed by its login, so its letter stands until the picture loads and wherever it fails to. */
function AccountMark({ login }: { login: string }): React.JSX.Element {
  return (
    <SettingsRowMark>
      <WorkspaceTile
        workspace={{
          id: `github:${login}`,
          name: login,
          pictureUrl: githubAccountPictureUrl(login),
        }}
        size={TILE_SIZE.NESTED}
      />
    </SettingsRowMark>
  );
}

/**
 * One GitHub account's row, every account's alike: its picture, its login,
 * its one line, and the names of its repositories folded open under its
 * words, closed until its chevron is pressed and capped with Show all
 * where they are many; none to fold where `names` is empty or not yet
 * known. `actions` is its ⋯'s, drawn only where it holds one.
 */
export function GitHubOwnerRow({
  login,
  line,
  names,
  actions = [],
}: {
  login: string;
  line: ReactNode;
  /** Its repositories' names, without the owner; none where not yet known. */
  names: readonly string[];
  actions?: readonly MenuAction[];
}): React.JSX.Element {
  const [whole, setWhole] = useState(false);
  const count = names.length;
  const cut = !whole && count > FIRST_SHOWN;
  const shown = cut ? names.slice(0, FIRST_SHOWN) : names;
  const { scroller, sections } = useSettingsPageScroll();
  const keys = shown.map((name) => name.toLowerCase());
  const foot = cut ? (
    <SettingsFoldFoot>
      <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => setWhole(true)}>
        {`Show all ${count}`}
      </TextButton>
    </SettingsFoldFoot>
  ) : undefined;
  const run = {
    scroller,
    shiftedBy: sections,
    keys,
    line: (index: number, place: VirtualRowPlace) => (
      <SettingsFoldLine place={place}>{shown[index] ?? ""}</SettingsFoldLine>
    ),
  };
  return (
    <MenuRow
      thing={login}
      actions={actions}
      row={{
        indent: SETTINGS_ROW_INDENT.MARK,
        leading: <AccountMark login={login} />,
        label: login,
        description: line,
        ...(count === 0
          ? {}
          : {
              fold: { run, lines: foot, label: `${login}'s repositories`, defaultOpen: false },
            }),
      }}
    />
  );
}

/**
 * Every active account connected to the workspace, the first linked first,
 * the workspace's repositories held by the host while they stand
 * (`LIVE_READ.REPOSITORY_LISTS`): each account's line says Reading until
 * they land, then counts its own, and a read that failed says so once under
 * the accounts with Retry. Nothing is drawn, and nothing read, where no
 * account is connected.
 */
export function GitHubAccountRows({
  workspaceId,
  connections,
}: {
  workspaceId: string;
  /** The active connections alone. */
  connections: readonly ShownConnection[];
}): React.JSX.Element | null {
  if (connections.length === 0) return null;
  return <ListedAccountRows workspaceId={workspaceId} connections={connections} />;
}

/** The accounts once one is connected, which reads the workspace's repositories. */
function ListedAccountRows({
  workspaceId,
  connections,
}: {
  workspaceId: string;
  connections: readonly ShownConnection[];
}): React.JSX.Element {
  const list = useHostRead(LIVE_READ.REPOSITORY_LISTS, workspaceId);
  const answer = list.rows;
  const failed = answer === undefined && list.status === HOST_READ_STATUS.FAILED;
  const reading = answer === undefined && !failed;
  useAnnounceShown(ANNOUNCE.POLITE, reading ? WORDS.READING : "");
  const byOwner = answer === undefined ? undefined : repositoriesByOwner(answer.repositories);
  return (
    <>
      {connections.map((connection) => {
        const key = connection.installationId ?? connection.login;
        if (answer === undefined || byOwner === undefined) {
          return (
            <GitHubOwnerRow
              key={key}
              login={connection.login}
              line={reading ? WORDS.READING : undefined}
              names={NO_NAMES}
            />
          );
        }
        // Note that the login GitHub answers now names the row and finds its repositories, because the store keeps an account's old one after a rename on GitHub.
        const listed = listedOf(answer, connection);
        const login = listed?.login ?? connection.login;
        const repositories = byOwner.get(login.toLowerCase()) ?? NONE;
        return (
          <GitHubOwnerRow
            key={key}
            login={login}
            line={repositoryCount(
              repositories.length,
              listed?.repositorySelection === GITHUB_REPOSITORY_SELECTION.ALL,
            )}
            names={repositories.map((repository) => repository.name)}
          />
        );
      })}
      {failed ? (
        <SettingsLine>
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.WORKSPACE_REPOSITORIES_READ)}
            onRetry={list.retry}
          >
            {WORDS.NOT_READ}
          </ErrorState>
        </SettingsLine>
      ) : null}
    </>
  );
}
