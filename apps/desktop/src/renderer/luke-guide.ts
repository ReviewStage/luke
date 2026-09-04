/**
 * Luke's knowledge of himself, in one place.
 *
 * Everything the voice conversation may know about the app — what Luke is on
 * screen, every setting with its current value and its default, and where
 * each is changed by hand — is assembled here into the `AppGuideSnapshot` the
 * conversation is sent. A capability this file does not describe is one Luke
 * will not offer, and a setting it does not mark changeable is one no spoken
 * ask can touch, so adding either to the app means adding it here in the same
 * change. The facts cover what Luke needs to hold a conversation and what a
 * spoken ask may do — capabilities, refusals, and their bounds — not what the
 * surface and the settings entries can say for themselves, which the closing
 * fact has Luke redirect rather than deny.
 *
 * The settings half is built from the exhaustive schema in
 * `shared/settings-schema.ts`, so a new stored setting does not build until its
 * guide entry is declared there. The facts have no such lever, which is why
 * the agent guide states the rule in words.
 *
 * Nothing here may carry a credential, a key's shape, or any part of one:
 * the guide says whether a provider is connected, and no more.
 */

import {
  CLOUD_AGENT_PROVIDER_LIST,
  CONNECTION_ID,
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "@sidecar/credentials/vocabulary";
import {
  APP_UPDATE_ACT,
  APP_UPDATE_WAIT,
  type AppGuideFact,
  type AppGuideSetting,
  type AppGuideSnapshot,
  type AppGuideUpdate,
  type AppUpdateButton,
} from "@sidecar/guide";
import { PROVIDER_ID, type WorkspaceAgentSelection, workspaceAgentModels } from "@sidecar/session";
import {
  APP_SETTING_ID,
  APP_SETTING_SCHEMA,
  isAppSettingId,
  settingFieldForGuideId,
  settingGuideEntries,
  spokenSettingValue,
} from "@sidecar/settings";
import { ACT_RESULT_STATUS, type ActResult } from "@sidecar/wire";
import type { AppBridge } from "#shared/bridge";
import type { AccountSnapshot, CredentialSource } from "#shared/wire/account";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
} from "#shared/wire/account";
import type { MicrophoneStatus } from "#shared/wire/audio";
import type { AppSettings, AppSettingsView, SettingsUpdateResult } from "#shared/wire/settings";
import { CLI_CONNECTION } from "#shared/wire/settings";
import type { UpdateSnapshot } from "#shared/wire/update";
import { UPDATE_STATUS } from "#shared/wire/update";
import { UPDATE_ROW_ACTION, type UpdateRowAction, updateRow } from "./update-row";

export type { AppSettingId } from "@sidecar/settings";
/** The ids a spoken change names Luke's settings by. */
export { APP_SETTING_ID, isAppSettingId } from "@sidecar/settings";

/** Where the switches live, said once so every entry words it the same way. */
const SETTINGS_TAB = "the panel's Settings tab";

/** Where the hosted account and OpenAI key choices both live. */
const VOICE_SOURCE_SECTION = `${SETTINGS_TAB}, on its Voice page, in the Provider section after Permissions`;
/** Where the signed-in identity and the two ways out of it live. */
const ACCOUNT_SECTION = `the Account section, at the foot of ${SETTINGS_TAB}'s front page`;
const SHORTCUTS_PAGE = `${SETTINGS_TAB}, on its Keyboard shortcuts page`;
const CONNECTIONS_PAGE = `${SETTINGS_TAB}, on its Connections page`;
/* Where the Updates section stands, for the fact about it. */
const FRONT_PAGE = `${SETTINGS_TAB}, on its front page`;

/**
 * The word both Conductor agent entries use for no choice at all. It is a
 * member of their choices on purpose: saying it is how a spoken ask returns a
 * half to Conductor's own default.
 */
const CONDUCTOR_DEFAULT_CHOICE = "Conductor's default";

