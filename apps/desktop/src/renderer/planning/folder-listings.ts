import { PLAN_CALL_FAILURE, type PlanningTreeAnswer } from "@sidecar/hosted/planning-view";

/**
 * folder-listings.ts -- the folders of a plan's repository a File tab's tree and breadcrumbs have listed, so a folder is listed once however many of them ask.
 *
 * A folder is listed once and the listing kept, the one in flight shared by
 * whoever asks meanwhile; a listing that did not land, or that the service
 * refused, is not kept, so the next ask lists it again. The store is the
 * File view's (`file-view.tsx`), which stands across File tabs, so moving
 * between them lists nothing twice, and coming back to a File tab from
 * another tab lists the repository afresh, as GitHub holds it then.
 */

/** Lists one folder of the repository, the root for the empty path. */
export type ListFolder = (path: string) => Promise<PlanningTreeAnswer>;

/** Lists folders through `read`, each kept once it is listed; a rejection reads as unanswered. */
export function keptListings(read: ListFolder): ListFolder {
  const kept = new Map<string, Promise<PlanningTreeAnswer>>();
  return (path) => {
    const standing = kept.get(path);
    if (standing !== undefined) return standing;
    const listing = read(path).then(
      (answer) => {
        if (!("folder" in answer)) kept.delete(path);
        return answer;
      },
      (): PlanningTreeAnswer => {
        kept.delete(path);
        return { failure: PLAN_CALL_FAILURE.UNANSWERED };
      },
    );
    kept.set(path, listing);
    return listing;
  };
}
