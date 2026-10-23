import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { SETTING_SIDE_EFFECT, SETTINGS_RESET_SCOPE, THEME } from "@luke/settings";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import type { AppSettings, SettingsUpdateResult } from "@luke/settings/wire";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Effect, Option } from "effect";
import { type ActPortClient, SETTINGS_ACT_KIND } from "../contract/index.js";
import type { ActSender } from "./base.js";
import type { ClientSettingSideEffects, SettingsProceduresDependencies } from "./index.js";
import { settingsProcedures } from "./settings-procedures.js";
import { settledAct, type TestActPort, testActPort } from "./testing.js";

/**
 * The settings writes, through the act port as a window calls them: a write
 * reaches the host under the asking window's reporter with the value its
 * field's own guard admitted; and a frame this build does not trust, a sender that is
 * no window of the platform's, or a value its field refuses is refused in
 * the kind's own words, before the host is asked.
 */

const WINDOW = Symbol("window");
const PANEL: ActSender = { sender: WINDOW, panel: true, voice: false, call: false };

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [SETTINGS_ACT_KIND.SETTING_UPDATE]: "Could not save that setting on this system.",
  [SETTINGS_ACT_KIND.SETTINGS_RESET]: "Could not reset those settings on this system.",
  [SETTINGS_ACT_KIND.EXPERIMENT_SET]: "Could not change that experiment on this system.",
} as const;

const NO_SIDE_EFFECTS: ClientSettingSideEffects = {
  [SETTING_SIDE_EFFECT.NONE]: () => {},
  [SETTING_SIDE_EFFECT.LOGIN_ITEM]: () => {},
  [SETTING_SIDE_EFFECT.USAGE_DATA]: () => {},
  [SETTING_SIDE_EFFECT.VOICE]: () => {},
  [SETTING_SIDE_EFFECT.MEDIA_DUCK]: () => {},
};

let port: TestActPort<unknown> | undefined;

afterEach(() => {
  port?.close();
  port = undefined;
});

/**
 * A window's act port onto the settings procedures, over a host that holds
 * one settings document and answers every write accepted, recording each
 * write as it reached it: the field, the value, and the reporter.
 */
function windowPort(
  options: {
    trusted?: boolean;
    sideEffects?: ClientSettingSideEffects;
    reporterOf?: SettingsProceduresDependencies["reporterOf"];
    settings?: AppSettings;
  } = {},
) {
  let held: AppSettings = options.settings ?? appSettingsWire(settingsView());
  const writes: unknown[] = [];
  const accepted = (): SettingsUpdateResult => ({
    status: ACTION_RESULT_STATUS.ACCEPTED,
    settings: held,
  });
  const host: SettingsProceduresDependencies["host"] = {
    settingsSnapshot: () => Effect.sync(() => Option.some(held)),
    updateSetting: (field, value, reporter) =>
      Effect.sync(() => {
        writes.push([field, value, reporter]);
        held = { ...held, stored: { ...held.stored, [field]: value } };
        return accepted();
      }),
    resetSettings: (scope, _kept, reporter) =>
      Effect.sync(() => {
        writes.push([scope, reporter]);
        return accepted();
      }),
    setExperiment: (experiment, on, reporter) =>
      Effect.sync(() => {
        writes.push([experiment, on, reporter]);
        return accepted();
      }),
  };
  port = testActPort(
    settingsProcedures({
      host,
      reporterOf:
        options.reporterOf ?? ((actor) => (actor.sender === WINDOW ? "panel" : undefined)),
      lastSettings: () => held,
      sideEffects: options.sideEffects ?? NO_SIDE_EFFECTS,
    }),
  );
  const client = port.as(PANEL, { trusted: options.trusted ?? true });
  return { client, writes, stored: () => held.stored };
}

/** A call settled to the sentence of its refusal, or a failure where it answered. */
async function refusal(call: Promise<unknown>): Promise<string> {
  const settled = await settledAct(call);
  return "refused" in settled
    ? settled.refused
    : assert.fail("the call was answered rather than refused");
}

