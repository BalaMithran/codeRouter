# How OpenCode Talks to Providers

Findings from reading OpenCode v1.15.4 source (`sst/opencode`). All file references are
into that repo. This document is the contract CodeRouter must satisfy to be
indistinguishable from a normal provider.

```
User → OpenCode (TUI, agent loop, tools)
         → Vercel AI SDK (@ai-sdk/openai-compatible)
           → CodeRouter  http://localhost:8787/v1/chat/completions
             → upstream provider (M1: OpenRouter, unchanged passthrough)
```

## 1. Provider resolution

- OpenCode instantiates providers through Vercel AI SDK packages. A custom provider is
  declared in `opencode.jsonc` under `provider.<id>`; the `npm` field defaults to
  `@ai-sdk/openai-compatible`, which is **bundled** — no install happens
  (`packages/opencode/src/provider/provider.ts:1055,1278`, bundled map `:91-117`).
- Config schema for a provider entry (`packages/opencode/src/config/provider.ts:71-108`):
  `npm`, `name`, `env`, `options.{apiKey, baseURL, timeout, chunkTimeout, ...}`, and a
  `models` map. Per-model fields: `name`, `tool_call`, `reasoning`, `attachment`,
  `temperature`, `limit.{context,input,output}`, `cost.{input,output,cache_read,cache_write}`,
  `headers`, `options`.
- **OpenCode never calls `GET /v1/models`.** Model metadata comes only from the
  models.dev catalog (`https://models.dev/api.json`) merged with local config
  (`provider/provider.ts:1259-1350`). An id not declared anywhere →
  `ModelNotFoundError` before any HTTP request (`provider/provider.ts:1655-1676`).
- Model references are `provider/model`; `parseModel` splits on the **first** slash and
  rejoins the rest (`provider/provider.ts:1835-1841`), so
  `coderouter/anthropic/claude-sonnet-4.5` → provider `coderouter`, model id
  `anthropic/claude-sonnet-4.5`. Slashes in model ids are safe.
- API key: `options.apiKey` in config wins; else `env` vars; else `auth.json` entries
  (`provider/provider.ts:1352-1376,1546`). For a localhost gateway a dummy key is fine —
  it's sent as `Authorization: Bearer <key>` and CodeRouter replaces it.

## 2. Request shape (what arrives at the gateway)

One `streamText()` call per agent step (`packages/opencode/src/session/llm.ts:325-404`).
Through `@ai-sdk/openai-compatible` this becomes a standard OpenAI
`POST /v1/chat/completions` with:

- `stream: true` and `stream_options: {"include_usage": true}` — **forced on** for
  openai-compatible providers (`provider/provider.ts:1519-1521`).
- `tools` as JSON-schema function definitions, `tool_choice` ∈ `auto | required | none`
  (`llm.ts:356-358`). `required` is used for structured output.
- `max_tokens` = `min(model.limit.output, 32000)` (`provider/transform.ts:1253`).
- `temperature`/`top_p` only when model metadata enables them (`transform.ts:476-511`).
- System prompt as leading `role:"system"` messages; on the final agent step a synthetic
  trailing `assistant` "wrap up" message may appear (`session/prompt.ts:1828`).
- Message content blocks may carry `cache_control: {"type":"ephemeral"}` when the model
  id contains `claude`/`anthropic` (`transform.ts:340-388,432-444`). Ignore or forward;
  never 400 on unknown fields.
- Headers: `x-session-affinity: <sessionID>`, sometimes `x-parent-session-id`,
  `User-Agent: opencode/<version>`, plus any model/plugin headers (`llm.ts:361-377`).
  Tolerate all of them.
- Expect extra small calls through the same endpoint: title and summary generation
  (`session/prompt.ts:346-366`) reuse the provider.

## 3. Response contract (what the gateway must return)

OpenCode consumes the AI SDK's parsed full-stream (`session/processor.ts:214-630`).
The SDK parses standard OpenAI SSE (`text/event-stream`, `data:` lines, `data: [DONE]`
terminator). Load-bearing details:

1. **Streamed tool calls** — `choices[].delta.tool_calls[].{index, id, function.name,
   function.arguments}` accumulated incrementally; arguments must be valid JSON when
   assembled. Malformed calls get routed to a sentinel `invalid` tool and cost a
   round-trip (`llm.ts:331-351`). There is **no text-based tool-call fallback** —
   native function calling is the only path.
