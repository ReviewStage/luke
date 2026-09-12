#!/usr/bin/env bash
set -euo pipefail

# Watches one pull request to the merge queue and out the other side.
#
#   scripts/queue-watch.sh [--press] [--repo OWNER/NAME] [--interval SECONDS]
#                          [--timeout-minutes MINUTES] PULL_REQUEST_NUMBER
#
# Unarmed, it polls until the ruleset's required contexts and the extra checks
# below have passed on the head and no review thread stands unresolved, prints
# READY with the head oid, and exits without touching the queue: a watcher is
# not armed until someone says to press. With --press it enqueues at that
# moment, dequeues if a thread appears while the entry stands, and reports how
# the queue ended. Every read and write goes through `gh`, so the test puts a
# fake one on PATH and the script never learns the difference.
#
# The one thing this script knows that a single read cannot: GitHub removes the
# queue entry before the pull request reads MERGED, so the tick on which the
# entry disappears looks identical for a merge and for an eviction, however
# atomically the fields were fetched. Only a later read tells them apart. On a
# vanished entry the watcher therefore waits QUEUE_WATCH_SETTLE_SECONDS and
# reads again: MERGED with the merge oid ends it; an entry that is back is
# still queued; anything else is an eviction, reported with the state the pull
# request settled into; and a re-read that fails is UNREADABLE, its own outcome
# and never a tie-break between the two.
#
# A drop (an eviction, or the watcher's own dequeue for a thread) is retried
# once and announced as a retry. A second drop ends the watch, because a
# watcher that never gives up cannot report failure.
#
# stdout carries the events and the last line is the outcome, each a token and
# its values; stderr carries progress. Outcomes and exit codes:
#
#   MERGED <merge-oid>                 0
#   READY <head-oid>                   0   (unarmed only)
#   CHECK_FAILED <context>             3
#   CONFLICTING <head-oid>             3
#   PRESS_FAILED <head-oid>            3
#   CLOSED <head-oid>                  4
#   EVICTED <state> <merge-state>      5
#   DEQUEUED <head-oid> <threads>      6
#   UNREADABLE <phase>                 7
#   TIMED_OUT <phase>                  8
#   usage or configuration             2
#
# A watcher started against a pull request already in the queue adopts the
# entry rather than pressing again; its retry budget starts fresh.

readonly EXIT_DONE=0
readonly EXIT_USAGE=2
readonly EXIT_BLOCKED=3
readonly EXIT_CLOSED=4
readonly EXIT_EVICTED=5
readonly EXIT_DEQUEUED=6
readonly EXIT_UNREADABLE=7
readonly EXIT_TIMED_OUT=8

readonly OUTCOME_MERGED=MERGED
readonly OUTCOME_READY=READY
readonly OUTCOME_CHECK_FAILED=CHECK_FAILED
readonly OUTCOME_CONFLICTING=CONFLICTING
readonly OUTCOME_PRESS_FAILED=PRESS_FAILED
readonly OUTCOME_CLOSED=CLOSED
readonly OUTCOME_EVICTED=EVICTED
readonly OUTCOME_DEQUEUED=DEQUEUED
readonly OUTCOME_UNREADABLE=UNREADABLE
readonly OUTCOME_TIMED_OUT=TIMED_OUT

readonly EVENT_ENQUEUED=ENQUEUED
readonly EVENT_RETRY=RETRY

readonly PHASE_GATE=gate
readonly PHASE_QUEUED=queued
readonly PHASE_SETTLE=settle

readonly GATE_PASS=PASS
readonly GATE_WAITING=WAITING
readonly GATE_THREADS=THREADS
readonly GATE_FAILED=FAILED
readonly GATE_CONFLICTING=CONFLICTING

readonly QUEUE_NONE=none
readonly PR_STATE_MERGED=MERGED
readonly PR_STATE_CLOSED=CLOSED

# One press and one retry: the whole budget of enqueues for a watch.
readonly ENQUEUE_BUDGET=2
# A read is retried this many times before the watch is declared blind.
readonly READ_ATTEMPTS=3

SETTLE_SECONDS=${QUEUE_WATCH_SETTLE_SECONDS:-30}
INTERVAL_SECONDS=30
TIMEOUT_MINUTES=120
PRESS=0
REPO=""
PULL_REQUEST_NUMBER=""

