import { ACCOUNT_STATUS, type AccountProvider } from "@sidecar/credentials/snapshot";
import { SidebarIcon, WingFace } from "@sidecar/panel";
import { voiceHotkeyLabel } from "@sidecar/settings";
import type { FaceMotion } from "@sidecar/surface";
import { PANEL_TAB, type PanelTab } from "../panel-tabs";
import type { PlansControl } from "../planning/use-plans-tab";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { SignInGate } from "../sign-in-gate";
import { updateAvailable, updateRow } from "../update-row";
import { DesktopPlans } from "./desktop-plans";
import { DesktopSettings } from "./desktop-settings";
import { DesktopSidebar } from "./desktop-sidebar";
import type { LukeIdentityProps } from "./luke-identity";
import { SIDEBAR_HOTKEY, SIDEBAR_HOTKEY_ARIA, type SidebarCollapse } from "./sidebar-collapse";

/** What stands between the developer and the window's own content: the account sign-in. */
export interface DesktopGates {
  accountRequired: boolean;
  signInFailure?: string | undefined;
  onBeginSignIn: (provider: AccountProvider) => void;
  /** The signed-out Luke's introduction cycle, walked over the sign-in card. */
  signInFace: { play: number; motion?: FaceMotion };
}

/**
 * The sign-in, alone in the window: Luke over a card holding it. Nothing
 * else is drawn, because nothing else can run until it is answered.
 */
function Onboarding({
  face,
  children,
}: {
  face: { play: number; motion?: FaceMotion };
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="desktop-onboarding">
      <div className="desktop-drag-strip" />
      <div className="desktop-onboarding-card">
        <span className="desktop-onboarding-face" aria-hidden="true">
          <WingFace key={face.play} {...(face.motion ? { motion: face.motion } : undefined)} />
        </span>
        {children}
      </div>
    </div>
  );
}

/**
 * Folds the sidebar away and back. It stands beside the traffic lights rather
 * than in the sidebar, so it is in the same place whichever way the sidebar
 * is, and the plan's toolbar leaves it room while the sidebar is folded.
 */
function SidebarToggle({ sidebar }: { sidebar: SidebarCollapse }): React.JSX.Element {
  const label = sidebar.collapsed ? "Show sidebar" : "Hide sidebar";
  return (
    <button
      type="button"
      className="toolbar-button toolbar-icon-button sidebar-toggle"
      aria-label={label}
      aria-keyshortcuts={SIDEBAR_HOTKEY_ARIA}
      title={`${label} (${voiceHotkeyLabel(SIDEBAR_HOTKEY)})`}
      onClick={sidebar.onToggle}
    >
      <SidebarIcon />
    </button>
  );
}

/**
 * Luke's window: the sidebar on the left and the chosen work on the right,
 * or the sign-in over the whole window while no account stands. Every
 * press is the control's it came from; this only lays them out. Settings
 * keeps its page list whatever the sidebar's collapse says, and hands the
 * plans back folded or not as it found them.
 */
export function DesktopShell({
  gates,
  identity,
  tab,
  onTabChange,
  plans,
  sidebar,
  settings,
  onSettingsSearchEngaged,
}: {
  gates: DesktopGates;
  identity: LukeIdentityProps;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  plans: PlansControl;
  sidebar: SidebarCollapse;
  settings: SettingsPanelProps;
  /** The caret entering or leaving the settings search, which holds the panel open. */
  onSettingsSearchEngaged: (engaged: boolean) => void;
}): React.JSX.Element {
  const { account } = settings;
  if (gates.accountRequired && account.status !== ACCOUNT_STATUS.SIGNED_IN) {
    return (
      <Onboarding face={gates.signInFace}>
        <SignInGate
          account={account}
          {...(gates.signInFailure ? { failure: gates.signInFailure } : undefined)}
          onBegin={gates.onBeginSignIn}
          onQuit={settings.onQuit}
        />
      </Onboarding>
    );
  }
  // Settings wears the update row's own words, so the dot's hover and the
  // row it leads to tell one story about the same release.
  const settingsNote = updateAvailable(settings.updates.update)
    ? updateRow(settings.updates.update).detail
    : undefined;
  // Settings takes the whole window, its pages listed where the plans were.
  if (tab === PANEL_TAB.SETTINGS) {
    return (
      <div className="desktop-shell">
        <DesktopSettings
          settings={settings}
          onSearchEngaged={onSettingsSearchEngaged}
          onBack={() => onTabChange(PANEL_TAB.PLANS)}
        />
      </div>
    );
  }
  return (
    <div className="desktop-shell" data-sidebar-collapsed={String(sidebar.collapsed)}>
      <SidebarToggle sidebar={sidebar} />
      <DesktopSidebar
        collapsed={sidebar.collapsed}
        identity={identity}
        plans={plans}
        tab={tab}
        onTabChange={onTabChange}
        account={account}
        settingsNote={settingsNote}
      />
      <main className="desktop-main">
        <DesktopPlans plans={plans} />
      </main>
    </div>
  );
}
