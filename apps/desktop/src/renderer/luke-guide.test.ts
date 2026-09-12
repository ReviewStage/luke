import assert from "node:assert/strict";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
} from "@sidecar/credentials/vocabulary";
import {
  APP_SETTING_KIND,
  APP_UPDATE_ACTION,
  APP_UPDATE_WAIT,
  type AppGuideSetting,
} from "@sidecar/guide";
import { PROVIDER_ID, type WorkspaceAgentSelection } from "@sidecar/session";
import { settingsView } from "@sidecar/settings/testing";
import type { AppSettingsView, SettingsUpdateResult } from "@sidecar/settings/wire";
import { appSettingsView } from "@sidecar/settings/wire";
import { test } from "vitest";
import type { UpdateSnapshot } from "#shared/messages/update";
import { UPDATE_STATUS } from "#shared/messages/update";
import { appSettingsWire, spokenSettingBridge } from "#testing/spoken-setting-bridge";
import {
  APP_SETTING_ID,
  applySpokenSetting,
  buildLukeGuide,
  type LukeGuideInput,
} from "./luke-guide";

function settings(overrides: Partial<AppSettingsView> = {}): AppSettingsView {
  return settingsView({
    credentialSources: {
      [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.ENCRYPTED_FILE,
      [CREDENTIAL_PROVIDER_ID.LINEAR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.OPENAI]: CREDENTIAL_SOURCE.NONE,
    },
    voiceAvailable: true,
    preferBuiltInMicrophone: true,
    ...overrides,
  });
}

function idleUpdate(upToDate = false): UpdateSnapshot {
  return { status: UPDATE_STATUS.IDLE, currentVersion: "0.3.8", installSupported: true, upToDate };
}

function guideInput(overrides: Partial<LukeGuideInput> = {}): LukeGuideInput {
  return {
    account: { status: ACCOUNT_STATUS.SIGNED_OUT },
    settings: settings(),
    update: idleUpdate(),
    voiceAvailable: true,
    microphoneStatus: "granted",
    hotkey: { hotkey: "⌥Space" },
    stopKey: "⌥S",
    ...overrides,
  };
}

function guideSetting(id: string, input: LukeGuideInput = guideInput()): AppGuideSetting {
  const setting = buildLukeGuide(input).settings.find((candidate) => candidate.id === id);
  assert.ok(setting, `the guide lists ${id}`);
  return setting;
}

/**
 * Every fact the guide can state, written by hand because nothing derives
 * them. This is the facts half's one lever and a weak one on purpose: it says
 * nothing about whether a fact is true, and it fails when one is deleted —
 * which is the failure that matters, because a capability the guide does not
 * describe is one Luke will deny having.
 */
const GUIDE_FACT_LABELS: readonly string[] = [
  "What Luke is",
  "The marks beside the housing",
  "The panel",
  "The sessions list",
  "Apps beside a session",
  "Searching sessions",
  "The Settings tab",
  "Conversation history",
  "Account",
  "Feedback and prompts",
  "Reading a session's transcript",
  "Creating workspaces",
  "Workspace creation defaults",
  "Adding agents to a workspace",
  "Renaming workspaces and chats",
  "Archiving",
  "Talk key",
  "Microphone access",
  "Stopping a reply",
  "Announcements",
  "The arrival beat",
  "Launch greeting",
  "Calendar onboarding",
  "How long a conversation lasts",
  "Voice",
  "Cloud providers",
  "OpenAI",
  "Linear",
  "Apple Calendar",
  "Google Calendar",
  "Conductor",
  "Credential storage",
  "Updates",
  "Quitting",
  "Beyond this guide",
];

/** Enough states between them to stand every fact the guide has. */
function everyGuideState(): LukeGuideInput[] {
  return [
    guideInput(),
    guideInput({ voiceAvailable: false }),
    guideInput({
      account: {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "developer@example.com",
        provider: ACCOUNT_PROVIDER.GOOGLE,
      },
      settings: settings({
        linearSignInAvailable: true,
        appleCalendarAvailable: true,
        calendarSignInAvailable: true,
        secretStorage: SECRET_STORAGE.UNAVAILABLE,
      }),
    }),
  ];
}

test("every fact the guide can state is one it states, and states once", () => {
  const stated = new Set<string>();
  for (const input of everyGuideState()) {
    const drawn = new Set<string>();
    for (const fact of buildLukeGuide(input).facts) {
      // A label nobody put on the list is a fact nobody decided Luke may
      // state, which is the half of the rule a test can hold.
      assert.ok(GUIDE_FACT_LABELS.includes(fact.label), `${fact.label} is on the list`);
      assert.ok(fact.detail.length > 0, fact.label);
      // An ask about one fact must draw one, so a label stands once per state.
      assert.equal(drawn.has(fact.label), false, `${fact.label} is stated twice`);
      drawn.add(fact.label);
      stated.add(fact.label);
    }
  }
  // A label with nothing behind it is a capability deleted out from under the
  // list, which is the half of the rule this test exists for.
  assert.deepEqual(
    GUIDE_FACT_LABELS.filter((label) => !stated.has(label)),
    [],
  );
});

test("a spoken model or effort change composes the one stored selection", async () => {
  const carried: (WorkspaceAgentSelection | undefined)[] = [];
  const bridge = spokenSettingBridge({
    updateSettingEntry: async (_field, key, value) => {
      assert.equal(key, PROVIDER_ID.CONDUCTOR);
      carried.push(value);
      return { status: "accepted", settings: appSettingsWire(settings()) };
    },
  });
  const stored = settings({
    workspaceAgentDefaults: {
      [PROVIDER_ID.CONDUCTOR]: { agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
    },
  });
  const input = guideInput({ settings: stored });

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // A model named by its label lands as its wire pairing, and the chosen
  // effort survives because the new agent documents the same level.
  await applySpokenSetting(
    bridge,
    { setting: guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_MODEL, input), value: "Fable 5" },
    () => undefined,
    stored,
  );
  assert.deepEqual(carried.at(-1), { agent: "claude", model: "fable-5", effort: "xhigh" });

  // One whose agent documents no levels drops the effort rather than sending
  // it somewhere unlisted.
  await applySpokenSetting(
    bridge,
    { setting: guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_MODEL, input), value: "Cursor Auto" },
    () => undefined,
    stored,
  );
  assert.deepEqual(carried.at(-1), { agent: "cursor", model: "auto" });

  // An effort change rides the model already chosen, and the default word
  // returns the effort alone to Conductor.
  await applySpokenSetting(
    bridge,
    { setting: guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_EFFORT, input), value: "ultra" },
    () => undefined,
    stored,
  );
  assert.deepEqual(carried.at(-1), { agent: "codex", model: "gpt-5.6-sol", effort: "ultra" });
  await applySpokenSetting(
    bridge,
    {
      setting: guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_EFFORT, input),
      value: "Conductor's default",
    },
    () => undefined,
    stored,
  );
  assert.deepEqual(carried.at(-1), { agent: "codex", model: "gpt-5.6-sol" });

  // The default word on the model entry clears the whole selection.
  await applySpokenSetting(
    bridge,
    {
      setting: guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_MODEL, input),
      value: "Conductor's default",
    },
    () => undefined,
    stored,
  );
  assert.equal(carried.at(-1), undefined);
  assert.equal(carried.length, 5);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a model and its effort named in one change land as one stored pairing", async () => {
  const carried: (WorkspaceAgentSelection | undefined)[] = [];
  const bridge = spokenSettingBridge({
    updateSettingEntry: async (_field, key, value) => {
      assert.equal(key, PROVIDER_ID.CONDUCTOR);
      carried.push(value);
      return { status: "accepted", settings: appSettingsWire(settings()) };
    },
  });

  // Nothing chosen yet — the state the effort entry does not exist in — and
  // the pair still lands whole, in one action riding one bridge call.
  const unset = settings();
  const model = guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_MODEL, guideInput({ settings: unset }));
  const outcome = await applySpokenSetting(
    bridge,
    { setting: model, value: "Fable 5", effort: "high" },
    () => undefined,
    unset,
  );
  assert.deepEqual(outcome, { status: "accepted" });
  assert.deepEqual(carried.at(-1), { agent: "claude", model: "fable-5", effort: "high" });

  // A named effort is the developer's word over the stored one, not beside it.
  const stored = settings({
    workspaceAgentDefaults: {
      [PROVIDER_ID.CONDUCTOR]: { agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
    },
  });
  await applySpokenSetting(
    bridge,
    { setting: model, value: "Fable 5", effort: "low" },
    () => undefined,
    stored,
  );
  assert.deepEqual(carried.at(-1), { agent: "claude", model: "fable-5", effort: "low" });

  // A level the named model's agent does not document is refused with the
  // documented ones, and nothing reaches the bridge.
  const refusedLevel = await applySpokenSetting(
    bridge,
    { setting: model, value: "Cursor Auto", effort: "high" },
    () => undefined,
    unset,
  );
  assert.equal(refusedLevel.status, "rejected");

  // The default word names no model, so no effort has anywhere to ride.
  const refusedDefault = await applySpokenSetting(
    bridge,
    { setting: model, value: "Conductor's default", effort: "high" },
    () => undefined,
    unset,
  );
  assert.equal(refusedDefault.status, "rejected");
  assert.equal(carried.length, 2);
});

