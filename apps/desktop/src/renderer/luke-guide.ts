/**
 * Luke's knowledge of himself, in one place.
 *
 * Everything the voice conversation may know about the app — what Luke is on
 * screen, every setting with its current value and its default, and where
 * each is changed by hand — is assembled here into the `AppGuideSnapshot` the
 * conversation is sent. A feature this file does not describe is one Luke
 * will deny having, and a setting it does not mark changeable is one no
 * spoken ask can touch, so adding either to the app means adding it here in
 * the same change.
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
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "@sidecar/credentials";
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
import type { WireRecord } from "@sidecar/wire";
import type {
  AccountSnapshot,
  AppBridge,
  AppSettings,
  CredentialSource,
  MicrophoneStatus,
  SettingsUpdateResult,
  UpdateSnapshot,
} from "#shared/contracts";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  CLI_CONNECTION,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
  UPDATE_STATUS,
} from "#shared/contracts";
import { UPDATE_ROW_ACTION, type UpdateRowAction, updateRow } from "./update-row";

export type { AppSettingId } from "@sidecar/settings";
/** The ids a spoken change names Luke's settings by. */
export { APP_SETTING_ID, isAppSettingId } from "@sidecar/settings";

/** Where the switches live, said once so every entry words it the same way. */
const SETTINGS_TAB = "the panel's Settings tab";

/** Where the allowance meters and the OpenAI key row both live. */
const VOICE_SOURCE_SECTION = `${SETTINGS_TAB}, on its front page, in the What Luke runs on section at the top`;
/** Where the signed-in identity and the two ways out of it live. */
const ACCOUNT_SECTION = `the Account section, at the foot of ${SETTINGS_TAB}'s front page`;
const SHORTCUTS_PAGE = `${SETTINGS_TAB}, on its Keyboard shortcuts page`;
const CONNECTIONS_PAGE = `${SETTINGS_TAB}, on its Connections page`;
/* Where the Updates and Usage data sections stand, for the facts about them. */
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
  settings: AppSettings;
  /** Where the build stands, for the guide's Updates entry. */
  update: UpdateSnapshot;
  /** Whether a Realtime credential can be minted at all. */
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  /**
   * The talk key labelled the way macOS writes it, absent when none was
   * registered. Labelled rather than drawn as keys: the guide is spoken and
   * read, and a chord said aloud is one thing to press.
   */
  hotkey: { hotkey?: string; held: boolean };
  /** The ask key labelled on the same terms, absent when none was registered. */
  askKey?: string;
  /**
   * The stop key labelled on the same terms, absent when none was registered
   * — another app owns Option-S, or another Luke key was moved onto it.
   */
  stopKey?: string;
}

function talkKeyFact(hotkey: LukeGuideInput["hotkey"]): AppGuideFact {
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
    detail: `${hotkey.hotkey}, from any app: ${use}. A different chord can be recorded, or the default restored, in ${SHORTCUTS_PAGE}.`,
  };
}

function askKeyFact(askKey: string | undefined): AppGuideFact {
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
      `same press puts it away. A different chord can be recorded, or the default restored, in ${SHORTCUTS_PAGE}.`,
  };
}

