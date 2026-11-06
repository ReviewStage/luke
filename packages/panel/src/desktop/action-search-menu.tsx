import {
  type MenuPanel,
  type MenuRow,
  type PopoverAlign,
  SEARCHABLE_MENU_LAYER,
  SearchableMenu,
} from "@repo/ui";
import { useId } from "react";
import type { MenuAction } from "./action-menu.js";

export interface ActionSearch {
  readonly label: string;
  readonly placeholder: string;
  readonly noMatch: string;
  readonly actions: readonly MenuAction[];
  readonly note?: React.ReactNode;
  readonly replayUnmasked?: boolean | undefined;
}

type ActionSearchPlace = { readonly align: PopoverAlign } | { readonly embedded: true };

function actionRows(actions: readonly MenuAction[]): readonly MenuRow[] {
  return actions.map((action, at) => ({
    id: String(at),
    label: action.label,
    icon: action.icon,
    detail: action.detail,
    ...(action.detail === undefined ? {} : { terms: [action.detail] }),
    card: action.card,
    replayMasked: action.replayMasked,
  }));
}

function checkedRows(actions: readonly MenuAction[]): ReadonlySet<string> {
  return new Set(actions.flatMap((action, at) => (action.checked === true ? [String(at)] : [])));
}

export function ActionSearchMenu({
  id,
  search,
  place,
  leaving,
  menuRef,
  onDone,
  onClose,
  onLeave,
}: {
  id?: string | undefined;
  search: ActionSearch;
  place: ActionSearchPlace;
  leaving?: boolean | undefined;
  menuRef?: ((element: HTMLElement | null) => void) | undefined;
  onDone: () => void;
  onClose: () => void;
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const minted = useId();
  const { actions } = search;
  return (
    <SearchableMenu
      {...("embedded" in place
        ? { layer: SEARCHABLE_MENU_LAYER.EMBEDDED }
        : { align: place.align })}
      id={id ?? minted}
      ref={menuRef}
      leaving={leaving}
      label={search.label}
      placeholder={search.placeholder}
      rows={actionRows(actions)}
      value={undefined}
      checked={checkedRows(actions)}
      note={search.note}
      noMatch={search.noMatch}
      replayUnmasked={search.replayUnmasked}
      onPick={(picked) => {
        const action = actions[Number(picked)];
        if (action === undefined) return;
        if (action.stays !== true) onDone();
        action.onSelect();
      }}
      onClose={onClose}
      onLeave={onLeave}
    />
  );
}

export function actionSearchPanel(
  item: { readonly label: string; readonly icon?: React.JSX.Element },
  search: ActionSearch,
): MenuPanel {
  return {
    ...item,
    panel: ({ back, close }) => (
      <ActionSearchMenu
        search={search}
        place={{ embedded: true }}
        onDone={close}
        onClose={back}
        onLeave={() => undefined}
      />
    ),
  };
}
