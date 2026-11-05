import { describe, expect, it } from "vitest";
import { hostedRouteOf } from "./hosted-routes.js";

// Note that the regression these catch is a route matched past its parameters or its method, so
// `vespin api` sends the member's bearer where no procedure answers, or refuses one that does.
describe("hostedRouteOf", () => {
  it.each([
    ["get", "/api/plans/task-1/agents?limit=5", ["agents", "listOfTask"]],
    ["GET", "/api/workspaces", ["workspaces", "list"]],
    ["DELETE", "/api/workspaces", undefined],
  ])("reads %s %s as the procedure it names", (method, path, procedure) => {
    expect(hostedRouteOf(method, path)?.procedure).toEqual(procedure);
  });
});
