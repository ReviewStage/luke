import type { PlanCreateRequest } from "@sidecar/hosted/plan-wire";
import type {
  PlanningRepositoriesAnswer,
  PlanningStartAnswer,
} from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND } from "#shared/messages/acts";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * planning-acts.ts -- the Plans tab's acts: the panel's asks of the host about the named plans.
 *
 * The one check this process makes is who asked. Only a panel draws the
 * Plans tab, and the takeover and the hidden voice window draw no plan, so
 * every row refuses them. What the host does with an ask — which plan is
 * active, what the service answers, why GitHub refused — is the host's to
 * decide, and comes back as the panel's own answer. The one thing held here
 * is which panels show the tab, since the host's follow is one for the whole
 * process and each display has a panel of its own.
 */
export interface PlanningActsDependencies {
  host: {
    planningRefresh(): Effect.Effect<void>;
    planningPause(): Effect.Effect<void>;
    planningOpen(planId: string): Effect.Effect<boolean>;
    planningClose(): Effect.Effect<void>;
    planningStart(request: PlanCreateRequest): Effect.Effect<PlanningStartAnswer>;
    planningRepositories(): Effect.Effect<PlanningRepositoriesAnswer>;
    /** Opens the Connect GitHub page in the browser; whether it opened. */
    planningConnectGitHub(): Effect.Effect<boolean>;
  };
  /** The plan the panel has open, as main holds the host's view of it. */
  activePlanId: () => string | undefined;
  /** Tells the voice window, which owns the call, that the plan's microphone was pressed. */
  talkAboutPlan: (planId: string) => void;
  /** Whether a call could open now: voice set up and the microphone already granted, so opening one asks the developer nothing. */
  voiceReady: () => boolean;
  /** Whether a panel's window is already destroyed, as one whose ask was still in flight can be. */
  isGone: (sender: WebContents) => boolean;
  /** Runs `gone` once when a panel's window is destroyed, so a panel that vanished mid-follow stops counting. */
  whenGone: (sender: WebContents, gone: Effect.Effect<void>) => void;
}

type PlanningActKind =
  | typeof ACT_KIND.PLANNING_REFRESH
  | typeof ACT_KIND.PLANNING_PAUSE
  | typeof ACT_KIND.PLANNING_SELECT
  | typeof ACT_KIND.PLANNING_CLOSE
  | typeof ACT_KIND.PLANNING_START
  | typeof ACT_KIND.PLANNING_REPOSITORIES
  | typeof ACT_KIND.PLANNING_CONNECT_GITHUB
  | typeof ACT_KIND.PLANNING_TALK;

/** The refusal a window that draws no Plans tab hears, in its kind's own words. */
function refuseUnlessPanel(kind: PlanningActKind, sender: ActSender): void {
  if (!sender.panel || sender.introduction) {
    throw new ActRefused({ message: ACT[kind].refusal });
  }
}

export function planningActRows(
  dependencies: PlanningActsDependencies,
): Pick<ActRows, PlanningActKind> {
  const { host } = dependencies;
  // Note that the follow is paused only once no panel shows the tab, because
  // one display's panel closing must not stop the plan another is drawing.
  const showing = new Set<WebContents>();
  const stopShowing = (sender: WebContents) =>
    Effect.suspend(() =>
      showing.delete(sender) && showing.size === 0 ? host.planningPause() : Effect.void,
    );
  return {
    [ACT_KIND.PLANNING_REFRESH]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_REFRESH, sender);
      // A refresh landing after its panel was torn down asks for nothing,
      // since no destroyed event is left to pause what it would arm.
      if (dependencies.isGone(sender.sender)) return Effect.void;
      if (!showing.has(sender.sender)) {
        showing.add(sender.sender);
        dependencies.whenGone(sender.sender, stopShowing(sender.sender));
      }
      return host.planningRefresh();
    },
    [ACT_KIND.PLANNING_PAUSE]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_PAUSE, sender);
      return stopShowing(sender.sender);
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
    [ACT_KIND.PLANNING_REPOSITORIES]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_REPOSITORIES, sender);
      return host.planningRepositories();
    },
    // The link itself happens in the browser, under the developer's Luke
    // session there; the press opens the page and the form reads the
    // repositories again once the developer comes back.
    [ACT_KIND.PLANNING_CONNECT_GITHUB]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.PLANNING_CONNECT_GITHUB, sender);
      return Effect.flatMap(host.planningConnectGitHub(), (opened) =>
        opened ? Effect.void : Effect.fail(new ActRefused({ message: GITHUB_CONNECT_SIGNED_OUT })),
      );
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
  };
}

/** What the Connect GitHub press answers when the host opened nothing, because no account is signed in. */
export const GITHUB_CONNECT_SIGNED_OUT = "Sign in to Luke to connect GitHub.";
