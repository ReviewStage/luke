import { CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import { HarnessMark } from "@luke/panel/harness-marks";
import { Spinner } from "@luke/panel/spinner";
import { type FootRow, type MenuRow, SearchableMenu } from "../searchable-menu";
import {
  CONTEXT_WORD,
  choiceModelId,
  choiceOn,
  choiceWords,
  contextWindowsOf,
  effortFor,
  effortLabel,
  effortsOf,
  FAST_WORD,
  fastRestingNote,
  longWindowNote,
  modelLabel,
  offeredModels,
  readModelChoice,
  unsearchedModels,
  windowLabel,
  windowOf,
} from "./coding-agent-model";

/**
 * model-menu.tsx -- the one menu that picks a coding agent's model and effort: the Start button's and the agent box's chip's alike.
 *
 * The shared searchable menu over the base models the service offers,
 * the newest of each family until a search reaches the rest, under their
 * harness's mark, each fast version folded into
 * its model, the choice standing checked with its effort, Fast, and the
 * standard window beside its name; a pick of a model keeps the effort it was
 * running or the model's first where it lacks that one, its fast version
 * where Fast is on and the model has one, and the standard window where the
 * model offers two, and closes the menu. Pinned under the list stand up to
 * three rows: Effort, naming the effort chosen now and opening a submenu
 * of the ones the chosen model lists; Context, only for a model that
 * offers two windows, naming the window chosen now and opening a submenu
 * of the two with what the whole one costs under them; each closes the menu
 * on a pick; and Fast, a switch to the model's fast version, muted where
 * the model has none or the service withholds it, saying which, which
 * leaves the menu open. The id a choice names is
 * the catalog's own, the fast version's where Fast is on, so the service
 * checks it as it checks any. What the owner does with a choice is its
 * own: the Start button keeps it as the account's default, the chip
 * changes its agent, and under the pinned rows says what the agent has
 * cost.
 */

/** What the menu says in the list's place. */
const MENU_NOTE = {
  NONE: "No models are offered right now.",
  NO_MATCH: "No models match",
} as const;

/** The rows pinned under the list. */
const FOOT_ROW = {
  EFFORT: "effort",
  CONTEXT: "context",
  FAST: "fast",
} as const;

/**
 * The menu's rows: each base model under the mark of the harness that runs
 * it, found by its name, its catalog name, or its provider, so "claude"
 * still finds the names that no longer say it; the chosen one says its
 * effort, and its window where standard, after its name. Before a search only the newest of each family
 * and the chosen one are listed (`unsearchedModels`).
 */
function modelRows(models: readonly CatalogModel[], chosen: ModelChoice | undefined): MenuRow[] {
  const read = chosen === undefined ? undefined : readModelChoice(models, chosen.model);
  const unsearched = unsearchedModels(models, read?.base);
  return offeredModels(models).map(({ model }) => ({
    id: model.id,
    label: modelLabel(model.id, models),
    icon: <HarnessMark provider={model.provider} />,
    terms: [model.name, model.provider],
    detail:
      chosen !== undefined && model.id === read?.base
        ? choiceWords(chosen, models).detail
        : undefined,
    searchOnly: !unsearched.has(model.id),
  }));
}

/**
 * A choice as the catalog offers it now: at its effort where the model
 * lists it, else the nearest the model lists (`effortFor`), and on the
 * standard window only where the model still offers two; nothing before
 * the catalog is read, or for a model the catalog no longer offers, which
 * the menu then draws unchecked and without its pinned rows.
 */
export function settledChoice(
  models: readonly CatalogModel[] | undefined,
  choice: ModelChoice | undefined,
): ModelChoice | undefined {
  if (models === undefined || choice === undefined) return undefined;
  const effort = effortFor(effortsOf(models, choice.model), choice.effort);
  return effort === undefined
    ? undefined
    : choiceOn(models, { model: choice.model, effort }, choice.contextWindow);
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
  /** One muted line under the pinned rows: what the agent has cost, on the chip's menu; nothing on the Start button's. */
  footNote?: string | undefined;
  /** The menu is on its way out (`SearchableMenu`'s). */
  leaving?: boolean | undefined;
  /** Hands the menu's element to the hold its owner draws it through its exit with. */
  ref?: ((element: HTMLElement | null) => void) | undefined;
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
  const windows =
    models !== undefined && chosen !== undefined
      ? contextWindowsOf(models, chosen.model)
      : undefined;

  /** The choice at a model, at the effort chosen where the model lists it, else its first, on the window chosen where the model offers it. */
  const choiceAt = (modelId: string, wanted: string | undefined): ModelChoice | undefined => {
    if (models === undefined) return undefined;
    const next = effortFor(effortsOf(models, modelId), wanted);
    return next === undefined
      ? undefined
      : choiceOn(models, { model: modelId, effort: next }, chosen?.contextWindow);
  };

  const contextRow = (choice: ModelChoice, offered: readonly CatalogModel[]): FootRow[] => {
    if (windows === undefined) return [];
    const standard = windowOf(offered, choice) === CONTEXT_WINDOW.STANDARD;
    return [
      {
        id: FOOT_ROW.CONTEXT,
        label: CONTEXT_WORD,
        detail: windowLabel(standard ? windows.standardTokens : windows.longTokens),
        submenu: {
          label: CONTEXT_WORD,
          rows: [
            { id: CONTEXT_WINDOW.STANDARD, label: windowLabel(windows.standardTokens) },
            { id: CONTEXT_WINDOW.LONG, label: windowLabel(windows.longTokens) },
          ],
          value: standard ? CONTEXT_WINDOW.STANDARD : CONTEXT_WINDOW.LONG,
          note: longWindowNote(windows),
          onPick: (picked) => {
            onClose();
            const window = picked === CONTEXT_WINDOW.STANDARD ? CONTEXT_WINDOW.STANDARD : undefined;
            onChoose(choiceOn(offered, choice, window));
          },
        },
      },
    ];
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
                onChoose({ ...chosen, effort: picked });
              },
            },
          },
          ...contextRow(chosen, models),
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
            disabled: fastRestingNote(read.base, offered, models),
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
          <Spinner label="Loading models" />
        ) : models.length === 0 ? (
          MENU_NOTE.NONE
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
      footNote={props.footNote}
      leaving={props.leaving}
      ref={props.ref}
    />
  );
}
