export interface OpenedPagePolicy {
  readonly sandbox: readonly string[] | undefined;
  readonly defaultSrc: readonly string[] | undefined;
}

export const SANDBOXED_PAGE: OpenedPagePolicy = { sandbox: [], defaultSrc: ["'none'"] };

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
