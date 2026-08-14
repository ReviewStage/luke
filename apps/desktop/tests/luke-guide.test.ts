import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_SETTING_KIND,
  type AppGuideSetting,
  PANEL_FORM_FACTOR,
  REALTIME_VOICE,
  REALTIME_VOICE_LIST,
  REALTIME_VOICE_SPEED,
} from "@sidecar/core";
import {
  APP_SETTING_ID,
  applySpokenSetting,
  buildLukeGuide,
  type LukeGuideInput,
} from "../src/renderer/luke-guide";
import type { AppSettings, SettingsUpdateResult } from "../src/shared/contracts";
import { CREDENTIAL_SOURCE, SECRET_STORAGE } from "../src/shared/contracts";
import { CREDENTIAL_PROVIDER_ID } from "../src/shared/credential-providers";

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    credentialSources: {
      [CREDENTIAL_PROVIDER_ID.CONDUCTOR]: CREDENTIAL_SOURCE.ENCRYPTED_FILE,
      [CREDENTIAL_PROVIDER_ID.COPILOT]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.CURSOR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.DEVIN]: CREDENTIAL_SOURCE.ENVIRONMENT,
      [CREDENTIAL_PROVIDER_ID.JULES]: CREDENTIAL_SOURCE.NONE,
    },
    secretStorage: SECRET_STORAGE.UNKNOWN,
    showInMenuBar: true,
    showInDock: false,
    voice: REALTIME_VOICE.CEDAR,
    voiceSpeed: REALTIME_VOICE_SPEED.NORMAL,
    voiceCaptions: false,
    showOnAllDisplays: false,
    formFactor: PANEL_FORM_FACTOR.BUBBLE,
    ...overrides,
  };
}

function guideInput(overrides: Partial<LukeGuideInput> = {}): LukeGuideInput {
  return {
    settings: settings(),
    voiceAvailable: true,
    microphoneStatus: "granted",
    hotkey: { hotkey: "⌥Space", held: true },
    ...overrides,
  };
}

function guideSetting(id: string, input: LukeGuideInput = guideInput()): AppGuideSetting {
  const setting = buildLukeGuide(input).settings.find((candidate) => candidate.id === id);
  assert.ok(setting, `the guide lists ${id}`);
  return setting;
}

test("the guide describes every spoken-adjustable setting with its current value", () => {
  const captionsOff = guideSetting(APP_SETTING_ID.VOICE_CAPTIONS);
  assert.equal(captionsOff.kind, APP_SETTING_KIND.TOGGLE);
  assert.equal(captionsOff.value, "off");
  assert.equal(captionsOff.adjustable, true);

  const captionsOn = guideSetting(
    APP_SETTING_ID.VOICE_CAPTIONS,
    guideInput({ settings: settings({ voiceCaptions: true }) }),
  );
  assert.equal(captionsOn.value, "on");

  const voice = guideSetting(APP_SETTING_ID.VOICE);
  assert.equal(voice.kind, APP_SETTING_KIND.CHOICE);
  assert.equal(voice.value, REALTIME_VOICE.CEDAR);
  assert.deepEqual(voice.choices, REALTIME_VOICE_LIST);

  const menuBar = guideSetting(APP_SETTING_ID.SHOW_IN_MENU_BAR);
  assert.equal(menuBar.value, "on");

  const dock = guideSetting(APP_SETTING_ID.SHOW_IN_DOCK);
  assert.equal(dock.value, "off");

  // The pace is offered in words a voice can carry, current value included.
  const speed = guideSetting(APP_SETTING_ID.VOICE_SPEED);
  assert.equal(speed.kind, APP_SETTING_KIND.CHOICE);
  assert.equal(speed.value, "normal");
  assert.deepEqual(speed.choices, ["slow", "normal", "quick", "fast"]);
  assert.equal(
    guideSetting(
      APP_SETTING_ID.VOICE_SPEED,
      guideInput({ settings: settings({ voiceSpeed: REALTIME_VOICE_SPEED.FAST }) }),
    ).value,
    "fast",
  );

  // One switch covers every display: off keeps Luke to the main one alone.
  const allDisplays = guideSetting(APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS);
  assert.equal(allDisplays.kind, APP_SETTING_KIND.TOGGLE);
  assert.equal(allDisplays.value, "off");
  assert.equal(
    guideSetting(
      APP_SETTING_ID.SHOW_ON_ALL_DISPLAYS,
      guideInput({ settings: settings({ showOnAllDisplays: true }) }),
    ).value,
    "on",
  );

  const formFactor = guideSetting(APP_SETTING_ID.FORM_FACTOR);
  assert.equal(formFactor.kind, APP_SETTING_KIND.CHOICE);
  assert.equal(formFactor.value, PANEL_FORM_FACTOR.BUBBLE);
  assert.deepEqual(formFactor.choices, [PANEL_FORM_FACTOR.NOTCH, PANEL_FORM_FACTOR.BUBBLE]);
  assert.equal(
    guideSetting(
      APP_SETTING_ID.FORM_FACTOR,
      guideInput({ settings: settings({ formFactor: PANEL_FORM_FACTOR.NOTCH }) }),
    ).value,
    PANEL_FORM_FACTOR.NOTCH,
  );

  // Every entry says where the same change is made by hand, because guiding
  // the developer there is half of what the guide is for.
  for (const setting of buildLukeGuide(guideInput()).settings) {
    assert.ok(setting.manual.length > 0, `${setting.id} has a by-hand path`);
  }
});

