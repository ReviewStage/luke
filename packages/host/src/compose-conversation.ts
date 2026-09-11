import { catalogToolSet } from "@sidecar/brain/tool-set";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  gatewayOk,
} from "@sidecar/gateway";
import {
  CONVERSATION_READ_FAILURE,
  type ConversationMessagesAnswer,
  type ConversationReadResult,
  type HostedChangesClient,
  type HostedConversationClient,
} from "@sidecar/hosted";
import { ObservationLoop } from "@sidecar/runtime";
import type { ConversationViewMessage, ConversationViewSnapshot } from "@sidecar/session";
import { readStoredUIMessages } from "@sidecar/session/ui-messages";
import type { AccountComposer } from "./compose-account.js";
import type { DevicesComposer } from "./compose-devices.js";
import type { Composer } from "./composer.js";
import {
  ConversationViewSync,
  type ReadMessagesPage,
  type ReadTurnGroup,
} from "./conversation-view-sync.js";
import type { HostKernel } from "./host-kernel.js";
import type { RunMode } from "./run-mode.js";

/**
 * How often a signed-in Mac asks the service what moved. The change signal
 * is one small read, and the brake behind it admits every device a person
 * owns polling at this pace; a Clear made on another Mac reaches this one
 * within one of these.
 */
const CONVERSATION_POLL_INTERVAL_MS = 5_000;

/**
 * The most pages one poll takes of one resource before leaving the rest for
 * the next. A first read of a long Conversation is bounded by it rather than
 * by the Conversation's length, and the next poll carries on from the cursor
 * the last page handed back.
 */
const MAX_PAGES_PER_POLL = 25;

export interface ConversationComposer extends Composer {
  /** The loop the merge's supervisor enables; the composer never enables it itself. */
  readonly loop: ObservationLoop;
  /** The Conversation as this device holds it now, for the bootstrap. */
  snapshot: () => ConversationViewSnapshot;
  /** Drops everything held, for a sign-out, and tells every client the thread is gone. */
  reset: () => void;
}

/** The service's side of the reads and Clear, as the composer asks it: the client's calls and nothing of its construction. */
export type ConversationReadsClient = Pick<
  HostedConversationClient,
  "messages" | "events" | "turns" | "clear"
>;

/** The change signal's one call, the same client the devices composer restates presence through. */
export type ConversationHeadsClient = Pick<HostedChangesClient, "poll">;

export interface ConversationDependencies {
  kernel: Pick<HostKernel, "report" | "emit"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  devices: Pick<DevicesComposer, "deviceId">;
  heads: ConversationHeadsClient;
  client: ConversationReadsClient;
}

/**
 * The Conversation read from the service, for the panel to draw: the
 * per-resource reads behind cursors of this device's own, folded into one
 * picture and told to every client whenever a poll moved it, and the one
 * write the tab has, Clear, carried to the service's soft delete. Nothing of
 * the local Conversation store is read here; the thread a window draws is the
 * account's, the same on every Mac signed in to it.
 *
 * Each poll asks the change signal, through the same client the devices
 * composer restates presence with, where every resource stands, reads only
 * the resources whose head differs from the cursor held, and pages each to
 * its end under the bound above. Before the device row has registered there
 * is no signal to ask, so the three resources are read directly, each an
 * empty page when nothing moved. A messages page is held to the vocabulary
 * under the brain catalog's own registry before it is folded in — the same
 * registry the service read the rows back under — and the one refusal a read
 * answers with a body, an unreadable row, is surfaced on the snapshot and
 * never drawn as an empty page.
 */