/** What the guide needs from the app to describe the current state of it. */
export interface LukeGuideInput {
  /** Optional only for pure callers that predate accounts; the app always supplies it. */
  account?: AccountSnapshot;
  settings: AppSettingsView;
  /** Where the build stands, for the guide's Updates entry. */
  update: UpdateSnapshot;
  /** Whether a Realtime credential can be minted at all. */
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  /**
   * The talk key labelled the way macOS writes it, absent when none was
   * registered. Labelled rather than drawn as keys: the guide is spoken and
   * read, and a chord said aloud is one thing to press. `removed` is the one
   * absence that is the developer's own choice — the shortcut was deleted —
   * and the fact must say so rather than blame another app.
   */
  hotkey: { hotkey?: string; held: boolean; removed?: boolean };
  /** The ask key labelled on the same terms, absent when none was registered. */
  askKey?: string;
  /** Whether the ask key's absence is a deleted shortcut, on the talk key's terms. */
  askKeyRemoved?: boolean;
  /**
   * The stop key labelled on the same terms, absent when none was registered
   * — another app owns Option-S, or another Luke key was moved onto it.
   */
  stopKey?: string;
  /** Whether the stop key's absence is a deleted shortcut, on the talk key's terms. */
  stopKeyRemoved?: boolean;
}

function talkKeyFact(hotkey: LukeGuideInput["hotkey"]): AppGuideFact {
  if (hotkey.removed) {
    return {
      label: "Talk key",
      detail: `None — the shortcut was removed, so no key is registered anywhere. A chord can be recorded again, or the default restored, in ${SHORTCUTS_PAGE}.`,
    };
  }
  if (!hotkey.hotkey) {
    return {
      label: "Talk key",
      detail:
        "None is registered right now — another app may own the shortcut. The Settings tab's Keyboard shortcuts page shows its state.",
    };
  }
  const use = hotkey.held
    ? "hold to talk, let go to send; tap instead to keep the turn open"
    : "press to talk, again to send, again to interrupt";
  return {
    label: "Talk key",
    detail: `${hotkey.hotkey}, from any app: ${use}. A different chord can be recorded, the default restored, or the shortcut removed, in ${SHORTCUTS_PAGE}.`,
  };
}

function askKeyFact(askKey: string | undefined, removed: boolean | undefined): AppGuideFact {
  if (removed) {
    return {
      label: "Ask key",
      detail: `None — the shortcut was removed, so no key summons the composer; the panel's own composer still takes a typed ask. A chord can be recorded again, or the default restored, in ${SHORTCUTS_PAGE}.`,
    };
  }
  if (!askKey) {
    return {
      label: "Ask key",
      detail:
        "None is registered right now — another app may own the shortcut, or voice is off. The Settings tab's Keyboard shortcuts page shows its state.",
    };
  }
  return {
    label: "Ask key",
    detail:
      `${askKey}, from any app: summons the panel with the caret in the typed composer, and the ` +
      `same press puts it away. A different chord can be recorded, the default restored, or the shortcut removed, in ${SHORTCUTS_PAGE}.`,
  };
}

const MICROPHONE_DETAIL = {
  granted:
    "Granted. The microphone opens only when the talk key takes a turn, sends nothing after " +
    "the key comes up, and closes once the exchange settles. Typing to Luke never opens it.",
  denied:
    "Denied, so the talk key cannot capture. Typing to Luke still works: a typed ask opens no " +
    "capture device, and the reply is spoken either way. It can only be granted back in " +
    "System Settings, under Privacy & Security, Microphone.",
  restricted:
    "Restricted by a system policy, which only the system's manager can change. Typing to " +
    "Luke still works: a typed ask opens no capture device.",
  "not-determined":
    "Not asked yet — typing to Luke needs no permission, and only the talk key's capture " +
    "does. The Permissions section on the Settings tab's Voice page can ask while voice is " +
    "available.",
  unknown: "Unknown. The Permissions section on the Settings tab's Voice page shows its state.",
};

/** The same three answers a credential row gives, in words a fact can carry. */
function connectionWord(source: CredentialSource): string {
  return source === CREDENTIAL_SOURCE.NONE
    ? "not connected"
    : source === CREDENTIAL_SOURCE.ENVIRONMENT
      ? "connected from the environment"
      : "connected";
}

/** The row's answer about the Codex CLI login, in words a fact can carry. */
const CODEX_CLOUD_CONNECTION_WORD = {
  [CLI_CONNECTION.CONNECTED]: "connected",
  [CLI_CONNECTION.SIGNED_OUT]: "not connected; the CLI is signed out",
  [CLI_CONNECTION.CLI_MISSING]: "not connected; the CLI is not installed",
  [CLI_CONNECTION.UNKNOWN]: "not checked yet",
};

