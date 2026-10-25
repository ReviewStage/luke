import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, remedyLabel, retriesBesideRemedy } from "@luke/features/failure-remedy";
import type { ModelChoice } from "@luke/features/models-wire";
import { EXPERIMENT } from "@luke/settings";
import {
  ERROR_STATE_PLACEMENT,
  ErrorState,
  PlayIcon,
  POPOVER_ALIGN,
  POPOVER_WIDTH,
  SplitButton,
} from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useEffect, useId, useRef, useState } from "react";
import { choiceLabel } from "../tasks/coding-agent-model.js";
import { ModelMenu, RUN_ON, type RunOn, settledChoice } from "../tasks/model-menu.js";
import { useRepositoryRemedy } from "../tasks/repository-remedy.js";
import type { CodingAgentsControl } from "../tasks/use-coding-agents.js";
import { useExperiment } from "../use-app-state.js";

/**
 * start-agent-button.tsx -- the task toolbar's Start: a split button that starts a coding agent on the task.
 *
 * The main part starts a new agent on the account's default model and
 * effort, and says which on hover: "Opus 5.5 High Fast". The chevron drops
 * the shared model menu (`../tasks/model-menu.tsx`), the default checked; what the menu chooses is what
 * the main part then starts on while
 * the plan's tab stays open (the button is drawn afresh for each task and
 * each return to its plan, so a pick never outlives the Start it was made
 * for by much), and is never kept as the account's default, which only
 * Settings changes. While local agents are on and the service offers this
 * Mac, the menu's Run on picks Cloud or This Mac, the cloud by default, and
 * a Start on This Mac says the Mac's name on hover after the model and asks
 * the service to run the agent there. The models and the default are read as the
 * button mounts and again as the menu opens, so the menu shows the catalog
 * as it stands and the default as Settings last wrote it. A
 * task with no repository has nothing for an agent to check out, so Start
 * is unavailable and says why on hover instead. The menu closes on a pick,
 * on Escape, on a press of the main part, and on focus leaving the button;
 * Escape stops there, so it closes the menu and not the task behind it.
 * In a toolbar short of room the main part draws its glyph alone, named
 * still, its hover saying the model as before (desktop.css's `plan-toolbar`).
 * The split button itself, its two halves and their states, is `@luke/ui`'s
 * `SplitButton`.
 */

export function StartAgentButton({ control }: { control: CodingAgentsControl }): React.JSX.Element {
  const { start } = control;
  const repositoryRemedy = useRepositoryRemedy();
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const [choice, setChoice] = useState<ModelChoice | undefined>(undefined);
  /** What the menu picked, which Start runs on in place of the default; nothing until a pick. */
  const [picked, setPicked] = useState<ModelChoice | undefined>(undefined);
  /** Where the menu's Run on said to start, the cloud until This Mac is picked. */
  const [runOn, setRunOn] = useState<RunOn>(RUN_ON.CLOUD);
  const localAgents = useExperiment(EXPERIMENT.LOCAL_AGENTS);
  const menuId = useId();
  const chevron = useRef<HTMLButtonElement>(null);
  const latest = useRef(control);
  latest.current = control;

  // The models and the default are read as the button mounts, for its hover
  // line, and again as the menu opens, so the menu lands on the default as
  // it stands now; what was read before stands until the new read lands.
  useEffect(() => {
    let live = true;
    latest.current.readModels();
    latest.current.readDefault().then((answer) => {
      if (live && !("failure" in answer)) setChoice(answer.choice);
    });
    return () => {
      live = false;
    };
  }, [open]);

  // Note that we hand focus back to the chevron, as a native menu returns it
  // to its trigger, because closing takes the focused field away with it.
  const close = () => {
    setOpen(false);
    chevron.current?.focus();
  };

  const models = control.models;
  // Note that Run on is offered only while local agents are on and the service offers this Mac, so
  // a Mac that went away, or the experiment turned off, starts in the cloud whatever was picked.
  const mac = localAgents ? control.thisMac : undefined;
  const onMac = mac !== undefined && runOn === RUN_ON.THIS_MAC;
  // A default effort the model no longer lists falls to the model's first.
  const chosen = settledChoice(models, picked ?? choice);
  const unavailable = !start.available;

  const press = () => {
    setOpen(false);
    if (unavailable || start.busy) return;
    // Note that only a pick names its choice; with none the service runs the default as it holds it.
    // A pick the catalog no longer settles is sent as picked, so the service refuses it rather than
    // the agent quietly running on the default.
    start.onPress(
      picked === undefined ? undefined : (chosen ?? picked),
      onMac ? CODING_AGENT_MACHINE.MAC : undefined,
    );
  };

  const modelHint =
    models !== undefined && chosen !== undefined ? choiceLabel(chosen, models) : undefined;
  const hint =
    start.reason ??
    (modelHint !== undefined && mac !== undefined && onMac
      ? `${modelHint} on ${mac.name}`
      : modelHint);

  const note = start.note;
  const remedyWords = note === undefined ? undefined : remedyLabel(note);
  const remedy = note === undefined ? undefined : repositoryRemedy(note, () => press());
  return (
    <div className="start-agent relative flex items-center gap-control-gap">
      {note !== undefined ? (
        // Start itself is the retry of a plain refusal; a repository's remedy keeps Retry
        // beside it where it is finished elsewhere, and a move presses Start again by itself.
        <div className="start-agent-note flex min-w-0 max-w-half-container">
          <ErrorState
            placement={ERROR_STATE_PLACEMENT.TOOLBAR}
            remedy={
              remedyWords === undefined || remedy === undefined
                ? undefined
                : { label: remedyWords, onClick: remedy }
            }
            onRetry={
              note.reason !== FAILURE_REASON.OTHER &&
              (remedyWords === undefined || retriesBesideRemedy(note))
                ? () => press()
                : undefined
            }
          >
            {note.text}
          </ErrorState>
        </div>
      ) : null}
      <span className="start-agent-split flex">
        {/* A press of the main part closes the menu whether or not it starts anything: a refused
            press, busy or unavailable, never reaches `press`, so the split button hears every
            press but the chevron's, which toggles the menu itself (`onMainPress`). */}
        <SplitButton
          icon={<PlayIcon />}
          label="Start a coding agent"
          disabled={unavailable}
          busy={start.busy}
          busyLabel="Starting"
          succeeded={start.succeeded}
          hintLabel={hint}
          onClick={press}
          onMainPress={() => setOpen(false)}
          menu={{
            label: "Choose a model to start with",
            "aria-haspopup": "dialog",
            "aria-expanded": open,
            "aria-controls": open ? menuId : undefined,
            ref: chevron,
            onClick: () => setOpen(!open),
          }}
        >
          Start
        </SplitButton>
      </span>
      {drawn.mounted ? (
        <ModelMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          align={POPOVER_ALIGN.END}
          width={POPOVER_WIDTH.NARROW}
          models={models}
          failed={control.modelsFailed}
          onRetry={control.readModels}
          chosen={chosen}
          startsNew
          runOn={mac === undefined ? undefined : { mac, value: runOn, onChoose: setRunOn }}
          onChoose={setPicked}
          onClose={close}
          onLeave={(left) => {
            // Focus moving within the menu, or to the chevron whose own press toggles it, keeps it open.
            const kept = [document.getElementById(menuId), chevron.current].some(
              (part) => left instanceof Node && part?.contains(left) === true,
            );
            if (!kept) setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
