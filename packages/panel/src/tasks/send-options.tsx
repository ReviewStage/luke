import { SHORTCUT_KEY } from "@luke/settings/shortcuts";
import { ChevronDownIcon, IconButton, Menu, riseAboveEnd, Shortcut, useMenu } from "@luke/ui";
import { LINE_DELIVERY, type LineDelivery } from "@luke/wire";

/**
 * send-options.tsx -- the chevron beside an agent's Send while a turn runs and the box holds a message: the menu that sends it now, steering the turn, or queues it for the next.
 *
 * Send itself steers, as Enter does; the chevron offers that and the other
 * way a message can go while the agent works, queued behind its turn,
 * which ⌘↩ (Ctrl+↩ elsewhere) takes from the keyboard (`agent-composer.tsx`).
 * A queued message waits at the transcript's foot, marked as queued, until
 * the turn is over, and opens the next one.
 */

/** What the chevron and its menu say. */
const WORDS = {
  CHEVRON: "Send options",
  SEND_NOW: "Send now",
  SEND_NOW_DETAIL: "Steers this turn",
  QUEUE: "Queue for next turn",
  QUEUE_DETAIL: "Opens the next turn",
} as const;

/** The chevron and the menu it drops, each item sending the box's message its own way. */
export function SendOptions({
  disabled,
  onSend,
}: {
  /** Whether the box's message cannot go now, as Send cannot. */
  disabled: boolean;
  onSend: (delivery: LineDelivery) => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  return (
    <>
      <IconButton
        label={WORDS.CHEVRON}
        icon={<ChevronDownIcon />}
        disabled={disabled}
        {...menu.trigger(riseAboveEnd)}
      />
      {menu.drawn === undefined ? null : (
        <Menu
          label={WORDS.CHEVRON}
          menu={menu.drawn}
          groups={[
            [
              {
                label: WORDS.SEND_NOW,
                detail: WORDS.SEND_NOW_DETAIL,
                hint: <Shortcut chord={{ key: SHORTCUT_KEY.ENTER, bare: true }} />,
                onSelect: () => onSend(LINE_DELIVERY.STEER),
              },
              {
                label: WORDS.QUEUE,
                detail: WORDS.QUEUE_DETAIL,
                hint: <Shortcut chord={{ key: SHORTCUT_KEY.ENTER }} />,
                onSelect: () => onSend(LINE_DELIVERY.QUEUE),
              },
            ],
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}
