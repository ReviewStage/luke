import type { ShortcutChord } from "@repo/settings/shortcuts";
import { Shortcut } from "../shortcut/shortcut.js";

export interface MenuKey {
  readonly keys: readonly ShortcutChord["key"][];
  readonly does: string;
}

export function menuKey(does: string, ...keys: ShortcutChord["key"][]): MenuKey {
  return { keys, does };
}

export function MenuKeys({ keys }: { keys: readonly MenuKey[] }): React.JSX.Element {
  return (
    <div className="ui-menu-keys" aria-hidden="true">
      {keys.map((entry) => (
        <span key={entry.does} className="ui-menu-keys-item">
          <span className="ui-menu-keys-key">
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
