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

/**
 * Two small puffs and one large one over a flat base, traced as a single
 * outline: drawn as overlapping shapes instead, a fill this translucent doubles
 * where they cross and every seam inside the cloud shows.
 */
const CLOUD_PATH = "M4.5 14a4.5 4.5 0 0 1-1.259-8.82 7 7 0 0 1 13.518 0A4.5 4.5 0 0 1 15.5 14z";

/**
 * Sits in the bottom-right corner of a provider mark to say the session is not
 * running on this machine. It is ours rather than a brand mark, so it is drawn
 * filled in the text palette: at this size a stroked outline closes up, and a
 * second brand colour beside the provider's own would read as part of the mark.
 * The corner it takes is the mark's, not the row's, because what runs remotely
 * is the session — not the provider the whole row belongs to.
 */
export function CloudBadge(): React.JSX.Element {
  return (
    <span className="row-cloud" role="img" aria-label="Runs in the cloud">
      {/* The box is the cloud's own proportions rather than the square the
          other glyphs use, so at this size the shape spends every pixel it has
          on itself rather than on margin. */}
      <svg viewBox="0 0 20 14" fill="currentColor" aria-hidden="true" focusable="false">
        <path d={CLOUD_PATH} />
      </svg>
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
