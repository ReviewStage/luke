import { CONTEXT_WINDOW } from "@sidecar/hosted/coding-agent-wire";
import {
  type CatalogModel,
  MODEL_PROVIDER,
  type ModelChoice,
  type ModelProvider,
} from "@sidecar/hosted/models-wire";
import { PROVIDER_KEY_STATUS, type ProviderKeyStatus } from "@sidecar/hosted/provider-key-wire";
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
import { PickerRow } from "./picker-row";

/**
 * coding-agents-page.tsx -- Settings › Coding agents: the model and effort a click on Start runs an agent on.
 *
 * The one value is the account's, kept on the service beside the settings
 * preferences and written by this page and by a Start that named a model
 * alike, so the page reads it afresh as it opens and shows what the last
 * Start wrote. The model row is the same picker every settings row uses,
 * searched because the catalog is long: each base model under the mark
 * of the harness that runs it, the newest first within each provider, every fast
 * version folded into its model, the chosen one checked. Under it a Fast
 * switch runs the model's fast version, resting where the model has none;
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
 * What the model row says under its name: that the default runs on the
 * account's own key where the provider last accepted it, and that the key
 * needs a hand where it did not, since such a key fails the agent's steps
 * rather than letting them fall back to Luke's.
 */
function modelRowNote(
  provider: ModelProvider | undefined,
  status: ProviderKeyStatus | undefined,
): string {
  const plain = "What a click on Start runs an agent on.";
  if (provider === undefined || status === undefined) return plain;
  const name = PROVIDER_NAME[provider];
  return status === PROVIDER_KEY_STATUS.VERIFIED
    ? `What a click on Start runs an agent on, on your own ${name} key.`
    : `${plain} Your ${name} key needs attention in Settings › API keys.`;
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
  // The stored effort stands alone until the catalog is read, and where the catalog has
  // stopped offering the stored model, so the row never draws nothing.
  const offered = models === undefined ? [] : effortsOf(models, choice.model);
  const efforts = offered.length === 0 ? [choice.effort] : offered;
  const read = readModelChoice(models ?? [], choice.model);
  const base = offeredModels(models ?? []).find((each) => each.model.id === read.base);
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
        copy={
          <>
            <strong>Default model</strong>
            <small>{modelRowNote(listed?.provider, ownKey)}</small>
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
          <small>
            {base !== undefined && base.fast === undefined
              ? `No fast version of ${modelLabel(base.model.id, models)}.`
              : "Run the model's fast version."}
          </small>
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
          <strong>Default effort</strong>
          <small>How hard the model thinks.</small>
        </span>
        <fieldset
          className="settings-segments"
          {...searchAnchorProps(SETTINGS_SEARCH_ROW.CODING_AGENT_EFFORT)}
        >
          <legend className="visually-hidden">Default effort</legend>
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
            <strong>Default context</strong>
            <small>{longWindowNote(windows)}</small>
          </span>
          <fieldset className="settings-segments">
            <legend className="visually-hidden">Default context</legend>
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

export function CodingAgentsSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const { act } = useAct();
  const [choice, setChoice] = useState<ModelChoice | undefined>(undefined);
  const [models, setModels] = useState<readonly CatalogModel[] | undefined>(undefined);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [ownKeys, setOwnKeys] = useState<ReadonlyMap<ModelProvider, ProviderKeyStatus>>(new Map());

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
    // Which providers run on the account's own key, for the model row's note; a read that fails says nothing.
    setOwnKeys(new Map());
    act(ACT_KIND.PROVIDER_KEYS_READ).then(
      (answer) => {
        if (live && !("failure" in answer))
          setOwnKeys(new Map(answer.keys.map((key) => [key.provider, key.status])));
      },
      () => undefined,
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
    <section className="settings-section settings-plain">
      {!signedIn ? (
        <p className="settings-note">{PAGE_LINE.SIGNED_OUT}</p>
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
        <>
          <p className="error-message" role="alert">
            {PAGE_LINE.FAILED}
          </p>
          <RetryButton onRetry={() => setAttempt((count) => count + 1)} />
        </>
      ) : (
        <SpinnerRegion label="Loading your default" />
      )}
    </section>
  );
}
