import { SHORTCUT_KEY } from "@luke/settings/shortcuts";
import { ChevronDownIcon, IconButton, Menu, riseAboveEnd, Shortcut, useMenu } from "@luke/ui";
import { GLYPH } from "@luke/ui/icons";

/**
 * send-options.tsx -- the chevron beside an agent's Send while a turn runs and the box holds a message: the menu that sends it now, steering the turn, or queues it behind the turn.
 *
 * Each item prints the key that does the same from the box: ⏎ for the
 * setting's choice (`agentEnter`), ⌘⏎ for the other.
 */

/** What the chevron and its menu say. */
const WORDS = {
  CHEVRON: "Send options",
  SEND_NOW: "Send now",
  SEND_NOW_DETAIL: "Steers this turn",
  QUEUE: "Queue for next turn",
  QUEUE_DETAIL: "Opens the next turn",
} as const;

const ENTER = { key: SHORTCUT_KEY.ENTER, bare: true } as const;
const MOD_ENTER = { key: SHORTCUT_KEY.ENTER } as const;

/** The chevron and the menu it drops. */
export function SendOptions({
  enterQueues,
  disabled,
  onSteer,
  onQueue,
}: {
  /** Whether Enter queues, as the setting says, which ⌘⏎ then steers. */
  enterQueues: boolean;
  disabled: boolean;
  onSteer: () => void;
  onQueue: () => void;
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
                icon: <GLYPH.STEER />,
                hint: <Shortcut chord={enterQueues ? MOD_ENTER : ENTER} />,
                onSelect: onSteer,
              },
              {
                label: WORDS.QUEUE,
                detail: WORDS.QUEUE_DETAIL,
                icon: <GLYPH.QUEUED />,
                hint: <Shortcut chord={enterQueues ? ENTER : MOD_ENTER} />,
                onSelect: onQueue,
              },
            ],
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}
