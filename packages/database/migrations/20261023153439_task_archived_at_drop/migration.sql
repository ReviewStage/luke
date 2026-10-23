-- contract: a task is archived no longer, it stands Done or Canceled (#4448 settled every archived one), and nothing has read or written "archived_at" since #4542 reached production on Oct 22, over 25 hours ago; no index named it
ALTER TABLE "task" DROP COLUMN IF EXISTS "archived_at";
