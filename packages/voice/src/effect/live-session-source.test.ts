import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { LIVE_SESSION_OUTCOME, type LiveDiagnostics } from "@sidecar/live";
import { Effect } from "effect";
import type { IntroductionSessionSource, LiveSessionSource } from "../live-session-source.js";
import {
  IntroductionSessionSourceTag,
  introductionSessionSourceLayer,
  LiveSessionSourceTag,
  liveSessionSourceLayer,
} from "./live-session-source.js";

const diagnostics: LiveDiagnostics = {
  apiKeyConfigured: true,
  fixtureMode: false,
  model: "fake-model",
  voice: "alloy",
  sidebandAttached: false,
  lastOutcome: LIVE_SESSION_OUTCOME.SUCCEEDED,
};

const fakeSource: LiveSessionSource = {
  create: () => Promise.resolve(undefined),
  setVoice: () => undefined,
  diagnostics: () => diagnostics,
};

const fakeIntroductionSource: IntroductionSessionSource = {
  create: () => Promise.resolve(undefined),
  diagnostics: () => diagnostics,
};

describe("liveSessionSourceLayer", () => {
  it.effect("hands the same source object back through the tag", () =>
    Effect.gen(function* () {
      const source = yield* LiveSessionSourceTag;
      assert.equal(source, fakeSource);
    }).pipe(Effect.provide(liveSessionSourceLayer(fakeSource))),
  );
});

describe("introductionSessionSourceLayer", () => {
  it.effect("hands the same source object back through the tag", () =>
    Effect.gen(function* () {
      const source = yield* IntroductionSessionSourceTag;
      assert.equal(source, fakeIntroductionSource);
    }).pipe(Effect.provide(introductionSessionSourceLayer(fakeIntroductionSource))),
  );
});
