import { planSections } from "@sidecar/hosted/plan-document";
import { useEffect, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { SHORTCUT_KEY, type ShortcutChord, shortcutAria } from "#shared/shortcuts";
import { useAct } from "../act";
import { MarkdownMessage } from "../markdown-message";
import { Shortcut } from "../shortcut";
import { BusyLabel } from "../spinner";
import { dictationKeywords } from "./dictation-keywords";
import { DictateButton, DictationStrip } from "./dictation-strip";
import { CHIP_PLACE, RepositoryChip, type RepositoryChooser } from "./repository-chip";
import { DICTATION_PHASE, useDictation } from "./use-dictation";
import type { PlansControl } from "./use-plans-tab";

/**
 * new-plan-form.tsx -- the Plans tab's home: a new plan's first page, where the developer names it and the GitHub repository it is about.
 *
 * Drawn as the plan's own document is about to be, so what is typed reads
 * as the plan's title rather than a message to an agent: the name is the
 * plan page's title, in its type, reading "Untitled plan" until one is
 * typed; under it the repository as a labelled property, and the Create
 * plan button with its Return; and under those, faint and out of reach, the
 * sections of the account's own template (Settings › Plan template), which
 * the plan's text starts as a copy of. Nothing typed here reaches the model
 * as conversation. The name is one line, so Return creates the plan whatever
 * else is held and never breaks the line, though a long name wraps as the
 * title does. The repository starts on the one the newest plan was about;
 * the chip offers the other recent ones, a search over every repository
 * Luke reaches, and the page where the developer chooses which ones Luke can
 * see, and the planning model reads that repository for the plan's whole
 * life. A plan can start with none and be given one later. A refusal keeps
 * the page with the reason under the button, which can be pressed again.
 * The name can be dictated with the agent composer's own microphone and
 * strip (`dictation-strip.tsx`), the repository's name among the words to
 * listen for. The template is read as the page opens and on each press of
 * New plan, so an edit in Settings or on another Mac shows on the next
 * visit; until it is read, or where the last read failed, the page draws no
 * sections.
 */

/** The longest name the field takes. */
const NAME_MAX_CHARS = 200;

/** Create plan's chord: Return alone, from the name field. */
const CREATE_CHORD: ShortcutChord = { key: SHORTCUT_KEY.ENTER, bare: true };

/** Everything the page draws, handed in whole so the layout decides nothing. */
interface NewPlanFormViewProps {
  name: string;
  /** The repository the plan is about, `owner/name`; null until one is chosen or used before. */
  repository: string | null;
  chooser: RepositoryChooser;
  /** The account's template, as the plan's text will start; empty until read. */
  template: string;
  starting: boolean;
  /** Why the last start did not land, in the page's words. */
  note: string | undefined;
  /** Counts the presses of New plan, so the name field takes focus on each. */
  focusRequest: number;
  onName: (name: string) => void;
  onRepository: (repository: string) => void;
  onStart: () => void;
  /** Says why a dictation left nothing under the button, or clears it. */
  onNote: (note: string | undefined) => void;
}

/** The template's sections, drawn as the plan's will be, faint and inert because none of it is the developer's yet. */
function TemplatePreview({ template }: { template: string }): React.JSX.Element | null {
  const sections = planSections(template).filter((section) => section.text.trim() !== "");
  if (sections.length === 0) return null;
  return (
    <div className="new-plan-template ph-no-capture" inert>
      {sections.map((section) => (
        <MarkdownMessage key={section.from} words={section.text} className="plan-unit" />
      ))}
    </div>
  );
}

function NewPlanFormView(props: NewPlanFormViewProps): React.JSX.Element {
  const nameField = useRef<HTMLTextAreaElement>(null);
  const canStart = props.name.trim().length > 0 && !props.starting;
  const { focusRequest } = props;
  const latest = useRef(props);
  latest.current = props;
  const dictation = useDictation({
    field: nameField,
    draft: () => latest.current.name,
    setDraft: (next) => latest.current.onName(next),
    maxLength: NAME_MAX_CHARS,
    keywords: dictationKeywords({
      repository: props.repository,
      title: undefined,
      body: undefined,
    }),
    onNote: props.onNote,
  });
  const dictating = dictation.phase !== DICTATION_PHASE.IDLE;

  // Note that we focus on arrival as well as on each press of New plan,
  // because the page is the window's home and typing the name is its one job.
  useEffect(() => {
    nameField.current?.focus();
  }, [focusRequest]);

  // Return creates the plan with any modifier held, since the name has no
  // second line to begin; an input method still composing keeps its own.
  const onFieldKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (dictation.onFieldKey(event)) return;
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canStart) props.onStart();
  };

  return (
    <section className="plan-body new-plan" aria-label="New plan">
      <div className="markdown plan-title">
        <textarea
          ref={nameField}
          className="markdown-heading plan-title-text new-plan-name"
          data-level="1"
          rows={1}
          aria-label="Plan name"
          aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
          value={props.name}
          placeholder="Untitled plan"
          maxLength={NAME_MAX_CHARS}
          readOnly={dictating}
          spellCheck
          onChange={(event) => props.onName(event.currentTarget.value)}
          onKeyDown={onFieldKey}
        />
      </div>
      <div className="new-plan-property">
        <span className="new-plan-property-label">Repository</span>
        <RepositoryChip
          key={props.chooser.scope}
          place={CHIP_PLACE.COMPOSER}
          value={props.repository}
          chooser={props.chooser}
          onChoose={props.onRepository}
        />
      </div>
      <div className="new-plan-actions">
        {dictating ? (
          <DictationStrip dictation={dictation} />
        ) : (
          <>
            <button
              type="button"
              className="primary-button"
              aria-keyshortcuts={shortcutAria(CREATE_CHORD)}
              aria-busy={props.starting}
              disabled={!canStart}
              onClick={props.onStart}
            >
              <BusyLabel busy={props.starting} label="Creating">
                Create plan
              </BusyLabel>
              <Shortcut chord={CREATE_CHORD} />
            </button>
            <DictateButton dictation={dictation} disabled={props.starting} />
            <p className="new-plan-hint">Luke joins to talk it through once the plan exists.</p>
          </>
        )}
      </div>
      {props.note !== undefined ? (
        <p className="new-plan-note" role="alert">
          {props.note}
        </p>
      ) : null}
      <TemplatePreview template={props.template} />
    </section>
  );
}

