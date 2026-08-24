import type { CredentialProviderId } from "@sidecar/credentials";
import type { RealtimeVoice, RealtimeVoiceSpeed } from "@sidecar/realtime";
import type {
  CliConnection,
  ProviderId,
  SessionFilter,
  WorkspaceAgentSelection,
} from "@sidecar/session";
import type { VoiceSource } from "@sidecar/settings";
import type { WorkspaceProviderId } from "@sidecar/superset/vocabulary";
import type { PanelFormFactor } from "@sidecar/surface";
import type { CredentialSource, SecretStorage } from "./account";
import type { CalendarAccount } from "./calendar";

export { CLI_CONNECTION, type CliConnection } from "@sidecar/session";
export type {
  AppSettingField,
  AppSettingValue,
  KeyedAppSettingField,
  SettingEntryValue,
  SettingsResetScope,
  VoiceSource,
} from "@sidecar/settings";
export {
  APP_SETTING_DEFAULTS,
  isSettingsResetScope,
  isVoiceSource,
  SETTINGS_RESET_SCOPE,
  VOICE_SOURCE,
} from "@sidecar/settings";

/** Renderer-safe settings. Credentials are never sent to a renderer. */
export interface AppSettings {
  /** Where each provider's key comes from, keyed by provider id. */
  credentialSources: Readonly<Record<CredentialProviderId, CredentialSource>>;
  /**
   * Whether Codex cloud tasks can be observed right now: through the Codex
   * CLI's own login rather than a key of Luke's, so the row it draws reports
   * a fact learned from that CLI instead of offering anything to enter.
   */
  codexCloudConnection: CliConnection;
  /**
   * Luke stores credentials only through OS-provided encryption. When that is
   * known to be unavailable the app says so rather than falling back to
   * plaintext storage; while it is unknown the app says nothing about it.
   */
  secretStorage: SecretStorage;
  /**
   * Whether a Realtime credential could actually be minted: a key resolved, and
   * this run will use it. It travels with the settings rather than only with
   * bootstrap because storing the key is what turns voice on — the reply to that
   * save, and the broadcast beside it, are how every panel learns it, and how
   * they learn a deleted key turned it back off.
   */
  voiceAvailable: boolean;
  /**
   * Which credential Luke actually speaks and reviews sessions on right now,
   * resolved rather than stored: the choice the user made where it can be
   * honoured, and what is available where it cannot. The panel draws its
   * toggle from this, so what is marked in use is always what a press of the
   * talk key would really spend.
   */
  voiceSource: VoiceSource;
  /**
   * Whether this build can offer the Google Calendar sign-in: an OAuth client
   * registered and usable this run. Without one the integration is not drawn
   * at all — a row whose one act cannot run is not a row.
   */
  calendarSignInAvailable: boolean;
  /**
   * The same for Linear, whose row is a sign-in rather than a field: the
   * issues are read under a grant Linear's own consent page issues, so a
   * build carrying no registration draws no Linear row at all. Whether one is
   * connected is `credentialSources`, as it is for every other service.
   */
  linearSignInAvailable: boolean;
  /**
   * The connected Google Calendar accounts, each with the calendars the user
   * chose to count. Empty until a sign-in lands one.
   */
  calendarAccounts: readonly CalendarAccount[];
  /**
   * Whether this build can offer the Apple Calendar connection: a Mac whose
   * own Calendar there is to read, in a run that would read it. No OAuth
   * client gates it — the grant lives with macOS — so this answers for the
   * platform the way `calendarSignInAvailable` answers for a registration.
   */
  appleCalendarAvailable: boolean;
  /**
   * The Apple Calendar connection with the calendars the user chose to
   * count, absent while not connected. One source at most: this Mac's own
   * Calendar already aggregates every account macOS holds.
   */
  appleCalendar?: CalendarAccount;
  /**
   * Whether Luke stands in the Dock as well as at the notch. Off by default:
   * an accessory app is what Luke ships as, so an icon among the user's apps
   * is opted into rather than discovered.
   */
  showInDock: boolean;
  /**
   * The voice Luke speaks with, as the settings resolve it: the one the user
   * chose, else the launch environment's, else the default — so the panel
   * marks the voice that would actually be heard, not just a stored value.
   */
  voice: RealtimeVoice;
  /**
   * The pace Luke speaks at, resolved the same way as the voice: the one the
   * user chose, else the launch environment's, else the natural rate.
   */
  voiceSpeed: RealtimeVoiceSpeed;
  /**
   * Whether Luke's words are captioned on screen while he speaks. Off by
   * default: the voice experience ships as sound, and words drawn under the
   * housing all day are something to opt into rather than discover.
   */
  voiceCaptions: boolean;
  /**
   * The talk-key chord the user chose, absent while the defaults stand. This
   * is the stored choice rather than the registered key — the two differ when
   * another app owns the chosen chord — so it says only whether there is a
   * choice to reset, and the row keeps showing the key that actually answers.
   */
  voiceHotkey?: string;
  /**
   * The ask-key chord the user chose, absent while the defaults stand. The
   * stored choice on the talk key's exact terms: the registered key is what
   * the row shows, and this only says whether there is a choice to reset.
   */
  askHotkey?: string;
  /**
   * The stop-key chord the user chose, on the same terms as the other two:
   * only whether there is a choice to reset, never the key the row shows.
   */
  stopHotkey?: string;
  /**
   * Whether Music and Spotify are turned down while a spoken exchange is
   * live, and back up after. On by default: speech over music is the failure
   * everyone has had, and the duck defers to the user everywhere it can — it
   * touches only a player that was playing, and a volume moved by hand during
   * the duck is left where the hand put it.
   */
  duckOtherMedia: boolean;
  /**
   * Whether a press listens through the Mac's own microphone when the system
   * input is a Bluetooth headset. On by default: capturing from a headset's
   * microphone pulls the whole headset onto its call codec, so everything it
   * plays turns phone-grade for the exchange. Off means the system default is
   * used exactly as chosen. A shut lid keeps the headset microphone either
   * way, because a muffled question is worse than a degraded song.
   */
  preferBuiltInMicrophone: boolean;
  /**
   * Whether announcements wait out the user's meetings. While the connected
   * calendar shows a meeting on, a session's spoken notices are held and read
   * out together once it ends. On by default: speaking into a meeting is the
   * failure connecting a calendar exists to prevent, and the switch is what
   * keeps the calendar readable without the quiet. It changes nothing until
   * a calendar is connected, because without one there is no meeting to see.
   */
  quietDuringMeetings: boolean;
  /**
   * Whether Luke stands on every connected display at once. Off by default:
   * he keeps to the system's main display until asked, and turning this off
   * again is what brings him back to it.
   */
  showOnAllDisplays: boolean;
  /**
   * Whether Luke counts how his own features are used and sends those counts
   * to his own service. On by default, and the outer switch over everything
   * that leaves unbidden: every event name and every property value is fixed
   * by the build, so nothing observed and nothing typed or spoken can travel
   * in one. It is excluded from every reset scope, because a reset that
   * turned it back on would be a consent nobody gave.
   */
  shareUsageData: boolean;
  /**
   * Whether Luke also records what his own panel draws, and sends it to the
   * analytics processor directly rather than through his own service. It does
   * not share the counts' guarantee and must never be described as though it
   * did: a recording is the rendered surface, so a session title, branch,
   * recap, error line, and the account's own name and address travel because
   * they are drawn, and only what is typed into a field is masked. The same
   * client autocaptures the text of whatever was clicked and reports
   * unhandled errors, so this switch governs those too. On by default, off
   * whenever `shareUsageData` is off, and excluded from every reset scope for
   * the same reason sharing is.
   */
  sessionReplay: boolean;
  /**
   * How Luke stands on a display without a camera housing: a drawn notch
   * pressed into the top edge, or the free-floating bubble every such display
   * gets by default. A display with a real notch answers to neither.
   */
  formFactor: PanelFormFactor;
  /**
   * The session list's chosen filter chips, absent while nothing narrows it.
   * A chosen narrowing is a standing way of viewing the list, so it survives
   * the panel closing and the app restarting; the order deliberately does not
   * travel with it. Fixture and capture runs leave it unread, because their
   * evidence must not vary with what a developer last chose.
   */
  sessionFilters?: readonly SessionFilter[];
  /**
   * The session list's held search words, absent while nothing is searched.
   * A held search stands with the chips as a way of viewing the list, so it
   * survives on the same terms and comes back with its field open — a
   * narrowing must never be in force behind no visible control. Clearing or
   * closing the field is what lets the words go. Fixture and capture runs
   * leave it unread, like the chips.
   */
  sessionSearchQuery?: string;
  /**
   * The provider a conversational ask creates a new workspace in when the ask
   * names none, absent until one has been chosen. It starts unset on purpose:
   * the first workspace the user actually creates saves its provider here, so
   * the default is always a choice they made rather than one made for them.
   */
  defaultWorkspaceProvider?: WorkspaceProviderId;
  /**
   * The agent kind and model new workspaces start with, per provider, each
   * entry absent while that provider's own defaults stand. Keyed by provider
   * id and held to the build's documented table for that provider — a pairing
   * outside it is dropped rather than honoured, because it names nothing the
   * provider's endpoints take.
   */
  workspaceAgentDefaults?: Readonly<Partial<Record<ProviderId, WorkspaceAgentSelection>>>;
  /**
   * The project a conversational ask creates a workspace in when the ask
   * names none, per provider, each entry absent until one has been chosen. It
   * starts unset the way the provider does: the first workspace the user
   * creates in a provider saves its project here, so the default is always a
   * choice they made rather than one made for them. Projects are observed
   * rather than build-fixed, so the value identifies the provider's project
   * and, where needed, its host; it steers an ask only while the provider
   * still offers that exact project target.
   */
  workspaceProjectDefaults?: Readonly<Partial<Record<WorkspaceProviderId, string>>>;
  /** The configured Superset agent used when a creation ask names none. */
  supersetAgentDefault?: string;
}

/** A rejected update reports why without echoing the submitted value. */
export interface SettingsUpdateResult {
  settings: AppSettings;
  reason?: string;
}
