import { useAtom, useAtomValue } from "@effect/atom-react";
import type { PlanEditRequest } from "@sidecar/hosted/plan-edit";
import { PLAN_FIELD_HEADING, type PlanContent } from "@sidecar/hosted/plan-template";
import { PLAN_FIELD } from "@sidecar/hosted/plan-wire";
import type { PlanningEditAnswer } from "@sidecar/hosted/planning-view";
import { PencilIcon, PlusIcon } from "@sidecar/panel";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { bundleAtom } from "../bundle-loader";
import {
  FIELD_EDITOR_ASSET,
  FIELD_KIND,
  type FieldEditorModule,
  type FieldEditorProps,
  type FieldValue,
} from "../field-editor/contract";
import { MarkdownMessage } from "../markdown-message";
import { rendererRegistry, rendererRuntime } from "../renderer-runtime";
import {
  CONFLICT_NOTE,
  EDIT_DRAFT,
  EDITOR_BOUNDS,
  type EditTarget,
  editorAnswered,
  editorCloseAsked,
  editorCloses,
  editorKeptMine,
  editorOpened,
  editorRefused,
  editorRetried,
  editorRuleStruck,
  editorSent,
  editorTookLukes,
  editorTyped,
  FIELD_EDITOR_STATE,
  type FieldEditor,
  pendingSave,
  type RuleDraft,
} from "./plan-field-editor-model";

/**
 * plan-field-editor.tsx -- the open plan's field editor: a field's words edited in place, drawn as the document draws them, saved as the developer pauses.
 *
 * A field of the document opens in an editor on a click into its words, the
 * caret where the click landed, or from its pencil, which is the keyboard's
 * way in, the caret at the end; the heading stays drawn above it, since the
 * formatter owns every heading. The editor is TipTap, from a bundle of its
 * own loaded the first time a field is hovered or opened
 * (`../field-editor/contract.ts`), and wears the read view's classes, so the
 * words stay formatted and nothing moves as a field opens. Until the bundle
 * has loaded the field stays drawn as it was, so a click's point still lands
 * on the same word. The words save a beat after the developer stops typing
 * and again as the editor closes, on Esc, ⌘↩, or focus leaving it, and the
 * editor waits for that save before it goes (`plan-field-editor-model.ts`
 * decides every save). The editor hands its words over once per pause in
 * the typing rather than on every keystroke, because each hand-over draws
 * the whole document around it again. An editor stays where it opened while
 * it stands, even once its first save draws the field it edits elsewhere in
 * the document. The editor's words are document text, which the session
 * recording masks like any other, and it stands under `ph-no-capture`
 * besides, so not even the rhythm of the typing is recorded. Unsaved words
 * live in this window's memory alone and are never written to disk.
 */

/** How long the developer pauses before what they typed is saved. */
const SAVE_PAUSE = Duration.seconds(1);

/** The pause before a save, as an atom whose work is the wait; setting it again starts the wait over. */
const savePauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(SAVE_PAUSE), stamp),
);

/** How the document saves an edit: the field, what the words were written from, and the developer's. */
export type PlanEditDoor = (request: PlanEditRequest) => Promise<PlanningEditAnswer>;

/** The places an editor stands that are no unit of the body. */
export const EDITOR_PLACE = {
  /** In place of the assumptions' list, under its heading. */
  ASSUMPTIONS: "assumptions",
  /** After the body, for a section the body does not draw until it holds something. */
  END: "end",
} as const;

/** Where an editor stands in the document: in place of a unit, by its id, or a place of its own. */
export type EditorHost = number | (typeof EDITOR_PLACE)[keyof typeof EDITOR_PLACE];

/** The document's one field editor, where it stands, and its doors. */
/** Where a click that opened an editor landed, which is where its caret goes. */
interface ClickPoint {
  readonly x: number;
  readonly y: number;
}

export interface FieldEditing {
  readonly editor: FieldEditor | undefined;
  readonly host: EditorHost | undefined;
  /** Where the click that opened the editor landed; none where the keyboard opened it. */
  readonly at: ClickPoint | undefined;
  readonly open: (target: EditTarget, host: EditorHost, at?: ClickPoint) => void;
  /** The open editor's way to hand over words it still holds, which the document calls before it saves what is left; none once it goes. */
  readonly holdWords: (handOver: (() => void) | undefined) => void;
  readonly typeText: (text: string) => void;
  readonly typeRule: (rule: RuleDraft) => void;
  readonly close: () => void;
  readonly keepMine: () => void;
  readonly takeLukes: () => void;
  readonly retry: () => void;
  readonly strikeRule: () => void;
}

