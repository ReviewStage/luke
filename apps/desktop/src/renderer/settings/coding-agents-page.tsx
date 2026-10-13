import { CONTEXT_WINDOW } from "@sidecar/hosted/coding-agent-wire";
import {
  type CatalogModel,
  MODEL_PROVIDER,
  type ModelChoice,
  type ModelProvider,
} from "@sidecar/hosted/models-wire";
import {
  PROVIDER_KEY_STATUS,
  type ProviderKeyStatus,
  type ProviderKeySummary,
} from "@sidecar/hosted/provider-key-wire";
import { useCallback, useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import {
  choiceModelId,
  choiceOn,
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
} from "../planning/coding-agent-model";
import { HarnessMark } from "../provider-marks";
import { RetryButton } from "../retry-button";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import { Spinner, SpinnerRegion } from "../spinner";
import { ApiKeysSection } from "./api-keys-section";
import { PickerRow } from "./picker-row";
import { SettingsGroup } from "./settings-group";

/**
 * coding-agents-page.tsx -- Settings › Coding agents: the model and effort a click on Start runs an agent on.
 *
 * The page is three groups under their own headings: this file's Default
 * model, then the account's own API keys (`api-keys-section.tsx`) and the
 * notification as an agent ends (`notifications-section.tsx`), drawn by the
 * panel in that order. The first two share the one read of the keys, so a
 * key saved or removed below is what the model row says at once. The default model's one value is the account's, kept
 * on the service beside the settings preferences and written by this page
 * and by a Start that named a model alike, so the page reads it afresh as it
 * opens and shows what the last Start wrote. The model row is the same picker every settings row uses,
 * searched because the catalog is long: each base model under the mark
 * of the harness that runs it, the newest first within each provider, every fast
 * version folded into its model, the chosen one checked. Under it a Fast
 * switch runs the model's fast version, resting where the model has none
 * or the service withholds it for the account's own key, saying which;
 * the stored id is the catalog's own, the fast version's where the switch
 * is on. The effort row is a segmented control over the efforts the chosen
 * model lists, and for a model that offers two context windows a context
 * row is one over the two, the whole window the default, saying what it
 * costs past the standard one; a change of model keeps the standard window
 * where the next model offers two. A write is one ask of the service, the rows resting until
 * it answers and a refusal worded under them. With no account signed in
 * there is no default to show, and the page says so.
 */

/** What the page says while it cannot read or write, and with no account. */
const PAGE_LINE = {
  FAILED: "The default could not be read.",
  MODELS_FAILED: "The models could not be read. Open Settings again to try again.",
  MODELS_NONE_MATCH: "No models match.",
  SIGNED_OUT: "Sign in to choose the model your coding agents run on.",
  WRITE_FAILED: "The default could not be saved. Try again.",
} as const;

/** A provider as the model row names the key it runs on. */
const PROVIDER_NAME = {
  [MODEL_PROVIDER.ANTHROPIC]: "Anthropic",
  [MODEL_PROVIDER.OPENAI]: "OpenAI",
} as const satisfies Record<ModelProvider, string>;

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
    : `Your ${name} key needs attention under API keys.`;
}

/** The page's rows, over the default as read: the model's picker and the effort's segments. */
function DefaultRows({
  choice,
  models,
  modelsFailed,
  ownKeys,
  busy,
  onChange,
}: {
  choice: ModelChoice;
  models: readonly CatalogModel[] | undefined;
  modelsFailed: boolean;
  /** How each provider the account holds a key of its own for last answered it. */
  ownKeys: ReadonlyMap<ModelProvider, ProviderKeyStatus>;
  busy: boolean;
  onChange: (choice: ModelChoice) => void;
}): React.JSX.Element {
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
        copy={
          <>
            <strong>Model</strong>
            {note === undefined ? null : <small>{note}</small>}
          </>
        }
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
          models === undefined ? (
            modelsFailed ? (
              <span role="alert">{PAGE_LINE.MODELS_FAILED}</span>
            ) : (
              <div className="plan-compose-menu-note">
                <Spinner label="Loading models" />
              </div>
            )
          ) : undefined
        }
        anchor={SETTINGS_SEARCH_ROW.CODING_AGENT_MODEL}
        disabled={busy}
        onPick={(id) => {
          // The pick keeps Fast where the model has a fast version, and drops it where it has none.
          const picked = offeredModels(models ?? []).find((each) => each.model.id === id);
          if (picked === undefined) return;
          onChange(choiceAt(choiceModelId(picked, read.fast)));
        }}
      />
      <div className="settings-row">
        <span className="settings-copy">
          <strong>{FAST_WORD}</strong>
          {fastNote === undefined ? null : <small>{`${fastNote}.`}</small>}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={read.fast}
          aria-label={FAST_WORD}
          className="switch"
          {...searchAnchorProps(SETTINGS_SEARCH_ROW.CODING_AGENT_FAST)}
          disabled={busy || base?.fast === undefined}
          onClick={() => {
            if (base !== undefined) onChange(choiceAt(choiceModelId(base, !read.fast)));
          }}
        >
          <span className="switch-thumb" />
        </button>
      </div>
      {/* The segments wrap under the label where the row is narrow rather than clipping. */}
      <div className="settings-row settings-row-wrapping">
        <span className="settings-copy">
          <strong>Effort</strong>
        </span>
        <fieldset
          className="settings-segments"
          {...searchAnchorProps(SETTINGS_SEARCH_ROW.CODING_AGENT_EFFORT)}
        >
          <legend className="visually-hidden">Effort</legend>
          {efforts.map((effort) => (
            <button
              key={effort}
              type="button"
              className="settings-segment"
              aria-pressed={effort === choice.effort}
              disabled={busy}
              onClick={() => {
                if (effort !== choice.effort) onChange({ ...choice, effort });
              }}
            >
              {effortLabel(effort)}
            </button>
          ))}
        </fieldset>
      </div>
      {windows === undefined ? null : (
        <div className="settings-row settings-row-wrapping">
          <span className="settings-copy">
            <strong>Context</strong>
            <small>{longWindowNote(windows)}</small>
          </span>
          <fieldset className="settings-segments">
            <legend className="visually-hidden">Context</legend>
            {[
              { id: CONTEXT_WINDOW.STANDARD, tokens: windows.standardTokens },
              { id: CONTEXT_WINDOW.LONG, tokens: windows.longTokens },
            ].map((each) => (
              <button
                key={each.id}
                type="button"
                className="settings-segment"
                aria-pressed={each.id === window}
                disabled={busy}
                onClick={() => {
                  if (each.id !== window) onChange(choiceOn(models ?? [], choice, each.id));
                }}
              >
                {windowLabel(each.tokens)}
              </button>
            ))}
          </fieldset>
        </div>
      )}
    </>
  );
}

