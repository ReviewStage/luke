/**
 * task-title.tsx -- the task's name, drawn as the title over its text.
 *
 * A plan's text holds no title line, since its name is its own and is
 * renamed apart from the text (`docs/TASKS.md`). So the window draws the
 * name over the text: as a document's own header (`PageHeader`), where it is
 * the page's one `h1`, with the title's ⋯ at its end, as an element of its own
 * ahead of the text's first section, where the title can be edited in the
 * same flow as the text (`plan-document-editor.tsx`). Nothing here reads or
 * writes the name but the task it is handed.
 */

import { PageHeader } from "@luke/ui";
import { MARKDOWN_CLASS } from "@luke/ui/markdown-class";

/** The title over a plan's text: the page's `h1`, and `actions` (the title's ⋯) at its end. */
export function TaskTitle({
  name,
  actions,
}: {
  name: string;
  actions?: React.ReactNode;
}): React.JSX.Element {
  // Note that the unit's class lets the ⋯ show as the pointer or the keyboard comes onto its title, as a section's does.
  return (
    <div className="task-title plan-unit-attributed">
      <PageHeader title={name} actions={actions} />
    </div>
  );
}

/**
 * The name as a `#` heading in the text's own look, for a page that names
 * itself elsewhere: a version of the plan, and the plan template's head
 * (`PlanPageHead`), whose page draws its header itself.
 */
export function TextTitle({ name }: { name: string }): React.JSX.Element {
  return (
    <div className={`${MARKDOWN_CLASS.ROOT} task-title`}>
      <p className={MARKDOWN_CLASS.HEADING} data-level="1">
        {name}
      </p>
    </div>
  );
}
