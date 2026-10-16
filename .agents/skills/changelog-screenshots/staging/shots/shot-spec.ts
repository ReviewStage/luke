/**
 * shot-spec.ts -- what one changelog shot stages: the plans and canned answers it draws, and the layout it opens on.
 *
 * Throwaway: the 0.12.0 changelog screenshots' staging, applied on a Mac to
 * the release commit and never committed. Only types and one marker live
 * here, so every shot module and every hook into the app can import it
 * without an evaluation-order cycle.
 */

import type { IntegrationProvider } from "@luke/features/integration-wire";
import type { TasksView } from "@luke/features/planning-view";
import type { ActKind, ActPayload, ActResultFor } from "@luke/host/acts";
import type { AppInboxTask, AppInboxTaskHolding } from "@luke/host/app-state";
import type { VoiceView } from "#shared/messages/voice-view";
import type { SidebarCollapse } from "../desktop/sidebar-collapse";
import type { MainTab } from "../tasks/use-main-tabs";
import type { HistorySpot } from "../tasks/use-plan-history";
import type { TasksControl } from "../tasks/use-tasks-tab";
import type { SidePanelState, SidePanelTab } from "../tasks/use-side-panel";
import type { SettingsView } from "../settings-views";

/** An answer that never settles: what a long-poll loop is handed once it has read what it will read. */
export const NEVER: unique symbol = Symbol("shot-never");

/**
 * One kind's canned answer, from its payload: a value its own guard admits,
 * {@link NEVER} for a read held open forever, or nothing to let the act go
 * to main as it would.
 */
export type ShotAnswer<Kind extends ActKind> = (
  payload: ActPayload<Kind>,
) => ActResultFor<Kind> | typeof NEVER | undefined;

/** Every kind a shot answers itself, each by its own answer. */
export type ShotAnswers = { readonly [Kind in ActKind]?: ShotAnswer<Kind> };

/** What the staging effect hands each step: the Plans tab, the sidebar, and the way into Settings. */
export interface ShotStageContext {
  readonly tasks: TasksControl;
  readonly sidebar: SidebarCollapse;
  readonly openSettings: (view: SettingsView) => void;
}

/** One staging step, run once, the first render it is ready on. */
export interface ShotStep {
  readonly key: string;
  readonly ready: (context: ShotStageContext) => boolean;
  readonly run: (context: ShotStageContext) => void;
}

/**
 * The window's layout as the shot opens on it, each staged once the thing
 * it needs is drawn. Anything left out stays as the fixture run opens it.
 */
export interface ShotLayout {
  /** Folds the sidebar away. */
  readonly sidebarCollapsed?: boolean;
  /** Pins the plan's summary open; shots keep it folded to its rail unless they ask. */
  readonly summaryPinned?: boolean;
  /** The side panel fills the window over the plan's column. */
  readonly sidePanelFullScreen?: boolean;
  /** Tabs chosen in the side panel once the plan is drawn, in order, the last one shown: a Changes or a Page tab, which a staged state cannot hold. */
  readonly sidePanelTabs?: readonly SidePanelTab[];
  /** A file of the plan's repository opened in a tab of its own, as the palette opens one. */
  readonly sidePanelFile?: string;
  /** The plan's column's tab: its Inbox, or an agent's, chosen once the agent is listed. */
  readonly mainTab?: MainTab;
  /** Opens Settings on a page. */
  readonly settingsView?: SettingsView;
  /** Opens the plan's version history where it stood: on a revision, with its sections open. */
  readonly history?: HistorySpot;
  /** Opens ⌘K with the query typed. */
  readonly palette?: { readonly query: string };
  /** The sidebar plan whose hover card stands open. */
  readonly hoverTaskId?: string;
  /** Draws every section's "Edited by" byline, which otherwise shows only under the pointer. */
  readonly bylines?: boolean;
}

/** One shot: everything it draws in place of the fixture's, and how it is laid out. */
export interface ShotSpec {
  /** The plans the Plans tab draws, its open one included. */
  readonly tasks: TasksView;
  /** The side panel the open plan starts with; referentially stable, as the spec is built once. */
  readonly sidePanel?: SidePanelState;
  /** The call standing on the open plan, as the voice window would report it; none for every shot but the Call tab's. */
  readonly call?: Pick<VoiceView, "voiceStatus" | "callPlanId" | "callTranscript">;
  /** The acts the shot answers itself (`canned-acts.ts`). */
  readonly answers?: ShotAnswers;
  /** What main would say waits on the developer: the sidebar's Inbox count and the window's Inbox. */
  readonly inbox?: {
    readonly waiting: readonly AppInboxTask[];
    readonly tasks: readonly AppInboxTaskHolding[];
  };
  /**
   * Settings › Integrations as the shot draws it: the providers it leaves
   * out (Slack, hidden in this release), the account each connected row
   * names under it, and the GitHub row it adds at the head, naming the
   * account the Luke GitHub App is installed on.
   */
  readonly integrations?: {
    readonly hidden: readonly IntegrationProvider[];
    readonly accounts: Partial<Record<IntegrationProvider, string>>;
    readonly github?: string;
  };
  readonly layout?: ShotLayout;
  /** Staging the layout cannot say, run after it (`use-shot-staging.ts`). */
  readonly steps?: readonly ShotStep[];
}
