import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

function createHarness(config = {}) {
  const handlers = new Map()
  const commands = []
  const ctx = {
    logger: { info() {}, warn() {} },
    on(event, handler) {
      handlers.set(event, handler)
      return () => {}
    },
    get(name) {
      return name === 'commands' ? { register: definition => { commands.push(definition); return () => {} } } : undefined
    },
    effect(invoke) {
      const dispose = invoke()
      return () => dispose?.()
    },
  }
  apply(ctx, { log: false, ...config })
  return { handlers, commands }
}

function createAgent(id = 'session-1', origin = undefined) {
  const sections = []
  const restrictions = []
  return {
    agent: {
      id,
      session: { header: { origin } },
      ctx: {
        systemPrompt: { section: section => { sections.push(section); return () => {} } },
        tools: { restrict: filter => { restrictions.push(filter); return () => {} } },
      },
    },
    sections,
    restrictions,
  }
}

function claim(harness, agent, text, kind = 'user') {
  harness.handlers.get('agent/inbox/claimed')({
    agent,
    message: { source: { kind }, content: [{ type: 'text', text }] },
    turn: 1,
  })
}

test('applies the clarify route before the first request', () => {
  const harness = createHarness()
  const { agent, sections, restrictions } = createAgent()
  claim(harness, agent, '帮我优化一下这个页面')
  assert.equal(sections.length, 1)
  assert.match(sections[0].text, /Harness route: clarify/)
  assert.equal(restrictions.length, 0)
})

test('direct route registers guidance and denies planning tools', () => {
  const harness = createHarness()
  const { agent, sections, restrictions } = createAgent()
  claim(harness, agent, 'dsh 是什么？')
  assert.match(sections[0].text, /Harness route: direct/)
  assert.deepEqual(restrictions, [{ deny: ['todo_write', 'exit_plan_mode'] }])
})

test('ignores injected messages and routes only the first user message', () => {
  const harness = createHarness()
  const { agent, sections } = createAgent()
  claim(harness, agent, 'runtime context', 'time-context')
  assert.equal(sections.length, 0)
  claim(harness, agent, 'dsh 是什么？')
  assert.equal(sections.length, 1)
  claim(harness, agent, '帮我优化一下这个页面')
  assert.equal(sections.length, 1)
})

test('skips subagent sessions by default', () => {
  const harness = createHarness()
  const { agent, sections } = createAgent('child', 'subagent')
  claim(harness, agent, 'dsh 是什么？')
  assert.equal(sections.length, 0)
})

test('/route overrides the automatic decision', () => {
  const harness = createHarness()
  const { agent, sections } = createAgent()
  const route = harness.commands.find(command => command.name === 'route')
  assert.equal(route.handler({ agent, rawInput: '' }).kind, 'success')
  assert.match(route.handler({ agent, rawInput: 'decompose' }).text, /decompose/)
  assert.match(sections[0].text, /Harness route: decompose/)
  claim(harness, agent, 'dsh 是什么？')
  assert.equal(sections.length, 1)
  assert.match(route.handler({ agent, rawInput: 'unknown' }).text, /Unknown/)
})
