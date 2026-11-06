import { searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  dropBelowStart,
  IconButton,
  MoreButton,
  moreLabel,
  opensMenu,
  SettingsFoldRow,
  type SettingsFoldRun,
  SettingsRow,
  type SettingsRowControl,
  type SettingsRowIndent,
  Tooltip,
  useMenu,
} from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { replayMaskedError } from "./marks.js";

type MenuRowActions = readonly MenuAction[] | readonly (readonly MenuAction[])[];

interface MenuRowWords {
  label: ReactNode;
  adornment?: ReactNode;
  description?: ReactNode;
  error?: ShownError | undefined;
  below?: ReactNode;
  leading?: ReactNode;
  control?: ReactNode;
  describedControl?: (control: SettingsRowControl) => ReactNode;
  landed?: boolean;
  indent?: SettingsRowIndent;
  fold?: { lines?: ReactNode; run?: SettingsFoldRun; label: string; defaultOpen: boolean };
  chevron?: ReactNode;
}

type MenuRowBody =
  | { row: MenuRowWords; children?: undefined }
  | {
      row?: undefined;
      children: ReactNode;
    };

function grouped(actions: MenuRowActions): actions is readonly (readonly MenuAction[])[] {
  return actions.every((entry) => Array.isArray(entry));
}

function groupsOf(actions: MenuRowActions): readonly (readonly MenuAction[])[] {
  const groups = grouped(actions) ? actions : [actions];
  return groups.filter((group) => group.length > 0);
}

export function MenuRow({
  thing,
  actions,
  heading,
  anchor,
  alone = false,
  row,
  children,
}: MenuRowBody & {
  thing: string;
  actions: MenuRowActions;
  heading?: string;
  anchor?: string;
  alone?: boolean;
}): React.JSX.Element {
  const menu = useMenu(true);
  const door = useRef<HTMLButtonElement | null>(null);
  const groups = groupsOf(actions);
  const only = alone && groups.length === 1 && groups[0]?.length === 1 ? groups[0][0] : undefined;
  const acting = groups.length > 0 && only === undefined;
  const more =
    only !== undefined ? (
      <Tooltip label={only.label}>
        <IconButton
          icon={only.icon}
          label={only.label}
          disabled={only.disabled}
          onClick={only.onSelect}
        />
      </Tooltip>
    ) : acting ? (
      <MoreButton ref={door} thing={thing} {...menu.trigger()} />
    ) : null;
  const keyMenu = (event: KeyboardEvent<HTMLElement>) => {
    if (!opensMenu(event)) return;
    event.preventDefault();
    const held = event.target instanceof HTMLElement ? event.target : event.currentTarget;
    menu.show(dropBelowStart(event.currentTarget), held);
  };
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the right-click and the menu key are further doors to the ⋯ beside it. */}
      <div
        className={
          row === undefined
            ? "settings-row menu-row flex min-h-settings-row-pair items-center justify-between gap-ui-12"
            : "menu-row"
        }
        {...(anchor ? searchAnchorProps(anchor) : undefined)}
        {...(acting ? menu.contextMenu(door) : undefined)}
        onKeyDown={acting ? keyMenu : undefined}
      >
        {row === undefined ? (
          <>
            {children}
            {more}
          </>
        ) : row.fold !== undefined ? (
          <SettingsFoldRow
            indent={row.indent}
            leading={row.leading}
            label={row.label}
            description={row.description}
            foldLabel={row.fold.label}
            defaultOpen={row.fold.defaultOpen}
            actions={() => more}
            run={row.fold.run}
          >
            {row.fold.lines}
          </SettingsFoldRow>
        ) : (
          <SettingsRow
            indent={row.indent}
            leading={row.leading}
            label={row.label}
            adornment={row.adornment}
            description={row.description}
            error={replayMaskedError(row.error)}
            landed={row.landed}
            below={row.below === undefined || row.below === null ? undefined : () => row.below}
          >
            {(control) => (
              <>
                {row.control}
                {row.describedControl?.(control)}
                {only === undefined ? (
                  more
                ) : (
                  // biome-ignore lint/a11y/useSemanticElements: a row's act is a press on its thing, not a form's field, so it is no `<fieldset>`.
                  <div role="group" aria-labelledby={control.labelId} className="contents">
                    {more}
                  </div>
                )}
                {row.chevron}
              </>
            )}
          </SettingsRow>
        )}
      </div>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(thing)}
          menu={menu.drawn}
          groups={groups}
          replayUnmasked
          {...(heading === undefined ? undefined : { heading })}
          onClose={menu.close}
        />
      )}
    </>
  );
}
