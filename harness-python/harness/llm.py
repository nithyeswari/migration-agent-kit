"""
llm.py — a thin, swappable LLM client.

The harness only depends on the LLMClient interface, so you can drop in a
different provider without touching the loop. Only the Anthropic messages API
(tool use) is wired here; add classes for OpenAI/Bedrock/Vertex the same way
and select them via model.provider in migration.yaml.
"""
from __future__ import annotations
from typing import Protocol


class LLMResponse:
    """Normalised response the harness understands, independent of provider."""
    def __init__(self, text: str, tool_calls: list[dict], raw):
        self.text = text                # any assistant prose this turn
        self.tool_calls = tool_calls    # [{id, name, input}, ...]
        self.raw = raw                  # provider-native assistant message


class LLMClient(Protocol):
    def turn(self, system: str, messages: list[dict], tools: list[dict],
             cfg: dict) -> LLMResponse: ...


class AnthropicClient:
    def __init__(self):
        import anthropic
        self._client = anthropic.Anthropic()   # reads ANTHROPIC_API_KEY

    def turn(self, system, messages, tools, cfg) -> LLMResponse:
        m = cfg["model"]
        resp = self._client.messages.create(
            model=m["id"],
            max_tokens=m["max_tokens"],
            temperature=m["temperature"],
            system=system,
            tools=tools,
            messages=messages,
        )
        text, tool_calls = "", []
        for block in resp.content:
            if block.type == "text":
                text += block.text
            elif block.type == "tool_use":
                tool_calls.append({"id": block.id, "name": block.name,
                                   "input": block.input})
        return LLMResponse(text, tool_calls, resp)


def make_client(cfg: dict) -> LLMClient:
    provider = cfg["model"]["provider"]
    if provider == "anthropic":
        return AnthropicClient()
    raise ValueError(f"No client wired for provider '{provider}'. "
                     f"Add a class in llm.py and register it here.")
