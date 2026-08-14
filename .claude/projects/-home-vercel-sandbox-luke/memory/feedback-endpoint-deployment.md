---
name: feedback-endpoint-deployment
description: Feedback emails stay undeliverable until RESEND_API_KEY is set on the tryluke.dev Vercel project
metadata:
  type: project
---

The desktop feedback composer (PR #87, 2026-08-14, branch dastratakos/feedback-and-prompt-form) posts to `https://tryluke.dev/api/feedback`, served by `apps/web/api/feedback.ts` on the Luke landing page (Vercel project `stage-review/luke-web`, rooted at `apps/web`). Dean explicitly chose tryluke.dev over stagereview.app for the API host; only the destination mailbox stays founders@stagereview.app. Until `RESEND_API_KEY` is set and tryluke.dev verified as a Resend sending domain for `feedback@tryluke.dev`, the endpoint answers 503 and the composer shows "could not take this right now". `LUKE_FEEDBACK_URL` overrides the endpoint for local testing of the desktop side.

**Why:** the endpoint is public and unauthenticated (Cursor security review flagged mail-quota abuse); it carries a best-effort per-instance rate limit, but the durable backstop the founders should add is a Vercel Firewall rate-limit rule on `POST /api/feedback`.

**How to apply:** when deploying, set the env var, verify the domain, and add the firewall rule in the same sitting. The `api/` dir keeps its own `tsconfig.json` (no Vite types) — Vercel's function builder compiles with the nearest tsconfig, and `"types": ["vite/client"]` fails the deployment (learned from PR #87's first failed deploy).
