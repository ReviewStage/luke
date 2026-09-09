import { isDeepStrictEqual } from "node:util";
import { channels } from "#shared/bridge";
import { IDLE_VOICE_VIEW } from "#shared/messages/voice-view";
import { type AppState, type AppStateChange, sessionReplayBootstrap } from "./app-state";

/**
 * One channel the windows already listen on, and what it carries out of the
 * document. Every push the renderer knows is here and nowhere else: adding a
 * channel is adding a row, and a slice nothing reads reaches no window at
 * all.
 */
interface AppStateChannel<Payload, Movement = Payload> {
  readonly channel: string;
  readonly read: (state: AppState) => Payload | undefined;
  /**
   * What decides that this channel moved, where the payload alone does not
   * say. Only the roster needs one: a window reads any delivery as a reading
   * actually taken, so a first pass that found nothing has to travel even
   * though it draws exactly what the bootstrap already did.
   */
  readonly moves?: (state: AppState) => Movement;
  /**
   * Whether an absence is itself the news: the output helper going silent,
   * and a key the system refused, both have to reach the window that is
   * still drawing what they last said. Everywhere else an absent value means
   * the host has not answered yet, and a window must not be handed the gap.
   */
  readonly absentTravels?: boolean;
  /** Whether the window whose own write produced the change is skipped. */
  readonly skipsReporter?: boolean;
}

function stateChannel<Payload, Movement = Payload>(
  entry: AppStateChannel<Payload, Movement>,
): AppStateChannel<Payload, Movement> {
  return entry;
}

const APP_STATE_CHANNELS = [
  stateChannel({
    channel: channels.onSettingsChanged,
    read: (state) => state.settings,
    skipsReporter: true,
  }),
  stateChannel({ channel: channels.onAccountChanged, read: (state) => state.account }),
  stateChannel({
    channel: channels.onSessionsChanged,
    read: (state) => state.sessions.roster,
    moves: (state) => ({ roster: state.sessions.roster, settled: state.sessions.settled }),
  }),
  stateChannel({
    channel: channels.onWorkspaceProjectsChanged,
    read: (state) => state.sessions.workspaceProjects,
  }),
  stateChannel({ channel: channels.onCalendarsChanged, read: (state) => state.calendars }),
  stateChannel({
    channel: channels.onAnnouncementsHeldChanged,
    read: (state) => state.announcements.held,
  }),
  stateChannel({
    channel: channels.onSupersetSignInChanged,
    read: (state) => state.superset.signIn,
  }),
  stateChannel({
    channel: channels.onCalendarOnboardingChanged,
    read: (state) => state.onboarding.calendarOwed,
  }),
  stateChannel({
    channel: channels.onSessionReplayChanged,
    read: (state) => sessionReplayBootstrap(state),
  }),
  stateChannel({ channel: channels.onBrainRequestsChanged, read: (state) => state.brain.runs }),
  stateChannel({
    channel: channels.onConversationHistoryChanged,
    read: (state) => state.conversation,
    skipsReporter: true,
  }),
  stateChannel({ channel: channels.onUpdateChanged, read: (state) => state.update }),
  stateChannel({
    channel: channels.onMicrophoneStatusChanged,
    read: (state) => state.audio.microphoneStatus,
  }),
  stateChannel({
    channel: channels.onOutputAudioChanged,
    read: (state) => state.audio.outputAudio,
    absentTravels: true,
  }),
  // A voice window that went away leaves no view behind, and an idle voice is
  // what every panel draws in its place.
  stateChannel({
    channel: channels.onVoiceViewChanged,
    read: (state) => state.voice.view ?? IDLE_VOICE_VIEW,
  }),
  stateChannel({ channel: channels.onVoiceLevelChanged, read: (state) => state.voice.level }),
  stateChannel({
    channel: channels.onVoiceHotkeyChanged,
    read: (state) => ({
      ...(state.hotkeys.talk ? { hotkey: state.hotkeys.talk } : undefined),
      held: state.hotkeys.talkHeld,
    }),
  }),
  // A chord that answers nothing must not be one Luke claims to have, so an
  // absent key travels as the absence it is.
  stateChannel({
    channel: channels.onAskHotkeyChanged,
    read: (state) => state.hotkeys.ask,
    absentTravels: true,
  }),
  stateChannel({
    channel: channels.onStopHotkeyChanged,
    read: (state) => state.hotkeys.stop,
    absentTravels: true,
  }),
] as const;

export type AppStatePayload = ReturnType<(typeof APP_STATE_CHANNELS)[number]["read"]>;

export type AppStateDelivery = (
  channel: string,
  payload: AppStatePayload,
  exceptReporter: string | undefined,
) => void;

/**
 * The one place a change in the document becomes a push. A channel travels
 * only when what it carries actually moved, so a patch that touched a slice
 * two channels read wakes only the one that changed.
 */
export function fanOutAppState(change: AppStateChange, deliver: AppStateDelivery): void {
  for (const entry of APP_STATE_CHANNELS) {
    const payload = entry.read(change.state);
    if (payload === undefined && entry.absentTravels !== true) continue;
    const moves = entry.moves ?? entry.read;
    if (isDeepStrictEqual(moves(change.previous), moves(change.state))) continue;
    deliver(entry.channel, payload, entry.skipsReporter === true ? change.reporter : undefined);
  }
}
