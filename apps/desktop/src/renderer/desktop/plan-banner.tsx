import type { ReactNode } from "react";
import { AttentionMark } from "../attention-mark";
import { BANNER_LOOK, Banner } from "../banner";

/**
 * plan-banner.tsx -- a notice about the whole plan: one slim line under the plan's toolbar, over every tab of it, which only mending what it says takes away.
 *
 * A banner over a document (`document-banner` in `desktop.css`) is about
 * that document, so it stands over the plan's own tab and nowhere else; what
 * is wrong with the plan itself, wherever the developer is reading it, is
 * said here instead. It spans the plan's column under the toolbar, so it
 * stands over the plan's tab, an agent's, the Inbox, and what the side panel
 * shows beside them alike, at any width of the window; while the side panel
 * fills the window it stands under the panel's bar instead, since the column
 * is covered (`desktop-plans.tsx`, `side-panel.tsx`). It reads as a devtool's
 * notice rather than a card: the attention mark, one line of words, and the
 * one press that mends it, on a faint attention tint. It has no close: it
 * goes once what it says no longer holds. Its words are text, never an
 * attribute, because the session recording masks text and nothing else. Where
 * the column is narrow it gives way as every banner does (`banner.tsx`):
 * the words wrap and the press takes a line of its own beneath them.
 */

/** The press that mends what a banner says: its words, and what it does. */
interface PlanBannerAction {
  readonly label: string;
  readonly onPress: () => void;
}

/** The banner: its words, and the press that mends what they say. */
export function PlanBanner({
  children,
  action,
}: {
  /** The one line: what is wrong with the plan. */
  children: ReactNode;
  action: PlanBannerAction;
}): React.JSX.Element {
  return (
    <Banner
      look={BANNER_LOOK.LINE}
      glyph={<AttentionMark />}
      actions={
        <button type="button" className="plan-banner-action" onClick={action.onPress}>
          {action.label}
        </button>
      }
    >
      <p className="plan-banner-words">{children}</p>
    </Banner>
  );
}
