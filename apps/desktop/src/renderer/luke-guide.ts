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
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
} from "../shared/contracts";
import {
  CLOUD_AGENT_PROVIDER_LIST,
  CREDENTIAL_PROVIDERS,
  INTEGRATION_PROVIDER_LIST,
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
/* Where the Updates section stands, for the fact that describes it. */
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

const MICROPHONE_DETAIL: Record<MicrophoneStatus, string> = {
  granted:
    "Granted. The microphone opens only when the talk key takes a turn, sends nothing after " +
    "the key comes up, and closes once the exchange settles. Typing to Luke never opens it. " +
    "Which device it opens is the Prefer the Mac's microphone setting's to say.",
  denied:
    "Denied. It can only be granted back in System Settings, under Privacy & Security, Microphone.",
  restricted: "Restricted by a system policy, which only the system's manager can change.",
  "not-determined":
    "Not asked yet. The Permissions section on the Settings tab's Voice page can ask while voice is available — a signed-in account includes it, and an OpenAI key also provides it.",
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

function providersFact(settings: AppSettings): AppGuideFact {
  const roster = CLOUD_AGENT_PROVIDER_LIST.map(
    (provider) =>
      `${provider.displayName} (${connectionWord(settings.credentialSources[provider.id])})`,
  );
  return {
    label: "Cloud providers",
    detail:
      `${roster.join(", ")}. Connecting one takes the key its row names, typed by hand into ` +
      `${CONNECTIONS_PAGE}, under Cloud Agent API keys — never spoken, and never repeated back. ` +
      "Local providers such as Claude Code need no key and are observed on their own.",
  };
}

function integrationsFact(settings: AppSettings): AppGuideFact {
  const roster = INTEGRATION_PROVIDER_LIST.map(
    (provider) =>
      `${provider.displayName} (${connectionWord(settings.credentialSources[provider.id])})`,
  );
  // The calendar is an integration too, connected by sign-in rather than by a
  // key — and only a build carrying the sign-in offers it at all, so a build
  // without one says nothing rather than describing a row that is not drawn.
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
  return {
    label: "Integrations",
    detail:
      `${roster.join(", ")}. Connecting Linear lets Luke read the developer's issues and, only ` +
      `when asked in a turn the developer opened, move or comment on one. Its key is typed by ` +
      `hand into ${CONNECTIONS_PAGE}, under Integrations — never spoken, and never repeated ` +
      `back.${calendar}`,
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
        ? `Voice and session review run on the signed-in Luke account's daily allowance, free; ` +
          `connecting your own key removes the daily limit and runs them on it instead, billed ` +
          `by OpenAI. `
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
 * conversation always describes the app as it is, not as it launched.
 */
export function buildLukeGuide(input: LukeGuideInput): AppGuideSnapshot {
  const account = input.account ?? { status: ACCOUNT_STATUS.SIGNED_OUT };
  const facts: AppGuideFact[] = [
    {
      label: "What Luke is",
      detail:
        "A macOS sidecar living beside the notch. The capsule beside the housing counts the " +
        "sessions the panel lists — the ones still live or recently settled, not every " +
        "conversation on disk; hovering it peeks, pressing it opens the panel, and Escape " +
        "closes what is open. " +
        "Resting the pointer on the face itself earns one trick — most often flying off the strip " +
        "and swooping back — and another only after the pointer leaves and returns; asking the " +
        "system for reduced motion stills the tricks.",
    },
    {
      label: "The panel",
      detail:
        "Two tabs, switched by pressing one or by asking Luke — out loud or typed — to show it; " +
        "asked while the panel is closed, the panel opens on that tab. " +
        "Sessions lists every session that still matters — one that is working or waiting stays " +
        "at any age, a failure stays for three days, and a finished or quiet one for two — " +
        "with its state, narrowable to all, local, " +
        "cloud, or one provider, and orderable by urgency (what needs the developer first) or " +
        "recency (what moved last first) — by its options button, or by the same ask that shows " +
        "the tab. The list is searchable by hand alone: the magnifier beside the options " +
        "button, or Command-F while the panel has the keyboard, opens a field that keeps only " +
        "rows saying every typed word in their title, status line, branch, repository, " +
        "workspace, agent, or model, marks where the words landed, and counts what it left; a " +
        "search that matches nothing says so — offering the matches a filter is hiding rather " +
        "than pretending there are none — Escape clears the query and then closes the field, " +
        "no spoken ask can search, and no search survives the panel closing. " +
        "A row can be opened, messaged, or controlled where its " +
        "provider allows; a session whose provider reported a pull request grows a chip that " +
        "opens it in the browser, titled by the request's own number — #245 — or reading " +
        "Pull request when its address names none; and a row the developer asked Luke to listen for — " +
        "“tell me when this finishes” — wears a small listening mark beside its age, whose hover " +
        "says the ask in the developer's own words. Luke's own composer at the foot of the list " +
        "takes a typed ask — Enter sends it, Shift-Enter breaks the line, and the field grows " +
        "with what it holds. " +
        "Where a provider nests chats in a workspace — Conductor today — each " +
        "chat is its own row: a workspace holding several draws them inside one tray named by " +
        "the workspace at its top, one holding a single chat stays one row titled by the " +
        "workspace, and every chat can be seen, opened, and messaged individually. Settings " +
        "holds a front page led by the What Luke runs on section — a two-way toggle naming the " +
        "signed-in Luke account (free, a daily amount) against the developer's own OpenAI key " +
        "(unmetered, billed by OpenAI), with the live one marked and the other pressable to " +
        "switch: choosing the key with none stored asks for one, and choosing the account " +
        "parks a stored key without deleting it. Under the toggle stands whichever half is " +
        "live, and only that one: on the account, small meters filling with the day's talking " +
        "and announcements and checks on your sessions — blue until the last fifth of either " +
        "is left and amber from there on — when they reset, and a folded How this works " +
        "saying what spends each; on the key, the OpenAI row itself, typed by hand and never " +
        "read from the environment, and a folded How your key is used saying it pays for " +
        "those same two things, straight from the Mac to OpenAI with no daily limit " +
        "— then rows that open its Voice, Appearance, Keyboard " +
        "shortcuts, and Connections pages — each led back out by its back button or Escape — " +
        "and keeps the Feedback section, the Account section, and Quit on the front page " +
        "itself, the account last because signing out and deleting are done once or never; the Voice page " +
        "holds the microphone permission and then the voice settings once voice is available, " +
        "and only a pointer back to What Luke runs on while it is not — and a small " +
        "exclamation mark sits on whatever still needs a hand: the What Luke runs on heading " +
        "while voice has nothing to run on, the front page's Voice row and the microphone row " +
        "while the permission is ungranted, and the Keyboard shortcuts rows while voice is off, " +
        "where each key's chord stays shown and changeable but answers nothing until voice is " +
        "available; the " +
        "Command-comma switches to it while " +
        "the panel has the keyboard. A dot beside a settings row marks a value changed from " +
        "its default, and a page holding one ends its head with a reset, pressed by hand and " +
        "never spoken, that returns that page's settings to their defaults in one act — the " +
        "Workspaces group on the Connections page carries its own reset on its heading, and " +
        "no reset touches a key, an account, or the Conductor agent choice, whose own menu " +
        "already offers Conductor's default. A " +
        "change Luke makes himself is shown as it is made: the panel comes forward on the tab, " +
        "and the page, the change belongs to, and his face leaves the strip beside the housing, " +
        "dives to the control that moved, and floats back.",
    },
    {
      label: "Account",
      detail:
        account.status === ACCOUNT_STATUS.SIGNED_IN
          ? `Signed in as ${account.email} through ${account.provider === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google"}. Sign out by hand from ${ACCOUNT_SECTION} — it asks before acting. The same section's Delete account row erases the account and everything Luke's service holds for it, cannot be undone, and is only ever done by hand — its button asks before acting, and no spoken ask can reach it.`
          : "Not signed in. The sign-in screen greets the launch once with Google and GitHub, then closes like any panel. While signed out the strip beside the housing keeps Luke's face and a small Sign in label in place of the session count, and hovering or pressing it brings the sign-in screen back. Live sessions and Luke's controls stay off until sign-in finishes. Choosing a provider stands the panel down to a small waiting popup with a Cancel button while the browser finishes, and the panel opens itself once the sign-in lands.",
    },
    {
      label: "Feedback and prompts",
      detail:
        "The Feedback section near the foot of the Settings tab, just above Quit, opens a composer under the notch. " +
        "Send feedback is for bugs and ideas; Submit a prompt sends a prompt to a coding agent, and one the founders " +
        "like ships in the next release. Either goes by email to the founders with an optional " +
        "name and email for credit — a fresh note starts them from the signed-in account, and " +
        "both stay free to edit or clear before sending — and up to three screenshots. A spoken ask can open the " +
        "composer and start it with the developer's own words — Luke offers exactly that, once, " +
        "after refusing something he cannot do — but a note already being written is never " +
        "overwritten, and sending is always the Send button's own press, by hand: no spoken ask " +
        "can send one. A landed send is answered in the composer's own shape before the panel " +
        "returns: Luke swoops down beside “Sent — thank you!” and plays a little flourish, a " +
        "different one each send.",
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
        "Where a connected provider documents a creation endpoint — Conductor and Cursor today — " +
        "an ask in conversation, spoken or typed, can create a new workspace in one of the " +
        "projects that provider reports, optionally under a name the developer chose, and can " +
        "hand the new agent an opening task in the developer's own words where the project takes " +
        "one. A bare ask for a new agent lands here: only an ask that itself names the existing " +
        "workspace or session the agent should join adds one beside it instead. Only reported " +
        "projects can be named, a project that needs a task cannot be created " +
        "without one, and a provider that reports none takes no ask. An ask that names no " +
        "provider goes to the default workspace provider; until one is chosen Luke asks when " +
        "more than one provider could take it, and the first workspace created saves its " +
        "provider as the default — changed or cleared by hand in the Settings tab. An ask that " +
        "names no project goes the same way: each provider remembers a default project, filled " +
        "in by the first workspace created there and changed or cleared by hand on the " +
        "Connections page, under Workspaces; until one is chosen Luke asks when the provider " +
        "lists more than one project. What a new " +
        "Conductor agent runs — its model, and its effort where the model's agent takes one — " +
        "follows the choice on the Conductor row under Cloud Agent API keys, or Conductor's own " +
        "defaults while none is made. A model named in a creation ask rides that creation alone " +
        "and is saved as the default only while none is chosen; the settings themselves change " +
        "only when the developer asks for that, and Luke never asks or suggests a model. A " +
        "workspace that lands opens on the developer's screen by itself: the moment observation " +
        "reports the new session with an address, that address is handed to the operating " +
        "system, the same as pressing the session's row. One whose provider reports no address " +
        "stays on its row, unopened.",
    },
    {
      label: "Adding agents to a workspace",
      detail:
        "Where a session's provider documents it — Conductor today — the same kind of ask can " +
        "start another agent in the workspace an observed session runs in, as one of the agent " +
        "kinds that session's roster entry lists, optionally named and optionally with an " +
        "opening task. The ask must name that workspace or session in its own words; a bare " +
        "ask for a new agent creates a new workspace instead. A model named in the ask — with an effort where its agent takes one — " +
        "rides that agent alone; unnamed, the Conductor row's choice rides along only when it " +
        "names the same agent kind. A session whose entry lists no new agents takes no such ask.",
    },
    {
      label: "Archiving",
      detail:
        "Where a provider documents an archive endpoint — a Conductor workspace, a Cursor " +
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
              "same states either way." +
              // Only a build that offers the calendar may describe the quiet:
              // a hold Luke claims without a calendar row to connect is a
              // capability he does not have.
              (input.settings.calendarSignInAvailable
                ? " With a Google Calendar account connected and Quiet during meetings on, " +
                  "announcements decided during a meeting wait and are read out together once " +
                  "it ends — and Luke's face sleeps beside the housing for as long as the " +
                  "quiet holds, which is how the hold is seen."
                : ""),
          },
          {
            label: "Muted output",
            detail:
              "While the Mac is muted or its volume is at zero, Luke's replies are captioned on " +
              "screen even with Captions off, and a hint under the words asks for volume. A " +
              "reply longer than the caption block scrolls at reading pace, oldest line first. " +
              "The hint's Got it button rests it for that stretch of silence and any that " +
              "begins within fifteen minutes; the captions stay.",
          },
          {
            label: "How long a conversation lasts",
            detail:
              "One conversation lasts as long as the call it is held on. The call opens on the " +
              "first press of the talk key or the first typed ask, stays open across as many " +
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
        "and only the release's version name is read back. A newer release is fetched by hand " +
        "in the browser, from the fixed releases page: Luke never changes the running build " +
        "himself.",
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
      selection: { agent: named.agent, model: named.model, ...(effort ? { effort } : {}) },
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
): Promise<Record<string, unknown>> {
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
    ...(action.effort !== undefined ? { effort: action.effort } : {}),
    ...(action.setting.id === APP_SETTING_ID.VOICE
      ? {
          note: "The new voice takes over as soon as this reply ends, and the conversation starts afresh in it.",
        }
      : action.setting.id === APP_SETTING_ID.VOICE_SPEED
        ? { note: "The new pace is heard from the next reply on." }
        : {}),
  };
}
