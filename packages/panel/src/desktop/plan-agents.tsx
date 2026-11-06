import type { AgentPullRequest } from "@repo/features/agent-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import {
  GAP,
  GROUP_HEADING,
  GroupHeader,
  Inline,
  LIST_DENSITY,
  List,
  ListRow,
  RowHint,
  RowHintOptions,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { agentTab, isAgentTab, sameTab } from "@repo/ui/tab-strip-model";
import { agentStillWriting } from "../tasks/agent-model.js";
import { agentSubject } from "../tasks/agent-ref.js";
import { useChangesPeople } from "../tasks/changes-people.js";
import { NEEDS_YOU, threadsWaitingWords } from "../tasks/inbox-model.js";
import { PullRequestCard, peopleOf } from "../tasks/pull-request-card.js";
import { PullRequestChip } from "../tasks/pull-request-chip.js";
import { RunsOnPlace } from "../tasks/runs-on.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { openerOf } from "../tasks/use-link-standing.js";
import type { MainTabsControl } from "../tasks/use-main-tabs.js";
import type { MenuAction } from "./action-menu.js";
import { SUMMARY_GLYPH } from "./agent-archive.js";
import { agentEntries } from "./main-tabs.js";
import type { AddEntry, HeldTranscripts } from "./strip-tabs.js";
import { WaitingCount } from "./task-row-parts.js";

/**
 * plan-agents.tsx -- the open task's agents at the head of its description, as a group: one dense row each, its tab's glyph and name, where it runs, its failure where it failed, and its pull request.
 *
 * The agents stand under a group head, Agents and how many, which folds
 * them, folded where the page asks, the same shape every group of
 * the head takes, a `GroupHeader` over a dense `List`. Each row is the
 * task's agent as its "+" row and the summary draw it (`agentEntries`): its
 * tab's glyph, which gives way to the working mark while it works, its
 * tab's name, where it runs (`runs-on.tsx`), Cloud or the device, each
 * agent's own, the failed mark at its end once its
 * turn failed, and the card its tab hangs. Its pull request, where it opened
 * one, stands after it as a chip of GitHub's mark in GitHub's color for
 * where it stands and its number (`pull-request-chip.tsx`), hanging the
 * pull request's one card as its Pull request tab does, the agent whose it
 * is and who it names among what the card says (`pull-request-card.tsx`).
 * A row's press is the page's to answer (`onOpenAgent`): the side panel's
 * plan opens the agent as its tab's own press does. The chip opens the pull
 * request as the agent's own pull request chip does, in its Pull request
 * tab; it is still a link to its page, so a right-click offers its address.
 * An agent with threads waiting on the developer counts them at its end,
 * before where it runs, in the orange figure its tab and the sidebar's
 * Inbox row draw (`WaitingCount`), so a task opened on its plan says which
 * agent waits and on how much; the threads themselves, titles and all, are
 * the Inbox's to say, so the row stays one dense line.
 * Those agents come first, then those at work, then the newest started; an
 * archived agent is not listed. New agent follows them at every width, as
 * the strip's "+" offers it (`newAgentStarts`), so the group stands even on a
 * task with no agent, a fresh plan's one next step; a task that starts none
 * of its own, an archived or a pilot one, with no agent, draws no group.
 *
 * On a phone, Overview is the task's one page, with no strip, summary, or
 * Inbox tab beside it (`task-pane-switcher.tsx`), so the group holds the rest
 * of what those offer: the agents' read again where it never landed, the
 * archived agents folded under them as the summary folds them
 * (`ArchivedAgents`), and, after the group, the task's Inbox counting what
 * waits on the developer that no listed agent's row marks already, such as
 * an archived agent's thread, only while something does.
 */

/** A phone's additions to the group; see the module's head. */
interface PlanAgentsPhone {
  /** The archived agents' fold (`ArchivedAgents`), which draws nothing while none is archived. */
  readonly archived: React.ReactNode;
  /** Opens the window's Inbox narrowed to the task. */
  readonly onOpenInbox: () => void;
}

