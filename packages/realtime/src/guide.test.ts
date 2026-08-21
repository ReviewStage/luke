import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_PANEL_TAB,
  APP_SETTING_KIND,
  APP_UPDATE_ACT,
  APP_UPDATE_WAIT,
  type AppGuideSnapshot,
  type AppUpdateButton,
  appGuideContextText,
  appToggleText,
  appToggleValue,
  EMPTY_APP_GUIDE,
  FEEDBACK_COMPOSER_KIND,
  SESSION_LIST_SORT,
} from "@sidecar/guide";
import {
  appGuideContextEvents,
  appToolAction,
  isAppToolCall,
  REALTIME_CLIENT_EVENT,
  type RealtimeFunctionCall,
  SESSION_LIST_VOICE,
} from "@sidecar/realtime";
import { normalizeSession, SESSION_LOCATION, SESSION_STATUS } from "@sidecar/session";
import { isRecord, text, type WireRecord } from "@sidecar/wire";
import { maximumFeedbackDraftLength } from "./realtime-protocol.js";
import { REALTIME_TOOL } from "./realtime-tools.js";

function conversationItem(event: WireRecord | undefined): WireRecord | undefined {
  if (!event) return undefined;
  const item = event.item;
  return isRecord(item) ? item : undefined;
}

function conversationItemText(event: WireRecord | undefined): string {
  const item = conversationItem(event);
  if (!item) return "";
  const content = item.content;
  if (!Array.isArray(content)) return "";
  const first = content[0];
  return isRecord(first) ? (text(first.text) ?? "") : "";
}

const GUIDE: AppGuideSnapshot = {
  facts: [
    { label: "What Luke is", detail: "A macOS sidecar living beside the notch." },
    { label: "Talk key", detail: "⌥Space, from any app." },
  ],
  settings: [
    {
      id: "voice_captions",
      label: "Captions",
      description: "Luke's words on screen while he speaks.",
      kind: APP_SETTING_KIND.TOGGLE,
      value: "off",
      defaultValue: "off",
      adjustable: true,
      manual: "the panel's Settings tab, on its Voice page",
    },
    {
      id: "voice",
      label: "Voice",
      description: "Which voice Luke speaks with.",
      kind: APP_SETTING_KIND.CHOICE,
      value: "marin",
      defaultValue: "cedar",
      choices: ["cedar", "marin"],
      adjustable: true,
      manual: "the panel's Settings tab, on its Voice page",
    },
    {
      id: "microphone",
      label: "Microphone access",
      description: "Whether the system allows Luke the microphone.",
      kind: APP_SETTING_KIND.TOGGLE,
      value: "on",
      adjustable: false,
      manual: "System Settings, under Privacy & Security",
    },
    {
      id: "agent_model",
      label: "New agents run",
      description: "Which model a new agent starts with.",
      kind: APP_SETTING_KIND.CHOICE,
      value: "Provider default",
      defaultValue: "Provider default",
      choices: ["Provider default", "Fable 5", "GPT", "Cursor Auto"],
      // Two choices share their levels and one takes none, mirroring the
      // shape the app's own table produces.
      efforts: { "Fable 5": ["low", "high", "max"], GPT: ["low", "high", "max"] },
      adjustable: true,
      manual: "the provider's own row",
    },
  ],
};

function call(name: string, argumentsJson: string): RealtimeFunctionCall {
  return { name, callId: "call-1", argumentsJson };
}

function observedConductorSession(realtimeVoice = false) {
  return normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "workspace-1",
      title: "Conductor: checkout-service",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_800_000_000_000,
      location: SESSION_LOCATION.CLOUD,
      ...(realtimeVoice ? { realtimeVoice: true } : undefined),
    },
  );
}

test("the guide's text carries app facts and compact setting data", () => {
  const text = appGuideContextText(GUIDE);

  assert.match(text, /What Luke is: A macOS sidecar/);
  assert.match(text, /Captions — Luke's words on screen while he speaks\./);
  assert.match(text, /value=off/);
  assert.match(text, /value=off; default=off/);
  assert.match(text, /value=marin; default=cedar/);
  // The id is printed where the value is, because it is what a spoken change
  // names the setting by — the same rule the session roster follows.
  assert.match(text, /setting_id=voice_captions/);
  assert.match(text, /choices=cedar, marin/);
  assert.match(text, /Microphone access[^\n]*value=on/);
  assert.match(text, /efforts=Fable 5:low\/high\/max, GPT:low\/high\/max/);
  // A choice that takes none is not listed taking any.
  assert.doesNotMatch(text, /Cursor Auto:/);
});

test("an empty guide says so rather than describing an app it was never told about", () => {
  assert.match(appGuideContextText(EMPTY_APP_GUIDE), /has not been provided/);
});

test("the guide travels as context and never opens Luke's mouth", () => {
  const events = appGuideContextEvents(GUIDE, "luke_ctx_app-guide_1");

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE);
  const item = conversationItem(events[0]);
  assert.equal(text(item?.role), "user");
  assert.match(conversationItemText(events[0]), /^\[app guide, sent automatically\]/);
  assert.equal(
    events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE),
    false,
  );
});