2. **`finish_reason` semantics** — the agent loop continues while finish reason is
   `tool_calls` (`session/prompt.ts:1671,1841`). Wrong finish reasons cause premature
   loop exit or ghost turns. `stop` for normal end, `length` for truncation.
3. **Usage in the final chunk** — because `include_usage` is forced, the last data chunk
   must carry `usage.{prompt_tokens, completion_tokens}`; optionally
   `prompt_tokens_details.cached_tokens` and `completion_tokens_details.reasoning_tokens`
   (`session/session.ts:377-420`). Missing usage doesn't crash, but cost shows $0 and
   **auto-compaction stops working** (token counts drive overflow detection,
   `session/processor.ts:547-552`).
4. **Errors pass through honestly** — OpenCode retries 5xx and rate-limit-shaped errors
   with backoff honoring `retry-after`/`retry-after-ms` headers
   (`session/retry.ts:34-151`). Never mask an upstream error as a 200; never strip
   `retry-after`.

## 4. Model-id substring behaviors (the virtual-model trap)

OpenCode branches on substrings of the model id, not on what actually serves the request:

| id contains | behavior |
|---|---|
| `claude` / `anthropic` | anthropic system prompt (`session/system.ts:19-33`), `cache_control` injection, tool-call-id scrub (`transform.ts:182-209`) |
| `gpt` / `o1` / `o3` / `codex` | gpt/beast/codex prompt family |
| `gemini` | gemini prompt, schema fixups (`transform.ts:1295`) |
| `deepseek` | interleaved `reasoning_content` round-trip default (`provider/provider.ts:1316-1321`) |
| `mistral` / `devstral` | tool-call-id normalization (`transform.ts:235-283`) |
| none of the above | default prompt, generic params, **no** cache_control, **no** scrubs |

**Consequence for M2+:** a virtual id like `auto` or `cheap` gets generic treatment even
when CodeRouter routes it to Claude — no anthropic prompt, no cache markers, no tool-id
scrub. Options when routing lands: embed the family in the virtual id (e.g.
`auto-claude`), perform the equivalent transforms inside CodeRouter, or accept generic
behavior. M1 sidesteps this by exposing real upstream ids (`anthropic/claude-sonnet-4.5`),
which contain the right substrings naturally.

## 5. Config metadata pitfalls

- `limit.context: 0` (the default when omitted) **silently disables compaction**
  (`session/overflow.ts:8-32`). Always set real context limits.
- Missing `cost` → everything reports $0 silently (`provider/provider.ts:1013-1021`).
- For a virtual model whose backing changes per request, OpenCode compacts against the
  *static* configured limit — pin `limit.context` to the smallest possible backend.

## 6. CodeRouter M1 invariants

1. **Byte-level passthrough.** Request body buffered and forwarded unchanged; response
   body (SSE or JSON) streamed back untouched. Never parse and re-emit SSE — any
   reserialization risks mangling tool_call deltas or the usage chunk.
2. **Header swap only.** Replace `Authorization` with the upstream key; send
   `accept-encoding: identity` upstream and drop `content-encoding`/`content-length`
   from the response (Bun's fetch auto-decompresses; stale headers corrupt the read).
3. **Status + `retry-after` forwarded verbatim** (OpenCode's retry loop depends on them).
4. A model id valid in `opencode.jsonc` but unknown upstream → upstream 400 passed
   through. Correct behavior; confusing symptom. Check ids against OpenRouter first.

## 7. Alternative extension points considered (and why not now)

OpenCode has a plugin hook system (`packages/plugin/src/index.ts`): `chat.params`
(mutate temperature/options per request), `chat.headers`, `provider.models` (inject a
model map at load), `config` (rewrite provider config programmatically), and a custom
`options.fetch` per provider. A plugin could do routing *inside* OpenCode without an
HTTP hop — but it couples CodeRouter to OpenCode's plugin API and Effect runtime, and
kills the "works with anything OpenAI-compatible" story. The HTTP gateway keeps
CodeRouter tool-agnostic; hooks remain an option for tighter integration later (e.g. a
thin plugin that injects the provider config automatically).
