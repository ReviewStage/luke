import { useAtomValue } from "@effect/atom-react";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { type TerminalAction, type TerminalBar, terminalLook } from "@repo/features/terminal-model";
import { SHORTCUT_KEY } from "@repo/settings/shortcuts";
import {
  ANNOUNCE,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_FLOW,
  Fill,
  OneLine,
  PaneBar,
  Shortcut,
  TEXT_BUTTON_TONE,
  TextButton,
} from "@repo/ui";
import { useMemo, useState } from "react";
import { TERMINAL_LOAD_FAILED } from "../bundle-loader.js";
import { useTabActions } from "../desktop/strip-tabs.js";
import { unreadShown } from "../failure-report.js";
import { FIND_STEP, type FindSource, useFindSource } from "../find-in-tab.js";
import { usePhoneRoom } from "../stage-room.js";
import { TERMINAL_FIND, type TerminalFind } from "../terminal/contract.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { AgentRef, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { localShellsHeld } from "./local-held.js";
import { AgentGlyph } from "./tab-look.js";
import {
  TERMINAL_BODY_CLASS,
  TERMINAL_HOST_CLASS,
  TERMINAL_SCREEN_CLASS,
} from "./terminal-look.js";
import type { AgentsControl } from "./use-agents.js";
import { useLocalSession } from "./use-local-session.js";

/**
 * local-tab.tsx -- one of a cloud agent's Local tabs: a terminal on this Mac in the agent's mirrored files, under a bar naming the agent and where the connection stands.
 *
 * Each terminal is a tab of its own, titled by its name ("Local ·
 * Terminal 2"): the panel's "+" and ⌘K open another, and closing the tab
 * ends it (`use-local-session.ts`).
 *
 * The tab is the File tab's frame: a bar across its top, here naming the
 * agent whose files the shell stands in (`AgentRef`, which hangs the agent's
 * card and opens its tab) and the connection in a word or two; then the
 * terminal's screen (`terminal/`), which fills the rest. A state with
 * something to do lays one slim bar over the screen with one text action
 * and its key, and the terminal prints a state with nothing to do as a dim
 * line at the end of its own scrollback (`terminal-model.ts`). The tab
 * keeps its terminal while it is hidden (`terminal-session.ts`).
 *
 * The whole tab is left out of the screen recording, because the shell's
 * own words are drawn on a canvas the text masking cannot reach, and a
 * shell prints whatever its commands print.
 */

/**
 * The screen's scrollback as the source ⌘F finds in, since the terminal
 * draws its words on a canvas the window's find cannot read: found as
 * typed, stepped, tallied, and seeded from the screen's selection.
 */
function useScrollbackFind(find: TerminalFind | undefined): FindSource | undefined {
  return useMemo(
    () =>
      find === undefined
        ? undefined
        : {
            search: (query) => find.find(query, TERMINAL_FIND.TYPED),
            step: (query, step) =>
              find.find(
                query,
                step === FIND_STEP.NEXT ? TERMINAL_FIND.NEXT : TERMINAL_FIND.PREVIOUS,
              ),
            clear: find.clear,
            onTally: find.onTally,
            // A selection over several lines seeds its first, the one line the field holds, its spaces kept.
            selection: () =>
              find
                .selection()
                .split(/\r?\n/)
                .find((line) => line.trim() !== ""),
          },
    [find],
  );
}

/** What a phone's ⋯ calls the agent's name in the bar, which opens its tab. */
const OPEN_AGENT = "Open agent";

