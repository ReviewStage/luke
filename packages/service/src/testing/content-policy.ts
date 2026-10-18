// content-policy.ts -- the parts of a response's content security policy that decide what a page opened from it may do.

/**
 * A response's `sandbox` and `default-src` directives, each as the values it
 * names, or absent where the policy names none. A suite compares these rather
 * than the policy's whole text, so a directive the policy gains beside them
 * moves nothing, and a sandbox that grants a page anything, or a page let
 * load anything, does.
 */
export interface OpenedPagePolicy {
  readonly sandbox: readonly string[] | undefined;
  readonly defaultSrc: readonly string[] | undefined;
}

/** What served bytes are answered under: a sandbox that grants a page nothing, and nothing a page may load. */
export const SANDBOXED_PAGE: OpenedPagePolicy = { sandbox: [], defaultSrc: ["'none'"] };

/** The `sandbox` and `default-src` a response's `content-security-policy` names. */
export function openedPagePolicy(headers: Headers): OpenedPagePolicy {
  const directives = new Map(
    (headers.get("content-security-policy") ?? "")
      .split(";")
      .map((directive) => directive.trim().split(/\s+/u))
      .filter(([name]) => name !== undefined && name !== "")
      .map(([name = "", ...values]): [string, string[]] => [name.toLowerCase(), values]),
  );
  return { sandbox: directives.get("sandbox"), defaultSrc: directives.get("default-src") };
}