test("a spoken toggle accepts the unambiguous words and nothing else", () => {
  assert.equal(appToggleValue("on"), "on");
  assert.equal(appToggleValue(" Enabled "), "on");
  assert.equal(appToggleValue("true"), "on");
  assert.equal(appToggleValue("off"), "off");
  assert.equal(appToggleValue("no"), "off");
  assert.equal(appToggleValue("sideways"), undefined);
  assert.equal(appToggleValue(1), undefined);
  assert.equal(appToggleText(true), "on");
  assert.equal(appToggleText(false), "off");
});

test("only the app's own tools are routed to the guide", () => {
  assert.equal(isAppToolCall(call(REALTIME_TOOL.CHANGE_APP_SETTING, "{}")), true);
  assert.equal(isAppToolCall(call(REALTIME_TOOL.SHOW_PANEL, "{}")), true);
  assert.equal(isAppToolCall(call(REALTIME_TOOL.OPEN_FEEDBACK_COMPOSER, "{}")), true);
  assert.equal(isAppToolCall(call(REALTIME_TOOL.RUN_UPDATE_ACTION, "{}")), true);
  assert.equal(isAppToolCall(call(REALTIME_TOOL.SEND_SESSION_MESSAGE, "{}")), false);
});

test("a spoken change can name only a setting the guide lists, to a value it accepts", () => {
  const change = (argumentsJson: string) =>
    appToolAction(call(REALTIME_TOOL.CHANGE_APP_SETTING, argumentsJson), GUIDE, []);

  assert.deepEqual(change('{"setting_id":"voice_captions","value":"on"}'), {
    kind: "setting",
    setting: GUIDE.settings[0],
    value: "on",
  });
  // A choice is matched case-insensitively but answered in the guide's own case.
  assert.deepEqual(change('{"setting_id":"voice","value":"Marin"}'), {
    kind: "setting",
    setting: GUIDE.settings[1],
    value: "marin",
  });

  const unknown = change('{"setting_id":"telemetry","value":"on"}');
  assert.equal(unknown.kind, "refused");

  const unreadable = appToolAction(call(REALTIME_TOOL.CHANGE_APP_SETTING, "not json"), GUIDE, []);
  assert.equal(unreadable.kind, "refused");

  const badToggle = change('{"setting_id":"voice_captions","value":"sideways"}');
  assert.equal(badToggle.kind, "refused");
  if (badToggle.kind === "refused") {
    assert.match(badToggle.reason, /on or off/);
  }

  const badChoice = change('{"setting_id":"voice","value":"basso"}');
  assert.equal(badChoice.kind, "refused");
  if (badChoice.kind === "refused") {
    assert.match(badChoice.reason, /cedar, marin/);
  }
});

test("a value and its effort named in one change are validated as the pair they are", () => {
  const change = (argumentsJson: string) =>
    appToolAction(call(REALTIME_TOOL.CHANGE_APP_SETTING, argumentsJson), GUIDE, []);

  // The pair rides one action, the effort matched like the value: case
  // retold rather than copied, answered in the guide's own casing.
  assert.deepEqual(change('{"setting_id":"agent_model","value":"Fable 5","effort":"High"}'), {
    kind: "setting",
    setting: GUIDE.settings[3],
    value: "Fable 5",
    effort: "high",
  });

  // Unnamed, nothing rides: the action carries no effort at all.
  assert.deepEqual(change('{"setting_id":"agent_model","value":"Fable 5"}'), {
    kind: "setting",
    setting: GUIDE.settings[3],
    value: "Fable 5",
  });

  // A level the choice's own list does not carry is refused with that list.
  const wrongLevel = change('{"setting_id":"agent_model","value":"Fable 5","effort":"ultra"}');
  assert.equal(wrongLevel.kind, "refused");
  if (wrongLevel.kind === "refused") {
    assert.match(wrongLevel.reason, /low, high, max/);
  }

  // A choice the guide lists no levels for takes none.
  const levelless = change('{"setting_id":"agent_model","value":"Cursor Auto","effort":"high"}');
  assert.equal(levelless.kind, "refused");
  if (levelless.kind === "refused") {
    assert.match(levelless.reason, /Cursor Auto takes no effort level/);
  }

  // And a setting with no levels anywhere refuses by its own name.
  const toggled = change('{"setting_id":"voice_captions","value":"on","effort":"high"}');
  assert.equal(toggled.kind, "refused");
  if (toggled.kind === "refused") {
    assert.match(toggled.reason, /Captions takes no effort level/);
  }
});

