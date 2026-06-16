"""
agent_loop.py — THE HARNESS and THE AGENT LOOP.

  Harness  = everything around the model: config loading, tool wiring,
             guardrails, audit logging, checkpoint/resume, stop conditions,
             human-approval prompts.
  Loop     = the think -> act -> observe cycle:
                1. ask the model what to do (think)
                2. run the tool calls it returned (act)
                3. feed the results back (observe)
                4. repeat until a stop condition fires

Run:  python -m harness.agent_loop --config config/migration.yaml \
            --task "Migrate this Spring Boot module to Quarkus"
"""
from __future__ import annotations
import argparse
import json
import time
from pathlib import Path

import yaml

from . import tools
from .llm import make_client


# --- Harness pieces -----------------------------------------------------------

def load_config(path: str) -> dict:
    return yaml.safe_load(Path(path).read_text())


def make_auditor(cfg: dict):
    a = cfg["audit"]
    if not a.get("enabled"):
        return lambda e: None
    out = Path(a["path"])
    out.parent.mkdir(parents=True, exist_ok=True)

    def write(event: dict):
        event.setdefault("timestamp", time.time())
        with out.open("a") as f:
            f.write(json.dumps(event) + "\n")
    return write


def make_approver(cfg: dict):
    """Human-in-the-loop gate. Swap for a Jira/ServiceNow ticket in prod."""
    def ask(tool_name: str, args: dict) -> bool:
        print(f"\n[APPROVAL NEEDED] {tool_name}({json.dumps(args)[:200]})")
        return input("Approve? [y/N] ").strip().lower() == "y"
    return ask


def build_system_prompt(cfg: dict) -> str:
    a, p = cfg["agent"], cfg["project"]
    return a["system_prompt"].format(
        agent_name=a["name"],
        quarkus_version=p["quarkus_version"],
        java_version=p["java_version"],
    )


def stop_reason(state: dict, cfg: dict) -> str | None:
    rules = cfg["loop"]["stop_when"]
    if "tests_green" in rules and state.get("tests_green"):
        return "tests_green"
    if "model_signalled_done" in rules and state.get("no_tool_calls"):
        return "model_signalled_done"
    if "max_iterations_reached" in rules and \
            state["iteration"] >= cfg["loop"]["max_iterations"]:
        return "max_iterations_reached"
    return None


# --- The loop -----------------------------------------------------------------

def run(config_path: str, task: str):
    cfg = load_config(config_path)
    audit = make_auditor(cfg)
    ctx = tools.ToolContext(
        cfg=cfg,
        root=Path(cfg["project"]["module_path"]).resolve(),
        audit=audit,
        approver=make_approver(cfg),
    )
    client = make_client(cfg)
    enabled = cfg["agent"]["tools"]
    tool_schemas = tools.schemas_for(enabled)
    system = build_system_prompt(cfg)

    messages = [{"role": "user", "content": task}]
    state = {"iteration": 0, "tests_green": False, "no_tool_calls": False}

    while True:
        state["iteration"] += 1
        audit({"iteration": state["iteration"], "phase": "think"})

        resp = client.turn(system, messages, tool_schemas, cfg)
        messages.append({"role": "assistant", "content": resp.raw.content})

        if not resp.tool_calls:
            state["no_tool_calls"] = True
            print(f"\n[agent] {resp.text}")
        else:
            # ACT + OBSERVE: run every requested tool, collect results
            results = []
            for call in resp.tool_calls:
                if cfg["audit"]["redact_secrets"]:
                    pass  # hook your redaction here before logging args
                out = tools.execute(call["name"], call["input"], ctx)
                if "tests_green" in out:
                    state["tests_green"] = out["tests_green"]
                if out.get("error") and cfg["loop"]["on_tool_error"] == "abort":
                    print(f"[abort] {out['error']}")
                    return
                results.append({"type": "tool_result", "tool_use_id": call["id"],
                                "content": json.dumps(out)[:8000]})
            messages.append({"role": "user", "content": results})

        # checkpoint (resume support)
        if state["iteration"] % cfg["loop"]["checkpoint_every"] == 0:
            Path("./audit").mkdir(exist_ok=True)
            Path("./audit/checkpoint.json").write_text(
                json.dumps({"state": state, "messages_len": len(messages)}))

        reason = stop_reason(state, cfg)
        if reason:
            audit({"iteration": state["iteration"], "phase": "stop",
                   "reason": reason})
            print(f"\n[done] stopped because: {reason}")
            return


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config/migration.yaml")
    ap.add_argument("--task", required=True)
    args = ap.parse_args()
    run(args.config, args.task)
