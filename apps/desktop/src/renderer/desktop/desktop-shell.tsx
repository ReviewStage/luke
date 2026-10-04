import { ACCOUNT_STATUS, type AccountProvider } from "@sidecar/credentials/snapshot";
import { WingFace } from "@sidecar/panel";
import type { FaceMotion } from "@sidecar/surface";
import { CalendarGate, type CalendarGateControl } from "../calendar-gate";
import { ConductorKeyGate, type ConductorKeyGateControl } from "../conductor-key-gate";
import { PANEL_TAB, type PanelTab, type ShownPanelTab } from "../panel-tabs";
import type { PlansControl } from "../planning/use-plans-tab";
import { CalendarGateReview } from "../settings/calendar-gate-review";
import type { SettingsPanelProps } from "../settings/settings-panel";
import { SignInGate } from "../sign-in-gate";
import { updateAvailable, updateRow } from "../update-row";
import { DesktopPlans } from "./desktop-plans";
import { DesktopSettings } from "./desktop-settings";
import { DesktopSidebar } from "./desktop-sidebar";
import type { LukeIdentityProps } from "./luke-identity";

/** What stands between the developer and the window's own content, in the order onboarding asks it. */
export interface DesktopGates {
  accountRequired: boolean;
  signInFailure?: string | undefined;
  onBeginSignIn: (provider: AccountProvider) => void;
  conductorKeyGate?: ConductorKeyGateControl | undefined;
  calendarGate?: CalendarGateControl | undefined;
  /** The signed-out Luke's introduction cycle, walked over the sign-in card. */
  signInFace: { play: number; motion?: FaceMotion };
}

/**
 * One onboarding step, alone in the window: Luke over a card holding the
 * step. Nothing else is drawn, because nothing else can run until it is
 * answered.
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
 * Luke's window: the sidebar on the left and the chosen work on the right,
 * or one onboarding step over the whole window while one is owed. Every
 * press is the control's it came from; this only lays them out.
 */
export function DesktopShell({
  gates,
  identity,
  tab,
  onTabChange,
  plans,
  settings,
  settingsSearchOpen,
  onSettingsSearchToggle,
}: {
  gates: DesktopGates;
  identity: LukeIdentityProps;
  tab: PanelTab;
  onTabChange: (tab: ShownPanelTab) => void;
  plans: PlansControl;
  settings: SettingsPanelProps;
  settingsSearchOpen: boolean;
  onSettingsSearchToggle: () => void;
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
  if (gates.conductorKeyGate) {
    return (
      <Onboarding face={{ play: 0 }}>
        <ConductorKeyGate control={gates.conductorKeyGate} onQuit={settings.onQuit} />
      </Onboarding>
    );
  }
  if (gates.calendarGate) {
    const review =
      settings.settings !== undefined &&
      (settings.settings.calendarAccounts.length > 0 ||
        settings.settings.appleCalendar !== undefined) ? (
        <CalendarGateReview settings={settings} />
      ) : undefined;
    return (
      <Onboarding face={{ play: 0 }}>
        <CalendarGate
          control={gates.calendarGate}
          {...(review !== undefined ? { review } : undefined)}
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
          searchOpen={settingsSearchOpen}
          onSearchToggle={onSettingsSearchToggle}
          onBack={() => onTabChange(PANEL_TAB.PLANS)}
        />
      </div>
    );
  }
  return (
    <div className="desktop-shell">
      <DesktopSidebar
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
