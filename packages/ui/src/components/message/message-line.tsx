import type { ReactNode } from "react";
import { STATUS_TONE } from "../../status-tone.js";
import { TIME_LOOK, Time } from "../time/time.js";

export const MESSAGE_LINE_ALIGN = {
  START: "start",
  END: "end",
} as const;

export type MessageLineAlign = (typeof MESSAGE_LINE_ALIGN)[keyof typeof MESSAGE_LINE_ALIGN];

export const MESSAGE_LINE_INSET = {
  BUBBLE: "bubble",
  FLUSH: "flush",
} as const;

export type MessageLineInset = (typeof MESSAGE_LINE_INSET)[keyof typeof MESSAGE_LINE_INSET];

function drawsSomething(node: ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== "boolean";
}

function opensInset(align: MessageLineAlign, inset: MessageLineInset): boolean {
  return align === MESSAGE_LINE_ALIGN.START && inset === MESSAGE_LINE_INSET.BUBBLE;
}

function senderInset(inset: MessageLineInset): string {
  return inset === MESSAGE_LINE_INSET.BUBBLE ? "px-ui-4" : "pe-ui-4";
}

function timeInset(named: boolean, align: MessageLineAlign, inset: MessageLineInset): string {
  return !named && opensInset(align, inset) ? "px-ui-4" : "pe-ui-4";
}

export function MessageLine({
  sender,
  status,
  at,
  actions,
  align = MESSAGE_LINE_ALIGN.END,
  inset = MESSAGE_LINE_INSET.BUBBLE,
  wrap = false,
}: {
  sender?: ReactNode;
  status?: ReactNode;
  at?: number | undefined;
  actions?: ReactNode;
  align?: MessageLineAlign;
  inset?: MessageLineInset;
  wrap?: boolean;
}): React.JSX.Element | null {
  const lead = drawsSomething(status) ? (
    <span className="text-tone-ink" data-tone={STATUS_TONE.DANGER} role="alert">
      {status}
    </span>
  ) : (
    sender
  );
  const named = drawsSomething(lead);
  if (!named && at === undefined && !drawsSomething(actions)) return null;
  const actionsFirst = align === MESSAGE_LINE_ALIGN.END;
  return (
    <div
      className={`ui-message-line flex max-w-full items-center gap-ui-2 text-caption-inline text-muted-foreground ${align === MESSAGE_LINE_ALIGN.START ? "justify-start" : "justify-end"}${wrap ? " flex-wrap gap-y-ui-2" : ""}`}
      data-align={align}
      data-wrap={wrap ? "true" : undefined}
    >
      {actionsFirst ? actions : null}
      {named ? (
        <span className={`ui-message-line-sender flex min-w-0 items-center ${senderInset(inset)}`}>
          {lead}
        </span>
      ) : null}
      {at === undefined ? null : (
        <span
          className={`ui-message-line-time flex flex-none items-center gap-ui-6 whitespace-nowrap tabular-nums ${timeInset(named, align, inset)}`}
        >
          {named ? <span aria-hidden="true">·</span> : null}
          <Time at={at} look={TIME_LOOK.DAY} />
        </span>
      )}
      {actionsFirst ? null : actions}
    </div>
  );
}
