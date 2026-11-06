import { type ReactNode, useRef } from "react";
import { ReplayWords } from "../../session-replay-marks.js";
import { type TitleSeat, useWrapWhenCut } from "../../use-wrap-when-cut.js";
import { Menu, type MenuEntry, useMenu } from "../menu/menu.js";
import { MoreButton, moreLabel } from "../more-button/more-button.js";
import { OneLine } from "../one-line/one-line.js";
import { wholeWordsHint } from "../tooltip/hint.js";

const BAR =
  "ui-pane-bar box-border flex min-h-pane-bar min-w-0 flex-none items-center gap-control-gap border-b border-border bg-muted px-list-inset py-tight-gap font-sans text-caption text-muted-foreground";
const LEAD =
  "ui-pane-bar-lead flex min-w-0 flex-initial items-center gap-item-gap pl-row-inset whitespace-nowrap [.ui-pane-bar-start+&]:pl-0";
const START = "ui-pane-bar-start flex flex-none items-center";
const END = "ui-pane-bar-end flex flex-none items-center";
const MARK = "ui-pane-bar-mark flex flex-none items-center [&>svg]:size-control-icon";
const MIDDLE = "ui-pane-bar-middle flex min-w-0 flex-auto items-center gap-control-gap";
const ACTIONS = "ui-pane-bar-actions ml-auto flex flex-none items-center gap-ui-2";
const WRAPPED = "flex-wrap gap-y-0";
const TITLE_ROW =
  "ui-pane-bar-title-row order-last flex min-h-control min-w-0 basis-full items-center pl-row-inset";
const TITLE_SEAT: TitleSeat = { room: ".ui-pane-bar-lead", words: ".ui-pane-bar-title" };

export interface PaneBarMenu {
  readonly thing: string;
  readonly groups: readonly (readonly MenuEntry[])[];
  readonly replayUnmasked?: boolean | undefined;
}

function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

function BarMenu({ menu }: { menu: PaneBarMenu }): React.JSX.Element {
  const drop = useMenu(true);
  return (
    <>
      <MoreButton thing={menu.thing} {...drop.trigger()} />
      {drop.drawn === undefined ? null : (
        <Menu
          label={moreLabel(menu.thing)}
          menu={drop.drawn}
          groups={menu.groups}
          onClose={drop.close}
          replayUnmasked={menu.replayUnmasked}
        />
      )}
    </>
  );
}

export function PaneBar({
  start,
  mark,
  title,
  titleReplayUnmasked = false,
  detail,
  middle,
  actions,
  menu,
  end,
}: {
  start?: ReactNode;
  mark?: ReactNode;
  title?: string | undefined;
  titleReplayUnmasked?: boolean | undefined;
  detail?: ReactNode;
  middle?: ReactNode;
  actions?: ReactNode;
  menu?: PaneBarMenu | undefined;
  end?: ReactNode;
}): React.JSX.Element {
  const frame = useRef<HTMLElement>(null);
  const titled = title !== undefined && title !== "";
  const wrapped = useWrapWhenCut(frame, TITLE_SEAT, titled);
  const leads = said(mark) || (titled && !wrapped) || said(detail);
  const acts = said(actions) || menu !== undefined || said(end);
  const words = titled ? (
    <OneLine
      className="ui-pane-bar-title flex-initial text-foreground"
      hint={wholeWordsHint(title)}
      words={title}
    >
      <ReplayWords unmasked={titleReplayUnmasked}>{title}</ReplayWords>
    </OneLine>
  ) : null;
  return (
    <header
      ref={frame}
      className={wrapped ? `${BAR} ${WRAPPED}` : BAR}
      data-wrapped={wrapped ? "true" : undefined}
    >
      {said(start) ? <div className={START}>{start}</div> : null}
      {leads ? (
        <div className={LEAD}>
          {said(mark) ? <span className={MARK}>{mark}</span> : null}
          {wrapped ? null : words}
          {said(detail) ? <span className="ui-pane-bar-detail flex-none">{detail}</span> : null}
        </div>
      ) : null}
      {wrapped ? <div className={TITLE_ROW}>{words}</div> : null}
      {said(middle) ? <div className={MIDDLE}>{middle}</div> : null}
      {acts ? (
        <div className={ACTIONS}>
          {actions}
          {menu === undefined ? null : <BarMenu menu={menu} />}
          {said(end) ? <div className={END}>{end}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
