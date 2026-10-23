import { FILL_ELEMENT, Fill } from "@luke/ui";
import type { ReactNode, Ref } from "react";

/**
 * agent-tab-frame.tsx -- an agent's tab's own boxes: the tab, filling its column, and its foot, where the composer docks under the transcript.
 *
 * Every agent's tab draws these, a started agent's, one still starting, a
 * draft's, a worker's, and so does the tab's skeleton while the agent is
 * read (`agent-tab-skeleton.tsx`), so the skeleton stands in the boxes the
 * tab lands in rather than in a copy of them. The tab is unrecorded
 * (`ph-no-capture`), since it holds the transcript's words.
 */

/** The tab: a section taking its column's room, named `label` to a reader. */
export function AgentTabFrame({
  label,
  ref,
  children,
}: {
  label?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Fill
      as={FILL_ELEMENT.SECTION}
      ref={ref}
      className="agent-tab ph-no-capture"
      aria-label={label}
    >
      {children}
    </Fill>
  );
}

/** The tab's foot, under its transcript: what docks over the composer, and the composer. */
export function AgentTabFoot({ children }: { children: ReactNode }): React.JSX.Element {
  return <footer className="agent-tab-foot">{children}</footer>;
}
