import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_SUBMISSION_OUTCOME,
  BrainAgent,
  BrainStateStore,
} from "@sidecar/brain";
import { APP_SETTING_SCHEMA, VOICE_SOURCE, type VoiceSource } from "@sidecar/settings";
import { VoiceCapabilityAssembler, type VoiceSettings } from "@sidecar/voice";
import { BrainHost } from "./brain-host";
import { transitionVoiceCredential } from "./voice-credential-transition";

/**
 * A settings store whose reads a test can hold: each `readVoiceSource` waits
 * on a gate the test releases, in whatever order the interleaving under test
 * needs. `source` and `key` are what the reads answer once released.
 */
class HeldSettings implements VoiceSettings {
  source: VoiceSource = VOICE_SOURCE.KEY;
  key: string | undefined = "personal-key";
  readonly #gates: (() => void)[] = [];
  holdNext = false;

  readVoiceSource(): Promise<VoiceSource> {
    if (!this.holdNext) return Promise.resolve(this.source);
    this.holdNext = false;
    return new Promise((resolve) => {
      this.#gates.push(() => resolve(this.source));
    });
  }

  /** Releases the oldest held read, answering the source as it stands now. */
  release(): void {
    const gate = this.#gates.shift();
    assert.ok(gate, "no read is held");
    gate();
  }

  readApiKey(): Promise<string | undefined> {
    return Promise.resolve(this.key);
  }

  get<Field extends keyof typeof APP_SETTING_SCHEMA>(field: Field) {
    // SAFETY: the schema's own default for the field being read.
    return Promise.resolve(APP_SETTING_SCHEMA[field].default as never);
  }

