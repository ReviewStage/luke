import type { AgentGitHubImageView, AgentInboxAttachmentView } from "@repo/features/agent-view";
import { PAGE_OWNER, type PageOwner } from "@repo/features/page-wire";
import type {
  TasksFileAnswer,
  TasksPageAnswer,
  TasksPictureAnswer,
} from "@repo/features/tasks-view";
import { Data, Effect, MutableHashMap, Option } from "effect";

/**
 * kept-content.ts -- content the service answers under a key it never changes under, kept in this process alone so a thing shown again asks the service nothing.
 *
 * A picture a tool answered an agent, an inbox item's attachment, a plan's
 * picture or a comment's file, a page's version, a file of a repository read
 * at a commit, and an image of a pull request that is an upload or a file at
 * a commit are each read once per account and answered from here after
 * that: in another window, after a window reloads, or in the desktop's page
 * frame. Only an answer that carries content is kept, never a failure, a
 * refusal, or a not-found. The answers are kept most recently read last,
 * within a budget of characters handed in, the least recently read let go
 * first; one past a quarter of the budget is answered but not kept, so no
 * one answer empties the rest. Everything kept is the one account's it was
 * read for, and is let go as soon as another account asks or keeps. Nothing
 * here reaches app state, disk, a trace, a counted event, or a fixture.
 */

/**
 * How many characters every answer kept comes to at most: 32 MB, since
 * base64 and source text are a byte a character in the engine's one-byte
 * strings. Note that one figure covers every kind, because what was shown
 * last is what is shown again, whatever it is. It is half the panel's own
 * picture cache, and on the web, where the host runs in the tab beside the
 * panel, the two together stay under 100 MB.
 */
export const KEPT_CONTENT_CHARACTERS = 32 * 1024 * 1024;

/** How much of the budget one answer may take; one past it is answered but not kept. */
const KEPT_SHARE = 4;

/** The kinds of content kept, one for each act that reads it. */
export const KEPT_KIND = {
  AGENT_PICTURE: "agent-picture",
  INBOX_ATTACHMENT: "inbox-attachment",
  DESCRIPTION_PICTURE: "description-picture",
  PAGE_VERSION: "page-version",
  FILE_AT_COMMIT: "file-at-commit",
  GITHUB_IMAGE: "github-image",
} as const;

/** A picture a tool answered an agent, or one of its workers where `callId` names the delegation call that started it; a picture is named by a hash of its bytes. */
export class AgentPictureKey extends Data.TaggedClass(KEPT_KIND.AGENT_PICTURE)<{
  readonly agentId: string;
  readonly pictureId: string;
  readonly callId: string | undefined;
}> {}

/** An attachment of an inbox item, a row of its own; it names no agent or task, so it goes only by age, at a sign-out, or under another account. */
export class InboxAttachmentKey extends Data.TaggedClass(KEPT_KIND.INBOX_ATTACHMENT)<{
  readonly itemId: string;
  readonly attachmentId: string;
}> {}

/** A picture of a plan, or a file one of its comments carries: each upload is given an id of its own. */
export class DescriptionPictureKey extends Data.TaggedClass(KEPT_KIND.DESCRIPTION_PICTURE)<{
  readonly planId: string;
  readonly attachmentId: string;
}> {}

/** One version of a page, of a task or of an agent on no task: a version is never written again. */
export class PageVersionKey extends Data.TaggedClass(KEPT_KIND.PAGE_VERSION)<{
  readonly ownerKind: PageOwner["kind"];
  readonly ownerId: string;
  readonly pageId: string;
  readonly version: number;
}> {}

/**
 * A file of a repository read at a commit, by the task whose repository it
 * is, or by the workspace and the repository where no task names it: a
 * window of its lines, or none where it was read raw, whole.
 */
export class FileAtCommitKey extends Data.TaggedClass(KEPT_KIND.FILE_AT_COMMIT)<{
  readonly taskId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly repository: string | undefined;
  readonly path: string;
  readonly ref: string;
  readonly raw: boolean;
  readonly firstLine: number | undefined;
  readonly lastLine: number | undefined;
}> {}

/** An image of an agent's pull request, by the address GitHub's rendering spelled, where it names an upload or a file at a commit. */
export class GitHubImageKey extends Data.TaggedClass(KEPT_KIND.GITHUB_IMAGE)<{
  readonly agentId: string;
  readonly src: string;
}> {}

export type KeptKey =
  | AgentPictureKey
  | InboxAttachmentKey
  | DescriptionPictureKey
  | PageVersionKey
  | FileAtCommitKey
  | GitHubImageKey;

/** An answer that carries content: never why there is none. */
type Carrying<Answer> = Exclude<
  Answer,
  { readonly failure: unknown } | { readonly refusal: unknown }
>;

/** What is kept under each kind's key. */
interface KeptAnswers {
  readonly [KEPT_KIND.AGENT_PICTURE]: Carrying<AgentInboxAttachmentView>;
  readonly [KEPT_KIND.INBOX_ATTACHMENT]: Carrying<AgentInboxAttachmentView>;
  readonly [KEPT_KIND.DESCRIPTION_PICTURE]: Carrying<TasksPictureAnswer>;
  readonly [KEPT_KIND.PAGE_VERSION]: Carrying<TasksPageAnswer>;
  readonly [KEPT_KIND.FILE_AT_COMMIT]: Carrying<TasksFileAnswer>;
  readonly [KEPT_KIND.GITHUB_IMAGE]: Carrying<AgentGitHubImageView>;
}

