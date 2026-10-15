import {
  ACTOR_KIND,
  type Actor,
  actorName,
  personActor,
  ROLE_WORDS,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import {
  agentStarter,
  PERSON_TASKS_SHOWN,
  type PersonAgent,
  personPage,
  personPageEmpty,
  personRef,
} from "@luke/ui/person-page-model";
import type { ReactNode } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { ACTOR_SIZE, ActorMark, YouBadge } from "../actor-ref";
import { useAppCommand } from "../app-commands";
import { MemberDirectory, useMemberDirectory } from "../member-directory";
import { lineSubject } from "../planning/agent-ref";
import { InboxItemRow } from "../planning/inbox-list";
import { holderName, INBOX_HOLDER, type InboxListed } from "../planning/inbox-model";
import { useMinute } from "../planning/plan-time";
import { RelativeTime } from "../planning/relative-time";
import type { PlansControl } from "../planning/use-plans-tab";
import { RetryButton } from "../retry-button";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { RecentRow, useWaitingItems } from "./desktop-home";

/**
 * person-page.tsx -- one person's page in the listed workspace: who they are there, and what of theirs the window already holds.
 *
 * It stands in the plan's place as an agent's page does, opened from
 * wherever the window names a member, the reader among them, or someone
 * who left. Its head is their face at the page's size, their name, and
 * their role and email as the members read lists them, or that they left.
 * Under it, in Home's own voice, stand their agents at work, the Inbox
 * items their agents wait on, the tasks they created, and their other
 * agents, each from the listed workspace's task list and Inbox
 * (`@luke/ui/person-page-model`), a section with nothing in it left out.
 * Until the Inbox is read the page says so, and a read that failed says
 * that and offers Retry, so a page is called empty only once it is.
 * Nothing on it is read for it: it shows a teammate only what the sidebar,
 * the Inbox, and an agent's card already show any member, never their
 * personal workspace, their answers, or another workspace's. A press on a
 * row opens what it names, as Home's do, and Escape leaves the page.
 */

/** What a page's head says under a name, by who the person is to the workspace. */
function headLine(person: Actor): string | undefined {
  if (person.kind === ACTOR_KIND.PERSON) {
    const role = person.role === undefined ? undefined : ROLE_WORDS[person.role];
    return [role, person.email].filter((part) => part !== undefined).join(" · ") || undefined;
  }
  if (person.kind === ACTOR_KIND.SOMEONE && person.reason === SOMEONE_REASON.FORMER) {
    return "Former member";
  }
  return "Not in this workspace";
}

/** The name the page heads with: a member's own, never "You", since the badge says so. */
function headName(person: Actor): string {
  return person.kind === ACTOR_KIND.PERSON ? person.name : actorName(person);
}

/** A section in Home's voice: its name and count, then its rows. */
function PersonSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="home-section" aria-label={title}>
      <h2 className="home-section-title">
        {title}
        <span className="home-section-count">{count}</span>
      </h2>
      <ul className="sidebar-plans">{children}</ul>
    </section>
  );
}

