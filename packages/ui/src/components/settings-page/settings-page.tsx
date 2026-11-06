import { type ReactNode, useRef, useState } from "react";
import { type PageScroll, PageScrollContext } from "../page-frame/page-scroll.js";
import { useHeadingAway } from "../page-header/heading-away.js";
import { PAGE_HEADER_END, PageHeader } from "../page-header/page-header.js";
import { RevealArea, revealArea } from "../reveal/reveal.js";
import {
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
} from "../settings-section/settings-section.js";
import { Skeleton } from "../skeleton/skeleton.js";
import { TEXT_TONE, Text } from "../text/text.js";
import { TOOLBAR_INSET, TOOLBAR_LOOK, Toolbar, type ToolbarLook } from "../toolbar/toolbar.js";

const SKELETON_TITLE_WIDTH = "calc(5 * var(--ui-control-height))";

function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

export function SettingsPage({
  title,
  description,
  actions,
  lead,
  look = TOOLBAR_LOOK.WINDOW,
  titleReplayUnmasked = false,
  children,
}: {
  title: ReactNode;
  titleReplayUnmasked?: boolean | undefined;
  description?: ReactNode;
  actions?: ReactNode;
  lead?: ReactNode;
  look?: ToolbarLook | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const page = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const sections = useRef<HTMLDivElement>(null);
  const named = useHeadingAway(page, head);
  const [scroll] = useState((): PageScroll => ({ scroller: page, shiftedBy: sections }));
  const phone = look === TOOLBAR_LOOK.PHONE;
  return (
    <div className="ui-settings-page-frame flex h-full min-h-0 min-w-0 grow basis-0 flex-col">
      <Toolbar
        lead={lead}
        {...(phone
          ? {
              look,
              place: "settings-page",
              start: TOOLBAR_INSET.COLUMN,
              end: TOOLBAR_INSET.COLUMN,
              title,
              titleReplayUnmasked,
              actions,
            }
          : { pickUp: { name: named.name, shown: named.away } })}
      />
      <div
        ref={page}
        className="ui-settings-page @container/ui-settings-page box-border min-h-0 min-w-0 grow basis-0 overflow-x-clip overflow-y-auto overscroll-contain scroll-py-page-inset [scrollbar-gutter:stable]"
      >
        <div
          className={
            phone
              ? "ui-settings-page-column mx-auto pt-title-under-bar"
              : "ui-settings-page-column mx-auto"
          }
        >
          {phone ? (
            said(description) ? (
              <div className="ui-settings-page-head mb-ui-24">
                <Text tone={TEXT_TONE.MUTED}>{description}</Text>
              </div>
            ) : null
          ) : (
            <div ref={head} className="ui-settings-page-head mb-ui-24">
              <PageHeader
                title={title}
                description={description}
                actions={actions}
                end={PAGE_HEADER_END.WORDS}
              />
            </div>
          )}
          <RevealArea root={sections}>
            <div
              ref={sections}
              className="ui-settings-page-sections flex min-w-0 flex-col gap-page-section-gap"
              {...revealArea()}
            >
              <PageScrollContext value={scroll}>{children}</PageScrollContext>
            </div>
          </RevealArea>
        </div>
      </div>
    </div>
  );
}

export function SettingsPageSkeleton({
  label,
  lead,
  look,
  sections,
}: {
  label: string;
  lead?: ReactNode;
  look?: ToolbarLook | undefined;
  sections: readonly SettingsSectionSkeletonShape[];
}): React.JSX.Element {
  return (
    <SettingsPage title={<Skeleton width={SKELETON_TITLE_WIDTH} />} lead={lead} look={look}>
      <SettingsSectionsSkeleton label={label} sections={sections} />
    </SettingsPage>
  );
}
