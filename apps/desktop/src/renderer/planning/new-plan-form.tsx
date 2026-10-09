import { ArrowUpIcon } from "@sidecar/panel";
import { useEffect, useId, useRef, useState } from "react";
import { Tooltip } from "../tooltip";
import { CHIP_PLACE, RepositoryChip, type RepositoryChooser } from "./repository-chip";
import type { PlansControl } from "./use-plans-tab";

/**
 * new-plan-form.tsx -- the Plans tab's home: one composer that names a plan and the GitHub repository it is about.
 *
 * Drawn the way a devtool's new-task page is: a heading, and under it a card
 * holding the name and, along its foot, the repository chip and the round
 * start button. Ordinary setup fields and nothing spoken: nothing typed here
 * reaches the model as conversation. The repository starts on the one the
 * newest plan was about; the chip offers the other recent ones, a search
 * over every repository Luke reaches, and the page where the developer
 * chooses which ones Luke can see, and the planning model reads that
 * repository for the plan's whole life. A plan can start with none and be
 * given one later. Enter starts the plan; a refusal keeps the page with the
 * reason under the card, and the button can be pressed again.
 */

/** Everything the page draws, handed in whole so the layout decides nothing. */
interface NewPlanFormViewProps {
  name: string;
  /** The repository the plan is about, `owner/name`; null until one is chosen or used before. */
  repository: string | null;
  chooser: RepositoryChooser;
  starting: boolean;
  /** Why the last start did not land, in the page's words. */
  note: string | undefined;
  /** Counts the presses of New plan, so the name field takes focus on each. */
  focusRequest: number;
  onName: (name: string) => void;
  onRepository: (repository: string) => void;
  onStart: () => void;
}

function NewPlanFormView(props: NewPlanFormViewProps): React.JSX.Element {
  const titleId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const canStart = props.name.trim().length > 0 && !props.starting;
  const { focusRequest } = props;

  // Note that we focus on arrival as well as on each press of New plan,
  // because the page is the window's home and typing the name is its one job.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new request is what asks for focus.
  useEffect(() => {
    nameField.current?.focus();
  }, [focusRequest]);

  return (
    <section className="plan-compose" aria-labelledby={titleId}>
      <h1 id={titleId} className="plan-compose-title">
        What are we planning?
      </h1>
      <form
        className="plan-compose-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (canStart) props.onStart();
        }}
      >
        <input
          ref={nameField}
          type="text"
          className="plan-compose-name"
          aria-label="Plan name"
          value={props.name}
          placeholder="Name the feature, e.g. Dark mode toggle"
          maxLength={200}
          onChange={(event) => props.onName(event.currentTarget.value)}
        />
        <div className="plan-compose-foot">
          <RepositoryChip
            place={CHIP_PLACE.COMPOSER}
            value={props.repository}
            chooser={props.chooser}
            onChoose={props.onRepository}
          />
          <Tooltip label={props.starting ? "Starting…" : "Start plan"}>
            <button
              type="submit"
              className="plan-compose-start"
              aria-label="Start plan"
              aria-busy={props.starting}
              disabled={!canStart}
            >
              <ArrowUpIcon />
            </button>
          </Tooltip>
        </div>
      </form>
      {props.note !== undefined ? (
        <p className="plan-compose-note" role="alert">
          {props.note}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The page with its own state: the name, the repository chosen over the
 * last one used, and the start under way. A started plan becomes the host's
 * open one, which is what turns the tab to its document.
 */
export function NewPlanForm({
  newPlan,
  repositories,
}: {
  newPlan: PlansControl["newPlan"];
  repositories: PlansControl["repositories"];
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const repository = chosen ?? repositories.recent[0] ?? null;

  const start = () => {
    setStarting(true);
    setNote(undefined);
    newPlan
      .start(name.trim(), repository)
      .then(setNote)
      .finally(() => setStarting(false));
  };

  return (
    <NewPlanFormView
      name={name}
      repository={repository}
      chooser={repositories}
      starting={starting}
      note={note}
      focusRequest={newPlan.presses}
      onName={setName}
      onRepository={setChosen}
      onStart={start}
    />
  );
}