# The ruleset requires the contexts it names; the review bots are required by
# the workflow on top of it, because a verdict landing while queued is the trap
# on record. A build's own list can be replaced for a test, one name per line.
if [[ -n "${QUEUE_WATCH_EXTRA_REQUIRED_CHECKS+set}" ]]; then
    EXTRA_REQUIRED_CHECKS=()
    while IFS= read -r check_name; do
        [[ -n "$check_name" ]] && EXTRA_REQUIRED_CHECKS+=("$check_name")
    done <<<"$QUEUE_WATCH_EXTRA_REQUIRED_CHECKS"
else
    EXTRA_REQUIRED_CHECKS=("Cursor Bugbot" "Cursor Security Agent: Security Reviewer")
fi

usage() {
    printf 'usage: %s [--press] [--repo OWNER/NAME] [--interval SECONDS] [--timeout-minutes MINUTES] PULL_REQUEST_NUMBER\n' "$0" >&2
    exit "$EXIT_USAGE"
}

require_integer() {
    if [[ ! $2 =~ ^[0-9]+$ ]]; then
        printf 'error: %s takes a whole number of %s, not %s\n' "$1" "$3" "$2" >&2
        exit "$EXIT_USAGE"
    fi
}

while (($# > 0)); do
    case $1 in
    --press) PRESS=1 ;;
    --repo)
        (($# >= 2)) || usage
        REPO=$2
        shift
        ;;
    --interval)
        (($# >= 2)) || usage
        require_integer --interval "$2" seconds
        INTERVAL_SECONDS=$2
        shift
        ;;
    --timeout-minutes)
        (($# >= 2)) || usage
        require_integer --timeout-minutes "$2" minutes
        TIMEOUT_MINUTES=$2
        shift
        ;;
    -h | --help) usage ;;
    -*) usage ;;
    *)
        [[ -z "$PULL_REQUEST_NUMBER" ]] || usage
        require_integer 'the pull request' "$1" 'its number'
        PULL_REQUEST_NUMBER=$1
        ;;
    esac
    shift
done
[[ -n "$PULL_REQUEST_NUMBER" ]] || usage
require_integer QUEUE_WATCH_SETTLE_SECONDS "$SETTLE_SECONDS" seconds

for required_command in gh node; do
    if ! command -v "$required_command" >/dev/null 2>&1; then
        printf 'error: required command not found: %s\n' "$required_command" >&2
        exit "$EXIT_USAGE"
    fi
done

if [[ -z "$REPO" ]]; then
    if ! REPO=$(gh repo view --json nameWithOwner | node -e '
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => process.stdout.write(JSON.parse(input).nameWithOwner));
    '); then
        printf 'error: could not read the repository; pass --repo OWNER/NAME\n' >&2
        exit "$EXIT_USAGE"
    fi
fi
if [[ ! $REPO =~ ^[^/]+/[^/]+$ ]]; then
    printf 'error: --repo takes OWNER/NAME, not %s\n' "$REPO" >&2
    exit "$EXIT_USAGE"
fi
OWNER=${REPO%/*}
NAME=${REPO#*/}

# Everything a tick decides on is fetched in one request: the state and merge
# commit, the queue entry, the unresolved threads, the base branch's required
# contexts, and the head's check rollup. The pairing of `mergeQueueEntry` with
# `state` in one document is still not enough to tell a merge from an eviction
# (see above); it only keeps the two from being read a tick apart.
readonly READ_QUERY='query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      state
      mergeable
      mergeStateStatus
      headRefOid
      mergeCommit { oid }
      mergeQueueEntry { state position }
      reviewThreads(first: 100) { nodes { isResolved } }
      baseRef {
        rules(first: 50) {
          nodes {
            type
            parameters {
              ... on RequiredStatusChecksParameters { requiredStatusChecks { context } }
            }
          }
        }
      }
      statusCheckRollup {
        contexts(first: 100) {
          nodes {
            __typename
            ... on CheckRun { name status conclusion }
            ... on StatusContext { context state }
          }
        }
      }
    }
  }
}'

readonly ENQUEUE_MUTATION='mutation($id: ID!, $head: GitObjectID!) {
  enqueuePullRequest(input: { pullRequestId: $id, expectedHeadOid: $head }) {
    mergeQueueEntry { id state position }
  }
}'

readonly DEQUEUE_MUTATION='mutation($id: ID!) {
  dequeuePullRequest(input: { id: $id }) {
    mergeQueueEntry { id }
  }
}'

