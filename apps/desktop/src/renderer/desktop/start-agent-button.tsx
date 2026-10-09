import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import { ChevronDownIcon, PlayIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";
import { effortsOf, modelLabel, orderedModels } from "../planning/coding-agent-model";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { ModelProviderMark } from "../provider-marks";
import { type MenuRow, SearchableMenu } from "../searchable-menu";
import { Tooltip } from "../tooltip";

/**
 * start-agent-button.tsx -- the plan toolbar's Start: a split button that starts a coding agent on the plan.
 *
 * The main part starts one on the account's default model and effort, and
 * names neither. The chevron drops the shared searchable menu over the
 * models the service offers, grouped by provider with the newest first,
 * each row under its provider's mark and the default checked; pinned under
 * the list stand the efforts the chosen model lists and one press that
 * starts with that choice, which the service also keeps as the account's
 * default. The menu reads the models and the default as it opens, so it
 * shows the catalog as it stands and the default the last Start wrote. A
 * plan with no repository has nothing for an agent to check out, so Start
 * is unavailable and says why on hover. The menu closes on a Start, on
 * Escape, and on focus leaving it; Escape stops there, so it closes the
 * menu and not the plan behind it.
 */

/** What the menu says in the list's place. */
const MENU_NOTE = {
  READING: "Reading the models…",
  NONE: "No models are offered right now.",
  NO_MATCH: "No models match",
} as const;

/** The menu's rows: each model under its mark, found by its name or its provider. */
function modelRows(models: readonly CatalogModel[]): MenuRow[] {
  return orderedModels(models).map((model) => ({
    id: model.id,
    label: model.name,
    icon: <ModelProviderMark provider={model.provider} />,
    terms: [model.provider],
  }));
}

/** The efforts a chosen model lists, as one group of choices of which one is pressed. */
function EffortChoice({
  efforts,
  chosen,
  onChoose,
}: {
  efforts: readonly string[];
  chosen: string | undefined;
  onChoose: (effort: string) => void;
}): React.JSX.Element {
  return (
    <fieldset className="start-agent-efforts">
      <legend className="visually-hidden">Effort</legend>
      {efforts.map((effort) => (
        <button
          key={effort}
          type="button"
          aria-pressed={effort === chosen}
          className="start-agent-effort"
          onClick={() => onChoose(effort)}
        >
          {effort}
        </button>
      ))}
    </fieldset>
  );
}

export function StartAgentButton({ control }: { control: CodingAgentsControl }): React.JSX.Element {
  const { start } = control;
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ModelChoice | undefined>(undefined);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const chevron = useRef<HTMLButtonElement>(null);
  const latest = useRef(control);
  latest.current = control;

  // The menu opening reads the models and the default, and lands on the default.
  useEffect(() => {
    if (!open) return;
    let live = true;
    // The menu lands on the default as read now, never on an earlier opening's choice.
    setChoice(undefined);
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
  const efforts =
    models !== undefined && choice !== undefined ? effortsOf(models, choice.model) : [];
  // A chosen effort the model does not list, or none yet, falls to the model's first.
  const effort = efforts.includes(choice?.effort ?? "") ? choice?.effort : efforts[0];
  const chosen: ModelChoice | undefined =
    choice !== undefined && effort !== undefined ? { model: choice.model, effort } : undefined;
  const label = start.busy ? "Starting…" : "Start";
  const unavailable = !start.available;

  const press = (named?: ModelChoice) => {
    if (unavailable || start.busy) return;
    start.onPress(named);
  };

  const main = (
    <button
      type="button"
      className="toolbar-button start-agent-main"
      aria-disabled={unavailable || start.busy ? "true" : undefined}
      aria-label="Start a coding agent"
      onClick={() => press()}
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
        {start.reason !== undefined ? <Tooltip label={start.reason}>{main}</Tooltip> : main}
        <button
          ref={chevron}
          type="button"
          className="toolbar-button toolbar-icon-button start-agent-chevron"
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
        <SearchableMenu
          id={menuId}
          label="Model"
          placeholder="Search models"
          className="start-agent-menu"
          rows={models === undefined ? [] : modelRows(models)}
          value={choice?.model}
          note={
            models === undefined ? (
              <p className="plan-compose-menu-note">{MENU_NOTE.READING}</p>
            ) : models.length === 0 ? (
              <p className="plan-compose-menu-note">{MENU_NOTE.NONE}</p>
            ) : undefined
          }
          noMatch={MENU_NOTE.NO_MATCH}
          onPick={(model) => setChoice({ model, effort: choice?.effort ?? "" })}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
          foot={
            chosen !== undefined ? (
              <>
                <EffortChoice
                  efforts={efforts}
                  chosen={chosen.effort}
                  onChoose={(picked) => setChoice({ model: chosen.model, effort: picked })}
                />
                <button
                  type="button"
                  className="plan-compose-menu-row start-agent-with"
                  onClick={() => {
                    close();
                    press(chosen);
                  }}
                >
                  <PlayIcon />
                  <span className="plan-compose-menu-name">
                    Start with {modelLabel(chosen.model, models)} · {chosen.effort}
                  </span>
                </button>
              </>
            ) : undefined
          }
        />
      ) : null}
    </div>
  );
}