/** What the group is called, and its list for a reader moving between lists. */
const AGENTS_LIST = "Agents";

/** What the group's count counts, said to a reader beside the figure. */
const AGENTS_NOUN = { one: "agent", many: "agents" } as const;

/** The agents in the order the list draws them: those waiting on the developer first, then those still writing, then the newest started, each group's order otherwise kept. */
function listedOrder(
  entries: readonly AddEntry[],
  waiting: ReadonlyMap<string, readonly InboxItem[]>,
): readonly AddEntry[] {
  const waits = (entry: AddEntry) => waiting.has(entry.row.id);
  const writing = (entry: AddEntry) =>
    entry.agent !== undefined && agentStillWriting(entry.agent.status);
  const started = (entry: AddEntry) => entry.agent?.createdAt ?? 0;
  return entries.toSorted(
    (a, b) =>
      Number(waits(b)) - Number(waits(a)) ||
      Number(writing(b)) - Number(writing(a)) ||
      started(b) - started(a),
  );
}

/** One agent's row: its tab's look, how many of its threads wait on the developer, where it runs, its failed mark, and its pull request's chip where it opened one. */
function PlanAgentRow({
  entry,
  waits,
  pullRequest,
  agents,
  held,
  tab,
  onOpenPullRequest,
}: {
  entry: AddEntry;
  /** How many of its threads wait on the developer. */
  waits: number;
  pullRequest: AgentPullRequest | undefined;
  agents: AgentsControl;
  held: HeldTranscripts;
  tab: MainTabsControl["tab"];
  onOpenPullRequest: () => void;
}): React.JSX.Element {
  const { row, endMark, card } = entry;
  const agentId = row.id;
  const chosen = tab !== undefined && sameTab(agentTab(agentId), tab);
  const changesPeople = useChangesPeople(pullRequest === undefined ? undefined : agentId);
  const people = pullRequest === undefined ? undefined : peopleOf(changesPeople, pullRequest);
  return (
    <RowHintOptions card={card}>
      <ListRow
        motionKey={row.id}
        leading={<span className={SUMMARY_GLYPH}>{row.icon}</span>}
        title={<ReplayMask>{row.label}</ReplayMask>}
        hint={card === undefined ? undefined : { Hint: RowHint, label: row.label }}
        meta={
          <Inline gap={GAP.ITEM} wrap={false}>
            <WaitingCount count={waits} />
            <ReplayMask>
              {entry.agent === undefined ? null : (
                <RunsOnPlace agent={entry.agent} devices={agents.macs} />
              )}
              {endMark}
            </ReplayMask>
          </Inline>
        }
        actions={
          pullRequest === undefined ? undefined : (
            <ReplayMask>
              <PullRequestChip
                pullRequest={pullRequest}
                card={
                  <PullRequestCard
                    pullRequest={pullRequest}
                    place={{ taskId: entry.agent?.planId ?? null }}
                    lines={pullRequest}
                    files={pullRequest.changedFiles}
                    opener={people?.author ?? openerOf(pullRequest)}
                    agent={{
                      subject: agentSubject(agents, agentId, held, chosen),
                      models: agents.models,
                      onOpen: entry.onPick,
                    }}
                    reviewers={people?.reviewers}
                  />
                }
                onOpen={onOpenPullRequest}
              />
            </ReplayMask>
          )
        }
        onPress={entry.onPick}
      />
    </RowHintOptions>
  );
}

/**
 * The task's agents at the head of its description, under their group's head,
 * those waiting on the developer first, then those at work, then the
 * newest, and what `starts` offers after them; nothing for a task with
 * neither. A row's press is handed to `onOpenAgent` by its agent's id, and
 * `onOpenPullRequest` opens an agent's pull request as its own chip does.
 */
