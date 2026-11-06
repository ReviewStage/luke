import { createContext, type ReactNode, useContext } from "react";
import { CloseIcon } from "../../face/glyphs.js";
import { AlertIcon, RetryIcon } from "../../icons/lucide-glyphs.js";
import type { ReportedFailure, Unreported } from "../../reported-failure.js";
import { BUTTON_VARIANT, Button, IconButton } from "../button/button.js";
import { EmptyState } from "../empty-state/empty-state.js";
import { FailureCopy } from "../failure-copy/failure-copy.js";
import { Tooltip } from "../tooltip/hint.js";

export const ERROR_STATE_PLACEMENT = {
  INLINE: "inline",
  ROWS: "rows",
  CENTERED: "centered",
  TOOLBAR: "toolbar",
} as const;

export type ErrorStatePlacement =
  (typeof ERROR_STATE_PLACEMENT)[keyof typeof ERROR_STATE_PLACEMENT];

export const ERROR_STATE_ELEMENT = {
  PARAGRAPH: "p",
  SPAN: "span",
} as const;

export type ErrorStateElement = (typeof ERROR_STATE_ELEMENT)[keyof typeof ERROR_STATE_ELEMENT];

export interface ErrorStateRemedy {
  readonly label: string;
  readonly onClick: () => void;
}

interface LineActions {
  remedy?: ErrorStateRemedy | undefined;
  onRemove?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
  as?: ErrorStateElement | undefined;
}

type Placed =
  | (LineActions & {
      placement?: typeof ERROR_STATE_PLACEMENT.INLINE | typeof ERROR_STATE_PLACEMENT.ROWS;
      children: ReactNode;
    })
  | (LineActions & {
      placement: typeof ERROR_STATE_PLACEMENT.TOOLBAR;
      children: string;
    })
  | {
      placement: typeof ERROR_STATE_PLACEMENT.CENTERED;
      exit?: ErrorStateRemedy | undefined;
      children: ReactNode;
      remedy?: undefined;
      onRemove?: undefined;
      onDismiss?: undefined;
      as?: undefined;
    };

const LINE = {
  [ERROR_STATE_PLACEMENT.INLINE]: {
    line: "w-full m-0 flex-wrap items-start @container/ui-error-state",
    words: "min-w-1/2 flex-[1_1_0]",
    actions: "max-w-full flex-[0_1_auto] flex-wrap justify-end ms-auto",
  },
  [ERROR_STATE_PLACEMENT.ROWS]: {
    line: "w-auto mt-ui-4 mr-ui-4 mb-ui-4 ml-row-inset flex-wrap items-start @container/ui-error-state",
    words: "min-w-1/2 flex-[1_1_0]",
    actions: "max-w-full flex-[0_1_auto] flex-wrap justify-end ms-auto",
  },
  [ERROR_STATE_PLACEMENT.TOOLBAR]: {
    line: "w-auto m-0 flex-nowrap items-center",
    words: "min-w-0 flex-[0_1_auto] overflow-hidden whitespace-nowrap",
    actions: "max-w-full flex-none flex-nowrap justify-end ms-0",
  },
} as const satisfies Record<
  Exclude<ErrorStatePlacement, typeof ERROR_STATE_PLACEMENT.CENTERED>,
  { line: string; words: string; actions: string }
>;

const WORDS = {
  RETRY: "Retry",
  REMOVE: "Remove",
  DISMISS: "Dismiss",
} as const;

export const RetryOffered = createContext(true);

export function ErrorState(
  props: {
    onRetry?: (() => void) | undefined;
    failure: ReportedFailure | Unreported;
  } & Placed,
): React.JSX.Element {
  const { remedy, onRemove, onDismiss, failure, children } = props;
  const onRetry = useContext(RetryOffered) ? props.onRetry : undefined;
  const Line = props.as ?? ERROR_STATE_ELEMENT.PARAGRAPH;
  const placement = props.placement ?? ERROR_STATE_PLACEMENT.INLINE;
  if (placement === ERROR_STATE_PLACEMENT.CENTERED) {
    const again = onRetry === undefined ? undefined : { label: WORDS.RETRY, onClick: onRetry };
    return (
      <EmptyState
        icon={<AlertIcon />}
        alert
        action={again === undefined ? undefined : { ...again, icon: <RetryIcon />, turns: true }}
        secondary={props.placement === ERROR_STATE_PLACEMENT.CENTERED ? props.exit : undefined}
        beside={<FailureCopy failure={failure} />}
      >
        {children}
      </EmptyState>
    );
  }
  const look = LINE[placement];
  return (
    <Line
      className={`ui-error-state box-border flex min-w-0 gap-icon-gap text-caption text-muted-foreground ${look.line}`}
      data-placement={placement}
      role="alert"
    >
      <span className="ui-error-state-glyph flex h-control flex-none items-center text-danger [&_svg]:size-control-icon">
        <AlertIcon />
      </span>
      <span
        className={`ui-error-state-words py-state-row-inset ${look.words}`}
        title={props.placement === ERROR_STATE_PLACEMENT.TOOLBAR ? props.children : undefined}
      >
        {children}
      </span>
      <span className={`ui-error-state-actions flex min-w-0 gap-control-gap ${look.actions}`}>
        {remedy === undefined ? null : (
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={remedy.onClick}>
            {remedy.label}
          </Button>
        )}
        {onRetry === undefined ? null : (
          <span className="ui-error-state-retry contents">
            <Button variant={BUTTON_VARIANT.QUIET} icon={<RetryIcon />} turns onClick={onRetry}>
              {WORDS.RETRY}
            </Button>
          </span>
        )}
        <FailureCopy failure={failure} />
        {onRemove === undefined ? null : (
          <Button variant={BUTTON_VARIANT.QUIET} onClick={onRemove}>
            {WORDS.REMOVE}
          </Button>
        )}
        {onDismiss === undefined ? null : (
          <Tooltip label={WORDS.DISMISS}>
            <IconButton icon={<CloseIcon />} label={WORDS.DISMISS} onClick={onDismiss} />
          </Tooltip>
        )}
      </span>
    </Line>
  );
}

export function RetryRowLabel({ failure }: { failure: string }): React.JSX.Element {
  return (
    <>
      <span role="alert">{failure}</span>{" "}
      <span className="ui-retry-row-label ml-ui-4 inline-flex items-baseline gap-ui-4 font-emphasis">
        <RetryIcon />
        {WORDS.RETRY}
      </span>
    </>
  );
}
