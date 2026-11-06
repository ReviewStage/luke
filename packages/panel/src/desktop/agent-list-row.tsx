import type { AgentPullRequest, AgentSummary } from "@repo/features/agent-wire";
import type { CatalogModel, MacOffer } from "@repo/features/models-wire";
import {
  AttentionMark,
  GAP,
  Inline,
  LIST_ROW_META,
  ListRow,
  type ListRowMenu,
  RowHint,
  RowHintOptions,
  VisuallyHidden,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import type { ReactNode, RefCallback } from "react";
import type { AgentSubject } from "../tasks/agent-ref.js";
import { useChangesPeople } from "../tasks/changes-people.js";
import { NEEDS_YOU } from "../tasks/inbox-model.js";
import { PullRequestCard, peopleOf } from "../tasks/pull-request-card.js";
import { PullRequestChip } from "../tasks/pull-request-chip.js";
import { RunsOnPlace } from "../tasks/runs-on.js";
import { AgentGlyph, agentEndMark } from "../tasks/tab-look.js";
import { openerOf } from "../tasks/use-link-standing.js";
import { SUMMARY_GLYPH } from "./agent-archive.js";

/**
 * agent-list-row.tsx -- one agent as a list of agents draws it, at the head of a task's description and on a person's page alike: its glyph wearing where it stands, its name, the thread it waits on the developer in, where it runs, its failed mark, and its pull request's chip.
 *
 * The row is a `ListRow` whose glyph is its tab's (`AgentGlyph`), which
 * gives way to the working mark while the agent works, and whose name is
 * masked in a screen recording. Under the name stands the title of the
 * thread it waits on the developer in, where one waits, or what the place
 * says went wrong with the row, such as a rename refused. At its end stand,
 * in turn, what the place says of it first (`context`), such as the task a
 * person's agent works on, the attention mark where a thread waits, where
 * it runs (`runs-on.tsx`), Cloud or the device, its failed mark once its
 * turn failed, and what the place says of it last (`time`). Its pull
 * request, where it opened one, stands after them as a chip of GitHub's
 * mark in GitHub's color for where it stands and its number
 * (`pull-request-chip.tsx`), hanging the pull request's one card, the agent
 * whose it is and who it names among what the card says
 * (`pull-request-card.tsx`). While its name is edited (`editing`) it draws
 * none of what stands at its end and hangs no hint, so the field has the
 * row.
 */

/** One agent's row; see the module's head. */
export function AgentListRow({
  agent,
  subject,
  title,
  card,
  models,
  devices,
  pullRequest,
  waitingOn,
  refused,
  context,
  time,
  editing = false,
  motionKey,
  place,
  rowRef,
  menu,
  more,
  onPress,
  onOpenPullRequest,
}: {
  agent: AgentSummary;
  /** What it is called and what its card says, which its pull request's card names too. */
  subject: AgentSubject;
  /** What stands in its name's place, such as the field its name is edited in; its name where none is given. */
  title?: ReactNode;
  /** The card the row hangs; none where the place hangs none. */
  card: ReactNode | undefined;
  models: readonly CatalogModel[] | undefined;
  /** The member's devices, which give a device's platform (`RunsOnPlace`). */
  devices: readonly MacOffer[] | undefined;
  pullRequest: AgentPullRequest | undefined;
  /** The title of the thread it waits on the developer in, where one waits. */
  waitingOn?: string | undefined;
  /** What went wrong with the row, said under its name in a waiting thread's place. */
  refused?: ReactNode;
  /** What the place says of it before where it runs. */
  context?: ReactNode;
  /** What the place says of it after its failed mark. */
  time?: ReactNode;
  editing?: boolean | undefined;
  motionKey?: string | undefined;
  /** Where it stands in its list's run of rows, where the list draws only those near the view (`VirtualRows`). */
  place?: VirtualRowPlace | undefined;
  rowRef?: RefCallback<HTMLElement> | undefined;
  menu?: ListRowMenu | undefined;
  more?: boolean | undefined;
  /** Opens the agent, as its pull request's card offers too; the row takes no press while its name is edited. */
  onPress: () => void;
  onOpenPullRequest: () => void;
}): React.JSX.Element {
  const changesPeople = useChangesPeople(pullRequest === undefined ? undefined : agent.id);
  const people = pullRequest === undefined ? undefined : peopleOf(changesPeople, pullRequest);
  const { name } = subject;
  return (
    <RowHintOptions card={card}>
      <ListRow
        ref={rowRef}
        motionKey={motionKey}
        place={place}
        leading={
          <span className={SUMMARY_GLYPH}>
            <AgentGlyph agent={agent} />
          </span>
        }
        title={title ?? name}
        titleReplayMasked
        description={refused ?? waitingOn}
        descriptionReplayMasked={refused === undefined}
        metaAt={LIST_ROW_META.TITLE}
        hint={card === undefined || editing ? undefined : { Hint: RowHint, label: name }}
        meta={
          editing ? null : (
            <Inline gap={GAP.ITEM} wrap={false}>
              {context}
              {waitingOn === undefined ? null : (
                <>
                  <AttentionMark />
                  <VisuallyHidden>{NEEDS_YOU.LABEL}</VisuallyHidden>
                </>
              )}
              <ReplayMask>
                <RunsOnPlace agent={agent} devices={devices} />
                {agentEndMark(agent, true)}
              </ReplayMask>
              {time}
            </Inline>
          )
        }
        actions={
          editing || pullRequest === undefined ? undefined : (
            <ReplayMask>
              <PullRequestChip
                pullRequest={pullRequest}
                card={
                  <PullRequestCard
                    pullRequest={pullRequest}
                    place={{ taskId: agent.planId }}
                    lines={pullRequest}
                    files={pullRequest.changedFiles}
                    opener={people?.author ?? openerOf(pullRequest)}
                    agent={{ subject, models, onOpen: onPress }}
                    reviewers={people?.reviewers}
                  />
                }
                onOpen={onOpenPullRequest}
              />
            </ReplayMask>
          )
        }
        onPress={editing ? undefined : onPress}
        menu={menu}
        more={more}
      />
    </RowHintOptions>
  );
}
