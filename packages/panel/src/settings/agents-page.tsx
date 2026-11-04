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
import {
  PROVIDER_KEY_STATUS,
  type ProviderKeyStatus,
  type ProviderKeySummary,
} from "@repo/features/provider-key-wire";
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
import { useSettingWrite } from "@repo/ui/use-setting-write";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useCallback, useState } from "react";
import { useAgentDefault, useOfferedModels } from "../account-choices.js";
import { useAct } from "../act.js";
import { refusalShown, unreadShown } from "../failure-report.js";
import { HarnessMark } from "../harness-marks.js";
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
import { HOST_READ_STATUS } from "../use-host-read.js";
import { AgentAuthSection } from "./agent-auth-section.js";
import { ChaptersModelSection } from "./chapters-model-section.js";
import { SettingMarks } from "./marks.js";
import { PickerRow } from "./picker-row.js";
import { SwitchRow } from "./switch-row.js";

/**
 * agents-page.tsx -- Settings › Agents: the one model and effort every agent starts on.
 *
 * The page opens on one line of what it is for, then the harnesses' rows,
 * each saying how Claude Code or Codex is connected and opening the dialog
 * that connects it with a plan or an API key (`agent-auth-section.tsx`),
 * then this file's Default model, then the model a Generate chapters runs
 * on (`chapters-model-section.tsx`), then the page's schema rows. The
 * harnesses and the Default model share the one read of the keys, so a
 * key saved or removed above is what the model row says at once. The default model's one value is the account's, kept
 * on the service beside the settings preferences and written by this page
 * alone; the page draws it, and the models, from what the host holds for
 * the account (`account-choices.ts`), and until the page writes it, the
 * fallback the models mark as paid for (`agentDefaultOf`), which the host
 * moves on its own as a key saved or removed moves the models. The model row is the same picker every settings row uses,
 * searched because the catalog is long: each base model under the mark
 * of the harness that runs it, the newest first within each provider, every fast
 * and Ultrafast version folded into its model, the chosen one checked; a model no
 * subscription or API key of the account's pays for says "Connect Claude" or
 * "Connect Codex" at its end, and its pick lands on that harness's row above
 * rather than keeping it, and a default that is such a model, as a stored
 * Claude default is once no Claude credential pays for it, says it cannot
 * run under the row, with the same press. Under it a Fast
 * switch runs the model's fast version, resting where the model has none
 * or the service withholds it because Anthropic never granted the key's
 * organization fast mode, saying which, and on the account's own key with
 * a link to ask Anthropic for it; for a model nothing pays for, its press
 * lands on that harness's row as the pick's does, and writes nothing;
 * the stored id is the catalog's own, the fast version's where the switch
 * is on. For a model with an Ultrafast version a Speed row stands in Fast's
 * place, a segmented control over the speeds the model offers, Standard,
 * Fast, and Ultrafast, storing that version's id. The effort row is a segmented control over the efforts the chosen
 * model lists, and for a model that offers two context windows a context
 * row is one over the two, the whole window the default, saying what it
 * costs past the standard one; a change of model keeps the standard window
 * where the next model offers two. A write is one ask of the service, which
 * the host draws over the account's preferences on the press, so the rows
 * stay live while it is out; the model, Effort, and Context rows each write through
 * `useSettingWrite`, so each says its own refusal under it and ticks Saved
 * once its write lands, and Modified while it differs from the fallback this
 * account would start on with none stored. Fast is a `SwitchRow` like every other settings switch, so its
 * refusal is said in a toast as the switch flips back. With no account signed in
 * there is no default to show, and the page says so.
 *
 * The group is `@repo/ui`'s `SettingsSection`, and Speed, Effort, and Context each
 * its `SettingsRow` holding the shared `ChoiceBar`, segmented.
 */

/** What the page says while it cannot read or write, and with no account. */
const PAGE_LINE = {
  FAILED: "The default could not be read.",
  MODELS_NONE_MATCH: "No models match",
  SIGNED_OUT: SIGNED_OUT_WORDS,
  WRITE_FAILED: "The default could not be saved. Try again.",
} as const;

/**
 * The rows that stand in the Default model group's place while it is read:
 * the model's picker over its note, Fast's switch over its own, and effort's
 * segments, which every model draws; context's stands only for a model with a
 * long window, so none stands for it.
 */
const DEFAULT_SKELETON: readonly SettingsRowSkeletonShape[] = [
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.SELECT] },
  { described: true, controls: [SETTINGS_SKELETON_CONTROL.SWITCH] },
  { described: false, controls: [SETTINGS_SKELETON_CONTROL.CHOICE] },
];

/** The link under a resting Fast row that asks Anthropic for fast mode. */
const FAST_ACCESS_WORD = "Request access";

