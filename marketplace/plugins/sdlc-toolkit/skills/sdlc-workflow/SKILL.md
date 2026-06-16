---
name: sdlc-workflow
description: >
  Drive a change through the SDLC using Jira and GitHub. Use when the user wants
  to pick up a Jira issue, transition a ticket, create a branch/PR for an issue,
  link a PR to Jira, or move work across the board (To Do -> In Progress -> In
  Review -> Done). Relies on the Atlassian and GitHub MCP servers.
license: Apache-2.0
metadata:
  author: Platform Engineering
---

# SDLC workflow (Jira + GitHub)

This skill orchestrates the lifecycle. It does NOT do the engineering work —
hand the actual migration/coding to the relevant skill (`migrate-spring-to-quarkus`,
`modernize-react`) and use this skill to keep Jira and GitHub in sync around it.

## Tools used
- Atlassian MCP (`atlassian`): search issues (JQL), read issue, transition issue,
  add comment, create subtask.
- GitHub MCP (`github`): create branch, open pull request, list PRs, add PR comment.

## Critical rules
- **Never transition a ticket the user didn't ask you to.** State the intended
  transition and the target status, then do it. One transition per step.
- **Never auto-merge or close a PR.** Opening and commenting only; merge is a
  human action.
- **Every state change is traceable.** After a transition, post the new status
  and a link (PR URL or commit) back to the Jira issue as a comment.
- **Respect access.** Both MCP servers act as the signed-in user and honour their
  existing Jira/GitHub permissions — if an action is denied, surface it, don't
  retry with elevated scope.

## Flow

### 1. Pick up an issue
- Resolve the issue (key given, or JQL like `assignee = currentUser() AND
  status = "To Do" ORDER BY priority`).
- Show the summary, acceptance criteria, and linked design. Confirm with the user
  before starting.
- Transition: `To Do -> In Progress`. Comment: "Picked up, starting work."

### 2. Branch
- Branch name from the issue key: `feature/<KEY>-<kebab-summary>`
  (e.g. `feature/ADE-1234-migrate-payments-module`).
- Create it from the default branch via the GitHub MCP.

### 3. Do the work
- Defer to the engineering skill. Keep commits scoped; reference the issue key in
  commit messages (`ADE-1234: ...`).

### 4. Open the PR
- Open a PR against the default branch. Title and body follow the team's PR
  conventions (see the `peer-review` skill).
- Put `Closes <KEY>` or the issue link in the PR body so Jira and GitHub link.
- Comment the PR URL back onto the Jira issue.
- Transition: `In Progress -> In Review`.

### 5. Review handoff
- Hand to the `peer-review` skill to produce the review.
- Do NOT move to Done. After a human merges, transition `In Review -> Done` only
  when asked, and comment the merge commit on the issue.

## Audit
Every transition and comment this skill makes is an auditable SDLC event. If the
team keeps a change log, append: timestamp, issue key, from-status, to-status,
actor, and the PR/commit reference.
