import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_SETTING_KIND,
  type AppGuideSetting,
  PANEL_FORM_FACTOR,
  PROVIDER_ID,
  REALTIME_DEFAULTS,
  REALTIME_VOICE,
  REALTIME_VOICE_LIST,
  REALTIME_VOICE_SPEED,
  type WorkspaceAgentSelection,
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
      [CREDENTIAL_PROVIDER_ID.LINEAR]: CREDENTIAL_SOURCE.NONE,
      [CREDENTIAL_PROVIDER_ID.OPENAI]: CREDENTIAL_SOURCE.NONE,
    },
    secretStorage: SECRET_STORAGE.UNKNOWN,
    showInMenuBar: true,
    showInDock: false,
    voice: REALTIME_VOICE.CEDAR,
    voiceSpeed: REALTIME_VOICE_SPEED.NORMAL,
    voiceCaptions: false,
    duckOtherMedia: true,
    sessionNotifications: true,
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
    askKey: "⌥L",
    stopKey: "⌥S",
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
  assert.equal(captionsOff.defaultValue, "off");

  const captionsOn = guideSetting(
    APP_SETTING_ID.VOICE_CAPTIONS,
    guideInput({ settings: settings({ voiceCaptions: true }) }),
  );
  assert.equal(captionsOn.value, "on");

  const voice = guideSetting(APP_SETTING_ID.VOICE);
  assert.equal(voice.kind, APP_SETTING_KIND.CHOICE);
  assert.equal(voice.value, REALTIME_VOICE.CEDAR);
  assert.deepEqual(voice.choices, REALTIME_VOICE_LIST);
  // The guide states the same default the settings row marks, so a spoken
  // "back to the default voice" names the value the row calls (default).
  assert.equal(voice.defaultValue, REALTIME_DEFAULTS.VOICE);

  const menuBar = guideSetting(APP_SETTING_ID.SHOW_IN_MENU_BAR);
  assert.equal(menuBar.value, "on");
  assert.equal(menuBar.defaultValue, "on");

  const dock = guideSetting(APP_SETTING_ID.SHOW_IN_DOCK);
  assert.equal(dock.value, "off");
  assert.equal(dock.defaultValue, "off");

  // The pace is offered in words a voice can carry, current value included.
  const speed = guideSetting(APP_SETTING_ID.VOICE_SPEED);
  assert.equal(speed.kind, APP_SETTING_KIND.CHOICE);
  assert.equal(speed.value, "normal");
  assert.equal(speed.defaultValue, "normal");
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
  assert.equal(formFactor.defaultValue, PANEL_FORM_FACTOR.BUBBLE);
  assert.deepEqual(formFactor.choices, [PANEL_FORM_FACTOR.NOTCH, PANEL_FORM_FACTOR.BUBBLE]);
  assert.equal(
    guideSetting(
      APP_SETTING_ID.FORM_FACTOR,
      guideInput({ settings: settings({ formFactor: PANEL_FORM_FACTOR.NOTCH }) }),
    ).value,
    PANEL_FORM_FACTOR.NOTCH,
  );

  // Every entry says where the same change is made by hand, because guiding
  // the developer there is half of what the guide is for — and the Settings
  // tab opens into pages, so a path that stops at the tab strands them on its
  // front page. Every one of Luke's own settings also states its default, so
  // "back to the default" is an ask the guide can always ground: a toggle's
  // default is one of its two words, a choice's one of its offered choices.
  for (const setting of buildLukeGuide(guideInput()).settings) {
    assert.ok(setting.manual.length > 0, `${setting.id} has a by-hand path`);
    assert.match(setting.manual, /Settings tab, on its \w[\w ]* page/);
    assert.ok(setting.defaultValue, `${setting.id} states its default`);
    const accepted =
      setting.kind === APP_SETTING_KIND.TOGGLE ? ["on", "off"] : (setting.choices ?? []);
    assert.ok(
      accepted.includes(setting.defaultValue),
      `${setting.id}'s default is a value a spoken change can set`,
    );
  }

  // The pages are named by what they hold: the voice rows live on the Voice
  // page and the standing rows on Appearance, so the words Luke says match
  // the row the developer will find.
  assert.match(guideSetting(APP_SETTING_ID.VOICE, guideInput()).manual, /Voice page/);
  assert.match(guideSetting(APP_SETTING_ID.VOICE_CAPTIONS, guideInput()).manual, /Voice page/);
  assert.match(guideSetting(APP_SETTING_ID.SHOW_IN_DOCK, guideInput()).manual, /Appearance page/);
  assert.match(guideSetting(APP_SETTING_ID.FORM_FACTOR, guideInput()).manual, /Appearance page/);
});

