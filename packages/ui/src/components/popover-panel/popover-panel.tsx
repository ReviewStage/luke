import {
  type ComponentType,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import { isComposingKey } from "../../composing-key.js";
import { CloseIcon } from "../../face/glyphs.js";
import { motionHeld } from "../../motion-timing.js";
import { REPLAY_MASKED, ReplayWords } from "../../session-replay-marks.js";
import { useDisclosure } from "../../use-disclosure.js";
import { IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

const PANEL = [
  "ui-popover-panel flex flex-col rounded-menu border border-border-strong bg-popover text-popover-foreground shadow-menu animate-menu-in focus-visible:outline-none *:shrink-0 data-ending-style:pointer-events-none data-ending-style:animate-menu-leave",
  "data-[look=card]:max-h-popover-room data-[look=card]:gap-block-gap data-[look=card]:overflow-x-hidden data-[look=card]:overflow-y-auto data-[look=card]:overscroll-contain data-[look=card]:p-card-inset-snug data-[look=card]:text-caption",
].join(" ");
const HEAD = "-mr-2 flex items-center justify-between gap-control-gap";
const TITLE = "m-0 text-section font-section";

export const POPOVER_PANEL_LOOK = {
  CARD: "card",
  MENU: "menu",
} as const;

export type PopoverPanelLook = (typeof POPOVER_PANEL_LOOK)[keyof typeof POPOVER_PANEL_LOOK];

interface PopoverPanelHintProps {
  "aria-describedby"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

export type PopoverPanelHint = ComponentType<{
  label: string;
  children: ReactElement<PopoverPanelHintProps>;
}>;

function CloseButton({
  label,
  hint: Hint,
  onPress,
}: {
  label: string;
  hint: PopoverPanelHint;
  onPress: () => void;
}): React.JSX.Element {
  const button = <IconButton icon={<CloseIcon />} label={label} onClick={onPress} />;
  return <Hint label={label}>{button}</Hint>;
}

function inside(box: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && box.contains(target);
}

export function PopoverPanel({
  open,
  id,
  title,
  replayUnmasked = false,
  look = POPOVER_PANEL_LOOK.CARD,
  closeLabel,
  hint = Tooltip,
  initialFocus,
  takesFocus = true,
  onDismiss,
  onLeave,
  onExited,
  onKeyDown,
  children,
}: {
  open: boolean;
  id?: string | undefined;
  title: string;
  replayUnmasked?: boolean | undefined;
  look?: PopoverPanelLook | undefined;
  closeLabel?: string | undefined;
  hint?: PopoverPanelHint | undefined;
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  takesFocus?: boolean | undefined;
  onDismiss: () => void;
  onLeave: (left: EventTarget | null) => void;
  onExited?: (() => void) | undefined;
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const { mounted, leaving, ref: held } = useDisclosure(open);
  const drawn = useCallback(
    (node: HTMLDivElement | null) => {
      panel.current = node;
      held(node);
    },
    [held],
  );

  useEffect(() => {
    if (open && takesFocus)
      (initialFocus?.current ?? panel.current)?.focus({ preventScroll: true });
  }, [open, initialFocus, takesFocus]);

  const stood = useRef(false);
  useEffect(() => {
    if (mounted) {
      stood.current = true;
    } else if (stood.current) {
      stood.current = false;
      onExited?.();
    }
  }, [mounted, onExited]);

  if (!mounted || (leaving && motionHeld())) return null;

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !isComposingKey(event)) {
      event.stopPropagation();
      onDismiss();
      return;
    }
    onKeyDown?.(event);
  };

  return (
    <div
      ref={drawn}
      id={id}
      className={PANEL}
      {...REPLAY_MASKED}
      data-look={look}
      data-ending-style={leaving ? "" : undefined}
      inert={leaving}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKey}
      onBlur={(event) => {
        if (leaving) return;
        if (panel.current !== null && !inside(panel.current, event.relatedTarget)) {
          onLeave(event.relatedTarget);
        }
      }}
    >
      {look === POPOVER_PANEL_LOOK.CARD ? (
        <div className={HEAD}>
          <h2 id={titleId} className={TITLE}>
            <ReplayWords unmasked={replayUnmasked}>{title}</ReplayWords>
          </h2>
          {closeLabel === undefined ? null : (
            <CloseButton label={closeLabel} hint={hint} onPress={onDismiss} />
          )}
        </div>
      ) : (
        <h2 id={titleId} className="ui-visually-hidden">
          <ReplayWords unmasked={replayUnmasked}>{title}</ReplayWords>
        </h2>
      )}
      {children}
    </div>
  );
}
