import type { ChatAnswer, ChatChannel } from "@luke/features/chat-wire";
import type { MentionPlace } from "@luke/features/mention-link";
import type { TaskSummary } from "@luke/features/task-wire";
import type { Actor } from "@luke/ui/actor-model";
import { type ChatNames, chatMentionables, toldPastBound } from "@luke/ui/chat-model";
import { useMemberDirectory } from "../member-directory.js";
import type { ChatComposerMentions } from "./chat-composer.js";
import type { MentionablePullRequest, MentionMembers, MentionSource } from "./mention-picker.js";
import { NO_TASK, type TaskMentionsValue, useTaskMentions } from "./task-mentions.js";

/**
 * chat-mention-source.ts -- what a chat box's `@` and `#` offer through the app's one mention list: the members a mention in its channel tells, the channel's task, and the channels.
 *
 * A chat message mentions as every box of the app does (`mention-picker.tsx`),
 * but a mention there tells the member it names, so the list is handed the
 * people and agents a post in the channel reaches (`chat-model.ts`'s
 * `chatMentionables`), each drawn as the window draws them (`chat-actors.ts`),
 * a person said by their email where the workspace's members read names it.
 * A task's channel offers its task beside them: on the plan's own page, the
 * plan's saved sections and its agents' pull requests, as its agents' boxes
 * offer them (`task-mentions.tsx`); in the window's Chat, the task as the task
 * list holds it, its sections unknown there. Either offers the task's
 * repository's files where it names one. A member, a task, and a pull request
 * are written as their links, so none is offered before the workspace those
 * are written in is known; a date names no workspace, and a channel is
 * written as its word.
 */

/** The members of a box before the workspace is known: none, since a member is written as their link alone. */
const NO_MEMBERS: MentionMembers = { people: [], agents: [] };

/** The pull requests a task's row names, as an `@` list offers them: each with an address, labelled by the agent that opened it. */
function summaryPullRequests(
  task: TaskSummary,
  names: ChatNames,
): readonly MentionablePullRequest[] {
  return (task.agents?.pullRequests ?? []).flatMap((line) => {
    if (line.url === undefined) return [];
    const agent = line.agentId === undefined ? undefined : names.agents.get(line.agentId);
    return [
      {
        number: line.number,
        title: line.title,
        url: line.url,
        state: line.state,
        checks: line.checks,
        agent: agent?.personaName ?? agent?.title ?? undefined,
      },
    ];
  });
}

/**
 * What an `@` in the channel offers beside its members: a task's channel
 * its task, from the plan's own page where the box stands on it, else as the
 * task list holds it; any other channel, or one before the workspace is
 * known, no task, which leaves the dates.
 */
function sourceIn(
  channel: ChatChannel | undefined,
  place: MentionPlace | undefined,
  page: TaskMentionsValue | undefined,
  tasks: readonly TaskSummary[],
  names: ChatNames,
): MentionSource {
  const workspace = place?.workspace ?? "";
  const none: MentionSource = {
    taskId: NO_TASK,
    taskName: "",
    workspace,
    repository: null,
    text: () => "",
  };
  const planId = place === undefined ? undefined : channel?.planId;
  if (planId === undefined) return none;
  if (page?.taskId === planId) {
    const { taskName, repository, text, pullRequests } = page;
    return { taskId: planId, taskName, workspace, repository, text, pullRequests };
  }
  const task = tasks.find((each) => each.id === planId);
  if (task === undefined) return none;
  return {
    taskId: planId,
    taskName: task.name,
    workspace,
    repository: task.repository,
    text: () => "",
    pullRequests: summaryPullRequests(task, names),
  };
}

/**
 * What a chat box posting in a channel offers, by the channel's id and, for
 * a reply, the members of its thread: the members a mention there tells,
 * the channel's task, the channels, and whether a post of the words would
 * address more members than a post tells.
 */
export function useChatMentions({
  chat,
  names,
  place,
  tasks,
  actorOf,
}: {
  chat: ChatAnswer;
  names: ChatNames;
  /** The workspace a mention is written in; none where it is not known yet. */
  place: MentionPlace | undefined;
  /** The tasks the window lists, a task's channel's among them. */
  tasks: readonly TaskSummary[];
  /** The actor a member is drawn as, by the member's id (`chat-actors.ts`). */
  actorOf: (memberId: string) => Actor;
}): (channelId: string, thread?: readonly string[]) => ChatComposerMentions {
  const page = useTaskMentions();
  const { members: read } = useMemberDirectory();
  return (channelId, thread) => {
    const channel = chat.channels.find((each) => each.id === channelId);
    const offered = chatMentionables(chat, names, channel);
    const members: MentionMembers =
      place === undefined
        ? NO_MEMBERS
        : {
            people: offered.people.map((person) => {
              const member = read?.find((each) => each.userId === person.userId);
              return {
                userId: person.userId,
                name: member?.name ?? person.name,
                email: member?.email,
                actor: actorOf(person.memberId),
              };
            }),
            agents: offered.agents.map((agent) => ({
              id: agent.agentId,
              name: agent.name,
              actor: actorOf(agent.memberId),
              task: agent.task,
            })),
          };
    return {
      source: sourceIn(channel, place, page, tasks, names),
      members,
      channels: offered.channels,
      crowded: (text) => channel !== undefined && toldPastBound(chat, channel, text, thread),
    };
  };
}
