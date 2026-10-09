import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import { CheckIcon, ChevronDownIcon, PlayIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";
import { effortsOf, modelLabel } from "../planning/coding-agent-model";
import type { CodingAgentsControl } from "../planning/use-coding-agents";
import { ModelProviderMark } from "../provider-marks";
import { Tooltip } from "../tooltip";

/**
 * start-agent-button.tsx -- the plan toolbar's Start: a split button that starts a coding agent on the plan.
 *
 * The main part starts one on the account's default model and effort, and
 * names neither. The chevron drops a menu of the models the service
 * offers, each row under its provider's mark, the efforts the chosen model
 * lists below them, and one press that starts with that choice, which the
 * service also keeps as the account's default. The menu reads the models
 * and the default as it opens, so it shows the catalog as it stands and the
 * default the last Start wrote. A plan with no repository has nothing for
 * an agent to check out, so Start is unavailable and says why on hover.
 * The menu closes on a choice, on Escape, and on focus leaving it; Escape
 * stops here, so it closes the menu and not the plan behind it.
 */

const MENU_ITEM = "[role=menuitem]";

/** The efforts a chosen model lists, as one group of choices of which one is pressed. */
function EffortChoice({
  efforts,
  chosen,
  onChoose,
}: {
  efforts: readonly string[];
  chosen: string | undefined;
  onChoose: (effort: string) => void;
}): React.JSX.Element {
  return (
    <fieldset className="start-agent-efforts">
      <legend className="visually-hidden">Effort</legend>
      {efforts.map((effort) => (
        <button
          key={effort}
          type="button"
          aria-pressed={effort === chosen}
          className="start-agent-effort"
          onClick={() => onChoose(effort)}
        >
          {effort}
        </button>
      ))}
    </fieldset>
  );
}

/** One model in the menu: its provider's mark, its name, and a check where it is the one chosen. */
function ModelRow({
  model,
  chosen,
  onPick,
}: {
  model: CatalogModel;
  chosen: boolean;
  onPick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className="plan-compose-menu-row"
      aria-current={chosen ? "true" : undefined}
      onClick={onPick}
    >
      <ModelProviderMark provider={model.provider} />
      <span className="plan-compose-menu-name">{model.name}</span>
      {chosen ? <CheckIcon /> : null}
    </button>
  );
}

export function StartAgentButton({ control }: { control: CodingAgentsControl }): React.JSX.Element {
  const { start } = control;
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ModelChoice | undefined>(undefined);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const chevron = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const latest = useRef(control);
  latest.current = control;

  // The menu opening reads the models and the default, and lands on the default.
  useEffect(() => {
    if (!open) return;
    let live = true;
    latest.current.readModels();
    latest.current.readDefault().then((answer) => {
      if (live && !("failure" in answer)) setChoice(answer.choice);
    });
    return () => {
      live = false;
    };
  }, [open]);

  // The menu opens with its first row focused, as a native menu does.
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [open]);

  // Note that we hand focus back to the chevron, as a native menu returns it
  // to its trigger, because closing takes the focused row away with it.
  const close = () => {
    setOpen(false);
    chevron.current?.focus();
  };

  const onMenuKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
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

  const models = control.models;
  const efforts =
    models !== undefined && choice !== undefined ? effortsOf(models, choice.model) : [];
  // A chosen effort the model does not list, or none yet, falls to the model's first.
  const effort = efforts.includes(choice?.effort ?? "") ? choice?.effort : efforts[0];
  const chosen: ModelChoice | undefined =
    choice !== undefined && effort !== undefined ? { model: choice.model, effort } : undefined;
  const label = start.busy ? "Starting…" : "Start";
  const unavailable = !start.available;

  const press = (named?: ModelChoice) => {
    if (unavailable || start.busy) return;
    start.onPress(named);
  };

  const main = (
    <button
      type="button"
      className="toolbar-button start-agent-main"
      aria-disabled={unavailable || start.busy ? "true" : undefined}
      aria-label="Start a coding agent"
      onClick={() => press()}
    >
      <PlayIcon />
      {label}
    </button>
  );

  return (
    <div className="start-agent" ref={root} data-unavailable={String(unavailable)}>
      {start.note !== undefined ? (
        <p className="desktop-toolbar-note" role="alert">
          {start.note}
        </p>
      ) : null}
      <div className="start-agent-split">
        {start.reason !== undefined ? <Tooltip label={start.reason}>{main}</Tooltip> : main}
        <button
          ref={chevron}
          type="button"
          className="toolbar-button toolbar-icon-button start-agent-chevron"
          aria-label="Choose a model to start with"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-disabled={unavailable ? "true" : undefined}
          onClick={() => {
            if (unavailable) return;
            setOpen(!open);
          }}
        >
          <ChevronDownIcon />
        </button>
      </div>
      {open ? (
        <div
          ref={menu}
          id={menuId}
          className="plan-compose-menu start-agent-menu"
          role="menu"
          aria-label="Model"
          onKeyDown={onMenuKey}
          onBlur={(event) => {
            if (!root.current?.contains(event.relatedTarget)) setOpen(false);
          }}
        >
          <p className="plan-compose-menu-heading">Model</p>
          {models === undefined ? (
            <p className="plan-compose-menu-note">Reading the models…</p>
          ) : (
            models.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                chosen={model.id === choice?.model}
                onPick={() => setChoice({ model: model.id, effort: choice?.effort ?? "" })}
              />
            ))
          )}
          {models !== undefined && models.length === 0 ? (
            <p className="plan-compose-menu-note">No models are offered right now.</p>
          ) : null}
          {chosen !== undefined ? (
            <>
              <hr />
              <p className="plan-compose-menu-heading">Effort</p>
              <EffortChoice
                efforts={efforts}
                chosen={chosen.effort}
                onChoose={(picked) => setChoice({ model: chosen.model, effort: picked })}
              />
              <button
                type="button"
                role="menuitem"
                className="plan-compose-menu-row start-agent-with"
                onClick={() => {
                  close();
                  press(chosen);
                }}
              >
                <PlayIcon />
                <span className="plan-compose-menu-name">
                  Start with {modelLabel(chosen.model, models)} · {chosen.effort}
                </span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
