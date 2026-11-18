import assert from 'node:assert/strict'
import test from 'node:test'
import { classify, extractText, normalizeConfig } from '../router-core.js'

const config = normalizeConfig()

test('defaults to balanced when no rule is strong enough', () => {
  const decision = classify('把这个函数改成箭头函数', config)
  assert.equal(decision.route, 'balanced')
  assert.equal(decision.confidence, 'default')
})

test('routes a short fact question to direct', () => {
  const decision = classify('dsh 是什么？', config)
  assert.equal(decision.route, 'direct')
  assert.ok(decision.signals.includes('是什么'))
})

test('routes a vague request to clarify', () => {
  const decision = classify('帮我优化一下这个页面', config)
  assert.equal(decision.route, 'clarify')
  assert.ok(decision.signals.includes('优化一下'))
})

test('routes a multi-step refactor to decompose', () => {
  const text = '重构用户模块，把 service 和 UI 拆开，补齐测试，然后做全量回归验证，最后更新文档并部署'
  const decision = classify(text, config)
  assert.equal(decision.route, 'decompose')
  assert.ok(decision.signals.includes('重构'))
})

test('notAny disqualifies the direct route', () => {
  const decision = classify('如何重构这个模块', config)
  assert.notEqual(decision.route, 'direct')
  assert.ok(decision.scores.direct <= -100)
})

test('reads text from a message, content blocks, and nested data', () => {
  assert.equal(extractText('plain'), 'plain')
  assert.equal(extractText({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }), 'a\nb')
  assert.equal(extractText({ data: { message: { content: [{ type: 'text', text: 'nested' }] } } }), 'nested')
})

test('supports a custom route from configuration', () => {
  const custom = normalizeConfig({
    routes: {
      research: {
        match: { any: ['调研', 'survey'], minChars: 4 },
        prompt: { text: 'Research carefully.' },
        tools: null,
      },
    },
  })
  const decision = classify('做一次竞品调研', custom)
  assert.equal(decision.route, 'research')
})