function providersFact(settings: AppSettingsView): AppGuideFact {
  const roster = CLOUD_AGENT_PROVIDER_LIST.map(
    (provider) =>
      `${provider.displayName} (${connectionWord(settings.credentialSources[provider.id])})`,
  );
  return {
    label: "Cloud providers",
    detail:
      `${roster.join(", ")}. Connecting one takes the key its row names, typed by hand into ` +
      `${CONNECTIONS_PAGE}, under Providers — never spoken, and never repeated back. Local ` +
      "providers such as Claude Code need no key and are observed on their own. Codex cloud " +
      `tasks (${CODEX_CLOUD_CONNECTION_WORD[settings.cliConnections[CONNECTION_ID.CODEX]]}) follow the ` +
      "Codex CLI's own login: codex login connects them, and signing that CLI out stops them. " +
      "While the Sync provider keys switch in the Sync section is on, a key saved while signed in " +
      "is also stored encrypted with Luke's own service, which never sends one back; the " +
      "switch is changed only by hand, and its own entry says what turning it moves.",
  };
}

/**
 * One labeled fact per integration, so an ask about one draws that one alone.
 * An integration a build does not carry contributes no fact at all: a
 * capability the guide describes is one Luke will claim to have.
 */
function integrationFacts(settings: AppSettingsView): AppGuideFact[] {
  const facts: AppGuideFact[] = [];
  const linearProvider = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR];
  if (settings.consentSignInAvailable[CONNECTION_ID.LINEAR]) {
    facts.push({
      label: "Linear",
      detail:
        `${linearProvider.displayName} ` +
        `(${connectionWord(settings.credentialSources[linearProvider.id])}) connects by signing ` +
        `in with Linear from its row in ${CONNECTIONS_PAGE}, under Integrations — no key is ` +
        `ever typed or spoken. Connected, Luke can, when asked, move an issue the developer ` +
        `names to another state or comment on it; disconnecting from the same row ends the ` +
        `access at Linear as well as here.`,
    });
  }
  if (settings.appleCalendarAvailable) {
    facts.push({
      label: "Apple Calendar",
      detail:
        settings.appleCalendar === undefined
          ? "Apple Calendar (not connected) connects from its row through macOS's own " +
            "calendar-access ask — no sign-in and no key. Connecting it lets Luke read only " +
            "when the meetings in this Mac's Calendar start and end — never their titles or " +
            "who attends."
          : "Apple Calendar (connected) reads only when the meetings in this Mac's Calendar " +
            "start and end — never their titles or who attends. Which calendars count is chosen " +
            "with the checkboxes on its row, and the access itself stays the user's in System " +
            "Settings under Privacy & Security, Calendars.",
    });
  }
  const accounts = settings.calendarAccounts.length;
  if (settings.calendarSignInAvailable) {
    facts.push({
      label: "Google Calendar",
      detail:
        accounts === 0
          ? "Google Calendar (not connected) connects by signing in with Google from its row. " +
            "Connecting it lets Luke read only when meetings start and end — never their " +
            "titles or who attends."
          : `Google Calendar (${accounts === 1 ? "1 account" : `${accounts} accounts`} connected) ` +
            "reads only when meetings start and end — never their titles or who attends. Which " +
            "calendars count is chosen with the checkboxes under each account, and more accounts " +
            "can be added from the same row.",
    });
  }
  facts.push({
    label: "Superset",
    detail:
      "Superset workspaces on this Mac are recognized read-only from Superset's own host " +
      "state; their chats open at their exact terminal in Superset — pressed, or asked of " +
      "Luke — and an idle worktree workspace stands as its own row. When Superset's CLI is " +
      "logged in, chat rows can send the developer's own message, rename the workspace, " +
      "start another agent in it, or create a new Superset workspace by ask. Every Superset " +
      "row offers Delete workspace once its work settled — an agentless idle row counts as " +
      "settled — and Superset keeps no archive: " +
      "deleting is permanent and takes the whole workspace with every chat in it, a row " +
      "still working is never offered it, a single chat cannot be closed or removed on its " +
      "own, and an ask to archive one means exactly this delete. Superset connects and " +
      "disconnects by hand, from its row under Providers.",
  });
  facts.push({
    label: "Conductor",
    detail:
      "Conductor cloud connects with a key under Providers and creates workspaces in the " +
      "cloud projects that key lists. Conductor on this Mac needs no key and is recognized " +
      "read-only, and an ask can create a new workspace in any repository it holds locally; " +
      "the opening task is pre-filled in Conductor but not sent, so the developer presses " +
      "Return there to start it. Local Conductor chats stay read-only otherwise: Luke " +
      "cannot message, archive, or add an agent to one.",
  });
  return facts;
}

