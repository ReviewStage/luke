import { CONTEXT_WINDOW } from "@luke/features/coding-agent-wire";
import {
  type CatalogModel,
  MODEL_PROVIDER,
  type ModelChoice,
  type ModelProvider,
} from "@luke/features/models-wire";
import {
  PROVIDER_KEY_STATUS,
  type ProviderKeyStatus,
  type ProviderKeySummary,
} from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import { SETTINGS_SEARCH_ROW } from "@luke/settings/settings-anchors";
import {
  ErrorState,
  SettingsLine,
  SettingsRow,
  SettingsRowsSkeleton,
  SettingsSection,
  TEXT_LINK_LOOK,
  TextLink,
} from "@luke/ui";
import { actionRejection } from "@luke/ui/use-setting-write";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useCallback, useEffect, useState } from "react";
import { useAct } from "../act";
import { HarnessMark } from "../harness-marks";
import { Segmented } from "../segmented";
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
  modelLabel,
  offeredModels,
  readModelChoice,
  unsearchedModels,
  windowLabel,
  windowOf,
} from "../tasks/coding-agent-model";
import { useOpenLink } from "../tasks/use-open-link";
import { ApiKeysSection } from "./api-keys-section";
import { PickerRow } from "./picker-row";
import { SwitchRow } from "./switch-row";

/**
 * coding-agents-page.tsx -- Settings › Coding agents: the model and effort a click on Start runs an agent on.
 *
 * The page is two groups under their own headings: this file's Default
 * model, then the account's own API keys (`api-keys-section.tsx`). The two
 * share the one read of the keys, so a
 * key saved or removed below is what the model row says at once. The default model's one value is the account's, kept
 * on the service beside the settings preferences and written by this page
 * and by a Start that named a model alike, so the page reads it afresh as it
 * opens and shows what the last Start wrote. The model row is the same picker every settings row uses,
 * searched because the catalog is long: each base model under the mark
 * of the harness that runs it, the newest first within each provider, every fast
 * version folded into its model, the chosen one checked. Under it a Fast
 * switch runs the model's fast version, resting where the model has none
 * or the service withholds it because Anthropic never granted the key's
 * organization fast mode, saying which, and on the account's own key with
 * a link to ask Anthropic for it;
 * the stored id is the catalog's own, the fast version's where the switch
 * is on. The effort row is a segmented control over the efforts the chosen
 * model lists, and for a model that offers two context windows a context
 * row is one over the two, the whole window the default, saying what it
 * costs past the standard one; a change of model keeps the standard window
 * where the next model offers two. A write is one ask of the service, the rows resting until
 * it answers; Fast is a `SwitchRow` like every other settings switch, so its
 * refusal is worded under its own row, and the other rows' under them all. With no account signed in
 * there is no default to show, and the page says so.
 *
 * The group is `@luke/ui`'s `SettingsSection`, and Effort and Context each
 * its `SettingsRow` holding the shared `Segmented`.
 */

/** What the page says while it cannot read or write, and with no account. */
const PAGE_LINE = {
  FAILED: "The default could not be read.",
  MODELS_FAILED: "The models could not be read. Open Settings again to try again.",
  MODELS_NONE_MATCH: "No models match.",
  SIGNED_OUT: "Sign in to choose the model your coding agents run on.",
  WRITE_FAILED: "The default could not be saved. Try again.",
} as const;

