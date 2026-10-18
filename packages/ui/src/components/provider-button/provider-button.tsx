import { useId } from "react";
import { type MarkProvider, ProviderMark } from "../../marks/provider-mark.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
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
 * A pending button is the sign-in being opened or waited on: it refuses its
 * press and is named by `pendingLabel` ("Opening Google", "Waiting for
 * browser…") for as long as it is. A control button shows that name to a
 * reader alone, under the Button's ring; a gate button shows it beside a
 * ring standing in the mark's place, and keeps its full strength while the
 * others beside it, disabled by the caller, step back.
 *
 * The way in taken last (`lastUsed`) wears "Last used" on its top-right
 * corner, a pill hung over the button rather than a word inside it, so the
 * button is still named by its words alone and the pill describes it.
 */

/** How tall a provider's button stands: the profile's control, or the sign-in gate's own. */
export const PROVIDER_BUTTON_SIZE = {
  CONTROL: "control",
  GATE: "gate",
} as const;

export type ProviderButtonSize = (typeof PROVIDER_BUTTON_SIZE)[keyof typeof PROVIDER_BUTTON_SIZE];

/** What the last-used pill says. */
const LAST_USED = "Last used";

/** The gate's own button: the mark, or the ring while pending, before its words. */
function GateButton({
  provider,
  words,
  primary,
  pending,
  disabled,
  describedBy,
  onPress,
}: {
  provider: MarkProvider;
  words: string;
  primary: boolean;
  pending: boolean;
  disabled: boolean;
  describedBy: string | undefined;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="luke-provider-button"
      data-primary={primary ? "true" : undefined}
      disabled={disabled || pending}
      aria-busy={pending ? true : undefined}
      aria-describedby={describedBy}
      onClick={onPress}
    >
      {pending ? (
        <span className="luke-provider-button-wait">
          <SpinnerRing />
        </span>
      ) : (
        <ProviderMark provider={provider} />
      )}
      {words}
    </button>
  );
}

/** One provider's button, named "Continue with" `name`, or `pendingLabel` while pending. */
export function ProviderButton({
  provider,
  name,
  size = PROVIDER_BUTTON_SIZE.CONTROL,
  primary = false,
  pending = false,
  pendingLabel,
  disabled = false,
  lastUsed = false,
  onPress,
}: {
  provider: MarkProvider;
  /** The provider's name as a reader knows it ("GitHub"). */
  name: string;
  size?: ProviderButtonSize;
  /** Whether it is the filled one among the choices. */
  primary?: boolean;
  /** Whether its sign-in is being opened or waited on. */
  pending?: boolean;
  /** What it is named while pending, the act in progress ("Opening GitHub"). */
  pendingLabel: string;
  disabled?: boolean;
  /** Whether it is the way in taken last, which wears the pill that says so. */
  lastUsed?: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const badge = useId();
  const words = `Continue with ${name}`;
  const describedBy = lastUsed ? badge : undefined;
  return (
    <span className="luke-provider-button-slot">
      {size === PROVIDER_BUTTON_SIZE.GATE ? (
        <GateButton
          provider={provider}
          words={pending ? pendingLabel : words}
          primary={primary}
          pending={pending}
          disabled={disabled}
          describedBy={describedBy}
          onPress={onPress}
        />
      ) : (
        <Button
          variant={primary ? BUTTON_VARIANT.INK : BUTTON_VARIANT.OUTLINE}
          icon={<ProviderMark provider={provider} />}
          busy={pending}
          busyLabel={pendingLabel}
          disabled={disabled}
          aria-describedby={describedBy}
          onClick={onPress}
        >
          {words}
        </Button>
      )}
      {lastUsed ? (
        <span id={badge} className="luke-provider-button-last-used">
          {LAST_USED}
        </span>
      ) : null}
    </span>
  );
}