/** One of their agents as a row: its tile, its name, the task it works on, and when it last moved; a press opens its tab. */
function AgentRow({
  each,
  plans,
  now,
}: {
  each: PersonAgent;
  plans: PlansControl;
  now: number;
}): React.JSX.Element {
  const { plan, agent } = each;
  const subject = lineSubject(agent, plans.agents.models, plans.me);
  return (
    <li className="sidebar-plan-item home-row">
      <button
        type="button"
        className="sidebar-plan"
        onClick={() => plans.onShowAgent(plan.id, agent.id)}
      >
        <span className="sidebar-plan-line">
          <span className="home-row-picture">
            <ActorMark actor={subject.tile} />
          </span>
          <span className="sidebar-plan-name">{subject.name}</span>
          <span className="home-row-context">{plan.name}</span>
          {agent.at === undefined ? null : (
            <span className="sidebar-plan-time">
              <RelativeTime at={agent.at} now={now} />
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** The page's head: their face, their name and You where it is the reader, and who they are here. */
function PersonHead({ person }: { person: Actor }): React.JSX.Element {
  const line = headLine(person);
  return (
    <header className="person-head">
      <ActorMark actor={person} size={ACTOR_SIZE.PAGE} />
      <div className="person-head-copy">
        <p className="person-head-name">
          {headName(person)}
          {person.kind === ACTOR_KIND.PERSON && person.you ? <YouBadge /> : null}
        </p>
        {line === undefined ? null : <p className="person-head-line">{line}</p>}
      </div>
    </header>
  );
}

/** The page inside the workspace's member directory, which names the person. */
function PersonColumn({
  plans,
  userId,
}: {
  plans: PlansControl;
  userId: string;
}): React.JSX.Element {
  const now = useMinute();
  const listed = plans.listed.plans;
  // Named as the list names them, or as the members read does where the list names them nowhere; nobody's name where neither does.
  const { members, readerId } = useMemberDirectory();
  const member = members?.find((each) => each.userId === userId);
  const ref = personRef(userId, listed) ?? member;
  const person = personActor(ref, members, readerId);
  const page = personPage(userId, listed);
  const you = userId === plans.me;
  // An item is theirs where its task's row says they started its agent; an agent with no plan is the reader's own.
  const read = useWaitingItems(plans);
  const waiting = read.items.filter(({ holder, item }) =>
    holder.kind === INBOX_HOLDER.PLAN ? agentStarter(holder.plan, item.agentId) === userId : you,
  );
  const { inboxView } = plans;
  const openItem = ({ holder, item }: InboxListed) => {
    inboxView.onOpen();
    inboxView.onChoose(
      holder.kind === INBOX_HOLDER.PLAN
        ? { planId: holder.plan.id, itemId: item.id }
        : { agentId: item.agentId, itemId: item.id },
    );
  };
  const name = headName(person);
  return (
    <section className="automations-view" aria-label={name}>
      <header className="desktop-toolbar">
        <div className="desktop-toolbar-heading">
          <h1 className="desktop-toolbar-title">{name}</h1>
        </div>
      </header>
      <div className="home-scroll">
        <div className="home-column person-column">
          <PersonHead person={person} />
          {page.working.length === 0 ? null : (
            <PersonSection title="Working now" count={page.working.length}>
              {page.working.map((each) => (
                <AgentRow key={each.agent.id} each={each} plans={plans} now={now} />
              ))}
            </PersonSection>
          )}
          {waiting.length === 0 ? null : (
            <PersonSection
              title={you ? "Waiting on you" : "Waiting on their answer"}
              count={waiting.length}
            >
              {waiting.map((listed) => (
                <InboxItemRow
                  key={listed.item.id}
                  listed={listed}
                  chosen={false}
                  now={now}
                  models={plans.agents.models}
                  readerId={plans.me}
                  context={holderName(listed.holder)}
                  onChoose={openItem}
                />
              ))}
            </PersonSection>
          )}
          {page.created.length === 0 ? null : (
            <PersonSection title={you ? "Created by you" : "Created"} count={page.created.length}>
              {page.created.slice(0, PERSON_TASKS_SHOWN).map((plan) => (
                <RecentRow
                  key={plan.id}
                  plan={plan}
                  pictures={plans.repositories.pictures}
                  now={now}
                  face={false}
                  onOpen={() => plans.onSelect(plan.id)}
                />
              ))}
            </PersonSection>
          )}
          {page.agents.length === 0 ? null : (
            <PersonSection title="Agents" count={page.agents.length}>
              {page.agents.map((each) => (
                <AgentRow key={each.agent.id} each={each} plans={plans} now={now} />
              ))}
            </PersonSection>
          )}
          {read.failed ? (
            <div className="sidebar-note person-empty flex items-center gap-2" role="alert">
              <span>Some Inbox items could not be read.</span>
              <RetryButton onRetry={read.onRetry} />
            </div>
          ) : waiting.length === 0 && read.reading ? (
            <Spinner label="Loading inbox" size={SPINNER_SIZE.INLINE} />
          ) : personPageEmpty(page) && waiting.length === 0 ? (
            <p className="sidebar-note person-empty">
              {you ? "Nothing of yours here yet." : "Nothing of theirs here yet."}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** A person's page, in the plan's place, read against the listed workspace's members. */
export function PersonPage({
  plans,
  userId,
}: {
  plans: PlansControl;
  userId: string;
}): React.JSX.Element {
  useAppCommand(APP_COMMAND.EXIT_PERSON_PAGE, plans.personView.onClose);
  return (
    <MemberDirectory workspace={plans.workspace} readerId={plans.me}>
      <PersonColumn plans={plans} userId={userId} />
    </MemberDirectory>
  );
}
