import { useAtom } from "@effect/atom-react";
import type { PlanEditRequest } from "@sidecar/hosted/plan-edit";
import { PLAN_FIELD_HEADING, type PlanContent } from "@sidecar/hosted/plan-template";
import { PLAN_FIELD } from "@sidecar/hosted/plan-wire";
import type { PlanningEditAnswer } from "@sidecar/hosted/planning-view";
import { PencilIcon } from "@sidecar/panel";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";
import { MarkdownMessage } from "../markdown-message";
import { rendererRuntime } from "../renderer-runtime";
import { RetryButton } from "../retry-button";
import {
  CONFLICT_NOTE,
  type EditTarget,
  editorAnswered,
  editorCloseAsked,
  editorCloses,
  editorKeptMine,
  editorOpened,
  editorRefused,
  editorRetried,
  editorSent,
  editorTookLukes,
  editorTyped,
  FIELD_EDITOR_STATE,
  type FieldEditor,
  pendingSave,
} from "./plan-field-editor-model";

/**
 * plan-field-editor.tsx -- the open plan's field editor: a field's words in plain inputs in place of its answer, saved as the developer pauses.
 *
 * A field of the document opens in an editor on a click into its words, or
 * from its pencil, which is the keyboard's way in; the heading stays drawn
 * above it, since the formatter owns every heading. A section, the open
 * questions, and the assumptions each open in one text box (the lists one
 * item to a line). The words save a beat after the developer stops
 * typing and again as the editor closes, on Esc, ⌘↩, or focus leaving it,
 * and the editor waits for that save before it goes
 * (`plan-field-editor-model.ts` decides every save). An editor stays where it
 * opened while it stands, even once its first save draws the field it edits
 * elsewhere in the document, so the inputs never move under the typing. The
 * box is a textarea, never `contenteditable`: the session recording masks an
 * input's value itself, and the editor stands under
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

/** The document's one field editor, where it stands, and its doors. */
export interface FieldEditing {
  readonly editor: FieldEditor | undefined;
  readonly host: EditorHost | undefined;
  readonly open: (target: EditTarget, host: EditorHost) => void;
  readonly typeText: (text: string) => void;
  readonly close: () => void;
  readonly keepMine: () => void;
  readonly takeLukes: () => void;
  readonly retry: () => void;
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
  const changed = (next: (now: FieldEditor) => FieldEditor) => {
    setEditor((now) => (now === undefined ? now : next(now)));
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
      const held = latest.current;
      const request = held === undefined ? undefined : pendingSave(held);
      if (request !== undefined) door.current(request).catch(() => undefined);
    };
  }, [planId]);

  return {
    editor,
    host,
    open: (target, where) => {
      if (content === undefined) return;
      if (editor !== undefined && !editorCloses(editorCloseAsked(editor))) return;
      setEditor(editorOpened(target, content));
      setHost(where);
    },
    typeText: (text) => changed((now) => editorTyped(now, text)),
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
  };
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
        <RetryButton onRetry={editing.retry} />
      </div>
    );
  }
  if (editor.sending !== undefined) {
    return <p className="plan-field-note plan-field-saving">Saving…</p>;
  }
  return null;
}

/** What a box holds before anything is typed, by the field it edits. */
function placeholderOf(target: EditTarget): string {
  switch (target.field) {
    case PLAN_FIELD.OPEN_QUESTIONS:
      return "One question a line";
    case PLAN_FIELD.ASSUMPTIONS:
      return "One assumption a line";
    default:
      return "Unanswered";
  }
}

/**
 * One field in its editor: the section's heading drawn as it stands, the
 * box, and what stands under it. Focus leaving the editor closes it, unless
 * it moved to another of the editor's own buttons.
 */
export function PlanFieldEditor({
  heading,
  editor,
  editing,
}: {
  heading: string | undefined;
  editor: FieldEditor;
  editing: FieldEditing;
}): React.JSX.Element {
  const label = PLAN_FIELD_HEADING[editor.target.field];
  return (
    <section
      className="plan-field-editor ph-no-capture"
      aria-label={`Editing ${label}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) editing.close();
      }}
      onKeyDown={(event) => {
        const finished = event.key === "Escape" || (event.key === "Enter" && event.metaKey);
        if (!finished) return;
        event.preventDefault();
        event.stopPropagation();
        editing.close();
      }}
    >
      {heading === undefined ? null : <MarkdownMessage words={heading} className="plan-unit" />}
      <textarea
        className="plan-field-input"
        value={editor.draft}
        aria-label={label}
        placeholder={placeholderOf(editor.target)}
        // biome-ignore lint/a11y/noAutofocus: the developer asked for this field's editor, so typing goes there.
        autoFocus
        spellCheck
        onChange={(event) => editing.typeText(event.target.value)}
      />
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
 * pencil.
 */
export function EditableUnit({
  target,
  host,
  editing,
  children,
}: {
  target: EditTarget;
  host: EditorHost;
  editing: FieldEditing;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the button beside the words is the keyboard's way into the same editor.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the button beside the words is the keyboard's way into the same editor.
    <div
      className="plan-unit-editable"
      onClick={(event) => {
        if (editsOnClick(event.target)) editing.open(target, host);
      }}
    >
      {children}
      <button
        type="button"
        className="icon-button plan-unit-edit"
        aria-label={`Edit ${PLAN_FIELD_HEADING[target.field]}`}
        onClick={(event) => {
          event.stopPropagation();
          editing.open(target, host);
        }}
      >
        <PencilIcon />
      </button>
    </div>
  );
}
