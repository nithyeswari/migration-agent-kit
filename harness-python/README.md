# Quarkus migration agent — config-driven

A worked example of **tools, skills, agents and plugins** applied to a Spring
Boot → Quarkus migration, with a real **agent loop** and **harness**. Every
behaviour is driven by `config/migration.yaml` — change the config, not the code.

## How the four concepts map to files

| Concept    | Copilot-native file                          | Standalone harness                  |
|------------|----------------------------------------------|-------------------------------------|
| **Tool**   | `copilot/.mcp.json` (MCP) + built-ins        | `harness/tools.py` (registry)       |
| **Skill**  | `copilot/skills/spring-to-quarkus/SKILL.md`  | loaded into the system prompt       |
| **Agent**  | `copilot/agents/quarkus-migrator.agent.md`   | `config: agent.*` + persona prompt  |
| **Plugin** | `copilot/plugin.json` (bundles all of above) | — (packaging only)                  |

The harness (`harness/agent_loop.py`) is the part Copilot gives you for free —
it's shown explicitly here so the loop is no longer a black box.

## The agent loop (harness/agent_loop.py)

    think  -> ask the model what to do        (llm.py)
    act    -> run the tool calls it returned  (tools.py, behind guardrails)
    observe-> feed the results back
    stop?  -> tests_green / max_iterations / model done  -> else loop

## Everything you can change without editing code (config/migration.yaml)

- `model.*` — swap model, tokens, temperature, provider
- `loop.*` — max iterations, stop conditions, self-heal vs abort, checkpointing
- `agent.tools` — which tools are exposed (comment a line out to remove a power)
- `agent.system_prompt` — the persona and rules
- `tools.run_openrewrite.recipes` — add/remove/reorder migration recipes
- `guardrails.*` — allowed paths, deny list, human-approval gates, secret redaction
- `audit.*` — on/off, fields, output path

## Run

    pip install anthropic pyyaml
    export ANTHROPIC_API_KEY=...
    python -m harness.agent_loop --config config/migration.yaml \
        --task "Migrate this Spring Boot module to Quarkus"

## Use the same thing inside VS Code / Copilot

1. Copy `copilot/skills/` and `copilot/agents/` into your repo's `.github/`.
2. Open Copilot chat, call `@quarkus-migrator` (the agent) or `/spring-to-quarkus`
   (the skill).
3. To ship it to the whole team as one unit, publish `copilot/` as a plugin
   (it already has `plugin.json`) and install via the Extensions view.

> Guardrails note: in a regulated context, the `guardrails` block is the
> load-bearing part. Mutating tools (`git_commit`/`git_push`) are approval-gated,
> arbitrary shell and network egress are denied, and every tool call is written
> to an OTel-style audit line before it runs.
