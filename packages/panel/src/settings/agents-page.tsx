import { CONTEXT_WINDOW } from "@repo/features/agent-wire";
import { remedyLabel } from "@repo/features/failure-remedy";
import {
  agentFallbackChoice,
  type CatalogModel,
  MODEL_PROVIDER,
  MODEL_SPEED,
  type ModelChoice,
  type ModelProvider,
} from "@repo/features/models-wire";
import type { ProviderKeyStatus, ProviderKeySummary } from "@repo/features/provider-key-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords, SIGNED_OUT_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  CHOICE_BAR_LOOK,
  ChoiceBar,
  ErrorState,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  type SettingsRowSkeletonShape,
  SettingsRowsSkeleton,
  SettingsSection,
  Spinner,
  TEXT_BUTTON_TONE,
  TEXT_LINK_LOOK,
  TextButton,
  TextLink,
} from "@repo/ui";
import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useAgentDefault, useOfferedModels } from "../account-choices.js";
import { actMutation } from "../act-mutations.js";
import { refusalShown, unreadShown } from "../failure-report.js";
import { HarnessMark } from "../harness-marks.js";
import { modelsRetryMutation } from "../live-reads.js";
import { OPEN_SETTINGS_LABEL } from "../open-settings.js";
import {
  choiceModelId,
  choiceOn,
  contextWindowsOf,
  effortFor,
  effortLabel,
  effortsOf,
  FAST_ACCESS_URL,
  FAST_WORD,
  fastRestingNote,
  longWindowNote,
  MODELS_READ_FAILED,
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
} from "../tasks/agent-model.js";
import { useRepositoryRemedy } from "../tasks/repository-remedy.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { AgentAuthSection } from "./agent-auth-section.js";
import { SettingMarks } from "./marks.js";
import { PickerRow } from "./picker-row.js";
import { type RowWrite, refusalToast, rowWrite } from "./row-write.js";
import { SwitchRow } from "./switch-row.js";

const PAGE_LINE = {
  FAILED: "The default could not be read.",
  MODELS_NONE_MATCH: "No models match",
  SIGNED_OUT: SIGNED_OUT_WORDS,
  WRITE_FAILED: "The default could not be saved. Try again.",
} as const;

const DEFAULT_SKELETON: readonly SettingsRowSkeletonShape[] = [
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.SWITCH] },
  { described: false, controls: [SETTINGS_SKELETON_CONTROL.CHOICE] },
];

const FAST_ACCESS_WORD = "Request access";

function choiceRefused(answer: object): string | undefined {
  return "failure" in answer ? PAGE_LINE.WRITE_FAILED : undefined;
}

function choiceWrite<Answer extends object>(
  mutation: UseMutationResult<Answer, Error, ModelChoice>,
): RowWrite<ModelChoice> {
  return rowWrite(mutation, { ask: (choice: ModelChoice) => choice, refused: choiceRefused });
}

