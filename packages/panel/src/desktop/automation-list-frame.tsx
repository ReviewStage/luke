import {
  List,
  ListMotion,
  ListRow,
  SETTINGS_SECTION_FRAME,
  SETTINGS_SKELETON_CONTROL,
  SettingsControlSkeleton,
  SettingsSection,
  SKELETON_SHAPE,
  Skeleton,
  Toolbar,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { type ReactNode, useCallback, useRef } from "react";

const AUTOMATION_GROUP = "automation-group [.automation-group+&]:mt-page-section-gap";

export const AUTOMATION_ROW_META =
  "automation-row-meta inline-flex items-center gap-block-gap align-top";

const SKELETON_ROWS = [
  { name: "38%", trigger: "52%" },
  { name: "46%", trigger: "40%" },
  { name: "30%", trigger: "58%" },
] as const;

const SKELETON_META = { OWNER: "64px", NEXT: "96px" } as const;

const SKELETON_ROW_MARK = "20px";

const SKELETON_OWNER_MARK = "16px";

const SKELETON_ACTS = { AGENT: "168px", NEW: "140px" } as const;

export function AutomationsToolbar({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="automations-toolbar flex-none @container/automations-toolbar">
      <Toolbar
        title="Automations"
        titleReplayUnmasked
        actions={<div className="automations-acts contents">{children}</div>}
      />
    </div>
  );
}

export function AutomationsActsSkeleton(): React.JSX.Element {
  return (
    <>
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={SKELETON_ACTS.AGENT} />
      <Skeleton shape={SKELETON_SHAPE.CONTROL} width={SKELETON_ACTS.NEW} />
    </>
  );
}

export function AutomationGroupList({
  name,
  nameMasked = true,
  headed,
  children,
}: {
  name: string;
  nameMasked?: boolean;
  headed: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const root = useRef<HTMLElement | null>(null);
  const hold = useCallback((node: HTMLElement | null) => {
    root.current = node;
  }, []);
  const list = (
    <ListMotion root={root}>
      <SettingsSection
        title={headed ? nameMasked ? <ReplayMask>{name}</ReplayMask> : name : undefined}
        frame={SETTINGS_SECTION_FRAME.NONE}
      >
        <List label={name} moves>
          {children}
        </List>
      </SettingsSection>
    </ListMotion>
  );
  return headed ? (
    <div ref={hold} className={AUTOMATION_GROUP}>
      {list}
    </div>
  ) : (
    <section ref={hold} className={AUTOMATION_GROUP} aria-label={name}>
      {list}
    </section>
  );
}

export function AutomationRowMeta({
  lead,
  owner,
  next,
}: {
  lead?: ReactNode;
  owner: ReactNode;
  next: ReactNode;
}): React.JSX.Element {
  return (
    <span className={AUTOMATION_ROW_META}>
      {lead}
      {owner}
      <span className="automation-row-next inline-flex w-automation-next flex-none items-center justify-end gap-item-gap overflow-hidden">
        {next}
      </span>
    </span>
  );
}

export function AutomationOwnerFrame({
  owner,
  mark,
  name,
}: {
  owner?: string | undefined;
  mark: ReactNode;
  name: ReactNode;
}): React.JSX.Element {
  return (
    <span
      className="automation-owner inline-flex w-automation-owner flex-none items-center gap-item-gap overflow-hidden whitespace-nowrap"
      data-owner={owner}
    >
      {mark}
      {name}
    </span>
  );
}

export function AutomationListSkeleton({ narrow }: { narrow: boolean }): React.JSX.Element {
  return (
    <AutomationGroupList name="Automations" headed={false}>
      {SKELETON_ROWS.map(({ name, trigger }) => (
        <ListRow
          key={name}
          leading={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_ROW_MARK} />}
          title={<Skeleton width={name} />}
          description={<Skeleton width={trigger} />}
          meta={
            narrow ? undefined : (
              <AutomationRowMeta
                owner={
                  <AutomationOwnerFrame
                    mark={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_OWNER_MARK} />}
                    name={<Skeleton width={SKELETON_META.OWNER} />}
                  />
                }
                next={<Skeleton width={SKELETON_META.NEXT} />}
              />
            )
          }
          actions={<SettingsControlSkeleton control={SETTINGS_SKELETON_CONTROL.SWITCH} />}
        />
      ))}
    </AutomationGroupList>
  );
}
