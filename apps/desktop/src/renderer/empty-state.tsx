/**
 * empty-state.tsx -- a whole tab with nothing in it yet: a large, muted glyph of what belongs there above one short line.
 *
 * Only a whole tab or pane that stands empty draws one, or one whose thing
 * cannot be shown (`not-found.tsx`), and only where the glyph says what will
 * stand there: the Inbox, the side panel's Code,
 * Transcript, and Work, Factory, Automations and an automation's runs, and a Settings
 * page with nothing on it (Experimental, between experiments). A small note
 * inside a list, a menu, or a search with no match says its line alone, as do
 * a wait and a failure, which are not empty. The glyph is the tab's own, so
 * the empty tab reads as the tab it is. It is drawn on the log's own empty
 * ground (`ConversationEmptyState`), in a box that fills the room the pane
 * leaves under its header and stands it a little above that room's middle
 * (`.empty-state` in desktop.css).
 */

import { ConversationEmptyState } from "./ai-elements/conversation";

/**
 * A whole tab with nothing in it yet: `icon`, the tab's own glyph, drawn
 * large and muted over the line `children` says, and where the line alone
 * would not say what the place is, a `title` over it, drawn as the log's own
 * empty state draws its title (`ConversationEmptyState`); under it, where
 * one is given, the one way on from the place.
 */
export function EmptyState({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode;
  title?: string | undefined;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <ConversationEmptyState>
        <span className="empty-state-icon" aria-hidden="true">
          {icon}
        </span>
        {title === undefined ? (
          <p className="m-0">{children}</p>
        ) : (
          <div className="space-y-1">
            <h3 className="m-0 font-medium text-foreground">{title}</h3>
            <p className="m-0">{children}</p>
          </div>
        )}
        {action}
      </ConversationEmptyState>
    </div>
  );
}
