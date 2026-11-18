/**
 * dsh-harness-router: route the first user request to a prompt/tool policy.
 *
 * The routing hook runs on `agent/inbox/claimed`, which fires after the loop
 * claims the message and before it resolves tools and assembles the prompt.
 * Registrations therefore affect the first model request.
 */

import { createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { classify, extractText, normalizeConfig } from './router-core.js'

export const name = 'harness-router'
export const inject = ['systemPrompt', 'tools']

/**
 * Register the router.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Plugin context.
 * @param {object} [rawConfig] - Configuration from cordis.yml.
 */
export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12)
  const logPath = config.logPath
    ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'harness-router', 'decisions.jsonl')

  const states = new WeakMap()
  const routed = new WeakSet()
  let logDirectoryReady

  const stateOf = (agent) => {
    let state = states.get(agent)
    if (state === undefined) {
      state = { routeId: undefined, disposers: [], disabled: false, decision: undefined }
      states.set(agent, state)
    }
    return state
  }

  const log = (message) => ctx.logger.info(`[harness-router] ${message}`)
  const warn = (message) => ctx.logger.warn(`[harness-router] ${message}`)

  const writeDecision = (entry) => {
    if (!config.log) return
    const write = async () => {
      logDirectoryReady ??= mkdir(dirname(logPath), { recursive: true })
      await logDirectoryReady
      await appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
    }
    write().catch(error => warn(`cannot write decision log: ${error.message}`))
  }

  const disposeRoute = (state) => {
    while (state.disposers.length > 0) {
      const dispose = state.disposers.pop()
      try {
        dispose()
      } catch (error) {
        warn(`cannot dispose a route registration: ${error.message}`)
      }
    }
  }

  const applyRoute = (agent, routeId, state) => {
    const route = config.routes[routeId]
    if (route === undefined) throw new Error(`unknown route "${routeId}"`)

    if (route.prompt?.text) {
      try {
        state.disposers.push(agent.ctx.systemPrompt.section({
          name: route.prompt.name ?? 'harness-router-guidance',
          order: route.prompt.order ?? 850,
          text: route.prompt.text,
        }))
      } catch (error) {
        warn(`cannot register prompt guidance for route "${routeId}": ${error.message}`)
      }
    }

    const allow = route.tools?.allow
    const deny = route.tools?.deny
    if ((allow?.length ?? 0) > 0 || (deny?.length ?? 0) > 0) {
      try {
        state.disposers.push(agent.ctx.tools.restrict({
          ...(allow?.length ? { allow } : {}),
          ...(deny?.length ? { deny } : {}),
        }))
      } catch (error) {
        warn(`cannot restrict tools for route "${routeId}": ${error.message}`)
      }
    }

    state.routeId = routeId
  }

  const handleClaimed = ({ agent, message, turn }) => {
    if (agent === undefined || message === undefined) return
    if (!config.includeSubagents && agent.session?.header?.origin === 'subagent') return
    if (routed.has(agent)) return
    if (message.source?.kind !== 'user') return

    const text = extractText(message).trim()
    if (text === '') return

    const state = stateOf(agent)
    routed.add(agent)
    if (state.disabled) return

    const decision = classify(text, config)
    state.decision = decision
    applyRoute(agent, decision.route, state)

    writeDecision({
      ts: new Date().toISOString(),
      sessionId: agent.id,
      turn,
      route: decision.route,
      confidence: decision.confidence,
      score: decision.score,
      signals: decision.signals,
      scores: decision.scores,
      textLength: text.length,
      textPreview: text.slice(0, 160),
      override: false,
      configHash,
    })

    log(`${agent.id} -> ${decision.route} (${decision.confidence}${decision.signals.length > 0 ? `: ${decision.signals.join(', ')}` : ''})`)
  }

  const handleRouteCommand = (agent, rawInput) => {
    const state = stateOf(agent)
    const input = String(rawInput ?? '').trim()

    if (input === '') {
      const current = state.routeId ?? 'pending'
      return {
        kind: 'success',
        text: `Harness route: ${current}. Available: ${Object.keys(config.routes).join(', ')}. Use /route <id> or /route off.`,
      }
    }

    if (input === 'off') {
      disposeRoute(state)
      state.routeId = undefined
      state.disabled = true
      routed.add(agent)
      return { kind: 'success', text: 'Harness routing disabled for this session.' }
    }

    if (config.routes[input] === undefined) {
      return { kind: 'error', text: `Unknown harness route: ${input}` }
    }

    disposeRoute(state)
    state.disabled = false
    applyRoute(agent, input, state)
    routed.add(agent)
    writeDecision({
      ts: new Date().toISOString(),
      sessionId: agent.id,
      turn: null,
      route: input,
      confidence: 'override',
      score: null,
      signals: [],
      scores: {},
      textLength: 0,
      textPreview: '',
      override: true,
      configHash,
    })
    return { kind: 'success', text: `Harness route set to ${input}.` }
  }

  ctx.on('agent/inbox/claimed', handleClaimed)

  const commands = ctx.get('commands')
  if (commands !== undefined) {
    ctx.effect(() => commands.register({
      name: 'route',
      description: 'Show or switch the harness route for this session',
      input: { hint: '[route-id|off]' },
      handler: ({ agent, rawInput }) => handleRouteCommand(agent, rawInput),
    }))
  }

  log(`loaded (${Object.keys(config.routes).length} routes, default ${config.defaultRoute})`)
}
