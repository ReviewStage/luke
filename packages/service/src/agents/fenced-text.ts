/**
 * fenced-text.ts -- words someone other than the developer wrote, spelled so they can sit inside a fence an agent reads as data.
 *
 * An automation's run hands its agent a GitHub event's fields and a
 * webhook's body (`automations/automation-runs.ts`), and a review or a
 * comment on an agent's pull request reaches the agent with what it says
 * (`github/agent-wakes.ts`). Each is written by whoever caused it, so each
 * is handed inside a tag the agent is told to read as data, and spelled
 * here so it cannot close that tag and speak outside it.
 */

/**
 * Text written by someone other than the developer, its angle brackets and
 * ampersands spelled as entities, so it cannot close the fence it is read
 * inside and speak outside it.
 */
export function fenceable(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * The text fenced, whole where its fenced spelling fits `room`, and
 * otherwise its longest start whose fenced spelling fits with `cutMark`
 * after it, so a cut never splits an entity.
 */
export function fencedWithin(text: string, room: number, cutMark: string): string {
  const fenced = fenceable(text);
  if (fenced.length <= room) return fenced;
  const budget = Math.max(0, room - cutMark.length);
  let kept = "";
  for (const character of text) {
    const spelled = fenceable(character);
    if (kept.length + spelled.length > budget) break;
    kept += spelled;
  }
  return `${kept}${cutMark}`;
}
