import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { buildPrompt } from './prompts.js'

export const name = 'unbound'
export const inject = ['agents', 'tools']

function resolveStatePath(config) {
  return typeof config.statePath === 'string' && config.statePath.trim()
    ? config.statePath
    : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'unbound-state.json')
}

function loadState(path, config) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed && typeof parsed.enabled === 'boolean') {
      return {
        enabled: parsed.enabled,
        antiCliche: typeof parsed.antiCliche === 'boolean'
          ? parsed.antiCliche
          : config.antiCliche !== false,
      }
    }
  } catch {
    // First run or an unreadable state file: use config defaults.
  }
  return {
    enabled: config.enabled !== false,
    antiCliche: config.antiCliche !== false,
  }
}

function persistState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ version: 1, ...state }, null, 2) + '\n')
  } catch {
    // Runtime switching still works on a read-only filesystem.
  }
}

export function apply(ctx, config = {}) {
  const statePath = resolveStatePath(config)
  const state = loadState(statePath, config)
  let revision = 0

  const snapshot = () => ({
    enabled: state.enabled,
    antiCliche: state.antiCliche,
  })

  ctx.tools.register(defineTool({
    name: 'get_unbound_status',
    description: 'Show whether the direct adult-conversation mode and anti-cliche filter are enabled.',
    parameters: {},
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean', required: true },
          antiCliche: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `成人对话模式：${value.enabled ? '开启' : '关闭'}；防八股：${value.antiCliche ? '开启' : '关闭'}`,
      }],
    },
    async execute() {
      return snapshot()
    },
  }))

  ctx.tools.register(defineTool({
    name: 'set_unbound_mode',
    description: 'Enable or disable direct adult conversation and optionally toggle the anti-cliche filter. Use only when the user asks to change this mode.',
    parameters: {
      enabled: {
        type: 'boolean',
        required: true,
        description: 'Whether direct adult-conversation instructions are active.',
      },
      antiCliche: {
        type: 'boolean',
        description: 'Optional anti-cliche setting. Omit to keep its current value.',
      },
    },
    isConcurrencySafe: () => false,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean', required: true },
          antiCliche: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已${value.enabled ? '开启' : '关闭'}成人对话模式；防八股${value.antiCliche ? '开启' : '关闭'}。`,
      }],
    },
    async execute(args) {
      state.enabled = args.enabled
      if (typeof args.antiCliche === 'boolean') state.antiCliche = args.antiCliche
      revision += 1
      persistState(statePath, state)
      return snapshot()
    },
  }))

  const injectedRevision = new WeakMap()

  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || !state.enabled) return decision

    const key = `${revision}:${state.antiCliche}:${config.extraInstructions || ''}`
    if (injectedRevision.get(agent) === key) return decision

    injectedRevision.set(agent, key)
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{
            type: 'text',
            text: buildPrompt({
              antiCliche: state.antiCliche,
              extraInstructions: config.extraInstructions,
            }),
          }],
          source: { kind: 'plugin', plugin: name, form: 'instructions' },
        }),
      ],
    }
  })
}
