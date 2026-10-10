import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { ChevronDownIcon, PlayIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";
import { choiceLabel } from "../planning/coding-agent-model";
import { ModelMenu, settledChoice } from "../planning/model-menu";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { Tooltip } from "../tooltip";

/**
 * start-agent-button.tsx -- the plan toolbar's Start: a split button that starts a coding agent on the plan.
 *
 * The main part starts one on the account's default model and effort, and
 * says which on hover: "Claude Opus 5.5 · High · Fast". The chevron drops
 * the shared model menu (`../planning/model-menu.tsx`), the default
 * checked; what the menu chooses is kept as the account's default, which
 * is what the main part then starts on. The models and the default are
 * read as the button mounts and again as the menu opens, so the menu
 * shows the catalog as it stands and the default the last change wrote. A
 * plan with no repository has nothing for an agent to check out, so Start
 * is unavailable and says why on hover instead. The menu closes on a pick,
 * on Escape, and on focus leaving it; Escape stops there, so it closes the
 * menu and not the plan behind it.
 */

export function StartAgentButton({ control }: { control: CodingAgentsControl }): React.JSX.Element {
  const { start } = control;
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ModelChoice | undefined>(undefined);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const chevron = useRef<HTMLButtonElement>(null);
  const latest = useRef(control);
  latest.current = control;
  /** How many changes have been kept, so an answer to an earlier one is told apart from the latest. */
  const writes = useRef(0);

  // The models and the default are read as the button mounts, for its hover
  // line, and again as the menu opens, so the menu lands on the default as
  // it stands now; what was read before stands until the new read lands.
  useEffect(() => {
    let live = true;
    latest.current.readModels();
    latest.current.readDefault().then((answer) => {
      if (live && !("failure" in answer)) setChoice(answer.choice);
    });
    return () => {
      live = false;
    };
  }, [open]);

  // Note that we hand focus back to the chevron, as a native menu returns it
  // to its trigger, because closing takes the focused field away with it.
  const close = () => {
    setOpen(false);
    chevron.current?.focus();
  };

  const models = control.models;
  // A default effort the model no longer lists falls to the model's first.
  const chosen = settledChoice(models, choice);
  const label = start.busy ? "Starting…" : "Start";
  const unavailable = !start.available;

  // A change is kept as the default the main part starts on, and drawn at
  // once; what the service answers then stands, and a write that did not
  // take (said beside Start by the control) gives way to the default as the
  // service still holds it. An answer that a later change overtook is let go.
  const keep = (next: ModelChoice) => {
    writes.current += 1;
    const write = writes.current;
    setChoice(next);
    latest.current.writeDefault(next).then((answer) => {
      if (write !== writes.current) return;
      if (!("failure" in answer)) {
        setChoice(answer.choice);
        return;
      }
      latest.current.readDefault().then((read) => {
        if (write === writes.current && !("failure" in read)) setChoice(read.choice);
      });
    });
  };

  const press = () => {
    if (unavailable || start.busy) return;
    start.onPress();
  };

  const hint =
    start.reason ??
    (models !== undefined && chosen !== undefined ? choiceLabel(chosen, models) : undefined);
  const main = (
    <button
      type="button"
      className="toolbar-button start-agent-main"
      aria-disabled={unavailable || start.busy ? "true" : undefined}
      aria-label="Start a coding agent"
      onClick={press}
    >
      <PlayIcon />
      {label}
    </button>
  );

  return (
    <div className="start-agent" ref={root} data-unavailable={String(unavailable)}>
      {start.note !== undefined ? (
        <p className="desktop-toolbar-note" role="alert">
          {start.note}
        </p>
      ) : null}
      <div className="start-agent-split">
        {hint !== undefined ? <Tooltip label={hint}>{main}</Tooltip> : main}
        <button
          ref={chevron}
          type="button"
          className="icon-button start-agent-chevron"
          aria-label="Choose a model to start with"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-disabled={unavailable ? "true" : undefined}
          onClick={() => {
            if (unavailable) return;
            setOpen(!open);
          }}
        >
          <ChevronDownIcon />
        </button>
      </div>
      {open ? (
        <ModelMenu
          id={menuId}
          className="start-agent-menu"
          models={models}
          chosen={chosen}
          onChoose={keep}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
