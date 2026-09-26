import type { PlanCreateRequest } from "@sidecar/hosted/plan-wire";
import type {
  PlanningRepositoriesAnswer,
  PlanningStartAnswer,
} from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import { ACT, ACT_KIND } from "#shared/messages/acts";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * planning-acts.ts -- the planning window's acts: the panel's entry that opens it, and the window's own asks of the host.
 *
 * The one check this process makes is who asked. The entry is a row on a
 * panel; everything else is the planning window's, since only it draws the
 * plan list, the setup sheet, and the document. What the host does with an
 * ask — which plan is active, what the service answers, why GitHub refused —
 * is the host's to decide, and comes back as the window's own answer.
 */
export interface PlanningActsDependencies {
  /** Opens the planning window, or brings the one already open forward. */
  openWindow: () => void;
  host: {
    planningRefresh(): Effect.Effect<void>;
    planningOpen(planId: string): Effect.Effect<boolean>;
    planningStart(request: PlanCreateRequest): Effect.Effect<PlanningStartAnswer>;
    planningRepositories(): Effect.Effect<PlanningRepositoriesAnswer>;
  };
  /**
   * The account-bound GitHub connection, begun from the setup sheet's
   * Connect GitHub button. How the connection is made is not settled yet;
   * this is the one door its flow fills, and until it does the press is
   * refused with a sentence the sheet draws.
   */
  connectGitHub: () => Effect.Effect<void, ActRefused>;
  /** The plan the window has open, as main holds the host's view of it. */
  activePlanId: () => string | undefined;
  /** Tells the voice window, which owns the call, that the plan's microphone was pressed. */
  talkAboutPlan: (planId: string) => void;
}

type PlanningActKind =
  | typeof ACT_KIND.PLANNING_OPEN_WINDOW
  | typeof ACT_KIND.PLANNING_REFRESH
  | typeof ACT_KIND.PLANNING_SELECT
  | typeof ACT_KIND.PLANNING_START
  | typeof ACT_KIND.PLANNING_REPOSITORIES
  | typeof ACT_KIND.PLANNING_CONNECT_GITHUB
  | typeof ACT_KIND.PLANNING_TALK;

/** The refusal a window that is not the planning window hears, in its kind's own words. */
function refuseUnlessPlanning(kind: PlanningActKind, sender: ActSender): void {
  if (!sender.planning) throw new ActRefused({ message: ACT[kind].refusal });
}

export function planningActRows(
  dependencies: PlanningActsDependencies,
): Pick<ActRows, PlanningActKind> {
  const { host } = dependencies;
  return {
    // The entry sits on a panel's Settings front page; the takeover and the
    // hidden voice window draw no such row.
    [ACT_KIND.PLANNING_OPEN_WINDOW]: (_payload, sender) => {
      if (!sender.panel || sender.introduction) {
        throw new ActRefused({ message: ACT[ACT_KIND.PLANNING_OPEN_WINDOW].refusal });
      }
      dependencies.openWindow();
    },
    [ACT_KIND.PLANNING_REFRESH]: (_payload, sender) => {
      refuseUnlessPlanning(ACT_KIND.PLANNING_REFRESH, sender);
      return host.planningRefresh();
    },
    [ACT_KIND.PLANNING_SELECT]: ({ planId }, sender) => {
      refuseUnlessPlanning(ACT_KIND.PLANNING_SELECT, sender);
      return host.planningOpen(planId);
    },
    [ACT_KIND.PLANNING_START]: (request, sender) => {
      refuseUnlessPlanning(ACT_KIND.PLANNING_START, sender);
      return host.planningStart(request);
    },
    [ACT_KIND.PLANNING_REPOSITORIES]: (_payload, sender) => {
      refuseUnlessPlanning(ACT_KIND.PLANNING_REPOSITORIES, sender);
      return host.planningRepositories();
    },
    [ACT_KIND.PLANNING_CONNECT_GITHUB]: (_payload, sender) => {
      refuseUnlessPlanning(ACT_KIND.PLANNING_CONNECT_GITHUB, sender);
      return dependencies.connectGitHub();
    },
    // The press names no plan: the plan is the one the host has open, read
    // here, so the window cannot open a call about a plan it is not showing.
    [ACT_KIND.PLANNING_TALK]: (_payload, sender) => {
      refuseUnlessPlanning(ACT_KIND.PLANNING_TALK, sender);
      const planId = dependencies.activePlanId();
      if (planId === undefined) {
        throw new ActRefused({ message: ACT[ACT_KIND.PLANNING_TALK].refusal });
      }
      dependencies.talkAboutPlan(planId);
    },
  };
}

/** What the Connect GitHub press answers until the connection's own flow lands. */
export const GITHUB_CONNECTION_PENDING = "Connecting GitHub from Luke is not available yet.";

/** The connection door as it stands until its flow is built: every press refused, worded for the sheet. */
export const connectGitHubPending = (): Effect.Effect<void, ActRefused> =>
  Effect.fail(new ActRefused({ message: GITHUB_CONNECTION_PENDING }));
