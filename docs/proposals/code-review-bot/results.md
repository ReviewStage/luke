# Spike results: the code review bot on real pull requests

Status: measured 2026-10-15 against `main` at `3f8e8cc8`. Every review here
ran on the harness in `harness/`. Each finding below was judged by hand, as
**useful** (a real defect the author would fix: Dean fixed it before merge,
or it was verified in the code), **nitpick**, or **wrong**.

## How a run works

`harness/review-run.sh` stands in for Luke's coding agent. Each run gets:

- a fresh clone of `ReviewStage/luke`;
- the task exactly as `automation-runs.ts` composes it for a GitHub firing:
  the preset's prompt, the "Luke started this run…" line, and the fenced
  `<github-event>`;
- headless Claude Code on **Claude Opus 5.5 at high effort**, Luke's default
  coding model, in an isolated `HOME`.

A `gh` and `git` shim refuses every write in a dry run. In a live run it
refuses any write that isn't on the test PR, and every write is logged.

**What differs from Luke:**

- The live reviews were posted from Dean's `gh` token, because this sandbox
  has no Luke App key. Each says so in its second line. In Luke the same
  `gh api` call goes out as `luke[bot]`, on the agent's installation token,
  which already carries `pull_requests: write`.
- The agent loop is Claude Code's, not eve's. The model, the task text, the
  tools (shell, file reads, workers), and `gh` are the same.

**Prompt versions.** v1 is the first prompt. v2 adds three lenses to look
through (over time, every consumer, and boundaries and rules), and adds that
a limitation the description names does not make its consequences
deliberate. "Bare" runs had only Bash, Read and Edit. "Full" runs also had
workers, Grep, Glob and web search. None of the full runs used a worker.

## 1. Live demo on a throwaway PR (ground truth known)