test("a by-hand-only setting is refused with the path to it, so the refusal is the guidance", () => {
  const action = appToolAction(
    call(REALTIME_TOOL.CHANGE_APP_SETTING, '{"setting_id":"microphone","value":"on"}'),
    GUIDE,
    [],
  );

  assert.equal(action.kind, "refused");
  if (action.kind === "refused") {
    assert.match(action.reason, /System Settings, under Privacy & Security/);
  }
});

test("a spoken panel ask opens a real tab and narrows only to what is observed", () => {
  const sessions = [observedConductorSession()];
  const show = (argumentsJson: string) =>
    appToolAction(call(REALTIME_TOOL.SHOW_PANEL, argumentsJson), GUIDE, sessions);

  assert.deepEqual(show("{}"), { kind: "panel", tab: APP_PANEL_TAB.SESSIONS });
  assert.deepEqual(show('{"tab":"settings"}'), { kind: "panel", tab: APP_PANEL_TAB.SETTINGS });
  assert.deepEqual(show('{"filters":["all"]}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filters: ["all"],
  });
  assert.deepEqual(show('{"filters":["conductor"]}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filters: ["conductor"],
  });
  // A narrowing of one may arrive as a lone string, read as a list of one.
  assert.deepEqual(show('{"filters":"cloud"}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filters: ["cloud"],
  });

  assert.deepEqual(show('{"filters":["voice"]}'), {
    kind: "refused",
    reason: "No voice sessions are observed right now.",
  });

  assert.equal(show('{"tab":"about"}').kind, "refused");
  // A narrowing that would show nothing is refused rather than applied: the
  // panel would fall back to everything, and the sentence would be wrong.
  assert.equal(show('{"filters":["local"]}').kind, "refused");
  assert.equal(show('{"filters":["codex"]}').kind, "refused");

  const voiceShow = (argumentsJson: string) =>
    appToolAction(call(REALTIME_TOOL.SHOW_PANEL, argumentsJson), GUIDE, [
      observedConductorSession(true),
    ]);
  assert.deepEqual(voiceShow('{"filters":["voice"]}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filters: [SESSION_LIST_VOICE],
  });
});

test("a spoken panel ask can combine filters, on the axes the chips combine on", () => {
  const sessions = [observedConductorSession(), observedConductorSession(true)];
  const show = (argumentsJson: string) =>
    appToolAction(call(REALTIME_TOOL.SHOW_PANEL, argumentsJson), GUIDE, sessions);

  // Values on different axes narrow: a cloud Conductor voice chat is observed.
  assert.deepEqual(show('{"filters":["cloud","conductor","voice"]}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filters: ["cloud", "conductor", "voice"],
  });
  // A repeated value is one value, not a tighter ask.
  assert.deepEqual(show('{"filters":["cloud","cloud"]}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filters: ["cloud"],
  });

  // Each value answered by some session can still name an intersection
  // nothing occupies: every observed session is cloud, so local matches
  // nothing — and with a local session beside them, local Conductor exists
  // but no local voice chat does.
  assert.deepEqual(show('{"filters":["local","conductor"]}'), {
    kind: "refused",
    reason: "No local sessions are observed right now.",
  });
  const mixed = (argumentsJson: string) =>
    appToolAction(call(REALTIME_TOOL.SHOW_PANEL, argumentsJson), GUIDE, [
      ...sessions,
      normalizeSession(
        { id: "conductor", displayName: "Conductor" },
        {
          providerSessionId: "workspace-2",
          title: "Conductor: checkout-service",
          status: SESSION_STATUS.WORKING,
          observedAt: 1_800_000_000_000,
          location: SESSION_LOCATION.LOCAL,
        },
      ),
    ]);
  assert.deepEqual(mixed('{"filters":["local","conductor"]}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filters: ["local", "conductor"],
  });
  assert.deepEqual(mixed('{"filters":["local","voice"]}'), {
    kind: "refused",
    reason: "No observed session matches that combination of filters.",
  });

  // The whole list is not a value to narrow by.
  assert.deepEqual(show('{"filters":["all","cloud"]}'), {
    kind: "refused",
    reason: "all is the whole list, so it combines with nothing.",
  });
  // A narrowing has to be a list of words; anything else is unreadable.
  assert.equal(show('{"filters":[3]}').kind, "refused");
  assert.equal(show('{"filters":{"value":"cloud"}}').kind, "refused");
  // A list of nothing is no narrowing at all.
  assert.deepEqual(show('{"filters":[]}'), { kind: "panel", tab: APP_PANEL_TAB.SESSIONS });

  // The enum on the schema binds the model to real tokens — a developer's
  // phrase arriving untranslated is refused by the backstop, never guessed at.
  assert.deepEqual(show('{"filters":["Claude Code"]}'), {
    kind: "refused",
    reason: '"Claude Code" is not one of the filter values the tool lists.',
  });
});