function DefaultRows({
  choice,
  models,
  ownKeys,
  modelsRetrying,
  onRetryModels,
}: {
  choice: ModelChoice;
  models: readonly CatalogModel[] | undefined;
  ownKeys: ReadonlyMap<ModelProvider, ProviderKeyStatus>;
  modelsRetrying: boolean;
  onRetryModels: () => void;
}): React.JSX.Element {
  const modelWrite = choiceWrite(useMutation(actMutation(ACT_KIND.AGENTS_DEFAULT_WRITE)));
  const effortWrite = choiceWrite(useMutation(actMutation(ACT_KIND.AGENTS_DEFAULT_WRITE)));
  const speedWrite = choiceWrite(useMutation(actMutation(ACT_KIND.AGENTS_DEFAULT_WRITE)));
  const contextWrite = choiceWrite(useMutation(actMutation(ACT_KIND.AGENTS_DEFAULT_WRITE)));
  const fastMutation = useMutation({
    ...actMutation(ACT_KIND.AGENTS_DEFAULT_WRITE),
    onSettled: refusalToast(choiceRefused),
  });
  const listed = models?.find((model) => model.id === choice.model);
  const fallback = agentFallbackChoice(models ?? []);
  const remedy = useRepositoryRemedy();
  const unrunnable = models === undefined ? undefined : unrunnableChoice(models, choice);
  const note =
    unrunnable === undefined ? undefined : (
      <>
        {unrunnable.text}{" "}
        <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => remedy(unrunnable)?.()}>
          {remedyLabel(unrunnable) ?? OPEN_SETTINGS_LABEL}
        </TextButton>
      </>
    );
  const offered = models === undefined ? [] : effortsOf(models, choice.model);
  const efforts = offered.length === 0 ? [choice.effort] : offered;
  const read = readModelChoice(models ?? [], choice.model);
  const base = offeredModels(models ?? []).find((each) => each.model.id === read.base);
  const fastNote =
    base === undefined ? undefined : fastRestingNote(base.model.id, base, models ?? []);
  const fastAskable = base?.model.fastNotEnabled === true && ownKeys.has(MODEL_PROVIDER.ANTHROPIC);
  const openLink = useOpenLink();
  const unsearched = unsearchedModels(models ?? [], read.base);
  const windows = contextWindowsOf(models ?? [], choice.model);
  const window = windowOf(models ?? [], choice);
  const choiceAt = (modelId: string): ModelChoice =>
    choiceOn(
      models ?? [],
      {
        model: modelId,
        effort: effortFor(effortsOf(models ?? [], modelId), choice.effort) ?? choice.effort,
      },
      choice.contextWindow,
    );
  const fastWrite = rowWrite(fastMutation, {
    ask: (fast: boolean) =>
      base === undefined
        ? choice
        : choiceAt(choiceModelId(base, fast ? MODEL_SPEED.FAST : MODEL_SPEED.STANDARD)),
    refused: choiceRefused,
    drawn: (asked) => readModelChoice(models ?? [], asked.model).speed === MODEL_SPEED.FAST,
  });
  return (
    <>
      <PickerRow
        replayUnmasked
        label="Default model"
        labelReplayUnmasked
        detail={note}
        changed={read.base !== fallback.model}
        saves={modelWrite.savedAt}
        error={refusalShown(modelWrite.refusal, FAILURE_SURFACE.SETTING_WRITE)}
        value={read.base}
        valueLabel={modelLabel(read.base, models)}
        valueIcon={listed !== undefined ? <HarnessMark provider={listed.provider} /> : null}
        rows={
          models === undefined
            ? []
            : offeredModels(models).map(({ model }) => ({
                id: model.id,
                label: modelLabel(model.id, models),
                icon: <HarnessMark provider={model.provider} />,
                terms: [model.name, model.provider],
                searchOnly: !unsearched.has(model.id),
                end: modelConnectWords(model),
              }))
        }
        placeholder="Search models"
        noMatch={PAGE_LINE.MODELS_NONE_MATCH}
        note={
          models === undefined ? (
            modelsRetrying ? (
              <Spinner delay label={readingWords("models")} />
            ) : (
              <ErrorState
                failure={unreadShown(FAILURE_SURFACE.MODELS_READ)}
                onRetry={onRetryModels}
              >
                {MODELS_READ_FAILED}
              </ErrorState>
            )
          ) : undefined
        }
        anchor={SETTINGS_SEARCH_ROW.AGENT_MODEL}
        onPick={(id) => {
          const picked = offeredModels(models ?? []).find((each) => each.model.id === id);
          if (picked === undefined) return;
          const missing = modelConnectFailure(picked.model);
          if (missing !== undefined) return remedy(missing)?.();
          modelWrite.run(choiceAt(choiceModelId(picked, read.speed)));
        }}
      />
      {base?.ultrafast !== undefined ? (
        <SettingsRow
          label={SPEED_LABEL}
          adornment={
            <SettingMarks
              changed={read.speed !== MODEL_SPEED.STANDARD}
              saves={speedWrite.savedAt}
            />
          }
          error={refusalShown(speedWrite.refusal, FAILURE_SURFACE.SETTING_WRITE)}
        >
          {() => (
            <ChoiceBar
              label={SPEED_LABEL}
              items={speedsOf(base).map((speed) => ({ value: speed, label: SPEED_WORD[speed] }))}
              value={read.speed}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              {...searchAnchorProps(SETTINGS_SEARCH_ROW.AGENT_FAST)}
              onChange={(speed) => {
                const missing = modelConnectFailure(base.model);
                if (missing !== undefined) return remedy(missing)?.();
                speedWrite.run(choiceAt(choiceModelId(base, speed)));
              }}
            />
          )}
        </SettingsRow>
      ) : (
        <SwitchRow
          label={FAST_WORD}
          labelReplayUnmasked
          detail={
            fastNote === undefined ? undefined : (
              <>
                {`${fastNote}.`}
                {fastAskable ? (
                  <>
                    {" "}
                    <TextLink
                      look={TEXT_LINK_LOOK.UNDERLINED}
                      href={FAST_ACCESS_URL}
                      onClick={(event) => {
                        event.preventDefault();
                        openLink(FAST_ACCESS_URL);
                      }}
                    >
                      {FAST_ACCESS_WORD}
                    </TextLink>
                  </>
                ) : null}
              </>
            )
          }
          checked={read.speed === MODEL_SPEED.FAST}
          anchor={SETTINGS_SEARCH_ROW.AGENT_FAST}
          disabled={base?.fast === undefined}
          write={{
            ...fastWrite,
            run: (fast) => {
              if (base === undefined) return;
              const missing = modelConnectFailure(base.model);
              if (missing !== undefined) return remedy(missing)?.();
              fastWrite.run(fast);
            },
          }}
        />
      )}
      <SettingsRow
        label="Effort"
        adornment={
          <SettingMarks changed={choice.effort !== fallback.effort} saves={effortWrite.savedAt} />
        }
        error={refusalShown(effortWrite.refusal, FAILURE_SURFACE.SETTING_WRITE)}
      >
        {() => (
          <ChoiceBar
            label="Effort"
            items={efforts.map((effort) => ({ value: effort, label: effortLabel(effort) }))}
            value={choice.effort}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            {...searchAnchorProps(SETTINGS_SEARCH_ROW.AGENT_EFFORT)}
            onChange={(effort) => effortWrite.run({ ...choice, effort })}
          />
        )}
      </SettingsRow>
      {windows === undefined ? null : (
        <SettingsRow
          label="Context"
          adornment={
            <SettingMarks changed={window !== CONTEXT_WINDOW.LONG} saves={contextWrite.savedAt} />
          }
          description={longWindowNote(windows)}
          error={refusalShown(contextWrite.refusal, FAILURE_SURFACE.SETTING_WRITE)}
        >
          {() => (
            <ChoiceBar
              label="Context"
              items={[
                { value: CONTEXT_WINDOW.STANDARD, label: windowLabel(windows.standardTokens) },
                { value: CONTEXT_WINDOW.LONG, label: windowLabel(windows.longTokens) },
              ]}
              value={window}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              onChange={(each) => contextWrite.run(choiceOn(models ?? [], choice, each))}
            />
          )}
        </SettingsRow>
      )}
    </>
  );
}

