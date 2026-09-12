import {
  PRODUCT_EVENT,
  PRODUCT_VOICE_SESSION_SOURCE,
  type RecordProductEvent,
} from "@sidecar/analytics";
import type { VoiceCreateLiveSessionResult } from "@sidecar/gateway";
import { introductionSeedItems } from "@sidecar/live";
import type { IntroductionLiveSessionOpened, IntroductionSessionSource } from "@sidecar/voice";

export interface IntroductionSessionDependencies {
  source: IntroductionSessionSource;
  recordProductEvent: RecordProductEvent;
}

/**
 * The introduction's one GPT Live session, as the main process holds it: the
 * takeover's offer goes to the accountless voice service with the signed-in
 * developer's first name and the detected titles as the session's only seed,
 * the answer goes back to the takeover, and what stays here is the
 * connection the session was created over, which the service reads as the
 * caller's presence. The name is read here, from the account this process
 * already holds, never from the renderer's offer, so the window composes no
 * observed value. Closing it is the hang-up, so the session cannot outlive
 * the takeover: a second offer ends the first session, and the
 * introduction's ending ends whichever stands. No credential is held or
 * handed on at any point; the service owns the key and the sideband both.
 */
export class IntroductionSession {
  readonly #dependencies: IntroductionSessionDependencies;
  #standing: IntroductionLiveSessionOpened | undefined;

  constructor(dependencies: IntroductionSessionDependencies) {
    this.#dependencies = dependencies;
  }

  get standing(): boolean {
    return this.#standing !== undefined;
  }

  async open(input: {
    sdp: string;
    titles: readonly string[];
    /** The account's display name; the seed keeps its first word under its own bound. */
    name?: string | undefined;
  }): Promise<VoiceCreateLiveSessionResult | undefined> {
    this.end();
    const opened = await this.#dependencies.source.create({
      sdpOffer: input.sdp,
      input: introductionSeedItems({ titles: input.titles, name: input.name }),
    });
    if (!opened) return undefined;
    this.#standing = opened;
    this.#dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
      session_source: PRODUCT_VOICE_SESSION_SOURCE.INTRODUCTION,
    });
    return { sessionId: opened.sessionId, sdpAnswer: opened.sdpAnswer };
  }

  end(): void {
    const standing = this.#standing;
    if (!standing) return;
    this.#standing = undefined;
    standing.close();
  }
}
