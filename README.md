# dsh-harness-router

English | [中文](README.zh.md)

Task-aware harness routing for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

It classifies the first real user request in a session and applies a matching prompt/tool policy **before the first model request is assembled**. The goal is to make requirement recognition and task decomposition more accurate without changing the agent loop.

## How it works

```
user request
   │
   ▼
agent/inbox/claimed          (fires before tools.resolve + prompt assembly)
   │
   ▼
rule-based classifier        direct / clarify / decompose / balanced
   │
   ├─ register scoped prompt guidance
   ├─ apply tool allow/deny restrictions
   └─ append a decision record to decisions.jsonl
   │
   ▼
the first model request already uses the routed harness
```

The routing hook is `agent/inbox/claimed`, which DeepSeek Harness emits after the loop claims a pending message and before it resolves tools and assembles the system prompt. This is the same mechanism used by [`yjh051108/dsh-routing-suite`](https://github.com/yjh051108/dsh-routing-suite), which this project derives from.

## Routes

| Route | When | Prompt guidance | Tool policy |
|---|---|---|---|
| `clarify` | Vague or missing high-impact constraints | Restate the goal, list assumptions and high-impact ambiguity, ask at most two focused questions | No extra restriction |
| `decompose` | Multi-step work such as refactors, migrations, debugging, end-to-end changes | Extract acceptance criteria, write a 3–7 step plan with `todo_write`, verify each step | No extra restriction |
| `direct` | Short factual/explanation questions | Answer directly; avoid planning machinery | Deny `todo_write`, `exit_plan_mode` |
| `balanced` | No strong signal | Leave the current harness unchanged | Unchanged |

The classifier is deterministic and explainable: it scores keyword hits, text length, and clause count, then records the matched signals. It does not call a model.

## Install

From a local checkout:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-harness-router
```

From GitHub (after publishing):

```sh
dsh plugin --profile web add github:<owner>/dsh-harness-router
```

Restart the Web UI after installation.

## Distribution

### Tarball

```sh
npm pack
```

Send the generated `dsh-harness-router-0.1.0.tgz` to the recipient:

```sh
dsh plugin --profile web add /absolute/path/to/dsh-harness-router-0.1.0.tgz
```

### GitHub

Push this directory as the repository root, then:

```sh
dsh plugin --profile web add github:<owner>/dsh-harness-router
```

Pin a commit for reproducibility:

```sh
dsh plugin --profile web add github:<owner>/dsh-harness-router#<commit>
```

### npm

The name is currently available:

```sh
npm login
npm publish --access public
```

Recipients install with:

```sh
dsh plugin --profile web add dsh-harness-router
```

The Web UI's Plugins → Add plugin flow accepts the package name or a tarball path too. After publishing to npm, submit a PR to `awesome-dsh-plugin/awesome-dsh-plugin` to list it in the DSH plugin market and Discover index.

## Configuration

The bundle inserts one `harness-router` row with sensible defaults. Override it in a profile patch:

```yaml
- id: harness-router
  config:
    defaultRoute: balanced
    minScore: 3
    includeSubagents: false
    log: true
    # logPath: /absolute/path/to/decisions.jsonl
    routes:
      clarify:
        match:
          any: ['大概', '尽量', '优化一下', 'not sure']
          maxChars: 320
        prompt:
          order: 850
          text: |
            Ask only for the missing information that would change the result.
        tools:
          deny: []
      direct:
        tools:
          deny: ['todo_write', 'exit_plan_mode']
```

Each route accepts:

- `match.any` / `match.all` / `match.notAny`: string arrays. A forbidden `notAny` term disqualifies the route.
- `match.minChars` / `match.maxChars` / `match.minClauses`: length and structure guards.
- `prompt.text` / `prompt.name` / `prompt.order`: scoped prompt section. Set `prompt: null` to add none.
- `tools.allow` / `tools.deny`: tool restrictions. Empty arrays are ignored.

Custom routes can be added. They are scored like the built-in routes; `defaultRoute` must name an existing route.

## Slash command

In an interactive Web/CLI session:

```text
/route              show the current route and available routes
/route decompose    switch this session to the decompose route
/route off          disable routing for this session
```

A manual selection also suppresses automatic routing for the rest of that session.

## Decision log

With `log: true`, every decision is appended to:

```
$DSH_HOME/harness-router/decisions.jsonl
```

or `~/.dsh/harness-router/decisions.jsonl` when `DSH_HOME` is unset.

Each line records the session, turn, route, confidence, score, matched signals, text length, a 160-character preview, whether it was an override, and a hash of the normalized configuration. The full user text is not logged.

## Limitations

- Rule-based classification only; an LLM classifier is a later extension.
- Routes once per session; it does not re-classify later turns.
- Root sessions are routed by default. Subagent sessions are skipped unless `includeSubagents: true`.
- Tool restrictions are best-effort: if a configured tool is not available in the current preset, the plugin logs a warning and keeps the session running.
- Prompt guidance is model-visible and is recorded in the session as a system prompt section.
- Developed against DeepSeek Harness `0.2.x`; DSH is in developer preview and APIs may change.

## Verified

- `node --test test/*.test.mjs`: 12 tests pass.
- Agent-loop testkit: the first `agent/inbox/claimed` claim registers the routed prompt section before prompt assembly.
- Installed into the `web` profile and visible as an enabled plugin in the Web UI.

## Attribution

This project is based in part on MIT-licensed prior work:

- [`yjh051108/dsh-routing-suite`](https://github.com/yjh051108/dsh-routing-suite) — the task classification approach and the `agent/inbox/claimed` routing pattern.
- [`DoreiHime/dsh-help-me-to-ask`](https://github.com/DoreiHime/dsh-help-me-to-ask) — clarification-first interaction ideas referenced by the `clarify` route.

See `LICENSE` and `NOTICE` for details.

## Development

```sh
node --test test/*.test.mjs
```

No build step is required; the plugin is plain ESM.
