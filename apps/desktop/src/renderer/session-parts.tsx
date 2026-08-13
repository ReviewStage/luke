import type { SessionState } from "@sidecar/core";
import { PANEL_TAB, panelPanelId, panelTabId } from "./panel-tabs";

export function StateChip({
  state,
  label,
}: {
  state: SessionState;
  label: string;
}): React.JSX.Element {
  return (
    <span className="state-chip" data-state={state}>
      <span className="state-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function EmptyState(): React.JSX.Element {
  return (
    <div className="empty-state">
      <strong>Nothing to watch yet</strong>
      <small>Sessions appear here as soon as an agent starts working.</small>
    </div>
  );
}

/** Wraps the sessions tab so its tab semantics match the settings tab. */
export function SessionsPanel({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={className}
      role="tabpanel"
      id={panelPanelId(PANEL_TAB.SESSIONS)}
      aria-labelledby={panelTabId(PANEL_TAB.SESSIONS)}
    >
      {children}
    </div>
  );
}
