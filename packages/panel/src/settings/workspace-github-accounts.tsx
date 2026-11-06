import {
  GITHUB_ACCESS,
  GITHUB_REPOSITORY_SELECTION,
  type GitHubRepositoriesAnswer,
  type GitHubRepository,
} from "@repo/features/github-repositories-wire";
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
  usePageScroll,
} from "@repo/ui";
import { githubAccountPictureUrl } from "@repo/ui/tasks-model";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { MenuAction } from "../desktop/action-menu.js";
import { TILE_SIZE, WorkspaceTile } from "../desktop/workspace-tile.js";
import { unreadShown } from "../failure-report.js";
import {
  repositoryListsQuery,
  repositoryListsRetryMutation,
  repositoryScope,
} from "../live-reads.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { MenuRow } from "./menu-row.js";

const WORDS = {
  READING: readingWords(TERM.REPOSITORY.many),
  NOT_READ: readFailedWords(TERM.REPOSITORY.many),
} as const;

const FIRST_SHOWN = 6;

const NONE: readonly GitHubRepository[] = [];

const NO_NAMES: readonly string[] = [];

export type ShownConnection = Pick<WorkspaceGithubInstallation, "login" | "active"> &
  Partial<Pick<WorkspaceGithubInstallation, "installationId">>;

export function repositoryCount(count: number, all = false): string {
  const counted = countWords(count, TERM.REPOSITORY);
  return all ? `All ${counted}` : counted;
}

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

function listedOf(answer: GitHubRepositoriesAnswer, connection: ShownConnection) {
  return answer.installations?.find((one) => one.installationId === connection.installationId);
}

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

export function GitHubOwnerRow({
  login,
  line,
  names,
  actions = [],
}: {
  login: string;
  line: ReactNode;
  names: readonly string[];
  actions?: readonly MenuAction[];
}): React.JSX.Element {
  const [whole, setWhole] = useState(false);
  const count = names.length;
  const cut = !whole && count > FIRST_SHOWN;
  const shown = cut ? names.slice(0, FIRST_SHOWN) : names;
  const { scroller, shiftedBy } = usePageScroll();
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
    shiftedBy,
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

export function GitHubAccountRows({
  workspaceId,
  connections,
}: {
  workspaceId: string;
  connections: readonly ShownConnection[];
}): React.JSX.Element | null {
  if (connections.length === 0) return null;
  return <ListedAccountRows workspaceId={workspaceId} connections={connections} />;
}

function ListedAccountRows({
  workspaceId,
  connections,
}: {
  workspaceId: string;
  connections: readonly ShownConnection[];
}): React.JSX.Element {
  const list = useQuery(repositoryListsQuery(workspaceId));
  const retry = useMutation(repositoryListsRetryMutation());
  const answer = list.data;
  const failed = answer === undefined && list.isError;
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
            onRetry={() => retry.mutate(repositoryScope(workspaceId))}
          >
            {WORDS.NOT_READ}
          </ErrorState>
        </SettingsLine>
      ) : null}
    </>
  );
}