/** How many rows stand in the Default model group's place while it is read: the model's, effort's, and context's, which every model draws. */
const DEFAULT_SKELETON_ROWS = 3;

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
 * agent's steps rather than letting them fall back to Luke's. On Luke's key
 * the row says nothing, there being nothing the developer did to remember.
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
  busy,
  onChange,
}: {
  choice: ModelChoice;
  /** The catalog, or nothing where it could not be read. */
  models: readonly CatalogModel[] | undefined;
  /** How each provider the account holds a key of its own for last answered it. */
  ownKeys: ReadonlyMap<ModelProvider, ProviderKeyStatus>;
  busy: boolean;
  /** Asks the service to keep `choice`, answering whether it did. */
  onChange: (choice: ModelChoice) => Promise<ActionResult>;
}): React.JSX.Element {
  // Fast's switch words its own refusal under its row, and the picker's and the segments' is worded under them all.
  const [rejection, setRejection] = useState<string>();
  // Note that every row writes the one stored choice, so a save that lands clears the other rows'
  // refusal too: Fast's by standing its row afresh, which only a row pressed elsewhere does.
  const [othersSaved, setOthersSaved] = useState(0);
  const run = (next: ModelChoice) => {
    void onChange(next).then((result) => {
      setRejection(actionRejection(result));
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) setOthersSaved((count) => count + 1);
    });
  };
  const runFast = (next: ModelChoice) =>
    onChange(next).then((result) => {
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) setRejection(undefined);
      return result;
    });
  const listed = models?.find((model) => model.id === choice.model);
  const ownKey = listed === undefined ? undefined : ownKeys.get(listed.provider);
  const note = modelRowNote(listed?.provider, ownKey);
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
        label="Model"
        detail={note}
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
              }))
        }
        placeholder="Search models"
        noMatch={PAGE_LINE.MODELS_NONE_MATCH}
        note={
          models === undefined ? <span role="alert">{PAGE_LINE.MODELS_FAILED}</span> : undefined
        }
        anchor={SETTINGS_SEARCH_ROW.CODING_AGENT_MODEL}
        disabled={busy}
        onPick={(id) => {
          // The pick keeps Fast where the model has a fast version, and drops it where it has none.
          const picked = offeredModels(models ?? []).find((each) => each.model.id === id);
          if (picked === undefined) return;
          run(choiceAt(choiceModelId(picked, read.fast)));
        }}
      />
      <SwitchRow
        key={othersSaved}
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
        checked={read.fast}
        anchor={SETTINGS_SEARCH_ROW.CODING_AGENT_FAST}
        disabled={busy || base?.fast === undefined}
        onChange={(fast) =>
          base === undefined
            ? Promise.resolve(WRITE_ACCEPTED)
            : runFast(choiceAt(choiceModelId(base, fast)))
        }
      />
      {/* A refusal of any of the rows stands under them all, in the last row's error line. */}
      <SettingsRow label="Effort" error={windows === undefined ? rejection : undefined}>
        {() => (
          <Segmented
            legend="Effort"
            options={efforts.map((effort) => ({ value: effort, label: effortLabel(effort) }))}
            value={choice.effort}
            disabled={busy}
            anchor={SETTINGS_SEARCH_ROW.CODING_AGENT_EFFORT}
            onChange={(effort) => run({ ...choice, effort })}
          />
        )}
      </SettingsRow>
      {windows === undefined ? null : (
        <SettingsRow label="Context" description={longWindowNote(windows)} error={rejection}>
          {() => (
            <Segmented
              legend="Context"
              options={[
                { value: CONTEXT_WINDOW.STANDARD, label: windowLabel(windows.standardTokens) },
                { value: CONTEXT_WINDOW.LONG, label: windowLabel(windows.longTokens) },
              ]}
              value={window}
              disabled={busy}
              onChange={(each) => run(choiceOn(models ?? [], choice, each))}
            />
          )}
        </SettingsRow>
      )}
    </>
  );
}

