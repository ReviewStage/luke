import type { Plan } from "@sidecar/hosted/plan-wire";

/**
 * plan-title.tsx -- the name of a plan that is one document, drawn as the title over its text.
 *
 * A plan kept as the template's fields holds its title in its body: the
 * `# Name` line the formatter opens it with. A plan that is one document
 * holds no title line, since its name is its own and is renamed apart from
 * the text (`docs/PLANNING.md`). So the window draws the name over the text,
 * in the look that line had, as an element of its own ahead of the text's
 * first section, where the title can be edited in the same flow as the text.
 * Nothing here reads or writes the name but the plan it is handed.
 */

/** The title a plan's text is drawn under: the name of a plan that is one document; none for a plan of the template's fields, whose body holds its title. */
export function documentTitleOf(plan: Pick<Plan, "name" | "fields">): string | undefined {
  return plan.fields === undefined ? plan.name : undefined;
}

/** The title over a document's text, drawn as the `# Name` line a body of fields opens with. */
export function PlanTitle({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="markdown plan-title">
      <p className="markdown-heading" data-level="1">
        {name}
      </p>
    </div>
  );
}
