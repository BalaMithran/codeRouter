# CodeRouter

Intelligent provider layer behind [OpenCode](https://opencode.ai). OpenCode keeps the
terminal UX, agent loop, and tools; CodeRouter decides which model executes each task.

**Milestone 3 (current):** privacy engine + LLM-classifier routing. OpenCode asks for
`auto` / `cheap` / `premium` / `offline`; CodeRouter resolves the real provider+model
per request. Requests touching protected paths never leave the machine. Provider
contract in [docs/opencode-integration.md](docs/opencode-integration.md).

```
OpenCode  →  CodeRouter :8787  →  openai  (gpt-4.1 / gpt-4.1-mini)
                                  ollama  (llama3.1:8b, local)
```

## Quickstart

```sh
cp .env.example .env            # CODEROUTER_OPENAI_KEY=sk-...
bun start                       # reads coderouter.yaml, listens on :8787
bun test
# for the offline model:
OLLAMA_CONTEXT_LENGTH=32768 ollama serve   # default 4096 ctx truncates agent prompts silently
ollama pull llama3.1:8b
```

## Virtual models

| id | routes to | picked by |
|----|-----------|-----------|
| `auto` | cheap or premium | gpt-4.1-nano classifies the request (~300ms, 3s timeout); any failure falls back to the keyword/size heuristic |
| `cheap` | openai/gpt-4.1-mini | static |
| `premium` | openai/gpt-4.1 | static |
| `offline` | ollama/llama3.1:8b | static |

Bare ids (`gpt-4.1`) pass through to `default_provider` unchanged; `provider/model`
ids route to that provider explicitly. All mappings + thresholds in
[coderouter.yaml](coderouter.yaml). Strategies are pluggable functions
(`src/strategy.ts`): `llm-classifier` (default) or `heuristic`.

## Privacy

`privacy.paths` globs in [coderouter.yaml](coderouter.yaml) (`/auth/**`,
`**/secrets/**`, …) are matched against the serialized request body — file paths in
tool args, bash commands, prose, and tool results all count. A match forces the
request to `privacy.target` (local Ollama), **overriding everything** including
explicit `premium`/`gpt-4.1` picks, and short-circuits before the classifier so
protected content is never sent to the cloud even for classification. Fail closed:
local model down → 502, never a cloud fallback. Once protected content enters a
session, every later request matches too (full history is re-sent) — taint is sticky.

Semantics: gitignore-style; leading `/` or `**/` matches at any path boundary, so
relative paths (`secrets/token.txt`) trigger rules too. Over-matching (a path-shaped
string in prose) routes local — the safe direction. **Known limit:** detection is
path-string based; secret *content* with no matching path won't trigger (content
scanning is a future milestone).

## Wire up OpenCode

`~/.config/opencode/opencode.jsonc` declares provider `coderouter`
(baseURL `http://localhost:8787/v1`) and every model id above — OpenCode never calls
`/v1/models`, and zero/absent `limit`/`cost` metadata silently disables compaction and
cost tracking.

## Known limitations (accepted, logged)

- OpenCode's cost display uses static per-model metadata — for `auto` it shows premium
  pricing regardless of the routed model. The gateway log line
  (`auto -> openai/gpt-4.1-mini 200 tokens=1234/56`) is the truth.
- Virtual ids contain no model-family substring, so OpenCode applies its default system
  prompt family — fine for OpenAI + Ollama backends.
- Response `model` field shows the real upstream model, not the virtual id.
- Local model tool-calling: qwen2.5-coder:7b emitted tool calls as text (OpenCode
  requires native `tool_calls`) — hence llama3.1:8b.

## Verify

1. `curl localhost:8787/health` → ok
2. `curl` each virtual id, check routed model in the response `model` field + gateway log
3. `opencode run -m coderouter/auto "run ls and tell me what you see"` — tool executes,
   log shows the pick
4. Stop ollama → `offline` request returns 502 upstream-unreachable (OpenCode retries cleanly)

## Deferred (deliberately)

- Budget engine (daily spend cap) — M4
- Secret-content detection + redaction — future (privacy today is path-based)
- Hono, provider registry classes, dashboards — when a second implementation exists
