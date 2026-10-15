import type { AccountChatEntry } from "@luke/features/account-inbox-wire";
import type { PlanSummary } from "@luke/features/plan-wire";
import { FolderIcon, SearchIcon, WingFace } from "@luke/ui";
import { MessagesSquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_COMMAND, APP_SHORTCUTS } from "#shared/shortcuts";
import { runAppCommand } from "../app-commands";
import { FOR_YOU, NEEDS_YOU, waitingLine } from "../planning/chat-model";
import { useMinute } from "../planning/plan-time";
import { RelativeTime } from "../planning/relative-time";
import type { PlansControl } from "../planning/use-plans-tab";
import { RepositoryPicture } from "../repository-picture";
import { Shortcut } from "../shortcut";
import { commandKeyshortcuts } from "../tooltip";
import { PlanStatusMark } from "./plan-card";

/**
 * desktop-home.tsx -- the home page: the column the window rests on with no plan open, saying what needs the developer and the plans saved latest, and offering New plan.
 *
 * It is one column at a reading measure, as a chat app's empty page is: a
 * greeting with New plan beside it, then For you, every chat message
 * waiting on the developer, who sent it and why, the plan whose channel it
 * was posted in after it, a press opening Chat's For you; then
 * Recent, the plans of the workspace listed saved latest, each as the
 * sidebar draws a plan, with its repository after its name, a press opening
 * it, and Search all of them, the command palette, where there are more.
 * Nothing waiting says so in For you's own words. An account with no plan
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

/** New plan, with its chord: the home page's, and the empty Factory's (`desktop-factory.tsx`). */
export function NewPlanButton({ plans }: { plans: PlansControl }): React.JSX.Element {
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

/** A message waiting on the developer: who sent it and why, the plan whose channel it was posted in, and when. */
function WaitingRow({
  entry,
  plan,
  now,
  onOpen,
}: {
  entry: AccountChatEntry;
  plan: PlanSummary | undefined;
  now: number;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <li className="sidebar-plan-item inbox-row">
      <button type="button" className="sidebar-plan" data-unread="true" onClick={onOpen}>
        <span className="sidebar-plan-line">
          <span className="sidebar-pinned-tab-glyph">
            <MessagesSquareIcon />
          </span>
          <span className="sidebar-plan-name">{waitingLine(entry)}</span>
          {plan === undefined ? null : <span className="home-row-context">{plan.name}</span>}
          <RelativeTime className="sidebar-plan-time" at={entry.updatedAt} now={now} hint={false} />
          <span className="inbox-row-dot">
            <span className="visually-hidden">{NEEDS_YOU.LABEL}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * For you: every message main's read of the account says waits on the
 * developer, the latest first, or the words where none does. A press on a
 * row opens Chat's For you, where it is answered or read.
 */
function HomeForYou({ plans, now }: { plans: PlansControl; now: number }): React.JSX.Element {
  const waiting = plans.chatWaiting;
  const empty = waiting.length === 0;
  return (
    <section className="home-section" aria-labelledby="home-for-you">
      <h2 className="home-section-title" id="home-for-you">
        For you
        {empty ? null : <span className="home-section-count">{waiting.length}</span>}
      </h2>
      {empty ? (
        <p className="sidebar-note">{NEEDS_YOU.NONE}</p>
      ) : (
        <ul className="sidebar-plans ph-no-capture">
          {waiting.map((entry) => (
            <WaitingRow
              key={entry.messageId}
              entry={entry}
              plan={plans.plans.find((plan) => plan.id === entry.planId)}
              now={now}
              onOpen={() => plans.chatView.onShow(FOR_YOU)}
            />
          ))}
        </ul>
      )}
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
        <HomeForYou plans={plans} now={now} />
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
