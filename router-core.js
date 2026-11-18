/**
 * Task classification for dsh-harness-router.
 *
 * Adapted from yjh051108/dsh-routing-suite's router-core.mjs (MIT,
 * Copyright (c) 2026 yjh051108). Route semantics are rewritten for
 * requirement-recognition and task-decomposition experiments.
 */

export const DEFAULT_ROUTE = 'balanced'

const ROUTE_PRIORITY = ['clarify', 'decompose', 'direct', 'balanced']

export const DEFAULT_ROUTES = {
  clarify: {
    description: 'The request is vague or missing high-impact constraints; clarify before acting.',
    match: {
      any: [
        '大概', '尽量', '看情况', '优化一下', '帮我搞', '随便', '差不多', '之类',
        '一些', '不确定', '可能', '你觉得', '看着办', '你决定', '搞一下', '处理一下',
        '帮我看看', '改改', '调整一下', '完善一下',
        'maybe', 'roughly', 'some', 'whatever you think', 'something like',
        'not sure', 'optimize it',
      ],
      notAny: [
        '具体要求如下', '验收标准', '需求如下', '按以下要求',
        'acceptance criteria', 'requirements:',
      ],
      maxChars: 320,
    },
    prompt: {
      name: 'harness-router-clarify',
      order: 850,
      text: [
        '## Harness route: clarify',
        '',
        'The request is ambiguous or missing high-impact constraints. Before executing:',
        '1. Restate the explicit goal and the deliverable you believe the user wants.',
        '2. List implicit assumptions and any high-impact ambiguity.',
        '3. For each ambiguity that would materially change the result, ask one focused question with concrete options (use ask_user_question). Ask at most two questions.',
        '4. Do not interrogate trivial details; state a reasonable assumption and continue when the ambiguity is low-impact.',
        '',
        'Once the key ambiguity is resolved or assumptions are stated, proceed with the task.',
      ].join('\n'),
    },
    tools: { deny: [] },
  },
  decompose: {
    description: 'The request is multi-step; produce a plan with verification before changing files.',
    match: {
      any: [
        '重构', '迁移', '实现', '修复', '设计', '架构', '端到端', '多步骤', '全量',
        '升级', '兼容', '排查', '优化', '部署', '联调', '接入', '改造', '拆分',
        'refactor', 'migrate', 'implement', 'debug', 'architecture', 'multi-step',
        'end-to-end', 'integrate', 'deploy',
      ],
      minChars: 60,
      minClauses: 2,
    },
    prompt: {
      name: 'harness-router-decompose',
      order: 850,
      text: [
        '## Harness route: decompose',
        '',
        'This is a multi-step task. Before making changes:',
        '1. Extract the explicit requirements and acceptance criteria.',
        '2. Produce a 3-7 step plan with input, output, and verification for each step; record it with todo_write.',
        '3. Execute step by step, updating the todo list as you go.',
        '4. Verify each step against its acceptance criteria before declaring completion.',
        '',
        'If a requirement is ambiguous and would change the plan, clarify it first.',
      ].join('\n'),
    },
    tools: { deny: [] },
  },
  direct: {
    description: 'A direct question; answer without planning machinery.',
    match: {
      any: [
        '是什么', '为什么', '怎么', '如何', '解释', '总结', '区别', '介绍一下',
        '用法', 'what is', 'why', 'how', 'explain', 'summarize', 'difference',
        'tell me about',
      ],
      notAny: [
        '重构', '迁移', '实现', '修复', '部署', '端到端',
        'refactor', 'migrate', 'implement', 'debug',
      ],
      maxChars: 240,
    },
    prompt: {
      name: 'harness-router-direct',
      order: 850,
      text: [
        '## Harness route: direct',
        '',
        'Answer the question directly and concisely. Do not create a todo list, plan mode, or subagents unless the user explicitly asks for multi-step execution.',
        'If, after reading the request, the task clearly requires multi-step work, say so briefly and proceed with a short plan.',
      ].join('\n'),
    },
    tools: { deny: ['todo_write', 'exit_plan_mode'] },
  },
  balanced: {
    description: 'Default; leave the existing harness unchanged.',
    match: {},
    prompt: null,
    tools: null,
  },
}

/**
 * Normalize user configuration over the shipped route defaults.
 * @param {object} [input] - Raw plugin configuration from cordis.yml.
 * @returns {object} Validated routing configuration.
 */
