import type { CodingAgentInboxParams } from "@luke/features/coding-agent-view";
import type { PlanSummary } from "@luke/features/plan-wire";
import { FolderIcon, SearchIcon, WingFace } from "@luke/panel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { APP_COMMAND, APP_SHORTCUTS } from "#shared/shortcuts";
import { useAct } from "../act";
import { runAppCommand } from "../app-commands";
import { InboxItemRow } from "../planning/inbox-list";
import {
  INBOX_GROUPING,
  type InboxListed,
  inboxList,
  listedItems,
  NEEDS_YOU,
} from "../planning/inbox-model";
import { useMinute } from "../planning/plan-time";
import { RelativeTime } from "../planning/relative-time";
import { TAB_WORDS } from "../planning/tab-strip-model";
import { useInboxItems } from "../planning/use-inbox-items";
import type { PlansControl } from "../planning/use-plans-tab";
import { RepositoryPicture } from "../repository-picture";
import { RetryButton } from "../retry-button";
import { Shortcut } from "../shortcut";
import { SPINNER_SIZE, Spinner } from "../spinner";
import { commandKeyshortcuts } from "../tooltip";
import { PlanStatusMark } from "./plan-card";

/**
 * desktop-home.tsx -- the home page: the column the window rests on with no plan open, saying what needs the developer and the plans saved latest, and offering New plan.
 *
 * It is one column at a reading measure, as a chat app's empty page is: a
 * greeting with New plan beside it, then Inbox, every Inbox item
 * waiting on the developer's answer as the Inbox's own row draws it, the
 * plan it is about after its title, a press opening the Inbox on it; then
 * Recent, the plans of the workspace listed saved latest, each as the
 * sidebar draws a plan, with its repository after its name, a press opening
 * it, and Search all of them, the command palette, where there are more.
 * Nothing waiting says so in the Inbox's own words. An account with no plan
 * yet in any workspace is welcomed instead: Luke's face, one line of what he does, and New
 * plan. Nothing here names the sidebar, which may be folded away.
 *
 * ↑ and ↓ move through its rows, a launcher's way, from the window itself
 * as well as from a row, and Return opens the row reached, so a launch is a
 * key or two from a plan; a key pressed anywhere else, the sidebar or a
 * field, is left to it. Until the plan list is read the page draws nothing,
 * since what it says hangs on the list.
 */

/** How many plans Recent lists. */
const RECENT_COUNT = 6;

/** The rows the arrow keys move through: every plan's and item's, and Search all. */
const HOME_ROWS = ".sidebar-plan, .home-more";

/** The greeting: the account's first name where it has one. */
function greeting(name: string | undefined): string {
  const first = name?.trim().split(/\s+/u)[0];
  return first === undefined || first === "" ? "Welcome back" : `Welcome back, ${first}`;
}

/** The workspace's plans saved latest, the archived left out. */
function recentPlans(plans: readonly PlanSummary[]): PlanSummary[] {
  return plans.toSorted((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_COUNT);
}

/**
 * Every Inbox item waiting on the developer, the latest changed first, read
 * as the window's Inbox reads them: each plan main says holds a waiting item
 * and the account's list holds, read whole.
 */
function useWaitingItems(plans: PlansControl) {
  const { act } = useAct();
  const readInbox = useCallback(
    (params: CodingAgentInboxParams) => act(ACT_KIND.CODING_AGENTS_INBOX, params),
    [act],
  );
  const { inbox, inboxPlans, plans: listed } = plans;
  const holdings = useMemo(
    () =>
      inboxPlans.filter(
        (holding) =>
          inbox.some((waiting) => waiting.planId === holding.planId) &&
          listed.some((plan) => plan.id === holding.planId),
      ),
    [inbox, inboxPlans, listed],
  );
  const read = useInboxItems({ holdings, readInbox });
  const entries = holdings.flatMap((holding) => {
    const plan = listed.find((each) => each.id === holding.planId);
    return plan === undefined ? [] : [{ plan, items: read.items.get(holding.planId) ?? [] }];
  });
  const items = listedItems(
    inboxList(entries, { grouping: INBOX_GROUPING.NEWEST, waitingOnly: true, chosen: undefined }),
  );
  const reading = holdings.some((holding) => !read.items.has(holding.planId));
  return { items, reading, failed: read.failed, onRetry: read.onRetry };
}

/**
 * ↑ and ↓ from the window itself, or from one of the page's rows, move the
 * focus through the rows; the first press from the window reaches the first
 * row, or the last. A key with a modifier, or one pressed anywhere else, New
 * plan's button among them, is left alone.
 */
function useRowKeys(page: HTMLElement | null, shown: boolean): void {
  useEffect(() => {
    if (page === null || !shown) return;
    const step = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      const from = document.activeElement;
      const rows = [...page.querySelectorAll<HTMLElement>(HOME_ROWS)];
      const at = rows.findIndex((row) => row === from);
      const fromWindow = from === null || from === document.body;
      if (rows.length === 0 || (!fromWindow && at < 0)) return;
      event.preventDefault();
      const down = event.key === "ArrowDown";
      const next = at < 0 ? (down ? 0 : rows.length - 1) : at + (down ? 1 : -1);
      rows[Math.min(rows.length - 1, Math.max(0, next))]?.focus();
    };
    window.addEventListener("keydown", step);
    return () => window.removeEventListener("keydown", step);
  }, [page, shown]);
}

