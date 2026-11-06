import { searchAnchorProps } from "@repo/settings/settings-anchors";
import { type ReactNode, useId, useRef } from "react";
import { RevealArea, revealArea } from "../reveal/reveal.js";
import { SettingsRow, SettingsRowValue } from "../settings-row/settings-row.js";
import { SKELETON_SHAPE, Skeleton, SkeletonRegion } from "../skeleton/skeleton.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

export function SettingsLine({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="ui-settings-line m-0 box-border flex min-h-settings-row min-w-0 items-center gap-control-gap px-settings-row-inline py-settings-row-block font-sans text-caption font-caption text-muted-foreground wrap-anywhere">
      {children}
    </div>
  );
}

export const SETTINGS_SKELETON_CONTROL = {
  BUTTON: "button",
  MORE: "more",
  SELECT: "select",
  SWITCH: "switch",
  CHOICE: "choice",
  FIELD: "field",
  VALUE: "value",
} as const;

export type SettingsSkeletonControl =
  (typeof SETTINGS_SKELETON_CONTROL)[keyof typeof SETTINGS_SKELETON_CONTROL];

export const SETTINGS_ROW_MARK_WIDTH = "var(--ui-settings-row-mark-size)";

export interface SettingsRowSkeletonShape {
  readonly described: boolean;
  readonly controls: readonly SettingsSkeletonControl[];
  readonly mark?: string | undefined;
}

export interface SettingsSectionSkeletonShape {
  readonly headed: boolean;
  readonly rows: readonly SettingsRowSkeletonShape[];
}

const SKELETON_ROW_WIDTHS = [
  { label: "34%", description: "62%" },
  { label: "26%", description: "48%" },
  { label: "40%", description: "70%" },
  { label: "30%", description: "56%" },
] as const;

const SKELETON_CONTROL_BLOCK = {
  [SETTINGS_SKELETON_CONTROL.BUTTON]: "calc(3 * var(--ui-control-height))",
  [SETTINGS_SKELETON_CONTROL.MORE]: "var(--ui-control-height)",
  [SETTINGS_SKELETON_CONTROL.SELECT]: "var(--ui-select-field-width)",
  [SETTINGS_SKELETON_CONTROL.SWITCH]: "calc(var(--ui-control-height) + var(--ui-space-4))",
  [SETTINGS_SKELETON_CONTROL.CHOICE]: "calc(7.5 * var(--ui-control-height))",
  [SETTINGS_SKELETON_CONTROL.FIELD]: "100%",
  [SETTINGS_SKELETON_CONTROL.VALUE]: "100%",
} as const satisfies Record<SettingsSkeletonControl, string>;

const SKELETON_HEADING_WIDTHS = ["18%", "24%", "14%"] as const;

export function SettingsControlSkeleton({
  control,
}: {
  control: SettingsSkeletonControl;
}): React.JSX.Element {
  const width = SKELETON_CONTROL_BLOCK[control];
  if (control === SETTINGS_SKELETON_CONTROL.VALUE) {
    return (
      <SettingsRowValue>
        <Skeleton width={width} />
      </SettingsRowValue>
    );
  }
  return <Skeleton shape={SKELETON_SHAPE.CONTROL} width={width} />;
}

function RowSkeleton({
  at,
  shape,
}: {
  at: number;
  shape: SettingsRowSkeletonShape;
}): React.JSX.Element {
  const widths = SKELETON_ROW_WIDTHS[at % SKELETON_ROW_WIDTHS.length] ?? SKELETON_ROW_WIDTHS[0];
  return (
    <SettingsRow
      label={<Skeleton width={widths.label} />}
      description={shape.described ? <Skeleton width={widths.description} /> : undefined}
      leading={
        shape.mark === undefined ? undefined : (
          <Skeleton shape={SKELETON_SHAPE.CIRCLE} width={shape.mark} />
        )
      }
    >
      {() =>
        shape.controls.map((control, place) => (
          <SettingsControlSkeleton key={place} control={control} />
        ))
      }
    </SettingsRow>
  );
}

function RowsSkeleton({ rows }: { rows: readonly SettingsRowSkeletonShape[] }): React.JSX.Element {
  return (
    <div className="ui-settings-skeleton-rows">
      {rows.map((shape, at) => (
        <RowSkeleton key={at} at={at} shape={shape} />
      ))}
    </div>
  );
}

