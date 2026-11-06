import { noMatchWords, readingWords, TERM } from "@repo/features/words";
import { SHORTCUT_KEY } from "@repo/settings/shortcuts";
import { PlusIcon, Shortcut } from "@repo/ui";
import { CommandDialog, type CommandGroup } from "@repo/ui/command";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { startsOwnAgents } from "./agent-model.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * terminal-picker.tsx -- the palette a terminal command opens on a task with no coding agent: its one offer, to start one.
 *
 * A terminal belongs to one agent (`terminal-entry.ts`), whose rules never
 * ask which; a task with none has no terminal to open, so the command
 * offers to start an agent, as the command palette's own dialog and row. A
 * pilot task's agents are its pilot's to start, so it offers nothing, and
 * while the task's agents are still being read it says so.
 */

/** The value of the row that starts an agent. */
const START_ROW = "start-agent";

/** The start row's words. */
const START_WORDS = "Start an agent";

/** What the palette's field says. */
const PICKER_LABEL = "New terminal";

/** The keys' hints along the foot, each its chord and then its word, which a reader is not read. */
function PickerFoot(): React.JSX.Element {
  return (
    <ReplayUnmask>
      <span aria-hidden="true">
        <Shortcut chord={{ key: SHORTCUT_KEY.ENTER, bare: true }} /> {START_WORDS}
      </span>
      <span aria-hidden="true">
        <Shortcut chord={{ key: SHORTCUT_KEY.ESCAPE, bare: true }} /> Close
      </span>
    </ReplayUnmask>
  );
}

export function TerminalPicker({
  open,
  agents,
  onStartAgent,
  start,
  onClose,
}: {
  open: boolean;
  agents: AgentsControl;
  /** Starts a coding agent on the task. */
  onStartAgent: () => void;
  /** Whether a coding agent can start on the task now. */
  start: { readonly available: boolean };
  onClose: () => void;
}): React.JSX.Element {
  // Note that a task whose agents are not read yet offers nothing until they are.
  const read = agents.agents !== undefined;
  const offersStart = read && startsOwnAgents(agents.mode);
  const groups: readonly CommandGroup[] = offersStart
    ? [
        {
          id: START_ROW,
          items: [
            {
              id: START_ROW,
              words: START_WORDS,
              label: START_WORDS,
              icon: <PlusIcon />,
              disabled: !start.available,
              onSelect: () => {
                onClose();
                onStartAgent();
              },
            },
          ],
        },
      ]
    : [];
  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label={PICKER_LABEL}
      placeholder={PICKER_LABEL}
      replayUnmasked
      groups={groups}
      selected={offersStart && start.available ? START_ROW : ""}
      onSelectedChange={() => undefined}
      empty={noMatchWords(TERM.AGENT)}
      {...(read ? {} : { loading: readingWords(`the task’s ${TERM.AGENT.many}`) })}
      foot={<PickerFoot />}
    />
  );
}
