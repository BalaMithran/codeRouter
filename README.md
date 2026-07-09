# CodeRouter

Intelligent provider layer behind [OpenCode](https://opencode.ai). OpenCode keeps the
terminal UX, agent loop, and tools; CodeRouter decides which model executes each task.

**Milestone 1 (current):** prove the architecture. CodeRouter is an OpenAI-compatible
gateway that forwards requests unchanged to OpenRouter. No routing yet — see
[docs/opencode-integration.md](docs/opencode-integration.md) for the provider contract
that everything else builds on.

## Quickstart

```sh
cp .env.example .env      # put your OpenRouter key in it
bun start                 # listens on :8787
bun test                  # passthrough tests
```

## Wire up OpenCode

Add to `~/.config/opencode/opencode.jsonc`:

```jsonc
"provider": {
  "coderouter": {
    "npm": "@ai-sdk/openai-compatible",
    "name": "CodeRouter",
    "options": { "baseURL": "http://localhost:8787/v1", "apiKey": "coderouter-local" },
    "models": {
      "anthropic/claude-sonnet-4.5": {
        "name": "Claude Sonnet 4.5 (CodeRouter)", "tool_call": true, "reasoning": true,
        "limit": { "context": 200000, "output": 64000 }, "cost": { "input": 3, "output": 15 }
      }
    }
  }
}
```

Model ids must be declared here — OpenCode never calls `/v1/models`. Set real
`limit`/`cost` values: zeros silently disable compaction and cost tracking.

## Verify

1. `curl localhost:8787/health` → `ok`
2. Streaming: `curl -N localhost:8787/v1/chat/completions -H 'content-type: application/json' -d '{"model":"openai/gpt-4o-mini","stream":true,"stream_options":{"include_usage":true},"messages":[{"role":"user","content":"hi"}]}'` → SSE deltas, usage chunk, `data: [DONE]`
3. Tool calling: `opencode run -m coderouter/anthropic/claude-sonnet-4.5 "run ls and tell me what you see"` → agent executes tools through the gateway; OpenCode shows non-zero cost.

## Deferred (deliberately)

- **YAML config** — config surface today is two env vars; YAML lands with routing rules (M2).
- **Hono / provider registry / routing** — `forward()` in `src/forward.ts` is the seam;
  routing means choosing which provider's `forward` to call.
- Dashboards, UI, analytics — out of scope per spec.
