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

/** Slot triple returned by the switch tools. */
const STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    base: { type: 'string' },
    baseTitle: { type: 'string' },
    style: { type: 'string' },
    styleTitle: { type: 'string' },
    persona: { type: 'string' },
    personaTitle: { type: 'string' },
  },
  required: ['enabled', 'base', 'baseTitle', 'style', 'styleTitle', 'persona', 'personaTitle'],
}

const LIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    base: { type: 'string' },
    persona: { type: 'string' },
    style: { type: 'string' },
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
  required: ['base', 'persona', 'style', 'styles'],
}

/** Current status: which switches are on, and which file fills each slot. */
function status(config) {
  const state = readState(config)
  const title = (id) => {
    if (id === '') return ''
    const text = readStyle(id)
    return text === undefined ? id : styleTitle(text, id)
  }
  return {
    enabled: state.enabled,
    base: state.base,
    baseTitle: title(state.base),
    style: state.style,
    styleTitle: title(state.style),
    persona: state.persona,
    personaTitle: title(state.persona),
  }
}

/** Render one status value for the transcript. */
function renderStatus(_args, value) {
  const mode = value.enabled ? '开启' : '关闭'
  const slot = (id, title, empty) => (id === '' ? empty : (title || id))
  return [{
    type: 'text',
    text: [
      `成人对话模式：${mode}`,
      `防八股：${slot(value.base, value.baseTitle, '关')}`,
      `人设：${slot(value.persona, value.personaTitle, '无')}`,
      `文风：${slot(value.style, value.styleTitle, '无')}`,
    ].join('；'),
  }]
}

/** Render the style index. */
function renderStyles(_args, value) {
  const active = [value.base, value.persona, value.style].filter(Boolean)
  const lines = value.styles.map((style) => {
    const mark = active.includes(style.id) ? '（使用中）' : ''
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
    const body = (id) => {
      if (id === '') return ''
      const text = readStyle(id)
      return text === undefined ? '' : styleBody(text)
    }
    return composeContract({
      baseText: body(state.base),
      personaText: body(state.persona),
      styleText: body(state.style),
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
    description: `List the style/persona library in ${stylesDir()} and mark the files currently used by the base, persona and style slots.`,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: LIST_SCHEMA, render: renderStyles },
    isConcurrencySafe: () => true,
    async execute() {
      const state = readState(config)
      return { base: state.base, persona: state.persona, style: state.style, styles: listStyles() }
    },
  })

  ctx.tools.register({
    name: 'set_unbound_mode',
    description: 'Turn the direct adult-conversation mode on or off, and/or fill one of the three independent prompt slots: base (防八股, always-on writing hygiene), persona (role-play identity) and style (prose style). Pass an empty string to clear a slot; omit a field to keep it. Use only when the user asks to change this mode or its prompt layers.',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Whether the interaction contract is active.',
        },
        base: {
          type: 'string',
          description: 'File id for the always-on anti-cliché layer; empty string turns it off. Defaults to anti-cliche.',
        },
        persona: {
          type: 'string',
          description: 'File id for the role-play persona (who is talking); empty string = no persona.',
        },
        style: {
          type: 'string',
          description: 'File id for the prose style (how it writes); empty string = no style.',
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
      for (const slot of ['base', 'persona', 'style']) {
        if (args?.[slot] === undefined) continue
        if (typeof args[slot] !== 'string') throw new Error(`set_unbound_mode \`${slot}\` must be a string`)
        const id = args[slot].trim()
        if (id !== '' && readStyle(id) === undefined) {
          throw new Error(`没有这个文件：${id}（现有：${listStyles().map((style) => style.id).join('、') || '空'}）`)
        }
        patch[slot] = id
      }
      if (Object.keys(patch).length === 0) throw new Error('set_unbound_mode needs `enabled` and/or one of base/persona/style')
      writeState(patch, config)
      return status(config)
    },
  })

  ctx.tools.register({
    name: 'save_unbound_style',
    description: 'Save a prompt file into the library and point one slot at it. Keep the layers separate: base = 防八股 (writing hygiene, always on), persona = role-play identity, style = prose style. Use when the user wants to keep a tone, voice or character.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'File name and title.' },
        text: { type: 'string', description: 'The prompt text, in the language it should apply.' },
        slot: {
          type: 'string',
          enum: ['base', 'persona', 'style'],
          description: 'Which layer this file fills; defaults to style.',
        },
      },
      required: ['name', 'text'],
      additionalProperties: false,
    },
    output: { schema: STATUS_SCHEMA, render: renderStatus },
    isConcurrencySafe: () => false,
    async execute(args) {
      if (typeof args?.name !== 'string' || args.name.trim() === '') throw new Error('save_unbound_style needs a name')
      if (typeof args.text !== 'string' || args.text.trim() === '') throw new Error('save_unbound_style needs non-empty text')
      const slot = args.slot ?? 'style'
      if (!['base', 'persona', 'style'].includes(slot)) throw new Error('save_unbound_style `slot` must be base, persona or style')
      const id = styleId(args.name)
      if (id === '') throw new Error('save_unbound_style needs a usable file name')
      writeText(join(stylesDir(), `${id}.md`), `# ${args.name.trim()}\n\n${args.text.trim()}\n`)
      writeState({ [slot]: id }, config)
      return status(config)
    },
  })
}

/** Exported for the panel plugin's reference and for tests. */
export { CORE_PROMPT, DEFAULT_STYLE_ID, listStyles, readState, stylesDir }
