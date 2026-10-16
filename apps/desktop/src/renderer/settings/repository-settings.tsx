import { REPOSITORY_RUN_BOUNDS, type RepositoryRun } from "@luke/features/repository-run-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SECTION } from "@luke/settings/settings-views";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAct } from "../act";
import { BusyLabel } from "../spinner";
import { ReadFailed, SettingsGroup } from "./settings-group";

/**
 * repository-settings.tsx -- a workspace's repositories on its Settings page, each opening a page of its own settings: today, how Run on this Mac sets up and runs its pull requests.
 *
 * The Workspace page lists the repositories the workspace's GitHub
 * installation reaches, as the service reads them, and any with commands
 * set that it no longer lists; each row says what it runs and opens the
 * repository's own page in the Workspace page's place, with its way back
 * above it; a link or search result seeking a section of the
 * Workspace page closes it (`SETTINGS_SEEK_EVENT`), and the list is read
 * again whenever the window takes the keyboard back, as after choosing
 * repositories on GitHub. There its setup command and its run command are
 * written and saved, or removed. They are the workspace's, shared by every
 * member, and never taken from a pull request (`compose-pr-runs.ts` in the
 * host); Run on this Mac, in a pull request's menu, checks the pull request
 * out in Luke's own clone of the repository, runs the setup the first time
 * and whenever a lockfile changes, then runs the run command from the
 * checkout's root in the login shell, with a port of its own in
 * `LUKE_PORT`.
 */

const NOT_READ = "The repositories could not be read.";

/** A repository as the page lists it: its full name, as GitHub spells it. */
interface ListedRepository {
  readonly fullName: string;
}

/** A repository's commands as the page holds them, by its name lowercased. */
type CommandsByRepository = ReadonlyMap<string, RepositoryRun>;

/** The workspace's repositories and their shared commands, as last read, or why they are not. */
interface RepositoriesRead {
  readonly listed: readonly string[] | undefined;
  readonly commands: CommandsByRepository;
  readonly failed: boolean;
  readonly reread: () => void;
}

/** The repositories a row is drawn for: the workspace's, and any with commands set that it no longer lists, by name. */
function rowRepositories(
  listed: readonly ListedRepository[],
  commands: CommandsByRepository,
): readonly string[] {
  const names = new Map<string, string>();
  for (const repository of listed)
    names.set(repository.fullName.toLowerCase(), repository.fullName);
  for (const key of commands.keys()) if (!names.has(key)) names.set(key, key);
  return [...names.values()];
}

/** The workspace's repositories and their shared commands, read when the page opens and again on `reread`. */
export function useRepositoriesRead(workspaceId: string): RepositoriesRead {
  const { act } = useAct();
  const [listed, setListed] = useState<readonly ListedRepository[] | undefined>(undefined);
  const [runs, setRuns] = useState<readonly RepositoryRun[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    Promise.all([
      act(ACT_KIND.PLANNING_REPOSITORIES, { workspaceId }),
      act(ACT_KIND.PR_RUN_COMMANDS, { workspaceId }),
    ]).then(
      ([repositories, commands]) => {
        if (!live) return;
        setRuns(commands.runs);
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
  const commands: CommandsByRepository = new Map(
    runs.map((each) => [each.repository.toLowerCase(), each]),
  );
  return {
    listed: listed === undefined ? undefined : rowRepositories(listed, commands),
    commands,
    failed,
    reread: () => setAttempt((was) => was + 1),
  };
}

/** The Workspace page's Repositories group: a row per repository, saying what Run on this Mac runs for it, each opening its page. */
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
          const runCommand = read.commands.get(repository.toLowerCase())?.runCommand ?? null;
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
                  {runCommand === null ? (
                    "No run command yet"
                  ) : (
                    <>
                      Runs <code className="repository-row-command">{runCommand}</code>
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

/** One command's field on a repository's page: its name, what it does, and the field. */
function CommandField({
  id,
  label,
  detail,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  detail: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="repository-run-field">
      <label className="settings-copy" htmlFor={id}>
        <strong>{label}</strong>
        <small>{detail}</small>
      </label>
      <textarea
        id={id}
        className="settings-input repository-run-command"
        rows={2}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        maxLength={REPOSITORY_RUN_BOUNDS.MAX_COMMAND_CHARS}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        // ⌘Return saves, as a message box sends; a bare Return writes a new line.
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !event.metaKey) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
      />
    </div>
  );
}

/** One repository's own page in the Workspace page's place: its way back, its name, and its setup and run commands, shared with the workspace. */
export function RepositoryPage({
  workspaceId,
  workspaceName,
  repository,
  run,
  onBack,
  onSaved,
}: {
  workspaceId: string;
  workspaceName: string;
  repository: string;
  /** The commands saved for it, none where none are. */
  run: RepositoryRun | undefined;
  onBack: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [setup, setSetup] = useState(run?.setupCommand ?? "");
  const [command, setCommand] = useState(run?.runCommand ?? "");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  useEffect(() => {
    setSetup(run?.setupCommand ?? "");
    setCommand(run?.runCommand ?? "");
  }, [run]);
  const next = { setupCommand: setup.trim() || null, runCommand: command.trim() || null };
  const changed =
    next.setupCommand !== (run?.setupCommand ?? null) ||
    next.runCommand !== (run?.runCommand ?? null);
  const write = (value: { setupCommand: string | null; runCommand: string | null }) => {
    setSaving(true);
    setRejection(undefined);
    act(ACT_KIND.PR_RUN_SET_COMMAND, { workspaceId, repository, ...value }).then(
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
            if (changed) write(next);
          }}
        >
          <p className="settings-note">
            Run on this Mac, in a pull request&apos;s menu, checks the pull request out on your Mac
            and runs these from the checkout&apos;s root in your login shell, with a free port in{" "}
            <code>LUKE_PORT</code>. They&apos;re shared with everyone in {workspaceName}.
          </p>
          <CommandField
            id="repository-setup-command"
            label="Setup"
            detail="Runs on a pull request's first Run, and again when a lockfile changes."
            placeholder="pnpm install"
            value={setup}
            disabled={saving}
            onChange={setSetup}
          />
          <CommandField
            id="repository-run-command"
            label="Run"
            detail="Starts the app, and runs until it ends or you stop it."
            placeholder="pnpm dev --port $LUKE_PORT"
            value={command}
            disabled={saving}
            onChange={setCommand}
          />
          <div className="settings-actions repository-run-actions">
            {run === undefined ? null : (
              <button
                type="button"
                className="toolbar-button bordered-button"
                disabled={saving}
                onClick={() => write({ setupCommand: null, runCommand: null })}
              >
                Remove
              </button>
            )}
            <button type="submit" className="primary-button" disabled={saving || !changed}>
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
