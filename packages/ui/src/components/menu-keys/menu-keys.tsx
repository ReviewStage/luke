/**
 * menu-keys.tsx -- the keys a list keyed from somewhere else hears, named at its foot: ↑↓ Move · ↵ Insert · esc Close.
 *
 * A list hung from an editor, the `@` list and the `/` menu, takes its keys
 * from the caret rather than the focus, so nothing on it says which keys it
 * hears; its foot does, behind a hairline, each key in the muted ink before
 * what it does in the subtle one. It is the list's own surface's foot, run
 * edge to edge on a surface with no inset, its words in line with the rows'.
 * The keys are what the owner hears now, so a list whose keys change with
 * what it shows hands new ones. A finger picks a row by pressing it, so
 * under one the foot is not drawn. It is read by nobody: a reader moves
 * through the list by the same keys and hears each row as it goes.
 */

/** One key a list hears: the key as its glyphs, and what it does in a word. */
export interface MenuKey {
  readonly keys: string;
  readonly does: string;
}

/** The foot naming `keys`, in the order given. */
export function MenuKeys({ keys }: { keys: readonly MenuKey[] }): React.JSX.Element {
  return (
    <div className="luke-menu-keys" aria-hidden="true">
      {keys.map((key) => (
        <span key={key.does} className="luke-menu-keys-item">
          <kbd className="luke-menu-keys-key">{key.keys}</kbd> {key.does}
        </span>
      ))}
    </div>
  );
}
