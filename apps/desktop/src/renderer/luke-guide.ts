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
  type AppGuideFact,
  type AppGuideSetting,
  type AppGuideSnapshot,
  PROVIDER_ID,
  type WireRecord,
  type WorkspaceAgentSelection,
} from "@sidecar/core";
import type {
  AccountSnapshot,
  AppBridge,
  AppSettings,
  CredentialSource,
  MicrophoneStatus,
  SettingsUpdateResult,
} from "../shared/contracts";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  CLI_CONNECTION,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
} from "../shared/contracts";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDERS,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "../shared/credential-providers";
import {
  APP_SETTING_ID,
  APP_SETTING_SCHEMA,
  type AppSettingId,
  settingFieldForGuideId,
  settingGuideEntries,
  spokenSettingValue,
} from "../shared/settings-schema";
import { workspaceAgentModels } from "../shared/workspace-agents";

export type { AppSettingId } from "../shared/settings-schema";
/** The ids a spoken change names Luke's settings by. */
export { APP_SETTING_ID, isAppSettingId } from "../shared/settings-schema";

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
  /** Whether a Realtime credential can be minted at all. */
  voiceAvailable: boolean;
  microphoneStatus: MicrophoneStatus;
  /**
   * The talk key labelled the way macOS writes it, absent when none was
   // SAFETY: The preceding check establishes the asserted contract.
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
    "available — a signed-in account includes it, and an OpenAI key also provides it.",
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
      `${CONNECTIONS_PAGE}, under Providers — never spoken, and never repeated back. ` +
      // SAFETY: The preceding check establishes the asserted contract.
      "Local providers such as Claude Code need no key and are observed on their own. " +
      `Codex cloud tasks (${CODEX_CLOUD_CONNECTION_WORD[settings.codexCloudConnection]}) take ` +
      "no key in Luke at all: they are observed through the Codex CLI's own login, and the " +
      "Codex row on the same page reports that login's state. Running codex login once in a " +
      "terminal connects them, and signing that CLI out stops them.",
  };
}

function integrationsFact(settings: AppSettings): AppGuideFact {
  const linearProvider = CREDENTIAL_PROVIDERS[CREDENTIAL_PROVIDER_ID.LINEAR];
  const linear = !settings.linearSignInAvailable
    ? ""
    : `${linearProvider.displayName} ` +
      `(${connectionWord(settings.credentialSources[linearProvider.id])}) connects by signing ` +
      `in with Linear from its row in ${CONNECTIONS_PAGE}, under Integrations — Linear's own ` +
      `consent page opens in the browser, and no key is ever typed or spoken. Connecting it ` +
      `lets Luke read the developer's assigned issues and, only when asked in a turn the ` +
      `developer opened, move one to another state or comment on it. Disconnecting from the ` +
      // SAFETY: The preceding check establishes the asserted contract.
      `same row ends the access at Linear as well as here.`;
  const accounts = settings.calendarAccounts.length;
  const calendar = !settings.calendarSignInAvailable
    ? ""
    : accounts === 0
      ? " Google Calendar (not connected) connects by signing in with Google from its row. " +
        "Connecting it lets Luke read only when meetings start and end — never their titles " +
        "or who attends — so announcements can wait out a meeting."
      : ` Google Calendar (${accounts === 1 ? "1 account" : `${accounts} accounts`} connected) ` +
        "reads only when meetings start and end — never their titles or who attends. Which " +
        "calendars count is chosen with the checkboxes under each account, and more accounts " +
        "can be added from the same row.";
  const superset =
    " Superset workspaces on this Mac are recognized automatically from Superset's local " +
    "read-only host state, so agents from different providers group under the project and " +
    "workspace that owns them. When Superset's CLI is logged in, those rows can send the " +
    "developer's own message, offer Superset workspace controls, and create a new workspace " +
    "with an agent in a project and host Superset currently lists; connect from Luke's " +
    "Settings, finish Superset's own sign-in flow in the browser, and paste its one-time code " +
    "into Luke. Superset's CLI exchanges that code, stores the login, and switches organizations; " +
    "Luke never reads its token or clipboard. Superset's row sits under Providers on the " +
    "Connections page, and disconnecting from it runs the CLI's own sign-out, clearing the " +
    "login the CLI stored. The default agent for a creation ask that names " +
    "none is chosen under Superset in Settings; until one is chosen, Luke asks.";
  return {
    label: "Integrations",
    detail: `${linear}${calendar}${superset}`.trim(),
  };
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
        ? `Voice and session review run on the signed-in Luke account's daily allowance. A ` +
          `key of the developer's own runs them unmetered instead, billed by OpenAI. `
        : source === CREDENTIAL_SOURCE.NONE
          ? `Signing in — or connecting a key — is what lets Luke speak and review sessions. `
          : `Voice and session review run on this key: no daily limit, nothing through Luke's ` +
            `service, and OpenAI bills you for what you use. `) +
      `The key is typed by hand into ${VOICE_SOURCE_SECTION} — never read from the environment, ` +
      `never spoken, and never repeated back.`,
  };
}

/**
 * Builds the guide from what the app currently knows about itself. Pure and
 * synchronous so the renderer can rebuild it on every settings change and the
 // SAFETY: The preceding check establishes the asserted contract.
 * conversation always describes the app as it is, not as it launched.
 */