/** The Default model group: the model, Fast, effort, and context rows, or why they cannot be drawn. */
function CodingAgentsSection({
  signedIn,
  ownKeys,
}: {
  signedIn: boolean;
  /** How each provider the account holds a key of its own for last answered it, as the API keys group holds them. */
  ownKeys: ReadonlyMap<ModelProvider, ProviderKeyStatus>;
}): React.JSX.Element {
  const { act } = useAct();
  const [choice, setChoice] = useState<ModelChoice | undefined>(undefined);
  const [models, setModels] = useState<readonly CatalogModel[] | undefined>(undefined);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  // The page opening reads the default the service holds now, which a Start may just have written, and the models beside it.
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
    act(ACT_KIND.CODING_AGENTS_MODELS).then(
      (answer) => {
        if (!live) return;
        if ("failure" in answer) setModelsFailed(true);
        else setModels(answer.models);
      },
      () => {
        if (live) setModelsFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [act, signedIn, attempt]);

  const write = useCallback(
    (next: ModelChoice) => {
      setBusy(true);
      setRejection(undefined);
      act(ACT_KIND.CODING_AGENTS_DEFAULT_WRITE, next)
        .catch(() => undefined)
        .then((answer) => {
          setBusy(false);
          if (answer === undefined || "failure" in answer) {
            setRejection(PAGE_LINE.WRITE_FAILED);
            return;
          }
          setChoice(answer.choice);
        });
    },
    [act],
  );

  return (
    <SettingsGroup title="Default model">
      {!signedIn ? (
        <p className="settings-card-line settings-note">{PAGE_LINE.SIGNED_OUT}</p>
      ) : choice !== undefined ? (
        <>
          <DefaultRows
            choice={choice}
            models={models}
            modelsFailed={modelsFailed}
            ownKeys={ownKeys}
            busy={busy}
            onChange={write}
          />
          {rejection !== undefined ? (
            <p className="error-message" role="alert">
              {rejection}
            </p>
          ) : null}
        </>
      ) : readFailed ? (
        <div className="settings-card-line">
          <p className="error-message" role="alert">
            {PAGE_LINE.FAILED}
          </p>
          <RetryButton onRetry={() => setAttempt((count) => count + 1)} />
        </div>
      ) : (
        <div className="settings-card-line">
          <SpinnerRegion label="Loading your default" />
        </div>
      )}
    </SettingsGroup>
  );
}

/**
 * The Default model and API keys groups, over the keys the API keys group
 * holds: the model row's note says which provider runs on the account's own
 * key, so it reads them from the group that changes them rather than from a
 * read of its own that a save below would leave behind.
 */
export function CodingAgentsPage({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const [ownKeys, setOwnKeys] = useState<ReadonlyMap<ModelProvider, ProviderKeyStatus>>(new Map());
  const onKeys = useCallback((keys: readonly ProviderKeySummary[]) => {
    setOwnKeys(new Map(keys.map((key) => [key.provider, key.status])));
  }, []);
  return (
    <>
      <CodingAgentsSection signedIn={signedIn} ownKeys={ownKeys} />
      <ApiKeysSection signedIn={signedIn} onKeys={onKeys} />
    </>
  );
}
