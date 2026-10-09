import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useCallback, useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import {
  choiceModelId,
  effortFor,
  effortLabel,
  effortsOf,
  FAST_WORD,
  modelLabel,
  offeredModels,
  readModelChoice,
} from "../planning/coding-agent-model";
import { ModelProviderMark } from "../provider-marks";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import { PickerRow } from "./picker-row";

/**
 * coding-agents-page.tsx -- Settings › Coding agents: the model and effort a click on Start runs an agent on.
 *
 * The one value is the account's, kept on the service beside the settings
 * preferences and written by this page and by a Start that named a model
 * alike, so the page reads it afresh as it opens and shows what the last
 * Start wrote. The model row is the same picker every settings row uses,
 * searched because the catalog is long: each base model under its
 * provider's mark, the newest first within each provider, every fast
 * version folded into its model, the chosen one checked. Under it a Fast
 * switch runs the model's fast version, resting where the model has none;
 * the stored id is the catalog's own, the fast version's where the switch
 * is on. The effort row is a segmented control over the efforts the chosen
 * model lists. A write is one ask of the service, the rows resting until
 * it answers and a refusal worded under them. With no account signed in
 * there is no default to show, and the page says so.
 */

/** What the page says while it reads, while it cannot, and with no account. */
const PAGE_LINE = {
  READING: "Reading your default…",
  FAILED: "The default could not be read. Try again.",
  MODELS_READING: "Reading the models…",
  MODELS_FAILED: "The models could not be read. Open Settings again to try again.",
  MODELS_NONE_MATCH: "No models match.",
  SIGNED_OUT: "Sign in to choose the model your coding agents run on.",
  WRITE_FAILED: "The default could not be saved. Try again.",
} as const;

/** The page's rows, over the default as read: the model's picker and the effort's segments. */
function DefaultRows({
  choice,
  models,
  modelsFailed,
  busy,
  onChange,
}: {
  choice: ModelChoice;
  models: readonly CatalogModel[] | undefined;
  modelsFailed: boolean;
  busy: boolean;
  onChange: (choice: ModelChoice) => void;
}): React.JSX.Element {
  const listed = models?.find((model) => model.id === choice.model);
  // The stored effort stands alone until the catalog is read, and where the catalog has
  // stopped offering the stored model, so the row never draws nothing.
  const offered = models === undefined ? [] : effortsOf(models, choice.model);
  const efforts = offered.length === 0 ? [choice.effort] : offered;
  const read = readModelChoice(models ?? [], choice.model);
  const base = offeredModels(models ?? []).find((each) => each.model.id === read.base);
  /** The choice at a catalog id, at the stored effort where the model lists it, else its first. */
  const choiceAt = (modelId: string): ModelChoice => ({
    model: modelId,
    effort: effortFor(effortsOf(models ?? [], modelId), choice.effort) ?? choice.effort,
  });
  return (
    <>
      <PickerRow
        label="Default model"
        copy={
          <>
            <strong>Default model</strong>
            <small>What a click on Start runs an agent on.</small>
          </>
        }
        value={read.base}
        valueLabel={modelLabel(read.base, models)}
        valueIcon={listed !== undefined ? <ModelProviderMark provider={listed.provider} /> : null}
        rows={
          models === undefined
            ? []
            : offeredModels(models).map(({ model }) => ({
                id: model.id,
                label: model.name,
                icon: <ModelProviderMark provider={model.provider} />,
                terms: [model.provider],
              }))
        }
        placeholder="Search models"
        noMatch={PAGE_LINE.MODELS_NONE_MATCH}
        note={
          models === undefined ? (
            <span role={modelsFailed ? "alert" : undefined}>
              {modelsFailed ? PAGE_LINE.MODELS_FAILED : PAGE_LINE.MODELS_READING}
            </span>
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
              ? `No fast version of ${base.model.name}.`
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
                if (effort !== choice.effort) onChange({ model: choice.model, effort });
              }}
            >
              {effortLabel(effort)}
            </button>
          ))}
        </fieldset>
      </div>
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
    <section
      className="settings-section settings-plain"
      style={cssCustomProperties({ "--row-index": 1 })}
    >
      {!signedIn ? (
        <p className="settings-note">{PAGE_LINE.SIGNED_OUT}</p>
      ) : choice !== undefined ? (
        <>
          <DefaultRows
            choice={choice}
            models={models}
            modelsFailed={modelsFailed}
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
          <button
            type="button"
            className="toolbar-button"
            onClick={() => setAttempt((count) => count + 1)}
          >
            Try again
          </button>
        </>
      ) : (
        <p className="settings-note" aria-busy="true">
          {PAGE_LINE.READING}
        </p>
      )}
    </section>
  );
}
