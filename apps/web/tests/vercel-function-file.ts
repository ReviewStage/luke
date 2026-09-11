/**
 * The file `vercel.json` names for a function path: the route bundled from
 * `server/routes/` into `api/`, so the extension is the bundle's and not the
 * source's.
 */
export function vercelFunctionFile(path: string): string {
  return `${path.replace(/^\//, "")}.js`;
}