# Reduces one read to a single line of fields, in this order:
#   id state merge-oid head-oid queue-state unresolved-threads mergeable
#   merge-state gate gate-detail
# with `-` standing for an absent value. The gate detail is last because a
# context name may contain spaces and `read` folds the remainder into its last
# variable. A required check counts as passed on the conclusions the ruleset
# itself accepts (success, neutral, skipped); a check not yet reported, or
# still running, is waited for; any other conclusion fails the gate outright,
# since a red check does not turn green without a push the watcher would not
# see coming.
readonly SUMMARIZE_READ='
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const extraRequired = process.argv.slice(1);
    const pullRequest = JSON.parse(input).data.repository.pullRequest;
    const requiredFromRules = pullRequest.baseRef.rules.nodes
      .filter((rule) => rule.type === "REQUIRED_STATUS_CHECKS")
      .flatMap((rule) => rule.parameters.requiredStatusChecks.map((check) => check.context));
    const required = [...new Set([...requiredFromRules, ...extraRequired])];
    const latestByName = new Map();
    for (const node of pullRequest.statusCheckRollup?.contexts.nodes ?? []) {
      latestByName.set(node.__typename === "CheckRun" ? node.name : node.context, node);
    }
    const PASSING_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
    const PENDING_STATUS_STATES = new Set(["PENDING", "EXPECTED"]);
    let waiting = false;
    let failed = null;
    for (const name of required) {
      const node = latestByName.get(name);
      if (node === undefined) {
        waiting = true;
      } else if (node.__typename === "CheckRun") {
        if (node.status !== "COMPLETED") waiting = true;
        else if (!PASSING_CONCLUSIONS.has(node.conclusion)) failed ??= name;
      } else if (PENDING_STATUS_STATES.has(node.state)) {
        waiting = true;
      } else if (node.state !== "SUCCESS") {
        failed ??= name;
      }
    }
    const unresolved = pullRequest.reviewThreads.nodes.filter((thread) => !thread.isResolved).length;
    const mergeable = pullRequest.mergeable ?? "-";
    let gate;
    let detail = "-";
    if (failed !== null) {
      gate = "FAILED";
      detail = failed;
    } else if (mergeable === "CONFLICTING") {
      gate = "CONFLICTING";
    } else if (waiting || mergeable === "UNKNOWN") {
      gate = "WAITING";
    } else if (unresolved > 0) {
      gate = "THREADS";
    } else {
      gate = "PASS";
    }
    process.stdout.write(
      [
        pullRequest.id,
        pullRequest.state,
        pullRequest.mergeCommit?.oid ?? "-",
        pullRequest.headRefOid,
        pullRequest.mergeQueueEntry?.state ?? "none",
        String(unresolved),
        mergeable,
        pullRequest.mergeStateStatus ?? "-",
        gate,
        detail,
      ].join(" "),
    );
  });
'

PR_ID=""
PR_STATE=""
MERGE_OID=""
HEAD_OID=""
QUEUE_STATE=""
UNRESOLVED=""
MERGEABLE=""
MERGE_STATE=""
GATE=""
GATE_DETAIL=""

# Fills the fields above from one read, retrying a failed request a bounded
# number of times. Returns non-zero once the budget is spent, and decides
# nothing itself: the caller names the outcome.
read_pull_request() {
    local attempt summary
    for ((attempt = 1; attempt <= READ_ATTEMPTS; attempt++)); do
        if summary=$(gh api graphql -f query="$READ_QUERY" -F owner="$OWNER" -F name="$NAME" \
            -F number="$PULL_REQUEST_NUMBER" |
            node -e "$SUMMARIZE_READ" -- ${EXTRA_REQUIRED_CHECKS[@]+"${EXTRA_REQUIRED_CHECKS[@]}"}); then
            read -r PR_ID PR_STATE MERGE_OID HEAD_OID QUEUE_STATE UNRESOLVED MERGEABLE MERGE_STATE GATE GATE_DETAIL <<<"$summary"
            return 0
        fi
        printf 'read %d of %d failed\n' "$attempt" "$READ_ATTEMPTS" >&2
        if ((attempt < READ_ATTEMPTS)); then
            sleep "$INTERVAL_SECONDS"
        fi
    done
    return 1
}

finish() {
    local code=$1
    shift
    printf '%s\n' "$*"
    exit "$code"
}

enqueues=0
phase=$PHASE_GATE

