import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import { CheckIcon, PopUpIcon } from "@sidecar/panel";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { effortsOf, modelLabel } from "../planning/coding-agent-model";
import { ModelProviderMark } from "../provider-marks";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";

/**
 * coding-agents-page.tsx -- Settings › Coding agents: the model and effort a click on Start runs an agent on.
 *
 * The one value is the account's, kept on the service beside the settings
 * preferences and written by this page and by a Start that named a model
 * alike, so the page reads it afresh as it opens and shows what the last
 * Start wrote. The model row drops the same menu the Start button does,
 * each model under its provider's mark, because a pop-up of the system's
 * cannot draw a mark; the effort row offers the efforts the chosen model
 * lists. A write is one ask of the service, the row resting until it
 * answers and a refusal worded under it. With no account signed in there
 * is no default to show, and the page says so.
 */

const MENU_ITEM = "[role=menuitem]";

/** What the page says while it reads, while it cannot, and with no account. */
const PAGE_LINE = {
  READING: "Reading your default…",
  FAILED: "The default could not be read. Try again.",
  SIGNED_OUT: "Sign in to choose the model your coding agents run on.",
  WRITE_FAILED: "The default could not be saved. Try again.",
} as const;

/** The model row's menu: the models under their marks, the chosen one checked. */
function ModelMenu({
  models,
  chosen,
  onPick,
  onClose,
  onLeave,
  menuId,
}: {
  models: readonly CatalogModel[] | undefined;
  chosen: string;
  onPick: (model: CatalogModel) => void;
  onClose: () => void;
  /** Focus left the menu for somewhere outside its row. */
  onLeave: (left: EventTarget | null) => void;
  menuId: string;
}): React.JSX.Element {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, []);
  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM)];
    if (rows.length === 0) return;
    event.preventDefault();
    const focused = rows.find((row) => row === document.activeElement);
    const at = focused === undefined ? -1 : rows.indexOf(focused);
    const next =
      at === -1
        ? event.key === "ArrowDown"
          ? 0
          : rows.length - 1
        : (at + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
    rows[next]?.focus();
  };
  return (
    <div
      ref={menu}
      id={menuId}
      className="plan-compose-menu settings-model-menu"
      role="menu"
      aria-label="Default model"
      onKeyDown={onKey}
      onBlur={(event) => onLeave(event.relatedTarget)}
    >
      {models === undefined ? (
        <p className="plan-compose-menu-note">Reading the models…</p>
      ) : (
        models.map((model) => (
          <button
            key={model.id}
            type="button"
            role="menuitem"
            className="plan-compose-menu-row"
            aria-current={model.id === chosen ? "true" : undefined}
            onClick={() => onPick(model)}
          >
            <ModelProviderMark provider={model.provider} />
            <span className="plan-compose-menu-name">{model.name}</span>
            {model.id === chosen ? <CheckIcon /> : null}
          </button>
        ))
      )}
    </div>
  );
}

/** The page's rows, over the default as read: the model's menu and the effort's choices. */
function DefaultRows({
  choice,
  models,
  busy,
  onChange,
}: {
  choice: ModelChoice;
  models: readonly CatalogModel[] | undefined;
  busy: boolean;
  onChange: (choice: ModelChoice) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const row = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listed = models?.find((model) => model.id === choice.model);
  const efforts = models === undefined ? [choice.effort] : effortsOf(models, choice.model);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <div className="settings-row" ref={row}>
        <span className="settings-copy">
          <strong>Default model</strong>
          <small>What a click on Start runs an agent on.</small>
        </span>
        <span className="settings-model">
          <button
            ref={trigger}
            type="button"
            className="plan-compose-chip settings-model-chip"
            {...searchAnchorProps(SETTINGS_SEARCH_ROW.CODING_AGENT_MODEL)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            disabled={busy}
            onClick={() => setOpen(!open)}
          >
            {listed !== undefined ? <ModelProviderMark provider={listed.provider} /> : null}
            <span className="plan-compose-chip-name">{modelLabel(choice.model, models)}</span>
            <span className="voice-select-badge settings-model-badge" aria-hidden="true">
              <PopUpIcon />
            </span>
          </button>
          {open ? (
            <ModelMenu
              menuId={menuId}
              models={models}
              chosen={choice.model}
              onClose={close}
              onLeave={(left) => {
                if (!(left instanceof Node && row.current?.contains(left))) setOpen(false);
              }}
              onPick={(model) => {
                close();
                // A model keeps the effort it lists too; otherwise its first.
                const effort = model.efforts.includes(choice.effort)
                  ? choice.effort
                  : (model.efforts[0] ?? choice.effort);
                onChange({ model: model.id, effort });
              }}
            />
          ) : null}
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>Default effort</strong>
          <small>How hard the model thinks.</small>
        </span>
        <fieldset
          className="start-agent-efforts settings-efforts"
          {...searchAnchorProps(SETTINGS_SEARCH_ROW.CODING_AGENT_EFFORT)}
        >
          <legend className="visually-hidden">Default effort</legend>
          {efforts.map((effort) => (
            <button
              key={effort}
              type="button"
              className="start-agent-effort"
              aria-pressed={effort === choice.effort}
              disabled={busy}
              onClick={() => {
                if (effort !== choice.effort) onChange({ model: choice.model, effort });
              }}
            >
              {effort}
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
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  // The page opening reads the default the service holds now, which a Start may just have written, and the models beside it.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setReadFailed(false);
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
        if (live && !("failure" in answer)) setModels(answer.models);
      },
      () => undefined,
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
          <DefaultRows choice={choice} models={models} busy={busy} onChange={write} />
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
            className="plan-button"
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
