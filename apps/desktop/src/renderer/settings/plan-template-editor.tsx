/**
 * plan-template-editor.tsx -- the plan template's words as the developer edits them: for now a plain Markdown box in the code face.
 *
 * It is a component of its own so the document editor a plan is written in
 * ("plan as one document" 6/12) can take its place without the page
 * changing: the page hands it the text, hears each change, and hears the
 * developer leave it. The box is a textarea, never `contenteditable`, and the
 * page stands it under `ph-no-capture`, so the session recording keeps
 * neither the words nor the rhythm of the typing whatever editor stands here.
 */

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

export function PlanTemplateEditor({
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