test("the facts say what is connected, never what connects it", () => {
  const rendered = JSON.stringify(buildLukeGuide(guideInput()).facts);

  assert.match(rendered, /Conductor \(connected\)/);
  assert.match(rendered, /Copilot \(not connected\)/);
  assert.match(rendered, /Devin \(connected from the environment\)/);
  // The guide leaves the machine, so no key, prefix, or environment variable
  // value has any business in it.
  assert.doesNotMatch(rendered, /API key:/);
});

test("the facts follow the talk key, the microphone, and the storage the system offers", () => {
  const held = JSON.stringify(buildLukeGuide(guideInput()).facts);
  assert.match(held, /hold to talk/);

  const toggled = JSON.stringify(
    buildLukeGuide(guideInput({ hotkey: { hotkey: "⌥Space", held: false } })).facts,
  );
  assert.match(toggled, /press to talk/);

  const unregistered = JSON.stringify(
    buildLukeGuide(guideInput({ hotkey: { held: false } })).facts,
  );
  assert.match(unregistered, /None is registered/);

  const denied = JSON.stringify(buildLukeGuide(guideInput({ microphoneStatus: "denied" })).facts);
  assert.match(denied, /Privacy & Security/);

  const voiceless = buildLukeGuide(guideInput({ voiceAvailable: false }));
  assert.match(JSON.stringify(voiceless.facts), /OPENAI_API_KEY/);

  const unprotected = buildLukeGuide(
    guideInput({ settings: settings({ secretStorage: SECRET_STORAGE.UNAVAILABLE }) }),
  );
  assert.match(JSON.stringify(unprotected.facts), /no encrypted credential storage/);
});

test("every adjustable setting is carried to the bridge call its row uses", async () => {
  const calls: string[] = [];
  const answered: SettingsUpdateResult = { settings: settings() };
  const bridge = {
    setVoice: async () => {
      calls.push("setVoice");
      return answered;
    },
    setVoiceSpeed: async (speed: number) => {
      calls.push(`setVoiceSpeed:${speed}`);
      return answered;
    },
    setVoiceCaptions: async (enabled: boolean) => {
      calls.push(`setVoiceCaptions:${enabled}`);
      return answered;
    },
    setShowInMenuBar: async (show: boolean) => {
      calls.push(`setShowInMenuBar:${show}`);
      return answered;
    },
    setShowInDock: async (show: boolean) => {
      calls.push(`setShowInDock:${show}`);
      return answered;
    },
    setShowOnAllDisplays: async (show: boolean) => {
      calls.push(`setShowOnAllDisplays:${show}`);
      return answered;
    },
    setFormFactor: async (formFactor: string) => {
      calls.push(`setFormFactor:${formFactor}`);
      return answered;
    },
  };
  const seen: AppSettings[] = [];

  for (const setting of buildLukeGuide(guideInput()).settings) {
    if (!setting.adjustable) continue;
    const value = setting.kind === APP_SETTING_KIND.TOGGLE ? "on" : (setting.choices?.[0] ?? "");
    const outcome = await applySpokenSetting(bridge, { setting, value }, (next) => seen.push(next));
    // An adjustable entry with no carrier would come back refused: the guide
    // may never advertise a change the wiring cannot make.
    assert.equal(outcome.status, "changed", `${setting.id} is wired to the bridge`);
  }

  assert.deepEqual(calls.sort(), [
    "setFormFactor:notch",
    "setShowInDock:true",
    "setShowInMenuBar:true",
    "setShowOnAllDisplays:true",
    "setVoice",
    "setVoiceCaptions:true",
    // The first choice offered is "slow", which is the 0.75 multiple.
    "setVoiceSpeed:0.75",
  ]);
  // The snapshot the store answered with is handed back either way, so the
  // panel's switches redraw from what was actually stored.
  assert.equal(seen.length, calls.length);
});

test("the store's refusal comes back as the spoken outcome", async () => {
  const bridge = {
    setVoice: async () => ({ settings: settings() }),
    setVoiceCaptions: async () => ({
      settings: settings(),
      reason: "The settings file could not be written.",
    }),
    setShowInMenuBar: async () => ({ settings: settings() }),
  };

  const outcome = await applySpokenSetting(
    bridge,
    { setting: guideSetting(APP_SETTING_ID.VOICE_CAPTIONS), value: "on" },
    () => undefined,
  );

  assert.deepEqual(outcome, {
    status: "refused",
    reason: "The settings file could not be written.",
  });
});
