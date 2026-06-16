// llm.js — a thin, swappable LLM client.
//
// The harness only depends on the turn() shape, so you can drop in another
// provider without touching the loop. Only the Anthropic messages API (tool
// use) is wired here; add a class for OpenAI/Bedrock/Vertex the same way and
// select it via model.provider in migration.yaml.

import Anthropic from "@anthropic-ai/sdk";

// Normalised response the harness understands, independent of provider.
export class LLMResponse {
  constructor(text, toolCalls, raw) {
    this.text = text;          // any assistant prose this turn
    this.toolCalls = toolCalls; // [{ id, name, input }, ...]
    this.raw = raw;             // provider-native assistant message
  }
}

class AnthropicClient {
  constructor() {
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY
  }

  async turn(system, messages, tools, cfg) {
    const m = cfg.model;
    const resp = await this.client.messages.create({
      model: m.id,
      max_tokens: m.max_tokens,
      temperature: m.temperature,
      system,
      tools,
      messages,
    });

    let text = "";
    const toolCalls = [];
    for (const block of resp.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use")
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
    }
    return new LLMResponse(text, toolCalls, resp);
  }
}

export function makeClient(cfg) {
  const provider = cfg.model.provider;
  if (provider === "anthropic") return new AnthropicClient();
  throw new Error(
    `No client wired for provider '${provider}'. Add a class in llm.js and register it here.`,
  );
}