/**
 * The one key that is neither an agent's nor an integration's, described where
 * its row lives: after Permissions on the Voice page, beside the feature it turns on.
 */
function voiceKeyFact(settings: AppSettingsView, voiceAvailable: boolean): AppGuideFact {
  const openai = CREDENTIAL_PROVIDERS[VOICE_CREDENTIAL_PROVIDER_ID];
  const source = settings.credentialSources[openai.id];
  const hosted = voiceAvailable && source === CREDENTIAL_SOURCE.NONE;
  return {
    label: openai.displayName,
    detail:
      `${openai.displayName} (${connectionWord(source)}). ` +
      (hosted
        ? `Voice and session review run on the signed-in Luke account; a key of the ` +
          `developer's own runs them through OpenAI instead, billed by OpenAI. `
        : source === CREDENTIAL_SOURCE.NONE
          ? `Signing in — or connecting a key — is what lets Luke speak and review sessions. `
          : `Voice and session review run on this key: nothing through Luke's ` +
            `service, and OpenAI bills you for what you use. `) +
      `The key is typed by hand into ${VOICE_SOURCE_SECTION} — never read from the ` +
      `environment, never spoken, and never repeated back.`,
  };
}

/** The row's button, in the words a spoken update ask names an act by. */
const UPDATE_BUTTON_FOR_ROW_ACTION = {
  [UPDATE_ROW_ACTION.CHECK]: APP_UPDATE_ACT.CHECK,
  [UPDATE_ROW_ACTION.CHECKING]: APP_UPDATE_WAIT.CHECKING,
  [UPDATE_ROW_ACTION.DOWNLOADING]: APP_UPDATE_WAIT.DOWNLOADING,
  [UPDATE_ROW_ACTION.RESTART]: APP_UPDATE_ACT.RESTART,
  [UPDATE_ROW_ACTION.GET]: APP_UPDATE_ACT.DOWNLOAD,
} as const satisfies Record<UpdateRowAction, AppUpdateButton>;

/**
 * The guide's Updates entry, read from the same row the settings page draws
 * so the sentence out loud and the button on screen can never disagree. The
 * download's progress is stripped before the row is read: the guide refreshes
 * the session instructions whenever its text changes, and a percent tick is
 * not news.
 */
function updateGuideEntry(update: UpdateSnapshot): AppGuideUpdate {
  const steady =
    update.status === UPDATE_STATUS.DOWNLOADING ? { ...update, progress: undefined } : update;
  const row = updateRow(steady);
  return {
    version: update.currentVersion,
    detail: row.detail,
    button: UPDATE_BUTTON_FOR_ROW_ACTION[row.action],
  };
}

/**
 * Builds the guide from what the app currently knows about itself. Pure and
 * synchronous so the renderer can rebuild it on every settings change and the
 * conversation always describes the app as it is, not as it launched.
 */
