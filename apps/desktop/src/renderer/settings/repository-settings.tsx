import { PR_RUN_BOUNDS, type PrRunCommandsAnswer } from "@luke/features/pr-run-view";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SECTION } from "@luke/settings/settings-views";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAct } from "../act";
import { BusyLabel } from "../spinner";
import { ReadFailed, SettingsGroup } from "./settings-group";

/**
 * repository-settings.tsx -- a workspace's repositories on its Settings page, each opening a page of its own settings: today, the command Run on this Mac runs for its pull requests.
 *
 * The Workspace page lists the repositories the workspace's GitHub
 * installation reaches, as the service reads them, and any with a run
 * command set that it no longer lists; each row says whether one is set and
 * opens the repository's own page in the Workspace page's place, with its
 * way back above it; a link or search result seeking a section of the
 * Workspace page closes it (`SETTINGS_SEEK_EVENT`), and the list is read
 * again whenever the window takes the keyboard back, as after choosing
 * repositories on GitHub. There the repository's run command is written in a
 * field of its own and saved, or removed. The command is kept on this Mac
 * for the account signed in, never synced and never taken from a pull
 * request (`compose-pr-runs.ts` in the host); Run on this Mac, in a pull
 * request's menu, fetches the pull request into Luke's own checkout of it
 * and runs the command from that checkout's root in the login shell.
 */

const NOT_READ = "The repositories could not be read.";

/** A repository as the page lists it: its full name, as GitHub spells it. */
interface ListedRepository {
  readonly fullName: string;
}

/** The workspace's repositories and the run commands set on this Mac, as last read, or why they are not. */
interface RepositoriesRead {
  readonly listed: readonly string[] | undefined;
  readonly commands: ReadonlyMap<string, string>;
  readonly failed: boolean;
  readonly reread: () => void;
}

/** The repositories a row is drawn for: the workspace's, and any with a command set that it no longer lists, by name. */
function rowRepositories(
  listed: readonly ListedRepository[],
  commands: ReadonlyMap<string, string>,
): readonly string[] {
  const names = new Map<string, string>();
  for (const repository of listed)
    names.set(repository.fullName.toLowerCase(), repository.fullName);
  for (const key of commands.keys()) if (!names.has(key)) names.set(key, key);
  return [...names.values()];
}