test("the facts say what is connected, never what connects it", () => {
  const rendered = JSON.stringify(buildLukeGuide(guideInput()).facts);

  assert.match(rendered, /Conductor \(connected\)/);
  assert.match(rendered, /Copilot \(not connected\)/);
  assert.match(rendered, /Devin \(connected from the environment\)/);
  // The tracker stands in its own fact, the way it stands in its own section.
  assert.match(rendered, /Linear \(not connected\)/);
  assert.match(rendered, /OpenAI \(not connected\)/);
  assert.match(rendered, /Integrations/);
  // Each integration says what connecting it buys, so a spoken ask about the
  // page cannot leave OpenAI sounding like a second Linear.
  assert.match(rendered, /Connecting OpenAI is what lets Luke speak/);
  // The guide leaves the machine, so no key, prefix, or environment variable
  // value has any business in it.
  assert.doesNotMatch(rendered, /API key:/);
});

test("the facts describe creating a workspace, so Luke does not deny the capability", () => {
  const rendered = JSON.stringify(buildLukeGuide(guideInput()).facts);

  assert.match(rendered, /Creating workspaces/);
  // The refusal shape rides with the offer: only reported projects exist.
  assert.match(rendered, /Only reported projects/);
  // Where a nameless ask goes rides with it too, so the remembered first
  // choice is something Luke explains rather than something that surprises.
  assert.match(rendered, /default workspace provider/);
  assert.match(rendered, /first workspace created saves its provider/);
  // The project a nameless ask lands in rides the same way, so the remembered
  // first choice within a provider is explained rather than a surprise.
  assert.match(rendered, /default project/);
  assert.match(rendered, /first workspace created there/);
  // And so is what the new agent runs, because a model the user never chose
  // is exactly the surprise this setting exists to end.
  assert.match(rendered, /its model, and its effort/);
});

test("the guide offers what a new Conductor agent runs, by the names people know", () => {
  // Unset reads as the provider's own defaults, which is what actually holds,
  // and the choices are the labels people know the models by — never wire ids.
  const unset = guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_MODEL);
  assert.equal(unset.kind, APP_SETTING_KIND.CHOICE);
  assert.equal(unset.value, "Conductor's default");
  assert.equal(unset.adjustable, true);
  assert.equal(unset.choices?.[0], "Conductor's default");
  assert.ok(unset.choices?.includes("Fable 5"));
  assert.ok(unset.choices?.includes("GPT-5.6 Sol"));
  assert.equal(unset.choices?.includes("fable-5"), false);
  // The by-hand path names the provider's own row, not the Preferences list.
  assert.match(unset.manual, /Conductor row under Cloud Agent API keys/);

  // No model chosen means no effort entry at all: a level with no model to
  // ride has nowhere documented to go, so nothing offers one.
  const withoutModel = buildLukeGuide(guideInput()).settings.find(
    (candidate) => candidate.id === APP_SETTING_ID.WORKSPACE_AGENT_EFFORT,
  );
  assert.equal(withoutModel, undefined);

  // A chosen model is said by its label, and its agent's documented levels
  // become the effort entry's choices.
  const chosenInput = guideInput({
    settings: settings({
      workspaceAgentDefaults: {
        [PROVIDER_ID.CONDUCTOR]: { agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
      },
    }),
  });
  assert.equal(
    guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_MODEL, chosenInput).value,
    "GPT-5.6 Sol",
  );
  const effort = guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_EFFORT, chosenInput);
  assert.equal(effort.value, "xhigh");
  assert.equal(effort.adjustable, true);
  assert.deepEqual(effort.choices, [
    "Conductor's default",
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ]);

  // A chosen model whose agent documents no levels — Cursor's — offers none.
  const cursorInput = guideInput({
    settings: settings({
      workspaceAgentDefaults: {
        [PROVIDER_ID.CONDUCTOR]: { agent: "cursor", model: "composer-2.5" },
      },
    }),
  });
  assert.equal(
    buildLukeGuide(cursorInput).settings.find(
      (candidate) => candidate.id === APP_SETTING_ID.WORKSPACE_AGENT_EFFORT,
    ),
    undefined,
  );
});

