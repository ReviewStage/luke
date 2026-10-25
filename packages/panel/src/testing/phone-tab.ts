/**
 * phone-tab.ts -- a tab's body drawn as a phone's side panel draws it: in a narrow room, under the door its header's ⋯ is handed what the body offers (`strip-tabs.tsx`'s `useTabActions`), that offer held to be read and pressed.
 */

import { act, createElement } from "react";
import { HandTabActionsContext, type TabActionGroups } from "../desktop/strip-tabs.js";
import { SHELL_ROOM } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";

/** What a tab drawn on a phone handed its header's ⋯, as the ⋯ would offer it. */
export interface PhoneHanded {
  /** The items' names in the order the ⋯ offers them; none once the body handed none. */
  readonly labels: () => string[];
  /** The item named `label`, as the ⋯ draws it. */
  readonly item: (label: string) => { readonly disabled: boolean; readonly detail?: string };
  /** Chooses the item named `label`, as a press in the ⋯ does, an item opening one of the body's own under `opener`. */
  readonly press: (label: string, opener?: HTMLElement) => void;
}

/** `element` as a phone's panel draws it, and what it hands its header's ⋯. */
export function onPhone(element: React.ReactNode): {
  readonly element: React.ReactElement;
  readonly handed: PhoneHanded;
} {
  let held: TabActionGroups | undefined;
  const find = (label: string) => {
    const found = (held ?? []).flat().find((each) => each.label === label);
    // Note that this throws rather than asserting, because a module the panel's bundle could reach names no `node:` module (`repository-checks.sh`).
    if (found === undefined) throw new Error(`the ⋯ offers no ${label}`);
    return found;
  };
  return {
    element: createElement(
      ShellRoomContext.Provider,
      { value: SHELL_ROOM.NARROW },
      createElement(
        HandTabActionsContext.Provider,
        {
          value: (actions) => {
            held = actions;
          },
        },
        element,
      ),
    ),
    handed: {
      labels: () => (held ?? []).flat().map((each) => each.label),
      item: (label) => {
        const found = find(label);
        return {
          disabled: found.disabled === true,
          ...(found.detail === undefined ? {} : { detail: found.detail }),
        };
      },
      press: (label, opener = document.body) => {
        const found = find(label);
        act(() => {
          if ("onAsk" in found) found.onAsk(opener);
          else found.onSelect();
        });
      },
    },
  };
}