/** Every settings kind called once, each settled to the sentence of its refusal. */
async function everyKindRefused(client: ActPortClient) {
  return {
    [SETTINGS_ACT_KIND.SETTING_UPDATE]: await refusal(
      client[SETTINGS_ACT_KIND.SETTING_UPDATE]({ field: "theme", value: THEME.DARK }),
    ),
    [SETTINGS_ACT_KIND.SETTINGS_RESET]: await refusal(
      client[SETTINGS_ACT_KIND.SETTINGS_RESET]({ scope: SETTINGS_RESET_SCOPE.VOICE, kept: [] }),
    ),
    [SETTINGS_ACT_KIND.EXPERIMENT_SET]: await refusal(
      client[SETTINGS_ACT_KIND.EXPERIMENT_SET]({ experiment: "code-review", on: true }),
    ),
  };
}

it("a write reaches the host as its field's guard reads it, under the asking window's reporter", async () => {
  const { client, writes } = windowPort();

  await client[SETTINGS_ACT_KIND.SETTING_UPDATE]({ field: "theme", value: THEME.DARK });
  await client[SETTINGS_ACT_KIND.EXPERIMENT_SET]({ experiment: "code-review", on: true });

  assert.deepEqual(writes, [
    ["theme", THEME.DARK, "panel"],
    ["code-review", true, "panel"],
  ]);
});

it("the settings a write answers cross whole, a stored field this build does not name among them", async () => {
  const settings = appSettingsWire(settingsView());
  const { client } = windowPort({
    settings: { ...settings, stored: { ...settings.stored, ...{ aNewerBuildsField: "kept" } } },
  });

  const answer = await client[SETTINGS_ACT_KIND.SETTING_UPDATE]({
    field: "theme",
    value: THEME.DARK,
  });

  assert.equal(answer.settings.stored.theme, THEME.DARK);
  assert.ok(
    Object.entries(answer.settings.stored).some(
      ([field, value]) => field === "aNewerBuildsField" && String(value) === "kept",
    ),
  );
});

it("a frame this build does not trust is refused every settings write in the kind's own words, and the host is not asked", async () => {
  const { client, writes } = windowPort({ trusted: false });

  assert.deepEqual(await everyKindRefused(client), REFUSAL);
  assert.deepEqual(writes, []);
});

it("a sender that is no window of the platform's is refused every settings write in the kind's own words, and the host is not asked", async () => {
  const { client, writes } = windowPort({ reporterOf: () => undefined });

  assert.deepEqual(await everyKindRefused(client), REFUSAL);
  assert.deepEqual(writes, []);
});

it("a value its field's guard refuses, or a key the payload does not take, is refused in the kind's own words, and the host is not asked", async () => {
  const { client, writes } = windowPort();
  const update = client[SETTINGS_ACT_KIND.SETTING_UPDATE];
  const extra = {
    field: "theme",
    value: THEME.DARK,
    reporter: "another window",
  } as const;

  assert.equal(
    await refusal(update({ field: "theme", value: "not a theme" })),
    REFUSAL[SETTINGS_ACT_KIND.SETTING_UPDATE],
  );
  assert.equal(await refusal(update(extra)), REFUSAL[SETTINGS_ACT_KIND.SETTING_UPDATE]);
  assert.deepEqual(writes, []);
});

it("a reset or an experiment switch carrying a key its payload does not take is refused in the kind's own words, and the host is not asked", async () => {
  const { client, writes } = windowPort();
  const reset = { scope: SETTINGS_RESET_SCOPE.VOICE, kept: [], unexpected: true } as const;
  const experiment = { experiment: "code-review", on: true, unexpected: true } as const;

  assert.equal(
    await refusal(client[SETTINGS_ACT_KIND.SETTINGS_RESET](reset)),
    REFUSAL[SETTINGS_ACT_KIND.SETTINGS_RESET],
  );
  assert.equal(
    await refusal(client[SETTINGS_ACT_KIND.EXPERIMENT_SET](experiment)),
    REFUSAL[SETTINGS_ACT_KIND.EXPERIMENT_SET],
  );
  assert.deepEqual(writes, []);
});