/**
 * The page with its own state: the name, the repository chosen over the
 * last one used, the account's template, and the start under way. A press
 * of New plan that chose a repository, a repository group's +, chooses it
 * here as a pick would, on arrival or over whatever was picked before it. A
 * started plan becomes the host's open one, which is what turns the tab to
 * its document.
 */
export function NewPlanForm({
  newPlan,
  repositories,
}: {
  newPlan: PlansControl["newPlan"];
  repositories: PlansControl["repositories"];
}): React.JSX.Element {
  const { act } = useAct();
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState(newPlan.preset?.repository);
  // Note that a preset is taken during the render that brings it, the way
  // React adjusts state to a prop, so the chip never draws the old pick first.
  const [presetTaken, setPresetTaken] = useState(newPlan.preset);
  if (newPlan.preset !== presetTaken) {
    setPresetTaken(newPlan.preset);
    if (newPlan.preset !== undefined) setChosen(newPlan.preset.repository);
  }
  const [template, setTemplate] = useState("");
  // A repository picked in one workspace is none of another's, so a switch
  // lets the pick go, in the render that brings it, as a preset is taken;
  // the scope first resolving keeps a pick made before the workspaces read.
  const [scope, setScope] = useState(repositories.scope);
  if (repositories.scope !== scope) {
    if (scope !== undefined) setChosen(undefined);
    setScope(repositories.scope);
  }
  const [starting, setStarting] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const repository = chosen ?? repositories.recent[0] ?? null;

  // The template is read on arrival and on each press of New plan. Note that
  // a read that fails takes the sections away rather than keep the last ones,
  // because the template may have changed since and the plan starts as the
  // service's copy, never as this preview.
  useEffect(() => {
    let live = true;
    act(ACT_KIND.PLAN_TEMPLATE_READ).then(
      (answer) => {
        if (live) setTemplate("template" in answer ? answer.template : "");
      },
      () => {
        if (live) setTemplate("");
      },
    );
    return () => {
      live = false;
    };
  }, [act, newPlan.presses]);

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
      template={template}
      starting={starting}
      note={note}
      focusRequest={newPlan.presses}
      onName={setName}
      onRepository={setChosen}
      onStart={start}
      onNote={setNote}
    />
  );
}
