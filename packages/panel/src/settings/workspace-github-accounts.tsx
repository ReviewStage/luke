import {
  GITHUB_ACCESS,
  GITHUB_REPOSITORY_SELECTION,
  type GitHubRepositoriesAnswer,
  type GitHubRepository,
  type GitHubRepositorySelection,
} from "@repo/features/github-repositories-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { countWords, readFailedWords, readingWords, TERM } from "@repo/features/words";
import type { WorkspaceGithubInstallation } from "@repo/features/workspace-wire";
import {
  ANNOUNCE,
  ErrorState,
  SETTINGS_ROW_INDENT,
  SETTINGS_ROW_STATE,
  SettingsFoldFoot,
  SettingsFoldLine,
  SettingsFoldRow,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  TEXT_BUTTON_TONE,
  TextButton,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { githubAccountPictureUrl } from "@repo/ui/tasks-model";
import { useState } from "react";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile.js";
import { unreadShown } from "../failure-report.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";

/**
 * workspace-github-accounts.tsx -- every GitHub account connected to a workspace, under GitHub's row on Settings › Workspace, each with the repositories it gave our GitHub App.
 *
 * Each account stands inset under GitHub's row, so it reads as one of
 * GitHub's accounts rather than an integration of its own: its picture on
 * GitHub, its login, and under it Connected and how many repositories its
 * installation was given, all of them or a selection, or that GitHub
 * suspended or removed it, which says no count and folds nothing open,
 * since agents reach none of it. A chevron at the end of an active
 * account's row folds its repositories open under its words, one line each,
 * named as GitHub names it under its owner and led by the repository's
 * glyph, or a lock for a private one; an account given every repository
 * says first that those created later are among them. An account with few
 * enough repositories starts open, and a long list shows its first lines
 * and then Show all.
 *
 * The repositories are the App's from the list the repository picker reads
 * for the workspace (`LIVE_READ.REPOSITORY_LISTS`), grouped by owner, which
 * GitHub spells as it pleases, so an account's are those whose owner is its
 * login in any case; and whether an installation was given all or a
 * selection is the listing's own (`installations`), which a service older
 * than it leaves out, and a line then says the count alone. The list is
 * read only while an account stands active. While it is read each active
 * account's line says so, and a read that failed says so once under the
 * accounts with Retry, neither drawn as an account with none. Members read
 * the same as owners and admins.
 */

/** What an account's line and its fold say. */
const WORDS = {
  CONNECTED: "Connected",
  SUSPENDED: "Suspended or removed on GitHub.",
  READING: readingWords(TERM.REPOSITORY.many),
  NOT_READ: readFailedWords(TERM.REPOSITORY.many),
  ALL_NOTE: "All repositories, including ones created later.",
  PRIVATE: "Private",
} as const;

/** The repositories counted on an account's line, by what its installation was given; just the count where the service did not say. */
const COUNT_LINE = {
  [GITHUB_REPOSITORY_SELECTION.ALL]: (count: number) => `All ${countWords(count, TERM.REPOSITORY)}`,
  [GITHUB_REPOSITORY_SELECTION.SELECTED]: (count: number) =>
    countWords(count, { one: "selected repository", many: "selected repositories" }),
} as const satisfies Record<GitHubRepositorySelection, (count: number) => string>;

/** The most repositories an account starts open on. */
const OPEN_MOST = 5;

/** How many repositories a long list shows before Show all. */
const FIRST_SHOWN = 6;

/** No repositories, for an account the list names none of. */
const NONE: readonly GitHubRepository[] = [];

/** One connected GitHub account as the page lists it: its login, whether its installation is active, and its id where the service named it. */
export type ShownConnection = Pick<WorkspaceGithubInstallation, "login" | "active"> &
  Partial<Pick<WorkspaceGithubInstallation, "installationId">>;

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

/** What the listing says the installation was given, where it says. */
function selectionOf(
  answer: GitHubRepositoriesAnswer,
  connection: ShownConnection,
): GitHubRepositorySelection | undefined {
  return answer.installations?.find((one) => one.installationId === connection.installationId)
    ?.repositorySelection;
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

/** An active account's line: Connected, and after it what else is known, each part breaking from the other rather than inside it. */
function ConnectedLine({ after }: { after: string | undefined }): React.JSX.Element {
  return (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED} wrap={after !== undefined}>
      {after === undefined ? (
        WORDS.CONNECTED
      ) : (
        <>
          <span>{`${WORDS.CONNECTED} · `}</span>
          <span>{after}</span>
        </>
      )}
    </SettingsRowStateLine>
  );
}

/** An account's row with nothing to fold: suspended, its repositories still being read, or their read failed. */
function AccountRow({
  connection,
  reading,
}: {
  connection: ShownConnection;
  reading: boolean;
}): React.JSX.Element {
  return (
    <SettingsRow
      indent={SETTINGS_ROW_INDENT.MARK}
      leading={<AccountMark login={connection.login} />}
      label={connection.login}
      description={
        connection.active ? (
          <ConnectedLine after={reading ? WORDS.READING : undefined} />
        ) : (
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>
            {WORDS.SUSPENDED}
          </SettingsRowStateLine>
        )
      }
    >
      {() => null}
    </SettingsRow>
  );
}

/** One repository's line in its account's fold: a lock for a private one, the repository's glyph otherwise, then its name. */
function RepositoryLine({ repository }: { repository: GitHubRepository }): React.JSX.Element {
  return repository.private ? (
    <SettingsFoldLine glyph={<GLYPH.PRIVATE />} glyphLabel={WORDS.PRIVATE}>
      {repository.name}
    </SettingsFoldLine>
  ) : (
    <SettingsFoldLine glyph={<GLYPH.REPOSITORY />}>{repository.name}</SettingsFoldLine>
  );
}

/**
 * An active account's row once its repositories are read: their count on
 * its line, and its chevron folding them open, open from the start where
 * they are few; none to fold where it was given none.
 */
function AccountFoldRow({
  connection,
  repositories,
  selection,
}: {
  connection: ShownConnection;
  repositories: readonly GitHubRepository[];
  selection: GitHubRepositorySelection | undefined;
}): React.JSX.Element {
  const [whole, setWhole] = useState(false);
  const count = repositories.length;
  const line = (
    <ConnectedLine
      after={
        selection === undefined ? countWords(count, TERM.REPOSITORY) : COUNT_LINE[selection](count)
      }
    />
  );
  if (count === 0) {
    return (
      <SettingsRow
        indent={SETTINGS_ROW_INDENT.MARK}
        leading={<AccountMark login={connection.login} />}
        label={connection.login}
        description={line}
      >
        {() => null}
      </SettingsRow>
    );
  }
  const cut = !whole && count > FIRST_SHOWN;
  const shown = cut ? repositories.slice(0, FIRST_SHOWN) : repositories;
  return (
    <SettingsFoldRow
      indent={SETTINGS_ROW_INDENT.MARK}
      leading={<AccountMark login={connection.login} />}
      label={connection.login}
      description={line}
      foldLabel={`${connection.login}'s repositories`}
      defaultOpen={count <= OPEN_MOST}
    >
      {selection === GITHUB_REPOSITORY_SELECTION.ALL ? (
        <SettingsFoldLine>{WORDS.ALL_NOTE}</SettingsFoldLine>
      ) : null}
      {shown.map((repository) => (
        <RepositoryLine key={repository.fullName.toLowerCase()} repository={repository} />
      ))}
      {cut ? (
        <SettingsFoldFoot>
          <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => setWhole(true)}>
            {`Show all ${count}`}
          </TextButton>
        </SettingsFoldFoot>
      ) : null}
    </SettingsFoldRow>
  );
}