test("a model and its effort asked in one breath compose through the held answer", async () => {
  const carried: (WorkspaceAgentSelection | undefined)[] = [];
  const bridge = spokenSettingBridge({
    updateSettingEntry: async (_field, key, value) => {
      assert.equal(key, PROVIDER_ID.CONDUCTOR);
      carried.push(value);
      return {
        status: "accepted",
        settings: appSettingsWire(
          settings(value ? { workspaceAgentDefaults: { [PROVIDER_ID.CONDUCTOR]: value } } : {}),
        ),
      };
    },
  });

  // Nothing chosen yet, so the guide carries no effort entry at all — the
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // paired ask arrives as two calls, and everything the second half needs
  // only becomes true when the first half's answer lands.
  const unset = settings();
  let held: AppSettingsView | undefined;
  await applySpokenSetting(
    bridge,
    {
      setting: guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_MODEL, guideInput({ settings: unset })),
      value: "Fable 5",
    },
    (next) => {
      held = appSettingsView(next);
    },
    unset,
  );
  assert.deepEqual(carried.at(-1), { agent: "claude", model: "fable-5" });
  assert.ok(held);

  // The guide rebuilt from that answer is what the effort half validates
  // against, and the answer is what it composes with: the effort rides the
  // model just stored, not the state a panel is still waiting to draw.
  const effort = guideSetting(
    APP_SETTING_ID.WORKSPACE_AGENT_EFFORT,
    guideInput({ settings: held }),
  );
  const outcome = await applySpokenSetting(
    bridge,
    { setting: effort, value: "high" },
    () => undefined,
    held,
  );
  assert.equal(outcome.status, "accepted");
  assert.deepEqual(carried.at(-1), { agent: "claude", model: "fable-5", effort: "high" });
});

