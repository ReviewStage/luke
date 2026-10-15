import { PR_RUN_BOUNDS, type PrRunCommandsAnswer } from "@luke/features/pr-run-view";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useState } from "react";
import { useAct } from "../act";
import { BusyLabel } from "../spinner";
import { ReadFailed, SettingsGroup } from "./settings-group";

/**
 * pr-runs-section.tsx -- the command Run on this Mac runs for each repository of a workspace, the This Mac page's second group.
 *
 * Run on this Mac, in a pull request's menu, fetches the pull request into
 * Luke's own checkout of it on this Mac and runs the repository's command
 * from that checkout's root, in the login shell; a repository with no
 * command set runs nothing and says to set one here. The commands are kept
 * on this Mac for the account signed in, by workspace and repository, never
 * synced and never taken from the pull request. The group lists the
 * repositories of the workspace the sidebar shows, as the service reads
 * them, and any with a command set; each row's field saves on Save or
 * Return, and an emptied field clears its command.
 */

const NOT_READ = "The repositories could not be read.";

/** A repository as the group lists it: its full name, as GitHub spells it. */
interface ListedRepository {
  readonly fullName: string;
}

/** One repository's row: its name, and its command in a field that saves it. */
function CommandRow({
  workspaceId,
  repository,
  command,
  onSaved,
}: {
  workspaceId: string;
  repository: string;
  command: string | undefined;
  onSaved: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [draft, setDraft] = useState(command ?? "");
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  useEffect(() => setDraft(command ?? ""), [command]);
  const changed = draft.trim() !== (command ?? "");
  const save = () => {
    setSaving(true);
    setRejection(undefined);
    const next = draft.trim();
    act(ACT_KIND.PR_RUN_SET_COMMAND, {
      workspaceId,
      repository,
      command: next === "" ? null : next,
    }).then(
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
      <form
        className="settings-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) save();
        }}
      >
        <span className="settings-copy">
          <strong>{repository}</strong>
        </span>
        <input
          type="text"
          className="settings-input"
          aria-label={`Run command for ${repository}`}
          placeholder="pnpm install && pnpm dev"
          autoComplete="off"
          spellCheck={false}
          maxLength={PR_RUN_BOUNDS.MAX_COMMAND_CHARS}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className="toolbar-button bordered-button"
          disabled={saving || !changed}
        >
          <BusyLabel busy={saving} label="Saving">
            Save
          </BusyLabel>
        </button>
      </form>
      {rejection === undefined ? null : (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      )}
    </>
  );
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

export function PrRunsSection({
  workspace,
  signedIn,
}: {
  /** The workspace the sidebar shows, whose repositories are listed; none before the workspaces are read. */
  workspace: Workspace | undefined;
  signedIn: boolean;
}): React.JSX.Element | null {
  const { act } = useAct();
  const workspaceId = workspace?.id;
  const [listed, setListed] = useState<readonly ListedRepository[] | undefined>(undefined);
  const [commands, setCommands] = useState<PrRunCommandsAnswer["commands"]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!signedIn || workspaceId === undefined) return;
    let live = true;
    setListed(undefined);
    setFailed(false);
    Promise.all([
      act(ACT_KIND.PLANNING_REPOSITORIES, { workspaceId }),
      act(ACT_KIND.PR_RUN_COMMANDS),
    ]).then(
      ([repositories, set]) => {
        if (!live) return;
        setCommands(set.commands);
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
  }, [act, signedIn, workspaceId, attempt]);

  if (!signedIn || workspaceId === undefined) return null;
  const mine = new Map(
    commands
      .filter((each) => each.workspaceId === workspaceId)
      .map((each) => [each.repository.toLowerCase(), each.command]),
  );
  const reread = () => setAttempt((was) => was + 1);
  return (
    <SettingsGroup title={`Run commands in ${workspace?.name ?? "this workspace"}`}>
      <div className="settings-card-line">
        <small>
          Run on this Mac, in a pull request&apos;s menu, fetches the pull request into a checkout
          of Luke&apos;s own and runs its repository&apos;s command there, from the checkout&apos;s
          root, in your login shell.
        </small>
      </div>
      {failed ? (
        <ReadFailed line={NOT_READ} onRetry={reread} />
      ) : listed === undefined ? null : (
        rowRepositories(listed, mine).map((repository) => (
          <CommandRow
            key={repository.toLowerCase()}
            workspaceId={workspaceId}
            repository={repository}
            command={mine.get(repository.toLowerCase())}
            onSaved={reread}
          />
        ))
      )}
    </SettingsGroup>
  );
}