test("a spoken panel ask can search, only where the list offers a search at all", () => {
  const pair = [
    observedConductorSession(),
    normalizeSession(
      { id: "codex", displayName: "Codex" },
      {
        providerSessionId: "local-1",
        title: "Rework the parser",
        status: SESSION_STATUS.WORKING,
        observedAt: 1_800_000_000_000,
      },
    ),
  ];
  const show = (argumentsJson: string, sessions = pair) =>
    appToolAction(call(REALTIME_TOOL.SHOW_PANEL, argumentsJson), GUIDE, sessions);

  assert.deepEqual(show('{"query":" parser build "}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    query: "parser build",
  });
  // A search rides the same ask as a narrowing and an ordering, and the words
  // are not judged here: a query matching nothing is the list's own honest
  // answer, where a filter showing nothing would be a stale choice.
  assert.deepEqual(show('{"filters":["conductor"],"sort":"recency","query":"zanzibar"}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filters: ["conductor"],
    sort: SESSION_LIST_SORT.RECENCY,
    query: "zanzibar",
  });
  // A blank query is no search, the way a blank draft is no draft.
  assert.deepEqual(show('{"query":"   "}'), { kind: "panel", tab: APP_PANEL_TAB.SESSIONS });

  // The magnifier is only offered beside a list with more than one session,
  // and a spoken search reaches no further than the hand's own control.
  assert.deepEqual(show('{"query":"parser"}', [observedConductorSession()]), {
    kind: "refused",
    reason: "The list offers a search only when more than one session is observed.",
  });
  assert.equal(show('{"query":"parser"}', []).kind, "refused");
});

test("a spoken panel ask can reorder the list in the panel's own two words", () => {
  const sessions = [observedConductorSession()];
  const show = (argumentsJson: string) =>
    appToolAction(call(REALTIME_TOOL.SHOW_PANEL, argumentsJson), GUIDE, sessions);

  assert.deepEqual(show('{"sort":"recency"}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    sort: SESSION_LIST_SORT.RECENCY,
  });
  assert.deepEqual(show('{"filters":["conductor"],"sort":"urgency"}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filters: ["conductor"],
    sort: SESSION_LIST_SORT.URGENCY,
  });
  assert.equal(show('{"sort":"alphabetical"}').kind, "refused");
});

test("a spoken composer open takes only the two kinds, drafting only the developer's words", () => {
  const open = (argumentsJson: string) =>
    appToolAction(call(REALTIME_TOOL.OPEN_FEEDBACK_COMPOSER, argumentsJson), GUIDE, []);

  assert.deepEqual(open('{"kind":"prompt","draft":"  let Luke restart a stuck run  "}'), {
    kind: "feedback",
    composer: FEEDBACK_COMPOSER_KIND.PROMPT,
    draft: "let Luke restart a stuck run",
  });
  // No draft is a valid open: the composer simply comes up empty.
  assert.deepEqual(open('{"kind":"feedback"}'), {
    kind: "feedback",
    composer: FEEDBACK_COMPOSER_KIND.FEEDBACK,
  });
  // A blank draft is no draft either.
  assert.deepEqual(open('{"kind":"prompt","draft":"   "}'), {
    kind: "feedback",
    composer: FEEDBACK_COMPOSER_KIND.PROMPT,
  });

  // The vocabulary is fixed: a kind outside it names no composer the app has.
  assert.equal(open('{"kind":"complaint"}').kind, "refused");
  assert.equal(open('{"kind":""}').kind, "refused");
  assert.equal(open("{}").kind, "refused");
  assert.equal(open("not json").kind, "refused");
});

