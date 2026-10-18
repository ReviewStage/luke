import { MAC_REPOSITORY_BOUNDS, type MacRepository } from "@luke/features/mac-terminal-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SECTION } from "@luke/settings/settings-views";
import {
  BUTTON_TYPE,
  BUTTON_VARIANT,
  Button,
  ErrorState,
  SettingsLine,
  SettingsRow,
  SettingsSection,
  TEXT_FIELD_AUTO_COMPLETE,
  TEXT_FIELD_FONT,
  TextField,
} from "@luke/ui";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act";

/**
 * mac-repository-settings.tsx -- the Workspace page's Repositories group: the command Run, in an agent tab's ⋯, runs for each repository on this Mac.
 *
 * A row stands for each repository the workspace reaches on GitHub, and for
 * any with a command on this Mac that it no longer lists. The command is
 * saved with Save or Return, and emptied to have none. It is kept in this
 * Mac's settings file alone, never sent to the service. Run, in
 * an agent tab's ⋯, runs it in the branch's worktree before the shell
 * opens; a repository without one opens on the shell alone.
 */

const NOT_READ = "The repositories could not be read.";

/** The repositories and what this Mac holds for each, as last read, or why they are not. */
interface Read {
  readonly names: readonly string[] | undefined;
  readonly set: ReadonlyMap<string, MacRepository>;
  readonly failed: boolean;
  readonly reread: () => void;
}

function useMacRepositoriesRead(workspaceId: string): Read {
  const { act } = useAct();
  const [listed, setListed] = useState<readonly string[] | undefined>(undefined);
  const [set, setSet] = useState<readonly MacRepository[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    Promise.all([
      act(ACT_KIND.TASKS_REPOSITORIES, { workspaceId }),
      act(ACT_KIND.MAC_REPOSITORIES),
    ]).then(
      ([repositories, local]) => {
        if (!live) return;
        setSet(local.repositories);
        if ("failure" in repositories) setFailed(true);
        else setListed(repositories.repositories.repositories.map((each) => each.fullName));
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, workspaceId, attempt]);
  const byKey = new Map(set.map((each) => [each.repository.toLowerCase(), each]));
  // Every repository the workspace lists, then any set here it no longer lists, each once.
  const names =
    listed === undefined
      ? undefined
      : [
          ...listed,
          ...set
            .map((each) => each.repository)
            .filter((name) => !listed.some((each) => each.toLowerCase() === name.toLowerCase())),
        ];
  return { names, set: byKey, failed, reread: () => setAttempt((was) => was + 1) };
}

/** One repository's row: its name, and its command with Save. */
function MacRepositoryRow({
  repository,
  saved,
  onSaved,
}: {
  repository: string;
  saved: MacRepository | undefined;
  onSaved: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const savedCommand = saved?.command ?? "";
  const [command, setCommand] = useState(savedCommand);
  useEffect(() => setCommand(savedCommand), [savedCommand]);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const write = useCallback(
    (entry: MacRepository) => {
      setBusy(true);
      setRejection(undefined);
      act(ACT_KIND.MAC_REPOSITORY_SET, entry).then(
        () => {
          setBusy(false);
          onSaved();
        },
        (refused: Error) => {
          setBusy(false);
          setRejection(refused.message);
        },
      );
    },
    [act, onSaved],
  );
  const typed = command.trim();
  const changed = typed !== savedCommand;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) write({ repository, command: typed === "" ? null : typed });
      }}
    >
      <SettingsRow label={repository} error={rejection}>
        {(control) => (
          <>
            <TextField
              label={`${repository} run command`}
              describedBy={control["aria-describedby"]}
              invalid={control["aria-invalid"]}
              font={TEXT_FIELD_FONT.MONO}
              placeholder="pnpm dev"
              autoComplete={TEXT_FIELD_AUTO_COMPLETE.OFF}
              spellCheck={false}
              maxLength={MAC_REPOSITORY_BOUNDS.MAX_COMMAND_CHARS}
              value={command}
              disabled={busy}
              onChange={setCommand}
            />
            <Button
              type={BUTTON_TYPE.SUBMIT}
              variant={BUTTON_VARIANT.PRIMARY}
              busy={busy}
              busyLabel="Saving"
              disabled={!changed}
            >
              Save
            </Button>
          </>
        )}
      </SettingsRow>
    </form>
  );
}

export function MacRepositoriesGroup({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const read = useMacRepositoriesRead(workspaceId);
  return (
    <SettingsSection title="Repositories" anchor={SETTINGS_SECTION.MAC_REPOSITORIES}>
      <SettingsLine>
        Run, in an agent tab&apos;s ⋯, checks the agent&apos;s pushed branch out on this Mac with
        your own git login and opens a terminal on it inside Luke. A repository&apos;s run command,
        if it has one, runs there first. Commands are kept on this Mac only.
      </SettingsLine>
      {read.failed ? (
        <SettingsLine>
          <ErrorState onRetry={read.reread}>{NOT_READ}</ErrorState>
        </SettingsLine>
      ) : read.names === undefined ? (
        <SettingsLine>Reading the repositories…</SettingsLine>
      ) : read.names.length === 0 ? (
        <SettingsLine>This workspace reaches no repositories on GitHub yet.</SettingsLine>
      ) : (
        read.names.map((repository) => (
          <MacRepositoryRow
            key={repository.toLowerCase()}
            repository={repository}
            saved={read.set.get(repository.toLowerCase())}
            onSaved={read.reread}
          />
        ))
      )}
    </SettingsSection>
  );
}
