import { type ReactNode, type RefObject, useState } from "react";
import { IconButton } from "../button/button.js";
import {
  DISCLOSURE_BODY,
  DisclosureBody,
  DisclosureChevron,
  DisclosureScope,
  useDisclosureFold,
} from "../disclosure/disclosure.js";
import { OneLine } from "../one-line/one-line.js";
import {
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
} from "../virtual-rows/virtual-rows.js";
import {
  SettingsRow,
  SettingsRowActSlot,
  type SettingsRowControl,
  type SettingsRowIndent,
} from "./settings-row.js";

export interface SettingsFoldRun {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly shiftedBy?: RefObject<HTMLElement | null> | undefined;
  readonly keys: readonly string[];
  readonly line: (index: number, place: VirtualRowPlace) => ReactNode;
}

const LINE_GAP_PX = 4;

const LINE_ESTIMATE_PX = 18;

const LINES = "ui-settings-row-fold-lines m-0 flex list-none flex-col gap-ui-4 p-0";

export function SettingsFoldRow({
  label,
  description,
  leading,
  indent,
  foldLabel,
  defaultOpen = false,
  actions,
  run,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  indent?: SettingsRowIndent | undefined;
  foldLabel: string;
  defaultOpen?: boolean | undefined;
  actions?: ((control: SettingsRowControl) => ReactNode) | undefined;
  run?: SettingsFoldRun | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  const { state, details } = useDisclosureFold(defaultOpen);
  return (
    <DisclosureScope state={state}>
      <SettingsRow
        label={label}
        description={description}
        leading={leading}
        indent={indent}
        below={
          state.drawn
            ? () => (
                <div
                  className="ui-settings-row-fold min-w-0"
                  data-disclosure={details["data-disclosure"]}
                >
                  <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
                    {run === undefined ? (
                      <ul className={LINES}>{children}</ul>
                    ) : (
                      <div className="ui-settings-row-fold-run flex min-w-0 flex-col gap-ui-4">
                        <VirtualRows
                          scroller={run.scroller}
                          shiftedBy={run.shiftedBy}
                          keys={run.keys}
                          estimate={LINE_ESTIMATE_PX}
                          gap={LINE_GAP_PX}
                          anchor={VIRTUAL_ROWS_ANCHOR.START}
                          listItems
                          className="ui-settings-row-fold-lines"
                        >
                          {run.line}
                        </VirtualRows>
                        {children === undefined || children === null ? null : (
                          <ul className={LINES}>{children}</ul>
                        )}
                      </div>
                    )}
                  </DisclosureBody>
                </div>
              )
            : undefined
        }
      >
        {(control) => (
          <>
            {actions?.(control)}
            <IconButton
              icon={<DisclosureChevron />}
              label={foldLabel}
              aria-expanded={state.open}
              onClick={state.toggle}
            />
          </>
        )}
      </SettingsRow>
    </DisclosureScope>
  );
}

export function SettingsRowsFold({
  label,
  head,
  rows,
}: {
  label: string;
  head: (chevron: ReactNode) => ReactNode;
  rows?: ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const folds = rows !== undefined && rows !== null && rows !== false;
  return (
    <>
      {head(
        folds ? (
          <IconButton
            icon={<DisclosureChevron open={open} />}
            label={label}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          />
        ) : (
          <SettingsRowActSlot />
        ),
      )}
      {folds ? (
        <div className="ui-settings-rows-fold" hidden={!open}>
          {rows}
        </div>
      ) : null}
    </>
  );
}

const LINE =
  "ui-settings-fold-line flex min-w-0 items-center font-sans text-caption font-caption text-muted-foreground";

export function SettingsFoldLine({
  place,
  children,
}: {
  place?: VirtualRowPlace | undefined;
  children: string;
}): React.JSX.Element {
  return (
    <li {...place} className={LINE}>
      <OneLine>{children}</OneLine>
    </li>
  );
}

export function SettingsFoldFoot({ children }: { children: ReactNode }): React.JSX.Element {
  return <li className={LINE}>{children}</li>;
}
