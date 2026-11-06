import type { PullRequestLabel } from "@repo/features/agent-wire";
import { Badge, GAP, Inline, LAYOUT_ELEMENT } from "@repo/ui";

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
        <li key={label.name} className="pull-request-label flex min-w-0 max-w-full">
          <Badge fill={label.color}>{label.name}</Badge>
        </li>
      ))}
    </Inline>
  );
}
