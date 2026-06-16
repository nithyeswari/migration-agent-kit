# sdlc-toolkit

Cross-cutting plugin: peer review + Jira/GitHub lifecycle automation. Pair it with
`quarkus-migration` or `react-modernization` (or use standalone).

## Skills
- `peer-review`   — structured, stack-aware PR review; posts comments, never merges.
- `sdlc-workflow` — pick up a Jira issue, branch, open PR, link, transition.

## Agent
- `@reviewer` — read-only on code; can comment on PRs and move Jira tickets only.

## MCP servers (.mcp.json) — REAL, official remote servers
- `atlassian` -> https://mcp.atlassian.com/v1/mcp   (Jira + Confluence, OAuth 2.1)
- `github`    -> https://api.githubcopilot.com/mcp/  (repos, PRs, issues, OAuth)

Both authenticate as the signed-in user and honour existing permissions. In VS
Code they use OAuth on first use; no tokens in the file.

### If you are NOT on Atlassian Cloud (Jira Data Center / Server)
The official remote server is Cloud-only. For Data Center, swap the `atlassian`
entry for the self-hosted server (token auth):

    "atlassian": {
      "command": "uvx",
      "args": ["mcp-atlassian"],
      "env": {
        "JIRA_URL": "https://jira.your-bank.internal",
        "JIRA_PERSONAL_TOKEN": "${input:jira_pat}"
      }
    }

### GitHub Enterprise Cloud (data residency)
Point the `github` url at your tenant instead:
`https://copilot-api.<subdomain>.ghe.com/mcp`.

## Regulated-context notes
- MCP access in Copilot is org-policy gated — confirm the "MCP servers in Copilot"
  policy is enabled for your org.
- Prefer OAuth over PATs so actions are attributable and scoped to the user.
- The `reviewer` agent is deliberately write-restricted; keep it that way for
  audit separation (it reviews, humans approve/merge).
