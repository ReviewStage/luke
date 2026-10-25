import { useId } from "react";
import { type MarkProvider, PROVIDER_MARK_SIZE, ProviderMark } from "../../marks/provider-mark.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { BUTTON_VARIANT, type BusyProps, Button } from "../button/button.js";
import { useSettled } from "../spinner/settle-wait.js";
import { SpinnerRing } from "../spinner/spinner.js";

/**
 * provider-button.tsx -- the one button a sign-in offers per provider: its mark and "Continue with" its name, in one of two sizes.
 *
 * A `control` button is a Button in the profile's own control, outlined, or
 * filled in the text's ink when it is the `primary` way in, as a web page's
 * sign-in card draws its choices. A `gate` button is the taller one a
 * window offers when signing in is the one thing to do there: forty pixels
 * full-width, raised, or the ink fill when `primary`.
 *
 * A busy button is the sign-in being opened or waited on, in every button's
 * one busy shape (`busy` and `busyLabel`, `BusyProps`): it refuses its press
 * and is named by `busyLabel` ("Opening Google", "Waiting for browser…") for
 * as long as it is. A control button shows that name to a reader alone,
 * under the Button's ring; a gate button shows it beside a ring standing in
 * the mark's place, and keeps its full strength while the others beside it,
 * disabled by the caller, step back. Either shows its ring only once the
 * sign-in has been out a moment (`--luke-settle-delay`), as every busy
 * button does.
 *
 * The way in taken last (`lastUsed`) wears "Last used" on its top-right
 * corner, a pill hung over the button rather than a word inside it, so the
 * button is still named by its words alone and the pill describes it.
 *
 * A control button is shadcn/ui's, through `Button`; the gate's own and the
 * pill are drawn in Tailwind utilities over the theme.
 */

/** How tall a provider's button stands: the profile's control, or the sign-in gate's own. */
export const PROVIDER_BUTTON_SIZE = {
  CONTROL: "control",
  GATE: "gate",
} as const;

export type ProviderButtonSize = (typeof PROVIDER_BUTTON_SIZE)[keyof typeof PROVIDER_BUTTON_SIZE];

/**
 * The gate's button: forty pixels tall on the window's control corner, the
 * quiet fill in a hairline, or, primary, filled in the text's ink the way a
 * composer's send press is. Held while a sign-in is out, the button waited
 * on stays as it was, saying so, and the others step back. Only the
 * desktop's window is dragged, so a press on its bar stays a press.
 */
const GATE =
  "luke-provider-button m-0 flex h-provider-gate items-center justify-center gap-icon-gap rounded-control border-0 bg-muted px-luke-16 py-0 font-ui text-label-inline font-label text-foreground shadow-provider-gate transition-[background-color,opacity] duration-(--luke-duration-hover) ease-motion-exit pointer-coarse:h-provider-gate-touch in-data-[luke-profile=desktop]:[-webkit-app-region:no-drag] [&:hover:not(:disabled)]:bg-fill-strong [&:disabled:not([aria-busy=true])]:opacity-disabled " +
  "data-[primary=true]:bg-primary data-[primary=true]:text-primary-foreground data-[primary=true]:shadow-none data-[primary=true]:[&:hover:not(:disabled)]:bg-ink";

/**
 * "Last used": a small pill hung on the top-right corner of the button it
 * marks, overhanging it, the way a devtool's sign-in marks the way in taken
 * last. It wears the button's own ink at a tint, laid over the filled
 * button's ground rather than over nothing, so the half that overhangs the
 * page is the same solid pill as the half over the button. Its border is
 * clear and only keeps the pill's box. It lets a press fall through to the
 * button, and steps back with a button held while another's sign-in is out.
 */
const LAST_USED_PILL =
  "luke-provider-button-last-used pointer-events-none absolute -top-luke-8 -right-luke-6 rounded-luke-full border border-transparent bg-provider-last-used px-luke-6 py-0 text-tag leading-caption font-tag whitespace-nowrap text-provider-last-used-ink transition-opacity duration-(--luke-duration-hover) ease-motion-exit [.luke-provider-button:disabled:not([aria-busy=true])+&]:opacity-disabled [.luke-button:disabled+&]:opacity-disabled";

/** What the last-used pill says. */
const LAST_USED = "Last used";

/**
 * The gate's own button: the mark, or the ring once its sign-in has been out
 * a moment, before its words, which say what it is doing while it is busy.
 */
function GateButton({
  provider,
  words,
  primary,
  busy,
  busyLabel,
  disabled,
  describedBy,
  onPress,
}: {
  provider: MarkProvider;
  words: string;
  primary: boolean;
  busy: boolean;
  busyLabel: string | undefined;
  disabled: boolean;
  describedBy: string | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const ringShown = useSettled(busy);
  return (
    <button
      type="button"
      className={GATE}
      data-primary={primary ? "true" : undefined}
      disabled={disabled || busy}
      aria-busy={busy ? true : undefined}
      aria-describedby={describedBy}
      onClick={pulseOnPress(onPress, PRESS_PULSE.QUIET)}
    >
      {ringShown ? (
        <span className="luke-provider-button-wait size-luke-16 flex-[0_0_auto]">
          <SpinnerRing />
        </span>
      ) : (
        <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.ICON} />
      )}
      {busy ? busyLabel : words}
    </button>
  );
}

/** One provider's button, named "Continue with" `name`, or `busyLabel` while busy. */
export function ProviderButton({
  provider,
  name,
  size = PROVIDER_BUTTON_SIZE.CONTROL,
  primary = false,
  busy = false,
  busyLabel,
  disabled = false,
  lastUsed = false,
  onPress,
}: BusyProps & {
  provider: MarkProvider;
  /** The provider's name as a reader knows it ("GitHub"). */
  name: string;
  size?: ProviderButtonSize;
  /** Whether it is the filled one among the choices. */
  primary?: boolean;
  disabled?: boolean;
  /** Whether it is the way in taken last, which wears the pill that says so. */
  lastUsed?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const badge = useId();
  const words = `Continue with ${name}`;
  const describedBy = lastUsed ? badge : undefined;
  return (
    <span className="luke-provider-button-slot relative flex flex-col">
      {size === PROVIDER_BUTTON_SIZE.GATE ? (
        <GateButton
          provider={provider}
          words={words}
          primary={primary}
          busy={busy}
          busyLabel={busyLabel}
          disabled={disabled}
          describedBy={describedBy}
          onPress={onPress}
        />
      ) : (
        <Button
          variant={primary ? BUTTON_VARIANT.INK : BUTTON_VARIANT.OUTLINE}
          icon={<ProviderMark provider={provider} />}
          busy={busy}
          busyLabel={busyLabel ?? ""}
          disabled={disabled}
          aria-describedby={describedBy}
          onClick={onPress}
        >
          {words}
        </Button>
      )}
      {lastUsed ? (
        <span id={badge} className={LAST_USED_PILL}>
          {LAST_USED}
        </span>
      ) : null}
    </span>
  );
}
