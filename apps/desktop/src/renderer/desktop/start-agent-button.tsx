import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import { ChevronDownIcon, PlayIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";
import { effortFor, effortLabel, effortsOf, orderedModels } from "../planning/coding-agent-model";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { ModelProviderMark } from "../provider-marks";
import { type FootRow, type MenuRow, SearchableMenu } from "../searchable-menu";
import { Tooltip } from "../tooltip";

/**
 * start-agent-button.tsx -- the plan toolbar's Start: a split button that starts a coding agent on the plan.
 *
 * The main part starts one on the account's default model and effort, and
 * names neither. The chevron drops the shared searchable menu over the
 * models the service offers, newest first under their provider's mark,
 * the default checked with the effort it runs at beside its name; a pick
 * keeps that model as the account's default, at the effort it was running
 * or the model's first where it lacks that one, and closes the menu.
 * Pinned under the list stands one row, Effort, naming the effort chosen
 * now and opening a submenu of the ones the chosen model lists; a pick
 * there keeps that effort the same way. The menu reads the models and the
 * default as it opens, so it shows the catalog as it stands and the
 * default the last change wrote. A plan with no repository has nothing for
 * an agent to check out, so Start is unavailable and says why on hover.
 * The menu closes on a pick, on Escape, and on focus leaving it; Escape
 * stops there, so it closes the menu and not the plan behind it.
 */

/** What the menu says in the list's place. */
const MENU_NOTE = {
  READING: "Reading the models…",
  NONE: "No models are offered right now.",
  NO_MATCH: "No models match",
} as const;

/** The rows pinned under the list. */
const FOOT_ROW = {
  EFFORT: "effort",
} as const;

/** The menu's rows: each model under its mark, found by its name or its provider, the chosen one saying its effort. */
function modelRows(models: readonly CatalogModel[], chosen: ModelChoice | undefined): MenuRow[] {
  return orderedModels(models).map((model) => ({
    id: model.id,
    label: model.name,
    icon: <ModelProviderMark provider={model.provider} />,
    terms: [model.provider],
    detail: model.id === chosen?.model ? effortLabel(chosen.effort) : undefined,
  }));
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
    // The menu lands on the default as read now, never on an earlier opening's.
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
  // A default effort the model no longer lists falls to the model's first.
  const effort = effortFor(efforts, choice?.effort);
  const chosen: ModelChoice | undefined =
    choice !== undefined && effort !== undefined ? { model: choice.model, effort } : undefined;
  const label = start.busy ? "Starting…" : "Start";
  const unavailable = !start.available;

  // A pick closes the menu and keeps the choice as the default the main part starts on.
  const keep = (next: ModelChoice) => {
    close();
    latest.current.writeDefault(next);
  };

  const press = () => {
    if (unavailable || start.busy) return;
    start.onPress();
  };

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

  const foot: FootRow[] | undefined =
    chosen === undefined
      ? undefined
      : [
          {
            id: FOOT_ROW.EFFORT,
            label: "Effort",
            detail: effortLabel(chosen.effort),
            submenu: {
              label: "Effort",
              rows: efforts.map((each) => ({ id: each, label: effortLabel(each) })),
              value: chosen.effort,
              onPick: (picked) => keep({ model: chosen.model, effort: picked }),
            },
          },
        ];

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
          rows={models === undefined ? [] : modelRows(models, chosen)}
          value={chosen?.model}
          note={
            models === undefined ? (
              <p className="plan-compose-menu-note">{MENU_NOTE.READING}</p>
            ) : models.length === 0 ? (
              <p className="plan-compose-menu-note">{MENU_NOTE.NONE}</p>
            ) : undefined
          }
          noMatch={MENU_NOTE.NO_MATCH}
          onPick={(model) => {
            if (models === undefined) return;
            const next = effortFor(effortsOf(models, model), chosen?.effort);
            if (next !== undefined) keep({ model, effort: next });
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
          foot={foot}
        />
      ) : null}
    </div>
  );
}
