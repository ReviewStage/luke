import { ProcedureContract } from "@orpc/contract";
import { getOpenAPIMeta } from "@orpc/openapi";
import { HTTP_METHOD, type HttpMethod } from "@repo/wire";
import { hostedContract } from "./contract/index.js";

const PARAMETER = { OPEN: "{", CLOSE: "}" } as const;

export interface HostedRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly procedure: readonly string[];
}

function isHttpMethod(method: string): method is HttpMethod {
  return Object.values<string>(HTTP_METHOD).includes(method);
}

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

export function hostedRouteOf(method: string, path: string): HostedRoute | undefined {
  const asked = method.toUpperCase();
  const pathname = path.split("?")[0] ?? "";
  return HOSTED_ROUTES.find((route) => route.method === asked && pathMatches(route.path, pathname));
}
