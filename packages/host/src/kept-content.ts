import type { AgentGitHubImageView, AgentInboxAttachmentView } from "@repo/features/agent-view";
import { PAGE_OWNER, type PageOwner } from "@repo/features/page-wire";
import type {
  TasksFileAnswer,
  TasksPageAnswer,
  TasksPictureAnswer,
} from "@repo/features/tasks-view";
import { Data, Effect, MutableHashMap, Option } from "effect";

export const KEPT_CONTENT_CHARACTERS = 32 * 1024 * 1024;

const KEPT_SHARE = 4;

export const KEPT_KIND = {
  AGENT_PICTURE: "agent-picture",
  INBOX_ATTACHMENT: "inbox-attachment",
  DESCRIPTION_PICTURE: "description-picture",
  PAGE_VERSION: "page-version",
  FILE_AT_COMMIT: "file-at-commit",
  GITHUB_IMAGE: "github-image",
} as const;

export class AgentPictureKey extends Data.TaggedClass(KEPT_KIND.AGENT_PICTURE)<{
  readonly agentId: string;
  readonly pictureId: string;
  readonly callId: string | undefined;
}> {}

export class InboxAttachmentKey extends Data.TaggedClass(KEPT_KIND.INBOX_ATTACHMENT)<{
  readonly itemId: string;
  readonly attachmentId: string;
}> {}

export class DescriptionPictureKey extends Data.TaggedClass(KEPT_KIND.DESCRIPTION_PICTURE)<{
  readonly planId: string;
  readonly attachmentId: string;
}> {}

export class PageVersionKey extends Data.TaggedClass(KEPT_KIND.PAGE_VERSION)<{
  readonly ownerKind: PageOwner["kind"];
  readonly ownerId: string;
  readonly pageId: string;
  readonly version: number;
}> {}

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

type Carrying<Answer> = Exclude<
  Answer,
  { readonly failure: unknown } | { readonly refusal: unknown }
>;

interface KeptAnswers {
  readonly [KEPT_KIND.AGENT_PICTURE]: Carrying<AgentInboxAttachmentView>;
  readonly [KEPT_KIND.INBOX_ATTACHMENT]: Carrying<AgentInboxAttachmentView>;
  readonly [KEPT_KIND.DESCRIPTION_PICTURE]: Carrying<TasksPictureAnswer>;
  readonly [KEPT_KIND.PAGE_VERSION]: Carrying<TasksPageAnswer>;
  readonly [KEPT_KIND.FILE_AT_COMMIT]: Carrying<TasksFileAnswer>;
  readonly [KEPT_KIND.GITHUB_IMAGE]: Carrying<AgentGitHubImageView>;
}

export type KeptAnswer<Key extends KeptKey> = KeptAnswers[Key["_tag"]];

interface Entry {
  readonly answer: KeptAnswers[keyof KeptAnswers];
  readonly characters: number;
}

export interface KeptContent {
  readonly answer: <Key extends KeptKey, Answer>(
    key: Key,
    accountId: () => string | undefined,
    ask: Effect.Effect<Answer>,
    carries: (answer: Answer) => KeptAnswer<Key> | undefined,
  ) => Effect.Effect<Answer | KeptAnswer<Key>>;
  readonly forget: (which: (key: KeptKey) => boolean) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
}

function charactersOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (typeof value !== "object" || value === null) return 0;
  let characters = 0;
  for (const each of Object.values(value)) characters += charactersOf(each);
  return characters;
}

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

export function keptContent(budget: number): Effect.Effect<KeptContent> {
  return Effect.sync(() => {
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
          if (found !== undefined) return found as KeptAnswer<typeof key>;
          const answer = yield* ask;
          const content = carries(answer);
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