/** A provider as the model row names the key it runs on. */
const PROVIDER_NAME = {
  [MODEL_PROVIDER.ANTHROPIC]: "Anthropic",
  [MODEL_PROVIDER.OPENAI]: "OpenAI",
} as const satisfies Record<ModelProvider, string>;

/** A write the service kept. */
const WRITE_ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** A write the service refused or never answered. */
const WRITE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: PAGE_LINE.WRITE_FAILED,
};

/**
 * What the model row says under its name, where the key it runs on is the
 * account's own: that it runs there while the provider last accepted it, and
 * that the key needs a hand where it did not, since such a key fails the
 * agent's steps. Without an API key the row says nothing where a
 * subscription pays; where nothing does, `DefaultRows` says the default
 * cannot run in this note's place.
 */
function modelRowNote(
  provider: ModelProvider | undefined,
  status: ProviderKeyStatus | undefined,
): string | undefined {
  if (provider === undefined || status === undefined) return undefined;
  const name = PROVIDER_NAME[provider];
  return status === PROVIDER_KEY_STATUS.VERIFIED
    ? `Runs on your own ${name} key.`
    : `Your ${name} key needs attention.`;
}

/** The page's rows, over the default as read: the model's picker and the effort's segments. */
function DefaultRows({
  choice,
  models,
  ownKeys,
  modelsRetrying,
  onRetryModels,
  onChange,
}: {
  choice: ModelChoice;
  /** The catalog, or nothing where it could not be read. */
  models: readonly CatalogModel[] | undefined;
  /** How each provider the account holds a key of its own for last answered it. */
  ownKeys: ReadonlyMap<ModelProvider, ProviderKeyStatus>;
  /** Whether a read of the catalog, asked for again after it failed, is out. */
  modelsRetrying: boolean;
  /** Reads the catalog again: the failure's Retry. */
  onRetryModels: () => void;
  /** Asks the service to keep `choice`, answering whether it did. */
  onChange: (choice: ModelChoice) => Promise<ActionResult>;
}): React.JSX.Element {
  // Fast's switch says its own refusal in a toast, and each of the others words its own under its row and ticks Saved when its write lands.
  const modelWrite = useSettingWrite(onChange);
  const effortWrite = useSettingWrite(onChange);
  const speedWrite = useSettingWrite(onChange);
  const contextWrite = useSettingWrite(onChange);
  const listed = models?.find((model) => model.id === choice.model);
  const ownKey = listed === undefined ? undefined : ownKeys.get(listed.provider);
  // Modified reads against the default this account would run on with none stored, as its credentials decide it.
  const fallback = agentFallbackChoice(models ?? []);
  const remedy = useRepositoryRemedy();
  // A default nothing pays for says so in the key's note's place, with the press that connects it.
  const unrunnable = models === undefined ? undefined : unrunnableChoice(models, choice);
  const note =
    unrunnable === undefined ? (
      modelRowNote(listed?.provider, ownKey)
    ) : (
      <>
        {unrunnable.text}{" "}
        <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => remedy(unrunnable)?.()}>
          {remedyLabel(unrunnable) ?? OPEN_SETTINGS_LABEL}
        </TextButton>
      </>
    );
  // The stored effort stands alone until the catalog is read, and where the catalog has
  // stopped offering the stored model, so the row never draws nothing.
  const offered = models === undefined ? [] : effortsOf(models, choice.model);
  const efforts = offered.length === 0 ? [choice.effort] : offered;
  const read = readModelChoice(models ?? [], choice.model);
  const base = offeredModels(models ?? []).find((each) => each.model.id === read.base);
  const fastNote =
    base === undefined ? undefined : fastRestingNote(base.model.id, base, models ?? []);
  // Only the account's own organization can ask for fast mode, so the link stands on its own key alone.
  const fastAskable = base?.model.fastNotEnabled === true && ownKeys.has(MODEL_PROVIDER.ANTHROPIC);
  const openLink = useOpenLink();
  const unsearched = unsearchedModels(models ?? [], read.base);
  const windows = contextWindowsOf(models ?? [], choice.model);
  const window = windowOf(models ?? [], choice);
  /** The choice at a catalog id, at the stored effort where the model lists it, else its first, on the stored window where the model offers it. */
  const choiceAt = (modelId: string): ModelChoice =>
    choiceOn(
      models ?? [],
      {
        model: modelId,
        effort: effortFor(effortsOf(models ?? [], modelId), choice.effort) ?? choice.effort,
      },
      choice.contextWindow,
    );
  return (
    <>
      <PickerRow
        label="Default model"
        detail={note}
        changed={read.base !== fallback.model}
        saves={modelWrite.saves}
        error={refusalShown(modelWrite.rejection, FAILURE_SURFACE.SETTING_WRITE)}
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
          // The pick keeps the speed chosen where the model has a version at it, and drops to standard where it has none.
          const picked = offeredModels(models ?? []).find((each) => each.model.id === id);
          if (picked === undefined) return;
          // A model nothing pays for is never kept as the default: its pick goes to connect it.
          const missing = modelConnectFailure(picked.model);
          if (missing !== undefined) return remedy(missing)?.();
          modelWrite.run(choiceAt(choiceModelId(picked, read.speed)));
        }}
      />
      {/* Speed in Fast's place where the model has an Ultrafast version. */}
      {base?.ultrafast !== undefined ? (
        <SettingsRow
          label={SPEED_LABEL}
          adornment={
            <SettingMarks changed={read.speed !== MODEL_SPEED.STANDARD} saves={speedWrite.saves} />
          }
          error={refusalShown(speedWrite.rejection, FAILURE_SURFACE.SETTING_WRITE)}
        >
          {() => (
            <ChoiceBar
              label={SPEED_LABEL}
              items={speedsOf(base).map((speed) => ({ value: speed, label: SPEED_WORD[speed] }))}
              value={read.speed}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              {...searchAnchorProps(SETTINGS_SEARCH_ROW.AGENT_FAST)}
              onChange={(speed) => {
                // A model nothing pays for runs no faster: the press goes to connect it, as its pick does.
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
          onChange={(fast) => {
            if (base === undefined) return Promise.resolve(WRITE_ACCEPTED);
            // A model nothing pays for runs no faster: the press goes to connect it, as its pick does, and the switch stands.
            const missing = modelConnectFailure(base.model);
            if (missing !== undefined) return remedy(missing)?.();
            return onChange(
              choiceAt(choiceModelId(base, fast ? MODEL_SPEED.FAST : MODEL_SPEED.STANDARD)),
            );
          }}
        />
      )}
      <SettingsRow
        label="Effort"
        adornment={
          <SettingMarks changed={choice.effort !== fallback.effort} saves={effortWrite.saves} />
        }
        error={refusalShown(effortWrite.rejection, FAILURE_SURFACE.SETTING_WRITE)}
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
            <SettingMarks changed={window !== CONTEXT_WINDOW.LONG} saves={contextWrite.saves} />
          }
          description={longWindowNote(windows)}
          error={refusalShown(contextWrite.rejection, FAILURE_SURFACE.SETTING_WRITE)}
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

/**
 * The Default model group: the model, Fast, effort, and context rows, or why
 * they cannot be drawn, over the default and the models the host holds for
 * the account (`account-choices.ts`), which a key saved or removed moves on
 * its own, since the host asks the models again as the keys move.
 */
function AgentsSection({
  signedIn,
  ownKeys,
}: {
  signedIn: boolean;
  /** How each provider the account holds a key of its own for last answered it, as the API keys group holds them; nothing until they are read. */
  ownKeys: ReadonlyMap<ModelProvider, ProviderKeyStatus> | undefined;
}): React.JSX.Element {
  const { act } = useAct();
  const drawn = useAgentDefault();
  const offered = useOfferedModels(signedIn);
  const models = offered.rows?.models;
  const modelsFailed = offered.status === HOST_READ_STATUS.FAILED;
  // Whether the catalog's Retry is out, which the menu says while it is.
  const [modelsRetrying, setModelsRetrying] = useState(false);
  const retryModels = offered.retry;
  const onRetryModels = useCallback(() => {
    setModelsRetrying(true);
    retryModels().then(() => setModelsRetrying(false));
  }, [retryModels]);

  const write = useCallback(
    (next: ModelChoice): Promise<ActionResult> =>
      act(ACT_KIND.AGENTS_DEFAULT_WRITE, next)
        .catch(() => undefined)
        .then((answer) =>
          answer === undefined || "failure" in answer ? WRITE_REFUSED : WRITE_ACCEPTED,
        ),
    [act],
  );

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
          onChange={write}
        />
      ) : drawn.status === HOST_READ_STATUS.FAILED ? (
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

/**
 * The harnesses and the Default model group, over the keys the harnesses'
 * rows hold: the model row's note says which provider runs on the account's
 * own key, so it reads them from the rows that change them rather than from
 * a read of its own that a save there would leave behind.
 */
export function AgentsPage({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const [ownKeys, setOwnKeys] = useState<ReadonlyMap<ModelProvider, ProviderKeyStatus>>();
  const onKeys = useCallback((keys: readonly ProviderKeySummary[]) => {
    setOwnKeys(new Map(keys.map((key) => [key.provider, key.status])));
  }, []);
  return (
    <>
      <AgentAuthSection signedIn={signedIn} onKeys={onKeys} />
      <AgentsSection signedIn={signedIn} ownKeys={ownKeys} />
      <ChaptersModelSection signedIn={signedIn} />
    </>
  );
}