export function PlanAgents({
  agents,
  held,
  tab,
  folded,
  waiting,
  onOpenAgent,
  onOpenPullRequest,
  starts,
  phone,
}: {
  agents: AgentsControl;
  /** What the tabs hold, which each row's card reads as its tab's does. */
  held: HeldTranscripts;
  /** The column's chosen tab, whose agent's card follows its run. */
  tab: MainTabsControl["tab"];
  /** Whether the group starts folded. */
  folded: boolean;
  /** The task's Inbox items waiting on the developer, by the agent that posted each (`waitingByAgent`). */
  waiting: ReadonlyMap<string, readonly InboxItem[]>;
  onOpenAgent: (agentId: string) => void;
  onOpenPullRequest: (agentId: string) => void;
  /** What the group offers after its agents: New agent (`newAgentStarts`), and on a phone the agents' read again too (`phoneAgentStarts`). */
  starts: readonly MenuAction[];
  /** A phone's additions; none elsewhere. */
  phone?: PlanAgentsPhone | undefined;
}): React.JSX.Element | null {
  // Note that an entry's pick chooses its agent's tab, which a row hands the page as that agent's id.
  const entries = agentEntries(
    {
      tab,
      onChoose: (chosen) => {
        if (isAgentTab(chosen)) onOpenAgent(chosen.agent);
      },
    },
    agents,
    held,
  );
  // Note that a phone's group stands for its archived agents too, on a task whose every agent is archived, which starts none.
  const archived = phone === undefined ? 0 : (agents.archived?.length ?? 0);
  const grouped = entries.length > 0 || starts.length > 0 || archived > 0;
  // Note that a phone's Inbox row counts only what no listed agent's row marks already.
  const listed = new Set(entries.map((entry) => entry.row.id));
  let unmarked = 0;
  for (const [agentId, items] of waiting) if (!listed.has(agentId)) unmarked += items.length;
  const inboxRow = phone !== undefined && unmarked > 0 ? phone : undefined;
  if (!grouped && inboxRow === undefined) return null;
  return (
    // Note that the group is pulled out by a row's inset on each side, so its marks stand on the title's edge and its fills hang past it.
    <div className="plan-agents -mx-row-inset mb-block-gap">
      {grouped ? (
        <ReplayUnmask>
          <GroupHeader
            heading={GROUP_HEADING.NONE}
            label={AGENTS_LIST}
            // Note that a group over no agent, standing for New agent, counts none.
            count={
              entries.length === 0
                ? undefined
                : {
                    value: entries.length,
                    noun: entries.length === 1 ? AGENTS_NOUN.one : AGENTS_NOUN.many,
                  }
            }
            fold={{ defaultOpen: !folded }}
          >
            {entries.length + starts.length === 0 ? null : (
              <List label={AGENTS_LIST} density={LIST_DENSITY.DENSE} moves>
                {listedOrder(entries, waiting).map((entry) => (
                  <PlanAgentRow
                    key={entry.row.id}
                    entry={entry}
                    waits={waiting.get(entry.row.id)?.length ?? 0}
                    pullRequest={agents.pullRequests.get(entry.row.id)}
                    agents={agents}
                    held={held}
                    tab={tab}
                    onOpenPullRequest={() => onOpenPullRequest(entry.row.id)}
                  />
                ))}
                {starts.map((start) => (
                  <ListRow
                    key={start.label}
                    leading={start.icon ?? <GLYPH.ADD />}
                    title={start.label}
                    description={start.detail}
                    descriptionReplayMasked
                    disabled={start.disabled}
                    chevron
                    onPress={start.onSelect}
                  />
                ))}
              </List>
            )}
            {phone?.archived}
          </GroupHeader>
        </ReplayUnmask>
      ) : null}
      {inboxRow === undefined ? null : (
        <List label={NEEDS_YOU.LABEL} density={LIST_DENSITY.DENSE}>
          <ListRow
            leading={<GLYPH.INBOX />}
            title={<ReplayUnmask>{threadsWaitingWords(unmarked)}</ReplayUnmask>}
            chevron
            onPress={inboxRow.onOpenInbox}
          />
        </List>
      )}
    </div>
  );
}