/**
 * The editor over the open plan's content as `content` holds it. One field
 * is open at a time: a field asked for while another still has words to
 * save or a choice to make leaves that one open.
 */
export function useFieldEditing(
  planId: string,
  content: PlanContent | undefined,
  edit: PlanEditDoor,
): FieldEditing {
  const [editor, setEditor] = useState<FieldEditor | undefined>(undefined);
  const [host, setHost] = useState<EditorHost | undefined>(undefined);
  const [at, setAt] = useState<ClickPoint | undefined>(undefined);
  const [pause, restartPause] = useAtom(savePauseAtom);
  // Note that these are refs, because a save's answer and the pause's end
  // read them as they land, which no render stands between.
  const latest = useRef(editor);
  latest.current = editor;
  const stamp = useRef(0);
  // The open editor's words not yet handed over, which a plan leaving must save too.
  const heldWords = useRef<(() => void) | undefined>(undefined);
  // The door of the plan last drawn, moved on after each commit, so a
  // cleanup as another plan opens still holds the door of the one it leaves.
  const door = useRef(edit);
  useEffect(() => {
    door.current = edit;
  });

  // Note that the save out is reserved on the ref before anything renders,
  // so a pause and a close landing in one flush start one save, not two.
  const send = () => {
    const held = latest.current;
    if (held === undefined) return;
    const request = pendingSave(held);
    if (request === undefined) return;
    const { target } = held;
    latest.current = editorSent(held, request);
    setEditor(latest.current);
    door.current(request).then(
      (answered) =>
        setEditor((now) => (now?.target === target ? editorAnswered(now, answered) : now)),
      (refused: Error) =>
        setEditor((now) => (now?.target === target ? editorRefused(now, refused.message) : now)),
    );
  };

  /** The words changed: the editor holds them, and the pause before their save starts over. */
  // Note that the ref moves with the words, so a close in the same tick as
  // the editor's last hand-over saves those words rather than the ones before.
  const changed = (next: (now: FieldEditor) => FieldEditor) => {
    if (latest.current === undefined) return;
    latest.current = next(latest.current);
    setEditor(latest.current);
    stamp.current += 1;
    restartPause(stamp.current);
  };

  // A pause that ran out on the newest keystroke saves what stands.
  useEffect(() => {
    if (AsyncResult.isSuccess(pause) && !pause.waiting && pause.value === stamp.current) send();
  });

  // An editor asked to close saves what is left, then goes once nothing is.
  useEffect(() => {
    if (editor === undefined || !editor.closing) return;
    if (editorCloses(editor)) setEditor(undefined);
    else send();
  });

  // Another plan opened, or the document gone, takes the editor with it, and
  // words not yet saved are sent through the door of the plan they were
  // typed in. Note that the cleanup is what sends them, because it still
  // holds that plan's door and runs before the document can go.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the plan changing is what closes it.
  useEffect(() => {
    setEditor(undefined);
    return () => {
      heldWords.current?.();
      const held = latest.current;
      const request = held === undefined ? undefined : pendingSave(held);
      if (request !== undefined) door.current(request).catch(() => undefined);
    };
  }, [planId]);

  return {
    editor,
    host,
    at,
    holdWords: (handOver) => {
      heldWords.current = handOver;
    },
    open: (target, where, point) => {
      if (content === undefined) return;
      if (editor !== undefined && !editorCloses(editorCloseAsked(editor))) return;
      setEditor(editorOpened(target, content));
      setHost(where);
      setAt(point);
    },
    typeText: (text) => changed((now) => editorTyped(now, { kind: EDIT_DRAFT.TEXT, text })),
    typeRule: (rule) => changed((now) => editorTyped(now, { kind: EDIT_DRAFT.RULE, rule })),
    // The save starts with the close, not a render later, since the close may
    // be focus leaving for another plan that takes the document with it.
    close: () => {
      if (latest.current === undefined) return;
      latest.current = editorCloseAsked(latest.current);
      setEditor(latest.current);
      send();
    },
    keepMine: () => changed(editorKeptMine),
    takeLukes: () => setEditor((now) => (now === undefined ? now : editorTookLukes(now))),
    retry: () => {
      if (latest.current === undefined) return;
      latest.current = editorRetried(latest.current);
      send();
    },
    strikeRule: () => {
      if (latest.current === undefined) return;
      latest.current = editorRuleStruck(latest.current);
      setEditor(latest.current);
      send();
    },
  };
}

