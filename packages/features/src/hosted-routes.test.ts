import { describe, expect, it } from "vitest";
import { hostedRouteOf } from "./hosted-routes.js";

describe("hostedRouteOf", () => {
  it.each([
    ["get", "/api/plans/task-1/agents?limit=5", ["agents", "listOfTask"]],
    ["GET", "/api/workspaces", ["workspaces", "list"]],
    ["DELETE", "/api/workspaces", undefined],
  ])("reads %s %s as the procedure it names", (method, path, procedure) => {
    expect(hostedRouteOf(method, path)?.procedure).toEqual(procedure);
  });
});