[#2751](https://github.com/ReviewStage/luke/pull/2751), "[spike] review-bot
test, do not merge", is a draft opened for this purpose. It adds a
`pull-request-merged` trigger with three planted bugs and no test.

| Run | Commit | What the bot did | Time / cost |
| --- | --- | --- | --- |
| r1 (v1, live) | `ff9b6f82` (bugs planted) | [Posted one review](https://github.com/ReviewStage/luke/pull/2751#pullrequestreview-5527992667) with 4 P1s: closed-but-unmerged fires as merged; a bot's merge skips the loop guard; the branch filter reads head, not base (with a one-line suggestion); no test, quoting AGENTS.md. **4/4 planted, 0 extra.** | 60 s, $0.24 |
| r2 (v1, live) | `f1216009` (fixes two of them) | **Resolved the two fixed threads, left the two unfixed ones alone, posted no new review.** | 55 s, $0.27 |
| r3 (final, live) | `ab691a96` (fixes head/base; adds a regression: a merge's labels dropped, under a comment calling it deliberate) | Resolved the head/base thread and left the test thread alone. **Missed the regression.** | 38 s, $0.28 |
| v1 full and v2 full (replay) | `ff9b6f82` | 4/4 planted, 0 extra, both prompts. | 50–54 s, $0.30–0.34 |
| final, 2 samples (replay) | `ab691a96` | Both flagged the missing test. Sample 1 also found an unplanted, real P1: **merges through GitHub's merge queue are sent by `github-merge-queue[bot]` (a Bot), so the trigger never fires on this repository**, citing `ci.yml`'s `merge_group`. Neither flagged the labels regression. | 53–68 s, $0.34–0.46 |

## 2. Dry runs on the final, merged code of 5 recent PRs (v1, bare)

The bot reviewed each PR at its merged head. Every finding here is a bug that
shipped.

| PR | Findings | Verdict |
| --- | --- | --- |
| #2746 | 1 P1: a PATCH can give a planless automation a GitHub trigger, and it then never fires. Create refuses it; PATCH doesn't. | **Useful.** Verified, and live on main. The spike fixes its root cause: the listener now hears workspace automations. |
| #2741, #2736, #2731, #2742 | none | Clean, with a one-line body. |

80–152 s and $0.34–0.65 each.

## 3. Replays against Devin Review (7 PRs, at the commit Devin first reviewed)

Each replay checks out the commit Devin's first review was on and takes the
diff from the merge base. It doesn't read any of the PR's reviews or
comments, which came later. Devin's findings at those commits were all fixed
by Dean before merge, so they count as real.

| PR | Devin (first review) | v1 bare | v1 full | v2 full |
| --- | --- | --- | --- | --- |
| #2746 | 2: workspace GitHub automations never fire 🔴; plan automations run outside their plan 🟡 | 0 | 0 | 0 |
| #2745 | 2: planless items missing from the sidebar count 🟡; planless names go stale 🟡 | 0 | 0 | 1 new: the test fixture drops the two new keys, so nothing tests them (fixed before merge) |
| #2742 | 1: a teammate's worker tab names the wrong Mac 🟡 | **1 = Devin's** | **1 = Devin's** | **1 = Devin's** |
| #2741 | 1: recovered ids leave teammates' questions badged 🟡 | 1 new: Home's Inbox lists a teammate's question only when you also have one there | same new one | same new one |
| #2736 | 3: failed switch hides the plan 🔴; moved plan reopens in the wrong workspace 🔴; stale Back 🟡 | **1 = Devin's** (moved plan, with a suggestion) | **1 = Devin's** | **1 = Devin's** |
| #2733 | 2: old workspace choice survives the switch 🔴; old failures pollute the new Inbox 🟡 | 1 new: a pure module under `apps/` breaks AGENTS.md's Layout rule (the author inlined it before merge, `db2d8740`) | 0 | **2 = Devin's** + the Layout one |
| #2730 | 3: unknown count says "Only you" 🟡; the editor list goes stale 🟡; an archived plan promises editing 🟡 | **2 = Devin's** (#1, #3) | **2 = Devin's** (#2, #3) | **2 = Devin's** (#2, #3) |
| **Total** | **14** | **6 posted: 4 Devin's + 2 new** | **5 posted: 4 + 1** | **9 posted: 6 + 3** |
| Useful / nitpick / wrong | 14 / 0 / 0 | **6 / 0 / 0** | **5 / 0 / 0** | **9 / 0 / 0** |
| Mean time / cost | 1–3 min / not published | 99 s / $0.48 | 78 s / $0.49 | 103 s / $0.65 |

The #2741 finding was traced end to end by a separate reader. It is
**correct, and still on main**:

- The sidebar and the Dock count only your own items, after #2741's filter
  (`packages/host/src/agent-notices.ts:347-356`).
- Home picks plans by that same filtered list, but then reads each plan's
  items whole. The service scopes that read by workspace membership, not by
  starter (`packages/service/src/inbox/inbox-store.ts:411-412`).
- So a plan with one item of yours and one of a teammate's shows 1 in the
  sidebar and 2 on Home.

## 4. What the numbers say

- **Precision is high.**
  - 36 comments were posted across every run, live and dry: 0 wrong, 0
    nitpicks.
  - Every planted bug was found on a first review.
  - Re-reviews resolved exactly the fixed threads and never reposted one.
  - Small sample: one repository and nine pull requests.
- **Recall is lower than Devin's on this repository.**
  - Of Devin's 14 first-review findings, v2 found 6 and v1 found 4. All
    prompts together found 7.
  - On the same commits the bot found 3 real issues Devin didn't raise
    (#2741, #2733, #2745). It also found the unplanted merge-queue bug on
    the test PR, which Devin never reviewed because it is a draft, and 2
    bugs live on main (#2741 and #2746).
  - Against the union of known real issues, v2's recall is about 53% and
    Devin's about 82%.
- **The misses cluster.**
  - Most are state that goes stale over time, and a second consumer that
    wasn't updated. v2's lenses recovered two of them (#2733's pair).
  - The planted labels regression was missed four times. It sat under a
    code comment calling it deliberate, and the prompt is told to respect
    stated intent.
- **Runs vary.** The same prompt on the same commit found 2 issues in one
  sample and 1 in the other (§1). #2733 got 1, 0, and 3 across the three
  variants. A single sample per PR is a noisy measure: judge prompts on
  several PRs, never on one.
- **Cost and time:** $0.24–0.83 and 38–152 s a review on Opus 5.5 high, plus
  the sandbox's minutes. The whole spike's reviews cost about $16.

## 5. How to rerun

```
pnpm exec tsx -e "import {codeReviewPreset} from './packages/features/src/automation-code-review.ts'; require('fs').writeFileSync('docs/proposals/code-review-bot/harness/review-prompt.md', codeReviewPreset().prompt)"
docs/proposals/code-review-bot/harness/review-run.sh <pr> dry /tmp/review-<pr>          # the merged head, writes nothing
docs/proposals/code-review-bot/harness/review-run.sh <pr> at /tmp/review-<pr> <sha>     # replay at a commit
```

It needs `gh` signed in, `ANTHROPIC_API_KEY`, and the `claude` CLI. A live run
posts on the PR it names, so use it only on a throwaway PR you opened.
