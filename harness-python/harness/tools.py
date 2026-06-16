"""
tools.py — the TOOLS the agent can call.

A "tool" here is exactly the Copilot/MCP concept: one bounded action the model
can invoke. Each tool declares a JSON schema (so the model knows how to call it)
and a run() function. Tools are registered in a registry; the config file
(agent.tools) decides which ones are actually exposed for a given run.

To add a capability, write a @tool function and add its name to migration.yaml.
Nothing else changes.
"""
from __future__ import annotations
import json
import subprocess
import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Any

# --- Registry ----------------------------------------------------------------

@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict
    run: Callable[[dict, "ToolContext"], dict]


REGISTRY: dict[str, Tool] = {}


def tool(name: str, description: str, input_schema: dict):
    """Decorator that registers a tool implementation."""
    def wrap(fn: Callable[[dict, "ToolContext"], dict]) -> Callable:
        REGISTRY[name] = Tool(name, description, input_schema, fn)
        return fn
    return wrap


@dataclass
class ToolContext:
    """Runtime config passed to every tool, sourced from migration.yaml."""
    cfg: dict
    root: Path
    audit: Callable[[dict], None] = field(default=lambda e: None)
    approver: Callable[[str, dict], bool] = field(default=lambda t, a: True)


# --- Guardrail enforcement (runs BEFORE any tool) ----------------------------

def _within_allowed(path: str, ctx: ToolContext) -> bool:
    allowed = ctx.cfg["guardrails"]["allowed_paths"]
    p = str(Path(path))
    return any(p == a or p.startswith(a.rstrip("/") + "/") for a in allowed)


def enforce_guardrails(name: str, args: dict, ctx: ToolContext) -> str | None:
    """Return an error string if the call is blocked, else None."""
    g = ctx.cfg["guardrails"]
    if name in g.get("deny", []):
        return f"BLOCKED: tool '{name}' is on the deny list."
    # path-scoped tools must stay inside allowed_paths
    for key in ("path", "file"):
        if key in args and not _within_allowed(args[key], ctx):
            return f"BLOCKED: '{args[key]}' is outside allowed_paths."
    # human-in-the-loop for mutating tools
    if name in g.get("require_human_approval", []):
        if not ctx.approver(name, args):
            return f"BLOCKED: human approval declined for '{name}'."
    return None


# --- Tool implementations -----------------------------------------------------

@tool("read_file", "Read a source file's contents.",
      {"type": "object", "properties": {"path": {"type": "string"}},
       "required": ["path"]})
def read_file(args, ctx):
    p = ctx.root / args["path"]
    return {"content": p.read_text(encoding="utf-8")[:20000]}


@tool("search_code", "Grep the codebase for a regex; returns matching file:line.",
      {"type": "object", "properties": {"pattern": {"type": "string"}},
       "required": ["pattern"]})
def search_code(args, ctx):
    out = subprocess.run(["grep", "-rne", args["pattern"], "src"],
                         cwd=ctx.root, capture_output=True, text=True)
    return {"matches": out.stdout[:8000]}


@tool("run_openrewrite",
      "Run the configured OpenRewrite recipes (dry-run first if set).",
      {"type": "object", "properties": {
          "recipes": {"type": "array", "items": {"type": "string"},
                      "description": "Optional override; defaults to config."}}})
def run_openrewrite(args, ctx):
    tc = ctx.cfg["tools"]["run_openrewrite"]
    recipes = args.get("recipes") or tc["recipes"]
    goal = "dryRun" if tc.get("dry_run_first", True) else "run"
    active = ",".join(recipes)
    coords = tc.get("recipe_artifact_coordinates")
    if tc["build_tool"] == "maven":
        cmd = ["./mvnw", "-q",
               "org.openrewrite.maven:rewrite-maven-plugin:" + goal,
               f"-Drewrite.activeRecipes={active}"]
        if coords:
            cmd.append(f"-Drewrite.recipeArtifactCoordinates={coords}")
    else:
        cmd = ["./gradlew", goal, f"--recipes={active}"]
    out = subprocess.run(cmd, cwd=ctx.root, capture_output=True, text=True)
    return {"goal": goal, "recipes": recipes, "stdout": out.stdout[:8000],
            "returncode": out.returncode}


@tool("apply_patch", "Apply a unified diff to a file inside allowed paths.",
      {"type": "object", "properties": {
          "path": {"type": "string"}, "diff": {"type": "string"}},
       "required": ["path", "diff"]})
def apply_patch(args, ctx):
    proc = subprocess.run(["git", "apply", "-"], cwd=ctx.root,
                          input=args["diff"], capture_output=True, text=True)
    return {"applied": proc.returncode == 0, "stderr": proc.stderr[:2000]}


@tool("build_module", "Compile/package the module without tests.",
      {"type": "object", "properties": {}})
def build_module(args, ctx):
    cmd = ctx.cfg["tools"]["build_module"]["command"].split()
    out = subprocess.run(cmd, cwd=ctx.root, capture_output=True, text=True)
    return {"ok": out.returncode == 0, "stdout": out.stdout[-4000:]}


@tool("run_tests", "Run the test suite; reports green/red.",
      {"type": "object", "properties": {}})
def run_tests(args, ctx):
    tc = ctx.cfg["tools"]["run_tests"]
    out = subprocess.run(tc["command"].split(), cwd=ctx.root,
                         capture_output=True, text=True)
    green = tc["success_pattern"] in out.stdout
    return {"tests_green": green, "stdout": out.stdout[-4000:]}


@tool("git_commit", "Commit staged changes (requires human approval).",
      {"type": "object", "properties": {"summary": {"type": "string"}},
       "required": ["summary"]})
def git_commit(args, ctx):
    msg = ctx.cfg["tools"]["git_commit"]["message_template"].format(**args)
    subprocess.run(["git", "add", "-A"], cwd=ctx.root)
    out = subprocess.run(["git", "commit", "-m", msg], cwd=ctx.root,
                         capture_output=True, text=True)
    return {"committed": out.returncode == 0, "message": msg}


# --- Helpers the harness uses -------------------------------------------------

def schemas_for(names: list[str]) -> list[dict]:
    """Build the tool-schema list the model sees, limited to enabled tools."""
    return [{"name": REGISTRY[n].name,
             "description": REGISTRY[n].description,
             "input_schema": REGISTRY[n].input_schema}
            for n in names if n in REGISTRY]


def execute(name: str, args: dict, ctx: ToolContext) -> dict:
    """Guardrail -> audit -> run. The single chokepoint for every tool call."""
    blocked = enforce_guardrails(name, args, ctx)
    args_hash = hashlib.sha256(json.dumps(args, sort_keys=True).encode()).hexdigest()[:12]
    if blocked:
        ctx.audit({"tool": name, "args_hash": args_hash,
                   "decision": "blocked", "outcome": blocked})
        return {"error": blocked}
    result = REGISTRY[name].run(args, ctx)
    ctx.audit({"tool": name, "args_hash": args_hash,
               "decision": "allowed", "outcome": "ok"})
    return result
