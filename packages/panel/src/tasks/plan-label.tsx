import type { CodingAgentStatus } from "@luke/features/coding-agent-wire";
import type { ProviderKeysAnswer } from "@luke/features/provider-key-wire";
import { ACT_KIND } from "@luke/host/acts";
import { TEXT_LINK_LOOK, TEXT_TONE, TEXT_VARIANT, Text, TextLink } from "@luke/ui";
import { useEffect, useState } from "react";
import { useAct } from "../act.js";
import { useNativeAgentsAccess } from "../use-app-state.js";
import { CHATGPT_USAGE_URL, chatGptPlanLabel, PLAN_LABEL_WORDS } from "./plan-label-model.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * plan-label.tsx -- "Using ChatGPT plan · Manage usage" under a Codex agent's composer, or why the plan cannot serve it.
 *
 * Drawn for an agent on Codex, which its starter's ChatGPT plan alone pays
 * for. The words are `plan-label-model.ts`'s; the plan's status is read for
 * the starter alone, as the agent's status changes, since a turn's end is
 * what writes a new one, and as the window comes back to the front, as it
 * does from a reconnect in Settings. Manage usage opens ChatGPT's usage settings.
 */

/** The starter's keys, read again each time the agent's status moves; none for anyone else, outside the cohort, or before the read. */
function useStarterKeys(
  starter: boolean,
  status: CodingAgentStatus,
): ProviderKeysAnswer | undefined {
  const { act } = useAct();
  const inCohort = useNativeAgentsAccess();
  const reads = starter && inCohort;
  const [keys, setKeys] = useState<ProviderKeysAnswer | undefined>(undefined);
  const [returns, setReturns] = useState(0);
  // A reconnect in Settings moves no agent's status, so the window coming back to the front reads the plan again too.
  useEffect(() => {
    if (!reads) return;
    const back = () => setReturns((count) => count + 1);
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [reads]);
  // Note that the status and the returns are dependencies for their change alone: each may follow a new status.
  useEffect(() => {
    if (!reads) return;
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
  }, [act, reads, status, returns]);
  return reads ? keys : undefined;
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
  const label = chatGptPlanLabel(useStarterKeys(starter, status));
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      <span
        className="agent-plan-label"
        data-state={label.attention ? "attention" : undefined}
        role={label.attention ? "status" : undefined}
      >
        {label.words}
      </span>
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
