import { PLAN_BOUNDS } from "@luke/features/plan-wire";
import { useId, useRef, useState } from "react";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "#shared/shortcuts";
import { ModalShell } from "../modal-shell";
import { Shortcut } from "../shortcut";
import { BusyLabel } from "../spinner";
import { CHIP_PLACE, RepositoryChip } from "./repository-chip";
import type { PlansControl } from "./use-plans-tab";

/**
 * new-plan-dialog.tsx -- New plan as a small modal over the window: the plan's name, the GitHub repository it is about, Cancel and Create plan.
 *
 * The window asks the way Linear's and Notion's "New …" ask: it dims over
 * whatever stood open, and a card holds the one field and the repository
 * chip. The chip leads the card's foot with Cancel and Create plan at its
 * end, as the feedback dialog's screenshot button leads its own. The field
 * takes focus, Tab stays inside the card, and focus goes back to whatever
 * opened it. The name is one line, so Return creates the plan with any
 * modifier held; Escape, Cancel, and a press on the dimmed window put the
 * card away with nothing started, its words with it. Nothing typed here
 * reaches the model as conversation. The repository starts on the one the
 * press chose (a repository group's +), else the one the newest plan was
 * about; the chip offers the other recent ones, a search over every
 * repository Luke reaches, and the page where the developer chooses which
 * ones Luke can see. A plan can start with none and be given one later. A
 * refusal keeps the card with the reason under the field, and Create plan
 * can be pressed again; a plan started closes the card and opens as the
 * host's open plan, its call with it.
 */

/** Create plan's chord: Return alone, from the name field. */
const CREATE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER, bare: true };

/**
 * The card with its own state, mounted afresh on each opening so a
 * cancelled name is never offered again: the name, the repository chosen
 * over the press's or the last one used, and the start under way.
 */
function NewPlanCard({
  newPlan,
  repositories,
}: {
  newPlan: PlansControl["newPlan"];
  repositories: PlansControl["repositories"];
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState(newPlan.preset?.repository);
  // A repository picked in one workspace is none of another's, so a switch
  // lets the pick go, in the render that brings it; the scope first
  // resolving keeps a pick made before the workspaces were read.
  const [scope, setScope] = useState(repositories.scope);
  if (repositories.scope !== scope) {
    if (scope !== undefined) setChosen(undefined);
    setScope(repositories.scope);
  }
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const repository = chosen ?? repositories.recent[0] ?? null;
  const canStart = name.trim().length > 0 && !starting;

  const start = () => {
    if (!canStart) return;
    setStarting(true);
    setNote(undefined);
    newPlan
      .start(name.trim(), repository)
      .then(setNote)
      .finally(() => setStarting(false));
  };
  const close = () => {
    if (!starting) newPlan.onClose();
  };

  // Return creates the plan with any modifier held, since the name has no
  // second line to begin.
  const fieldKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    start();
  };

  return (
    <ModalShell
      className="confirm-dialog new-plan-dialog ph-no-capture"
      labelledBy={titleId}
      busy={starting}
      initialFocus={field}
      onDismiss={close}
    >
      <h2 id={titleId} className="confirm-dialog-title">
        New plan
      </h2>
      <input
        ref={field}
        type="text"
        className="dialog-name-field"
        aria-label="Plan name"
        aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
        placeholder="Plan name"
        maxLength={PLAN_BOUNDS.MAX_NAME_CHARS}
        spellCheck
        value={name}
        disabled={starting}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={fieldKey}
      />
      {note === undefined ? null : (
        <p className="error-message" role="alert">
          {note}
        </p>
      )}
      <div className="confirm-dialog-actions">
        <RepositoryChip
          key={repositories.scope}
          place={CHIP_PLACE.COMPOSER}
          value={repository}
          chooser={repositories}
          onChoose={setChosen}
        />
        <button type="button" className="toolbar-button" disabled={starting} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="primary-button"
          aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
          aria-busy={starting}
          disabled={!canStart}
          onClick={start}
        >
          <BusyLabel busy={starting} label="Creating">
            Create plan
          </BusyLabel>
          <Shortcut chord={CREATE_CHORD} />
        </button>
      </div>
    </ModalShell>
  );
}

/** The card over the window while New plan is asked, in the window's one modal frame (`../modal-shell.tsx`); nothing otherwise. */
export function NewPlanDialog({
  newPlan,
  repositories,
}: {
  newPlan: PlansControl["newPlan"];
  repositories: PlansControl["repositories"];
}): React.JSX.Element | null {
  if (!newPlan.open) return null;
  return <NewPlanCard newPlan={newPlan} repositories={repositories} />;
}
