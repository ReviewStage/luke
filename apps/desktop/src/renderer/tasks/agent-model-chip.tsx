import type { CodingAgentUsage } from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import { AnchoredPopover, CHIP_LOOK, Chip, type ChipLook, ChipName, POPOVER_ALIGN } from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useEffect, useId, useRef, useState } from "react";
import { HarnessMark } from "../harness-marks";
import { Tooltip } from "../tooltip";
import { agentUsageLine, choiceLabel, providerOf } from "./coding-agent-model";
import { ModelLabel } from "./model-label";
import { ModelMenu, settledChoice } from "./model-menu";
import type { AgentModelControl } from "./use-agent-model";

/**
 * agent-model-chip.tsx -- the chip at the agent box's foot that names what the agent runs on, and the menu that changes it.
 *
 * Drawn along the composer card's foot as the window's toolbar chip
 * (`@luke/ui`'s `Chip`), the task toolbar's repository chip's look, with no
 * border and no fill until the pointer is on it or its menu is open:
 * "Opus 5.5 High" (`model-label.tsx`), with "Fast" after the effort where
 * the fast version is on and the standard context window's size where the
 * agent runs on that rather than its model's whole window ("GPT-5.5 High
 * 272K"), and a chevron saying it opens a menu. A press
 * opens the shared model menu (`model-menu.tsx`) right above the chip,
 * from its trailing edge, since the chip stands at the foot's right
 * (`@luke/ui`'s `AnchoredPopover`), the
 * agent's choice checked; what the menu chooses is the agent's model,
 * effort, and context window for its next step, drawn on the chip at once (`use-agent-model.ts`). The chip reads the
 * same whatever the agent is doing, since a change mid-turn applies from
 * the next step and an idle agent's next turn takes it. The models are
 * read as the chip mounts and again as the menu opens, so the menu shows
 * the catalog as it stands. Under the menu's pinned rows one muted line
 * says what the agent has cost so far, tokens and dollars, once a turn has
 * settled. The menu closes on a pick, on Escape, and on
 * focus leaving it; Escape stops there, so it closes the menu and not the
 * panel behind it. The chip also carries its harness's mark, which a
 * composer too narrow for the words draws in their place, so the choice
 * is named by the chip's label and its tooltip rather than by its words.
 */

export function AgentModelChip({
  model,
  models,
  readModels,
  usage,
  look = CHIP_LOOK.TOOLBAR,
}: {
  model: AgentModelControl;
  /** The catalog as last read; nothing before the first read lands. */
  models: readonly CatalogModel[] | undefined;
  /** Reads the catalog now, for the chip's name and for a menu opening. */
  readModels: () => void;
  /** What the agent has cost, as its transcript's last page said; nothing before a turn settled. */
  usage: CodingAgentUsage | undefined;
  /** The chip's look: the agent box's toolbar chip, or a form row's field (`@luke/ui`'s `Chip`). */
  look?: ChipLook;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Note that the reader is read through a ref, because the tab hands a new
  // closure on every render and a read is owed to the mount and the opening.
  const latest = useRef(readModels);
  latest.current = readModels;

  useEffect(() => {
    latest.current();
  }, [open]);

  // Note that we hand focus back to the chip, as a native menu returns it to
  // its trigger, because closing takes the focused field away with it.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const provider = providerOf(model.choice.model);
  const label = choiceLabel(model.choice, models ?? []).trim();

  return (
    <div className="agent-model-chip" ref={root}>
      <Tooltip label={label}>
        <Chip
          ref={trigger}
          look={look}
          chevron
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(!open)}
        >
          {provider === undefined ? null : <HarnessMark provider={provider} />}
          <ChipName>
            <ModelLabel choice={model.choice} models={models ?? []} />
          </ChipName>
        </Chip>
      </Tooltip>
      {drawn.mounted ? (
        <AnchoredPopover align={POPOVER_ALIGN.END}>
          <ModelMenu
            leaving={drawn.leaving}
            ref={drawn.ref}
            id={menuId}
            className="agent-model-menu"
            models={models}
            chosen={settledChoice(models, model.choice)}
            onChoose={model.choose}
            footNote={agentUsageLine(usage)}
            onClose={close}
            onLeave={(left) => {
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
      ) : null}
    </div>
  );
}
