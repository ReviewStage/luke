import { type ReactNode, useId } from "react";
import { cn } from "../../cn.js";
import { CheckIcon } from "../../face/glyphs.js";
import { AlertIcon } from "../../icons/lucide-glyphs.js";
import type { ShownError } from "../../reported-failure.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../../shadcn/item.js";
import { ANNOUNCE } from "../announcer/announcer.js";
import { ErrorLine } from "../error-line/error-line.js";
import { LANDED, landedMark } from "../landed/landed.js";
import { GAP, type Gap, Inline } from "../layout/layout.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

export const SETTINGS_ROW_DENSITY = {
  CARD: "card",
  COMPACT: "compact",
  LIST: "list",
} as const;

export type SettingsRowDensity = (typeof SETTINGS_ROW_DENSITY)[keyof typeof SETTINGS_ROW_DENSITY];

export const SETTINGS_ROW_INDENT = {
  NONE: "none",
  MARK: "mark",
} as const;

export type SettingsRowIndent = (typeof SETTINGS_ROW_INDENT)[keyof typeof SETTINGS_ROW_INDENT];

export const SETTINGS_ROW_LEAD = {
  MARK: "mark",
  FACE: "face",
} as const;

export type SettingsRowLead = (typeof SETTINGS_ROW_LEAD)[keyof typeof SETTINGS_ROW_LEAD];

const FACE_LEAD = "w-avatar-card justify-center";

export interface SettingsRowControl {
  readonly labelId: string;
  readonly controlId: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
}

const ADORNED_TITLE_CLASS = "[&>.ui-badge:not([data-fill])]:flex-none";

function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

const LABEL_CLASS = {
  [SETTINGS_ROW_DENSITY.CARD]:
    "ui-settings-row-label font-sans text-label font-label text-foreground",
  [SETTINGS_ROW_DENSITY.COMPACT]:
    "ui-settings-row-label font-sans text-label font-label text-foreground",
  [SETTINGS_ROW_DENSITY.LIST]:
    "ui-settings-row-label font-sans text-label font-text text-foreground",
} as const satisfies Record<SettingsRowDensity, string>;

function RowLabel({
  id,
  control,
  density,
  children,
}: {
  id: string;
  control: string | undefined;
  density: SettingsRowDensity;
  children: ReactNode;
}): React.JSX.Element {
  if (control === undefined) {
    return (
      <span className={LABEL_CLASS[density]} id={id}>
        {children}
      </span>
    );
  }
  return (
    <label className={LABEL_CLASS[density]} id={id} htmlFor={control}>
      {children}
    </label>
  );
}

export function SettingsRow({
  label,
  description,
  error,
  leading,
  adornment,
  density = SETTINGS_ROW_DENSITY.CARD,
  indent = SETTINGS_ROW_INDENT.NONE,
  lead = SETTINGS_ROW_LEAD.MARK,
  labelsControl = false,
  landed = false,
  children,
  below,
}: {
  label: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  adornment?: ReactNode;
  error?: ShownError | undefined;
  density?: SettingsRowDensity | undefined;
  indent?: SettingsRowIndent | undefined;
  lead?: SettingsRowLead | undefined;
  labelsControl?: boolean | undefined;
  landed?: boolean | undefined;
  children?: ((control: SettingsRowControl) => ReactNode) | undefined;
  below?: ((control: SettingsRowControl) => ReactNode) | undefined;
}): React.JSX.Element {
  const id = useId();
  const labelId = `${id}label`;
  const descriptionId = `${id}description`;
  const errorId = `${id}error`;
  const controlId = `${id}control`;
  const failed = error !== undefined && said(error.words);
  const described = said(description);
  const led = said(leading);
  const describedBy = [described ? descriptionId : undefined, failed ? errorId : undefined]
    .filter((part) => part !== undefined)
    .join(" ");
  const control: SettingsRowControl = {
    labelId,
    controlId,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    "aria-invalid": failed ? true : undefined,
  };
  const name = (
    <RowLabel id={labelId} control={labelsControl ? controlId : undefined} density={density}>
      {label}
    </RowLabel>
  );
  return (
    <div
      className="ui-settings-row @container/ui-settings-row min-w-0 data-[indent=mark]:ms-settings-row-indent"
      data-invalid={failed}
      data-density={density}
      data-indent={indent}
      data-labels-control={labelsControl}
      {...landedMark(landed, LANDED.WITHIN)}
    >
      <Item size={density} className={indent === SETTINGS_ROW_INDENT.MARK ? "ps-0" : undefined}>
        <div
          className={
            density === SETTINGS_ROW_DENSITY.COMPACT
              ? "ui-settings-row-line flex flex-wrap items-center"
              : "ui-settings-row-line flex items-center"
          }
        >
          <div className="ui-settings-row-subject flex min-w-0 items-center gap-ui-12">
            {led ? (
              <ItemMedia className={lead === SETTINGS_ROW_LEAD.FACE ? FACE_LEAD : undefined}>
                {leading}
              </ItemMedia>
            ) : null}
            <ItemContent>
              {said(adornment) ? (
                <ItemTitle className={ADORNED_TITLE_CLASS}>
                  {name}
                  {adornment}
                </ItemTitle>
              ) : (
                name
              )}
              {described ? (
                <ItemDescription id={descriptionId}>{description}</ItemDescription>
              ) : null}
            </ItemContent>
          </div>
          <ItemActions>{children?.(control)}</ItemActions>
        </div>
        {below === undefined ? null : (
          <div
            className={
              led
                ? "ui-settings-row-below mt-ui-8 min-w-0 ps-settings-row-words-inset"
                : "ui-settings-row-below mt-ui-8 min-w-0"
            }
            data-led={led}
          >
            {below(control)}
          </div>
        )}
        <ErrorLine id={errorId} level={ANNOUNCE.ALERT} error={failed ? error : undefined} />
      </Item>
    </div>
  );
}

