import { PRODUCT_EVENT, productSignInAge } from "@sidecar/analytics";
import type { BrainDelivery } from "@sidecar/brain";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  gatewayOk,
  invalid,
  RECEIVER_REPORT_KIND,
} from "@sidecar/gateway";
import {
  ARRIVAL_SPEECH_KIND,
  BRIEFING_SPEECH_KIND,
  CALENDAR_ONBOARDING_SPEECH_KIND,
} from "@sidecar/realtime";
import { isSpeechOutcome, SPEECH_OUTCOME, type SpeechOutcome } from "@sidecar/realtime/speech";
import { isIdentifier } from "@sidecar/runtime-contracts";
import { isWireNumber } from "@sidecar/wire";
import { arrivalBeatOwed, countsFirstAnnouncement } from "./arrival-flow.js";
import type { AccountComposer } from "./compose-account.js";
import type { CalendarsComposer } from "./compose-calendars.js";
import type { ObservationComposer } from "./compose-observation.js";
import type { SettingsComposer } from "./compose-settings.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { lateRef } from "./late-ref.js";
import { type OnboardingBeatKind, SpeechArbiter } from "./voice/speech-arbiter.js";
import { VoiceReceiver } from "./voice-receiver.js";

/** What speech reaches in the brain whose words it says. */
export interface SpeechLinks {
  /** Whether a conversation stands that a held briefing can be given back to. */
  brainCurrent: () => boolean;
  releaseHeld: (briefings: ReturnType<SpeechArbiter["takeHeldBriefings"]>) => void;
}

export interface SpeechComposer extends Composer {
  readonly receiver: VoiceReceiver;
  reconcileSpeech: () => Promise<void>;
  withdrawBeat: (kind: OnboardingBeatKind) => void;
  withdrawBriefings: () => void;
  dropBriefings: () => void;
  deliverBriefing: (delivery: BrainDelivery) => Promise<void>;
  requestOnboardingBeat: () => Promise<void>;
  /** The arrival beat's own moment, recorded at the first sign-in ever observed. */
  seedArrivalOnFirstSignIn: () => void;
  link: (links: SpeechLinks) => void;
}

export interface SpeechDependencies {
  kernel: HostKernel;
  settings: SettingsComposer;
  account: AccountComposer;
  calendars: CalendarsComposer;
  observation: ObservationComposer;
}