function NewPlanButton({ plans }: { plans: PlansControl }): React.JSX.Element {
  return (
    <button
      type="button"
      className="primary-button"
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.NEW_PLAN)}
      disabled={!plans.signedIn}
      onClick={plans.onNewPlan}
    >
      New plan
      <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.NEW_PLAN].chord} />
    </button>
  );
}

/** A plan as the sidebar draws it, its repository after its name: the owner's picture, the name, the repository, and its mark and time. */
function RecentRow({
  plan,
  pictures,
  now,
  onOpen,
}: {
  plan: PlanSummary;
  pictures: boolean;
  now: number;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <li className="sidebar-plan-item home-row">
      <button type="button" className="sidebar-plan" onClick={onOpen}>
        <span className="sidebar-plan-line">
          <span className="home-row-picture">
            {plan.repository === null ? (
              <FolderIcon />
            ) : (
              <RepositoryPicture
                repository={plan.repository}
                pictures={pictures}
                fallback={<FolderIcon />}
              />
            )}
          </span>
          <span className="sidebar-plan-name">{plan.name}</span>
          <span className="home-row-context">{plan.repository ?? "No repository"}</span>
          <span className="sidebar-plan-time">
            <PlanStatusMark plan={plan} />
            <RelativeTime at={plan.updatedAt} now={now} />
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Inbox: the waiting items, or what stands in their place while they are
 * read, failed, or none. It is headed by the Inbox's name, the place a press
 * on a row opens, and says it holds nothing waiting in the Inbox's own words.
 */
function HomeInbox({ plans, now }: { plans: PlansControl; now: number }): React.JSX.Element {
  const waiting = useWaitingItems(plans);
  const { inboxView } = plans;
  const open = ({ plan, item }: InboxListed) => {
    inboxView.onOpen();
    inboxView.onChoose({ planId: plan.id, itemId: item.id });
  };
  const empty = waiting.items.length === 0;
  return (
    <section className="home-section" aria-labelledby="home-inbox">
      <h2 className="home-section-title" id="home-inbox">
        {TAB_WORDS.INBOX}
        {empty ? null : <span className="home-section-count">{waiting.items.length}</span>}
      </h2>
      {empty ? null : (
        <ul className="sidebar-plans">
          {waiting.items.map((listed) => (
            <InboxItemRow
              key={listed.item.id}
              listed={listed}
              chosen={false}
              now={now}
              models={plans.agents.models}
              context={listed.plan.name}
              onChoose={open}
            />
          ))}
        </ul>
      )}
      {waiting.failed ? (
        <div className="sidebar-note flex items-center gap-2" role="alert">
          <span>Some items could not be read.</span>
          <RetryButton onRetry={waiting.onRetry} />
        </div>
      ) : empty && waiting.reading ? (
        <Spinner label="Loading inbox" size={SPINNER_SIZE.INLINE} />
      ) : empty ? (
        <p className="sidebar-note">{NEEDS_YOU.NONE}</p>
      ) : null}
    </section>
  );
}

/** A new account's welcome: Luke's face and New plan. */
function Welcome({ plans }: { plans: PlansControl }): React.JSX.Element {
  return (
    <section className="home-welcome" aria-label="Welcome">
      <span className="home-welcome-face" aria-hidden="true">
        <WingFace />
      </span>
      <h1 className="home-title">Plan your first feature</h1>
      <NewPlanButton plans={plans} />
    </section>
  );
}

/** The home page, in the plan's place while no plan is open. */
export function DesktopHome({
  plans,
  accountName,
}: {
  plans: PlansControl;
  /** The signed-in account's name, which greets it. */
  accountName: string | undefined;
}): React.JSX.Element | null {
  const now = useMinute();
  const [column, setColumn] = useState<HTMLDivElement | null>(null);
  useRowKeys(column, plans.shown);
  const { listed } = plans;
  if (!plans.listRead && !plans.listFailed) return null;
  // Only an account with no plan in any workspace is new; a workspace of
  // its own with none still says what needs it elsewhere.
  if (!plans.listFailed && plans.plans.length === 0 && plans.archived.length === 0) {
    return <Welcome plans={plans} />;
  }
  const recent = recentPlans(listed.plans);
  return (
    <div className="home-scroll">
      <div className="home-column" ref={setColumn}>
        <header className="home-head">
          <h1 className="home-title">{greeting(accountName)}</h1>
          <NewPlanButton plans={plans} />
        </header>
        <HomeInbox plans={plans} now={now} />
        {recent.length === 0 ? null : (
          <section className="home-section" aria-labelledby="home-recent">
            <h2 className="home-section-title" id="home-recent">
              Recent
            </h2>
            <ul className="sidebar-plans">
              {recent.map((plan) => (
                <RecentRow
                  key={plan.id}
                  plan={plan}
                  pictures={plans.repositories.pictures}
                  now={now}
                  onOpen={() => plans.onSelect(plan.id)}
                />
              ))}
            </ul>
            {listed.plans.length > RECENT_COUNT ? (
              <button
                type="button"
                className="home-more"
                aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.COMMAND_PALETTE)}
                onClick={() => runAppCommand(APP_COMMAND.COMMAND_PALETTE)}
              >
                <SearchIcon />
                Search all {listed.plans.length} plans
                <Shortcut chord={APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE].chord} />
              </button>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}
