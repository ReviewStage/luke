import { useEffect, useState } from "react";

type TasksModule = typeof import("./tasks-fixture.js");
type InboxModule = typeof import("./inbox-fixture.js");

type TasksFixture = {
  readonly fixtureReader: (run: { readonly profile: string }) => string | undefined;
} & Pick<
  TasksModule,
  | "fixtureTasksView"
  | "fixtureSidePanel"
  | "fixtureColumnTab"
  | "fixtureActAnswer"
  | "fixtureAppState"
  | "fixturePlace"
>;

let landed: TasksFixture | undefined;
let loading: Promise<void> | undefined;

function laidOver(tasks: TasksModule, inbox: InboxModule): TasksFixture {
  return {
    fixtureSidePanel: tasks.fixtureSidePanel,
    fixtureColumnTab: tasks.fixtureColumnTab,
    fixturePlace: tasks.fixturePlace,
    fixtureTasksView: (run) => {
      const view = tasks.fixtureTasksView(run);
      return view === undefined ? undefined : inbox.inboxTasksView(run.profile, view);
    },
    fixtureActAnswer: (run, kind, payload) =>
      inbox.inboxActAnswer(run.profile, kind, payload) ??
      tasks.fixtureActAnswer(run, kind, payload),
    fixtureAppState: (state) =>
      inbox.inboxAppState(tasks.fixtureAppState(state), tasks.FIXTURE_WORKSPACE_IDS),
    fixtureReader: (run) => inbox.inboxReader(run.profile),
  };
}

export function loadTasksFixture(): Promise<void> {
  loading ??= Promise.all([import("./tasks-fixture.js"), import("./inbox-fixture.js")]).then(
    ([tasks, inbox]) => {
      landed = laidOver(tasks, inbox);
    },
    () => undefined,
  );
  return loading;
}

export function loadedTasksFixture(): TasksFixture | undefined {
  return landed;
}

export function useTasksFixtureLanded(fixtureMode: boolean): boolean {
  const [settled, setSettled] = useState(landed !== undefined);
  useEffect(() => {
    if (!fixtureMode) return;
    let live = true;
    loadTasksFixture().then(() => {
      if (live) setSettled(true);
    });
    return () => {
      live = false;
    };
  }, [fixtureMode]);
  return !fixtureMode || settled;
}