export function buildLukeGuide(input: LukeGuideInput): AppGuideSnapshot {
  const account = input.account ?? { status: ACCOUNT_STATUS.SIGNED_OUT };
  const facts: AppGuideFact[] = [
    {
      label: "What Luke is",
      detail:
        "A macOS sidecar living beside the notch. Luke's own face sits on one side of the " +
        "housing and the marks of the apps holding tracked work sit on the other. Hovering " +
        "peeks, pressing opens the panel, and Escape closes what is open.",
    },
    {
      label: "The marks beside the housing",
      detail:
        "The apps holding the tracked sessions, most urgent first. At rest there is room " +
        "for one, so the capsule shows the app whose session needs a person soonest; " +
        "hovering or opening the panel spreads the whole set out. They report which apps " +
        "Luke is watching and nothing more — they are not controls, and pressing one does " +
        "nothing. Narrowing the list by app is done with the filter chips in the Sessions " +
        "tab.",
    },
    {
      label: "The panel",
      detail:
        "Two tabs, Sessions and Settings, switched by pressing one or by asking Luke to show " +
        "it. Asked while the panel is closed, the panel opens on that tab.",
    },
    {
      label: "The sessions list",
      detail:
        "Lists every observed session that still matters. The options button filters by " +
        "location, kind, app, and agent and orders by urgency or recency; a spoken ask can " +
        "filter, sort, or clear the same way. A row can be opened, messaged, or controlled " +
        "where its provider allows, and Luke's own composer at the foot takes a typed ask.",
    },
    {
      label: "Apps beside a session",
      detail:
        "A chat held by several apps — Conductor, ChatGPT, Superset — wears their marks on " +
        "its row. A mark with an exact address opens the chat in that app, and an ask can " +
        "name which app it comes forward in.",
    },
    {
      label: "Searching sessions",
      detail:
        "The list is searchable by the magnifier, Command-F, or asking Luke to search out " +
        "loud — a spoken search fills the same field and reaches no further than the " +
        "magnifier, which is only offered beside a list of more than one session.",
    },
    {
      label: "The Settings tab",
      detail:
        "Where Luke is configured by hand. The front page opens the Voice, Appearance, " +
        "Keyboard shortcuts, and " +
        "Connections pages; Feedback, Account, and Quit stay on the front page. A settings " +
        "search — the magnifier, or Command-F — finds any row, by hand alone: no spoken ask " +
        "can search it.",
    },
    {
      label: "Conversation history",
      detail:
        "The panel's History tab shows every typed ask, transcribed spoken ask, reply, " +
        "announcement, and session act, kept across launches in Luke's own file on this Mac — " +
        "up to 200 lines and 14 days, whichever cuts first. Luke carries only the 20 most " +
        "recent entries into a call. The view is blocked from panel recordings, is not " +
        "exportable, and can be cleared by hand from that tab. Luke's own composer stands at " +
        "its foot too, the same typed ask the sessions list offers, so a reply is asked for " +
        "where it will land. A line draws a pressable chip " +
        "for each chat it named, going to that chat by hand; a chip keeps working for a chat " +
        "archived since — opened at the last address its provider reported this launch — and " +
        "a chat with no address draws none. A spoken open still reaches only sessions " +
        "currently observed.",
    },
    {
      label: "Account",
      detail:
        account.status === ACCOUNT_STATUS.SIGNED_IN
          ? `Signed in as ${account.email} through ${account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}. Sign out by hand from ${ACCOUNT_SECTION} — it asks before acting. The same section's Delete account row erases the account and everything Luke's service holds for it, cannot be undone, and is only ever done by hand — its button asks before acting, and no spoken ask can reach it.`
          : "Not signed in. The sign-in screen offers Google and GitHub, and hovering or pressing the strip beside the housing brings it back; live sessions and Luke's controls stay off until sign-in finishes.",
    },
    {
      label: "Feedback and prompts",
      detail:
        "The Feedback section on the Settings tab opens a composer: Send feedback for bugs " +
        "and ideas, Submit a prompt for a prompt to a coding agent, either going by email to " +
        "the founders. A spoken ask can open the composer with the developer's own words — " +
        "Luke offers exactly that after refusing something he cannot do, and a note already " +
        "being written is never overwritten — but sending is always the Send button's own " +
        "press: no spoken ask can send one.",
    },
    {
      label: "Reading a session's transcript",
      detail:
        "Asked what a local session did, said, or is stuck on, Luke can read that session's " +
        "own recent transcript — Claude Code, Codex, and OMP on this machine today — and " +
        "answer from it; the reading is kept nowhere. A cloud session's conversation stays " +
        "with its provider, answered from roster fields alone.",
    },
    {
      label: "Creating workspaces",
      detail:
        "Where a connected provider documents a creation endpoint — Conductor and Superset " +
        "today — an ask in conversation, spoken or typed, can create a new " +
        "workspace in a project that provider reports, with an opening task in the " +
        "developer's own words where the project takes one, named as the developer chose or, " +
        "when they chose none, by a short name Luke composes for the work, so a Conductor " +
        "cloud workspace never falls back to the random city name it would otherwise get; a " +
        "project listed as naming its own workspaces — Codex cloud, and Conductor's local " +
        "create link — takes no name at all. Only reported " +
        "projects can be named, a project that needs a task cannot be created without one, " +
        "and a provider that reports none takes no ask; a new Superset workspace needs a " +
        "host, an agent, and an opening task, so a task-less ask for one is refused. A bare " +
        "ask for a new agent creates a new workspace — an ask naming an existing workspace " +
        "or session adds an agent beside it instead — and a workspace that lands opens on " +
        "screen by itself once it reports an address.",
    },
    {
      label: "Workspace creation defaults",
      detail:
        "An ask that names no provider goes to the default workspace provider, and one that " +
        "names no project to that provider's default project; the first workspace created " +
        "fills each in, both are changed or cleared by hand in Settings, and until one is " +
        "chosen, Luke asks. What a new Conductor agent runs — its model, and its effort " +
        "where the model takes one — follows the choice on the Conductor row; a model named " +
        "in the ask rides that creation alone, and Luke never asks or suggests a model.",
    },
    {
      label: "Adding agents to a workspace",
      detail:
        "Where a session's provider documents it — Conductor and Superset today — the same kind of ask " +
        "can start another agent in an observed session's workspace, as one of the agent " +
        "kinds its roster entry lists; a session whose entry lists none takes no such ask. " +
        "The ask must name the workspace or session — a bare ask for a new agent creates a " +
        "new workspace instead — and a model named in the ask rides that agent alone.",
    },
    {
      label: "Renaming workspaces and chats",
      detail:
        "Where a provider documents it — a Conductor or Superset-managed workspace, or a " +
        "Conductor chat on its own — an ask can rename what is observed to a name in the " +
        "developer's own words. An ask naming the workspace renames the workspace, one " +
        "about the chat renames the chat, and a session whose roster entry allows neither " +
        "takes no such ask.",
    },
    {
      label: "Archiving",
      detail:
        "Where a provider documents an archive endpoint — a Conductor workspace today — " +
        "Archive is offered once the work " +
        "was positively seen to settle: pressed, or asked of Luke, it files the work away, " +
        "and archiving a Conductor workspace files away every chat in it at once. A row " +
        "mid-turn offers no archive, a session whose roster entry lists no archive control " +
        "takes no such ask, and local sessions are never archived. A Superset-managed " +
        "workspace keeps no archive: an ask to archive one is taken as its Delete workspace " +
        "control — permanent, never filed away.",
    },
    talkKeyFact(input.hotkey),
    askKeyFact(input.askKey, input.askKeyRemoved),
    { label: "Microphone access", detail: MICROPHONE_DETAIL[input.microphoneStatus] },
    ...(input.voiceAvailable
      ? [
          {
            label: "Stopping a reply",
            detail:
              // The removal outranks a reported chord: a broadcast can lag the
              // deletion, and teaching the key that was just deleted is worse
              // than the honest absence.
              (input.stopKeyRemoved
                ? "Escape while Luke is speaking cuts the reply off and asks for nothing in " +
                  "its place. No system-wide stop key is registered — its shortcut was removed."
                : input.stopKey
                  ? `${input.stopKey}, from any app, cuts the reply off and asks for nothing in ` +
                    "its place; Escape does the same while Luke's panel has the keyboard."
                  : "Escape while Luke is speaking cuts the reply off and asks for nothing in " +
                    "its place. No system-wide stop key is registered right now — another app " +
                    "may own the shortcut.") +
              " The talk key over a reply interrupts too, but takes the turn with the same " +
              `press. A different stop chord can be recorded, the default restored, or the ` +
              `shortcut removed, in ${SHORTCUTS_PAGE}.`,
          },
          {
            // A behavior rather than a setting: stated here so Luke does not
            // deny announcing; the switch that turns it off is the schema
            // entry's to describe.
            label: "Announcements",
            detail:
              "Luke says it out loud when an observed session is holding for you, stops on " +
              "an error, or finishes — a hold is a question, a permission, or an approval, " +
              "not a turn that merely ended — naming the session and what it needs. No " +
              "conversation needs to be open, the microphone stays off, and it is on by " +
              "default while voice is available. Luke waits five seconds for nearby updates and says " +
              "them together in one announcement. A session in a live voice conversation " +
              "with its own provider announces nothing until that conversation closes. " +
              "The Announce when sessions need you switch on the Voice page — on by " +
              "default, and also flippable by asking Luke — turns them off: Luke sleeps " +
              "while it is off, and held ones are read out once it is switched back on, " +
              "the still-true ones only; conversations the developer opens still answer " +
              "aloud while it is off.",
          },
          {
            // A behavior rather than a setting, for the announcements' own
            // reason: Luke must neither deny having just spoken it nor offer
            // to replay it.
            label: "The arrival beat",
            detail:
              "After the account's first sign-in, once the calendar onboarding step is " +
              "answered, Luke speaks once, unprompted: go back to work, and he will say " +
              "when a session needs you, errors, or finishes — closing with one first ask " +
              "to try, which may name a working session. It plays once per install from a " +
              "fixed script, can act on nothing, and cannot be replayed; a launch that " +
              "cannot speak it leaves it for the next one that can.",
          },
          {
            // A behavior rather than a setting, on the arrival beat's terms:
            // Luke must be able to say why the panel is asking for a calendar
            // and what answers it, and must not offer to replay the ask.
            label: "Calendar onboarding",
            detail:
              "At the first sign-in, the panel asks once to connect a calendar (this Mac's " +
              "own, or Google) so announcements wait during meetings; Luke reads only when " +
              "meetings start and end, never titles or attendees. While the gate shows, " +
              "Luke says so aloud from a fixed script. Connecting shows which calendars " +
              "count, more connections can be added, and Done keeps the choice; Set up " +
              "later declines it for good, and calendars connect any time from " +
              "the Connections page.",
          },
          {
            label: "How long a conversation lasts",
            detail:
              "A call opens on the first press of the talk key or the first typed ask and " +
              "is put away after a few minutes of silence. The next press picks the " +
              "conversation back up: the recent exchange is kept in memory alone, never " +
              "written to disk, so Luke remembers what was just said.",
          },
        ]
      : [
          {
            label: "Voice",
            detail:
              "Off: nothing to run voice on, so no conversation can be opened. " +
              `Signing in turns it on; a key entered in ${VOICE_SOURCE_SECTION} also works.`,
          },
        ]),
    providersFact(input.settings),
    voiceKeyFact(input.settings, input.voiceAvailable),
    ...integrationFacts(input.settings),
    ...(input.settings.secretStorage === SECRET_STORAGE.UNAVAILABLE
      ? [
          {
            label: "Credential storage",
            detail:
              "This system offers no encrypted credential storage, so Luke will not store a key here.",
          },
        ]
      : []),
    {
      label: "Updates",
      detail:
        `The Updates section on ${FRONT_PAGE} says which version this is and where the build ` +
        "stands. The row's press can be asked of Luke — check for updates, open the releases " +
        "page, restart to update — and only the one act the row currently offers runs. The " +
        "Changelog row opens the changelog in the browser, by hand alone.",
    },
    {
      label: "Quitting",
      detail: `The Quit button at the foot of ${SETTINGS_TAB} or on the sign-in screen when it is shown.`,
    },
    {
      // The deliberate bound of this guide: minutiae are redirected, not
      // denied, so leaving a surface detail out of the facts stays safe.
      label: "Beyond this guide",
      detail:
        "This guide lists what Luke can do, promise, and refuse — not every detail of the " +
        "surface or its providers. Asked about finer behavior it does not cover, Luke points " +
        "to where it lives — the panel, a session's row, or the Settings tab — rather than " +
        "concluding the feature does not exist.",
    },
  ];

  const settings = settingGuideEntries(input.settings);

  return { facts, settings, update: updateGuideEntry(input.update) };
}

