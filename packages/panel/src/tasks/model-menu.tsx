import { CONTEXT_WINDOW, type MacOffer } from "@luke/features/coding-agent-wire";
import { remedyLabel } from "@luke/features/failure-remedy";
import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import { readingWords } from "@luke/features/words";
import {
  ErrorState,
  type FootRow,
  type MenuRow,
  type PopoverAlign,
  type PopoverBounds,
  type PopoverWidth,
  SearchableMenu,
  Spinner,
} from "@luke/ui";
import { ExperimentTag } from "../experiment-marks.js";
import { HarnessMark } from "../harness-marks.js";
import { OPEN_SETTINGS_LABEL } from "../open-settings.js";
import {
  CONTEXT_WORD,
  type ConnectFailure,
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
  MODELS_READ_FAILED,
  type ModelChoiceRead,
  modelConnectFailure,
  modelConnectWords,
  modelLabel,
  offeredModels,
  readModelChoice,
  unrunnableChoice,
  unsearchedModels,
  windowLabel,
  windowOf,
} from "./coding-agent-model.js";
import { useRepositoryRemedy } from "./repository-remedy.js";

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
 * leaves the menu open. A model whose provider no subscription or API key
 * of the account's pays for says "Connect Claude" or "Connect Codex" at its
 * row's end, and its pick closes the menu and lands on that harness's row
 * in Settings › Agents rather than choosing it. On the Start button's
 * and an automation's menus, whose choice a new agent starts on and the reader's own
 * credentials pay for, a choice that is such a model, as a new account's
 * Claude default is on an OpenAI key alone, has a Connect row head the
 * pinned rows and the last line say why it cannot run; a running agent's
 * chip says nothing of it, since the catalog marks what the reader's
 * account lacks and the agent runs on what its starter's pays. The id a choice names is
 * the catalog's own, the fast version's where Fast is on, so the service
 * checks it as it checks any. What the owner does with a choice is its
 * own: the Start button starts on it, the chip
 * changes its agent, and under the pinned rows says what the agent has
 * cost. The Start button's alone heads its pinned rows with Run on, Cloud
 * or one of the reader's Macs by its name, the Experimental tag beside it,
 * while local agents are on and the service offers any Mac of theirs.
 */

/** What the menu says in the list's place. */
const MENU_NOTE = {
  NONE: "No models are offered right now.",
  NO_MATCH: "No models match",
} as const;

/** The rows pinned under the list. */
const FOOT_ROW = {
  RUN_ON: "run-on",
  EFFORT: "effort",
  CONTEXT: "context",
  FAST: "fast",
  CONNECT: "connect",
} as const;

/** What the Run on row and its cloud choice are called; each Mac is called by its own name. */
const RUN_ON_WORDS = {
  ROW: "Run on",
  CLOUD: "Cloud",
} as const;

/** The Run on row's choice, where the menu offers one: the account's Macs a Start may run on, and the one chosen now, none for the cloud. */
export interface RunOnChoice {
  /** The Macs offered (`macOfferSchema`), each a choice by its name. */
  readonly macs: readonly MacOffer[];
  /** The Mac chosen, by its device id; none for the cloud. */
  readonly deviceId: string | undefined;
  readonly onChoose: (deviceId: string | undefined) => void;
  /** Why no Mac can be chosen for the model standing now, which the row says on hover, standing at Cloud; none where one can. */
  readonly unavailable?: string | undefined;
}

/** The id the Run on row's cloud choice is picked by, which no device id is. */
const CLOUD_ROW = "cloud";