export function buildLukeGuide(input: LukeGuideInput): AppGuideSnapshot {
  const account = input.account ?? { status: ACCOUNT_STATUS.SIGNED_OUT };
  const facts: AppGuideFact[] = [
    {
      label: "What Luke is",
      detail:
        "A macOS sidecar living beside the notch. The number beside the housing is the most " +
        "pressing count among the sessions the panel lists: how many need the developer, else " +
        "how many are working, else how many settled. It wears that state's colour, and the " +
        "peek's caption names the state in words. Hovering peeks, pressing opens the panel, " +
        "and Escape closes what is open.",
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
        "failure for three days, a finished or quiet one for two. Narrowable to all, local, " +
        "cloud, voice chats, the sessions whose workspaces Superset manages, or one provider, " +
        "and orderable " +
        "by urgency or recency — by its options button, or by the same ask that shows the tab. " +
        "A row can be opened, messaged, or controlled " +
        "where its provider allows. A session whose provider reported a pull request grows a " +
        "chip that opens it in the browser. A row the developer asked Luke to listen for wears " +
        "a listening mark beside its age. Luke's own composer at the foot takes a typed ask.",
    },
    {
      label: "Searching sessions",
      detail:
        "The list is searchable by hand alone: the magnifier beside the options button, or " +
        "Command-F while the panel has the keyboard. It keeps rows saying every typed word in " +
        "their title, status line, branch, repository, workspace, agent, or model, and counts " +
        "what it left. A search matching nothing offers the matches a filter is hiding rather " +
        "than pretending there are none. Escape clears the query and then closes the field; " +
        "no spoken ask can search, and no search survives the panel closing. Command-F answers " +
        "for whichever tab is showing: the sessions list here, the settings search on Settings.",
    },
    {
      label: "Workspaces in the list",
      detail:
        "Where a provider nests chats in a workspace — Conductor today — each chat is its own " +
        "row. A workspace holding several draws them inside one tray named by the workspace; " +
        "one holding a single chat stays one row titled by the workspace. Every chat can be " +
        "seen, opened, and messaged individually.",
    },
    {
      label: "The Settings tab",
      detail:
        "A front page led by the What Luke runs on section: a two-way toggle naming the " +
        "signed-in Luke account (free, a daily amount) against the developer's own OpenAI key " +
        "(unmetered, billed by OpenAI), with the live one marked and the other pressable to " +
        "switch. Choosing the key with none stored asks for one; choosing the account parks a " +
        "stored key without deleting it. Under the toggle stands whichever half is live: on " +
        "the account, meters for the day's talking and announcements and checks on your " +
        "sessions, and when they reset; on the key, the OpenAI row itself. Below are rows " +
        "opening the Voice, Appearance, Keyboard shortcuts, and Connections pages, each led " +
        "back out by its back button or Escape. The Feedback section, the Account section, and " +
        "Quit stay on the front page itself.",
    },
    {
      label: "Searching settings",
      detail:
        "The magnifier beside the tab bar — or Command-F — while Settings is showing opens a " +
        "search field pinned at the head of whichever settings page is showing, and the search " +
        "always reads across every page. It finds any row — a page itself, a setting by its " +
        "name or what it does, a provider, a shortcut, a way out. Typing swaps the page for " +
        "the matches, grouped under the page that holds each; pressing a page opens it, and " +
        "pressing a row opens its page and takes the view to the row itself. Escape clears " +
        "the query, then closes the field, then leaves the page. The search is by hand alone: " +
        "no spoken ask can search, and no search survives the panel closing.",
    },
    {
      label: "What a settings page marks",
      detail:
        "A dot beside a row marks a value changed from its default, and a page holding one " +
        "ends its head with a reset, pressed by hand and never spoken, returning that page's " +
        "settings to their defaults. The Connections page carries no group reset: its defaults " +
        "are changed row by row. No reset touches a key, an account, or the Conductor agent choice. An " +
        "exclamation mark sits on whatever still needs a hand: the What Luke runs on heading " +
        "while voice has nothing to run on, the Voice and microphone rows while the permission " +
        "is ungranted, and the Keyboard shortcuts rows while voice is off, where each chord " +
        "stays shown and changeable but answers nothing until voice is available.",
    },
    {
      label: "Account",
      detail:
        account.status === ACCOUNT_STATUS.SIGNED_IN
          ? // SAFETY: The preceding check establishes the asserted contract.
            `Signed in as ${account.email} through ${account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}. Sign out by hand from ${ACCOUNT_SECTION} — it asks before acting. The same section's Delete account row erases the account and everything Luke's service holds for it, cannot be undone, and is only ever done by hand — its button asks before acting, and no spoken ask can reach it.`
          : "Not signed in. The sign-in screen greets the launch once with Google and GitHub, then closes like any panel. While signed out the strip beside the housing keeps Luke's face and a small Sign in label in place of the session count, and hovering or pressing it brings the sign-in screen back. Live sessions and Luke's controls stay off until sign-in finishes. Choosing a provider stands the panel down to a small waiting popup with a Cancel button while the browser finishes, and the panel opens itself once the sign-in lands.",
    },
    {
      label: "Feedback and prompts",
      detail:
        "The Feedback section near the foot of the Settings tab, just above Quit, opens a " +
        "composer under the notch. Send feedback is for bugs and ideas; Submit a prompt sends a " +
        "prompt to a coding agent. Either goes by email to the founders with an optional name " +
        "and email for credit, and up to three screenshots. A spoken ask can open the composer " +
        "and start it with the developer's own words — Luke offers exactly that, once, after " +
        "refusing something he cannot do — but a note already being written is never " +
        "overwritten, and sending is always the Send button's own press: no spoken ask can " +
        "send one.",
    },
    {
      label: "Reading a session's transcript",
      detail:
        "Asked what a local session did, said, or is stuck on, Luke can read that session's own " +
        "recent transcript — Claude Code, Codex, OpenCode, and the Devin and Cursor agents " +
        "running on this machine today — and answer from it. Cursor keeps tool outputs out of its own " +
        "transcripts, so those readings carry the words and the calls but no results. " +
        "The reading happens when asked and is kept nowhere; cloud sessions keep their " +
        "conversations with their provider, so Luke answers about those from their roster " +
        "fields alone.",
    },
    {
      label: "Creating workspaces",
      detail:
        "Where a connected provider documents a creation endpoint — Conductor, Cursor, and " +
        "Superset today — " +
        "an ask in conversation, spoken or typed, can create a new workspace in one of the " +
        "projects that provider reports, optionally under a name the developer chose, and can " +
        "hand the new agent an opening task in the developer's own words where the project takes " +
        "one. A bare ask for a new agent lands here: only an ask that itself names the existing " +
        "workspace or session the agent should join adds one beside it instead. Only reported " +
        "projects can be named, a project that needs a task cannot be created " +
        "without one, and a provider that reports none takes no ask. Superset asks for more than " +
        "the others: every Superset project carries the host that runs it — named for a remote " +
        "host, unannotated on this Mac — and a new " +
        "Superset workspace needs that host, an agent Superset currently lists for it, and an " +
        "opening task — so a task-less ask for one is refused rather than created idle. An ask that names no " +
        "provider goes to the default workspace provider; until one is chosen Luke asks when " +
        "more than one provider could take it, and the first workspace created saves its " +
        // SAFETY: The preceding check establishes the asserted contract.
        "provider as the default — changed or cleared by hand in the Settings tab. An ask that " +
        "names no project goes the same way: each provider remembers a default project, filled " +
        "in by the first workspace created there and changed or cleared by hand on the " +
        "Connections page, on that provider's own row — under Providers for a " +
        "provider connected by key, and under Superset for Superset; until one is chosen Luke " +
        "asks when the provider lists more than one project. What a new " +
        "Conductor agent runs — its model, and its effort where the model's agent takes one — " +
        "follows the choice on the Conductor row under Providers, or Conductor's own " +
        "defaults while none is made. A model named in a creation ask rides that creation alone " +
        // SAFETY: The preceding check establishes the asserted contract.
        "and is saved as the default only while none is chosen; the settings themselves change " +
        "only when the developer asks for that, and Luke never asks or suggests a model. A " +
        "workspace that lands opens on the developer's screen by itself: the moment observation " +
        "reports the new session with an address, that address is handed to the operating " +
        // SAFETY: The preceding check establishes the asserted contract.
        "system, the same as pressing the session's row. One whose provider reports no address " +
        "stays on its row, unopened.",
    },
    {
      label: "Adding agents to a workspace",
      detail:
        "Where a session's provider documents it — Conductor today — the same kind of ask can " +
        // SAFETY: The preceding check establishes the asserted contract.
        "start another agent in the workspace an observed session runs in, as one of the agent " +
        "kinds that session's roster entry lists, optionally named and optionally with an " +
        "opening task. The ask must name that workspace or session in its own words; a bare " +
        "ask for a new agent creates a new workspace instead. A model named in the ask — with an effort where its agent takes one — " +
        "rides that agent alone; unnamed, the Conductor row's choice rides along only when it " +
        "names the same agent kind. A session whose entry lists no new agents takes no such ask.",
    },
    {
      label: "Renaming workspaces and chats",
      detail:
        "Where a provider documents it, an ask in conversation, spoken or typed, can rename " +
        "what is observed, to a name in the developer's own words: a Conductor or " +
        "Superset-managed workspace, or a Conductor chat on its own. An ask that names the " +
        "workspace renames the workspace; one about the chat renames the chat. Only sessions " +
        "whose roster entry says the workspace can be renamed — or the chat can — take one; " +
        "the tray and the provider's own surface pick the new name up on the next observation. " +
        "A session whose entry says neither takes no such ask.",
    },
    {
      label: "Archiving",
      detail:
        "Where a provider documents an archive endpoint — a Conductor workspace, a Cursor " +
        // SAFETY: The preceding check establishes the asserted contract.
        "cloud agent, and a Devin cloud session today — Archive is offered as a control once the " +
        "work there was positively seen to settle: pressed, or asked of Luke in " +
        "conversation, it files the work away through the provider's own endpoint. Archiving a " +
        "Conductor workspace files away every chat in it at once, so when several of its chats " +
        "are drawn together the control sits once on the group's own header rather than on " +
        "each row; a lone chat, or any other provider's session, carries it on the row. An " +
        "archived Cursor agent " +
        "stays readable but takes no new runs; an archived Devin session can be viewed but not " +
        "resumed. A row mid-turn — or one whose state could not be read — offers no archive, a " +
        "session whose roster entry lists no archive control takes no such ask, and local " +
        "sessions — which Luke only reads — are never archived.",
    },
    {
      label: "Standing asks about sessions",
      detail:
        "An ask in conversation, spoken or typed, can be kept standing for one observed session " +
        "— told when it finishes, warned if it fails, whatever the developer asked in their own " +
        "words. Luke's background review weighs each of that session's updates against the ask " +
        "and speaks when one satisfies it, opening a speak-only call if no conversation is up; " +
        "the ask itself is the consent. One ask stands per session, a new one replaces it, asking Luke to drop " +
        "it withdraws it, and an ask ends with the session it was about. A row with an ask standing wears a " +
        "small listening mark beside its age, and the conversation roster carries each standing ask, so Luke " +
        "can say what he is already listening for. It needs voice to be available — the " +
        "signed-in account includes it, and a personal OpenAI key also provides it — " +
        "changes nothing about the session itself, and is never sent to a provider.",
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
              " The talk key over a reply interrupts too, but takes the turn: the microphone " +
              `opens with the same press. A different stop chord can be recorded, or the ` +
              `default restored, in ${SHORTCUTS_PAGE}.`,
          },
          {
            // A behavior rather than a setting: stated here so Luke neither
            // denies announcing nor offers to turn it off.
            label: "Announcements",
            detail:
              "Luke says it out loud when an observed session starts waiting on the developer, " +
              "stops on an error, or finishes — in his own words, naming the session and saying " +
              "what it needs, from the agent's parting words or the provider's error line when " +
              "one was reported. No conversation needs to be open, and the microphone stays " +
              "off. While he says it, a pressable notice names the session he is talking " +
              "about — under the housing, or at the open panel's foot: pressing it opens the " +
              "session where its provider keeps it, or opens the panel for a local session " +
              "with no page of its own. The same chips appear while a conversation reply " +
              "names observed sessions by title, or a workspace of grouped chats by its " +
              "name — asking what is being worked on draws one chip per thing named, up to " +
              "a dozen, a workspace's opening its most recent chat. A reply naming tracked " +
              "issues — by identifier like LUKE-123, or by whole title — draws their chips " +
              "on the same band, each opening its issue where the tracker keeps it. Past " +
              "three rows the chips scroll in place, and each presses the same way. The " +
              "chips and the captioned words leave when the reply ends, but never out from " +
              "under the pointer: resting on them holds them until it moves away. " +
              "Always on while voice is available; the panel and the capsule count show the " +
              "same states either way. A session the developer is speaking with through its " +
              "provider's own realtime voice — a Codex thread in a live voice conversation, " +
              "and any chat that conversation delegated — announces nothing while the " +
              "conversation holds, because its turn boundaries are already being heard " +
              "first-hand; the first change after the conversation closes is announced as " +
              "usual, and nothing from inside it is replayed." +
              // Only a build that offers the calendar may describe the quiet:
              // a hold Luke claims without a calendar row to connect is a
              // capability he does not have.
              (input.settings.calendarSignInAvailable
                ? " With a Google Calendar account connected and Quiet during meetings on, " +
                  "announcements decided during a meeting wait and are read out together once " +
                  "it ends. The quiet beginning — a meeting starting, or the setting switched " +
                  "on mid-meeting — silences Luke at once, an announcement mid-sentence " +
                  "included, and holds everything he would say unbidden, even on an open " +
                  "conversation; questions asked of him still get their replies. Luke's face " +
                  // SAFETY: The preceding check establishes the asserted contract.
                  "sleeps beside the housing for as long as the quiet holds, which is how the " +
                  "hold is seen."
                : ""),
          },
          {
            label: "Muted output",
            detail:
              "While the Mac is muted or its volume is at zero, Luke's replies are captioned on " +
              "screen even with Captions off, and a hint under the words asks for volume. The " +
              "whole reply stays on screen, the block growing to fit the words. " +
              "The hint's Got it button rests it for that stretch of silence and any that " +
              "begins within fifteen minutes; the captions stay.",
          },
          {
            label: "How long a conversation lasts",
            detail:
              // SAFETY: The preceding check establishes the asserted contract.
              "One conversation lasts as long as the call it is held on. The call opens on the " +
              // SAFETY: The preceding check establishes the asserted contract.
              "first press of the talk key or the first typed ask, stays open across as many " +
              // SAFETY: The preceding check establishes the asserted contract.
              "turns as the developer takes, and is put away after ten minutes with nothing said " +
              "on it — which releases the microphone rather than holding it all day. The voice " +
              "service also ends any call at an hour. Either way the next press opens a fresh " +
              "conversation, and Luke will not remember the last one: what he knows then is what " +
              "the panel observes, not what was said before. A call that ends underneath a " +
              "conversation says so rather than quietly forgetting. Nothing is written down " +
              "between conversations.",
          },
          {
            label: "When a call fails",
            detail:
              "Why a call failed or ended is shown for a few seconds where the captions are " +
              "drawn — under the housing, or at the open panel's foot — and then fades. " +
              "Nothing about it lives in Settings; trying again is the only fix to reach for.",
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
    integrationsFact(input.settings),
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
        `The Updates section on ${FRONT_PAGE} says which version this is and whether a newer ` +
        "release exists. Its button checks GitHub on the spot, and Luke also checks on his own " +
        "a few times a day — always on; nothing about the developer or their sessions is sent, " +
        "and only the release's version name is read back. While a newer release is waiting, " +
        "the Settings tab wears a dot, the section stands at the top of that page, and its " +
        "button becomes Download. A newer release is fetched by hand in the browser, from the " +
        "fixed releases page: Luke never changes the running build himself.",
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

  return { facts, settings };
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
    // SAFETY: The preceding check establishes the asserted contract.
    const field = settingFieldForGuideId(action.setting.id as AppSettingId);
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
          // SAFETY: The preceding check establishes the asserted contract.
          note: "The new voice takes over as soon as this reply ends, and the conversation starts afresh in it.",
        }
      : action.setting.id === APP_SETTING_ID.VOICE_SPEED
        ? { note: "The new pace is heard from the next reply on." }
        : undefined),
  };
}
