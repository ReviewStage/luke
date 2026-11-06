import type { ShortcutChord } from "@repo/settings/shortcuts";
import { type ReactNode, useId } from "react";
import { inputProblem, type ReportedFailure, type Unreported } from "../../reported-failure.js";
import {
  BUTTON_SHAPE,
  BUTTON_TYPE,
  BUTTON_VARIANT,
  type BusyProps,
  Button,
  IconButton,
  SUBMIT_STATE,
} from "../button/button.js";
import { ErrorLine } from "../error-line/error-line.js";
import { ErrorState, type ErrorStateRemedy } from "../error-state/error-state.js";
import { HoldPress } from "../hold-press/hold-press.js";
import { LengthCounter } from "../length-counter/length-counter.js";
import { SKELETON_SHAPE, Skeleton } from "../skeleton/skeleton.js";
import { Tooltip } from "../tooltip/hint.js";

export type ComposerSend = {
  label: string;
  empty: boolean;
  held?: boolean | undefined;
  onSend?: (() => void) | undefined;
  inWords?: boolean | undefined;
  icon?: ReactNode;
  onHold?: (() => void) | undefined;
  chord?: ShortcutChord | undefined;
  refuses?: ComposerRefusal | undefined;
} & BusyProps;

export interface ComposerRefusal {
  readonly onRefused: () => void;
  readonly words: string | undefined;
}

export type ComposerStop = {
  label: string;
  onStop: () => void;
} & BusyProps;

export interface ComposerNote {
  readonly words: string;
  readonly failure: ReportedFailure | Unreported;
  readonly onRetry?: (() => void) | undefined;
  readonly remedy?: ErrorStateRemedy | undefined;
  readonly mends?: ReactNode;
}

const FOOT =
  "ui-composer-foot flex flex-col gap-tight-gap px-ui-12 pt-0 pb-ui-12 " +
  "group-data-[look=field]/composer:px-ui-6 group-data-[look=field]/composer:pt-ui-2 group-data-[look=field]/composer:pb-ui-6 " +
  "group-data-[look=input]/composer:px-ui-6 group-data-[look=input]/composer:pt-ui-2 group-data-[look=input]/composer:pb-ui-6 " +
  "group-data-[look=bare]/composer:px-0";

function FootBox({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={FOOT}>{children}</div>;
}

function FootBar({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-composer-foot-bar flex min-h-control items-center justify-between gap-block-gap">
      {children}
    </div>
  );
}

function FootTools({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-composer-foot-tools flex min-w-0 items-center gap-tight-gap">{children}</div>
  );
}

function FootEnd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-composer-foot-end ms-auto flex flex-none items-center gap-tight-gap">
      {children}
    </div>
  );
}

function SendButton({
  send,
  refusalId,
}: {
  send: ComposerSend;
  refusalId: string;
}): React.JSX.Element {
  const { onHold, empty, held = false } = send;
  if (onHold === undefined) return <SendPress send={send} refusalId={refusalId} />;
  return (
    <HoldPress onHold={onHold} disabled={empty || held || send.busy === true}>
      <SendPress send={send} refusalId={refusalId} />
    </HoldPress>
  );
}

function SendPress({
  send,
  refusalId,
}: {
  send: ComposerSend;
  refusalId: string;
}): React.JSX.Element {
  const { label, empty, held = false, inWords = false, icon, onSend, chord, refuses } = send;
  const busy = send.busy === true ? { busy: true, busyLabel: send.busyLabel } : {};
  const type = onSend === undefined ? BUTTON_TYPE.SUBMIT : BUTTON_TYPE.BUTTON;
  const refusing =
    refuses === undefined
      ? {}
      : {
          focusableWhenDisabled: empty && !held,
          onRefused: refuses.onRefused,
          "aria-describedby": refusalId,
        };
  if (inWords) {
    return (
      <Button
        variant={BUTTON_VARIANT.INK}
        type={type}
        icon={icon}
        disabled={empty || held}
        onClick={onSend}
        {...refusing}
        {...busy}
      >
        {label}
      </Button>
    );
  }
  return (
    <Tooltip label={label} chord={chord}>
      {icon === undefined ? (
        <IconButton
          submit={SUBMIT_STATE.READY}
          variant={BUTTON_VARIANT.INK}
          label={label}
          type={type}
          disabled={empty || held}
          onClick={onSend}
          {...refusing}
          {...busy}
        />
      ) : (
        <IconButton
          icon={icon}
          shape={BUTTON_SHAPE.ROUND}
          variant={BUTTON_VARIANT.INK}
          label={label}
          type={type}
          disabled={empty || held}
          onClick={onSend}
          {...refusing}
          {...busy}
        />
      )}
    </Tooltip>
  );
}

function StopButton({ stop }: { stop: ComposerStop }): React.JSX.Element {
  const busy = stop.busy === true ? { busy: true, busyLabel: stop.busyLabel } : {};
  return (
    <Tooltip label={stop.busy === true ? stop.busyLabel : stop.label}>
      <IconButton
        submit={SUBMIT_STATE.STREAMING}
        variant={BUTTON_VARIANT.INK}
        label={stop.label}
        type={BUTTON_TYPE.BUTTON}
        onClick={stop.onStop}
        {...busy}
      />
    </Tooltip>
  );
}

export function ComposerFoot({
  send,
  stop,
  tools,
  actions,
  counter,
  strip,
  note,
}: {
  send: ComposerSend;
  stop?: ComposerStop | undefined;
  tools?: ReactNode;
  actions?: ReactNode;
  counter?: { readonly length: number; readonly limit: number } | undefined;
  strip?: ReactNode;
  note?: ComposerNote | undefined;
}): React.JSX.Element {
  const refusalId = useId();
  return (
    <FootBox>
      <FootBar>
        {strip === undefined || strip === null ? (
          <>
            <FootTools>{tools}</FootTools>
            <FootEnd>
              {counter === undefined ? null : (
                <LengthCounter length={counter.length} limit={counter.limit} />
              )}
              {actions}
              {stop === undefined ? (
                <SendButton send={send} refusalId={refusalId} />
              ) : (
                <StopButton stop={stop} />
              )}
            </FootEnd>
          </>
        ) : (
          <div className="ui-composer-foot-strip flex min-w-0 flex-1 items-center">{strip}</div>
        )}
      </FootBar>
      {send.refuses === undefined ? null : (
        <ErrorLine id={refusalId} error={inputProblem(send.refuses.words)} />
      )}
      {note === undefined ? null : (
        <div className="ui-composer-foot-note flex flex-col items-start gap-tight-gap">
          <ErrorState onRetry={note.onRetry} remedy={note.remedy} failure={note.failure}>
            {note.words}
          </ErrorState>
          {note.mends}
        </div>
      )}
    </FootBox>
  );
}

export function ComposerFootSkeleton({
  tools,
  actions,
}: {
  tools?: ReactNode;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <FootBox>
      <FootBar>
        <FootTools>{tools}</FootTools>
        <FootEnd>
          {actions}
          <Skeleton shape={SKELETON_SHAPE.CIRCLE} />
        </FootEnd>
      </FootBar>
    </FootBox>
  );
}
