import type { ShortcutChord } from "@luke/settings/shortcuts";
import { Shortcut } from "../shortcut/shortcut.js";

/**
 * menu-keys.tsx -- the keys a list keyed from somewhere else hears, named at its foot: ↑↓ Move · ⏎ ⇥ Insert · Esc Close.
 *
 * A list hung from an editor, the `@` list, the `/` menu and the skill list,
 * takes its keys from the caret rather than the focus, so nothing on it says
 * which keys it hears; its foot does, behind a hairline, each key and what it
 * does in the muted ink. Each key is drawn by `Shortcut`, so it is spelled
 * as every tooltip and menu spells it. It is the list's own surface's foot,
 * run edge to edge on a surface with no inset, its words in line with the
 * rows'. The keys are what the owner hears now, so a list whose keys change
 * with what it shows hands new ones. A finger picks a row by pressing it, so
 * under one the foot is not drawn. It is read by nobody: a reader moves
 * through the list by the same keys and hears each row as it goes.
 */

/** One key a list hears: the keys that do it, as the window's table names them, and what it does in a word. */
export interface MenuKey {
  readonly keys: readonly ShortcutChord["key"][];
  readonly does: string;
}

/** What `keys` do, as a foot names it: each key alone, never with Command. */
export function menuKey(does: string, ...keys: ShortcutChord["key"][]): MenuKey {
  return { keys, does };
}

/** The foot naming `keys`, in the order given. */
export function MenuKeys({ keys }: { keys: readonly MenuKey[] }): React.JSX.Element {
  return (
    <div className="luke-menu-keys" aria-hidden="true">
      {keys.map((entry) => (
        <span key={entry.does} className="luke-menu-keys-item">
          <span className="luke-menu-keys-key">
            {entry.keys.map((key) => (
              <Shortcut key={key.accelerator} chord={{ key, plain: true }} />
            ))}
          </span>
          {entry.does}
        </span>
      ))}
    </div>
  );
}