function AgentsSection({
  signedIn,
  ownKeys,
}: {
  signedIn: boolean;
  ownKeys: ReadonlyMap<ModelProvider, ProviderKeyStatus> | undefined;
}): React.JSX.Element {
  const drawn = useAgentDefault();
  const offered = useOfferedModels(signedIn);
  const models = offered.data?.models;
  const modelsFailed = offered.isError;
  const { mutate: retryModels, isPending: modelsRetrying } = useMutation(modelsRetryMutation());
  const onRetryModels = useCallback(() => retryModels(), [retryModels]);

  return (
    <SettingsSection title="Default model">
      {!signedIn ? (
        <SettingsLine>{PAGE_LINE.SIGNED_OUT}</SettingsLine>
      ) : drawn.choice !== undefined && (models !== undefined || modelsFailed) ? (
        <DefaultRows
          choice={drawn.choice}
          models={models}
          ownKeys={ownKeys ?? new Map()}
          modelsRetrying={modelsRetrying}
          onRetryModels={onRetryModels}
        />
      ) : drawn.failed ? (
        <SettingsLine>
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.AGENT_DEFAULTS_READ)}
            onRetry={() => void drawn.retry()}
          >
            {PAGE_LINE.FAILED}
          </ErrorState>
        </SettingsLine>
      ) : (
        <SettingsRowsSkeleton label={readingWords("your default")} rows={DEFAULT_SKELETON} />
      )}
    </SettingsSection>
  );
}

export function AgentsPage({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const [ownKeys, setOwnKeys] = useState<ReadonlyMap<ModelProvider, ProviderKeyStatus>>();
  const onKeys = useCallback((keys: readonly ProviderKeySummary[]) => {
    setOwnKeys(new Map(keys.map((key) => [key.provider, key.status])));
  }, []);
  return (
    <>
      <AgentAuthSection signedIn={signedIn} onKeys={onKeys} />
      <AgentsSection signedIn={signedIn} ownKeys={ownKeys} />
    </>
  );
}
