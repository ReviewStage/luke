import type {
  CodingAgentAgentAnswer,
  CodingAgentDefaultAnswer,
  CodingAgentListAnswer,
  CodingAgentListParams,
  CodingAgentMessagesAnswerView,
  CodingAgentMessagesParams,
  CodingAgentModelsAnswer,
  CodingAgentStartParams,
  CodingAgentStopParams,
} from "@sidecar/hosted/coding-agent-view";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import type { Effect } from "effect";
import { ACT, ACT_KIND } from "#shared/messages/acts";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * coding-agent-acts.ts -- the Plans tab's coding-agent acts: the panel's asks of the host about a plan's agents.
 *
 * The one check this process makes is who asked, as for every planning act:
 * only a panel draws a plan's agents, so every row refuses the takeover and
 * the hidden voice window. What the service answers comes back as the
 * panel's own answer, and nothing is held here.
 */
export interface CodingAgentActsDependencies {
  host: {
    codingAgentModels(): Effect.Effect<CodingAgentModelsAnswer>;
    codingAgentDefaultRead(): Effect.Effect<CodingAgentDefaultAnswer>;
    codingAgentDefaultWrite(choice: ModelChoice): Effect.Effect<CodingAgentDefaultAnswer>;
    codingAgentList(params: CodingAgentListParams): Effect.Effect<CodingAgentListAnswer>;
    codingAgentStart(params: CodingAgentStartParams): Effect.Effect<CodingAgentAgentAnswer>;
    codingAgentMessages(
      params: CodingAgentMessagesParams,
    ): Effect.Effect<CodingAgentMessagesAnswerView>;
    codingAgentStop(params: CodingAgentStopParams): Effect.Effect<CodingAgentAgentAnswer>;
  };
}

type CodingAgentActKind =
  | typeof ACT_KIND.CODING_AGENTS_MODELS
  | typeof ACT_KIND.CODING_AGENTS_DEFAULT_READ
  | typeof ACT_KIND.CODING_AGENTS_DEFAULT_WRITE
  | typeof ACT_KIND.CODING_AGENTS_LIST
  | typeof ACT_KIND.CODING_AGENTS_START
  | typeof ACT_KIND.CODING_AGENTS_MESSAGES
  | typeof ACT_KIND.CODING_AGENTS_STOP;

/** The refusal a window that draws no Plans tab hears, in its kind's own words. */
function refuseUnlessPanel(kind: CodingAgentActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function codingAgentActRows(
  dependencies: CodingAgentActsDependencies,
): Pick<ActRows, CodingAgentActKind> {
  const { host } = dependencies;
  return {
    [ACT_KIND.CODING_AGENTS_MODELS]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_MODELS, sender);
      return host.codingAgentModels();
    },
    [ACT_KIND.CODING_AGENTS_DEFAULT_READ]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_DEFAULT_READ, sender);
      return host.codingAgentDefaultRead();
    },
    [ACT_KIND.CODING_AGENTS_DEFAULT_WRITE]: (choice, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_DEFAULT_WRITE, sender);
      return host.codingAgentDefaultWrite(choice);
    },
    [ACT_KIND.CODING_AGENTS_LIST]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_LIST, sender);
      return host.codingAgentList(params);
    },
    [ACT_KIND.CODING_AGENTS_START]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_START, sender);
      return host.codingAgentStart(params);
    },
    [ACT_KIND.CODING_AGENTS_MESSAGES]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_MESSAGES, sender);
      return host.codingAgentMessages(params);
    },
    [ACT_KIND.CODING_AGENTS_STOP]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.CODING_AGENTS_STOP, sender);
      return host.codingAgentStop(params);
    },
  };
}
