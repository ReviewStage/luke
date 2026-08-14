import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_PANEL_TAB,
  APP_SETTING_KIND,
  type AppGuideSnapshot,
  appGuideContextEvents,
  appGuideContextText,
  appToggleText,
  appToggleValue,
  appToolAction,
  EMPTY_APP_GUIDE,
  isAppToolCall,
  normalizeSession,
  REALTIME_CLIENT_EVENT,
  REALTIME_TOOL,
  type RealtimeFunctionCall,
  realtimeInstructions,
  SESSION_LIST_SORT,
  SESSION_LOCATION,
  SESSION_STATUS,
} from "../src";

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
      adjustable: true,
      manual: "the panel's Settings tab, under Preferences",
    },
    {
      id: "voice",
      label: "Voice",
      description: "Which voice Luke speaks with.",
      kind: APP_SETTING_KIND.CHOICE,
      value: "cedar",
      choices: ["cedar", "marin"],
      adjustable: true,
      manual: "the panel's Settings tab, under Preferences",
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
  ],
};

function call(name: string, argumentsJson: string): RealtimeFunctionCall {
  return { name, callId: "call-1", argumentsJson };
}

function observedConductorSession() {
  return normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "workspace-1",
      title: "Conductor: checkout-service",
      status: SESSION_STATUS.WORKING,
      observedAt: 1_800_000_000_000,
      location: SESSION_LOCATION.CLOUD,
    },
  );
}

test("the guide's text carries the facts and every setting's id, value, and by-hand path", () => {
  const text = appGuideContextText(GUIDE);

  assert.match(text, /What Luke is: A macOS sidecar/);
  assert.match(text, /Captions — Luke's words on screen while he speaks\./);
  assert.match(text, /currently off/);
  // The id is printed where the value is, because it is what a spoken change
  // names the setting by — the same rule the session roster follows.
  assert.match(text, /setting_id=voice_captions/);
  assert.match(text, /choices: cedar, marin/);
  // A setting a spoken ask cannot touch still says where the hand can.
  assert.match(text, /not changeable by voice/);
  assert.match(text, /System Settings, under Privacy & Security/);
});

test("an empty guide says so rather than describing an app it was never told about", () => {
  assert.match(appGuideContextText(EMPTY_APP_GUIDE), /has not been provided/);
});

test("the guide travels as context and never opens Luke's mouth", () => {
  const events = appGuideContextEvents(GUIDE);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, REALTIME_CLIENT_EVENT.CONVERSATION_ITEM_CREATE);
  const item = events[0]?.item as { role?: string; content?: { text?: string }[] };
  assert.equal(item.role, "user");
  assert.match(item.content?.[0]?.text ?? "", /^\[app guide, sent automatically\]/);
  assert.equal(
    events.some((event) => event.type === REALTIME_CLIENT_EVENT.RESPONSE_CREATE),
    false,
  );
});

test("the standing instructions promise the guide the context actually delivers", () => {
  const instructions = realtimeInstructions();
  assert.match(instructions, /\[app guide\]/);
  assert.match(instructions, /change_app_setting/);
  assert.match(instructions, /show_panel/);
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
  assert.match((badToggle as { reason: string }).reason, /on or off/);

  const badChoice = change('{"setting_id":"voice","value":"basso"}');
  assert.equal(badChoice.kind, "refused");
  assert.match((badChoice as { reason: string }).reason, /cedar, marin/);
});

test("a by-hand-only setting is refused with the path to it, so the refusal is the guidance", () => {
  const action = appToolAction(
    call(REALTIME_TOOL.CHANGE_APP_SETTING, '{"setting_id":"microphone","value":"on"}'),
    GUIDE,
    [],
  );

  assert.equal(action.kind, "refused");
  assert.match((action as { reason: string }).reason, /System Settings, under Privacy & Security/);
});

test("a spoken panel ask opens a real tab and narrows only to what is observed", () => {
  const sessions = [observedConductorSession()];
  const show = (argumentsJson: string) =>
    appToolAction(call(REALTIME_TOOL.SHOW_PANEL, argumentsJson), GUIDE, sessions);

  assert.deepEqual(show("{}"), { kind: "panel", tab: APP_PANEL_TAB.SESSIONS });
  assert.deepEqual(show('{"tab":"settings"}'), { kind: "panel", tab: APP_PANEL_TAB.SETTINGS });
  assert.deepEqual(show('{"filter":"all"}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filter: "all",
  });
  assert.deepEqual(show('{"filter":"conductor"}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filter: "conductor",
  });
  assert.deepEqual(show('{"filter":"cloud"}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filter: "cloud",
  });

  assert.equal(show('{"tab":"about"}').kind, "refused");
  // A narrowing that would show nothing is refused rather than applied: the
  // panel would fall back to everything, and the sentence would be wrong.
  assert.equal(show('{"filter":"local"}').kind, "refused");
  assert.equal(show('{"filter":"codex"}').kind, "refused");
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
  assert.deepEqual(show('{"filter":"conductor","sort":"urgency"}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filter: "conductor",
    sort: SESSION_LIST_SORT.URGENCY,
  });
  assert.equal(show('{"sort":"alphabetical"}').kind, "refused");
});

test("an app tool call the build does not know is refused", () => {
  const action = appToolAction(call("rename_the_app", "{}"), GUIDE, []);
  assert.equal(action.kind, "refused");
});
