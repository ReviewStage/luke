import { useId } from "react";
import { type MarkProvider, PROVIDER_MARK_SIZE, ProviderMark } from "../../marks/provider-mark.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { BUTTON_VARIANT, type BusyProps, Button } from "../button/button.js";
import { useSettled } from "../spinner/settle-wait.js";
import { SpinnerRing } from "../spinner/spinner.js";

export const PROVIDER_BUTTON_SIZE = {
  CONTROL: "control",
  GATE: "gate",
} as const;

export type ProviderButtonSize = (typeof PROVIDER_BUTTON_SIZE)[keyof typeof PROVIDER_BUTTON_SIZE];

const GATE =
  "ui-provider-button m-0 flex h-provider-gate items-center justify-center gap-icon-gap rounded-control border-0 bg-muted px-ui-16 py-0 font-ui text-label-inline font-label text-foreground shadow-provider-gate transition-[background-color,opacity] duration-(--ui-duration-hover) ease-motion-exit pointer-coarse:h-provider-gate-touch in-data-[ui-profile=desktop]:[-webkit-app-region:no-drag] hover:not-disabled:bg-fill-strong [&:disabled:not([aria-busy=true])]:opacity-disabled " +
  "data-[primary=true]:bg-primary data-[primary=true]:text-primary-foreground data-[primary=true]:shadow-none data-[primary=true]:hover:not-disabled:bg-ink";

const LAST_USED_PILL =
  "ui-provider-button-last-used pointer-events-none absolute -top-ui-8 -right-ui-6 rounded-ui-full border border-transparent bg-provider-last-used px-ui-6 py-0 text-tag leading-caption font-tag whitespace-nowrap text-provider-last-used-ink transition-opacity duration-(--ui-duration-hover) ease-motion-exit [.ui-provider-button:disabled:not([aria-busy=true])+&]:opacity-disabled [.ui-button:disabled+&]:opacity-disabled";

const LAST_USED = "Last used";

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
        <span className="ui-provider-button-wait size-ui-16 flex-[0_0_auto]">
          <SpinnerRing />
        </span>
      ) : (
        <ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.ICON} />
      )}
      {busy ? busyLabel : words}
    </button>
  );
}

export function ProviderButton({
  provider,
  name,
  size = PROVIDER_BUTTON_SIZE.CONTROL,
  primary = false,
  busy = false,
  busyLabel,
  disabled = false,
  lastUsed = false,
  words: said,
  onPress,
}: BusyProps & {
  provider: MarkProvider;
  name: string;
  size?: ProviderButtonSize;
  primary?: boolean;
  disabled?: boolean;
  lastUsed?: boolean;
  words?: string | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const badge = useId();
  const words = said ?? `Continue with ${name}`;
  const describedBy = lastUsed ? badge : undefined;
  return (
    <span className="ui-provider-button-slot relative flex flex-col">
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
