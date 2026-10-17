/**
 * task-title.tsx -- the task's name, drawn as the title over its text.
 *
 * A plan's text holds no title line, since its name is its own and is
 * renamed apart from the text (`docs/TASKS.md`). So the window draws the
 * name over the text, in the look of a `#` heading, as an element of its own
 * ahead of the text's first section, where the title can be edited in the
 * same flow as the text (`plan-document-editor.tsx`). Nothing here reads or
 * writes the name but the task it is handed.
 */

/** The title over a plan's text, drawn as a `#` heading. */
export function PlanTitle({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="markdown task-title">
      <p className="markdown-heading" data-level="1">
        {name}
      </p>
    </div>
  );
}