export function composeSpeech(dependencies: SpeechDependencies): SpeechComposer {
  const { kernel, settings, account, calendars, observation } = dependencies;
  const { runMode, now } = kernel;
  const links = lateRef<SpeechLinks>("the speech composer's links");

  /**
   * The one voice receiver, as the client that owns the voice window reports
   * it: the host mints the epochs, so a claim names an epoch this host issued,
   * and a client's connection closing ends the epoch as its renderer going
   * away would.
   */
  const receiver = new VoiceReceiver();
  const arbiter = new SpeechArbiter({
    now,
    nextId: kernel.createId,
    ...(account.agentTrace
      ? { trace: (record) => account.agentTrace?.recordSpeechDecision(record) }
      : undefined),
  });

  function withdrawBeat(kind: OnboardingBeatKind): void {
    const id = arbiter.retract(kind);
    if (id) kernel.emit(GATEWAY_EVENT.SPEECH_WITHDRAWN, { id });
  }

  function withdrawBriefings(): void {
    const offered = arbiter.withdrawBriefings();
    if (offered) kernel.emit(GATEWAY_EVENT.SPEECH_WITHDRAWN, { id: offered });
    offerNextSpeech();
  }

  /**
   * Hands the mouth the arbiter's head request, if one may be offered now:
   * a ready receiver stands, and a voice to say it with. Synchronous past the
   * quiet's await, so two reconciles landing together cannot each offer.
   */
  function offerNextSpeech(): void {
    if (!receiver.isReady() || !account.voiceCapabilities.realtimeCredentials) return;
    const offer = arbiter.next();
    if (offer) kernel.emit(GATEWAY_EVENT.SPEECH_OFFERED, carried(offer));
  }

  async function reconcileSpeech(): Promise<void> {
    const quiet = await calendars.announcementsQuietNow(now());
    arbiter.setQuiet(quiet);
    if (!quiet && arbiter.heldBriefingCount > 0) {
      if (links.get().brainCurrent() && account.voiceCapabilities.realtimeCredentials) {
        links.get().releaseHeld(arbiter.takeHeldBriefings());
      } else if (!account.voiceCapabilities.realtimeCredentials) {
        arbiter.dropBriefings();
      }
    }
    offerNextSpeech();
  }

  function markFirstAnnouncementSpoken(): void {
    const onboardingState = calendars.onboarding();
    if (!countsFirstAnnouncement(onboardingState)) return;
    const signedInAt = onboardingState?.arrivalSignedInAt;
    const at = now();
    const signedInAtMs = signedInAt !== undefined ? Date.parse(signedInAt) : Number.NaN;
    if (Number.isFinite(signedInAtMs)) {
      settings.recordProductEvent(PRODUCT_EVENT.VOICE_FIRST_ANNOUNCEMENT, {
        sign_in_age: productSignInAge(at - signedInAtMs),
      });
    }
    calendars.writeOnboarding({ arrivalFirstAnnouncementAt: new Date(at).toISOString() });
  }

  function settleSpeech(id: string, outcome: SpeechOutcome): void {
    const settled = arbiter.settle(id, outcome);
    if (!settled) return;
    if (settled.outcome === SPEECH_OUTCOME.SPOKEN) {
      if (settled.kind === BRIEFING_SPEECH_KIND) {
        settings.recordProductEvent(PRODUCT_EVENT.VOICE_ANNOUNCEMENT_SPEAK, {});
        markFirstAnnouncementSpoken();
      }
      if (settled.kind === ARRIVAL_SPEECH_KIND && arrivalBeatOwed(calendars.onboarding())) {
        calendars.writeOnboarding({ arrivalSpokenAt: new Date(now()).toISOString() });
      }
    }
    void reconcileSpeech();
  }

  async function requestOnboardingBeat(): Promise<void> {
    if (!runMode.requiresAccount || !account.signedIn()) return;
    if (!account.voiceCapabilities.realtimeCredentials) return;
    if (await calendars.gateOfferable()) {
      arbiter.request({ kind: CALENDAR_ONBOARDING_SPEECH_KIND });
      void reconcileSpeech();
      return;
    }
    if (!arrivalBeatOwed(calendars.onboarding())) return;
    await observation.loop.refresh().catch(() => undefined);
    if (!account.signedIn() || !arrivalBeatOwed(calendars.onboarding())) return;
    arbiter.request({ kind: ARRIVAL_SPEECH_KIND });
    void reconcileSpeech();
  }

  async function deliverBriefing(delivery: BrainDelivery): Promise<void> {
    if (!account.voiceCapabilities.realtimeCredentials) return;
    arbiter.request({ kind: BRIEFING_SPEECH_KIND, delivery });
    await reconcileSpeech();
  }

  receiver.onReady(() => {
    offerNextSpeech();
    kernel.service().receiverReady();
  });
  receiver.onReset(() => arbiter.reclaimOffer());

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.SPEECH_SETTLE]: (params) => {
      if (!isIdentifier(params.id)) return invalid("id must be a non-empty string");
      if (!isSpeechOutcome(params.outcome)) return invalid("outcome is not one this build knows");
      settleSpeech(params.id, params.outcome);
      return gatewayOk({});
    },
    // The one voice receiver's lifecycle, as the client that owns its window
    // reports it. Begin mints an epoch here and answers it; ready counts only
    // for the epoch it names; reset ends the epoch. The client's connection
    // closing ends it too, so nothing is offered to a renderer nobody can
    // reach.
    [GATEWAY_METHOD.RECEIVER_REPORT]: (params) => {
      switch (params.kind) {
        case RECEIVER_REPORT_KIND.BEGIN:
          return gatewayOk({ epoch: receiver.begin() });
        case RECEIVER_REPORT_KIND.READY:
          if (!isWireNumber(params.epoch)) return invalid("epoch must be a number");
          return gatewayOk({ ready: receiver.markReady(params.epoch) });
        case RECEIVER_REPORT_KIND.RESET:
          receiver.reset();
          return gatewayOk({ epoch: receiver.epoch() });
        default:
          return invalid("kind is not one this build knows");
      }
    },
  };

  return {
    methods,
    receiver,
    reconcileSpeech,
    withdrawBeat,
    withdrawBriefings,
    dropBriefings: () => arbiter.dropBriefings(),
    deliverBriefing,
    requestOnboardingBeat,
    seedArrivalOnFirstSignIn: () => {
      if (calendars.onboarding()?.arrivalSignedInAt !== undefined) return;
      calendars.writeOnboarding({ arrivalSignedInAt: new Date(now()).toISOString() });
    },
    link: (next) => links.set(next),
    start: async () => undefined,
    // The arbiter's briefings are dropped where the meetings holding them are:
    // the calendars composer's own stop, which is where they were held.
    stop: async () => undefined,
  };
}