export function SettingsRowMark({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="ui-settings-row-mark grid size-settings-row-mark flex-none place-items-center">
      {children}
    </span>
  );
}

export const SETTINGS_ROW_STATE = {
  CONNECTED: "connected",
  ATTENTION: "attention",
  PLAIN: "plain",
} as const;

export type SettingsRowState = (typeof SETTINGS_ROW_STATE)[keyof typeof SETTINGS_ROW_STATE];

const STATE_CLASS = {
  [SETTINGS_ROW_STATE.CONNECTED]:
    "before:size-settings-row-state-dot before:flex-none before:rounded-ui-full before:bg-complete",
  [SETTINGS_ROW_STATE.ATTENTION]: "text-attention",
  [SETTINGS_ROW_STATE.PLAIN]: "",
} as const satisfies Record<SettingsRowState, string>;

export function SettingsRowStateLine({
  state = SETTINGS_ROW_STATE.PLAIN,
  block = false,
  wrap = false,
  role,
  children,
}: {
  state?: SettingsRowState;
  block?: boolean;
  wrap?: boolean;
  role?: "alert" | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "ui-settings-row-state items-center gap-ui-6",
        block ? "flex w-fit" : "inline-flex align-top",
        wrap && "flex-wrap gap-x-0 whitespace-pre",
        wrap && state === SETTINGS_ROW_STATE.CONNECTED && "before:me-ui-6",
        STATE_CLASS[state],
      )}
      data-state={state}
      data-block={block ? "" : undefined}
      data-wrap={wrap ? "" : undefined}
      role={role}
    >
      {children}
    </span>
  );
}

export function SettingsRowValue({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="ui-settings-row-value min-w-ui-64 flex-none text-right text-body text-muted-foreground">
      {children}
    </span>
  );
}

export function SettingsRowActSlot(): React.JSX.Element {
  return <span className="ui-settings-row-act-slot w-control flex-none" aria-hidden="true" />;
}

export function SettingsFacts({
  gap = GAP.CONTROL,
  children,
}: {
  gap?: Gap;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.INHERIT} tone={TEXT_TONE.MUTED}>
      <Inline gap={gap}>{children}</Inline>
    </Text>
  );
}

export function SettingsSavedMark(): React.JSX.Element {
  return (
    <span className="ui-settings-saved-mark inline-flex text-complete in-[.ui-button]:ml-ui-4">
      <CheckIcon />
    </span>
  );
}

export function SettingsChangedMark(): React.JSX.Element {
  return (
    <span className="ui-settings-changed-mark text-caption leading-tag font-tag text-muted-foreground">
      Modified
    </span>
  );
}

export function SettingsAttentionMark({ note }: { note: string }): React.JSX.Element {
  return (
    <span className="ui-settings-attention-mark inline-flex flex-none text-attention" title={note}>
      <AlertIcon />
      <VisuallyHidden>({note})</VisuallyHidden>
    </span>
  );
}
