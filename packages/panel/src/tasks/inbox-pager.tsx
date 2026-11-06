import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import { PAGER_AXIS, Pager } from "@repo/ui";
import { useAppCommand } from "../app-commands.js";
import { type InboxListed, type InboxListView, inboxEnds, inboxSteps } from "./inbox-model.js";

export interface InboxPager {
  readonly count: { readonly at: number; readonly total: number } | undefined;
  readonly onPrevious: (() => void) | undefined;
  readonly onNext: (() => void) | undefined;
}

export interface InboxPagerPlace {
  readonly shown: boolean;
}

export function useInboxPager(
  steps: InboxListView,
  rows: InboxListView,
  chosen: string | undefined,
  onChoose: (listed: InboxListed) => void,
  place: InboxPagerPlace,
): InboxPager | undefined {
  const at = inboxSteps(steps, chosen);
  const row = inboxSteps(rows, chosen);
  const ends = chosen === undefined ? inboxEnds(steps) : undefined;
  const previous = at === undefined ? ends?.last : at.previous;
  const next = at === undefined ? ends?.first : at.next;
  const onPrevious = previous === undefined ? undefined : () => onChoose(previous);
  const onNext = next === undefined ? undefined : () => onChoose(next);
  useAppCommand(APP_COMMAND.PREVIOUS_INBOX_ITEM, place.shown ? onPrevious : undefined);
  useAppCommand(APP_COMMAND.NEXT_INBOX_ITEM, place.shown ? onNext : undefined);
  if (at === undefined) return undefined;
  return {
    count: row === undefined ? undefined : { at: row.at, total: row.total },
    onPrevious,
    onNext,
  };
}

export function InboxPagerControls({ pager }: { pager: InboxPager }): React.JSX.Element {
  return (
    <Pager
      axis={PAGER_AXIS.VERTICAL}
      place={pager.count}
      previous={{
        label: "Previous item",
        chord: APP_SHORTCUTS[APP_COMMAND.PREVIOUS_INBOX_ITEM].chord,
        onStep: pager.onPrevious,
      }}
      next={{
        label: "Next item",
        chord: APP_SHORTCUTS[APP_COMMAND.NEXT_INBOX_ITEM].chord,
        onStep: pager.onNext,
      }}
    />
  );
}
