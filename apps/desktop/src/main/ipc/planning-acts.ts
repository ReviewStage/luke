import type {
  PlanningBoardSaveParams,
  PlanningSetFolderParams,
  PlanningStartAnswer,
  PlanningStartRequest,
} from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import { ACT, ACT_KIND } from "#shared/messages/acts";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * planning-acts.ts -- the Plans tab's acts: the panel's asks of the host about the named plans.
 *
 * The one check this process makes is who asked. Only a panel draws the
 * Plans tab, and the takeover and the hidden voice window draw no plan, so
 * every row refuses them. What the host does with an ask — which plan is
 * active, what the service answers — is the host's to
 * decide, and comes back as the panel's own answer. Nothing is held here.
 */
export interface PlanningActsDependencies {
  host: {
    planningRefresh(): Effect.Effect<void>;
    planningOpen(planId: string): Effect.Effect<boolean>;
    planningClose(): Effect.Effect<void>;
    planningDelete(planId: string): Effect.Effect<boolean>;
    planningStart(request: PlanningStartRequest): Effect.Effect<PlanningStartAnswer>;
    planningSetFolder(params: PlanningSetFolderParams): Effect.Effect<void>;
    planningBoardSave(params: PlanningBoardSaveParams): Effect.Effect<void>;
  };
  /** The folder picker; the chosen folder's absolute path, or null when the developer cancelled. */
  chooseFolder: () => Effect.Effect<string | null>;
  /** The plan the panel has open, as main holds the host's view of it. */
  activePlanId: () => string | undefined;
  /** Tells the voice window, which owns the call, that the plan's microphone was pressed. */
  talkAboutPlan: (planId: string) => void;
  /** Whether a call could open now: voice set up and the microphone already granted, so opening one asks the developer nothing. */
  voiceReady: () => boolean;
}

type PlanningActKind =
  | typeof ACT_KIND.PLANNING_REFRESH
  | typeof ACT_KIND.PLANNING_SELECT
  | typeof ACT_KIND.PLANNING_CLOSE
  | typeof ACT_KIND.PLANNING_START
  | typeof ACT_KIND.PLANNING_DELETE
  | typeof ACT_KIND.PLANNING_CHOOSE_FOLDER
  | typeof ACT_KIND.PLANNING_SET_FOLDER
  | typeof ACT_KIND.PLANNING_TALK
  | typeof ACT_KIND.PLANNING_BOARD_SAVE;

/** The refusal a window that draws no Plans tab hears, in its kind's own words. */
function refuseUnlessPanel(kind: PlanningActKind, sender: ActSender): void {
  if (!sender.panel) {
    throw new ActRefused({ message: ACT[kind].refusal });
  }
}

export function planningActRows(
  dependencies: PlanningActsDependencies,
): Pick<ActRows, PlanningActKind> {
  const { host } = dependencies;
  return {
    [ACT_KIND.PLANNING_REFRESH]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_REFRESH, sender);
      return host.planningRefresh();
    },
    [ACT_KIND.PLANNING_SELECT]: ({ planId }, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_SELECT, sender);
      return host.planningOpen(planId);
    },
    [ACT_KIND.PLANNING_CLOSE]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_CLOSE, sender);
      return host.planningClose();
    },
    // Note that a started plan opens its call at once, because pressing
    // Start plan is the developer's gesture and Luke opens a new plan by
    // greeting it; where the call would first have to ask for the
    // microphone, the plan's own microphone button asks instead.
    [ACT_KIND.PLANNING_START]: (request, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_START, sender);
      return Effect.tap(host.planningStart(request), (answer) =>
        Effect.sync(() => {
          if ("planId" in answer && dependencies.voiceReady()) {
            dependencies.talkAboutPlan(answer.planId);
          }
        }),
      );
    },
    [ACT_KIND.PLANNING_DELETE]: ({ planId }, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_DELETE, sender);
      return host.planningDelete(planId);
    },
    [ACT_KIND.PLANNING_CHOOSE_FOLDER]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_CHOOSE_FOLDER, sender);
      return dependencies.chooseFolder();
    },
    [ACT_KIND.PLANNING_SET_FOLDER]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_SET_FOLDER, sender);
      return host.planningSetFolder(params);
    },
    // The press names no plan: the plan is the one the host has open, read
    // here, so the panel cannot open a call about a plan it is not showing.
    [ACT_KIND.PLANNING_TALK]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_TALK, sender);
      const planId = dependencies.activePlanId();
      if (planId === undefined) {
        throw new ActRefused({ message: ACT[ACT_KIND.PLANNING_TALK].refusal });
      }
      dependencies.talkAboutPlan(planId);
    },
    [ACT_KIND.PLANNING_BOARD_SAVE]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_BOARD_SAVE, sender);
      return host.planningBoardSave(params);
    },
  };
}
