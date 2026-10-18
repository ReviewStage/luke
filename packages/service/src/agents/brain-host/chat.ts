import type { DatabaseServices } from "@luke/database/core/query";
import { MEMBER_KIND } from "@luke/features/chat-wire";
import { Effect, Exit, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, type WireRecord } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { logStoreFailure } from "../../http/store-failure.js";
import {
  type ChatAgent,
  type ChatReader,
  type MessageLine,
  peekAsAgent,
  postAsAgent,
  readAsAgent,
  readThroughAsAgent,
  resolveAsAgent,
} from "../coder-host/chat.js";
import type { InboxSandboxDoor } from "../coder-host/inbox-image.js";

/**
 * chat.ts -- the plan's Luke in its workspace's chat: the coding agent's chat tools run as `@luke`, and what Luke has not read as a turn opens.
 *
 * A plan's planner is one member of its workspace's chat, `@luke`, minted
 * the first time it posts or reads, and the planning model speaks as it.
 * Its tools are the coding agent's own (`../coder-host/chat.ts`), run as
 * the plan's Luke: a post goes to the plan's channel unless it names
 * another place, is told to the members it addresses through the door
 * every post goes through, under the call's own id as its key, so a call
 * eve runs again posts once. A turn posts at most `MAX_POSTS_PER_TURN`
 * times, counted in this instance as the turn's searches are
 * (`../public-research.ts`), since a plan conversation's turn runs its calls
 * on the instance that runs the turn. What Luke has not read is read as each
 * turn opens and handed to it (`planning.ts`), and marked read through what
 * the turn was handed once the turn settles, so the next turn is handed only
 * what came after. Note that it is not marked read as the turn opens,
 * because a turn that fails or is stopped never took it in, and the turn
 * after it is handed the same lines again rather than losing them.
 */

/** The most posts of the turns this instance keeps a count for; the oldest is forgotten past it, long after it ended. */
const TRACKED_TURNS = 1_024;

/** The most messages a turn opens with; more waiting is said, and `read_chat` reads them. */
const CHAT_SINCE_MESSAGES = 20;

/** What a turn opens with of the chat: the messages Luke had not read, oldest change first, whether more wait, and the place Luke has read through once the turn settles, where it was handed any. */
export interface ChatSince {
  readonly messages: readonly MessageLine[];
  readonly more: boolean;
  readonly through?: number;
}

/** Nothing unread, as a turn opens with where the chat could not be read. */
const NOTHING_SINCE: ChatSince = { messages: [], more: false };

/** One call's post in a turn: how many runs of it are under way, and whether any of them posted. */
interface CallPost {
  running: number;
  posted: boolean;
}

/**
 * The posts each turn has made, by the call that made each, in this
 * instance. A post is counted before it goes out and let go of where it
 * was refused, because the calls one step makes run at once and each must
 * see the other's. Note that a call eve runs again is counted once and
 * never held to the bound against itself, because its post already
 * stands under its key and the store answers it again; and that a call
 * is let go of only once none of its runs is under way and none posted,
 * because two runs of one call may land differently.
 */
export class ChatPostTally {
  private readonly posts = new Map<string, Map<string, CallPost>>();

  /** Counts a run of the call's post for the turn, answering how many other calls' posts the turn holds. */
  reserve(turnId: string, callId: string): number {
    const calls = this.posts.get(turnId) ?? new Map<string, CallPost>();
    this.posts.delete(turnId);
    this.posts.set(turnId, calls);
    const oldest = this.posts.keys().next();
    if (this.posts.size > TRACKED_TURNS && !oldest.done) this.posts.delete(oldest.value);
    const call = calls.get(callId) ?? { running: 0, posted: false };
    call.running += 1;
    calls.set(callId, call);
    return calls.size - 1;
  }

  /** Settles a run of the call's post: kept where any run posted, let go of once none is under way and none did. */
  settle(turnId: string, callId: string, posted: boolean): void {
    const calls = this.posts.get(turnId);
    const call = calls?.get(callId);
    if (calls === undefined || call === undefined) return;
    call.running -= 1;
    call.posted ||= posted;
    if (call.running === 0 && !call.posted) calls.delete(callId);
  }
}

/** What one of Luke's chat calls runs under: Luke on the plan, as it posts and is told, the call's key and turn, the turn's count, and the session's sandbox, where a post's pictures are read. */
export interface BrainChatCall {
  readonly luke: ChatAgent;
  readonly clientKey: string;
  readonly turnId: string;
  readonly tally: ChatPostTally;
  readonly sandbox: InboxSandboxDoor;
}

/** What a chat call reaches: the store, and GitHub and eve for a notice steered into a coding agent's session. */
type BrainChatServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

/** The plan's Luke as the account reaches the chat. */
export function lukeOn(userId: string, planId: string): ChatReader {
  return { userId, planId, self: { kind: MEMBER_KIND.LUKE, planId } };
}

/** Runs one post as Luke, counted against the turn's bound, and let go of the count where it was refused. */
export function runBrainPost(
  call: BrainChatCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, BrainChatServices> {
  return Effect.suspend(() => {
    const { turnId, clientKey } = call;
    const others = call.tally.reserve(turnId, clientKey);
    const posting = { clientKey, postsInTurn: others, sandbox: call.sandbox };
    // Settled however the run ends, an interrupted one included, so no run holds a count it never posted.
    return postAsAgent(call.luke, input, posting).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() =>
          call.tally.settle(
            turnId,
            clientKey,
            Exit.isSuccess(exit) && exit.value.status === ACTION_RESULT_STATUS.ACCEPTED,
          ),
        ),
      ),
      Effect.map((answer) => ({ ...answer })),
    );
  });
}

/** Runs one read as Luke. */
export function runBrainRead(
  call: BrainChatCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.map(readAsAgent(call.luke, input), (answer) => ({ ...answer }));
}

/** Runs one resolve of an ask of Luke's. */
export function runBrainResolve(
  call: BrainChatCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.map(resolveAsAgent(call.luke, input), (answer) => ({ ...answer }));
}

/**
 * What Luke had not read, marking nothing, for the turn opening now: at
 * most `CHAT_SINCE_MESSAGES`, and the place the turn has read through once
 * it settles. Note that a chat that could not be read opens the turn with
 * nothing of it, logged, rather than failing the turn, because the plan's
 * document and board are what a turn cannot run without.
 */
export function chatSince(
  userId: string,
  planId: string,
): Effect.Effect<ChatSince, never, DatabaseServices> {
  return peekAsAgent(lukeOn(userId, planId), CHAT_SINCE_MESSAGES).pipe(
    Effect.map(
      Option.match({
        onNone: () => NOTHING_SINCE,
        onSome: ({ messages, more, through }) =>
          messages.length === 0 ? NOTHING_SINCE : { messages, more, through },
      }),
    ),
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => NOTHING_SINCE),
  );
}

/** Marks what a settled turn was handed as read by Luke, through the place it was handed; a write that fails is logged, and the next turn is handed the lines again. */
export function chatTakenIn(
  userId: string,
  planId: string,
  through: number,
): Effect.Effect<void, never, DatabaseServices> {
  return readThroughAsAgent(lukeOn(userId, planId), through).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => undefined),
  );
}
