import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { useEffect, useId, useRef, useState } from "react";
import { ModelProviderMark } from "../provider-marks";
import { choiceLabel, providerOfModel } from "./coding-agent-model";
import { ModelMenu, settledChoice } from "./model-menu";
import type { AgentModelControl } from "./use-agent-model";

/**
 * agent-model-chip.tsx -- the chip at the agent box's foot that names what the agent runs on, and the menu that changes it.
 *
 * Drawn along the composer card's foot the way the New Plan page draws its
 * repository chip: the provider's mark and "Claude Opus 5.5 · High", with
 * "· Fast" where the fast version is on. A press opens the shared model
 * menu (`model-menu.tsx`) above the chip, the agent's choice checked; what
 * the menu chooses is the agent's model and effort for its next step,
 * drawn on the chip at once (`use-agent-model.ts`). The chip reads the
 * same whatever the agent is doing, since a change mid-turn applies from
 * the next step and an idle agent's next turn takes it. The models are
 * read as the chip mounts and again as the menu opens, so the menu shows
 * the catalog as it stands. The menu closes on a pick, on Escape, and on
 * focus leaving it; Escape stops there, so it closes the menu and not the
 * panel behind it.
 */

export function AgentModelChip({
  model,
  models,
  readModels,
}: {
  model: AgentModelControl;
  /** The catalog as last read; nothing before the first read lands. */
  models: readonly CatalogModel[] | undefined;
  /** Reads the catalog now, for the chip's mark and name and for a menu opening. */
  readModels: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
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

  const provider = providerOfModel(models, model.choice.model);
  return (
    <div className="agent-model-chip" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="plan-compose-chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
      >
        {provider === undefined ? null : <ModelProviderMark provider={provider} />}
        <span className="plan-compose-chip-name">{choiceLabel(model.choice, models ?? [])}</span>
      </button>
      {open ? (
        <ModelMenu
          id={menuId}
          className="agent-model-menu"
          models={models}
          chosen={settledChoice(models, model.choice)}
          onChoose={model.choose}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