/**
 * Composes the stored Conductor selection a spoken model or effort change
 * asks for. A model is named by its label; an effort named beside it rides
 * that same change, and one left unsaid carries the current effort forward
 * only where the new model's agent documents it. An effort change alone
 * rides the model already chosen, which is why the effort entry only exists
 * while one is. Naming the default returns that half to Conductor: the whole
 * selection for a model, the effort alone otherwise.
 */
function spokenWorkspaceAgentSelection(
  settingId: string,
  value: string,
  namedEffort: string | undefined,
  current: WorkspaceAgentSelection | undefined,
): { selection: WorkspaceAgentSelection | undefined } | { refusal: string } {
  if (settingId === APP_SETTING_ID.WORKSPACE_AGENT_MODEL) {
    if (value === CONDUCTOR_DEFAULT_CHOICE) {
      if (namedEffort !== undefined) {
        return { refusal: "Conductor's own default takes no effort level." };
      }
      return { selection: undefined };
    }
    const named = workspaceAgentModels(PROVIDER_ID.CONDUCTOR)
      .flatMap((entry) =>
        entry.models.map((model) => ({
          agent: entry.agent,
          model: model.id,
          label: model.label,
          efforts: entry.efforts,
        })),
      )
      .find((candidate) => candidate.label === value);
    if (!named) return { refusal: "No documented Conductor model goes by that name." };
    if (namedEffort !== undefined) {
      // Composed against the table itself, not the guide the call was
      // validated against: this half answers to what an endpoint takes.
      if (!named.efforts.includes(namedEffort)) {
        return {
          refusal:
            named.efforts.length > 0
              ? `That model's effort is one of ${named.efforts.join(", ")}.`
              : "That model takes no effort level.",
        };
      }
      return { selection: { agent: named.agent, model: named.model, effort: namedEffort } };
    }
    const effort =
      current?.effort && named.efforts.includes(current.effort) ? current.effort : undefined;
    return {
      selection: { agent: named.agent, model: named.model, ...(effort ? { effort } : undefined) },
    };
  }
  // The effort entry only exists while a model is chosen, so an ask arriving
  // without one is a guide ahead of the state; refuse honestly.
  if (!current) {
    return {
      refusal: "No model is chosen for new Conductor agents, so there is no effort to set.",
    };
  }
  if (value === CONDUCTOR_DEFAULT_CHOICE) {
    return { selection: { agent: current.agent, model: current.model } };
  }
  return { selection: { agent: current.agent, model: current.model, effort: value } };
}

