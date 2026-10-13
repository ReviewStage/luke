import { useId } from "react";

/**
 * settings-group.tsx -- one group of a Settings page: its name above a card of rows.
 *
 * The name stands outside the card, small and muted, and the card holds the
 * rows with a hairline between each and the next. A page that is one group
 * passes no name: the page's own title already says what the rows are. A
 * named group is a region named by its heading, so a reader moving by
 * landmark hears what the rows are for before reaching them.
 */
export function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const headingId = useId();
  return (
    <section className="settings-group" aria-labelledby={title ? headingId : undefined}>
      {title ? (
        <h2 id={headingId} className="settings-group-title">
          {title}
        </h2>
      ) : null}
      <div className="settings-card">{children}</div>
    </section>
  );
}
