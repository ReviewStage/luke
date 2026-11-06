import { CloseIcon } from "../../face/glyphs.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, ButtonLink, IconButton } from "../button/button.js";
import { CopyButton } from "../copy-button/copy-button.js";
import { Tooltip } from "../tooltip/hint.js";

export interface ToastCopy {
  readonly text: string;
  readonly what: string;
  readonly copy: (text: string) => Promise<void>;
}

type ToastActionProps =
  | {
      label: string;
      href?: string | undefined;
      onPress: () => void;
    }
  | { label?: never; href?: never; onPress?: never };

export function ToastActions({
  label,
  href,
  onPress,
  copy,
  dismissLabel,
  onDismiss,
  replayUnmasked = false,
}: ToastActionProps & {
  copy?: ToastCopy | undefined;
  dismissLabel: string;
  onDismiss: () => void;
  replayUnmasked?: boolean | undefined;
}): React.JSX.Element {
  return (
    <>
      {label === undefined ? null : href === undefined ? (
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          onClick={() => {
            onDismiss();
            onPress?.();
          }}
        >
          <ReplayWords unmasked={replayUnmasked}>{label}</ReplayWords>
        </Button>
      ) : (
        <ButtonLink
          variant={BUTTON_VARIANT.OUTLINE}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onDismiss();
            onPress?.();
          }}
        >
          <ReplayWords unmasked={replayUnmasked}>{label}</ReplayWords>
        </ButtonLink>
      )}
      {copy === undefined ? null : (
        <CopyButton text={copy.text} what={copy.what} copy={copy.copy} />
      )}
      <span className="ui-toast-dismiss absolute -top-toast-gap -left-toast-gap flex rounded-full border border-border-strong bg-background shadow-toast-dismiss">
        <Tooltip label={dismissLabel}>
          <IconButton
            icon={<CloseIcon />}
            label={dismissLabel}
            size={BUTTON_SIZE.COMPACT}
            onClick={onDismiss}
          />
        </Tooltip>
      </span>
    </>
  );
}
