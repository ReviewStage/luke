import { noMatchWords, readingWords, TERM } from "@repo/features/words";
import { SHORTCUT_KEY } from "@repo/settings/shortcuts";
import { PlusIcon, Shortcut } from "@repo/ui";
import { CommandDialog, type CommandGroup } from "@repo/ui/command";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { startsOwnAgents } from "./agent-model.js";
import type { AgentsControl } from "./use-agents.js";

const START_ROW = "start-agent";

const START_WORDS = "Start an agent";

const PICKER_LABEL = "New terminal";

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
  onStartAgent: () => void;
  start: { readonly available: boolean };
  onClose: () => void;
}): React.JSX.Element {
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
