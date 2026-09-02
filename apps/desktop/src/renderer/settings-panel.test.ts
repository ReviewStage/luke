import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./settings-panel.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");

test("the Updates section keeps one place as update state changes", () => {
  const updates = [...source.matchAll(/<UpdatesSection\b/g)].map(({ index }) => index);
  const settingsIndex = source.indexOf('className="settings-section settings-index"');

  assert.equal(updates.length, 1, "Updates is not conditionally moved between two render sites");
  assert.ok((updates[0] ?? -1) > settingsIndex, "Updates stays below the settings page index");
  assert.match(source, /settings-index"\s+style=\{cssCustomProperties\(\{ "--row-index": 1 \}\)\}/);
  assert.match(source, /<UpdatesSection control=\{updates\} rowIndex=\{2\} \/>/);
});

test("Provider follows Permissions and precedes the voice controls", () => {
  const permissions = source.indexOf("<ShieldIcon />\n            Permissions");
  const provider = source.indexOf("<ProviderSection");
  const controls = source.indexOf("<VoiceControlsSection");

  assert.ok(permissions >= 0);
  assert.ok(provider > permissions);
  assert.ok(controls > provider);
  assert.match(source, /<ProviderSection\s+rowIndex=\{2\}/);
});

test("the Voice page draws the provider once, through ProviderSection", () => {
  const controls = source.slice(source.indexOf("function VoiceControlsSection"));
  assert.match(controls, /exclude=\{\[APP_SETTING_SCHEMA\.voiceSource\.field\]\}/);
});

test("hosted quotas stay out of the customer-facing renderer", () => {
  assert.doesNotMatch(source, /<meter\b|hostedUsage|remaining|resetsAt/);
  assert.doesNotMatch(appSource, /requestHostedUsage/);
});