/** What an editor and its pencil call the field it edits, in the developer's words. */
export function targetLabel(target: EditTarget, ruleCount: number): string {
  if (target.field !== PLAN_FIELD.RULES) return PLAN_FIELD_HEADING[target.field];
  return target.rule < ruleCount ? `Rule ${target.rule + 1}` : "New rule";
}

/** What stands under the inputs: Luke's change and the choice it asks, a failed save and its retry, or a save under way. */
function EditorNote({
  editor,
  editing,
}: {
  editor: FieldEditor;
  editing: FieldEditing;
}): React.JSX.Element | null {
  if (editor.state.kind === FIELD_EDITOR_STATE.CONFLICT) {
    return (
      <div className="plan-field-note" role="alert">
        <span>{CONFLICT_NOTE}</span>
        <button type="button" className="toolbar-button" onClick={editing.keepMine}>
          Keep mine
        </button>
        <button type="button" className="toolbar-button" onClick={editing.takeLukes}>
          Use Luke's
        </button>
      </div>
    );
  }
  if (editor.state.kind === FIELD_EDITOR_STATE.FAILED) {
    return (
      <div className="plan-field-note" role="alert">
        <span>{editor.state.note}</span>
        <button type="button" className="toolbar-button" onClick={editing.retry}>
          Try again
        </button>
      </div>
    );
  }
  if (editor.sending !== undefined) {
    return <p className="plan-field-note plan-field-saving">Saving…</p>;
  }
  return null;
}

/** The field's words as the editor opens on them, read from the draft the model opened. */
function inPlaceValue(editor: FieldEditor): FieldValue {
  const { draft, target } = editor;
  if (draft.kind === EDIT_DRAFT.RULE) return { kind: FIELD_KIND.RULE, rule: draft.rule };
  if (target.field === PLAN_FIELD.OPEN_QUESTIONS) {
    return { kind: FIELD_KIND.QUESTIONS, text: draft.text };
  }
  if (target.field === PLAN_FIELD.ASSUMPTIONS) {
    return { kind: FIELD_KIND.ASSUMPTIONS, text: draft.text };
  }
  return { kind: FIELD_KIND.TEXT, text: draft.text };
}

/** The read view's own classes for the field's words, so the editor's words stand where they stood. */
function classOf(value: FieldValue): string {
  if (value.kind === FIELD_KIND.RULE) return "markdown plan-rule-body";
  if (value.kind === FIELD_KIND.ASSUMPTIONS) return "plan-assumption-list";
  return "markdown plan-unit";
}

/** How long the typing pauses before the document hears the field's words. */
const DRAFT_PAUSE = Duration.millis(150);

/** The pause before the words are handed over, as an atom whose work is the wait; setting it again starts the wait over. */
const draftPauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(DRAFT_PAUSE), stamp),
);

/** What the editor reports its words and its finish through. */
interface DraftDoors {
  readonly onDraft: (value: FieldValue) => void;
  readonly onFinish: () => void;
}

/**
 * The editor's words, handed to the model once per pause in the typing.
 * Note that they are held back, because each hand-over draws the whole
 * document around the editor again, and the editor holds the words
 * meanwhile; a finish, or the editor going, hands over the last first.
 */
function useDraftHandOver(editing: FieldEditing): DraftDoors {
  const [pause, restartPause] = useAtom(draftPauseAtom);
  const pending = useRef<FieldValue | undefined>(undefined);
  const stamp = useRef(0);
  const door = useRef(editing);
  door.current = editing;
  const flush = () => {
    const next = pending.current;
    pending.current = undefined;
    if (next === undefined) return;
    if (next.kind === FIELD_KIND.RULE) door.current.typeRule(next.rule);
    else door.current.typeText(next.text);
  };
  // A pause that ran out on the newest words hands them over.
  useEffect(() => {
    if (AsyncResult.isSuccess(pause) && !pause.waiting && pause.value === stamp.current) flush();
  });
  // The document hands over what is held before it saves what is left as a
  // plan goes, and the editor going hands it over as well.
  useLayoutEffect(() => {
    door.current.holdWords(flush);
    return () => {
      door.current.holdWords(undefined);
      flush();
    };
  }, []);
  return {
    onDraft: (value) => {
      pending.current = value;
      stamp.current += 1;
      restartPause(stamp.current);
    },
    onFinish: () => {
      flush();
      door.current.close();
    },
  };
}

/** What a field says while the editor's bundle could not be loaded. */
const EDITOR_LOAD_FAILED = "The editor could not be loaded.";

/** The field editor's own bundle, loaded once per window. */
const fieldEditorAtom = bundleAtom(
  { script: FIELD_EDITOR_ASSET.SCRIPT },
  () => window.lukeFieldEditor,
  EDITOR_LOAD_FAILED,
);

