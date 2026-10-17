import { SETTINGS_SEARCH_ANCHOR_ATTRIBUTE } from "@luke/settings/settings-anchors";
import { ErrorState } from "@luke/ui";
import { useId } from "react";

/**
 * settings-group.tsx -- one group of a Settings page: its name above a card of rows.
 *
 * The name stands outside the card, small and muted, and the card holds the
 * rows with a hairline between each and the next. A page that is one group
 * passes no name: the page's own title already says what the rows are. A
 * named group is a region named by its heading, so a reader moving by
 * landmark hears what the rows are for before reaching them. A group of one
 * control that is its own frame, a text area, stands it under the name
 * without the card, so no frame is drawn within a frame.
 */
export function SettingsGroup({
  title,
  anchor,
  framed = true,
  children,
}: {
  title?: string | undefined;
  /** The id a Settings link or a search result lands on: worn by the whole group. */
  anchor?: string;
  /** Whether the children stand in the card; false for one control that draws its own frame. */
  framed?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const headingId = useId();
  return (
    <section
      className="settings-group"
      aria-labelledby={title ? headingId : undefined}
      {...(anchor === undefined ? undefined : { [SETTINGS_SEARCH_ANCHOR_ATTRIBUTE]: anchor })}
    >
      {title ? (
        <h2 id={headingId} className="settings-group-title">
          {title}
        </h2>
      ) : null}
      {framed ? <div className="settings-card">{children}</div> : children}
    </section>
  );
}

/** A card's line where the read of its rows did not land: the read failure, then Retry, in the rows' place. */
export function ReadFailed({
  line,
  onRetry,
}: {
  line: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div className="settings-card-line">
      <ErrorState onRetry={onRetry}>{line}</ErrorState>
    </div>
  );
}