const MICROPHONE_DETAIL = {
  granted:
    "Granted. The microphone opens only when the talk key takes a turn, sends nothing after " +
    "the key comes up, and closes once the exchange settles. Typing to Luke never opens it. " +
    "Which device it opens is the Prefer the Mac's microphone setting's to say.",
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

function providersFact(settings: AppSettings): AppGuideFact {
  const roster = CLOUD_AGENT_PROVIDER_LIST.map(
    (provider) =>
      `${provider.displayName} (${connectionWord(settings.credentialSources[provider.id])})`,
  );
  return {
    label: "Cloud providers",
    detail:
      `${roster.join(", ")}. Connecting one takes the key its row names, typed by hand into ` +
      `${CONNECTIONS_PAGE}, under Providers — like every key, never spoken, and never ` +
      "repeated back; the row's Connect press opens the provider's own key page in the " +
      "browser. Local providers such as Claude Code need no key and are observed on their " +
      `own. Codex cloud tasks (${CODEX_CLOUD_CONNECTION_WORD[settings.codexCloudConnection]}) ` +
      "take no key in Luke at all: they are observed through the Codex CLI's own login, " +
      "reported by the Codex row on the same page — codex login in a terminal connects them, " +
      "and signing that CLI out stops them.",
  };
}

/**
 * One labeled fact per integration, so an ask about one draws that one alone.
 * An integration a build does not carry contributes no fact at all: a
 * capability the guide describes is one Luke will claim to have.
 */
function integrationFacts(settings: AppSettings): AppGuideFact[] {
  const facts: AppGuideFact[] = [];
  const linearProvider = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR];
  if (settings.linearSignInAvailable) {
    facts.push({
      label: "Linear",
      detail:
        `${linearProvider.displayName} ` +
        `(${connectionWord(settings.credentialSources[linearProvider.id])}) connects by signing ` +
        `in with Linear from its row in ${CONNECTIONS_PAGE}, under Integrations — Linear's own ` +
        `consent page opens in the browser, and no key is ever typed or spoken. Connecting it ` +
        `lets Luke read the developer's assigned issues and, only when asked in a turn the ` +
        `developer opened, move one to another state or comment on it. Disconnecting from the ` +
        `same row ends the access at Linear as well as here.`,
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
      "state, grouping agents from different providers under their workspace, " +
      "and every grouped chat opens at its exact terminal in Superset — " +
      "pressed, or asked of Luke — with no login needed. A worktree workspace with no agent " +
      "chat at all stands as its own idle row, titled by the workspace and opening in " +
      "Superset on press; the main checkout and workspaces " +
      "Superset already archived draw no row. When Superset's CLI is logged in, chat rows " +
      "can send the developer's own message, rename the workspace, or start another agent " +
      "in it, and a conversation ask can create a new Superset " +
      "workspace. Every Superset row offers Delete workspace once its " +
      "work settled — an agentless workspace row counts as settled — and Superset keeps no " +
      "archive: deleting is permanent and takes the whole workspace with every chat in it, " +
      "a row still working is never offered it, a single chat cannot be closed or removed " +
      "on its own, and an ask to archive one means exactly this delete. Superset's row sits " +
      "under Providers on the Connections page: connecting runs Superset's own sign-in in " +
      "the browser and takes its one-time code pasted into Luke — the CLI exchanges and " +
      "stores the login, and Luke never reads its token or clipboard — its pencil runs the " +
      "sign-in again to switch organizations, and disconnecting runs the CLI's own sign-out.",
  });
  facts.push({
    label: "Conductor",
    detail:
      "Conductor comes two ways. Conductor cloud connects with a key under Providers and " +
      "creates workspaces in the cloud projects that key lists. Conductor on this Mac needs " +
      "no key: it is recognized read-only from Conductor's own index, and a conversation ask " +
      "can create a new workspace in any repository Conductor holds locally — shown as " +
      "“Conductor (local)” in the create picker and its own block under Providers. A local " +
      "creation opens the new workspace in Conductor itself; an opening task is pre-filled " +
      "in its composer but not sent — Luke says the prompt is ready, and the developer " +
      "presses Return in Conductor to start it. " +
      "It carries no agent, model, or name choice — the repository's own default agent runs, " +
      "under the name Conductor gives it. Local Conductor chats stay read-only otherwise: " +
      "Luke cannot message, archive, or add an agent to one.",
  });
  return facts;
}

/**
 * The one key that is neither an agent's nor an integration's, described where
 * its row lives: at the top of the Voice page, beside the feature it turns on.
 */
function voiceKeyFact(settings: AppSettings, voiceAvailable: boolean): AppGuideFact {
  const openai = CREDENTIAL_PROVIDERS[VOICE_CREDENTIAL_PROVIDER_ID];
  const source = settings.credentialSources[openai.id];
  const hosted = voiceAvailable && source === CREDENTIAL_SOURCE.NONE;
  return {
    label: openai.displayName,
    detail:
      `${openai.displayName} (${connectionWord(source)}). ` +
      (hosted
        ? `Voice and session review run on the signed-in Luke account's daily allowance; a ` +
          `key of the developer's own runs them unmetered instead, billed by OpenAI. When a ` +
          `day's allowance is spent, watching continues unmetered and only voice pauses ` +
          `until the reset — the face beside the housing grays out, and a caption where ` +
          `replies land says when voice returns. `
        : source === CREDENTIAL_SOURCE.NONE
          ? `Signing in — or connecting a key — is what lets Luke speak and review sessions. `
          : `Voice and session review run on this key: no daily limit, nothing through Luke's ` +
            `service, and OpenAI bills you for what you use. `) +
      `The key is typed by hand into ${VOICE_SOURCE_SECTION} and never read from the ` +
      `environment.`,
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
 * download's progress is stripped before the row is read: the guide re-sends
 * its context whenever its text changes, and a percent tick is not news.
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
        "A macOS sidecar living beside the notch. The number beside the housing is the most " +
        "pressing count among the sessions the panel lists — how many need the developer, else " +
        "how many are working, else how many settled — wearing that state's colour. Hovering " +
        "peeks, pressing opens the panel, and Escape closes what is open.",
    },
    {
      label: "The panel",
      detail:
        "Two tabs, Sessions and Settings, switched by pressing one or by asking Luke to show " +
        "it. Asked while the panel is closed, the panel opens on that tab. Command-comma " +
        "switches to Settings while the panel has the keyboard.",
    },
    {
      label: "The sessions list",
      detail:
        "Lists every session that still matters: one working or waiting stays at any age, a " +
        "failure for three days, a finished or quiet one for two. The options button filters " +
        "by location (local, cloud), kind (voice chats), app (Conductor, ChatGPT, Cursor, " +
        "Orca, Superset, cmux), and agent; several chips can be chosen at once, choices on " +
        "one row widening each other and choices across rows narrowing. Cursor sits on both " +
        "rows: its app chip narrows to the chats the Cursor app can open, its agent chip to " +
        "every Cursor chat. An X on the options button clears every chosen chip at once, and " +
        "a spoken ask can narrow to the same values or back to all. The list is orderable by " +
        "urgency or recency by the same button or ask. " +
        "A row can be opened, messaged, or controlled where its provider allows, a session " +
        "whose provider reported a pull request grows a chip that opens it in the browser, " +
        "and a row the developer asked Luke to listen for wears a listening mark beside its " +
        "age. Luke's own composer at the foot takes a typed ask.",
    },
    {
      label: "Apps beside a session",
      detail:
        "The large mark leading a row names the coding agent; the small bare marks after its " +
        "title name apps where the same chat also appears — none replaces the agent or " +
        "changes local versus cloud. A Conductor cloud chat leads " +
        "with the agent running it, Claude Code or Codex, a small cloud badge saying where it " +
        "runs; Conductor's own letter mark stands in only when the agent went unreported, and " +
        "a Codex sub-agent spawned there keeps the Conductor association on its own row. Each " +
        "association is recognized read-only from that app's own records, and cmux records a " +
        "session only where its agent hooks are installed — Claude Code's automatically; " +
        "Codex, Cursor, Gemini CLI, and OpenCode after `cmux hooks setup` — so a session cmux " +
        "never recorded carries no cmux mark. A local Codex chat also names ChatGPT, which " +
        "documents the exact Codex thread address. A Cursor chat names Cursor itself when the " +
        "app can open it: a local chat in the app's own index, or any Cursor cloud agent. A " +
        "chat Cursor's agents CLI started in a plain terminal carries no Cursor app mark and " +
        "opens nowhere unless cmux, Superset, or Conductor hosts its terminal.",
    },
    {
      label: "Opening a chat in its apps",
      detail:
        "An app mark with an exact address is a button: ChatGPT opens that Codex thread, " +
        "Cursor opens the exact chat, Superset opens its bound terminal, " +
        "cmux opens the exact terminal pane the agent runs in — standing in as the row's " +
        "own destination when no other app gave it one — and a Conductor cloud chat's " +
        "Conductor mark opens that exact chat. The row body, or an ask in conversation, " +
        "opens the row's preferred address; an ask naming an app whose mark is a button " +
        "opens that app's exact address instead. A local Conductor chat or an Orca worktree " +
        "has no documented exact address or message endpoint, so its mark identifies the " +
        "association but adds no open or send control; a cmux chat takes no message or " +
        "control through cmux either — its mark only opens the pane.",
    },
    {
      label: "Searching sessions",
      detail:
        "The list is searchable by the magnifier beside the options button, Command-F while " +
        "the panel has the keyboard, or asking Luke to search out loud — a spoken search " +
        "fills the same field and reaches no further than the magnifier, which is only " +
        "offered beside a list of more than one session. It keeps rows saying every typed " +
        "word in their title, status word or status line, branch, repository, workspace, " +
        "agent, associated app, or model, and a search matching nothing offers the matches a " +
        "filter is hiding. A standing search survives the panel closing and the app " +
        "restarting until its query is cleared or its field closed — Escape does both. " +
        "Command-F answers for whichever tab is showing: the sessions list here, " +
        "the settings search on Settings.",
    },
    {
      label: "Workspaces in the list",
      detail:
        "Where chats nest in a workspace — Conductor's, cloud and local alike, and Superset's " +
        "and Orca's on this machine — each chat is its own row: a workspace holding several " +
        "draws them inside one tray named by the workspace, and one holding a single chat " +
        "stays one row titled by it. Every chat can be seen, opened, and messaged " +
        "individually where its latest roster entry offers that act. A tray's header carries " +
        "the managing app's mark, the workspace's acts, and the one pull-request chip its " +
        "chats share, each said once for the group.",
    },
    {
      label: "The Settings tab",
      detail:
        "A front page led by the What Luke runs on section: a two-way toggle naming the " +
        "signed-in Luke account (free, a daily amount) against the developer's own OpenAI key " +
        "(unmetered, billed by OpenAI). Choosing the key with none stored asks for one; " +
        "choosing the account parks a stored key without deleting it. Under the toggle: on " +
        "the account, meters for the day's talking, announcements, and session checks, and " +
        "when they reset; on the key, the " +
        "OpenAI row itself. Below are rows opening the Voice, Appearance, Keyboard shortcuts, " +
        "and Connections pages; the Feedback section, the Account section, and Quit stay on " +
        "the front page itself.",
    },
    {
      label: "Searching settings",
      detail:
        "The magnifier beside the tab bar — or Command-F — while Settings is showing searches " +
        "every settings page at once. It finds any row — a page itself, a setting by its name " +
        "or what it does, a provider, a shortcut, a way out — and pressing a match opens its " +
        "page at the row itself. The search is by hand alone: no spoken ask can search, and " +
        "no search survives the panel closing.",
    },
    {
      label: "What a settings page marks",
      detail:
        "A dot beside a row marks a value changed from its default, and a page holding one " +
        "offers a reset at its head — pressed by hand and never spoken — returning that " +
        "page's settings to their defaults. The Connections page has no group reset: its " +
        "defaults are changed row by row, and no reset touches a key, an account, or the " +
        "Conductor agent choice. An exclamation mark sits on whatever still needs a hand — " +
        "voice with nothing to run on, an ungranted microphone permission, or the keyboard " +
        "shortcuts while voice is off, whose chords stay shown and changeable but answer " +
        "nothing until voice is available.",
    },
    {
      label: "Account",
      detail:
        account.status === ACCOUNT_STATUS.SIGNED_IN
          ? `Signed in as ${account.email} through ${account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}. Sign out by hand from ${ACCOUNT_SECTION} — it asks before acting. The same section's Delete account row erases the account and everything Luke's service holds for it, cannot be undone, and is only ever done by hand — its button asks before acting, and no spoken ask can reach it.`
          : "Not signed in. The sign-in screen greets the launch once with Google and GitHub; while signed out the strip beside the housing keeps Luke's face and a small Sign in label, and hovering or pressing it brings the sign-in screen back. Live sessions and Luke's controls stay off until sign-in finishes; signing in finishes in the browser — cancellable — and the panel opens itself once it lands.",
    },
    {
      label: "Feedback and prompts",
      detail:
        "The Feedback section near the foot of the Settings tab opens a composer under the " +
        "notch: Send feedback for bugs and ideas, Submit a prompt for a prompt to a coding " +
        "agent. Either goes by email to the founders, with an optional name and email for " +
        "credit and up to three screenshots. A spoken ask can open the composer and start it " +
        "with the developer's own words — Luke offers exactly that, once, after refusing " +
        "something he cannot do — but a note already being written is never overwritten, and " +
        "sending is always the Send button's own press: no spoken ask can send one.",
    },
    {
      label: "Reading a session's transcript",
      detail:
        "Asked what a local session did, said, or is stuck on, Luke can read that session's " +
        "own recent transcript — Antigravity, Claude Code, Codex, Gemini CLI, Grok Build, " +
        "OpenCode, Radius, and the Devin and Cursor agents on this machine today — and answer " +
        "from it. Cursor and Radius keep tool outputs out of their transcripts, and " +
        "Antigravity's are stored where Luke does not read them, so those readings carry the " +
        "words and the calls but no results. The reading happens when asked and is kept " +
        "nowhere; a cloud session's conversation stays with its provider, and Luke answers " +
        "about it from roster fields alone.",
    },
    {
      label: "Messaging local Cursor chats",
      detail:
        "A local Cursor chat whose turn has settled can take the developer's own message, " +
        "typed on its row or asked of Luke: Luke runs Cursor's own agents CLI, resuming " +
        "exactly that chat in its own folder with the message as its one prompt, and the " +
        "reply lands in the transcript the row already reads. It is offered only with the " +
        "CLI installed and signed in, the chat's folder named by Cursor's own records, and " +
        "the turn not still running — and never for chats the Cursor app's own windows hold, " +
        "whose rows open the exact chat in the app instead. A Superset-managed Cursor chat " +
        "still messages through Superset's own terminal.",
    },
    {
      label: "Creating workspaces",
      detail:
        "Where a connected provider documents a creation endpoint — Conductor, Cursor, and " +
        "Superset today — an ask in conversation, spoken or typed, can create a new workspace " +
        "in one of the projects that provider reports, optionally under a name the developer " +
        "chose, with an opening task in the developer's own words where the project takes one. " +
        "A bare ask for a new agent lands here: only an ask that itself names the existing " +
        "workspace or session the agent should join adds one beside it instead. Only reported " +
        "projects can be named, a project that needs a task cannot be created without one, and " +
        "a provider that reports none takes no ask. Every Superset project carries the host " +
        "that runs it, and a new Superset " +
        "workspace needs that host, an agent Superset currently lists for it, and an opening " +
        "task, so a task-less ask for one is refused rather than created idle. A workspace " +
        "that lands opens on screen by itself once observation reports it with an address; " +
        "one whose provider reports no address stays on its row, unopened.",
    },
    {
      label: "Workspace creation defaults",
      detail:
        "An ask that names no provider goes to the default workspace provider, and one that " +
        "names no project to that provider's default project. The first workspace created " +
        "saves its provider as the default — changed or cleared by hand in the Settings tab — " +
        "and each provider remembers a default project, filled in by the first workspace " +
        "created there and changed or cleared by hand on that provider's own row on the " +
        "Connections page: under Providers for a provider connected by key and for Conductor " +
        "(local), under Superset for Superset. Superset also remembers a default agent for " +
        "creation asks that name none, chosen under Superset in Settings. Until one is " +
        "chosen, Luke asks whenever more than one provider, project, or agent could take " +
        "the ask. What a new Conductor agent runs — " +
        "its model, and its effort where the model's agent takes one — follows the choice on " +
        "the Conductor row under Providers, or Conductor's own defaults while none is made. A " +
        "model named in a creation ask rides that creation alone and is saved as the default " +
        "only while none is chosen; the settings change only when the developer asks, and " +
        "Luke never asks or suggests a model.",
    },
    {
      label: "Adding agents to a workspace",
      detail:
        "Where a session's provider documents it — Conductor today — the same kind of ask can " +
        "start another agent in an observed session's workspace, as one of the agent " +
        "kinds that session's roster entry lists, optionally named and optionally with an " +
        "opening task. The ask must name that workspace or session; a bare ask for a new " +
        "agent creates a new workspace instead. A model named in the ask — with an effort " +
        "where its agent takes one — rides that agent alone; unnamed, the Conductor row's " +
        "choice rides along only when it names the same agent kind. A session whose entry " +
        "lists no new agents takes no such ask.",
    },
    {
      label: "Renaming workspaces and chats",
      detail:
        "Where a provider documents it, an ask can rename what is observed, to a name in the " +
        "developer's own words: a Conductor or Superset-managed workspace, or a Conductor " +
        "chat on its own. An ask that names the workspace renames the workspace; one about " +
        "the chat renames the chat. Only sessions whose roster entry says the workspace can " +
        "be renamed — or the chat can — take one, and a session whose entry says neither " +
        "takes no such ask; the new name shows up on the next observation.",
    },
    {
      label: "Archiving",
      detail:
        "Where a provider documents an archive endpoint — a Conductor workspace, a Cursor " +
        "cloud agent, and a Devin cloud session today — Archive is offered once the work " +
        "there was positively seen to settle: pressed, or asked of Luke, it files the work " +
        "away through the provider's own endpoint. Archiving a Conductor workspace files " +
        "away every chat in it at once, so the control sits once on a group's header and " +
        "otherwise on the row. An archived Cursor agent " +
        "stays readable but takes no new runs; an archived Devin session can be viewed but " +
        "not resumed. A row mid-turn — or one whose state could not be read — offers no " +
        "archive, a session whose roster entry lists no archive control takes no such ask, " +
        "and local sessions — which Luke only reads — are never archived. A Superset-managed " +
        "workspace keeps no archive: an ask to archive one is taken as its Delete workspace " +
        "control, and Luke words the outcome as the delete it is — permanent, never filed " +
        "away.",
    },
    {
      label: "Standing asks about sessions",
      detail:
        "An ask can be kept standing for one observed session — told when it finishes, warned " +
        "if it fails, whatever the developer asked in their own words. Luke's background " +
        "review weighs that session's updates against the ask and speaks when one satisfies " +
        "it, opening a speak-only call if no conversation is up; the ask itself is " +
        "the consent. One ask stands per session, a new one replaces it, asking Luke to drop " +
        "it withdraws it, and an ask ends with the session it was about. A row with an ask " +
        "standing wears a small listening mark beside its age, and Luke can say what he is " +
        "already listening for. It needs voice to be available, changes nothing about the " +
        "session itself, and is never sent to a provider.",
    },
    talkKeyFact(input.hotkey),
    askKeyFact(input.askKey),
    { label: "Microphone access", detail: MICROPHONE_DETAIL[input.microphoneStatus] },
    ...(input.voiceAvailable
      ? [
          {
            label: "Stopping a reply",
            detail:
              (input.stopKey
                ? `${input.stopKey}, from any app, cuts the reply off and asks for nothing in ` +
                  "its place; Escape does the same while Luke's panel has the keyboard."
                : "Escape while Luke is speaking cuts the reply off and asks for nothing in " +
                  "its place. No system-wide stop key is registered right now — another app " +
                  "may own the shortcut.") +
              " The talk key over a reply interrupts too, but takes the turn with the same " +
              `press. A different stop chord can be recorded, or the ` +
              `default restored, in ${SHORTCUTS_PAGE}.`,
          },
          {
            // A behavior rather than a setting: stated here so Luke neither
            // denies announcing nor offers to turn it off.
            label: "Announcements",
            detail:
              "Luke says it out loud when an observed session is holding for you, stops on an " +
              "error, or finishes — a hold is a question, a permission, or an approval, not a " +
              "turn that merely ended — in his own words, naming the session and what it " +
              "needs, from the agent's parting words or the provider's error line. No " +
              "conversation needs to be open, the microphone stays off, and " +
              "it is always on while voice is available. A session the developer is speaking " +
              "with through its provider's own realtime voice — a Codex thread in a live " +
              "voice conversation, and any chat it delegated — announces nothing while the " +
              "conversation holds; the first change after it closes is announced as usual, " +
              "and nothing from inside it is replayed.",
          },
          {
            label: "Session and issue chips",
            detail:
              "While Luke says an announcement, a pressable notice names the session he is " +
              "talking about — under the housing, or at the open panel's foot: pressing it " +
              "opens the session where its provider keeps it, or the panel for a local " +
              "session with no page of its own. The same pressable chips appear while a " +
              "conversation reply names observed sessions by title, or a workspace of grouped chats by its " +
              "name — one chip per thing named, up to a dozen, a workspace's opening its most " +
              "recent chat — and a reply naming tracked issues, by identifier like LUKE-123 " +
              "or by whole title, draws their chips on the same band, each opening its issue " +
              "where the tracker keeps it. The chips leave when the reply ends.",
          },
          // Only a build that offers a calendar may describe the quiet: a hold
          // Luke claims without a calendar row to connect is a capability he
          // does not have.
          ...(input.settings.calendarSignInAvailable || input.settings.appleCalendarAvailable
            ? [
                {
                  label: "Quiet during meetings",
                  detail:
                    "With a calendar connected — a Google Calendar account, or this Mac's own " +
                    "Apple Calendar — and Quiet during meetings on, announcements decided " +
                    "during a meeting wait and are read out together once it ends. The quiet " +
                    "begins the moment a meeting starts — or the setting is switched on " +
                    "mid-meeting — and silences everything Luke would say unbidden, an " +
                    "announcement mid-sentence included, even on an open conversation; " +
                    "questions asked of him still get their replies. Luke's face sleeps " +
                    "beside the housing for as long as the quiet holds.",
                },
              ]
            : []),
          {
            label: "Muted output",
            detail:
              "While the Mac is muted or its volume is at zero, Luke's replies are captioned " +
              "on screen even with Captions off, the whole reply staying on screen, and a " +
              "hint under the words asks for volume. The hint's Got it button rests it for " +
              "that stretch of silence and any that begins within fifteen minutes; the " +
              "captions stay.",
          },
          {
            label: "How long a conversation lasts",
            detail:
              "A call opens on the first " +
              "press of the talk key or the first typed ask, stays open across as many turns " +
              "as the developer takes, and is put away after three minutes with nothing said " +
              "on it; the voice service also ends any call at an hour. Either way the next " +
              "press picks the conversation back up: a bounded history of the recent " +
              "exchange — what was asked, answered, announced, and done — is kept in memory, " +
              "never written to disk, and re-fed to the new call, so Luke remembers what was " +
              "just said. A call that ends underneath a conversation ends quietly.",
          },
          {
            label: "When a call fails",
            detail:
              "Why a call failed or ended is shown for a few seconds where the captions are " +
              "drawn — under the housing, or at the open panel's foot. Nothing about it " +
              "lives in Settings; trying again is the only fix.",
          },
        ]
      : [
          {
            label: "Voice",
            detail:
              "Off: nothing to run voice on, so no conversation can be opened. " +
              `Signing in turns it on with the included allowance; a key entered in ${VOICE_SOURCE_SECTION} also works.`,
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
      // A behavior rather than a setting, like the announcements: stated so
      // Luke neither denies checking nor offers a switch that does not exist.
      detail:
        `The Updates section on ${FRONT_PAGE} says which version this is and where the build ` +
        "stands. Its button checks the release manifest on the spot, and Luke also checks on " +
        "his own a few times a day — always on; the fetch is unauthenticated and nothing " +
        "about the developer or their sessions is sent. A newer release downloads itself " +
        "when a check finds one and installs when Luke next quits — the row offers Restart " +
        "to update. If a download or install fails, the " +
        "row says so and offers the fixed releases page in the browser instead. The button's " +
        "press can also be asked of Luke — check for updates, open the releases page, " +
        "restart to update — and only the one act the row currently offers runs. The " +
        "Changelog row under the version opens the changelog in the browser; that is a press " +
        "by hand, and no spoken ask reaches it.",
    },
    {
      label: "Usage data",
      // The behaviour rather than the switch: the setting entry describes the
      // switch, and a Luke who could describe only that would be one who could
      // not say what it governs.
      detail:
        "Luke counts how his own features are used — a launch, a provider connected, sessions " +
        "observed, a call opened, an announcement spoken — and sends those counts to Luke's own " +
        "service, tied to the signed-in account by name and email. Every event and value is " +
        "fixed by this build, so nothing about a session — no title, branch, path, recap, or " +
        "transcript — and nothing typed or spoken can travel in one. Nothing is sent while " +
        `signed out. The switch is Share usage data, in the Usage data section on ${FRONT_PAGE}; ` +
        "it is on to begin with, and turning it off stops it at once.",
    },
    {
      label: "Quitting",
      detail: `The Quit button at the foot of ${SETTINGS_TAB} or on the sign-in screen when it is shown.`,
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
): { selection: WorkspaceAgentSelection | undefined } | { refused: string } {
  if (settingId === APP_SETTING_ID.WORKSPACE_AGENT_MODEL) {
    if (value === CONDUCTOR_DEFAULT_CHOICE) {
      if (namedEffort !== undefined) {
        return { refused: "Conductor's own default takes no effort level." };
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
    if (!named) return { refused: "No documented Conductor model goes by that name." };
    if (namedEffort !== undefined) {
      // Composed against the table itself, not the guide the call was
      // validated against: this half answers to what an endpoint takes.
      if (!named.efforts.includes(namedEffort)) {
        return {
          refused:
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
      refused: "No model is chosen for new Conductor agents, so there is no effort to set.",
    };
  }
  if (value === CONDUCTOR_DEFAULT_CHOICE) {
    return { selection: { agent: current.agent, model: current.model } };
  }
  return { selection: { agent: current.agent, model: current.model, effort: value } };
}

/**
 * Carries one validated spoken settings change to the same bridge calls the
 * settings rows use, and reports what became of it in words Luke can say.
 * The store answers with the settings it actually holds either way, and
 * `onSettings` hands that snapshot back to the panel so the switch on screen
 * and the sentence out loud never disagree. The current settings ride along
 * so a model or effort change composes against the selection actually stored.
 */
export async function applySpokenSetting(
  bridge: Pick<AppBridge, "updateSetting" | "updateSettingEntry">,
  action: { setting: AppGuideSetting; value: string; effort?: string },
  onSettings: (settings: AppSettings) => void,
  current?: AppSettings,
): Promise<WireRecord> {
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
    if ("refused" in composed) return { status: "refused", reason: composed.refused };
    result = await bridge.updateSettingEntry(
      APP_SETTING_SCHEMA.workspaceAgentDefaults.field,
      PROVIDER_ID.CONDUCTOR,
      composed.selection,
    );
  } else {
    if (!isAppSettingId(action.setting.id)) {
      return { status: "refused", reason: "That setting cannot be changed from here." };
    }
    const field = settingFieldForGuideId(action.setting.id);
    if (!field) {
      return { status: "refused", reason: "That setting cannot be changed from here." };
    }
    const value = spokenSettingValue(field, action.value);
    if (value === undefined) {
      return { status: "refused", reason: "That setting cannot be changed from here." };
    }
    result = await bridge.updateSetting(field, value);
  }
  onSettings(result.settings);
  if (result.reason) return { status: "refused", reason: result.reason };
  return {
    status: "changed",
    setting: action.setting.label,
    value: action.value,
    ...(action.effort !== undefined ? { effort: action.effort } : undefined),
    ...(action.setting.id === APP_SETTING_ID.VOICE
      ? {
          note: "The new voice takes over as soon as this reply ends, and the conversation starts afresh in it.",
        }
      : action.setting.id === APP_SETTING_ID.VOICE_SPEED
        ? { note: "The new pace is heard from the next reply on." }
        : undefined),
  };
}