/** The workspace's repositories and this Mac's run commands for them, read when the page opens and again on `reread`. */
export function useRepositoriesRead(workspaceId: string): RepositoriesRead {
  const { act } = useAct();
  const [listed, setListed] = useState<readonly ListedRepository[] | undefined>(undefined);
  const [set, setSet] = useState<PrRunCommandsAnswer["commands"]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    Promise.all([
      act(ACT_KIND.PLANNING_REPOSITORIES, { workspaceId }),
      act(ACT_KIND.PR_RUN_COMMANDS),
    ]).then(
      ([repositories, commands]) => {
        if (!live) return;
        setSet(commands.commands);
        if ("failure" in repositories) setFailed(true);
        else setListed(repositories.repositories.repositories);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId, attempt]);
  // The window taking the keyboard back reads them again, since GitHub's own page, in the browser, is where repositories are added.
  useEffect(() => {
    const again = () => setAttempt((was) => was + 1);
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, []);
  const commands = new Map(
    set
      .filter((each) => each.workspaceId === workspaceId)
      .map((each) => [each.repository.toLowerCase(), each.command]),
  );
  return {
    listed: listed === undefined ? undefined : rowRepositories(listed, commands),
    commands,
    failed,
    reread: () => setAttempt((was) => was + 1),
  };
}

/** The Workspace page's Repositories group: a row per repository, saying whether it runs on this Mac, each opening its page. */
export function RepositoriesGroup({
  read,
  onOpen,
}: {
  read: RepositoriesRead;
  onOpen: (repository: string) => void;
}): React.JSX.Element {
  return (
    <SettingsGroup title="Repositories" anchor={SETTINGS_SECTION.REPOSITORIES}>
      {read.failed ? (
        <ReadFailed line={NOT_READ} onRetry={read.reread} />
      ) : read.listed === undefined ? (
        <p className="settings-card-line settings-note">Reading the repositories…</p>
      ) : read.listed.length === 0 ? (
        <p className="settings-card-line settings-note">
          This workspace reaches no repositories on GitHub yet.
        </p>
      ) : (
        read.listed.map((repository) => {
          const command = read.commands.get(repository.toLowerCase());
          return (
            <button
              key={repository.toLowerCase()}
              type="button"
              className="settings-row repository-row"
              onClick={() => onOpen(repository)}
            >
              <span className="settings-copy">
                <strong>{repository}</strong>
                <small>
                  {command === undefined ? (
                    "No run command on this Mac"
                  ) : (
                    <>
                      Runs <code className="repository-row-command">{command}</code> on this Mac
                    </>
                  )}
                </small>
              </span>
              <ChevronRightIcon className="settings-chevron" aria-hidden="true" />
            </button>
          );
        })
      )}
    </SettingsGroup>
  );
}

/** One repository's own page in the Workspace page's place: its way back, its name, and its run command on this Mac. */
export function RepositoryPage({
  workspaceId,
  workspaceName,
  repository,
  command,
  onBack,
  onSaved,
}: {
  workspaceId: string;
  workspaceName: string;
  repository: string;
  /** The run command set on this Mac, none where none is. */
  command: string | undefined;
  onBack: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [draft, setDraft] = useState(command ?? "");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  useEffect(() => setDraft(command ?? ""), [command]);
  const next = draft.trim();
  const changed = next !== (command ?? "");
  const write = (value: string | null) => {
    setSaving(true);
    setRejection(undefined);
    act(ACT_KIND.PR_RUN_SET_COMMAND, { workspaceId, repository, command: value }).then(
      () => {
        setSaving(false);
        onSaved();
      },
      (refused: Error) => {
        setSaving(false);
        setRejection(refused.message);
      },
    );
  };
  return (
    <>
      <div className="repository-page-head">
        <button type="button" className="repository-page-back" onClick={onBack}>
          <ChevronLeftIcon aria-hidden="true" />
          {workspaceName}
        </button>
        <h2 className="repository-page-title">{repository}</h2>
      </div>
      <SettingsGroup title="Run on this Mac">
        <form
          className="repository-run-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (changed && next !== "") write(next);
          }}
        >
          <label className="settings-copy" htmlFor="repository-run-command">
            <strong>Run command</strong>
            <small>
              Run on this Mac, in a pull request&apos;s menu, fetches the pull request into a
              checkout of Luke&apos;s own and runs this from the checkout&apos;s root, in your login
              shell. Kept on this Mac only.
            </small>
          </label>
          <textarea
            id="repository-run-command"
            className="settings-input repository-run-command"
            rows={3}
            placeholder="pnpm install && pnpm dev"
            autoComplete="off"
            spellCheck={false}
            maxLength={PR_RUN_BOUNDS.MAX_COMMAND_CHARS}
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            // ⌘Return saves, as a message box sends; a bare Return writes a new line.
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !event.metaKey) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
          <div className="settings-actions repository-run-actions">
            {command === undefined ? null : (
              <button
                type="button"
                className="toolbar-button bordered-button"
                disabled={saving}
                onClick={() => write(null)}
              >
                Remove
              </button>
            )}
            <button
              type="submit"
              className="primary-button"
              disabled={saving || !changed || next === ""}
            >
              <BusyLabel busy={saving} label="Saving">
                Save
              </BusyLabel>
            </button>
          </div>
        </form>
        {rejection === undefined ? null : (
          <p className="error-message" role="alert">
            {rejection}
          </p>
        )}
      </SettingsGroup>
    </>
  );
}
