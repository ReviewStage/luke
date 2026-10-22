import type { CodingAgentStatus } from "@luke/features/coding-agent-wire";
import type { ProviderKeysAnswer } from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import { TEXT_LINK_LOOK, TEXT_TONE, TEXT_VARIANT, Text, TextLink } from "@luke/ui";
import { useEffect, useState } from "react";
import { useAct } from "../act.js";
import {
  CHATGPT_USAGE_URL,
  chatGptPlanLabel,
  claudePlanLabel,
  PLAN_LABEL_WORDS,
  type PlanLabel,
} from "./plan-label-model.js";
import { useMinute } from "./task-time.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * plan-label.tsx -- "Using ChatGPT plan · Manage usage" under a Codex agent's composer, "Using your Claude plan" under a Claude Code agent's, or why the plan cannot serve it.
 *
 * Drawn for an agent on Codex, which its starter's ChatGPT plan alone pays
 * for. The words are `plan-label-model.ts`'s; the plan's status is read for
 * the starter alone, as the agent's status changes, since a turn's end is
 * what writes a new one, and as the window comes back to the front, as it
 * does from a reconnect in Settings. The words are read against the minute's
 * clock, so a reached limit gives way once its reset passes, with no new
 * read. Manage usage opens ChatGPT's usage settings.
 */

/** The starter's keys, read again each time the agent's status moves; none for anyone else, or before the read. */
function useStarterKeys(
  starter: boolean,
  status: CodingAgentStatus,
): ProviderKeysAnswer | undefined {
  const { act } = useAct();
  const [keys, setKeys] = useState<ProviderKeysAnswer | undefined>(undefined);
  const [returns, setReturns] = useState(0);
  // A reconnect in Settings moves no agent's status, so the window coming back to the front reads the plan again too.
  useEffect(() => {
    if (!starter) return;
    const back = () => setReturns((count) => count + 1);
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [starter]);
  // Note that the status and the returns are dependencies for their change alone: each may follow a new status.
  useEffect(() => {
    if (!starter) return;
    let live = true;
    act(ACT_KIND.PROVIDER_KEYS_READ).then(
      (read) => {
        if (live && !("failure" in read)) setKeys(read);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [act, starter, status, returns]);
  return starter ? keys : undefined;
}

/** A label's words, in the attention colour, and said aloud as a status, where they ask for attention. */
function LabelWords({ label }: { label: PlanLabel }): React.JSX.Element {
  return (
    <span
      className="agent-plan-label"
      data-state={label.attention ? "attention" : undefined}
      role={label.attention ? "status" : undefined}
    >
      {label.words}
    </span>
  );
}

/** The label under a Claude Code agent's composer. */
export function ClaudePlanLabel({
  starter,
  status,
}: {
  /** Whether the reader started the agent, whose plan pays and whose status is theirs to read. */
  starter: boolean;
  status: CodingAgentStatus;
}): React.JSX.Element {
  const label = claudePlanLabel(useStarterKeys(starter, status), useMinute());
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      <LabelWords label={label} />
    </Text>
  );
}

/** The label under a Codex agent's composer. */
export function ChatGptPlanLabel({
  starter,
  status,
}: {
  /** Whether the reader started the agent, whose plan pays and whose status is theirs to read. */
  starter: boolean;
  status: CodingAgentStatus;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const label = chatGptPlanLabel(useStarterKeys(starter, status), useMinute());
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      <LabelWords label={label} />
      {" · "}
      <TextLink
        href={CHATGPT_USAGE_URL}
        look={TEXT_LINK_LOOK.UNDERLINED}
        external
        onClick={(event) => {
          event.preventDefault();
          openLink(CHATGPT_USAGE_URL);
        }}
      >
        {PLAN_LABEL_WORDS.MANAGE}
      </TextLink>
    </Text>
  );
}