/**
 * The menu's rows: each base model under the mark of the harness that runs
 * it, found by its name, its catalog name, or its provider, so "claude"
 * still finds the names that no longer say it; the chosen one says its
 * effort, and its window where standard, after its name. A model whose
 * provider no credential of the account's pays for says what connects it at
 * its end, so a Start never fails late on it. Before a search only the newest of each family
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
    end: modelConnectWords(model),
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
  /** The button's edge the menu hangs from. */
  align: PopoverAlign;
  /** What it keeps within: its marked room unless its owner asks for the window. */
  bounds?: PopoverBounds | undefined;
  /** How wide it stands: regular where none is named. */
  width?: PopoverWidth | undefined;
  /** The catalog as last read; nothing before the first read lands. */
  models: readonly CatalogModel[] | undefined;
  /** Whether the last read of the catalog did not land; the menu says so, with Retry, where there is no catalog to list. */
  failed: boolean;
  /** Reads the catalog again: Retry's press. */
  onRetry: () => void;
  /** The choice standing now, settled against the catalog (`settledChoice`). */
  chosen: ModelChoice | undefined;
  /** A choice made; the menu has already closed where the row closes it. */
  onChoose: (next: ModelChoice) => void;
  /** Closes the menu and hands focus back to its trigger: on Escape, and before a closing pick is handed on. */
  onClose: () => void;
  /** Focus left the menu for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
  /** Whether the Fast switch is pinned under the list: not for an agent whose harness runs no fast version. */
  offersFast?: boolean | undefined;
  /** One muted line under the pinned rows: what the agent has cost, on the chip's menu; nothing on the Start button's. */
  footNote?: string | undefined;
  /** One muted line under that: the plan that pays and where to manage it, on a ChatGPT-paid agent's chip; nothing elsewhere. */
  planNote?: React.ReactNode;
  /** Whether the choice is what a new agent would start on, on the reader's own credentials, so one nothing of theirs pays for says it cannot run: the Start button's and an automation's. */
  startsNew?: boolean | undefined;
  /** The Run on row heading the pinned rows, its Experimental tag beside it: only the Start button's, while local agents are on and the service offers this Mac. */
  runOn?: RunOnChoice | undefined;
  /** The menu is on its way out (`SearchableMenu`'s). */
  leaving?: boolean | undefined;
  /** Hands the menu's element to the hold its owner draws it through its exit with. */
  ref?: ((element: HTMLElement | null) => void) | undefined;
}): React.JSX.Element {
  const { models, chosen, onChoose, onClose } = props;
  const remedy = useRepositoryRemedy();
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

  /** The Fast switch, where the menu offers one: never for a model whose plan runs no fast mode. */
  const fastRow = (read: ModelChoiceRead, chosen: ModelChoice): FootRow[] => {
    if (props.offersFast === false || models === undefined) return [];
    if (offered?.model.fastWithheldByPlan === true) return [];
    return [
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
  };

  const unrunnable =
    props.startsNew === true && models !== undefined && chosen !== undefined
      ? unrunnableChoice(models, chosen)
      : undefined;

  /** The press that lands on the harness's row in Settings, the menu closed first. */
  const connect = (failure: ConnectFailure): void => {
    onClose();
    remedy(failure)?.();
  };

  /** The Connect row that heads the pinned rows where the choice standing cannot run. */
  const connectRow = (): FootRow[] => {
    if (unrunnable === undefined) return [];
    return [
      {
        id: FOOT_ROW.CONNECT,
        label: remedyLabel(unrunnable) ?? OPEN_SETTINGS_LABEL,
        icon: <HarnessMark provider={unrunnable.provider} />,
        onPress: () => connect(unrunnable),
      },
    ];
  };

  /** The Run on row, where the menu offers one: Cloud, or one of the account's Macs by its name, closing the menu on a pick; muted at Cloud where the model standing runs on no Mac. */
  const runOnRow = (): FootRow[] => {
    const runOn = props.runOn;
    if (runOn === undefined) return [];
    const mac = runOn.macs.find((each) => each.deviceId === runOn.deviceId);
    return [
      {
        id: FOOT_ROW.RUN_ON,
        label: RUN_ON_WORDS.ROW,
        tag: <ExperimentTag />,
        detail: mac?.name ?? RUN_ON_WORDS.CLOUD,
        disabled: runOn.unavailable,
        submenu: {
          label: RUN_ON_WORDS.ROW,
          rows: [
            { id: CLOUD_ROW, label: RUN_ON_WORDS.CLOUD },
            ...runOn.macs.map((each) => ({ id: each.deviceId, label: each.name })),
          ],
          value: mac?.deviceId ?? CLOUD_ROW,
          onPick: (picked) => {
            onClose();
            runOn.onChoose(
              runOn.macs.some((each) => each.deviceId === picked) ? picked : undefined,
            );
          },
        },
      },
    ];
  };

  const foot: FootRow[] | undefined =
    chosen === undefined || read === undefined || models === undefined
      ? undefined
      : [
          ...connectRow(),
          ...runOnRow(),
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
          ...fastRow(read, chosen),
        ];

  return (
    <SearchableMenu
      id={props.id}
      label="Model"
      placeholder="Search models"
      align={props.align}
      bounds={props.bounds}
      width={props.width}
      rows={models === undefined ? [] : modelRows(models, chosen)}
      value={read?.base}
      note={
        models === undefined ? (
          props.failed ? (
            <ErrorState onRetry={props.onRetry}>{MODELS_READ_FAILED}</ErrorState>
          ) : (
            <Spinner delay label={readingWords("models")} />
          )
        ) : models.length === 0 ? (
          MENU_NOTE.NONE
        ) : undefined
      }
      noMatch={MENU_NOTE.NO_MATCH}
      onPick={(base) => {
        // The pick keeps Fast where the model has a fast version, and drops it where it has none.
        const picked = offeredModels(models ?? []).find((each) => each.model.id === base);
        if (picked === undefined) return;
        // A model nothing pays for is never chosen: its pick goes to connect it.
        const missing = modelConnectFailure(picked.model);
        if (missing !== undefined) return connect(missing);
        const next = choiceAt(choiceModelId(picked, read?.fast ?? false), chosen?.effort);
        if (next === undefined) return;
        onClose();
        onChoose(next);
      }}
      onClose={onClose}
      onLeave={props.onLeave}
      foot={foot}
      footNote={props.footNote}
      planNote={unrunnable === undefined ? props.planNote : unrunnable.text}
      leaving={props.leaving}
      ref={props.ref}
    />
  );
}