/** The Default model group: the model, Fast, effort, and context rows, or why they cannot be drawn. */
function CodingAgentsSection({
  signedIn,
  ownKeys,
  keysAnswered,
}: {
  signedIn: boolean;
  /** How each provider the account holds a key of its own for last answered it, as the API keys group holds them; nothing until they are read. */
  ownKeys: ReadonlyMap<ModelProvider, ProviderKeyStatus> | undefined;
  /** How many times the API keys group has answered the keys: once as it reads them, and once more for each save or removal. */
  keysAnswered: number;
}): React.JSX.Element {
  const { act } = useAct();
  const [choice, setChoice] = useState<ModelChoice | undefined>(undefined);
  const [models, setModels] = useState<readonly CatalogModel[] | undefined>(undefined);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // The page opening reads the default the service holds now, which a Start may just have written.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    // Nothing of an earlier read, or an earlier account, stands while this one is out.
    setChoice(undefined);
    setReadFailed(false);
    setModels(undefined);
    setModelsFailed(false);
    act(ACT_KIND.CODING_AGENTS_DEFAULT_READ).then(
      (answer) => {
        if (!live) return;
        if ("failure" in answer) setReadFailed(true);
        else setChoice(answer.choice);
      },
      () => {
        if (live) setReadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, signedIn, attempt]);

  const keysRead = ownKeys !== undefined;
  // The models are read once the keys are, and again at every answer of a save or removal, a replacement included, since the service offers fast versions by the organization of the Anthropic key the agents run on.
  useEffect(() => {
    if (!signedIn || !keysRead) return;
    let live = true;
    // A catalog that could not be read is offered no longer, so the menu says so rather than offering one the keys may have changed.
    const failModels = () => {
      setModels(undefined);
      setModelsFailed(true);
    };
    act(ACT_KIND.CODING_AGENTS_MODELS).then(
      (answer) => {
        if (!live) return;
        if ("failure" in answer) failModels();
        else setModels(answer.models);
      },
      () => {
        if (live) failModels();
      },
    );
    return () => {
      live = false;
    };
  }, [act, signedIn, attempt, keysRead, keysAnswered]);

  const write = useCallback(
    (next: ModelChoice): Promise<ActionResult> => {
      setBusy(true);
      return act(ACT_KIND.CODING_AGENTS_DEFAULT_WRITE, next)
        .catch(() => undefined)
        .then((answer) => {
          setBusy(false);
          if (answer === undefined || "failure" in answer) return WRITE_REFUSED;
          setChoice(answer.choice);
          return WRITE_ACCEPTED;
        });
    },
    [act],
  );

  return (
    <SettingsSection title="Default model">
      {!signedIn ? (
        <SettingsLine>{PAGE_LINE.SIGNED_OUT}</SettingsLine>
      ) : choice !== undefined && (models !== undefined || modelsFailed) ? (
        <DefaultRows
          choice={choice}
          models={models}
          ownKeys={ownKeys ?? new Map()}
          busy={busy}
          onChange={write}
        />
      ) : readFailed ? (
        <SettingsLine>
          <ErrorState onRetry={() => setAttempt((count) => count + 1)}>
            {PAGE_LINE.FAILED}
          </ErrorState>
        </SettingsLine>
      ) : (
        <SettingsRowsSkeleton label="Loading your default" rows={DEFAULT_SKELETON_ROWS} />
      )}
    </SettingsSection>
  );
}

/**
 * The Default model and API keys groups, over the keys the API keys group
 * holds: the model row's note says which provider runs on the account's own
 * key, so it reads them from the group that changes them rather than from a
 * read of its own that a save below would leave behind.
 */
export function CodingAgentsPage({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const [ownKeys, setOwnKeys] = useState<ReadonlyMap<ModelProvider, ProviderKeyStatus>>();
  const [keysAnswered, setKeysAnswered] = useState(0);
  const onKeys = useCallback((keys: readonly ProviderKeySummary[]) => {
    setOwnKeys(new Map(keys.map((key) => [key.provider, key.status])));
    setKeysAnswered((count) => count + 1);
  }, []);
  return (
    <>
      <CodingAgentsSection signedIn={signedIn} ownKeys={ownKeys} keysAnswered={keysAnswered} />
      <ApiKeysSection signedIn={signedIn} onKeys={onKeys} />
    </>
  );
}