/**
 * The accounts once one stands active, the workspace's repositories held
 * by the host while they stand (`LIVE_READ.REPOSITORY_LISTS`): each active
 * account's line says Reading until they land, then folds its own, and a
 * read that failed says so once under the accounts with Retry.
 */
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
        if (answer === undefined || byOwner === undefined || !connection.active) {
          return <AccountRow key={key} connection={connection} reading={reading} />;
        }
        return (
          <AccountFoldRow
            key={key}
            connection={connection}
            repositories={byOwner.get(connection.login.toLowerCase()) ?? NONE}
            selection={selectionOf(answer, connection)}
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

/**
 * Every GitHub account connected to the workspace, the first linked first,
 * each with its repositories where it stands active; the workspace's
 * repositories are read only where one does.
 */
export function GitHubAccountRows({
  workspaceId,
  connections,
}: {
  workspaceId: string;
  connections: readonly ShownConnection[];
}): React.JSX.Element {
  if (connections.some((connection) => connection.active)) {
    return <ListedAccountRows workspaceId={workspaceId} connections={connections} />;
  }
  return (
    <>
      {connections.map((connection) => (
        <AccountRow
          key={connection.installationId ?? connection.login}
          connection={connection}
          reading={false}
        />
      ))}
    </>
  );
}
