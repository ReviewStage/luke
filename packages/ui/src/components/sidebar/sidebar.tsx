import type { ReactNode } from "react";
import { ReplayWords } from "../../session-replay-marks.js";

export function SidebarIdentity({
  name,
  qualifier,
  mark,
  replayUnmasked = false,
}: {
  name: string;
  qualifier?: string | undefined;
  mark: ReactNode;
  replayUnmasked?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div className="sidebar-identity flex items-center gap-ui-12 px-row-inset pt-ui-2 pb-section-gap">
      <span className="grid size-ui-40 flex-none place-items-center rounded-ui-14 bg-fill-strong">
        <span className="grid size-ui-24">{mark}</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-dialog-size font-dialog tracking-identity">
          <ReplayWords unmasked={replayUnmasked}>{name}</ReplayWords>
        </span>
        {qualifier === undefined ? null : (
          <span className="text-caption-inline text-muted-foreground">
            <ReplayWords unmasked={replayUnmasked}>{qualifier}</ReplayWords>
          </span>
        )}
      </span>
    </div>
  );
}

export function SidebarPlaces({
  label,
  children,
}: {
  label?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const className = "sidebar-places mb-list-gap flex flex-none flex-col gap-list-gap";
  return label === undefined ? (
    <div className={className}>{children}</div>
  ) : (
    <nav aria-label={label} className={className}>
      {children}
    </nav>
  );
}

export function SidebarRule(): React.JSX.Element {
  return <hr className="sidebar-rule mx-row-inset my-ui-8 h-px flex-none border-0 bg-border" />;
}

export function SidebarFoot({ children }: { children?: ReactNode }): React.JSX.Element {
  return <div className="sidebar-foot flex flex-col pt-ui-8">{children}</div>;
}

export function SidebarAccountRow({ children }: { children?: ReactNode }): React.JSX.Element {
  return (
    <div className="sidebar-account-row @container/sidebar-foot flex items-center gap-ui-4">
      {children}
    </div>
  );
}
