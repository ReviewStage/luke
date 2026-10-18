import { FAILURE_REASON, remedyLabel, retriesBesideRemedy } from "@luke/features/failure-remedy";
import type { ModelChoice } from "@luke/features/models-wire";
import { ChevronDownIcon, ERROR_STATE_PLACEMENT, ErrorState, PlayIcon } from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useEffect, useId, useRef, useState } from "react";
import { BusyLabel } from "../spinner";
import { choiceLabel } from "../tasks/coding-agent-model";
import { ModelMenu, settledChoice } from "../tasks/model-menu";
import { useRepositoryRemedy } from "../tasks/repository-remedy";
import type { CodingAgentsControl } from "../tasks/use-coding-agents";
import { Tooltip } from "../tooltip";

/**
 * start-agent-button.tsx -- the task toolbar's Start: a split button that starts a coding agent on the task.
 *
 * The main part starts one on the account's default model and effort, and
 * says which on hover: "Opus 5.5 High Fast". The chevron drops
 * the shared model menu (`../tasks/model-menu.tsx`), the default
 * checked; what the menu chooses is kept as the account's default, which
 * is what the main part then starts on. The models and the default are
 * read as the button mounts and again as the menu opens, so the menu
 * shows the catalog as it stands and the default the last change wrote. A
 * task with no repository has nothing for an agent to check out, so Start
 * is unavailable and says why on hover instead. The menu closes on a pick,
 * on Escape, on a press of the main part, and on focus leaving the button;
 * Escape stops there, so it closes the menu and not the task behind it.
 * In a toolbar short of room the main part draws its glyph alone, named
 * still, its hover saying the model as before (desktop.css's `plan-toolbar`).
 */

export function StartAgentButton({ control }: { control: CodingAgentsControl }): React.JSX.Element {
  const { start } = control;
  const repositoryRemedy = useRepositoryRemedy();
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
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

  // A press of the main part closes the menu whether or not it starts
  // anything: the main part sits inside the button, so the focus moving to it
  // is not focus leaving, and nothing else would close the menu.
  const press = () => {
    setOpen(false);
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
      aria-busy={start.busy ? "true" : undefined}
      onClick={press}
    >
      <BusyLabel busy={start.busy} label="Starting">
        <PlayIcon />
        <span className="start-agent-word">Start</span>
      </BusyLabel>
    </button>
  );

  const note = start.note;
  const remedyWords = note === undefined ? undefined : remedyLabel(note);
  const remedy = note === undefined ? undefined : repositoryRemedy(note, () => press());
  return (
    <div className="start-agent" ref={root} data-unavailable={String(unavailable)}>
      {note !== undefined ? (
        // Start itself is the retry of a plain refusal; a repository's remedy keeps Retry
        // beside it where it is finished elsewhere, and a move presses Start again by itself.
        <div className="start-agent-note">
          <ErrorState
            placement={ERROR_STATE_PLACEMENT.TOOLBAR}
            remedy={
              remedyWords === undefined || remedy === undefined
                ? undefined
                : { label: remedyWords, onClick: remedy }
            }
            onRetry={
              note.reason !== FAILURE_REASON.OTHER &&
              (remedyWords === undefined || retriesBesideRemedy(note))
                ? () => press()
                : undefined
            }
          >
            {note.text}
          </ErrorState>
        </div>
      ) : null}
      <div className="start-agent-split">
        {hint !== undefined ? <Tooltip label={hint}>{main}</Tooltip> : main}
        <button
          ref={chevron}
          type="button"
          className="icon-button start-agent-chevron"
          aria-label="Choose a model to start with"
          aria-haspopup="dialog"
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
      {drawn.mounted ? (
        <ModelMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
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
