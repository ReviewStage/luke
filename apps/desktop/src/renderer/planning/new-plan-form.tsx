import { BackIcon } from "@sidecar/panel";
import { useId, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { folderLine, githubFailureNote } from "./planning-model";

/**
 * new-plan-form.tsx -- the Plans tab's new-plan page: the plan's name and the folder on this Mac it plans against.
 *
 * Ordinary setup fields and nothing spoken: nothing typed here reaches the
 * model as conversation. Choose folder opens the system's folder picker, and
 * the planning model's commands run in that folder for the plan's whole life.
 * Start plan asks the host to start the plan; a refusal keeps the page open
 * with the reason, and the button can be pressed again. Escape and Back
 * return to the list, the first through the panel's own Escape ladder.
 */

/** Everything the page draws, handed in whole so the layout decides nothing. */
export interface NewPlanFormViewProps {
  name: string;
  /** The chosen folder's absolute path; nothing until one is chosen. */
  folder: string | undefined;
  starting: boolean;
  /** Why the last Start plan or Choose folder press did not land, in the page's words. */
  note: string | undefined;
  onName: (name: string) => void;
  onChooseFolder: () => void;
  onStart: () => void;
  onCancel: () => void;
}

export function NewPlanFormView(props: NewPlanFormViewProps): React.JSX.Element {
  const titleId = useId();
  const canStart = props.name.trim().length > 0 && props.folder !== undefined && !props.starting;
  return (
    <section className="plan-new" aria-labelledby={titleId}>
      <header className="plan-header">
        <button
          type="button"
          className="icon-button plan-back"
          aria-label="Back to plans"
          title="Back"
          onClick={props.onCancel}
        >
          <BackIcon />
        </button>
        <h1 id={titleId} className="plan-title">
          New plan
        </h1>
      </header>
      <form
        className="plan-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canStart) props.onStart();
        }}
      >
        <label className="plan-form-name">
          <span>Plan name</span>
          <input
            type="text"
            value={props.name}
            placeholder="e.g. Dark mode toggle"
            maxLength={200}
            onChange={(event) => props.onName(event.currentTarget.value)}
          />
        </label>
        <div className="plan-form-folder">
          <span>Folder</span>
          {props.folder !== undefined ? (
            <p className="plan-form-note">{folderLine(props.folder)}</p>
          ) : null}
          <button type="button" className="plan-button" onClick={props.onChooseFolder}>
            {props.folder === undefined ? "Choose folder…" : "Change folder…"}
          </button>
        </div>
        {props.note !== undefined ? (
          <p className="plan-form-note" role="alert">
            {props.note}
          </p>
        ) : null}
        <div className="plan-form-actions">
          <button type="button" className="plan-button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="plan-button plan-button-primary" disabled={!canStart}>
            {props.starting ? "Starting…" : "Start plan"}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * The page with its own state: the fields, and the Choose folder and Start
 * plan presses. `onStarted` closes it once the host says the plan started,
 * which is also when the new plan becomes the active one.
 */
export function NewPlanForm({
  onStarted,
  onCancel,
}: {
  onStarted: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const [name, setName] = useState("");
  const [folder, setFolder] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);

  // A cancelled picker keeps whichever folder was already chosen.
  const chooseFolder = () => {
    setNote(undefined);
    act(ACT_KIND.PLANNING_CHOOSE_FOLDER).then(
      (chosen) => {
        if (chosen !== null) setFolder(chosen);
      },
      (refused: Error) => setNote(refused.message),
    );
  };

  const start = () => {
    if (folder === undefined) return;
    setStarting(true);
    setNote(undefined);
    act(ACT_KIND.PLANNING_START, { name, folderPath: folder })
      .then(
        (answer) => {
          if ("failure" in answer) setNote(githubFailureNote(answer.failure));
          else onStarted();
        },
        (refused: Error) => setNote(refused.message),
      )
      .finally(() => setStarting(false));
  };

  return (
    <NewPlanFormView
      name={name}
      folder={folder}
      starting={starting}
      note={note}
      onName={setName}
      onChooseFolder={chooseFolder}
      onStart={start}
      onCancel={onCancel}
    />
  );
}
