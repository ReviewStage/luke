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

import { PageHeader, TEXT_ELEMENT, TEXT_VARIANT, Text } from "@luke/ui";
import { UNIT_ATTRIBUTED_CLASS } from "./plan-unit-look.js";

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
    <div className={`task-title ${UNIT_ATTRIBUTED_CLASS}`}>
      <PageHeader title={name} actions={actions} />
    </div>
  );
}

/**
 * The name in the page title's role, for a page whose bar already names it by
 * its `h1`: a version of the plan, which the bar names by when it was saved.
 * Note that it is no heading, so such a page keeps the one `h1` it has.
 */
export function TextTitle({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="task-title">
      <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.P}>
        {name}
      </Text>
    </div>
  );
}
