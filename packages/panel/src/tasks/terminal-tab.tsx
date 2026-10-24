import { type TerminalAction, type TerminalBar, terminalLook } from "@luke/features/terminal-model";
import { SHORTCUT_KEY } from "@luke/settings/shortcuts";
import {
  ANNOUNCE,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_FLOW,
  Fill,
  PaneBar,
  Shortcut,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TextButton,
} from "@luke/ui";
import { useMemo, useState } from "react";
import { TERMINAL_LOAD_FAILED } from "../bundle-loader.js";
import { useTabActions } from "../desktop/strip-tabs.js";
import { FIND_STEP, type FindSource, useFindSource } from "../find-in-tab.js";
import { usePhoneRoom } from "../stage-room.js";
import { TERMINAL_FIND, type TerminalFind } from "../terminal/contract.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { AgentRef, agentSubject, NOTHING_HELD } from "./agent-ref.js";
import { paneToggleAction, TreeToggle, usePaneRoom } from "./file-view.js";
import { AgentGlyph } from "./tab-look.js";
import { TerminalShells } from "./terminal-shells.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { useTerminalSession } from "./use-terminal-session.js";
import { WorkingTime } from "./working-time.js";

/**
 * terminal-tab.tsx -- an agent's Terminal tab: a shell in the agent's own sandbox, under a bar naming the agent and where the connection stands.
 *
 * The tab is the File tab's frame: a bar across its top, here naming the
 * agent whose sandbox it is (`AgentRef`, which hangs the agent's card and
 * opens its tab), "sandbox", and the connection in a word or two; then the
 * terminal's screen (`terminal/`), which fills the rest. A state with
 * something to do lays one slim bar over the screen with one text action
 * and its key, and the terminal prints a state with nothing to do as a dim
 * line at the end of its own scrollback (`terminal-model.ts`). The tab
 * connects only while it is shown (`use-terminal-session.ts`).
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

/** What the shells list's toggle says. */
const SHELLS_TOGGLE = { open: "Hide shells", closed: "Show shells" } as const;

/** The slim bar over the screen: its words, a count or a note, and its one action with its key. */
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
      className="terminal-bar"
      data-late={String(bar.late)}
      onAnimationEnd={() => setRevealed(true)}
    >
      {bar.busy ? (
        <span className="terminal-bar-busy" aria-hidden="true">
          ⋯
        </span>
      ) : null}
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.INHERIT}
        truncate
        className="terminal-bar-words"
      >
        {bar.words}
      </Text>
      <span className="terminal-bar-end">
        {bar.since === undefined ? null : (
          <WorkingTime startedAt={bar.since} className="terminal-bar-note" />
        )}
        {bar.note === undefined ? null : <span className="terminal-bar-note">{bar.note}</span>}
        {action === undefined ? null : (
          <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => onAction(action.kind)}>
            {action.label}
            <Shortcut
              chord={{ key: SHORTCUT_KEY.ENTER, bare: true }}
              className="terminal-bar-key"
            />
          </TextButton>
        )}
      </span>
    </div>
  );
}

export function TerminalTab({
  agentId,
  agents,
  shown,
  onOpenAgent,
  onClose,
  shells,
}: {
  agentId: string;
  agents: CodingAgentsControl;
  /** Whether the tab is on screen, the one moment it holds a connection. */
  shown: boolean;
  /** Opens the agent's own tab in the task's column. */
  onOpenAgent: () => void;
  /** Closes the tab, as an archived agent's does. */
  onClose: () => void;
  /** Whether the shells list stands beside the screen, which holds for every Terminal tab alike, and its toggle. */
  shells: { readonly open: boolean; readonly onToggle: () => void };
}): React.JSX.Element {
  const subject = agentSubject(agents, agentId, NOTHING_HELD, false);
  const session = useTerminalSession(agentId, shown, onClose);
  useFindSource(useScrollbackFind(session.find));
  const look = terminalLook(session.state);
  const room = usePaneRoom(shells);
  // A phone draws no bar over the screen: its header's ⋯ opens the agent and the shells, saying where the sandbox stands.
  const phone = usePhoneRoom();
  // Note that a phone has no title bar to carry "connecting…", so a state only that bar says is said in a bar over the screen.
  const bar = look.bar ?? (phone ? look.phoneBar : undefined);
  useTabActions(
    phone
      ? [
          [
            paneToggleAction(room, SHELLS_TOGGLE, `Sandbox · ${look.words}`),
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
    <Fill
      className="terminal-tab file-view ph-no-capture"
      data-state={session.state.kind}
      {...room.root}
    >
      {phone ? null : (
        <PaneBar
          middle={
            // Note that the name and where the connection stands share one shrinking box, so a long name gives way to the toggle rather than running under it.
            <span className="terminal-tab-title">
              <AgentRef
                subject={subject}
                models={agents.models}
                onOpen={onOpenAgent}
                glyph={<AgentGlyph agent={subject.agent} />}
                label={subject.name}
              />
              <span className="terminal-tab-standing">
                <span className="terminal-tab-sandbox">· sandbox </span>· {look.words}
              </span>
            </span>
          }
          actions={<TreeToggle toggles={room.toggles} words={SHELLS_TOGGLE} />}
        />
      )}
      <Fill flow={FILL_FLOW.ROW} clip className="terminal-tab-body" {...room.body}>
        <div className="terminal-tab-host">
          {bar === undefined ? null : (
            // Note that each entry into a state's bar is a bar of its own, because a late bar's reveal runs again and its words wait for it, even when the state it follows was late too.
            <StateBar key={session.state.kind} bar={bar} onAction={session.onAction} />
          )}
          {session.failed ? (
            <ErrorState placement={ERROR_STATE_PLACEMENT.CENTRED} onRetry={session.retryBundle}>
              {TERMINAL_LOAD_FAILED}
            </ErrorState>
          ) : (
            <div ref={session.screen} className="terminal-tab-screen" data-dim={String(look.dim)} />
          )}
        </div>
        <TerminalShells
          subject={subject}
          models={agents.models}
          session={{
            ...session,
            // A shell chosen in the list floating over the screen takes the list down, to show the shell.
            onChoose: (id) => {
              room.closeOver();
              session.onChoose(id);
            },
            // So does a shell started there, which the screen shows.
            onCreate: () => {
              room.closeOver();
              session.onCreate();
            },
          }}
          onOpenAgent={onOpenAgent}
          over={room.docked ? undefined : room.over}
          pane={room.beside.pane}
          leaving={room.beside.leaving}
          surfaceOpen={shown}
        />
      </Fill>
    </Fill>
  );
}