export function SettingsRowsSkeleton({
  label,
  rows,
}: {
  label?: string | undefined;
  rows: readonly SettingsRowSkeletonShape[];
}): React.JSX.Element {
  if (label === undefined) return <RowsSkeleton rows={rows} />;
  return (
    <SkeletonRegion label={label}>
      <RowsSkeleton rows={rows} />
    </SkeletonRegion>
  );
}

function SectionSkeleton({
  at,
  shape,
}: {
  at: number;
  shape: SettingsSectionSkeletonShape;
}): React.JSX.Element {
  const head = shape.headed ? (
    <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.DIV}>
      <Skeleton width={SKELETON_HEADING_WIDTHS[at % SKELETON_HEADING_WIDTHS.length]} />
    </Text>
  ) : undefined;
  return (
    <SectionFrame head={head}>
      <RowsSkeleton rows={shape.rows} />
    </SectionFrame>
  );
}

export function SettingsSectionsSkeleton({
  label,
  sections,
}: {
  label: string;
  sections: readonly SettingsSectionSkeletonShape[];
}): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <div className="ui-settings-skeleton">
        {sections.map((shape, at) => (
          <SectionSkeleton key={at} at={at} shape={shape} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

export const SETTINGS_SECTION_FRAME = {
  CARD: "card",
  NONE: "none",
  ROWS: "rows",
} as const;

export type SettingsSectionFrame =
  (typeof SETTINGS_SECTION_FRAME)[keyof typeof SETTINGS_SECTION_FRAME];

function SectionFrame({
  head,
  labelledBy,
  anchor,
  frame = SETTINGS_SECTION_FRAME.CARD,
  children,
}: {
  head: ReactNode;
  labelledBy?: string | undefined;
  anchor?: string | undefined;
  frame?: SettingsSectionFrame;
  children: ReactNode;
}): React.JSX.Element {
  const card = useRef<HTMLDivElement>(null);
  const rows = frame === SETTINGS_SECTION_FRAME.ROWS;
  return (
    <section
      className={
        rows
          ? "ui-settings-section flex min-w-0 flex-col gap-tight-gap"
          : "ui-settings-section flex min-w-0 flex-col gap-ui-8"
      }
      data-frame={frame}
      aria-labelledby={labelledBy}
      {...(anchor === undefined ? undefined : searchAnchorProps(anchor))}
    >
      {head === undefined ? null : (
        <div className={rows ? "ui-settings-section-head" : "ui-settings-section-head px-ui-2"}>
          {head}
        </div>
      )}
      {rows ? (
        <div className="ui-settings-section-rows flex min-w-0 flex-col gap-tight-gap">
          {children}
        </div>
      ) : frame === SETTINGS_SECTION_FRAME.CARD ? (
        <RevealArea root={card}>
          <div
            ref={card}
            className="ui-settings-section-card flex min-w-0 flex-col rounded-control border border-border bg-surface"
            {...revealArea()}
          >
            {children}
          </div>
        </RevealArea>
      ) : (
        children
      )}
    </section>
  );
}

function SectionHead({
  action,
  children,
}: {
  action: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  if (action === undefined || action === null || action === false) return <>{children}</>;
  return (
    <div className="flex min-w-0 items-center justify-between gap-ui-8">
      {children}
      {action}
    </div>
  );
}

export function SettingsSection({
  title,
  action,
  anchor,
  frame = SETTINGS_SECTION_FRAME.CARD,
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  anchor?: string | undefined;
  frame?: SettingsSectionFrame;
  children: ReactNode;
}): React.JSX.Element {
  const headingId = useId();
  const headed = title !== undefined && title !== null && title !== false && title !== "";
  return (
    <SectionFrame
      head={
        headed ? (
          <SectionHead action={action}>
            <Text
              variant={
                frame === SETTINGS_SECTION_FRAME.ROWS ? TEXT_VARIANT.GROUP : TEXT_VARIANT.SECTION
              }
              tone={TEXT_TONE.MUTED}
              as={TEXT_ELEMENT.H2}
              id={headingId}
            >
              {title}
            </Text>
          </SectionHead>
        ) : undefined
      }
      labelledBy={headed ? headingId : undefined}
      anchor={anchor}
      frame={frame}
    >
      {children}
    </SectionFrame>
  );
}