test("a spoken model or effort change composes the one stored selection", async () => {
  const carried: (WorkspaceAgentSelection | undefined)[] = [];
  const bridge = {
    setWorkspaceAgentDefault: async (
      _providerId: string,
      selection: WorkspaceAgentSelection | undefined,
    ) => {
      carried.push(selection);
      return { settings: settings() };
    },
  } as unknown as Parameters<typeof applySpokenSetting>[0];
  const stored = settings({
    workspaceAgentDefaults: {
      [PROVIDER_ID.CONDUCTOR]: { agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
    },
  });
  const input = guideInput({ settings: stored });

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

test("the guide describes the default workspace provider without offering to change it", () => {
  // Unset reads as the asking state — the default every install starts in —
  // not as a missing value.
  const unset = guideSetting(APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER);
  assert.equal(unset.kind, APP_SETTING_KIND.CHOICE);
  assert.equal(unset.value, "ask each time");
  assert.equal(unset.defaultValue, "ask each time");
  // Kept by hand: the first creation is the spoken way it changes, so the
  // spoken refusal must carry the by-hand path instead of a carrier.
  assert.equal(unset.adjustable, false);
  assert.match(unset.manual, /Settings tab/);

  // A chosen provider is said by the name its rows use, never as a raw id.
  const chosen = guideSetting(
    APP_SETTING_ID.DEFAULT_WORKSPACE_PROVIDER,
    guideInput({ settings: settings({ defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR }) }),
  );
  assert.equal(chosen.value, "Conductor");
});

test("the facts describe stopping a reply, exactly where a reply can exist", () => {
  const rendered = JSON.stringify(buildLukeGuide(guideInput()).facts);

  assert.match(rendered, /Stopping a reply/);
  // The registered key leads, and Escape rides with it: the stop key answers
  // from any app, Escape only while the panel has the keyboard.
  assert.match(rendered, /⌥S, from any app/);
  assert.match(rendered, /Escape does the same/);
  // Guiding the developer to the row is half of what the guide is for.
  assert.match(rendered, /A different stop chord can be recorded/);

  // No key registered — another app owns ⌥S, or a Luke key was moved onto
  // it — leaves Escape as the whole of the capability, said honestly.
  const keyless = JSON.stringify(buildLukeGuide(guideInput({ stopKey: undefined })).facts);
  assert.match(keyless, /Escape while Luke is speaking/);
  assert.match(keyless, /No system-wide stop key is registered/);

  // Without a voice there is no reply to stop, so the fact would describe a
  // key that does nothing.
  const voiceless = JSON.stringify(buildLukeGuide(guideInput({ voiceAvailable: false })).facts);
  assert.doesNotMatch(voiceless, /Stopping a reply/);
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

  // The ask key is a fact on the talk key's terms: the registered chord when
  // there is one, and an honest absence when there is not.
  assert.match(held, /⌥L, from any app: summons the panel/);
  const askless = buildLukeGuide(guideInput({ askKey: undefined })).facts.find(
    (fact) => fact.label === "Ask key",
  );
  assert.ok(askless);
  assert.match(askless.detail, /None is registered/);

  const denied = JSON.stringify(buildLukeGuide(guideInput({ microphoneStatus: "denied" })).facts);
  assert.match(denied, /Privacy & Security/);

  const voiceless = buildLukeGuide(guideInput({ voiceAvailable: false }));
  assert.match(JSON.stringify(voiceless.facts), /no OpenAI key is connected/);
  // The muted-output behavior belongs to speech, so it is described exactly
  // where speech exists: with a voice it is a fact, without one it would
  // describe captions no reply will ever draw.
  assert.match(held, /muted or its volume is at zero/);
  assert.doesNotMatch(JSON.stringify(voiceless.facts), /muted or its volume/);

  const unprotected = buildLukeGuide(
    guideInput({ settings: settings({ secretStorage: SECRET_STORAGE.UNAVAILABLE }) }),
  );
  assert.match(JSON.stringify(unprotected.facts), /no encrypted credential storage/);
});

test("the panel fact says the tabs answer an ask as well as a press", () => {
  const fact = buildLukeGuide(guideInput()).facts.find(
    (candidate) => candidate.label === "The panel",
  );

  assert.ok(fact);
  // Switching between Sessions and Settings by asking Luke is a capability,
  // and a capability the guide does not describe is one Luke will deny.
  assert.match(fact.detail, /switched by pressing one or by asking Luke/);
  assert.match(fact.detail, /the panel opens on that tab/);
  assert.match(fact.detail, /Sessions lists/);
  assert.match(fact.detail, /Settings holds/);
});

test("the feedback fact says what a spoken open may do, and that sending stays by hand", () => {
  const fact = buildLukeGuide(guideInput()).facts.find(
    (candidate) => candidate.label === "Feedback and prompts",
  );

  assert.ok(fact);
  // The guide is what Luke says about himself, so it must promise exactly the
  // capability the tool has: opening with the developer's own words, the
  // refusal-then-offer, and never the send.
  assert.match(fact.detail, /can open the composer/);
  assert.match(fact.detail, /developer's own words/);
  assert.match(fact.detail, /after refusing something he cannot do/);
  assert.match(fact.detail, /never overwritten/);
  assert.match(fact.detail, /no spoken ask can send one/);
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
    setDuckOtherMedia: async (enabled: boolean) => {
      calls.push(`setDuckOtherMedia:${enabled}`);
      return answered;
    },
    setSessionNotifications: async (enabled: boolean) => {
      calls.push(`setSessionNotifications:${enabled}`);
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
    setWorkspaceAgentDefault: async (
      _providerId: string,
      selection: WorkspaceAgentSelection | undefined,
    ) => {
      calls.push(`setWorkspaceAgentDefault:${selection ? selection.model : "default"}`);
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
    "setDuckOtherMedia:true",
    "setFormFactor:notch",
    "setSessionNotifications:true",
    "setShowInDock:true",
    "setShowInMenuBar:true",
    "setShowOnAllDisplays:true",
    "setVoice",
    "setVoiceCaptions:true",
    // The first choice offered is "slow", which is the 0.75 multiple.
    "setVoiceSpeed:0.75",
    // The first choice offered is "Conductor's default", which clears.
    "setWorkspaceAgentDefault:default",
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
