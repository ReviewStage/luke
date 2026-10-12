import { useAtom } from "@effect/atom-react";
import type { PlanEditRequest } from "@sidecar/hosted/plan-edit";
import { PLAN_FIELD_HEADING, type PlanContent } from "@sidecar/hosted/plan-template";
import { PLAN_FIELD } from "@sidecar/hosted/plan-wire";
import type { PlanningEditAnswer } from "@sidecar/hosted/planning-view";
import { PencilIcon, PlusIcon } from "@sidecar/panel";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { MarkdownMessage } from "../markdown-message";
import { rendererRuntime } from "../renderer-runtime";
import { type FieldValue, PM_FIELD_KIND } from "../spike/field-value";
import { PmFieldEditor } from "../spike/pm-field";
import {
  CONFLICT_NOTE,
  EDIT_DRAFT,
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
 * plan-field-editor.tsx -- the open plan's field editor: a field's words in plain inputs in place of its answer, saved as the developer pauses.
 *
 * A field of the document opens in an editor on a click into its words, or
 * from its pencil, which is the keyboard's way in; the heading stays drawn
 * above it, since the formatter owns every heading. A text field, the open
 * questions, and the assumptions open in one text box (the lists one item
 * to a line); a rule opens as its statement and its examples, Given, When,
 * and Then, each its own input, with an example added or struck and the
 * rule struck by button. The words save a beat after the developer stops
 * typing and again as the editor closes, on Esc, ⌘↩, or focus leaving it,
 * and the editor waits for that save before it goes
 * (`plan-field-editor-model.ts` decides every save). An editor stays where it
 * opened while it stands, even once its first save draws the field it edits
 * elsewhere in the document, so the inputs never move under the typing. The
 * inputs are textareas and inputs, never `contenteditable`: the session
 * recording masks an input's value itself, and the editor stands under
 * `ph-no-capture` besides, so not even the rhythm of the typing is recorded.
 * Unsaved words live in this window's memory alone and are never written to
 * disk.
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

/** Where a click that opened an editor landed, which is where its caret goes. */
export interface ClickPoint {
  readonly x: number;
  readonly y: number;
}

/** SPIKE: the in-place editor a field opens in, the minimal ProseMirror one unless the demo swaps it. */
export type SeamlessEditor = typeof PmFieldEditor;
export const SeamlessEditorContext = createContext<SeamlessEditor>(PmFieldEditor);

/** The document's one field editor, where it stands, and its doors. */
export interface FieldEditing {
  readonly editor: FieldEditor | undefined;
  readonly host: EditorHost | undefined;
  /** SPIKE: where the click that opened the editor landed. */
  readonly at: ClickPoint | undefined;
  readonly open: (target: EditTarget, host: EditorHost, at?: ClickPoint) => void;
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
  // SPIKE: the ref moves with the words, so a close in the same tick as the
  // in-place editor's last draft saves that draft rather than the one before.
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
  useEffect(() => {
    setEditor(undefined);
    return () => {
      const held = latest.current;
      const request = held === undefined ? undefined : pendingSave(held);
      if (request !== undefined) door.current(request).catch(() => undefined);
    };
  }, [planId]);

  return {
    editor,
    host,
    at,
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

/** SPIKE: the field's words as the in-place editor opens on them, read from the draft the model opened. */
function seamlessValue(editor: FieldEditor): FieldValue {
  const { draft, target } = editor;
  if (draft.kind === EDIT_DRAFT.RULE) return { kind: PM_FIELD_KIND.RULE, rule: draft.rule };
  if (target.field === PLAN_FIELD.OPEN_QUESTIONS || target.field === PLAN_FIELD.ASSUMPTIONS) {
    const items = draft.text.split("\n").filter((line) => line !== "");
    return { kind: PM_FIELD_KIND.ITEMS, items };
  }
  return { kind: PM_FIELD_KIND.TEXT, markdown: draft.text === "" ? null : draft.text };
}

/** SPIKE: how long the typing pauses before the document hears the field's words. */
const DRAFT_COALESCE_MS = 150;

/**
 * SPIKE: the in-place editor's drafts, coalesced to one per pause in the
 * typing. Note that we hold them back, because each draft re-renders the
 * whole document around the editor, and the editor, not React, holds the
 * words meanwhile; a finish, or the editor going, hands over the last first.
 */
function useCoalescedDrafts(editing: FieldEditing): {
  onDraft: (value: FieldValue) => void;
  onFinish: () => void;
} {
  const pending = useRef<FieldValue | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const door = useRef(editing);
  door.current = editing;
  const flush = () => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = undefined;
    if (next === undefined) return;
    if (next.kind === PM_FIELD_KIND.RULE) door.current.typeRule(next.rule);
    else if (next.kind === PM_FIELD_KIND.ITEMS) door.current.typeText(next.items.join("\n"));
    else door.current.typeText(next.markdown ?? "");
  };
  useEffect(() => flush, []);
  return {
    onDraft: (value) => {
      pending.current = value;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DRAFT_COALESCE_MS);
    },
    onFinish: () => {
      flush();
      door.current.close();
    },
  };
}

/**
 * SPIKE: one field in its in-place editor. The heading stays drawn above it
 * as the document draws it, since the formatter owns every heading; a rule
 * keeps its number in the gutter, the way the read view draws it. The editor
 * wears the read view's own classes, so nothing moves as it opens, and the
 * caret lands where the click did. What the developer types reaches the same
 * model the text boxes fed (`plan-field-editor-model.ts`), which still
 * decides every save, the conflict, and the retry.
 */
export function PlanFieldEditor({
  heading,
  editor,
  ruleCount,
  editing,
}: {
  heading: string | undefined;
  editor: FieldEditor;
  ruleCount: number;
  editing: FieldEditing;
}): React.JSX.Element {
  const Editor = useContext(SeamlessEditorContext);
  const label = targetLabel(editor.target, ruleCount);
  const value = useRef(seamlessValue(editor)).current;
  const { onDraft, onFinish } = useCoalescedDrafts(editing);
  const fields =
    value.kind === PM_FIELD_KIND.RULE ? (
      <div className="plan-unit plan-rule">
        <span className="plan-rule-number">
          {"rule" in editor.target ? `${editor.target.rule + 1}.` : ""}
        </span>
        <Editor
          value={value}
          at={editing.at}
          label={label}
          className="markdown plan-rule-body"
          onDraft={onDraft}
          onFinish={onFinish}
        />
      </div>
    ) : (
      <Editor
        value={value}
        at={editing.at}
        label={label}
        className={
          value.kind === PM_FIELD_KIND.ITEMS ? "markdown spike-items" : "markdown plan-unit"
        }
        onDraft={onDraft}
        onFinish={onFinish}
      />
    );
  return (
    <section
      className="plan-field-editor spike-seamless ph-no-capture"
      aria-label={`Editing ${label}`}
    >
      {heading === undefined || value.kind === PM_FIELD_KIND.RULE ? null : (
        <MarkdownMessage words={heading} className="plan-unit" />
      )}
      {fields}
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
      onClick={(event) => {
        if (editsOnClick(event.target))
          editing.open(target, host, { x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      <button
        type="button"
        className="icon-button plan-unit-edit"
        aria-label={adds ? "Add rule" : `Edit ${label}`}
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
