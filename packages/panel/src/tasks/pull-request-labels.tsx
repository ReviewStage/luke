import type { PullRequestLabel } from "@luke/features/coding-agent-wire";
import { Badge, GAP, Inline, LAYOUT_ELEMENT } from "@luke/ui";

/**
 * pull-request-labels.tsx -- a pull request's labels at the end of its header's line of people, each a badge filled with its GitHub colour, readable in either appearance.
 *
 * A label is told from another by its colour, so each is `@luke/ui`'s
 * filled `Badge`, which draws it as GitHub does in either appearance and
 * fades its name at its end where the header is too narrow to hold it; a
 * colour GitHub spells any other way draws it neutral.
 */

/** The pull request's labels, in the order GitHub lists them; nothing where it has none. */
export function PullRequestLabels({
  labels,
}: {
  labels: readonly PullRequestLabel[];
}): React.JSX.Element | null {
  if (labels.length === 0) return null;
  return (
    <Inline
      as={LAYOUT_ELEMENT.UL}
      gap={GAP.TIGHT}
      className="pull-request-labels"
      aria-label="Labels"
    >
      {labels.map((label) => (
        <li key={label.name} className="pull-request-label">
          <Badge fill={label.color}>{label.name}</Badge>
        </li>
      ))}
    </Inline>
  );
}
