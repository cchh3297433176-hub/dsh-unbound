/**
 * dsh-unbound — a switchable “direct adult conversation” policy with an
 * editable style library.
 *
 * Two independent axes:
 *   enabled   the interaction contract (permission + hard limits)
 *   style     one markdown file from $DSH_HOME/unbound/styles, about *how* it talks
 *
 * State and styles are files, re-read by mtime, so the phone panel (a dsh-go
 * plugin in this same process) and this plugin never drift: the panel writes,
 * the next prompt assembly picks it up.
 *
 * The contract is registered as a system-prompt section. Nothing here writes
 * session messages: the v4 session format refuses a durable message whose
 * source kind is `plugin` ("format v4 message requires a producer-owned source
 * kind"), which is what broke every turn in 0.1.0.
 *
 * No package imports: only `node:` builtins, so the package resolves wherever
 * DSH mounts it.
 */
import { join } from 'node:path'
import { CORE_PROMPT, DEFAULT_STYLE, composeContract } from './prompts.js'
import {
  DEFAULT_STYLE_ID,
  listStyles,
  readState,
  readStyle,
  seedStyles,
  styleBody,
  styleId,
  styleTitle,
  stylesDir,
  writeState,
  writeText,
} from './store.js'

/** Cordis plugin name. */
export const name = 'unbound'

/** The services this plugin contributes to. */
export const inject = ['systemPrompt', 'tools']

/** Prompt section name; stable so a profile patch can shadow it. */
export const SECTION_NAME = 'unbound:contract'

/** Placed with the behavioural policies (plan 500, team 600), before tool docs. */
const SECTION_ORDER = 650

/** Boolean pair returned by the switch tools. */
const STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    style: { type: 'string' },
    styleTitle: { type: 'string' },
  },
  required: ['enabled', 'style', 'styleTitle'],
}

const LIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    active: { type: 'string' },
    styles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          chars: { type: 'integer' },
        },
        required: ['id', 'title', 'chars'],
      },
    },
  },
  required: ['active', 'styles'],
}

/** Current status: which switches are on and which style is active. */
function status(config) {
  const state = readState(config)
  const text = state.style === '' ? undefined : readStyle(state.style)
  return {
    enabled: state.enabled,
    style: state.style,
    styleTitle: text === undefined ? '' : styleTitle(text, state.style),
  }
}

/** Render one status value for the transcript. */
function renderStatus(_args, value) {
  const mode = value.enabled ? '开启' : '关闭'
  const style = value.style === ''
    ? '无文风'
    : `文风：${value.styleTitle || value.style}`
  return [{ type: 'text', text: `成人对话模式：${mode}；${style}` }]
}

/** Render the style index. */
function renderStyles(_args, value) {
  const lines = value.styles.map((style) => {
    const mark = style.id === value.active ? '（使用中）' : ''
    return `- ${style.title}${mark} · ${style.chars} 字 · ${style.id}.md`
  })
  return [{
    type: 'text',
    text: `文风库 ${stylesDir()}：\n${lines.length > 0 ? lines.join('\n') : '（还是空的）'}`,
  }]
}

/**
 * Register the contract section and the switch tools.
 * @param ctx - the owning Cordis context.
 * @param config - row config: enabled, antiCliche (legacy), extraInstructions.
 */
export function apply(ctx, config = {}) {
  const extraInstructions = typeof config.extraInstructions === 'string'
    ? config.extraInstructions
    : ''

  // Create the library (and the default style) before anything reads it.
  seedStyles(DEFAULT_STYLE)

  // Re-rendered on every assembly, so switches and edits apply immediately.
  const contractText = () => {
    const state = readState(config)
    if (!state.enabled) return ''
    const text = state.style === '' ? undefined : readStyle(state.style)
    return composeContract({
      styleText: text === undefined ? '' : styleBody(text),
      extraInstructions,
    })
  }

  ctx.effect(() => ctx.systemPrompt.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    interpolate: false,
    text: contractText,
  }), 'unbound.contract')

  ctx.tools.register({
    name: 'get_unbound_status',
    description: 'Show whether the direct adult-conversation mode is on and which style file is active.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: STATUS_SCHEMA, render: renderStatus },
    isConcurrencySafe: () => true,
    async execute() {
      return status(config)
    },
  })

  ctx.tools.register({
    name: 'list_unbound_styles',
    description: `List the style library in ${stylesDir()} and mark the active style.`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: LIST_SCHEMA, render: renderStyles },
    isConcurrencySafe: () => true,
    async execute() {
      const state = readState(config)
      return { active: state.style, styles: listStyles() }
    },
  })

  ctx.tools.register({
    name: 'set_unbound_mode',
    description: 'Turn the direct adult-conversation mode on or off, and optionally switch to a style id from list_unbound_styles (empty string clears the style). Use only when the user asks to change this mode or style.',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Whether the interaction contract is active.',
        },
        style: {
          type: 'string',
          description: 'Style id to switch to; pass an empty string for no style. Files come from list_unbound_styles.',
        },
      },
      additionalProperties: false,
    },
    output: { schema: STATUS_SCHEMA, render: renderStatus },
    isConcurrencySafe: () => false,
    async execute(args) {
      const patch = {}
      if (args?.enabled !== undefined) {
        if (typeof args.enabled !== 'boolean') throw new Error('set_unbound_mode `enabled` must be a boolean')
        patch.enabled = args.enabled
      }
      if (args?.style !== undefined) {
        if (typeof args.style !== 'string') throw new Error('set_unbound_mode `style` must be a string')
        const id = args.style.trim()
        if (id !== '' && readStyle(id) === undefined) {
          throw new Error(`没有这套文风：${id}（现有：${listStyles().map((style) => style.id).join('、') || '空'}）`)
        }
        patch.style = id
      }
      if (Object.keys(patch).length === 0) throw new Error('set_unbound_mode needs `enabled` and/or `style`')
      writeState(patch, config)
      return status(config)
    },
  })

  ctx.tools.register({
    name: 'save_unbound_style',
    description: 'Save a style file into the style library and make it active. Use when the user wants to keep a tone/voice they like.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Style name; becomes the file name and the title.' },
        text: { type: 'string', description: 'The style instruction text, in the language it should apply.' },
      },
      required: ['name', 'text'],
      additionalProperties: false,
    },
    output: { schema: STATUS_SCHEMA, render: renderStatus },
    isConcurrencySafe: () => false,
    async execute(args) {
      if (typeof args?.name !== 'string' || args.name.trim() === '') throw new Error('save_unbound_style needs a name')
      if (typeof args.text !== 'string' || args.text.trim() === '') throw new Error('save_unbound_style needs non-empty text')
      const id = styleId(args.name)
      if (id === '') throw new Error('save_unbound_style needs a usable file name')
      writeText(join(stylesDir(), `${id}.md`), `# ${args.name.trim()}\n\n${args.text.trim()}\n`)
      writeState({ style: id }, config)
      return status(config)
    },
  })
}

/** Exported for the panel plugin's reference and for tests. */
export { CORE_PROMPT, DEFAULT_STYLE_ID, listStyles, readState, stylesDir }