test("a spoken draft is bounded like a typed ask", () => {
  const action = appToolAction(
    call(
      REALTIME_TOOL.OPEN_FEEDBACK_COMPOSER,
      `{"kind":"prompt","draft":"${"a".repeat(maximumFeedbackDraftLength + 100)}"}`,
    ),
    GUIDE,
    [],
  );

  assert.equal(action.kind, "feedback");
  if (action.kind === "feedback") {
    assert.ok(action.draft);
    assert.equal(action.draft.length, maximumFeedbackDraftLength);
  }
});

test("an app tool call the build does not know is refused", () => {
  const action = appToolAction(call("rename_the_app", "{}"), GUIDE, []);
  assert.equal(action.kind, "refused");
});

function guideWithUpdate(button: AppUpdateButton, detail: string): AppGuideSnapshot {
  return { ...GUIDE, update: { version: "0.3.8", detail, button } };
}

test("a spoken update ask runs only the act the row's button offers", () => {
  const ask = (argumentsJson: string, guide: AppGuideSnapshot) =>
    appToolAction(call(REALTIME_TOOL.RUN_UPDATE_ACTION, argumentsJson), guide, []);

  const offersCheck = guideWithUpdate(
    APP_UPDATE_ACT.CHECK,
    "The latest release has not been checked for yet.",
  );
  assert.deepEqual(ask('{"action":"check"}', offersCheck), {
    kind: "update",
    act: APP_UPDATE_ACT.CHECK,
  });
  // One button, one act: what the row is not drawing, no ask can press.
  const restartWhileCheckable = ask('{"action":"restart"}', offersCheck);
  assert.equal(restartWhileCheckable.kind, "refused");
  if (restartWhileCheckable.kind === "refused") {
    assert.match(restartWhileCheckable.reason, /not been checked for yet/);
    assert.match(restartWhileCheckable.reason, /offers a check/);
  }

  const offersRestart = guideWithUpdate(APP_UPDATE_ACT.RESTART, "Version 0.3.9 is downloaded.");
  assert.deepEqual(ask('{"action":"restart"}', offersRestart), {
    kind: "update",
    act: APP_UPDATE_ACT.RESTART,
  });

  const offersBrowser = guideWithUpdate(
    APP_UPDATE_ACT.DOWNLOAD,
    "This build updates by hand: the releases page has the latest.",
  );
  assert.deepEqual(ask('{"action":"download"}', offersBrowser), {
    kind: "update",
    act: APP_UPDATE_ACT.DOWNLOAD,
  });
  assert.equal(ask('{"action":"check"}', offersBrowser).kind, "refused");
});

test("a spoken update ask waits out a check or download already running", () => {
  const ask = (argumentsJson: string, guide: AppGuideSnapshot) =>
    appToolAction(call(REALTIME_TOOL.RUN_UPDATE_ACTION, argumentsJson), guide, []);

  const checking = ask(
    '{"action":"check"}',
    guideWithUpdate(APP_UPDATE_WAIT.CHECKING, "Checking the latest release…"),
  );
  assert.equal(checking.kind, "refused");
  if (checking.kind === "refused") assert.match(checking.reason, /while the check is out/);

  const downloading = ask(
    '{"action":"restart"}',
    guideWithUpdate(APP_UPDATE_WAIT.DOWNLOADING, "Downloading version 0.3.9…"),
  );
  assert.equal(downloading.kind, "refused");
  if (downloading.kind === "refused") assert.match(downloading.reason, /while the download runs/);
});

test("a spoken update ask outside the vocabulary, or with no row to press, is refused", () => {
  const offersCheck = guideWithUpdate(APP_UPDATE_ACT.CHECK, "This is the latest release.");

  assert.equal(
    appToolAction(call(REALTIME_TOOL.RUN_UPDATE_ACTION, '{"action":"install"}'), offersCheck, [])
      .kind,
    "refused",
  );
  assert.equal(
    appToolAction(call(REALTIME_TOOL.RUN_UPDATE_ACTION, "{}"), offersCheck, []).kind,
    "refused",
  );
  // A guide with no update entry — a run that reports nothing about updates —
  // advertises no act at all.
  const unreported = appToolAction(
    call(REALTIME_TOOL.RUN_UPDATE_ACTION, '{"action":"check"}'),
    GUIDE,
    [],
  );
  assert.equal(unreported.kind, "refused");
});

test("the guide's text names the update button beside the state it stands in", () => {
  const text = appGuideContextText(
    guideWithUpdate(APP_UPDATE_ACT.CHECK, "This is the latest release."),
  );

  assert.match(text, /Updates now: This is the latest release\./);
  assert.match(text, /version=0\.3\.8/);
  assert.match(text, /button=check/);
  // A guide never told about updates says nothing about them.
  assert.doesNotMatch(appGuideContextText(GUIDE), /Updates now:/);
});
