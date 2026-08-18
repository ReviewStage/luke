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
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  CREDENTIAL_SOURCE,
  SECRET_STORAGE,
} from "../src/shared/contracts";
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
    quietDuringMeetings: true,
    calendarSignInAvailable: false,
    calendarAccounts: [],
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

test("the guide keeps the signed-out escape path explicit", () => {
  const quitting = buildLukeGuide(guideInput()).facts.find((fact) => fact.label === "Quitting");
  assert.match(quitting?.detail ?? "", /sign-in screen/);
});

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

  // The pace is offered in words a voice can carry and in the multiples its
  // settings row shows, so an ask in either spelling lands.
  const speed = guideSetting(APP_SETTING_ID.VOICE_SPEED);
  assert.equal(speed.kind, APP_SETTING_KIND.CHOICE);
  assert.equal(speed.value, "normal");
  assert.equal(speed.defaultValue, "normal");
  assert.deepEqual(speed.choices, [
    "slow",
    "0.75×",
    "normal",
    "1×",
    "quick",
    "1.25×",
    "fast",
    "1.5×",
  ]);
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
  assert.match(rendered, /Integrations/);
  // A build without the calendar sign-in draws no calendar row, so the guide
  // says nothing about one — a capability the guide describes is one Luke
  // will claim to have.
  assert.doesNotMatch(rendered, /Google Calendar/);

  // A build carrying the sign-in describes the calendar: what it reads —
  // times, never titles — and how it connects.
  const offered = JSON.stringify(
    buildLukeGuide(guideInput({ settings: settings({ calendarSignInAvailable: true }) })).facts,
  );
  assert.match(offered, /Google Calendar \(not connected\)/);
  assert.match(offered, /when meetings start and end/);
  assert.match(offered, /signing in with Google/);

  const connected = JSON.stringify(
    buildLukeGuide(
      guideInput({
        settings: settings({
          calendarSignInAvailable: true,
          calendarAccounts: [
            { id: "work@example.com", selectedCalendarIds: ["work@example.com"] },
            { id: "home@example.com", selectedCalendarIds: [] },
          ],
        }),
      }),
    ).facts,
  );
  assert.match(connected, /Google Calendar \(2 accounts connected\)/);
  assert.match(connected, /checkboxes under each account/);
  // The voice key stands in a fact of its own, placed where its row actually
  // lives: the What Luke runs on section, not the Voice page or the Integrations
  // section it once shared with Linear. With voice available and no key
  // connected, the fact says whose allowance voice runs on — and what a key
  // of your own would cost instead; with voice unavailable, it says both ways
  // in.
  assert.match(rendered, /OpenAI \(not connected\)/);
  assert.match(rendered, /signed-in Luke account's daily allowance/);
  assert.match(rendered, /billed by OpenAI/);
  assert.match(rendered, /What Luke runs on section at the top/);
  const voiceless = JSON.stringify(buildLukeGuide(guideInput({ voiceAvailable: false })).facts);
  assert.match(voiceless, /Signing in — or connecting a key — is what lets Luke speak/);
  assert.doesNotMatch(rendered, /OpenAI[^"]*under Integrations/);
  // The guide leaves the machine, so no key, prefix, or environment variable
  // value has any business in it.
  assert.doesNotMatch(rendered, /API key:/);
});

test("the guide names the signed-in identity and keeps sign-out manual", () => {
  const facts = buildLukeGuide(
    guideInput({
      account: {
        status: ACCOUNT_STATUS.SIGNED_IN,
        email: "developer@example.com",
        provider: ACCOUNT_PROVIDER.GITHUB,
      },
    }),
  ).facts;
  const account = facts.find((fact) => fact.label === "Account");

  assert.match(account?.detail ?? "", /developer@example.com/);
  assert.match(account?.detail ?? "", /GitHub/);
  assert.match(account?.detail ?? "", /by hand/);
  // Deleting the account is described — and described as hand-only — so Luke
  // neither denies the capability nor lets a spoken ask believe it can reach it.
  assert.match(account?.detail ?? "", /Delete account/);
  assert.match(account?.detail ?? "", /no spoken ask/);
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
  // Where a bare "new agent" ask lands rides with both facts, so the guide
  // explains the default the same way the conversation acts on it: a new
  // workspace, unless the ask itself names the existing one to join.
  assert.match(rendered, /bare ask for a new agent lands here/);
  assert.match(rendered, /bare ask for a new agent creates a new workspace instead/);
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

  // The levels each model takes ride the model entry itself, keyed by the
  // labels the choices are said by, so a model and its effort can be asked
  // for in one change even while nothing is chosen yet.
  assert.deepEqual(unset.efforts?.["Fable 5"], ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(unset.efforts?.["GPT-5.6 Sol"], [
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
  ]);
  // A model whose agent documents no levels — Cursor's — is absent, and so is
  // the default word: neither has a level anywhere documented to take.
  assert.equal(unset.efforts?.["Cursor Auto"], undefined);
  assert.equal(unset.efforts?.["Conductor's default"], undefined);

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

test("a model and its effort named in one change land as one stored pairing", async () => {
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

  // Nothing chosen yet — the state the effort entry does not exist in — and
  // the pair still lands whole, in one act riding one bridge call.
  const unset = settings();
  const model = guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_MODEL, guideInput({ settings: unset }));
  const outcome = await applySpokenSetting(
    bridge,
    { setting: model, value: "Fable 5", effort: "high" },
    () => undefined,
    unset,
  );
  assert.equal(outcome.status, "changed");
  assert.equal(outcome.effort, "high");
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
  assert.equal(refusedLevel.status, "refused");
  assert.match(String(refusedLevel.reason), /takes no effort level/);

  // The default word names no model, so no effort has anywhere to ride.
  const refusedDefault = await applySpokenSetting(
    bridge,
    { setting: model, value: "Conductor's default", effort: "high" },
    () => undefined,
    unset,
  );
  assert.equal(refusedDefault.status, "refused");
  assert.match(String(refusedDefault.reason), /default takes no effort level/);
  assert.equal(carried.length, 2);
});

test("a model and its effort asked in one breath compose through the held answer", async () => {
  const carried: (WorkspaceAgentSelection | undefined)[] = [];
  const bridge = {
    setWorkspaceAgentDefault: async (
      _providerId: string,
      selection: WorkspaceAgentSelection | undefined,
    ) => {
      carried.push(selection);
      return {
        settings: settings(
          selection ? { workspaceAgentDefaults: { [PROVIDER_ID.CONDUCTOR]: selection } } : {},
        ),
      };
    },
  } as unknown as Parameters<typeof applySpokenSetting>[0];

  // Nothing chosen yet, so the guide carries no effort entry at all — the
  // paired ask arrives as two calls, and everything the second half needs
  // only becomes true when the first half's answer lands.
  const unset = settings();
  let held: AppSettings | undefined;
  await applySpokenSetting(
    bridge,
    {
      setting: guideSetting(APP_SETTING_ID.WORKSPACE_AGENT_MODEL, guideInput({ settings: unset })),
      value: "Fable 5",
    },
    (next) => {
      held = next;
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
  assert.equal(outcome.status, "changed");
  assert.deepEqual(carried.at(-1), { agent: "claude", model: "fable-5", effort: "high" });
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
  assert.match(JSON.stringify(voiceless.facts), /nothing to run voice on/);
  // The refusal carries the way out: both ways in live under What Luke runs on,
  // and a fact that stopped at "off" would leave the ask unanswerable.
  assert.match(JSON.stringify(voiceless.facts), /What Luke runs on section at the top/);
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

test("the panel fact describes the search, and says it is by hand alone", () => {
  const fact = buildLukeGuide(guideInput()).facts.find(
    (candidate) => candidate.label === "The panel",
  );

  assert.ok(fact);
  // A capability the guide does not describe is one Luke will deny having —
  // and a search Luke claimed he could run himself would be a capability the
  // spoken tools deliberately do not have.
  assert.match(fact.detail, /searchable by hand alone/);
  assert.match(fact.detail, /magnifier/);
  assert.match(fact.detail, /Command-F/);
  assert.match(fact.detail, /title, status line, branch, repository, workspace, agent, or model/);
  assert.match(fact.detail, /no spoken ask can search/);
  assert.match(fact.detail, /no search survives the panel closing/);
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
    setPreferBuiltInMicrophone: async (enabled: boolean) => {
      calls.push(`setPreferBuiltInMicrophone:${enabled}`);
      return answered;
    },
    setQuietDuringMeetings: async (enabled: boolean) => {
      calls.push(`setQuietDuringMeetings:${enabled}`);
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
    "setPreferBuiltInMicrophone:true",
    "setQuietDuringMeetings:true",
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

test("a pace asked for by its multiple carries the same as its word", async () => {
  const calls: string[] = [];
  const bridge = {
    setVoiceSpeed: async (speed: number) => {
      calls.push(`setVoiceSpeed:${speed}`);
      return { settings: settings() };
    },
  };

  for (const value of ["quick", "1.25×"]) {
    const outcome = await applySpokenSetting(
      bridge,
      { setting: guideSetting(APP_SETTING_ID.VOICE_SPEED), value },
      () => undefined,
    );
    assert.equal(outcome.status, "changed");
  }

  assert.deepEqual(calls, ["setVoiceSpeed:1.25", "setVoiceSpeed:1.25"]);
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
