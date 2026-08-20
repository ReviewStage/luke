import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_PANEL_TAB,
  APP_SETTING_KIND,
  type AppGuideSnapshot,
  appGuideContextEvents,
  appGuideContextText,
  appToggleText,
  appToolAction,
  EMPTY_APP_GUIDE,
  FEEDBACK_COMPOSER_KIND,
  isAppToolCall,
  normalizeSession,
  REALTIME_CLIENT_EVENT,
  type RealtimeFunctionCall,
  SESSION_LIST_SORT,
  SESSION_LIST_VOICE,
  SESSION_LOCATION,
  SESSION_STATUS,
} from "../src";
import { appToggleValue } from "../src/guide";
import { isRecord, text, type WireRecord } from "../src/json.js";
import { maximumFeedbackDraftLength, realtimeInstructions } from "../src/realtime-protocol";
import { REALTIME_TOOL } from "../src/realtime-tools";

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

test("the guide's text carries the facts and every setting's id, value, and by-hand path", () => {
  const text = appGuideContextText(GUIDE);

  assert.match(text, /What Luke is: A macOS sidecar/);
  assert.match(text, /Captions — Luke's words on screen while he speaks\./);
  assert.match(text, /currently off/);
  // The default is printed beside the value, because "back to the default" is
  // an ask the guide must be able to ground in a real value.
  assert.match(text, /currently off; default: off/);
  assert.match(text, /currently marin; default: cedar/);
  // The id is printed where the value is, because it is what a spoken change
  // names the setting by — the same rule the session roster follows.
  assert.match(text, /setting_id=voice_captions/);
  assert.match(text, /choices: cedar, marin/);
  // A setting a spoken ask cannot touch still says where the hand can.
  assert.match(text, /not changeable by voice/);
  assert.match(text, /System Settings, under Privacy & Security/);
  // A system permission has no default of the app's own, so its line honestly
  // carries none rather than inventing one.
  assert.match(text, /Microphone access[^\n]*currently on; not changeable/);
  // The levels each choice takes are printed with the choices, said once per
  // distinct list, so a value and its effort can be asked for in one breath.
  assert.match(
    text,
    /a change may name an effort with the value: Fable 5, GPT take low\/high\/max/,
  );
  // A choice that takes none is not listed taking any.
  assert.doesNotMatch(text, /Cursor Auto take/);
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

test("the standing instructions promise the guide the context actually delivers", () => {
  const instructions = realtimeInstructions();
  assert.match(instructions, /\[app guide\]/);
  assert.match(instructions, /change_app_setting/);
  // The guide carries each setting's default, and the instructions must
  // say what it is for: an ask for the default is a change to that value.
  assert.match(instructions, /its current value, its default/);
  assert.match(instructions, /a change to the default the guide lists/);
  assert.match(instructions, /show_panel/);
  // Switching an open panel between its tabs is the same ask, and the
  // instructions must say so or Luke will deny a capability he has.
  assert.match(instructions, /switches a panel already open/);
  assert.match(instructions, /open_feedback_composer/);
  assert.match(instructions, /create_workspace/);
  assert.match(instructions, /\[workspace projects\]/);
});

test("the instructions bound the refusal offer: once, on a clear yes, never a send", () => {
  const instructions = realtimeInstructions();
  // The offer follows an honest refusal and is made exactly once.
  assert.match(instructions, /refuse honestly in one sentence, then offer once/);
  assert.match(instructions, /Only on a clear yes/);
  assert.match(instructions, /do not repeat the offer/);
  // Opening and drafting are all the tool does; the send stays the developer's.
  assert.match(instructions, /never sends/);
  assert.match(instructions, /presses Send themselves/);
  assert.match(instructions, /never words they did not say/);
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

  assert.deepEqual(show('{"filter":"voice"}'), {
    kind: "refused",
    reason: "No voice sessions are observed right now.",
  });

  assert.equal(show('{"tab":"about"}').kind, "refused");
  // A narrowing that would show nothing is refused rather than applied: the
  // panel would fall back to everything, and the sentence would be wrong.
  assert.equal(show('{"filter":"local"}').kind, "refused");
  assert.equal(show('{"filter":"codex"}').kind, "refused");

  const voiceShow = (argumentsJson: string) =>
    appToolAction(call(REALTIME_TOOL.SHOW_PANEL, argumentsJson), GUIDE, [
      observedConductorSession(true),
    ]);
  assert.deepEqual(voiceShow('{"filter":"voice"}'), {
    kind: "panel",
    tab: APP_PANEL_TAB.SESSIONS,
    filter: SESSION_LIST_VOICE,
  });
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
