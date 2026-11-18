# dsh-harness-router

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的任务感知 Harness 路由插件。

它会判断一个会话里**第一条真实用户消息**属于哪类任务，并在**首次模型请求组装之前**套用对应的提示词和工具策略。目标是在不改 Agent 循环的前提下，让需求识别和任务拆分更准确。

## 工作方式

```
用户请求
   │
   ▼
agent/inbox/claimed          （在 tools.resolve 和提示词组装之前触发）
   │
   ▼
规则分类器                   direct / clarify / decompose / balanced
   │
   ├─ 注册当前会话的提示词引导
   ├─ 应用工具 allow/deny 限制
   └─ 追加一条决策记录到 decisions.jsonl
   │
   ▼
首次模型请求已经使用路由后的 Harness
```

路由 hook 是 `agent/inbox/claimed`：DSH 在领取待处理消息之后、解析工具和组装系统提示词之前触发它。本插件基于 [`yjh051108/dsh-routing-suite`](https://github.com/yjh051108/dsh-routing-suite) 的同一机制改写。

## 路由

| 路由 | 适用场景 | 提示词引导 | 工具策略 |
|---|---|---|---|
| `clarify` | 需求模糊、缺少高影响约束 | 复述目标，列出假设和高影响歧义，最多问两个聚焦问题 | 不额外限制 |
| `decompose` | 重构、迁移、调试、端到端等多步骤任务 | 提取验收条件，用 `todo_write` 写 3–7 步计划，逐步验证 | 不额外限制 |
| `direct` | 简短的事实/解释类问题 | 直接回答，不引入计划机制 | 禁用 `todo_write`、`exit_plan_mode` |
| `balanced` | 没有明显信号 | 保持现有 Harness 不变 | 不变 |

分类器是确定性的、可解释的：它对关键词命中、文本长度和子句数打分，并记录命中的信号；不会调用模型。

## 安装

从本地目录安装：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-harness-router
```

从 GitHub 安装（发布后）：

```sh
dsh plugin --profile web add github:<owner>/dsh-harness-router
```

安装完成后重启 Web UI。

## 发布与分发

### 方式一：压缩包

```sh
npm pack
```

把生成的 `dsh-harness-router-0.1.0.tgz` 发给对方：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-harness-router-0.1.0.tgz
```

### 方式二：GitHub

把本目录作为仓库根目录推送到 GitHub，对方安装：

```sh
dsh plugin --profile web add github:<owner>/dsh-harness-router
```

需要可复现时固定提交：

```sh
dsh plugin --profile web add github:<owner>/dsh-harness-router#<commit>
```

### 方式三：npm

包名当前未被占用：

```sh
npm login
npm publish --access public
```

对方安装：

```sh
dsh plugin --profile web add dsh-harness-router
```

也可以在 Web UI 的「插件 → 添加插件」里填入包名或 tarball 路径。

发布到 npm 后，可以再向 `awesome-dsh-plugin/awesome-dsh-plugin` 提交 PR，进入 DSH 插件市场和 Discover 索引。

## 配置

插件会插入一行 `harness-router` 并使用默认配置。可以在 profile patch 中覆盖：

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
            只询问那些会改变结果的关键缺失信息。
        tools:
          deny: []
      direct:
        tools:
          deny: ['todo_write', 'exit_plan_mode']
```

每个路由支持：

- `match.any` / `match.all` / `match.notAny`：字符串数组。命中 `notAny` 的词会直接淘汰该路由。
- `match.minChars` / `match.maxChars` / `match.minClauses`：长度和结构约束。
- `prompt.text` / `prompt.name` / `prompt.order`：当前会话作用域的提示词段落。设为 `prompt: null` 表示不注入。
- `tools.allow` / `tools.deny`：工具限制。空数组会被忽略。

也可以新增自定义路由；它们会和内置路由一起参与打分。`defaultRoute` 必须指向一个已存在的路由。

## 斜杠命令

在 Web/CLI 会话中：

```text
/route              查看当前路由和可用路由
/route decompose    把当前会话切换到 decompose 路由
/route off          对当前会话关闭路由
```

手动选择后，该会话剩余部分不再自动路由。

## 决策日志

当 `log: true` 时，每次路由决策都会追加到：

```
$DSH_HOME/harness-router/decisions.jsonl
```

如果未设置 `DSH_HOME`，则写入 `~/.dsh/harness-router/decisions.jsonl`。

每行记录会话、turn、路由、置信度、分数、命中信号、文本长度、160 字符预览、是否为手动覆盖，以及规范化配置的哈希。不会记录完整用户文本。

## 限制

- 目前只有规则分类；LLM 分类器属于后续扩展。
- 每个会话只路由一次，不会在后续 turn 重新分类。
- 默认只路由根会话；子代理会话会被跳过，除非设置 `includeSubagents: true`。
- 工具限制是尽力而为：如果配置的工具在当前预设中不存在，插件会记录警告并继续运行。
- 提示词引导是模型可见的，并会作为系统提示词段落写入会话。
- 针对 DeepSeek Harness `0.2.x` 开发；DSH 处于开发者预览阶段，API 可能变化。

## 已验证

- `node --test test/*.test.mjs`：12 个测试全部通过。
- Agent-loop testkit：首次 `agent/inbox/claimed` 时，路由提示词段落已在提示词组装之前注册。
- 已安装进 `web` profile，并在 Web UI 中显示为已启用插件。

## 归属

本项目部分基于以下 MIT 许可的前期工作：

- [`yjh051108/dsh-routing-suite`](https://github.com/yjh051108/dsh-routing-suite)：任务分类思路和 `agent/inbox/claimed` 路由模式。
- [`DoreiHime/dsh-help-me-to-ask`](https://github.com/DoreiHime/dsh-help-me-to-ask)：`clarify` 路由参考的「先澄清再动手」交互思路。

详见 `LICENSE` 和 `NOTICE`。

## 开发

```sh
node --test test/*.test.mjs
```

插件是纯 ESM，不需要构建步骤。