# A drop has one retry. The first is announced and sends the watch back to the
# gate, where the press happens again only once the gate passes again; the
# second ends the watch with the outcome the drop earned. An unarmed watcher
# adopting someone else's entry has nothing to retry with and reports the drop.
drop() {
    local code=$1
    shift
    if ((PRESS == 1 && enqueues < ENQUEUE_BUDGET)); then
        printf '%s %d after %s\n' "$EVENT_RETRY" "$enqueues" "$*"
        phase=$PHASE_GATE
        return 0
    fi
    finish "$code" "$@"
}

deadline=$((SECONDS + TIMEOUT_MINUTES * 60))

while :; do
    if ((SECONDS >= deadline)); then
        finish "$EXIT_TIMED_OUT" "$OUTCOME_TIMED_OUT" "$phase"
    fi
    if ! read_pull_request; then
        finish "$EXIT_UNREADABLE" "$OUTCOME_UNREADABLE" "$phase"
    fi
    printf '%s: state=%s queue=%s threads=%s gate=%s head=%s\n' \
        "$phase" "$PR_STATE" "$QUEUE_STATE" "$UNRESOLVED" "$GATE" "${HEAD_OID:0:8}" >&2

    case $PR_STATE in
    "$PR_STATE_MERGED") finish "$EXIT_DONE" "$OUTCOME_MERGED" "$MERGE_OID" ;;
    "$PR_STATE_CLOSED") finish "$EXIT_CLOSED" "$OUTCOME_CLOSED" "$HEAD_OID" ;;
    esac

    if [[ $QUEUE_STATE != "$QUEUE_NONE" ]]; then
        phase=$PHASE_QUEUED
        if ((UNRESOLVED > 0)); then
            # The queue checked threads at enqueue and will not look again; the
            # watcher takes the entry out so the thread is answered before the
            # merge, not after. A dequeue that fails is left to the next read,
            # which sees either the entry still standing or the merge that
            # outran the thread.
            if gh api graphql -f query="$DEQUEUE_MUTATION" -F id="$PR_ID" >/dev/null; then
                drop "$EXIT_DEQUEUED" "$OUTCOME_DEQUEUED" "$HEAD_OID" "$UNRESOLVED"
            else
                printf 'dequeue failed; reading again\n' >&2
            fi
        fi
        sleep "$INTERVAL_SECONDS"
        continue
    fi

    if [[ $phase == "$PHASE_QUEUED" ]]; then
        phase=$PHASE_SETTLE
        sleep "$SETTLE_SECONDS"
        if ! read_pull_request; then
            finish "$EXIT_UNREADABLE" "$OUTCOME_UNREADABLE" "$phase"
        fi
        if [[ $PR_STATE == "$PR_STATE_MERGED" ]]; then
            finish "$EXIT_DONE" "$OUTCOME_MERGED" "$MERGE_OID"
        fi
        if [[ $QUEUE_STATE != "$QUEUE_NONE" ]]; then
            phase=$PHASE_QUEUED
            continue
        fi
        drop "$EXIT_EVICTED" "$OUTCOME_EVICTED" "$PR_STATE" "$MERGE_STATE"
        continue
    fi

    case $GATE in
    "$GATE_FAILED") finish "$EXIT_BLOCKED" "$OUTCOME_CHECK_FAILED" "$GATE_DETAIL" ;;
    "$GATE_CONFLICTING") finish "$EXIT_BLOCKED" "$OUTCOME_CONFLICTING" "$HEAD_OID" ;;
    "$GATE_PASS")
        if ((PRESS == 0)); then
            finish "$EXIT_DONE" "$OUTCOME_READY" "$HEAD_OID"
        fi
        # The press names the head it was decided on, so a push between the
        # read and the press is refused by GitHub rather than queued unseen.
        if ! gh api graphql -f query="$ENQUEUE_MUTATION" -F id="$PR_ID" -F head="$HEAD_OID" >/dev/null; then
            finish "$EXIT_BLOCKED" "$OUTCOME_PRESS_FAILED" "$HEAD_OID"
        fi
        enqueues=$((enqueues + 1))
        printf '%s %s %d\n' "$EVENT_ENQUEUED" "$HEAD_OID" "$enqueues"
        phase=$PHASE_QUEUED
        ;;
    "$GATE_WAITING" | "$GATE_THREADS") ;;
    esac
    sleep "$INTERVAL_SECONDS"
done