/** Starts the editor's bundle loading as the pointer or the keyboard comes onto a field, so it is there by the click. */
function prefetchFieldEditor(): void {
  rendererRegistry.get(fieldEditorAtom);
}

/** The bundle's editor mounted in place, built once, on the words it opened with. */
function MountedEditor({
  module,
  props,
}: {
  module: FieldEditorModule;
  props: FieldEditorProps;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    if (host.current === null) return;
    const handle = module.mount(host.current, {
      ...latest.current,
      onDraft: (value) => latest.current.onDraft(value),
      onFinish: () => latest.current.onFinish(),
    });
    return handle.destroy;
  }, [module]);
  return <div ref={host} />;
}

/**
 * One field in its editor. The heading stays drawn above it as the document
 * draws it; a rule keeps its number in the gutter, the way the read view
 * draws it, with Delete rule under a rule that stands. Until the editor's
 * bundle has loaded, the field stays `drawn` as the document drew it. Focus
 * leaving the editor closes it, unless it moved to another of its controls.
 */
export function PlanFieldEditor({
  heading,
  editor,
  ruleCount,
  editing,
  drawn,
}: {
  heading: string | undefined;
  editor: FieldEditor;
  ruleCount: number;
  editing: FieldEditing;
  drawn: ReactNode;
}): React.JSX.Element {
  const label = targetLabel(editor.target, ruleCount);
  const value = useRef(inPlaceValue(editor)).current;
  const { onDraft, onFinish } = useDraftHandOver(editing);
  const module = useAtomValue(fieldEditorAtom);
  if (!AsyncResult.isSuccess(module)) {
    return (
      <section className="plan-field-editor ph-no-capture" aria-busy="true">
        {drawn}
        {AsyncResult.isFailure(module) ? (
          <p className="plan-field-note" role="alert">
            {EDITOR_LOAD_FAILED}
          </p>
        ) : null}
      </section>
    );
  }
  const limit = value.kind === FIELD_KIND.TEXT ? EDITOR_BOUNDS.ANSWER_CHARS : undefined;
  const props = {
    value,
    at: editing.at,
    label,
    className: classOf(value),
    limit,
    onDraft,
    onFinish,
  };
  const words = <MountedEditor module={module.value} props={props} />;
  const rule = "rule" in editor.target ? editor.target.rule : undefined;
  return (
    <section
      className="plan-field-editor ph-no-capture"
      aria-label={`Editing ${label}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onFinish();
      }}
    >
      {heading === undefined || rule !== undefined ? null : (
        <MarkdownMessage words={heading} className="plan-unit" />
      )}
      {rule === undefined ? (
        words
      ) : (
        <div className="plan-unit plan-rule">
          <span className="plan-rule-number">{`${rule + 1}.`}</span>
          {words}
        </div>
      )}
      {rule !== undefined && rule < ruleCount ? (
        <div className="plan-rule-actions">
          <button type="button" className="toolbar-button" onClick={editing.strikeRule}>
            Delete rule
          </button>
        </div>
      ) : null}
      <EditorNote editor={editor} editing={editing} />
    </section>
  );
}

/** Whether a click lands on words to edit: no selection made by the press, and not on a link. */
function editsOnClick(target: EventTarget): boolean {
  const selection = window.getSelection();
  if (selection !== null && !selection.isCollapsed) return false;
  return !(target instanceof Element && target.closest("a") !== null);
}

/**
 * A unit the developer can edit, drawn as the document draws it, which opens
 * its editor on a click into its words that selects nothing, or from its
 * pencil, or, for a new rule, from its plus.
 */
export function EditableUnit({
  target,
  host,
  label,
  adds,
  editing,
  children,
}: {
  target: EditTarget;
  host: EditorHost;
  label: string;
  adds: boolean;
  editing: FieldEditing;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the button beside the words is the keyboard's way into the same editor.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the button beside the words is the keyboard's way into the same editor.
    <div
      className="plan-unit-editable"
      onPointerEnter={prefetchFieldEditor}
      onClick={(event) => {
        if (editsOnClick(event.target)) {
          editing.open(target, host, { x: event.clientX, y: event.clientY });
        }
      }}
    >
      {children}
      <button
        type="button"
        className="icon-button plan-unit-edit"
        aria-label={adds ? "Add rule" : `Edit ${label}`}
        onFocus={prefetchFieldEditor}
        onClick={(event) => {
          event.stopPropagation();
          editing.open(target, host);
        }}
      >
        {adds ? <PlusIcon /> : <PencilIcon />}
      </button>
    </div>
  );
}
