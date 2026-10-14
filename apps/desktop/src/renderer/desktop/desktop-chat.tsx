import type { PlanAgentLine } from "@luke/features/plan-wire";
import { AtSignIcon, HashIcon, MessagesSquareIcon } from "lucide-react";
import { useMemo } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { EmptyState } from "../empty-state";
import {
  CHAT_PLACE,
  type ChatNames,
  type ChatPlace,
  type ChatRailRow,
  chatRail,
  FOR_YOU,
} from "../planning/chat-model";
import { ChatPane, MemberMark } from "../planning/chat-pane";
import { useMinute } from "../planning/plan-time";
import { useOpenLink } from "../planning/use-open-link";
import type { PlansControl } from "../planning/use-plans-tab";

/**
 * desktop-chat.tsx -- the window's Chat: the workspace's channels and direct messages in a rail of their own, and For you or the channel chosen read beside it.
 *
 * It stands in the plan's place beside the sidebar, whose Chat row is
 * marked while it does, as the window's Inbox (`desktop-inbox.tsx`) does.
 * The rail is drawn from the sidebar's own pieces: For you at its head,
 * counting what waits on the developer, then the channels, then the direct
 * messages, each row counting what in it the developer has not read and
 * in the unread weight while anything is (`chat-model.ts`). A direct
 * message's row leads with the other member's mark and names their agent's
 * title or plan after their handle. A press on a row shows its place in
 * the pane beside the rail (`chat-pane.tsx`). The agents are named from
 * the plans' summaries, the way the sidebar names them, and from the lines
 * the chat read carries where those name more. With nothing read, it says
 * so under Chat's glyph. Escape leaves it for the plan it stood over, and
 * so does any row of the sidebar.
 */

/** What the view says where no chat is read. */
const NO_CHAT = "Chat is not available yet.";

/** Whether a row stands for the place shown. */
function shows(place: ChatPlace, row: ChatRailRow): boolean {
  return place.kind === CHAT_PLACE.CHANNEL && place.channelId === row.channel.id;
}

/** A row's unread count at its end, nothing at none. */
function Count({ count }: { count: number }): React.JSX.Element | null {
  if (count === 0) return null;
  return (
    <span className="chat-rail-count">
      {count}
      <span className="visually-hidden"> unread</span>
    </span>
  );
}

/** One channel's or direct message's row: its glyph or the other member's mark, its name, what it says after, and its count. */
function RailRow({
  row,
  current,
  onChoose,
}: {
  row: ChatRailRow;
  current: boolean;
  onChoose: () => void;
}): React.JSX.Element {
  return (
    <li className="sidebar-plan-item chat-rail-row">
      <button
        type="button"
        className="sidebar-plan"
        aria-current={current ? "page" : undefined}
        data-unread={String(row.unread > 0)}
        data-channel-id={row.channel.id}
        onClick={onChoose}
      >
        <span className="sidebar-plan-line">
          <span className="sidebar-pinned-tab-glyph">
            {row.other === undefined ? <HashIcon /> : <MemberMark who={row.other} small />}
          </span>
          <span className="sidebar-plan-name">{row.label}</span>
          {row.sub === undefined ? null : <span className="chat-rail-sub">{row.sub}</span>}
          <Count count={row.unread} />
        </span>
      </button>
    </li>
  );
}

/** The window's Chat, in the plan's place: the rail, and the place chosen beside it. */
export function DesktopChat({
  plans,
  accountName,
}: {
  plans: PlansControl;
  accountName: string | undefined;
}): React.JSX.Element {
  const view = plans.chatView;
  useAppCommand(APP_COMMAND.EXIT_INBOX, view.onClose);
  const now = useMinute();
  const openLink = useOpenLink();
  const read = view.chat;
  const listed = plans.plans;
  const names = useMemo((): ChatNames => {
    const lines: PlanAgentLine[] = [
      ...listed.flatMap((plan) => plan.agents?.agents ?? []),
      ...(read?.agents ?? []),
    ];
    return {
      agents: new Map(lines.map((line) => [line.id, line])),
      plans: new Map(listed.map((plan) => [plan.id, plan.name])),
      selfName: accountName,
    };
  }, [listed, read, accountName]);
  if (read === undefined) {
    return (
      <div className="chat-view">
        <section className="chat-stream" aria-label="Chat">
          <header className="desktop-toolbar" />
          <EmptyState icon={<MessagesSquareIcon />}>{NO_CHAT}</EmptyState>
        </section>
      </div>
    );
  }
  const chat = read.answer;
  const rail = chatRail(chat, names);
  const row = (each: ChatRailRow) => (
    <RailRow
      key={each.channel.id}
      row={each}
      current={shows(view.place, each)}
      onChoose={() => view.onChoose({ kind: CHAT_PLACE.CHANNEL, channelId: each.channel.id })}
    />
  );
  return (
    <div className="chat-view">
      <nav className="chat-rail" aria-label="Chat">
        <header className="desktop-toolbar chat-rail-bar">
          <div className="desktop-toolbar-heading">
            <h1 className="desktop-toolbar-title">Chat</h1>
          </div>
        </header>
        <div className="chat-rail-scroll">
          <ul className="sidebar-plans">
            <li className="sidebar-plan-item chat-rail-row">
              <button
                type="button"
                className="sidebar-plan"
                aria-current={view.place.kind === CHAT_PLACE.FOR_YOU ? "page" : undefined}
                data-unread={String(rail.forYou > 0)}
                onClick={() => view.onChoose(FOR_YOU)}
              >
                <span className="sidebar-plan-line">
                  <span className="sidebar-pinned-tab-glyph">
                    <AtSignIcon />
                  </span>
                  <span className="sidebar-plan-name">For you</span>
                  <Count count={rail.forYou} />
                </span>
              </button>
            </li>
          </ul>
          <h2 className="chat-rail-heading">Channels</h2>
          <ul className="sidebar-plans">{rail.channels.map(row)}</ul>
          {rail.direct.length === 0 ? null : (
            <>
              <h2 className="chat-rail-heading">Direct messages</h2>
              <ul className="sidebar-plans">{rail.direct.map(row)}</ul>
            </>
          )}
        </div>
      </nav>
      <ChatPane chat={chat} names={names} place={view.place} now={now} openLink={openLink} />
    </div>
  );
}
