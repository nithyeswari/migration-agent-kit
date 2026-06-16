---
name: peer-review
description: >
  Perform a structured peer review of a pull request. Use when the user asks to
  review a PR, do a code review, check a diff before merge, or review someone's
  changes. Stack-aware (Java/Quarkus and React/TypeScript). Uses the GitHub MCP
  to read the diff and post review comments, and the Atlassian MCP to check the
  change against its Jira issue.
license: Apache-2.0
metadata:
  author: Platform Engineering
---

# Peer review

A review is advisory. You read, assess, and post comments — you never approve,
merge, or push. A human approves.

## Tools used
- GitHub MCP (`github`): get PR + diff, list changed files, add review comments,
  add a summary comment. (No merge, no approve.)
- Atlassian MCP (`atlassian`): read the linked Jira issue to check the change
  matches its acceptance criteria.

## Critical rules
- **Never approve or merge.** Post comments and a summary only.
- **Comment on the diff, not the whole file.** Anchor each point to a file + line.
- **Separate blocking from non-blocking.** Prefix: `[blocking]`, `[nit]`,
  `[question]`. Don't bury a correctness bug among style nits.
- **Check scope against the ticket.** If the PR does more (or less) than its Jira
  issue's acceptance criteria, say so explicitly.
- **No secrets in comments.** If you spot a leaked token/key, flag its presence
  and location — never echo the value.

## Procedure

### 1. Gather context
- Read the PR (title, description, changed files, diff) via the GitHub MCP.
- Resolve the linked Jira issue (from the PR body / branch name) and read its
  acceptance criteria via the Atlassian MCP.

### 2. Review — universal checklist
- Correctness: does the change do what the ticket asks? Edge cases, error paths.
- Tests: new/changed behaviour has tests; tests actually assert the behaviour.
- Security: input validation, authz on new endpoints, no secrets committed,
  dependency additions are justified.
- Observability: meaningful logs/metrics; no `System.out`/`console.log` noise.
- Readability: naming, dead code, oversized functions.
- Backwards compatibility: API/contract changes, migrations, feature flags.

### 3. Review — stack specifics
Load the slice that matches the changed files:

**Java / Quarkus**
- CDI/JAX-RS correctness if migrated from Spring (no leftover Spring annotations).
- `@Transactional` boundaries and propagation.
- Reactive vs blocking: no blocking calls on the event loop.
- Config via `@ConfigMapping`, not stray `@ConfigProperty` sprawl.
- Native-image safety if the project builds native (reflection registration).

**React / TypeScript**
- Hooks rules: deps arrays complete, no conditional hooks, cleanup in effects.
- No `any` smuggled in; props/types tightened (post React 19 type changes).
- `forwardRef` removed where ref-as-prop now applies (React 19).
- Re-render cost: stable callbacks/memo only where measured, not cargo-culted.
- Accessibility on new UI: labels, roles, keyboard paths.

### 4. Post the review
- Add inline comments for each finding (file + line + prefix).
- Add ONE summary comment: a 2-3 line verdict, the blocking items as a checklist,
  then non-blocking notes. State clearly that this is an automated peer review and
  a human still needs to approve.
- Comment the review summary URL back onto the Jira issue (optional, via Atlassian
  MCP) so the ticket has the review trail.

## Audit
The summary comment is the durable review record. Keep it self-contained:
what was reviewed (PR + commit SHA), what blocks, what was checked. In a regulated
repo this comment is the artefact an auditor will look for.
