import { useAtomValue } from "@effect/atom-react";
import { ISSUE_BOUNDS } from "@luke/features/issue-wire";
import { planSections } from "@luke/features/plan-document";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePrefetchEditorBundle, useSideBundles } from "../bundle-loader";
import { MarkdownMessage } from "../markdown-message";
import { DiagramPreview } from "../plan-diagram";
import type {
  EditorDiagram,
  PlanEditorHandle,
  PlanEditorPlacement,
  PlanEditorProps,
} from "../plan-editor/contract";
import {
  EDITOR_LOAD_FAILED,
  editsOnClick,
  MountedPlanEditor,
  useEditorDrawings,
} from "../tasks/plan-document-editor";
import { useOpenLink } from "../tasks/use-open-link";

/**
 * issue-description.tsx -- an issue's description, drawn as Markdown and edited in place in the plan's own editor.
 *
 * At rest the description is drawn in the plan's read view, or a quiet line
 * asking for one where there is none; a click into its words opens the
 * plan's editor (`../plan-editor/`) in their place, the caret where the
 * click landed, and Return on the description opens it at the end. The
 * editor draws the words exactly as they were drawn, so nothing moves, and
 * writes the same Markdown: headings, lists, task items, tables, code, a
 * Mermaid block previewed as its diagram. Leaving the editor, Esc, or ⌘↩
 * sends what was typed, and so does the page going while it is open; text
 * left as it was sends nothing. The editor stays open until the service
 * keeps the save, so a refused save keeps every word and says so under it.
 * A save asked for while another is out, by a finish, a leaving, or the page
 * going, waits for it and then sends the words as they stand by then, so
 * nothing typed meanwhile is lost. Its words are document text, which the
 * recording masks.
 */

/** What stands where an issue has no description, and what the empty editor says. */
const PLACEHOLDER = "Add a description…";

/** What a refused save says under the editor. */
const REFUSED_LINE = "Couldn't save the description. Try again.";

/** What a description past its bound says under the editor, which the service would refuse. */
const TOO_LONG_LINE = `The description is too long: keep it under ${ISSUE_BOUNDS.MAX_DESCRIPTION_CHARS.toLocaleString("en-US")} characters.`;

/** The read view's class, which the editor's words wear too, so they stand where the drawn words stood. */
const READ_CLASS = "plan-unit";

/** The caret at the end of a description's words: the end of its last section. */
function atEnd(description: string): PlanEditorPlacement {
  return { section: Math.max(planSections(description).length - 1, 0) };
}

