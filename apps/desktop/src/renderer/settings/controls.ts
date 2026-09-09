import type { AccountCalendar, ObservedAccountCalendars } from "@sidecar/settings/wire";
import type { ActionResult } from "@sidecar/wire";
import type { MicrophoneStatus } from "#shared/messages/audio";
import type { WorkspaceProviderId } from "#shared/messages/session";
import type { UpdateSnapshot } from "#shared/messages/update";

/** One provider the default-workspace rows can offer, by id and display name. */
export interface WorkspaceProviderOption {
  id: WorkspaceProviderId;
  name: string;
  /**
   * The projects this provider's default-project row can offer: everything
   * currently observed for it, and nothing else. A stored default the provider
   * has stopped offering has no label of its own to be drawn under, and steers
   * nothing until it is cleared, which the main process does on the same
   * observation that stopped offering it.
   */
  projects: readonly { id: string; label: string }[];
}

/**
 * Whether Luke may open the microphone, and the two things that can be done
 * about that: asking the system for access, or opening the one place the
 * system's own grant can be changed.
 */
export interface MicrophoneControl {
  status: MicrophoneStatus;
  /** Whether there is anything to talk to, which is the microphone's only use. */
  voiceAvailable: boolean;
  /** Asks the system for access. Using the microphone is the talk key's job. */
  onRequest: () => void;
  /** Opens the one place the system's own grant can be changed. */
  onOpenSettings: () => void;
}

/**
 * Where the app stands against the latest release, and the actions the row can
 * take about that: ask the release manifest now, restart into a build already
 * downloaded, or — where installing in place is impossible or has failed —
 * open the releases page in the browser. A newer build downloads itself when
 * a check finds one; the running build is replaced only at a quit.
 */
export interface UpdateControl {
  update: UpdateSnapshot;
  /** Asks the release manifest for the latest build, right now. */
  onCheck: () => Promise<void>;
  /** Restarts into the downloaded release. */
  onInstall: () => void;
  /** Opens the latest release's page, fixed by the build, in the browser. */
  onOpenLatest: () => void;
}

/**
 * The talk, ask, and stop keys as registered, and the one way to move them
 * or to say a recording is under way. The keys the rows show are the ones
 * that actually answered, which can differ from the stored choice when
 * another app owns the chord — that stored choice is what Reset undoes.
 */
export interface ShortcutControl {
  /**
   * The talk key as registered, as an accelerator: the row draws it as its
   * separate keys and says it whole in the labels its buttons carry.
   */
  voiceHotkey?: string;
  /** Whether that key can be held, which is what the row has to describe. */
  voiceHotkeyHeld: boolean;
  /** Whether a chosen talk chord is stored, which is what Reset has to undo. */
  voiceChosen: boolean;
  /**
   * Whether the talk key was deleted outright: no chord registered, and no
   * default standing in. The row says "None" rather than "Unavailable",
   * because this absence is the user's own choice.
   */
  voiceOff: boolean;
  /**
   * Moves the talk key to a recorded chord, the none token, or back to the
   * defaults when omitted. The store answers with why when it refuses, and
   * the row is where that answer belongs.
   */
  onVoiceHotkeyChange: (accelerator: string | undefined) => Promise<ActionResult>;
  /** The ask key as registered, an accelerator on the talk key's terms. */
  askHotkey?: string;
  /** Whether a chosen ask chord is stored, on the talk key's terms. */
  askChosen: boolean;
  /** Whether the ask key was deleted outright, on the talk key's terms. */
  askOff: boolean;
  /**
   * Moves the ask key to a recorded chord, the none token, or back to the
   * defaults when omitted, on the talk key's terms: the store answers with
   * why when it refuses, and the row is where that answer belongs.
   */
  onAskHotkeyChange: (accelerator: string | undefined) => Promise<ActionResult>;
  /** The stop key as registered, an accelerator on the talk key's terms. */
  stopHotkey?: string;
  /** Whether a chosen stop chord is stored, on the other rows' terms. */
  stopChosen: boolean;
  /** Whether the stop key was deleted outright, on the other rows' terms. */
  stopOff: boolean;
  /**
   * Moves the stop key to a recorded chord, the none token, or back to the
   * default when omitted, on the other rows' terms: the store answers with
   * why when it refuses, and the row is where that answer belongs.
   */
  onStopHotkeyChange: (accelerator: string | undefined) => Promise<ActionResult>;
  /**
   * Whether a recording control has the keyboard. While one does, no Luke
   * key may act on its own press: the chord arriving is an entry, not an ask.
   */
  onCapture: (capturing: boolean) => void;
}

/** Everything the Google Calendar block can do, wired above the panel. */
export interface CalendarControl {
  /** Each connected account's calendars, as last observed. */
  choices: readonly ObservedAccountCalendars[];
  /** True while another entry holds the slot, which refuses a second action. */
  held: boolean;
  /** True while a sign-in is waiting on the browser. */
  connecting: boolean;
  /** Stands the panel down and opens Google's consent page. */
  onSignIn: () => void;
  onRemoveAccount: (accountId: string) => Promise<ActionResult>;
  onToggleCalendar: (
    accountId: string,
    calendarId: string,
    selected: boolean,
  ) => Promise<ActionResult>;
  /**
   * Runs one calendar observation pass now, over every source. Block-level
   * because the pass is, though only the Apple row draws the button today.
   */
  onRefresh: () => Promise<void>;
}

/** Everything the Apple Calendar row can do, wired above the panel. */
export interface AppleCalendarControl {
  /** This Mac's calendars, as last observed. */
  choices: readonly AccountCalendar[];
  /** True while another entry holds the slot, which refuses a second action. */
  held: boolean;
  /** True while the system's consent dialog is up. */
  connecting: boolean;
  /** Stands the panel down so macOS's own dialog is not covered by it. */
  onSignIn: () => void;
  onDisconnect: () => Promise<ActionResult>;
  onToggleCalendar: (calendarId: string, selected: boolean) => Promise<ActionResult>;
  /**
   * True when the System Settings switch has been turned off: the stored
   * connection stands, but the row offers Connect again — reconnecting is
   * the only action left, and refresh or disconnect would both be acts on a
   * grant that is gone.
   */
  revoked: boolean;
}

/** What the Linear row can be asked for, which is connecting and ending it. */
export interface LinearControl {
  /** True while another entry holds the slot, which refuses a second action. */
  held: boolean;
  /** True while a sign-in is waiting on the browser. */
  connecting: boolean;
  /** Stands the panel down and opens Linear's consent page. */
  onSignIn: () => void;
  onDisconnect: () => Promise<ActionResult>;
}

export interface SupersetControl {
  installed: boolean;
  connected: boolean;
  held: boolean;
  connecting: boolean;
  onConnect: () => void;
  /** Runs the CLI's own documented sign-out, withdrawing the stored login. */
  onDisconnect: () => Promise<ActionResult>;
  agents: readonly string[];
  defaultAgent?: string;
  onDefaultAgentChange: (agent: string | undefined) => Promise<ActionResult>;
}