/** What is kept under a key of one kind. */
export type KeptAnswer<Key extends KeptKey> = KeptAnswers[Key["_tag"]];

interface Entry {
  readonly answer: KeptAnswers[keyof KeptAnswers];
  readonly characters: number;
}

/** The content kept for one account, the least recently read first. */
export interface KeptContent {
  /**
   * What is kept under `key` for the account signed in, which counts as its
   * most recent read, or, where nothing is, what `ask` answers, kept where
   * `carries` finds content in it and the account that asked is still the
   * one signed in. Nothing is answered from here or kept while nobody is.
   */
  readonly answer: <Key extends KeptKey, Answer>(
    key: Key,
    accountId: () => string | undefined,
    ask: Effect.Effect<Answer>,
    carries: (answer: Answer) => KeptAnswer<Key> | undefined,
  ) => Effect.Effect<Answer | KeptAnswer<Key>>;
  /** Lets go of everything kept under a key the predicate names. */
  readonly forget: (which: (key: KeptKey) => boolean) => Effect.Effect<void>;
  /** Lets go of everything kept, as a sign-out does. */
  readonly clear: Effect.Effect<void>;
}

/** How many characters the strings of an answer come to, which is what it weighs, so nothing is encoded again to weigh it. */
function charactersOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (typeof value !== "object" || value === null) return 0;
  let characters = 0;
  for (const each of Object.values(value)) characters += charactersOf(each);
  return characters;
}

/** Whether a key names content of the agent: its pictures and its workers', its pull request's images, and the pages it owns on no task. */
export function keptOfAgent(agentId: string): (key: KeptKey) => boolean {
  return (key) => {
    switch (key._tag) {
      case KEPT_KIND.AGENT_PICTURE:
      case KEPT_KIND.GITHUB_IMAGE:
        return key.agentId === agentId;
      case KEPT_KIND.PAGE_VERSION:
        return key.ownerKind === PAGE_OWNER.AGENT && key.ownerId === agentId;
      default:
        return false;
    }
  };
}

/** Whether a key names content of the task: its plan's pictures and its comments' files, its pages, and the files read through it. */
export function keptOfTask(taskId: string): (key: KeptKey) => boolean {
  return (key) => {
    switch (key._tag) {
      case KEPT_KIND.DESCRIPTION_PICTURE:
        return key.planId === taskId;
      case KEPT_KIND.PAGE_VERSION:
        return key.ownerKind === PAGE_OWNER.TASK && key.ownerId === taskId;
      case KEPT_KIND.FILE_AT_COMMIT:
        return key.taskId === taskId;
      default:
        return false;
    }
  };
}

/** The content kept, within `budget` characters in all. */
export function keptContent(budget: number): Effect.Effect<KeptContent> {
  return Effect.sync(() => {
    // Note that the map iterates in the order its keys were set, so a key set again on each read stands last, and the first stands least recently read.
    const kept = MutableHashMap.empty<KeptKey, Entry>();
    let account: string | undefined;
    let characters = 0;

    const remove = (key: KeptKey) => {
      const found = MutableHashMap.get(kept, key);
      if (Option.isNone(found)) return;
      MutableHashMap.remove(kept, key);
      characters -= found.value.characters;
    };
    const empty = () => {
      MutableHashMap.clear(kept);
      characters = 0;
      account = undefined;
    };
    /** Lets go of everything kept where it is another account's, so a switch of account never answers the last one's content. */
    const keptFor = (userId: string) => {
      if (account === userId) return;
      empty();
      account = userId;
    };

    const recall = (key: KeptKey, userId: string) => {
      keptFor(userId);
      const found = MutableHashMap.get(kept, key);
      if (Option.isNone(found)) return undefined;
      MutableHashMap.remove(kept, key);
      MutableHashMap.set(kept, key, found.value);
      return found.value.answer;
    };
    const keep = (key: KeptKey, userId: string, answer: Entry["answer"]) => {
      keptFor(userId);
      remove(key);
      const weight = charactersOf(answer);
      if (weight > budget / KEPT_SHARE) return;
      MutableHashMap.set(kept, key, { answer, characters: weight });
      characters += weight;
      // The least recently read are let go first, until what is kept fits the budget again.
      const oldest: KeptKey[] = [];
      let over = characters - budget;
      for (const [each, entry] of kept) {
        if (over <= 0) break;
        oldest.push(each);
        over -= entry.characters;
      }
      for (const each of oldest) remove(each);
    };

    return {
      answer: (key, accountId, ask, carries) =>
        Effect.gen(function* () {
          const userId = accountId();
          if (userId === undefined) return yield* ask;
          const found = recall(key, userId);
          // SAFETY: `keep` is the one writer, and the one call keeping under a key is typed by its kind, so what is kept under it is that kind's answer.
          if (found !== undefined) return found as KeptAnswer<typeof key>;
          const answer = yield* ask;
          const content = carries(answer);
          // Note that an answer that lands after its account signed out is not kept, so nothing outlives the sign-out.
          if (content !== undefined && accountId() === userId) keep(key, userId, content);
          return answer;
        }),
      forget: (which) =>
        Effect.sync(() => {
          for (const key of Array.from(MutableHashMap.keys(kept)).filter(which)) remove(key);
        }),
      clear: Effect.sync(empty),
    };
  });
}