export function IssueDescription({
  description,
  onSave,
}: {
  description: string;
  /** Sends the description, answering whether it was kept. */
  onSave: (description: string) => Promise<boolean>;
}): React.JSX.Element {
  // Note that the editor stands only while it is open, so at rest the issue's own description is drawn.
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<PlanEditorPlacement | undefined>(undefined);
  const [note, setNote] = useState<string | undefined>(undefined);
  const saving = useRef(false);
  // Whether a save was asked for while one was out, which goes once that one is kept.
  const queued = useRef(false);
  const handle = useRef<PlanEditorHandle | undefined>(undefined);
  // The words the editor last handed over, read where its handle is gone.
  const drafted = useRef<string | undefined>(undefined);
  const block = useRef<HTMLDivElement>(null);
  // Whether the description takes the keyboard back as the editor closes, as it does from Esc or ⌘↩.
  const refocus = useRef(false);
  const module = useAtomValue(useSideBundles().planEditor);
  const prefetchEditorBundle = usePrefetchEditorBundle();
  const openLink = useOpenLink();
  const diagrams = useEditorDrawings<EditorDiagram>();

  const typed = () => handle.current?.markdown() ?? drafted.current ?? description;
  const begin = (at: PlanEditorPlacement) => {
    drafted.current = undefined;
    setNote(undefined);
    setPlacement(at);
    setOpen(true);
  };
  const close = () => {
    drafted.current = undefined;
    setNote(undefined);
    setOpen(false);
  };
  const save = () => {
    if (!open) return;
    if (saving.current) {
      queued.current = true;
      return;
    }
    const text = typed();
    if (text === description) {
      close();
      return;
    }
    if (text.length > ISSUE_BOUNDS.MAX_DESCRIPTION_CHARS) {
      setNote(TOO_LONG_LINE);
      return;
    }
    saving.current = true;
    onSave(text).then((kept) => {
      saving.current = false;
      const again = queued.current;
      queued.current = false;
      if (!kept) {
        setNote(REFUSED_LINE);
        return;
      }
      if (typed() === text) {
        close();
        return;
      }
      // Words typed since the save was sent stay open, and go now where a save was asked for meanwhile, the page gone or not.
      setNote(undefined);
      if (again) leave.current();
    });
  };
  const finish = () => {
    refocus.current = true;
    save();
  };
  // Note that the page going while the editor is open saves its words, because no blur reaches an editor taken out of the page.
  const leave = useRef(save);
  leave.current = save;
  useLayoutEffect(() => () => leave.current(), []);
  // Note that the keyboard is taken back only where it was left with the editor, never from a control pressed while the save was out.
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    if (document.activeElement === null || document.activeElement === document.body) {
      block.current?.focus();
    }
  });

  const drawn = (
    // biome-ignore lint/a11y/useSemanticElements: the description holds its words, headings and lists among them, not a form's controls, so it is no `<fieldset>`.
    <div
      ref={block}
      className="issue-description"
      role="group"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the description is a Tab stop as a plan's section block is, whose Return opens its editor.
      tabIndex={0}
      aria-label="Description"
      aria-keyshortcuts="Enter"
      onPointerEnter={prefetchEditorBundle}
      onFocus={prefetchEditorBundle}
      onClick={(event) => {
        if (editsOnClick(event.target)) begin({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.target !== event.currentTarget) return;
        event.preventDefault();
        begin(atEnd(description));
      }}
    >
      {description === "" ? (
        <p className="issue-description-empty">{PLACEHOLDER}</p>
      ) : (
        <MarkdownMessage words={description} className={READ_CLASS} openLink={openLink} diagrams />
      )}
    </div>
  );
  const loaded = AsyncResult.isSuccess(module) ? module.value : undefined;
  const editor = open ? loaded : undefined;
  const props: PlanEditorProps = {
    markdown: description,
    placement,
    focus: true,
    label: "Description",
    placeholder: PLACEHOLDER,
    className: `markdown ${READ_CLASS}`,
    onDraft: (markdown) => {
      drafted.current = markdown;
    },
    onFinish: finish,
    // Note that ↑ on the first line stays in the description, since the issue's title is no block of a document.
    onLeaveUp: () => undefined,
    drawDiagram: diagrams.draw,
  };
  // Note that the description stands in the same room open or not, so the
  // words drawn while the editor's bundle loads are the ones pressed, and
  // keep the keyboard: focus leaving them then opens nothing, since nothing
  // was typed, and a click's point still lands on the same word.
  return (
    <section
      className={open ? "plan-document-editor ph-no-capture" : undefined}
      aria-label={editor === undefined ? undefined : "Editing the description"}
      aria-busy={open && editor === undefined ? true : undefined}
      onBlur={(event) => {
        if (!open || event.currentTarget.contains(event.relatedTarget)) return;
        if (editor === undefined) setOpen(false);
        else save();
      }}
    >
      {editor === undefined ? (
        drawn
      ) : (
        <MountedPlanEditor module={editor} props={props} handle={handle} />
      )}
      {open && AsyncResult.isFailure(module) ? (
        <p className="issue-description-refused" role="alert">
          {EDITOR_LOAD_FAILED}
        </p>
      ) : null}
      {note === undefined ? null : (
        <p className="issue-description-refused" role="status">
          {note}
        </p>
      )}
      {diagrams.drawn.map((each) =>
        createPortal(
          <DiagramPreview code={each.what.code} previous={each.what.previous} />,
          each.element,
          each.key,
        ),
      )}
    </section>
  );
}
