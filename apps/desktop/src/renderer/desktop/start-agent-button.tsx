import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import { ChevronDownIcon, PlayIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";
import {
  choiceLabel,
  choiceModelId,
  effortFor,
  effortLabel,
  effortsOf,
  FAST_WORD,
  modelLabel,
  offeredModels,
  readModelChoice,
} from "../planning/coding-agent-model";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { ModelProviderMark } from "../provider-marks";
import { type FootRow, type MenuRow, SearchableMenu } from "../searchable-menu";
import { Tooltip } from "../tooltip";

/**
 * start-agent-button.tsx -- the plan toolbar's Start: a split button that starts a coding agent on the plan.
 *
 * The main part starts one on the account's default model and effort, and
 * says which on hover: "Claude Opus 5.5 · High · Fast". The chevron drops
 * the shared searchable menu over the base models the service offers,
 * newest first under their provider's mark, each fast version folded into
 * its model, the default checked with its effort and Fast beside its
 * name; a pick keeps that model as the account's default, at the effort
 * it was running or the model's first where it lacks that one, and its
 * fast version where Fast is on and the model has one, and closes the
 * menu. Pinned under the list stand two rows: Effort, naming the effort
 * chosen now and opening a submenu of the ones the chosen model lists,
 * and Fast, a switch to the model's fast version, muted where the model
 * has none; either keeps its change as the default the same way, the
 * switch without closing the menu. The stored id is the catalog's own,
 * the fast version's where Fast is on, so the service checks it as it
 * checks any. The models and the default are read as the button mounts
 * and again as the menu opens, so the menu shows the catalog as it stands
 * and the default the last change wrote. A plan with no repository has
 * nothing for an agent to check out, so Start is unavailable and says why
 * on hover instead. The menu closes on a pick, on Escape, and on focus
 * leaving it; Escape stops there, so it closes the menu and not the plan
 * behind it.
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
  FAST: "fast",
} as const;

/** What the checked row says after its name: the effort, and Fast where the fast version is on. */
function chosenDetail(effort: string, fast: boolean): string {
  return fast ? `${effortLabel(effort)} · ${FAST_WORD}` : effortLabel(effort);
}

/** The menu's rows: each base model under its mark, found by its name or its provider, the chosen one saying its effort. */
function modelRows(models: readonly CatalogModel[], chosen: ModelChoice | undefined): MenuRow[] {
  const read = chosen === undefined ? undefined : readModelChoice(models, chosen.model);
  return offeredModels(models).map(({ model }) => ({
    id: model.id,
    label: model.name,
    icon: <ModelProviderMark provider={model.provider} />,
    terms: [model.provider],
    detail:
      chosen !== undefined && model.id === read?.base
        ? chosenDetail(chosen.effort, read.fast)
        : undefined,
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
  const efforts =
    models !== undefined && choice !== undefined ? effortsOf(models, choice.model) : [];
  // A default effort the model no longer lists falls to the model's first.
  const effort = effortFor(efforts, choice?.effort);
  const chosen: ModelChoice | undefined =
    choice !== undefined && effort !== undefined ? { model: choice.model, effort } : undefined;
  const read =
    models !== undefined && chosen !== undefined
      ? readModelChoice(models, chosen.model)
      : undefined;
  const offered =
    models !== undefined && read !== undefined
      ? offeredModels(models).find((each) => each.model.id === read.base)
      : undefined;
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

  /** The choice at a model, at the effort chosen where the model lists it, else its first. */
  const choiceAt = (modelId: string, wanted: string | undefined): ModelChoice | undefined => {
    if (models === undefined) return undefined;
    const next = effortFor(effortsOf(models, modelId), wanted);
    return next === undefined ? undefined : { model: modelId, effort: next };
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

  const foot: FootRow[] | undefined =
    chosen === undefined || read === undefined || models === undefined
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
              onPick: (picked) => {
                close();
                keep({ model: chosen.model, effort: picked });
              },
            },
          },
          {
            id: FOOT_ROW.FAST,
            label: FAST_WORD,
            toggle: {
              on: read.fast,
              onToggle: () => {
                if (offered === undefined) return;
                const next = choiceAt(choiceModelId(offered, !read.fast), chosen.effort);
                if (next !== undefined) keep(next);
              },
            },
            disabled:
              offered?.fast === undefined
                ? `No fast version of ${modelLabel(read.base, models)}`
                : undefined,
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
        <SearchableMenu
          id={menuId}
          label="Model"
          placeholder="Search models"
          className="start-agent-menu"
          rows={models === undefined ? [] : modelRows(models, chosen)}
          value={read?.base}
          note={
            models === undefined ? (
              <p className="plan-compose-menu-note">{MENU_NOTE.READING}</p>
            ) : models.length === 0 ? (
              <p className="plan-compose-menu-note">{MENU_NOTE.NONE}</p>
            ) : undefined
          }
          noMatch={MENU_NOTE.NO_MATCH}
          onPick={(base) => {
            // The pick keeps Fast where the model has a fast version, and drops it where it has none.
            const picked = offeredModels(models ?? []).find((each) => each.model.id === base);
            if (picked === undefined) return;
            const next = choiceAt(choiceModelId(picked, read?.fast ?? false), chosen?.effort);
            if (next === undefined) return;
            close();
            keep(next);
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