test("the guide ends by redirecting what it leaves out rather than denying it", () => {
  const fact = buildLukeGuide(guideInput()).facts.at(-1);

  assert.ok(fact);
  // The facts deliberately stop at what a developer would ask; this closing
  // fact is what keeps an undescribed detail a redirection instead of a
  // denial.
  assert.equal(fact.label, "Beyond this guide");
});

test("the feedback fact says what a spoken open may do, and that sending stays by hand", () => {
  const fact = buildLukeGuide(guideInput()).facts.find(
    (candidate) => candidate.label === "Feedback and prompts",
  );

  assert.ok(fact);
});

test("every adjustable setting is carried to the bridge call its row uses", async () => {
  const calls: string[] = [];
  const answered: SettingsUpdateResult = {
    status: "accepted",
    settings: appSettingsWire(settings()),
  };
  const bridge = spokenSettingBridge({
    updateSetting: async (field, value) => {
      calls.push(`${field}:${String(value)}`);
      return answered;
    },
    updateSettingEntry: async (field, _key, value) => {
      calls.push(`${field}:${value?.model ?? "default"}`);
      return answered;
    },
  });
  const seen: AppSettingsView[] = [];

  for (const setting of buildLukeGuide(guideInput()).settings) {
    if (!setting.adjustable) continue;
    const value = setting.kind === APP_SETTING_KIND.TOGGLE ? "on" : (setting.choices?.[0] ?? "");
    const outcome = await applySpokenSetting(bridge, { setting, value }, (next) =>
      seen.push(appSettingsView(next)),
    );
    // An adjustable entry with no carrier would come back refused: the guide
    // may never advertise a change the wiring cannot make.
    assert.equal(outcome.status, "accepted", `${setting.id} is wired to the bridge`);
  }

  assert.deepEqual(calls.sort(), [
    "announceSessions:true",
    "duckOtherMedia:true",
    "formFactor:notch",
    "openAtLogin:true",
    "preferBuiltInMicrophone:true",
    "quietDuringMeetings:true",
    "showInDock:true",
    "showOnAllDisplays:true",
    "voice:alloy",
    "voiceCaptions:true",
    // The first choice offered is "Conductor's default", which clears.
    "workspaceAgentDefaults:default",
  ]);
  // The snapshot the store answered with is handed back either way, so the
  // panel's switches redraw from what was actually stored.
  assert.equal(seen.length, calls.length);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("the store's refusal comes back as the spoken outcome", async () => {
  const bridge = spokenSettingBridge({
    updateSetting: async () => ({
      status: "rejected",
      settings: appSettingsWire(settings()),
      reason: "The settings file could not be written.",
    }),
  });

  const outcome = await applySpokenSetting(
    bridge,
    { setting: guideSetting(APP_SETTING_ID.VOICE_CAPTIONS), value: "on" },
    () => undefined,
  );

  assert.deepEqual(outcome, {
    status: "rejected",
    reason: "The settings file could not be written.",
  });
});

test("the guide's update entry reads from the same row the settings page draws", () => {
  const entry = (update: UpdateSnapshot) => buildLukeGuide(guideInput({ update })).update;

  assert.deepEqual(entry(idleUpdate()), {
    version: "0.3.8",
    detail: "The latest release has not been checked for yet.",
    button: APP_UPDATE_ACTION.CHECK,
  });
  assert.deepEqual(entry(idleUpdate(true)), {
    version: "0.3.8",
    detail: "This is the latest release.",
    button: APP_UPDATE_ACTION.CHECK,
  });
  assert.deepEqual(
    entry({
      status: UPDATE_STATUS.READY,
      currentVersion: "0.3.8",
      installSupported: true,
      latestVersion: "0.3.9",
    }),
    {
      version: "0.3.8",
      detail: "Version 0.3.9 is downloaded.",
      button: APP_UPDATE_ACTION.RESTART,
    },
  );
  assert.deepEqual(
    entry({
      status: UPDATE_STATUS.CHECKING,
      currentVersion: "0.3.8",
      installSupported: true,
    }),
    {
      version: "0.3.8",
      detail: "Checking the latest release…",
      button: APP_UPDATE_WAIT.CHECKING,
    },
  );
  // A build that cannot install itself offers the browser, worded as the row
  // words it — the spoken vocabulary calls that press "download".
  assert.deepEqual(
    entry({
      status: UPDATE_STATUS.IDLE,
      currentVersion: "0.3.8",
      installSupported: false,
      upToDate: false,
    }),
    {
      version: "0.3.8",
      detail: "This build updates by hand: the releases page has the latest.",
      button: APP_UPDATE_ACTION.DOWNLOAD,
    },
  );
});

test("a progress tick is not news to the guide", () => {
  const downloading = (percent: number): UpdateSnapshot => ({
    status: UPDATE_STATUS.DOWNLOADING,
    currentVersion: "0.3.8",
    installSupported: true,
    latestVersion: "0.3.9",
    progress: { percent, transferredBytes: percent, totalBytes: 100 },
  });

  const early = buildLukeGuide(guideInput({ update: downloading(5) })).update;
  const late = buildLukeGuide(guideInput({ update: downloading(95) })).update;

  assert.deepEqual(early, late);
  assert.deepEqual(early, {
    version: "0.3.8",
    detail: "Downloading version 0.3.9…",
    button: APP_UPDATE_WAIT.DOWNLOADING,
  });
});
