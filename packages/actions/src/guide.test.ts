import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  APP_PANEL_TAB,
  APP_SETTING_KIND,
  APP_UPDATE_ACTION,
  APP_UPDATE_WAIT,
  type AppGuideSnapshot,
  type AppUpdateButton,
  appToggleText,
  appToggleValue,
  FEEDBACK_COMPOSER_KIND,
  SESSION_LIST_SORT,
} from "@sidecar/guide";
import { RUN_ORIGIN } from "@sidecar/runtime/vocabulary";
import type { Session } from "@sidecar/session";
import {
  maximumSessionMessageLength,
  normalizeSession,
  SESSION_LOCATION,
  SESSION_STATUS,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Effect } from "effect";
import { ACTION_TOOL, SESSION_LIST_VOICE } from "./index.js";
import { withoutAdmission } from "./testing/admitted.js";
import { type ActionFunctionCall, admitToolCall } from "./testing/tool-call.js";

/** One app action admitted, as the payload alone: the brand and the origin are dropped. */
function appToolAction(
  functionCall: ActionFunctionCall,
  guide: AppGuideSnapshot,
  sessions: readonly Session[],
) {
  return Effect.map(
    admitToolCall(functionCall, {
      origin: RUN_ORIGIN.USER,
      roster: { read: () => Effect.succeed(sessions) },
      guide,
    }),
    withoutAdmission,
  );
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

function call(name: string, argumentsJson: string): ActionFunctionCall {
  return { name, argumentsJson };
}

function observedConductorSession(realtimeVoice = false) {
  return normalizeSession(
    { id: "conductor", displayName: "Conductor" },
    {
      providerSessionId: "workspace-1",
      title: "Conductor: checkout-service",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1_800_000_000_000,
      location: SESSION_LOCATION.CLOUD,
      ...(realtimeVoice ? { realtimeVoice: true } : undefined),
    },
  );
}

it("a spoken toggle accepts the unambiguous words and nothing else", () => {
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

it.effect("a spoken change can name only a setting the guide lists, to a value it accepts", () =>
  Effect.gen(function* () {
    const change = (argumentsJson: string) =>
      appToolAction(call(ACTION_TOOL.CHANGE_APP_SETTING, argumentsJson), GUIDE, []);

    assert.deepEqual(yield* change('{"setting_id":"voice_captions","value":"on"}'), {
      kind: "setting",
      setting: GUIDE.settings[0],
      value: "on",
    });
    // A choice is matched case-insensitively but answered in the guide's own case.
    assert.deepEqual(yield* change('{"setting_id":"voice","value":"Marin"}'), {
      kind: "setting",
      setting: GUIDE.settings[1],
      value: "marin",
    });

    const unknown = yield* change('{"setting_id":"telemetry","value":"on"}');
    assert.equal(unknown.status, ACTION_RESULT_STATUS.REJECTED);

    const unreadable = yield* appToolAction(
      call(ACTION_TOOL.CHANGE_APP_SETTING, "not json"),
      GUIDE,
      [],
    );
    assert.equal(unreadable.status, ACTION_RESULT_STATUS.REJECTED);

    const badToggle = yield* change('{"setting_id":"voice_captions","value":"sideways"}');
    assert.equal(badToggle.status, ACTION_RESULT_STATUS.REJECTED);

    const badChoice = yield* change('{"setting_id":"voice","value":"basso"}');
    assert.equal(badChoice.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect("a value and its effort named in one change are validated as the pair they are", () =>
  Effect.gen(function* () {
    const change = (argumentsJson: string) =>
      appToolAction(call(ACTION_TOOL.CHANGE_APP_SETTING, argumentsJson), GUIDE, []);

    // The pair rides one action, the effort matched like the value: case
    // retold rather than copied, answered in the guide's own casing.
    assert.deepEqual(
      yield* change('{"setting_id":"agent_model","value":"Fable 5","effort":"High"}'),
      {
        kind: "setting",
        setting: GUIDE.settings[3],
        value: "Fable 5",
        effort: "high",
      },
    );

    // Unnamed, nothing rides: the action carries no effort at all.
    assert.deepEqual(yield* change('{"setting_id":"agent_model","value":"Fable 5"}'), {
      kind: "setting",
      setting: GUIDE.settings[3],
      value: "Fable 5",
    });

    // A level the choice's own list does not carry is refused with that list.
    const wrongLevel = yield* change(
      '{"setting_id":"agent_model","value":"Fable 5","effort":"ultra"}',
    );
    assert.equal(wrongLevel.status, ACTION_RESULT_STATUS.REJECTED);

    // A choice the guide lists no levels for takes none.
    const levelless = yield* change(
      '{"setting_id":"agent_model","value":"Cursor Auto","effort":"high"}',
    );
    assert.equal(levelless.status, ACTION_RESULT_STATUS.REJECTED);

    // A setting with no levels anywhere has no effort to pair: a volunteered
    // one is dropped like an unknown key, and the change it rode in on lands.
    assert.deepEqual(
      yield* change('{"setting_id":"voice_captions","value":"on","effort":"high"}'),
      {
        kind: "setting",
        setting: GUIDE.settings[0],
        value: "on",
      },
    );
    assert.deepEqual(yield* change('{"setting_id":"voice","value":"Marin","effort":"low"}'), {
      kind: "setting",
      setting: GUIDE.settings[1],
      value: "marin",
    });
  }),
);

it.effect(
  "a by-hand-only setting is refused with the path to it, so the refusal is the guidance",
  () =>
    Effect.gen(function* () {
      const action = yield* appToolAction(
        call(ACTION_TOOL.CHANGE_APP_SETTING, '{"setting_id":"microphone","value":"on"}'),
        GUIDE,
        [],
      );

      assert.equal(action.status, ACTION_RESULT_STATUS.REJECTED);
    }),
);

it.effect("a spoken panel ask opens a real tab and narrows only to what is observed", () =>
  Effect.gen(function* () {
    const sessions = [observedConductorSession()];
    const show = (argumentsJson: string) =>
      appToolAction(call(ACTION_TOOL.SHOW_PANEL, argumentsJson), GUIDE, sessions);

    assert.deepEqual(yield* show("{}"), { kind: "panel", tab: APP_PANEL_TAB.SESSIONS });
    assert.deepEqual(yield* show('{"tab":"settings"}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SETTINGS,
    });
    assert.deepEqual(yield* show('{"filters":["all"]}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      filters: ["all"],
    });
    assert.deepEqual(yield* show('{"filters":["conductor"]}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      filters: ["conductor"],
    });
    // A narrowing of one may arrive as a lone string, read as a list of one.
    assert.deepEqual(yield* show('{"filters":"cloud"}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      filters: ["cloud"],
    });

    assert.deepEqual(yield* show('{"filters":["voice"]}'), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "No voice sessions are observed right now.",
    });

    assert.equal((yield* show('{"tab":"about"}')).status, ACTION_RESULT_STATUS.REJECTED);
    // A narrowing that would show nothing is refused rather than applied: the
    // panel would fall back to everything, and the sentence would be wrong.
    assert.equal((yield* show('{"filters":["local"]}')).status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal((yield* show('{"filters":["codex"]}')).status, ACTION_RESULT_STATUS.REJECTED);

    const voiceShow = (argumentsJson: string) =>
      appToolAction(call(ACTION_TOOL.SHOW_PANEL, argumentsJson), GUIDE, [
        observedConductorSession(true),
      ]);
    assert.deepEqual(yield* voiceShow('{"filters":["voice"]}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      filters: [SESSION_LIST_VOICE],
    });
  }),
);

it.effect("a spoken panel ask can combine filters, on the axes the chips combine on", () =>
  Effect.gen(function* () {
    const sessions = [observedConductorSession(), observedConductorSession(true)];
    const show = (argumentsJson: string) =>
      appToolAction(call(ACTION_TOOL.SHOW_PANEL, argumentsJson), GUIDE, sessions);

    // Values on different axes narrow: a cloud Conductor voice chat is observed.
    assert.deepEqual(yield* show('{"filters":["cloud","conductor","voice"]}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      filters: ["cloud", "conductor", "voice"],
    });
    // A repeated value is one value, not a tighter ask.
    assert.deepEqual(yield* show('{"filters":["cloud","cloud"]}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      filters: ["cloud"],
    });

    // Each value answered by some session can still name an intersection
    // nothing occupies: every observed session is cloud, so local matches
    // nothing — and with a local session beside them, local Conductor exists
    // but no local voice chat does.
    assert.deepEqual(yield* show('{"filters":["local","conductor"]}'), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "No local sessions are observed right now.",
    });
    const mixed = (argumentsJson: string) =>
      appToolAction(call(ACTION_TOOL.SHOW_PANEL, argumentsJson), GUIDE, [
        ...sessions,
        normalizeSession(
          { id: "conductor", displayName: "Conductor" },
          {
            providerSessionId: "workspace-2",
            title: "Conductor: checkout-service",
            status: SESSION_STATUS.WORKING,
            lastActivityAt: 1_800_000_000_000,
            location: SESSION_LOCATION.LOCAL,
          },
        ),
      ]);
    assert.deepEqual(yield* mixed('{"filters":["local","conductor"]}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      filters: ["local", "conductor"],
    });
    assert.deepEqual(yield* mixed('{"filters":["local","voice"]}'), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "No observed session matches that combination of filters.",
    });

    // The whole list is not a value to narrow by.
    assert.deepEqual(yield* show('{"filters":["all","cloud"]}'), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "all is the whole list, so it combines with nothing.",
    });
    // A narrowing has to be a list of words; anything else is unreadable.
    assert.equal((yield* show('{"filters":[3]}')).status, ACTION_RESULT_STATUS.REJECTED);
    assert.equal(
      (yield* show('{"filters":{"value":"cloud"}}')).status,
      ACTION_RESULT_STATUS.REJECTED,
    );
    // A list of nothing is no narrowing at all.
    assert.deepEqual(yield* show('{"filters":[]}'), { kind: "panel", tab: APP_PANEL_TAB.SESSIONS });

    // The enum on the schema binds the model to real tokens — a developer's
    // phrase arriving untranslated is refused by the backstop, never guessed at.
    assert.deepEqual(yield* show('{"filters":["Claude Code"]}'), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: '"Claude Code" is not one of the filter values the tool lists.',
    });
  }),
);

it.effect("a spoken panel ask can search, only where the list offers a search at all", () =>
  Effect.gen(function* () {
    const pair = [
      observedConductorSession(),
      normalizeSession(
        { id: "codex", displayName: "Codex" },
        {
          providerSessionId: "local-1",
          title: "Rework the parser",
          status: SESSION_STATUS.WORKING,
          lastActivityAt: 1_800_000_000_000,
        },
      ),
    ];
    const show = (argumentsJson: string, sessions = pair) =>
      appToolAction(call(ACTION_TOOL.SHOW_PANEL, argumentsJson), GUIDE, sessions);

    assert.deepEqual(yield* show('{"query":" parser build "}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      query: "parser build",
    });
    // A search rides the same ask as a narrowing and an ordering, and the words
    // are not judged here: a query matching nothing is the list's own honest
    // answer, where a filter showing nothing would be a stale choice.
    assert.deepEqual(yield* show('{"filters":["conductor"],"sort":"recency","query":"zanzibar"}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      filters: ["conductor"],
      sort: SESSION_LIST_SORT.RECENCY,
      query: "zanzibar",
    });
    // A blank query is no search, the way a blank draft is no draft.
    assert.deepEqual(yield* show('{"query":"   "}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
    });

    // The magnifier is only offered beside a list with more than one session,
    // and a spoken search reaches no further than the hand's own control.
    assert.deepEqual(yield* show('{"query":"parser"}', [observedConductorSession()]), {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: "The list offers a search only when more than one session is observed.",
    });
    assert.equal((yield* show('{"query":"parser"}', [])).status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect("a spoken panel ask can reorder the list in the panel's own two words", () =>
  Effect.gen(function* () {
    const sessions = [observedConductorSession()];
    const show = (argumentsJson: string) =>
      appToolAction(call(ACTION_TOOL.SHOW_PANEL, argumentsJson), GUIDE, sessions);

    assert.deepEqual(yield* show('{"sort":"recency"}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      sort: SESSION_LIST_SORT.RECENCY,
    });
    assert.deepEqual(yield* show('{"filters":["conductor"],"sort":"urgency"}'), {
      kind: "panel",
      tab: APP_PANEL_TAB.SESSIONS,
      filters: ["conductor"],
      sort: SESSION_LIST_SORT.URGENCY,
    });
    assert.equal((yield* show('{"sort":"alphabetical"}')).status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect(
  "a spoken composer open takes only the two kinds, drafting only the developer's words",
  () =>
    Effect.gen(function* () {
      const open = (argumentsJson: string) =>
        appToolAction(call(ACTION_TOOL.OPEN_FEEDBACK_COMPOSER, argumentsJson), GUIDE, []);

      assert.deepEqual(
        yield* open('{"kind":"prompt","draft":"  let Luke restart a stuck run  "}'),
        {
          kind: "feedback",
          composer: FEEDBACK_COMPOSER_KIND.PROMPT,
          draft: "let Luke restart a stuck run",
        },
      );
      // No draft is a valid open: the composer simply comes up empty.
      assert.deepEqual(yield* open('{"kind":"feedback"}'), {
        kind: "feedback",
        composer: FEEDBACK_COMPOSER_KIND.FEEDBACK,
      });
      // A blank draft is no draft either.
      assert.deepEqual(yield* open('{"kind":"prompt","draft":"   "}'), {
        kind: "feedback",
        composer: FEEDBACK_COMPOSER_KIND.PROMPT,
      });

      // The vocabulary is fixed: a kind outside it names no composer the app has.
      assert.equal((yield* open('{"kind":"complaint"}')).status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal((yield* open('{"kind":""}')).status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal((yield* open("{}")).status, ACTION_RESULT_STATUS.REJECTED);
      assert.equal((yield* open("not json")).status, ACTION_RESULT_STATUS.REJECTED);
    }),
);

it.effect("a spoken draft is bounded like a typed ask", () =>
  Effect.gen(function* () {
    const action = yield* appToolAction(
      call(
        ACTION_TOOL.OPEN_FEEDBACK_COMPOSER,
        `{"kind":"prompt","draft":"${"a".repeat(maximumSessionMessageLength + 100)}"}`,
      ),
      GUIDE,
      [],
    );

    assert.equal(action.kind, "feedback");
    if (action.kind === "feedback") {
      assert.ok(action.draft);
      assert.equal(action.draft.length, maximumSessionMessageLength);
    }
  }),
);

it.effect("an app tool call the build does not know is refused", () =>
  Effect.gen(function* () {
    const action = yield* appToolAction(call("rename_the_app", "{}"), GUIDE, []);
    assert.equal(action.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

function guideWithUpdate(button: AppUpdateButton, detail: string): AppGuideSnapshot {
  return { ...GUIDE, update: { version: "0.3.8", detail, button } };
}

it.effect("a spoken update ask runs only the action the row's button offers", () =>
  Effect.gen(function* () {
    const ask = (argumentsJson: string, guide: AppGuideSnapshot) =>
      appToolAction(call(ACTION_TOOL.RUN_UPDATE_ACTION, argumentsJson), guide, []);

    const offersCheck = guideWithUpdate(
      APP_UPDATE_ACTION.CHECK,
      "The latest release has not been checked for yet.",
    );
    assert.deepEqual(yield* ask('{"action":"check"}', offersCheck), {
      kind: "update",
      action: APP_UPDATE_ACTION.CHECK,
    });
    // One button, one action: what the row is not drawing, no ask can press.
    const restartWhileCheckable = yield* ask('{"action":"restart"}', offersCheck);
    assert.equal(restartWhileCheckable.status, ACTION_RESULT_STATUS.REJECTED);

    const offersRestart = guideWithUpdate(
      APP_UPDATE_ACTION.RESTART,
      "Version 0.3.9 is downloaded.",
    );
    assert.deepEqual(yield* ask('{"action":"restart"}', offersRestart), {
      kind: "update",
      action: APP_UPDATE_ACTION.RESTART,
    });

    const offersBrowser = guideWithUpdate(
      APP_UPDATE_ACTION.DOWNLOAD,
      "This build updates by hand: the releases page has the latest.",
    );
    assert.deepEqual(yield* ask('{"action":"download"}', offersBrowser), {
      kind: "update",
      action: APP_UPDATE_ACTION.DOWNLOAD,
    });
    assert.equal(
      (yield* ask('{"action":"check"}', offersBrowser)).status,
      ACTION_RESULT_STATUS.REJECTED,
    );
  }),
);

it.effect("a spoken update ask waits out a check or download already running", () =>
  Effect.gen(function* () {
    const ask = (argumentsJson: string, guide: AppGuideSnapshot) =>
      appToolAction(call(ACTION_TOOL.RUN_UPDATE_ACTION, argumentsJson), guide, []);

    const checking = yield* ask(
      '{"action":"check"}',
      guideWithUpdate(APP_UPDATE_WAIT.CHECKING, "Checking the latest release…"),
    );
    assert.equal(checking.status, ACTION_RESULT_STATUS.REJECTED);

    const downloading = yield* ask(
      '{"action":"restart"}',
      guideWithUpdate(APP_UPDATE_WAIT.DOWNLOADING, "Downloading version 0.3.9…"),
    );
    assert.equal(downloading.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);

it.effect("a spoken update ask outside the vocabulary, or with no row to press, is refused", () =>
  Effect.gen(function* () {
    const offersCheck = guideWithUpdate(APP_UPDATE_ACTION.CHECK, "This is the latest release.");

    assert.equal(
      (yield* appToolAction(
        call(ACTION_TOOL.RUN_UPDATE_ACTION, '{"action":"install"}'),
        offersCheck,
        [],
      )).status,
      ACTION_RESULT_STATUS.REJECTED,
    );
    assert.equal(
      (yield* appToolAction(call(ACTION_TOOL.RUN_UPDATE_ACTION, "{}"), offersCheck, [])).status,
      ACTION_RESULT_STATUS.REJECTED,
    );
    // A guide with no update entry — a run that reports nothing about updates —
    // advertises no action at all.
    const unreported = yield* appToolAction(
      call(ACTION_TOOL.RUN_UPDATE_ACTION, '{"action":"check"}'),
      GUIDE,
      [],
    );
    assert.equal(unreported.status, ACTION_RESULT_STATUS.REJECTED);
  }),
);