export function composeConversation(dependencies: ConversationDependencies): ConversationComposer {
  const { kernel, account, devices, heads, client } = dependencies;
  const { runMode, report } = kernel;

  const registry = catalogToolSet();
  const sync = new ConversationViewSync();
  let published = sync.revision;

  const gate = () => runMode.sendsNetwork && account.capabilitiesActive();

  function snapshot(): ConversationViewSnapshot {
    const held = sync.snapshot();
    // A run that sends nothing has nothing to wait for: its empty thread is the whole Conversation.
    return runMode.sendsNetwork ? held : { ...held, settled: true };
  }

  function publish(): void {
    if (sync.revision === published) return;
    published = sync.revision;
    kernel.emit(GATEWAY_EVENT.CONVERSATION_VIEW_CHANGED, carried(snapshot()));
  }

  /** Holds a page's rows to the vocabulary under the registry; nothing for a page a row of which the registry refuses. */
  async function readPage(
    answer: ConversationMessagesAnswer,
  ): Promise<ReadMessagesPage | undefined> {
    const groups: ReadTurnGroup[] = [];
    for (const group of answer.groups) {
      const read = await readStoredUIMessages(
        group.messages.map((message) => message.message),
        registry,
      );
      if (!read.ok) {
        report(
          `a Conversation page could not be read under this build's registry: ${read.refusal} at ${read.path.join(".")}`,
        );
        return undefined;
      }
      const messages: ConversationViewMessage[] = group.messages.map((message, index) => {
        const stored = read.value[index];
        if (stored === undefined)
          throw new Error("the registry read answered fewer rows than it took");
        return {
          message: stored,
          seq: message.seq,
          createdAt: message.createdAt,
          tools: message.tools,
        };
      });
      groups.push({
        turnId: group.turnId,
        conversationId: group.conversationId,
        source: group.source,
        ...(group.turn !== undefined ? { turn: group.turn } : undefined),
        messages,
      });
    }
    return { conversations: answer.conversations, groups, next: answer.next };
  }

  /**
   * Pages one resource from the cursor held to its end, under the poll's
   * bound: each page is applied only while the poll still owns the loop, and
   * the one refusal a device acts on, an unreadable row, is written on the
   * picture where the walk stops rather than passed over.
   */
  async function pageResource<Answer extends { readonly hasMore: boolean }>(
    generation: number,
    read: (after: string | undefined) => Promise<ConversationReadResult<Answer>>,
    cursor: () => string | undefined,
    apply: (answer: Answer) => Promise<boolean>,
  ): Promise<void> {
    for (let pages = 0; pages < MAX_PAGES_PER_POLL; pages += 1) {
      const result = await read(cursor());
      if (!loop.isCurrent(generation)) return;
      if (!result.ok) {
        if (result.failure === CONVERSATION_READ_FAILURE.UNREADABLE_ROW) {
          sync.markUnreadable(result.row);
        }
        return;
      }
      if (!(await apply(result.answer)) || !result.answer.hasMore) return;
    }
  }

  const pageMessages = (generation: number) =>
    pageResource(
      generation,
      (after) => client.messages({ after }),
      () => sync.cursors().messages,
      async (answer) => {
        const page = await readPage(answer);
        if (page === undefined || !loop.isCurrent(generation)) return false;
        sync.applyMessages(page);
        return true;
      },
    );

  const pageEvents = (generation: number) =>
    pageResource(
      generation,
      (after) => client.events({ after }),
      () => sync.cursors().events,
      async (answer) => {
        sync.applyEvents(answer.events, answer.next);
        return true;
      },
    );

  const pageTurns = (generation: number) =>
    pageResource(
      generation,
      (after) => client.turns({ after }),
      () => sync.cursors().turns,
      async (answer) => {
        sync.applyTurns(answer.turns, answer.next);
        return true;
      },
    );

  async function poll(generation: number): Promise<void> {
    const deviceId = devices.deviceId();
    // A heads poll names the device and nothing else, so it moves the row's
    // last-seen instant alone and touches neither presence instant the devices
    // composer restates on its own poll.
    const signal = deviceId === undefined ? undefined : await heads.poll({ deviceId });
    if (!loop.isCurrent(generation)) return;
    const cursors = sync.cursors();
    // A signal that could not be had reads everything: each resource answers an empty page when nothing moved.
    const readMessages = signal === undefined || signal.messages !== cursors.messages;
    const readEvents = signal === undefined || signal.events !== cursors.events;
    const readTurns = signal === undefined || signal.turns !== cursors.turns;
    // Messages before turns within a poll, so the turn a group carries is never
    // older than the row the turns resource answered a moment before it.
    if (readMessages) await pageMessages(generation);
    if (readEvents) await pageEvents(generation);
    if (readTurns) await pageTurns(generation);
    if (loop.isCurrent(generation)) publish();
  }

  const loop = new ObservationLoop({
    gate,
    intervalMs: CONVERSATION_POLL_INTERVAL_MS,
    run: poll,
  });

  function reset(): void {
    sync.reset();
    publish();
  }

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.CONVERSATION_CLEAR]: async () => {
      if (!gate()) return gatewayOk({ cleared: false });
      const answer = await client.clear();
      if (answer === undefined) return gatewayOk({ cleared: false });
      // The next read lists the main the Clear opened and not the one it
      // stamped, and the picture drops what the list no longer names; asking
      // for that read now is what empties this Mac's thread without waiting a poll.
      await loop.refresh();
      return gatewayOk({ cleared: true });
    },
  };

  return {
    methods,
    loop,
    snapshot,
    reset,
    start: async () => undefined,
    stop: async () => {
      loop.stop();
    },
  };
}
