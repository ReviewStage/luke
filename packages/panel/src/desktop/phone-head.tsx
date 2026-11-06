import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  BackButton,
  dropBelow,
  IconButton,
  MoreButton,
  moreLabel,
  NO_BACK_KEY,
  SearchIcon,
  TOOLBAR_INSET,
  TOOLBAR_LOOK,
  Toolbar,
  type ToolbarPickUp,
  type ToolbarProps,
  Tooltip,
  useMenu,
} from "@repo/ui";
import { useEffect, useRef, useState } from "react";
import { appCommandOffered, runAppCommand } from "../app-commands.js";
import { ActionMenu, type MenuAction, type MenuEnds, type MenuEntry } from "./action-menu.js";
import { OfflineStrip } from "./offline-mark.js";
import type { TaskHeadBack } from "./task-pane-switcher.js";

export interface MenuAsk {
  readonly opener: HTMLElement;
  readonly turn: number;
}

export function useAskedMenu(
  show: (placement: ReturnType<typeof dropBelow>, opener: HTMLElement) => void,
  ask: MenuAsk | undefined,
): void {
  const answered = useRef(ask);
  useEffect(() => {
    if (ask === undefined || ask === answered.current) return;
    answered.current = ask;
    show(dropBelow(ask.opener), ask.opener);
  }, [ask, show]);
}

export function useMenuAsk(): {
  ask: MenuAsk | undefined;
  onAsk: (opener: HTMLElement) => void;
} {
  const [ask, setAsk] = useState<MenuAsk | undefined>(undefined);
  return {
    ask,
    onAsk: (opener) => setAsk((was) => ({ opener, turn: (was?.turn ?? 0) + 1 })),
  };
}

export interface PhoneHeadSlots {
  place: string;
  start: React.ReactNode;
  title?: React.ReactNode;
  titleReplayUnmasked?: boolean | undefined;
  pickUp?: ToolbarPickUp | undefined;
  tag?: React.ReactNode;
  end: React.ReactNode;
}

export function phoneBar({
  place,
  start,
  title,
  titleReplayUnmasked,
  pickUp,
  tag,
  end,
}: PhoneHeadSlots): ToolbarProps {
  return {
    look: TOOLBAR_LOOK.PHONE,
    place,
    folded: true,
    start: TOOLBAR_INSET.COLUMN,
    end: TOOLBAR_INSET.COLUMN,
    lead: start,
    title,
    titleReplayUnmasked,
    pickUp,
    tag,
    actions: end,
  };
}

export function PhoneHead(slots: PhoneHeadSlots): React.JSX.Element {
  return (
    <>
      <Toolbar {...phoneBar(slots)} />
      <OfflineStrip />
    </>
  );
}

export function PhoneBack({ back }: { back: TaskHeadBack }): React.JSX.Element {
  return (
    <BackButton label={back.label} place={back.label} command={NO_BACK_KEY} onBack={back.onPress} />
  );
}

export function phoneFindGroups(): MenuAction[][] {
  if (!appCommandOffered(APP_COMMAND.FIND)) return [];
  return [
    [
      {
        label: APP_SHORTCUTS[APP_COMMAND.FIND].label,
        icon: <SearchIcon />,
        command: APP_COMMAND.FIND,
        onSelect: () => runAppCommand(APP_COMMAND.FIND),
      },
    ],
  ];
}

export function PhoneFindButton(): React.JSX.Element {
  const { label } = APP_SHORTCUTS[APP_COMMAND.FIND];
  return (
    <Tooltip label={label} command={APP_COMMAND.FIND}>
      <IconButton
        icon={<SearchIcon />}
        label={label}
        onClick={() => runAppCommand(APP_COMMAND.FIND)}
      />
    </Tooltip>
  );
}

export function PlaceMore({
  thing,
  shown,
  groups,
  ends,
  replayUnmasked,
}: {
  thing: string;
  shown: boolean;
  groups: (opener: HTMLElement) => readonly (readonly MenuEntry[])[];
  ends?: (() => MenuEnds | undefined) | undefined;
  replayUnmasked?: boolean | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const drawn = menu.drawn === undefined ? undefined : ends?.();
  return (
    <>
      <MoreButton thing={thing} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(thing)}
          menu={menu.drawn}
          subject={drawn?.subject}
          footer={drawn?.footer}
          groups={groups(menu.drawn.opener)}
          onClose={menu.close}
          replayUnmasked={replayUnmasked}
        />
      )}
    </>
  );
}
