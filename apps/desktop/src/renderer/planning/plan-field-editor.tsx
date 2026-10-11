import { useAtom } from "@effect/atom-react";
import type { PlanEditRequest } from "@sidecar/hosted/plan-edit";
import {
  PLAN_FIELD_HEADING,
  type PlanTextField,
  planTextFieldValue,
} from "@sidecar/hosted/plan-template";
import type { PlanFields } from "@sidecar/hosted/plan-wire";
import type { PlanningEditAnswer } from "@sidecar/hosted/planning-view";
import { PencilIcon } from "@sidecar/panel";
import { Duration, Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";
import { MarkdownMessage } from "../markdown-message";
import { rendererRuntime } from "../renderer-runtime";
import {
  CONFLICT_NOTE,
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
  pendingAnswer,
} from "./plan-field-editor-model";

/**
 * plan-field-editor.tsx -- the open plan's field editor: a field's Markdown in a plain text box in place of its answer, saved as the developer pauses.
 *
 * A field of the document opens in an editor on a click into its words, or
 * from its pencil, which is the keyboard's way in; the heading stays drawn
 * above it, since the formatter owns every heading. The words save a beat
 * after the developer stops typing and again as the editor closes, on Esc,
 * ⌘↩, or focus leaving it, and the editor waits for that save before it goes
 * (`plan-field-editor-model.ts` decides every save). The box is a textarea,
 * never `contenteditable`: the session recording masks an input's value
 * itself, and the editor stands under `ph-no-capture` besides, so not even
 * the rhythm of the typing is recorded. Unsaved words live in this window's
 * memory alone and are never written to disk.
 */

/** How long the developer pauses before what they typed is saved. */
const SAVE_PAUSE = Duration.seconds(1);

/** The pause before a save, as an atom whose work is the wait; setting it again starts the wait over. */
const savePauseAtom = rendererRuntime.fn((stamp: number) =>
  Effect.as(Effect.sleep(SAVE_PAUSE), stamp),
);

/** How the document saves an edit: the field, the answer the words were written from, and the developer's. */
export type PlanEditDoor = (request: PlanEditRequest) => Promise<PlanningEditAnswer>;

/** The document's one field editor, and its doors. */
export interface FieldEditing {
  readonly editor: FieldEditor | undefined;
  readonly open: (field: PlanTextField) => void;
  readonly type: (text: string) => void;
  readonly close: () => void;
  readonly keepMine: () => void;
  readonly takeLukes: () => void;
  readonly retry: () => void;
}

/**
 * The editor over the open plan's fields as `fields` holds them. One field
 * is open at a time: a field asked for while another still has words to
 * save or a choice to make leaves that one open.
 */
export function useFieldEditing(
  planId: string,
  fields: PlanFields | undefined,
  edit: PlanEditDoor,
): FieldEditing {
  const [editor, setEditor] = useState<FieldEditor | undefined>(undefined);
  const [pause, restartPause] = useAtom(savePauseAtom);
  // Note that these are refs, because a save's answer and the pause's end
  // read them as they land, which no render stands between.
  const latest = useRef(editor);
  latest.current = editor;
  const stamp = useRef(0);

  const send = () => {
    const held = latest.current;
    if (held === undefined) return;
    const answer = pendingAnswer(held);
    if (answer === undefined) return;
    const { field } = held;
    setEditor(editorSent(held, answer));
    edit({ field, base: held.base, value: answer }).then(
      (answered) =>
        setEditor((now) => (now?.field === field ? editorAnswered(now, answered) : now)),
      (refused: Error) =>
        setEditor((now) => (now?.field === field ? editorRefused(now, refused.message) : now)),
    );
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

  // Another plan opened takes the editor with it; its save still out lands on nothing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the plan changing is what closes it.
  useEffect(() => setEditor(undefined), [planId]);

  return {
    editor,
    open: (field) => {
      if (fields === undefined) return;
      if (editor !== undefined && !editorCloses(editorCloseAsked(editor))) return;
      setEditor(editorOpened(field, planTextFieldValue(fields, field)));
    },
    type: (text) => {
      setEditor((now) => (now === undefined ? now : editorTyped(now, text)));
      stamp.current += 1;
      restartPause(stamp.current);
    },
    close: () => setEditor((now) => (now === undefined ? now : editorCloseAsked(now))),
    keepMine: () => {
      setEditor((now) => (now === undefined ? now : editorKeptMine(now)));
      stamp.current += 1;
      restartPause(stamp.current);
    },
    takeLukes: () => setEditor((now) => (now === undefined ? now : editorTookLukes(now))),
    retry: () => {
      if (latest.current === undefined) return;
      latest.current = editorRetried(latest.current);
      send();
    },
  };
}

/** The heading line a unit opens with, which stays drawn above its editor. */
function headingOf(words: string): string {
  return words.split("\n", 1)[0] ?? "";
}

/** What stands under the box: Luke's change and the choice it asks, a failed save and its retry, or a save under way. */
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

/**
 * One field in its editor: the unit's heading drawn as it stands, the box
 * holding the field's Markdown, and what stands under it. Focus leaving the
 * editor closes it, unless it moved to one of the editor's own buttons.
 */
export function PlanFieldEditor({
  words,
  editor,
  editing,
}: {
  words: string;
  editor: FieldEditor;
  editing: FieldEditing;
}): React.JSX.Element {
  const heading = PLAN_FIELD_HEADING[editor.field];
  return (
    <section
      className="plan-field-editor ph-no-capture"
      aria-label={`Editing ${heading}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) editing.close();
      }}
    >
      <MarkdownMessage words={headingOf(words)} className="plan-unit" />
      <textarea
        className="plan-field-input"
        value={editor.text}
        aria-label={heading}
        placeholder="Unanswered"
        // biome-ignore lint/a11y/noAutofocus: the developer asked for this field's editor, so typing goes there.
        autoFocus
        spellCheck
        onChange={(event) => editing.type(event.target.value)}
        onKeyDown={(event) => {
          const finished = event.key === "Escape" || (event.key === "Enter" && event.metaKey);
          if (!finished) return;
          event.preventDefault();
          event.stopPropagation();
          editing.close();
        }}
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
 * A unit holding a text field, drawn as the document draws it, which opens
 * the field's editor on a click into its words that selects nothing, or from
 * its pencil.
 */
export function EditableUnit({
  field,
  editing,
  children,
}: {
  field: PlanTextField;
  editing: FieldEditing;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the pencil beside the words is the keyboard's way into the same editor.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the pencil beside the words is the keyboard's way into the same editor.
    <div
      className="plan-unit-editable"
      onClick={(event) => {
        if (editsOnClick(event.target)) editing.open(field);
      }}
    >
      {children}
      <button
        type="button"
        className="icon-button plan-unit-edit"
        aria-label={`Edit ${PLAN_FIELD_HEADING[field]}`}
        onClick={(event) => {
          event.stopPropagation();
          editing.open(field);
        }}
      >
        <PencilIcon />
      </button>
    </div>
  );
}
