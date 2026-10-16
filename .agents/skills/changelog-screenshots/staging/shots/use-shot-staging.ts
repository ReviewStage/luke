/**
 * use-shot-staging.ts -- the one fixture-only effect that lays a shot's window out: the sidebar, the side panel, the plan's column, Settings, the version history, and ⌘K, each once, the first render it can be.
 *
 * Throwaway (`README.md`). Called from `App` with the Plans tab and the
 * sidebar. Each step of the shot's layout (`ShotLayout`) and each step of
 * its own (`ShotSpec.steps`) runs once, the first render on which what it
 * needs is drawn: a plan's tab once the plan is drawn, an agent's once the
 * agent is listed, a full-screen panel once the panel is open.
 */

import { useEffect, useRef } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { runAppCommand } from "../app-commands";
import { DOCUMENT_REGION } from "../planning/planning-model";
import { isAgentTab } from "../planning/tab-strip-model";
import type { SidePanelTab } from "../tasks/use-side-panel";
import { armPaletteQuery } from "./palette-query";
import { currentShot } from "./shot-profiles";
import type { ShotSpec, ShotStageContext, ShotStep } from "./shot-spec";

/** The open plan, once it is drawn; none before. */
function drawnTask(context: ShotStageContext): string | undefined {
  const { tasks } = context;
  return tasks.region.kind === DOCUMENT_REGION.READY ? tasks.activeTaskId : undefined;
}

/** Whether a side panel tab can be chosen yet: a Changes tab once the agents are read, a page's once the plan names it. */
function tabReady(context: ShotStageContext, tab: SidePanelTab): boolean {
  const { tasks } = context;
  if (typeof tab === "object" && "changes" in tab)
    return tasks.agents.agentIds?.includes(tab.changes) ?? false;
  if (typeof tab === "object" && "page" in tab)
    return (tasks.pages ?? []).some((page) => page.id === tab.page);
  return true;
}

/** The steps a shot's layout asks for, in the order they run. */
function layoutSteps(shot: ShotSpec): ShotStep[] {
  const layout = shot.layout ?? {};
  const steps: ShotStep[] = [];
  const {
    sidebarCollapsed,
    settingsView,
    history,
    mainTab,
    sidePanelTabs,
    sidePanelFile,
    palette,
  } = layout;
  if (layout.bylines === true) {
    steps.push({
      key: "bylines",
      ready: () => true,
      run: () => {
        document.documentElement.dataset.shotBylines = "true";
      },
    });
  }
  if (sidebarCollapsed !== undefined) {
    steps.push({
      key: "sidebar",
      ready: ({ sidebar }) => sidebar.staged,
      run: ({ sidebar }) => {
        if (sidebar.collapsed !== sidebarCollapsed) sidebar.onToggle();
      },
    });
  }
  if (settingsView !== undefined) {
    steps.push({
      key: "settings",
      ready: () => true,
      run: ({ openSettings }) => openSettings(settingsView),
    });
  }
  if (history !== undefined) {
    steps.push({
      key: "history",
      ready: (context) => drawnTask(context) !== undefined,
      run: (context) => {
        const taskId = drawnTask(context);
        if (taskId !== undefined) context.tasks.history.onReturn(taskId, history);
      },
    });
  }
  if (mainTab !== undefined) {
    steps.push({
      key: "main-tab",
      ready: (context) =>
        drawnTask(context) !== undefined &&
        (!isAgentTab(mainTab) || (context.tasks.agents.agentIds?.includes(mainTab.agent) ?? false)),
      run: (context) => {
        const taskId = drawnTask(context);
        if (taskId === undefined) return;
        if (isAgentTab(mainTab)) context.tasks.onShowAgent(taskId, mainTab.agent);
        else context.tasks.onShowInbox(taskId);
      },
    });
  }
  if (sidePanelTabs !== undefined && sidePanelTabs.length > 0) {
    steps.push({
      key: "side-panel-tabs",
      ready: (context) =>
        drawnTask(context) !== undefined && sidePanelTabs.every((tab) => tabReady(context, tab)),
      run: ({ tasks }) => {
        for (const tab of sidePanelTabs) tasks.sidePanel.onChoose(tab);
      },
    });
  }
  if (sidePanelFile !== undefined) {
    steps.push({
      key: "side-panel-file",
      ready: (context) => drawnTask(context) !== undefined,
      run: ({ tasks }) => tasks.sidePanel.onBrowseFile(sidePanelFile, sidePanelFile, true),
    });
  }
  if (layout.sidePanelFullScreen === true) {
    steps.push({
      key: "full-screen",
      ready: (context) => drawnTask(context) !== undefined && context.tasks.sidePanel.open,
      run: ({ tasks }) => {
        if (!tasks.sidePanel.fullScreen) tasks.sidePanel.onToggleFullScreen();
      },
    });
  }
  if (palette !== undefined) {
    steps.push({
      key: "palette",
      ready: (context) =>
        drawnTask(context) !== undefined && context.tasks.agents.agentIds !== undefined,
      run: () => {
        armPaletteQuery(palette.query);
        runAppCommand(APP_COMMAND.COMMAND_PALETTE);
      },
    });
  }
  return steps;
}

/** Stages the shot this run is for, if any; `known` once the state has arrived and the window is past its gate. */
export function useShotStaging(context: ShotStageContext, known: boolean): void {
  const done = useRef(new Set<string>());
  const latest = useRef(context);
  latest.current = context;
  useEffect(() => {
    if (!known) return;
    const shot = currentShot();
    if (shot === undefined) return;
    for (const step of [...layoutSteps(shot), ...(shot.steps ?? [])]) {
      if (done.current.has(step.key) || !step.ready(latest.current)) continue;
      done.current.add(step.key);
      step.run(latest.current);
    }
  });
}
