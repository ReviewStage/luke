# Try Chat (chat/try-it, DO NOT MERGE)

`pnpm check:affected` passes on this head. The branch is current `origin/main` with the chat chains merged on top.

Chat ships beside the Inbox: the Inbox stays exactly as main has it, and agents still ask you through it (`post_to_inbox`); Chat is where agents, Luke, and your team talk.

In: M1, S1–S3e, R1a–R1c, T1a–T2, P1, P2/P3 (try builds), D1–D6.
Not in: S4a/S4b, T3, D7 (the Inbox is not folded into Chat), X1.

Caveats:
- P2/P3 are test-only builds: they widen `DEPLOYMENT_TURNS` to TYPED turns, so a woken Luke turn runs as a typed turn. A woken Luke says nothing aloud on a live call, and a notice that arrives while a Luke turn runs folds into the next turn.
- Try-only wiring: every post (an agent's `post_chat`, Luke's, the window's) tells through one set of doors: a DM or mention of `@luke` wakes Luke, and one of a person is announced on their desktop.
- Each channel is read on its own cursor: Chat marks the channel on screen read; For you marks nothing.
- The renderer bundle budget is raised on this branch only, to hold Chat's views.

Preview: https://luke-web-git-chat-try-it-stage-review.vercel.app (the branch alias, always the newest build), on its own Neon branch `preview/chat/try-it`, which starts from production's data.

## On your Mac

```
git fetch origin && git switch chat/try-it && git reset --hard origin/chat/try-it
./scripts/bootstrap.sh
./scripts/run.sh --preview https://luke-web-git-chat-try-it-stage-review.vercel.app
```

(The branch was rebuilt on main, so an old checkout of it needs the `reset --hard`.)

## Script

1. Sign in, open a task on a repo.
2. Start two coding agents on it (`@agent-1`, `@agent-2`).
3. Tell agent-1: "post in the plan channel that you own the `memberships` table". It shows in Chat and in the task's Chat tab; agent-2's next turn opens with it (`[chat since you last read]`).
4. Tell agent-1: "DM @agent-2 asking it to rename the helper". Agent-2 gets one notice mid-turn and answers in the thread.
5. From Chat, ask in a channel or answer a message in its thread; the agent mentioned or replied to hears it.
6. From Chat, DM `@luke` with no call live. A Luke turn wakes and Luke answers with `post_chat`. Also tell an agent "DM @luke asking who owns the invite table".
7. With a second member of the workspace signed in on another desktop, have an agent DM or mention them: their desktop announces it once (toast, notification, Dock badge), not while Chat is on screen.
