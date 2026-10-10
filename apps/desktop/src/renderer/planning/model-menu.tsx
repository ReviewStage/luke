import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import { ModelProviderMark } from "../provider-marks";
import { type FootRow, type MenuRow, SearchableMenu } from "../searchable-menu";
import {
  choiceModelId,
  effortFor,
  effortLabel,
  effortsOf,
  FAST_WORD,
  modelLabel,
  offeredModels,
  readModelChoice,
} from "./coding-agent-model";

/**
 * model-menu.tsx -- the one menu that picks a coding agent's model and effort: the Start button's and the agent box's chip's alike.
 *
 * The shared searchable menu over the base models the service offers,
 * newest first under their provider's mark, each fast version folded into
 * its model, the choice standing checked with its effort and Fast beside
 * its name; a pick of a model keeps the effort it was running or the
 * model's first where it lacks that one, and its fast version where Fast
 * is on and the model has one, and closes the menu. Pinned under the list
 * stand two rows: Effort, naming the effort chosen now and opening a
 * submenu of the ones the chosen model lists, which closes the menu on a
 * pick, and Fast, a switch to the model's fast version, muted where the
 * model has none, which leaves the menu open. The id a choice names is
 * the catalog's own, the fast version's where Fast is on, so the service
 * checks it as it checks any. What the owner does with a choice is its
 * own: the Start button keeps it as the account's default, the chip
 * changes its agent.
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

/**
 * A choice as the catalog offers it now: at its effort where the model
 * lists it, else the nearest the model lists (`effortFor`); nothing before
 * the catalog is read, or for a model the catalog no longer offers, which
 * the menu then draws unchecked and without its pinned rows.
 */
export function settledChoice(
  models: readonly CatalogModel[] | undefined,
  choice: ModelChoice | undefined,
): ModelChoice | undefined {
  if (models === undefined || choice === undefined) return undefined;
  const effort = effortFor(effortsOf(models, choice.model), choice.effort);
  return effort === undefined ? undefined : { model: choice.model, effort };
}

export function ModelMenu(props: {
  /** The menu's id, which its trigger's `aria-controls` names. */
  id: string;
  className?: string | undefined;
  /** The catalog as last read; nothing before the first read lands. */
  models: readonly CatalogModel[] | undefined;
  /** The choice standing now, settled against the catalog (`settledChoice`). */
  chosen: ModelChoice | undefined;
  /** A choice made; the menu has already closed where the row closes it. */
  onChoose: (next: ModelChoice) => void;
  /** Closes the menu and hands focus back to its trigger: on Escape, and before a closing pick is handed on. */
  onClose: () => void;
  /** Focus left the menu for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const { models, chosen, onChoose, onClose } = props;
  const read =
    models !== undefined && chosen !== undefined
      ? readModelChoice(models, chosen.model)
      : undefined;
  const offered =
    models !== undefined && read !== undefined
      ? offeredModels(models).find((each) => each.model.id === read.base)
      : undefined;
  const efforts =
    models !== undefined && chosen !== undefined ? effortsOf(models, chosen.model) : [];

  /** The choice at a model, at the effort chosen where the model lists it, else its first. */
  const choiceAt = (modelId: string, wanted: string | undefined): ModelChoice | undefined => {
    if (models === undefined) return undefined;
    const next = effortFor(effortsOf(models, modelId), wanted);
    return next === undefined ? undefined : { model: modelId, effort: next };
  };

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
                onClose();
                onChoose({ model: chosen.model, effort: picked });
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
                if (next !== undefined) onChoose(next);
              },
            },
            disabled:
              offered?.fast === undefined
                ? `No fast version of ${modelLabel(read.base, models)}`
                : undefined,
          },
        ];

  return (
    <SearchableMenu
      id={props.id}
      label="Model"
      placeholder="Search models"
      {...(props.className === undefined ? undefined : { className: props.className })}
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
        onClose();
        onChoose(next);
      }}
      onClose={onClose}
      onLeave={props.onLeave}
      foot={foot}
    />
  );
}
