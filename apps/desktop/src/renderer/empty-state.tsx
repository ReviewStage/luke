/**
 * empty-state.tsx -- a whole tab with nothing in it yet: a large, muted glyph of what belongs there above one short line.
 *
 * Only a whole tab or pane that stands empty draws one, and only where the
 * glyph says what will stand there: the side panel's Code, Transcript, and
 * Work. A small note inside a list, a menu, or a search
 * with no match says its line alone, as do a wait and a failure, which are
 * not empty. The glyph is the tab's own, so the empty tab reads as the
 * tab it is. It is drawn on the log's own empty ground
 * (`ConversationEmptyState`), centred in whatever room the tab gives it.
 */

import { ConversationEmptyState } from "./ai-elements/conversation";

/** A whole tab with nothing in it yet: `icon`, the tab's own glyph, drawn large and muted over the line `children` says. */
export function EmptyState({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ConversationEmptyState className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        {icon}
      </span>
      <p className="m-0">{children}</p>
    </ConversationEmptyState>
  );
}
