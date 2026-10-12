/**
 * plan-template-editor.tsx -- the plan template's words as the developer edits them: the editor a plan that is one document is written in.
 *
 * The template is a plan's text before it is a plan, so it is edited as one
 * is (`../plan-editor/`), drawn as a plan draws, with no title over it and no
 * merged answer to take: the page hands it the text, hears each change, and
 * hears the developer leave it, and saves on a pause of its own. Esc leaves
 * it as focus leaving does. The editor is built once on the text it opens
 * with and again only for words it did not write, as Reset to default's are,
 * so the page's own echo of a change never redraws it under the caret. The
 * page stands it under `ph-no-capture`, so the session recording keeps
 * neither the words nor the rhythm of the typing. While its bundle loads the
 * box stands empty, and should the bundle fail, the template is a plain
 * Markdown box in the code face, so it can still be edited.
 */

import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useLayoutEffect, useRef, useState } from "react";
import type { PlanEditorHandle, PlanEditorProps } from "../plan-editor/contract";
import { MountedPlanEditor, planEditorAtom } from "../planning/plan-document-editor";

/** What the page hands whichever editor stands here. */
export interface PlanTemplateEditorProps {
  /** The template as the editor shows it. */
  text: string;
  /** The editor's accessible name. */
  label: string;
  /** Hears every change, with the whole text. */
  onText: (text: string) => void;
  /** Hears focus leave the editor. */
  onLeave: () => void;
}

/** The plain box the template is edited in when the editor's bundle could not be loaded. */
function PlainTemplate({
  text,
  label,
  onText,
  onLeave,
}: PlanTemplateEditorProps): React.JSX.Element {
  return (
    <textarea
      className="plan-template-input"
      value={text}
      aria-label={label}
      spellCheck
      onChange={(event) => onText(event.target.value)}
      onBlur={onLeave}
    />
  );
}

export function PlanTemplateEditor(props: PlanTemplateEditorProps): React.JSX.Element {
  const { text, label, onText, onLeave } = props;
  const module = useAtomValue(planEditorAtom);
  const handle = useRef<PlanEditorHandle | undefined>(undefined);
  // The text the editor holds, and how many times it has been built on text it did not write.
  const written = useRef(text);
  const [built, setBuilt] = useState(0);
  useLayoutEffect(() => {
    if (text === written.current) return;
    written.current = text;
    setBuilt((count) => count + 1);
  }, [text]);
  if (AsyncResult.isFailure(module)) return <PlainTemplate {...props} />;
  if (!AsyncResult.isSuccess(module))
    return <div className="plan-template-editor" aria-busy="true" />;
  const editor: PlanEditorProps = {
    markdown: text,
    placement: undefined,
    focus: false,
    label,
    className: "markdown",
    onDraft: (markdown) => {
      written.current = markdown;
      onText(markdown);
    },
    onFinish: () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    },
    onLeaveUp: () => undefined,
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: the box holds an editor, not a form's controls, so it is no `<fieldset>`.
    <div
      className="plan-template-editor"
      role="group"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onLeave();
      }}
    >
      <MountedPlanEditor key={built} module={module.value} props={editor} handle={handle} />
    </div>
  );
}
