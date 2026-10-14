import { LayersIcon } from "lucide-react";
import { EmptyState } from "../empty-state";

/**
 * stack-tab.tsx -- the plan's Stack tab: its rollout's pull requests and the coding agents working them, drawn as one stack.
 *
 * The tab stands in the plan's column while its rollout names more than one
 * pull request (`use-main-tabs.ts`). Until its cards are drawn it holds the
 * tab's glyph and one line, as a tab with nothing in it yet does.
 */

/** What the plan's Stack tab is called. */
export const STACK_TAB_LABEL = "Stack";

/** The Stack tab's glyph, on its tab and over its empty ground alike. */
export function StackGlyph(): React.JSX.Element {
  return <LayersIcon />;
}

/** What the Stack tab shows in the column. */
export function StackTab(): React.JSX.Element {
  return (
    <EmptyState icon={<StackGlyph />}>Each pull request of the rollout will stand here.</EmptyState>
  );
}