  readAccount(): Promise<{ accessToken: string } | undefined> {
    return Promise.resolve({ accessToken: "account-token" });
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

function composition() {
  const settings = new HeldSettings();
  const warms: string[] = [];
  const reports: string[] = [];
  const assembler = new VoiceCapabilityAssembler({
    settings,
    credentialsUsable: () => true,
    fixtureRun: () => false,
    accountSignedIn: () => true,
    hostedServiceBaseUrl: "https://luke.test",
    refreshAccount: async () => undefined,
    fetch: async (input) => {
      warms.push(String(input));
      return new Response(null, { status: 204 });
    },
    report: (message) => reports.push(message),
  });
  const followed: BrainAgent[] = [];
  const host = new BrainHost({
    follow: (agent) => {
      followed.push(agent);
      return async () => undefined;
    },
    publishEmpty: () => undefined,
  });
  let file: string | undefined;
  const store = new BrainStateStore({
    storage: {
      read: () => file,
      write: (contents) => {
        file = contents;
        return true;
      },
      remove: () => {
        file = undefined;
        return true;
      },
    },
    createGenerationId: () => "gen-1",
  });
  const builds: (BrainAgent | undefined)[] = [];
  let runs = 0;
  const rebuild = () =>
    host.replace(() => {
      const client = assembler.brainClient;
      const agent = client
        ? new BrainAgent({
            client,
            acts: { perform: async () => ({ status: "accepted" }) },
            roster: () => ({ text: "none", identities: [] }),
            standingContext: () => "",
            readTranscriptSince: async () => ({ status: "unsupported", reason: "no" }),
            readTranscript: async () => ({ status: "unsupported", reason: "no" }),
            deliver: () => undefined,
            store,
            createRunId: () => `run-${runs++}`,
            report: () => undefined,
          })
        : undefined;
      builds.push(agent);
      return agent;
    });
  const transition = () =>
    transitionVoiceCredential({
      retire: () => host.retire(),
      apply: () => assembler.apply(),
      rebuild,
    });
  return { settings, assembler, host, transition, builds, followed, warms, reports };
}

test("a transition whose reads finished late installs nothing over the newer selection, and the newer agent is left alone", async () => {
  const c = composition();
  // The developer has a key and chose it; the first transition's read of
  // the source is held open.
  c.settings.holdNext = true;
  const older = c.transition();
  await settle();
  // They now choose the account; that transition reads and completes first.
  c.settings.source = VOICE_SOURCE.ACCOUNT;
  const newerInstalled = await c.transition();
  assert.equal(newerInstalled, true);
  assert.equal(c.assembler.voiceSource, VOICE_SOURCE.ACCOUNT);
  assert.equal(c.assembler.brainClient?.model, undefined);
  const hostedAgent = c.host.current();
  assert.ok(hostedAgent);
  const reportsAfterNewer = c.reports.length;
  const warmsAfterNewer = c.warms.length;

  // The older read answers now, with the source as the store holds it. Even
  // if it had answered the old key, it is stale: it publishes nothing,
  // warms nothing, reports nothing, and rebuilds nothing.
  c.settings.source = VOICE_SOURCE.KEY;
  c.settings.release();
  const olderInstalled = await older;
  await c.host.settled();
  assert.equal(olderInstalled, false);
  assert.equal(c.assembler.voiceSource, VOICE_SOURCE.ACCOUNT);
  assert.equal(c.assembler.brainClient?.model, undefined);
  assert.equal(c.host.current(), hostedAgent);
  assert.equal(c.reports.length, reportsAfterNewer);
  assert.equal(c.warms.length, warmsAfterNewer);
  assert.equal(c.builds.length, 1);

  // The correctly installed agent was never interrupted: it still takes an ask.
  const accepted = await hostedAgent.submitAsk({
    submissionId: "s-1",
    question: "still there?",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await hostedAgent.stop();
});

test("the reverse order holds too: a late account read never overrides a newer key selection", async () => {
  const c = composition();
  c.settings.source = VOICE_SOURCE.ACCOUNT;
  c.settings.holdNext = true;
  const older = c.transition();
  await settle();
  c.settings.source = VOICE_SOURCE.KEY;
  assert.equal(await c.transition(), true);
  assert.equal(c.assembler.voiceSource, VOICE_SOURCE.KEY);
  assert.ok(c.assembler.brainClient?.model);
  const keyedAgent = c.host.current();
  assert.ok(keyedAgent);

  c.settings.source = VOICE_SOURCE.ACCOUNT;
  c.settings.release();
  assert.equal(await older, false);
  await c.host.settled();
  assert.equal(c.assembler.voiceSource, VOICE_SOURCE.KEY);
  assert.ok(c.assembler.brainClient?.model);
  assert.equal(c.host.current(), keyedAgent);
  assert.equal(c.builds.length, 1);
  await keyedAgent.stop();
});

test("a late read cannot resurrect a capability the newer transition removed", async () => {
  const c = composition();
  c.settings.holdNext = true;
  const older = c.transition();
  await settle();
  // The key is removed and no account source is chosen: nothing may stand.
  c.settings.key = undefined;
  c.settings.source = VOICE_SOURCE.KEY;
  const accountSignedOut = composition();
  void accountSignedOut;
  assert.equal(await c.transition(), true);
  const standing = c.host.current();
  c.settings.key = "personal-key";
  c.settings.release();
  assert.equal(await older, false);
  await c.host.settled();
  assert.equal(c.host.current(), standing);
  assert.equal(c.builds.length, 1);
  if (standing) await standing.stop();
});

test("transitions that do not overlap each install in turn", async () => {
  const c = composition();
  assert.equal(await c.transition(), true);
  const first = c.host.current();
  assert.ok(first);
  assert.ok(c.assembler.brainClient?.model);
  c.settings.source = VOICE_SOURCE.ACCOUNT;
  assert.equal(await c.transition(), true);
  const second = c.host.current();
  assert.ok(second);
  assert.notEqual(second, first);
  assert.equal(c.assembler.brainClient?.model, undefined);
  assert.equal(c.builds.length, 2);
  await second.stop();
});
