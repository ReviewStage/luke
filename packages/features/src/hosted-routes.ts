/**
 * hosted-routes.ts -- the hosted contract's procedures by their REST route, for a caller that names one by its method and path.
 *
 * `vespin api <method> <path>` reaches any procedure the contract declares
 * by the route its `openapi` meta names, so the command needs no table of
 * its own: a new procedure is reachable the moment the contract has it, and
 * a path no procedure has is refused before the member's bearer is sent
 * anywhere.
 */

import { ProcedureContract } from "@orpc/contract";
import { getOpenAPIMeta } from "@orpc/openapi";
import { HTTP_METHOD, type HttpMethod } from "@repo/wire";
import { hostedContract } from "./contract/index.js";

/** The marks around a path parameter in a route, as the contract spells one (`/api/tasks/{id}`). */
const PARAMETER = { OPEN: "{", CLOSE: "}" } as const;

/** One procedure's route: its method, its path's segments, and where it stands in the contract. */
export interface HostedRoute {
  readonly method: HttpMethod;
  readonly path: string;
  /** The procedure's keys in the contract, `["workspaces", "list"]`. */
  readonly procedure: readonly string[];
}

function isHttpMethod(method: string): method is HttpMethod {
  return Object.values<string>(HTTP_METHOD).includes(method);
}

/** Every procedure of the contract that names a route, walked once. */
function routesOf(node: unknown, at: readonly string[]): HostedRoute[] {
  if (node instanceof ProcedureContract) {
    const { method, path } = getOpenAPIMeta(node) ?? {};
    return method !== undefined && path !== undefined && isHttpMethod(method)
      ? [{ method, path, procedure: at }]
      : [];
  }
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, child]) => routesOf(child, [...at, key]));
}

/** Every route of the hosted contract, in the contract's order. */
const HOSTED_ROUTES: readonly HostedRoute[] = routesOf(hostedContract, []);

function segmentMatches(template: string, segment: string): boolean {
  const parameter = template.startsWith(PARAMETER.OPEN) && template.endsWith(PARAMETER.CLOSE);
  return parameter ? segment.length > 0 : template === segment;
}

function pathMatches(template: string, pathname: string): boolean {
  const templates = template.split("/");
  const segments = pathname.split("/");
  return (
    templates.length === segments.length &&
    templates.every((one, index) => segmentMatches(one, segments[index] ?? ""))
  );
}

/**
 * The procedure a method and a path name, its query left aside, or none: a
 * path a procedure declares under another method, or one no procedure
 * declares at all. A method is read whatever its case.
 */
export function hostedRouteOf(method: string, path: string): HostedRoute | undefined {
  const asked = method.toUpperCase();
  const pathname = path.split("?")[0] ?? "";
  return HOSTED_ROUTES.find((route) => route.method === asked && pathMatches(route.path, pathname));
}
