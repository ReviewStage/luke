import type { ReactNode } from "react";

/**
 * list-row.tsx -- a List of rows, each a thing a collection holds: its title, a line under it, its metadata at the end, and the acts it offers beside it.
 *
 * A row is one line of the list: a leading mark, its title over its
 * description, and its metadata ("2h ago", "Owner") standing at the end, all
 * centred on the row's middle, and the row's own acts centred there beside
 * them, so a column of rows lines its metadata and its acts up whatever each
 * one says. A long title gives way rather than pushing either out of the row.
 *
 * A row that opens something is a button, `onPress`, named by its words in
 * the order they are drawn, title first, so a voice saying what it reads
 * presses it. Its acts are that button's siblings in the row's item, never
 * inside it, because a button holds no button: each is a control of its own,
 * reached by Tab after the row and pressed without pressing the row. A row that opens nothing is no control
 * at all. The leading mark is decoration, hidden from a reader, since the
 * title says what the row is. The row owns every length in it and takes no
 * class or style.
 */

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** A list of `ListRow`s, named by `label` for a reader moving between lists. */
export function List({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ul className="luke-list" aria-label={label}>
      {children}
    </ul>
  );
}

/** One row of a `List`: `title` over `description`, `meta` at its end, `actions` beside it. */
export function ListRow({
  leading,
  title,
  description,
  meta,
  actions,
  onPress,
  current,
}: {
  /** A mark before the title (an avatar, a status's glyph), drawn as decoration. */
  leading?: ReactNode;
  /** What the row is, which its name opens with. */
  title: ReactNode;
  description?: ReactNode;
  /** Metadata at the row's end, before its acts ("2h ago", "Owner"). */
  meta?: ReactNode;
  /** The row's own acts (an IconButton, a Button), each a control beside the row's press. */
  actions?: ReactNode;
  /** What pressing the row does; a row without one is not a control. */
  onPress?: (() => void) | undefined;
  /** Whether the row is the one open now, drawn and announced as current. */
  current?: boolean | undefined;
}): React.JSX.Element {
  const face = (
    <>
      {said(leading) ? (
        <span className="luke-list-row-leading" aria-hidden="true">
          {leading}
        </span>
      ) : null}
      <span className="luke-list-row-text">
        <span className="luke-list-row-title">{title}</span>
        {said(description) ? (
          <span className="luke-list-row-description">{description}</span>
        ) : null}
      </span>
      {said(meta) ? <span className="luke-list-row-meta">{meta}</span> : null}
    </>
  );
  return (
    <li className="luke-list-row" data-current={current === true ? "true" : undefined}>
      {onPress ? (
        <button
          type="button"
          className="luke-list-row-main"
          aria-current={current === true ? "true" : undefined}
          onClick={onPress}
        >
          {face}
        </button>
      ) : (
        <div className="luke-list-row-main">{face}</div>
      )}
      {said(actions) ? <div className="luke-list-row-actions">{actions}</div> : null}
    </li>
  );
}