export function normalizeConfig(input = {}) {
  const sourceRoutes = input.routes ?? {}
  const routes = {}

  for (const [id, defaults] of Object.entries(DEFAULT_ROUTES)) {
    const overrides = sourceRoutes[id] ?? {}
    routes[id] = {
      ...defaults,
      ...overrides,
      match: { ...defaults.match, ...overrides.match },
      prompt: overrides.prompt === undefined
        ? defaults.prompt
        : overrides.prompt === null
          ? null
          : { ...(defaults.prompt ?? {}), ...overrides.prompt },
      tools: overrides.tools === undefined
        ? defaults.tools
        : overrides.tools === null
          ? null
          : { ...(defaults.tools ?? {}), ...overrides.tools },
    }
  }

  for (const [id, route] of Object.entries(sourceRoutes)) {
    if (routes[id] === undefined) routes[id] = route
  }

  const defaultRoute = input.defaultRoute ?? DEFAULT_ROUTE
  if (routes[defaultRoute] === undefined) {
    throw new Error(`harness-router: defaultRoute "${defaultRoute}" is not a configured route`)
  }

  for (const [id, route] of Object.entries(routes)) {
    if (route.prompt != null && typeof route.prompt.text !== 'string') {
      throw new Error(`harness-router: route "${id}" prompt.text must be a string`)
    }
    for (const key of ['allow', 'deny']) {
      const value = route.tools?.[key]
      if (value !== undefined && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) {
        throw new Error(`harness-router: route "${id}" tools.${key} must be an array of tool names`)
      }
    }
  }

  return {
    defaultRoute,
    minScore: input.minScore ?? 3,
    routes,
    includeSubagents: input.includeSubagents ?? false,
    log: input.log ?? true,
    logPath: input.logPath,
  }
}

/**
 * Extract model-facing text from a UserMessage or a raw content value.
 * @param {unknown} value - Message, message data, or content.
 * @returns {string} Joined text blocks.
 */
export function extractText(value) {
  if (typeof value === 'string') return value
  const data = value?.data && typeof value.data === 'object' ? value.data : value
  const content = data?.content ?? data?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('\n')
  }
  return ''
}

/**
 * Classify one request into a configured route.
 * @param {string} text - User request text.
 * @param {ReturnType<typeof normalizeConfig>} config - Routing configuration.
 * @returns {{route: string, score: number, confidence: 'high'|'medium'|'low'|'default', signals: string[], scores: Record<string, number>}}
 */
export function classify(text, config) {
  const trimmed = String(text ?? '').trim()
  const scores = {}
  const signals = {}
  let best = { id: config.defaultRoute, score: 0, signals: [] }

  const routeIds = Object.keys(config.routes)
    .sort((left, right) => priorityOf(left) - priorityOf(right) || left.localeCompare(right))

  for (const id of routeIds) {
    const route = config.routes[id]
    if (route === undefined) continue
    const scored = scoreRoute(id, route, trimmed)
    scores[id] = scored.score
    signals[id] = scored.signals
    if (scored.score > best.score
      || (scored.score === best.score && scored.score > 0 && priorityOf(id) < priorityOf(best.id))) {
      best = { id, score: scored.score, signals: scored.signals }
    }
  }

  const selected = best.score >= config.minScore ? best.id : config.defaultRoute
  const confidence = selected === config.defaultRoute && best.score < config.minScore
    ? 'default'
    : best.score >= 6
      ? 'high'
      : best.score >= 4
        ? 'medium'
        : 'low'

  return {
    route: selected,
    score: selected === config.defaultRoute && best.score < config.minScore ? 0 : best.score,
    confidence,
    signals: signals[selected] ?? [],
    scores,
  }
}

function priorityOf(id) {
  const index = ROUTE_PRIORITY.indexOf(id)
  return index === -1 ? ROUTE_PRIORITY.length : index
}

function scoreRoute(id, route, text) {
  const match = route.match ?? {}
  const any = matchTerms(text, termsOf(match.any))
  const forbidden = matchTerms(text, termsOf(match.notAny))
  if (forbidden.count > 0) return { score: -100, signals: forbidden.matched }

  const required = termsOf(match.all)
  if (required.some(term => termCount(text, term) === 0)) {
    return { score: -100, signals: [] }
  }

  let score = any.count
  if (any.count > 0) score += 2
  if (typeof match.minChars === 'number') score += text.length >= match.minChars ? 1 : -2
  if (typeof match.maxChars === 'number') score += text.length <= match.maxChars ? 1 : -2
  if (typeof match.minClauses === 'number') score += countClauses(text) >= match.minClauses ? 1 : -2

  return { score, signals: any.matched }
}

function termsOf(value) {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string' && item.length > 0)
  return typeof value === 'string' && value.length > 0 ? [value] : []
}

function matchTerms(text, terms) {
  const matched = []
  let count = 0
  for (const term of terms) {
    const hits = termCount(text, term)
    if (hits > 0) {
      matched.push(term)
      count += hits
    }
  }
  return { count, matched }
}

function termCount(text, term) {
  const haystack = text.toLowerCase()
  const needle = term.toLowerCase()
  let count = 0
  let index = 0
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1
    index += needle.length
  }
  return count
}

const CLAUSE_BREAK = /[，。；;,.!?！？\n]/g
const CONNECTOR = /(然后|接着|并且|同时|最后|首先|以及|and then|finally|also)/gi

function countClauses(text) {
  return (text.match(CLAUSE_BREAK)?.length ?? 0) + (text.match(CONNECTOR)?.length ?? 0)
}
