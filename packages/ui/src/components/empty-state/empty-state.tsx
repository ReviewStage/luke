import type { ReactNode } from "react";
import { ReplayWords } from "../../session-replay-marks.js";
import { Empty, EmptyHeader, EmptyMedia } from "../../shadcn/empty.js";
import { BUTTON_VARIANT, Button, type ButtonVariant } from "../button/button.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

const ROOM =
  "ui-empty-state flex min-h-0 flex-[1_1_0] flex-col items-center overflow-x-hidden overflow-y-auto before:flex-[2_1_0] after:flex-[3_1_0]";

export const EMPTY_STATE_ACTION_LOOK = {
  QUIET: "quiet",
  PRIMARY: "primary",
} as const;

export type EmptyStateActionLook =
  (typeof EMPTY_STATE_ACTION_LOOK)[keyof typeof EMPTY_STATE_ACTION_LOOK];

const ACTION_BUTTON = {
  [EMPTY_STATE_ACTION_LOOK.QUIET]: BUTTON_VARIANT.QUIET,
  [EMPTY_STATE_ACTION_LOOK.PRIMARY]: BUTTON_VARIANT.PRIMARY,
} as const satisfies Record<EmptyStateActionLook, ButtonVariant>;

export interface EmptyStateAction {
  readonly label: string;
  readonly look?: EmptyStateActionLook | undefined;
  readonly icon?: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean | undefined;
  readonly turns?: boolean | undefined;
  readonly busy?: string | undefined;
}

function WayOn({
  way,
  unmasked,
}: {
  way: EmptyStateAction | undefined;
  unmasked: boolean;
}): React.JSX.Element | null {
  if (way === undefined) return null;
  return (
    <Button
      variant={ACTION_BUTTON[way.look ?? EMPTY_STATE_ACTION_LOOK.QUIET]}
      icon={way.icon}
      disabled={way.disabled}
      turns={way.turns}
      {...(way.busy === undefined ? {} : { busy: true, busyLabel: way.busy })}
      onClick={way.onClick}
    >
      <ReplayWords unmasked={unmasked}>{way.label}</ReplayWords>
    </Button>
  );
}

export function EmptyState({
  icon,
  title,
  replayUnmasked = false,
  action,
  secondary,
  beside,
  alert = false,
  children,
}: {
  icon?: ReactNode;
  title?: string | undefined;
  replayUnmasked?: boolean | undefined;
  action?: EmptyStateAction | undefined;
  secondary?: EmptyStateAction | undefined;
  beside?: ReactNode;
  alert?: boolean | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className={ROOM}>
      <Empty role={alert ? "alert" : undefined}>
        {icon === undefined ? null : <EmptyMedia aria-hidden="true">{icon}</EmptyMedia>}
        <EmptyHeader>
          {title === undefined ? null : (
            <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.LABEL}>
              <ReplayWords unmasked={replayUnmasked}>{title}</ReplayWords>
            </Text>
          )}
          {children === undefined ? null : <Text tone={TEXT_TONE.MUTED}>{children}</Text>}
        </EmptyHeader>
        {beside === undefined || beside === null ? (
          <WayOn way={action} unmasked={replayUnmasked} />
        ) : (
          <div className="ui-empty-state-beside flex items-center gap-control-gap">
            <WayOn way={action} unmasked={replayUnmasked} />
            {beside}
          </div>
        )}
        <WayOn way={secondary} unmasked={replayUnmasked} />
      </Empty>
    </div>
  );
}