/** The slim bar over the screen: its words, and its one action with its key. */
function StateBar({
  bar,
  onAction,
}: {
  bar: TerminalBar;
  onAction: (action: TerminalAction) => void;
}): React.JSX.Element {
  const { action } = bar;
  // Note that a late bar is hidden until it has held a second, so its words are said once its reveal has run: a blip that mends first is never seen, so it is never said.
  const [revealed, setRevealed] = useState(false);
  useAnnounceShown(ANNOUNCE.POLITE, bar.late && !revealed ? "" : bar.words);
  return (
    <div
      className="terminal-bar flex min-h-7 flex-none flex-wrap items-center gap-x-control-gap gap-y-list-gap whitespace-nowrap border-b border-border bg-muted py-tight-gap pr-list-inset pl-ui-16 font-mono text-caption text-muted-foreground"
      data-late={String(bar.late)}
      onAnimationEnd={() => setRevealed(true)}
    >
      {/* Note that the glyph and the words are one item, so a bar too narrow for its action puts the action on a line of its own rather than the glyph apart from its words. */}
      <span className="flex min-w-0 flex-initial items-center gap-control-gap">
        {bar.busy ? (
          <span className="flex-none tracking-busy text-muted-foreground" aria-hidden="true">
            ⋯
          </span>
        ) : null}
        <OneLine className="terminal-bar-words">{bar.words}</OneLine>
      </span>
      <span className="terminal-bar-end ml-auto inline-flex items-center gap-control-gap">
        {action === undefined ? null : (
          <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => onAction(action.kind)}>
            {action.label}
            <Shortcut
              chord={{ key: SHORTCUT_KEY.ENTER, bare: true }}
              className="ms-tight-gap [--ui-shortcut-ink:currentColor]"
            />
          </TextButton>
        )}
      </span>
    </div>
  );
}

export function LocalTab({
  agentId,
  shell,
  agents,
  shown,
  onOpenAgent,
}: {
  agentId: string;
  /** The id the window minted the tab's terminal under (`local-held.ts`). */
  shell: string;
  agents: AgentsControl;
  /** Whether the tab is on screen, the one moment its screen stands in its box. */
  shown: boolean;
  /** Opens the agent's own tab in the task's column. */
  onOpenAgent: () => void;
}): React.JSX.Element {
  const subject = agentSubject(agents, agentId, NOTHING_HELD, false);
  const session = useLocalSession(agentId, shell, shown);
  useFindSource(useScrollbackFind(session.find));
  const look = terminalLook(session.state);
  // A phone draws no bar over the screen: its header's ⋯ opens the agent.
  const phone = usePhoneRoom();
  // Note that a phone has no title bar to carry "connecting…", so a state only that bar says is said in a bar over the screen.
  const bar = look.bar ?? (phone ? look.phoneBar : undefined);
  useTabActions(
    phone
      ? [
          [
            {
              label: OPEN_AGENT,
              icon: <AgentGlyph agent={subject.agent} />,
              detail: subject.name,
              onSelect: onOpenAgent,
            },
          ],
        ]
      : undefined,
  );
  return (
    <Fill className="terminal-tab file-view ph-no-capture" data-state={session.state.kind}>
      {phone ? null : (
        <PaneBar
          middle={
            // Note that the name and where the connection stands share one shrinking box, so a long name is cut rather than running past the bar.
            <span className="terminal-tab-title inline-flex min-w-0 items-center gap-item-gap overflow-hidden whitespace-nowrap text-muted-foreground">
              <AgentRef
                subject={subject}
                models={agents.models}
                onOpen={onOpenAgent}
                glyph={<AgentGlyph agent={subject.agent} />}
                label={subject.name}
              />
              <span className="terminal-tab-standing flex-none">· {look.words}</span>
            </span>
          }
        />
      )}
      <Fill flow={FILL_FLOW.ROW} clip className={TERMINAL_BODY_CLASS}>
        <div className={TERMINAL_HOST_CLASS}>
          {bar === undefined ? null : (
            // Note that each entry into a state's bar is a bar of its own, because a late bar's reveal runs again and its words wait for it, even when the state it follows was late too.
            <StateBar key={session.state.kind} bar={bar} onAction={session.onAction} />
          )}
          {session.failed ? (
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.BUNDLE_LOAD)}
              placement={ERROR_STATE_PLACEMENT.CENTERED}
              onRetry={session.retryBundle}
            >
              {TERMINAL_LOAD_FAILED}
            </ErrorState>
          ) : (
            <div
              ref={session.screen}
              className={TERMINAL_SCREEN_CLASS}
              data-dim={String(look.dim)}
            />
          )}
        </div>
      </Fill>
    </Fill>
  );
}

/**
 * The agent's Local terminals, as a terminal's row in the panel's "+" says
 * them after the agent's name: how many this window holds, nothing before
 * the first. Whether the agent works is the row's glyph's to say.
 */
export function LocalStanding({ agentId }: { agentId: string }): React.JSX.Element {
  const count = useAtomValue(localShellsHeld(agentId)).length;
  return <>{count === 0 ? null : `${count} ${count === 1 ? "terminal" : "terminals"}`}</>;
}
