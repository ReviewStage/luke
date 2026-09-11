import {
  type BriefingDelivery,
  type LiveSessionOpened,
  LiveSessionService,
  type LiveSessionServiceOptions,
  type LiveSessionSource,
} from "@sidecar/voice/live-session";
import { eq } from "drizzle-orm";
import { voiceSessions } from "../db/voice-schema.js";
import type { EveSessions } from "../hosted/brain-host/eve-sessions.js";
import { CATALOG_TOOL_SET } from "../hosted/brain-tool-set.js";
import { askRecord } from "../hosted/store/asks.js";
import type { HostedStoreContext } from "../hosted/store/database.js";
import {
  type HostedStore,
  hostedStore,
  type VoiceTarget,
  voiceWriter,
} from "../hosted/store/index.js";
import type { StoreWriter } from "../hosted/store/writer.js";
import { type HostedLiveBrain, hostedLiveBrain } from "./live-brain.js";
import {
  type HostedBriefingDelivery,
  type HostedBriefings,
  hostedBriefings,
} from "./live-briefings.js";
import { hostedLiveRecord } from "./live-record.js";
import { observedSideband } from "./live-sideband.js";

/**
 * The live session service composed for the hosted tier, for one account's
 * one live session: the brain answered in process through the ask door under
 * the eve client the caller composed for the account, the record over the voice writer with the
 * sideband observed so the writer sees each event once ahead of the service,
 * and the briefings claimed as the session's device before they are spoken.
 * Everything of the store arrives as one context — the database, the runner,
 * and the key ring — so the writers, the ask record, and the reads hold one
 * client over one database. The session itself is still the caller's: the
 * source handed in is what creates and attaches it, and nothing here attaches
 * the composition to the sessions route, which is the desktop cutover's, by
 * build. The account's quiet is not this composition's: a held offer is
 * `speech.held` on the record and never open here, so the service's own hold
 * stands empty and releases nothing.
 */

export interface HostedLiveExchangeOptions {
  /** The account the session was opened for, resolved at the handshake; the deployment acts for it at eve's door. */
  readonly userId: string;
  readonly liveSessionId: string;
  /** The account's standing main, which the spoken asks and the record land in. */
  readonly conversationId: string;
  readonly context: HostedStoreContext;
  /** The store writer over the catalog, which the voice writer and the speech claim write through. */
  readonly writer: StoreWriter;
  /**
   * eve as the deployment reaches it for this account: `eveSessions` under
   * `EVE_CALLER.DEPLOYMENT` with the deployment's secret and this account,
   * composed by the caller, so neither the secret nor eve's origin enters
   * here and a test hands in a fake.
   */
  readonly eve: EveSessions;
  readonly source: () => LiveSessionSource | undefined;
  readonly conversationEntries: LiveSessionServiceOptions<BriefingDelivery>["conversationEntries"];
  readonly rosterView: () => string;
  readonly emit: LiveSessionServiceOptions<BriefingDelivery>["emit"];
  readonly now: () => number;
  readonly schedule: LiveSessionServiceOptions<BriefingDelivery>["schedule"];
  readonly cancel: LiveSessionServiceOptions<BriefingDelivery>["cancel"];
  readonly createId: () => string;
  readonly report: (message: string) => void;
  readonly trace?: LiveSessionServiceOptions<BriefingDelivery>["trace"];
}

export interface HostedLiveExchange {
  readonly service: LiveSessionService<HostedBriefingDelivery>;
  readonly brain: HostedLiveBrain;
  readonly briefings: HostedBriefings;
  readonly store: HostedStore;
  /** Ends the follows and the briefing look, then closes the session gracefully. */
  stop(): Promise<void>;
}

export function hostedLiveExchange(options: HostedLiveExchangeOptions): HostedLiveExchange {
  const { userId, liveSessionId, conversationId, context, writer, report } = options;
  const store = hostedStore(context);
  const target: VoiceTarget = {
    userId,
    liveSessionId,
    conversation: { userId, conversationId },
  };
  const voice = voiceWriter({ run: context.run, store: writer });
  const record = hostedLiveRecord({ writer: voice, target });
  const brain = hostedLiveBrain({
    userId,
    conversationId,
    asks: {
      run: context.run,
      asks: askRecord(context.run),
      eve: options.eve,
      now: options.now,
    },
    store,
    rosterView: options.rosterView,
    report,
  });

  /** The device the session's row names now, read at each look so a row completed after creation is seen. */
  async function deviceId(): Promise<string | undefined> {
    const [row] = await context.db
      .select({ deviceId: voiceSessions.deviceId })
      .from(voiceSessions)
      .where(eq(voiceSessions.liveSessionId, liveSessionId));
    return row?.deviceId ?? undefined;
  }

  const briefings = hostedBriefings({
    userId,
    speech: { run: context.run, writer },
    offers: store.speech,
    tools: CATALOG_TOOL_SET,
    deviceId,
    deliver: (delivery) => service.deliverBriefing(delivery),
    now: options.now,
    report,
  });

  /** The source with the record listening ahead of the service on every session it opens. */
  const source = (): LiveSessionSource | undefined => {
    const inner = options.source();
    if (!inner) return undefined;
    return {
      ...inner,
      create: async (input) => {
        const opened = await inner.create(input);
        if (!opened) return undefined;
        const observed: LiveSessionOpened = {
          ...opened,
          attach: async () =>
            observedSideband(await opened.attach(), (event) => {
              void record.observe(event).then(
                (result) => {
                  if (!result.ok) report(`The record refused a live event: ${result.refusal}`);
                },
                (error: Error) =>
                  report(`The record could not take a live event: ${error.message}`),
              );
            }),
        };
        return observed;
      },
    };
  };

  const service = new LiveSessionService<HostedBriefingDelivery>({
    source,
    brain,
    record,
    conversationEntries: options.conversationEntries,
    quietNow: async () => false,
    releaseHeldBriefings: () => undefined,
    emit: options.emit,
    now: options.now,
    schedule: options.schedule,
    cancel: options.cancel,
    createId: options.createId,
    report,
    ...(options.trace ? { trace: options.trace } : undefined),
    onBriefingAppend: (delivery, eventId) =>
      voice.noteAppend(target, { clientEventId: eventId, messageId: delivery.claim.messageId }),
  });

  return {
    service,
    brain,
    briefings,
    store,
    async stop() {
      brain.stop();
      briefings.stop();
      await service.stop();
    },
  };
}