/**
 * Carries one validated spoken settings change to the same bridge calls the
 * settings rows use, and returns the canonical act result. Human-readable
 * history belongs to the act's ACTS narration, not to a second result shape.
 * The store answers with the settings it actually holds either way, and
 * `onSettings` hands that snapshot back to the panel so the switch on screen
 * and the sentence out loud never disagree. The current settings ride along
 * so a model or effort change composes against the selection actually stored.
 */
export async function applySpokenSetting(
  bridge: Pick<AppBridge, "updateSetting" | "updateSettingEntry">,
  action: { setting: AppGuideSetting; value: string; effort?: string },
  onSettings: (settings: AppSettings) => void,
  current?: AppSettingsView,
): Promise<ActResult> {
  let result: SettingsUpdateResult;
  if (
    action.setting.id === APP_SETTING_ID.WORKSPACE_AGENT_MODEL ||
    action.setting.id === APP_SETTING_ID.WORKSPACE_AGENT_EFFORT
  ) {
    const composed = spokenWorkspaceAgentSelection(
      action.setting.id,
      action.value,
      action.effort,
      current?.workspaceAgentDefaults?.[PROVIDER_ID.CONDUCTOR],
    );
    if ("refusal" in composed) {
      return { status: ACT_RESULT_STATUS.REJECTED, reason: composed.refusal };
    }
    result = await bridge.updateSettingEntry(
      APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
      PROVIDER_ID.CONDUCTOR,
      composed.selection,
    );
  } else {
    if (!isAppSettingId(action.setting.id)) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That setting cannot be changed from here.",
      };
    }
    const field = settingFieldForGuideId(action.setting.id);
    if (!field) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That setting cannot be changed from here.",
      };
    }
    const value = spokenSettingValue(field, action.value);
    if (value === undefined) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "That setting cannot be changed from here.",
      };
    }
    result = await bridge.updateSetting(field, value);
  }
  onSettings(result.settings);
  if (result.status !== ACT_RESULT_STATUS.ACCEPTED) {
    return { status: result.status, reason: result.reason };
  }
  return { status: ACT_RESULT_STATUS.ACCEPTED };
}
