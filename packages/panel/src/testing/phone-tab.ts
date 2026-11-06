import { act, createElement } from "react";
import { HandTabActionsContext, type TabActionGroups } from "../desktop/strip-tabs.js";
import { SHELL_ROOM } from "../shell-room.js";
import { ShellRoomContext } from "../stage-room.js";

export interface PhoneHanded {
  readonly labels: () => string[];
  readonly item: (label: string) => { readonly disabled: boolean; readonly detail?: string };
  readonly press: (label: string, opener?: HTMLElement) => void;
}

export function onPhone(element: React.ReactNode): {
  readonly element: React.ReactElement;
  readonly handed: PhoneHanded;
} {
  let held: TabActionGroups | undefined;
  const find = (label: string) => {
    const found = (held ?? []).flat().find((each) => each.label === label);
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
        const detail = "detail" in found ? found.detail : undefined;
        return {
          disabled: "disabled" in found && found.disabled === true,
          ...(detail === undefined ? {} : { detail }),
        };
      },
      press: (label, opener = document.body) => {
        const found = find(label);
        act(() => {
          if ("items" in found || "panel" in found) return;
          if ("onAsk" in found) found.onAsk(opener);
          else found.onSelect();
        });
      },
    },
  };
}
