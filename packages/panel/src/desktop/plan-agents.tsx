import type { AgentPullRequest } from "@repo/features/agent-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import {
  AttentionMark,
  GAP,
  GROUP_HEADING,
  GroupHeader,
  Inline,
  LIST_DENSITY,
  LIST_ROW_META,
  List,
  ListRow,
  RowHint,
  RowHintOptions,
  VisuallyHidden,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { isAgentTab, sameTab } from "@repo/ui/tab-strip-model";
import { agentStillWriting } from "../tasks/agent-model.js";
import { agentSubject } from "../tasks/agent-ref.js";
import { useChangesPeople } from "../tasks/changes-people.js";
import { awaitsNod, NEEDS_YOU, threadsWaitingWords } from "../tasks/inbox-model.js";
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

interface PlanAgentsPhone {
  readonly archived: React.ReactNode;
  readonly onOpenInbox: () => void;
}

const AGENTS_LIST = "Agents";

const AGENTS_NOUN = { one: "agent", many: "agents" } as const;

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

function waitingTitle(items: readonly InboxItem[] | undefined): string | undefined {
  return items === undefined
    ? undefined
    : (items.find((item) => !awaitsNod(item)) ?? items[0])?.title;
}

function PlanAgentRow({
  entry,
  waitingOn,
  pullRequest,
  agents,
  held,
  tab,
  onOpenPullRequest,
}: {
  entry: AddEntry;
  waitingOn: string | undefined;
  pullRequest: AgentPullRequest | undefined;
  agents: AgentsControl;
  held: HeldTranscripts;
  tab: MainTabsControl["tab"];
  onOpenPullRequest: () => void;
}): React.JSX.Element {
  const { row, endMark, card } = entry;
  const agentId = row.id;
  const chosen = tab !== undefined && sameTab({ agent: agentId }, tab);
  const changesPeople = useChangesPeople(pullRequest === undefined ? undefined : agentId);
  const people = pullRequest === undefined ? undefined : peopleOf(changesPeople, pullRequest);
  return (
    <RowHintOptions card={card}>
      <ListRow
        motionKey={row.id}
        leading={<span className={SUMMARY_GLYPH}>{row.icon}</span>}
        title={<ReplayMask>{row.label}</ReplayMask>}
        description={waitingOn}
        descriptionReplayMasked
        metaAt={LIST_ROW_META.TITLE}
        hint={card === undefined ? undefined : { Hint: RowHint, label: row.label }}
        meta={
          <Inline gap={GAP.ITEM} wrap={false}>
            {waitingOn === undefined ? null : (
              <>
                <AttentionMark />
                <VisuallyHidden>{NEEDS_YOU.LABEL}</VisuallyHidden>
              </>
            )}
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
  held: HeldTranscripts;
  tab: MainTabsControl["tab"];
  folded: boolean;
  waiting: ReadonlyMap<string, readonly InboxItem[]>;
  onOpenAgent: (agentId: string) => void;
  onOpenPullRequest: (agentId: string) => void;
  starts: readonly MenuAction[];
  phone?: PlanAgentsPhone | undefined;
}): React.JSX.Element | null {
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
  const archived = phone === undefined ? 0 : (agents.archived?.length ?? 0);
  const grouped = entries.length > 0 || starts.length > 0 || archived > 0;
  const listed = new Set(entries.map((entry) => entry.row.id));
  const marked = entries.some((entry) => waiting.has(entry.row.id));
  let unmarked = 0;
  for (const [agentId, items] of waiting) if (!listed.has(agentId)) unmarked += items.length;
  const inboxRow = phone !== undefined && unmarked > 0 ? phone : undefined;
  if (!grouped && inboxRow === undefined) return null;
  return (
    <div className="plan-agents -mx-row-inset mb-block-gap">
      {grouped ? (
        <ReplayUnmask>
          <GroupHeader
            heading={GROUP_HEADING.NONE}
            label={AGENTS_LIST}
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
              <List
                label={AGENTS_LIST}
                density={marked ? LIST_DENSITY.COMPACT : LIST_DENSITY.DENSE}
                moves
              >
                {listedOrder(entries, waiting).map((entry) => (
                  <PlanAgentRow
                    key={entry.row.id}
                    entry={entry}
                    waitingOn={waitingTitle(waiting.get(entry.row.id))}
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
