import { CONTEXT_WINDOW } from "@repo/features/agent-wire";
import { remedyLabel } from "@repo/features/failure-remedy";
import {
  type CatalogModel,
  MODEL_SPEED,
  type ModelChoice,
  type ModelSpeed,
} from "@repo/features/models-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import {
  ErrorState,
  type FootRow,
  type MenuLastLine,
  type MenuRow,
  type PopoverAlign,
  type PopoverBounds,
  type PopoverWidth,
  SearchableMenu,
  Spinner,
} from "@repo/ui";
import { unreadShown } from "../failure-report.js";
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
  SPEED_LABEL,
  SPEED_WORD,
  speedsOf,
  unrunnableChoice,
  unsearchedModels,
  windowLabel,
  windowOf,
} from "./agent-model.js";
import { useRepositoryRemedy } from "./repository-remedy.js";

const MENU_NOTE = {
  NONE: "No models are offered right now.",
  NO_MATCH: "No models match",
} as const;

const FOOT_ROW = {
  EFFORT: "effort",
  CONTEXT: "context",
  FAST: "fast",
  SPEED: "speed",
  CONNECT: "connect",
} as const;

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
  id: string;
  align: PopoverAlign;
  bounds?: PopoverBounds | undefined;
  width?: PopoverWidth | undefined;
  models: readonly CatalogModel[] | undefined;
  failed: boolean;
  onRetry: () => void;
  chosen: ModelChoice | undefined;
  onChoose: (next: ModelChoice) => void;
  onClose: () => void;
  onLeave: (left: EventTarget | null) => void;
  offersFast?: boolean | undefined;
  lastLine?: MenuLastLine | undefined;
  startsNew?: boolean | undefined;
  leaving?: boolean | undefined;
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

  const chooseSpeed = (speed: ModelSpeed, effort: string): void => {
    if (offered === undefined) return;
    const missing = modelConnectFailure(offered.model);
    if (missing !== undefined) {
      connect(missing);
      return;
    }
    const next = choiceAt(choiceModelId(offered, speed), effort);
    if (next !== undefined) onChoose(next);
  };

  const speedRow = (read: ModelChoiceRead, chosen: ModelChoice): FootRow[] => {
    if (props.offersFast === false || models === undefined) return [];
    if (offered?.ultrafast !== undefined) {
      return [
        {
          id: FOOT_ROW.SPEED,
          label: SPEED_LABEL,
          detail: SPEED_WORD[read.speed],
          submenu: {
            label: SPEED_LABEL,
            rows: speedsOf(offered).map((speed) => ({ id: speed, label: SPEED_WORD[speed] })),
            value: read.speed,
            onPick: (picked) => {
              const speed = speedsOf(offered).find((each) => each === picked);
              if (speed === undefined) return;
              onClose();
              chooseSpeed(speed, chosen.effort);
            },
          },
        },
      ];
    }
    const fast = read.speed === MODEL_SPEED.FAST;
    return [
      {
        id: FOOT_ROW.FAST,
        label: FAST_WORD,
        toggle: {
          on: fast,
          onToggle: () =>
            chooseSpeed(fast ? MODEL_SPEED.STANDARD : MODEL_SPEED.FAST, chosen.effort),
        },
        disabled: fastRestingNote(read.base, offered, models),
      },
    ];
  };

  const unrunnable =
    props.startsNew === true && models !== undefined && chosen !== undefined
      ? unrunnableChoice(models, chosen)
      : undefined;

  const connect = (failure: ConnectFailure): void => {
    onClose();
    remedy(failure)?.();
  };

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

  const foot: FootRow[] | undefined =
    chosen === undefined || read === undefined || models === undefined
      ? undefined
      : [
          ...connectRow(),
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
          ...speedRow(read, chosen),
        ];

  return (
    <SearchableMenu
      replayUnmasked
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
            <ErrorState failure={unreadShown(FAILURE_SURFACE.MODELS_READ)} onRetry={props.onRetry}>
              {MODELS_READ_FAILED}
            </ErrorState>
          ) : (
            <Spinner delay label={readingWords("models")} />
          )
        ) : models.length === 0 ? (
          MENU_NOTE.NONE
        ) : undefined
      }
      noMatch={MENU_NOTE.NO_MATCH}
      onPick={(base) => {
        const picked = offeredModels(models ?? []).find((each) => each.model.id === base);
        if (picked === undefined) return;
        const missing = modelConnectFailure(picked.model);
        if (missing !== undefined) return connect(missing);
        const next = choiceAt(
          choiceModelId(picked, read?.speed ?? MODEL_SPEED.STANDARD),
          chosen?.effort,
        );
        if (next === undefined) return;
        onClose();
        onChoose(next);
      }}
      onClose={onClose}
      onLeave={props.onLeave}
      foot={foot}
      lastLine={unrunnable === undefined ? props.lastLine : { words: unrunnable.text }}
      leaving={props.leaving}
      ref={props.ref}
    />
  );
}
