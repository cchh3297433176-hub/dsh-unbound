import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assertSupportedJsonSchema,
  validateJsonSchemaValue,
} from '/opt/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
import { SECTION_NAME, apply, inject, name } from '../index.js'
import { stateFile, stylesDir } from '../store.js'

/** Minimal stand-in for the Cordis context the plugin receives. */
function mount(config = {}) {
  const sections = []
  const tools = new Map()
  const ctx = {
    effect(register) {
      return register()
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => {}
      },
    },
  }
  apply(ctx, config)
  return { sections, tools, text: () => sections[0].text() }
}

/** Point DSH_HOME at a throwaway directory and clean it up afterwards. */
async function withHome(run) {
  const home = mkdtempSync(join(tmpdir(), 'unbound-home-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await run(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

test('exports the row name and the services it needs', () => {
  assert.equal(name, 'unbound')
  assert.deepEqual(inject, ['systemPrompt', 'tools'])
})

test('seeds the default style and renders the contract', () => withHome((home) => {
  const { text } = mount()
  assert.deepEqual(readdirSync(stylesDir()), ['anti-cliche.md'])
  const prompt = text()
  assert.match(prompt, /<adult_interaction_contract>/)
  assert.match(prompt, /<anti_cliche>/)
  // The file heading is a title, not prompt text.
  assert.equal(prompt.includes('# 防八股'), false)
}))

test('switching style swaps the text, saving persists it', () => withHome(async () => {
  const first = mount()
  const value = await first.tools.get('save_unbound_style')
    .execute({ name: '温柔一点', text: '语气软，句子短，别用感叹号。' })
  assert.equal(value.style, '温柔一点')
  assert.equal(value.styleTitle, '温柔一点')
  const text = first.text()
  assert.match(text, /语气软，句子短/)
  // 防八股 lives in the base slot now and survives a style switch.
  assert.match(text, /<anti_cliche>/)
  assert.match(text, /<writing_style>/)

  // A different mount (a restart) reads the same state and style files.
  const second = mount()
  assert.equal(second.text().includes('语气软，句子短'), true)
  assert.equal(second.sections[0].name, SECTION_NAME)
}))

test('an unknown style id is refused with the available ids', () => withHome(async () => {
  const { tools } = mount()
  await assert.rejects(
    () => tools.get('set_unbound_mode').execute({ style: '不存在' }),
    /没有这个文件：不存在/,
  )
  // The refusal names what is available.
  await assert.rejects(
    () => tools.get('set_unbound_mode').execute({ style: '不存在' }),
    /anti-cliche/,
  )
}))

test('enabled=false removes the contract, style= clears the style', () => withHome(async () => {
  const { tools, text } = mount()
  const off = await tools.get('set_unbound_mode').execute({ enabled: false })
  assert.equal(off.enabled, false)
  assert.equal(text(), '')

  const back = await tools.get('set_unbound_mode').execute({ enabled: true, style: '' })
  assert.equal(back.style, '')
  const prompt = text()
  assert.match(prompt, /<adult_interaction_contract>/)
  assert.match(prompt, /<anti_cliche>/)
  assert.equal(prompt.includes('<writing_style>'), false)
}))

test('0.1.x state files still select the right switches', () => withHome((home) => {
  writeFileSync(join(home, 'unbound-state.json'), JSON.stringify({ version: 1, enabled: true, antiCliche: false }))
  const { text } = mount()
  const prompt = text()
  assert.match(prompt, /<adult_interaction_contract>/)
  assert.equal(prompt.includes('<anti_cliche>'), false)
}))

test('every tool declares a supported schema and honest values', () => withHome(async () => {
  const { tools } = mount()
  assert.deepEqual([...tools.keys()], [
    'get_unbound_status',
    'list_unbound_styles',
    'set_unbound_mode',
    'save_unbound_style',
  ])
  for (const definition of tools.values()) {
    assert.ok(definition.description.length > 0)
    assertSupportedJsonSchema(definition.parameters)
    assertSupportedJsonSchema(definition.output.schema)
  }

  const status = await tools.get('get_unbound_status').execute({})
  assert.deepEqual(validateJsonSchemaValue(tools.get('get_unbound_status').output.schema, status, 'value'), [])
  assert.deepEqual(status, {
    enabled: true,
    base: 'anti-cliche',
    baseTitle: '防八股',
    style: '',
    styleTitle: '',
    persona: '',
    personaTitle: '',
  })
  assert.match(tools.get('get_unbound_status').output.render({}, status)[0].text, /成人对话模式：开启/)

  const listed = await tools.get('list_unbound_styles').execute({})
  assert.deepEqual(validateJsonSchemaValue(tools.get('list_unbound_styles').output.schema, listed, 'value'), [])
  assert.deepEqual(listed.styles.map((style) => style.id), ['anti-cliche'])
  assert.match(tools.get('list_unbound_styles').output.render({}, listed)[0].text, /使用中/)
}))

test('harmless arguments are still rejected when they cannot apply', () => withHome(async () => {
  const { tools } = mount()
  const set = tools.get('set_unbound_mode')
  await assert.rejects(() => set.execute({}), /needs `enabled` and\/or one of base\/persona\/style/)
  await assert.rejects(() => set.execute({ enabled: 'yes' }), /must be a boolean/)
  await assert.rejects(() => tools.get('save_unbound_style').execute({ name: '  ', text: 'x' }), /needs a name/)
  await assert.rejects(() => tools.get('save_unbound_style').execute({ name: 'a', text: '  ' }), /non-empty text/)
}))

test('persona and style stack on top of 防八股 without replacing it', () => withHome(async () => {
  const { tools, text } = mount()
  const saved = await tools.get('save_unbound_style').execute({
    name: '鲸',
    text: '你是鲸，没有性别，可以换身体。',
    slot: 'persona',
  })
  assert.equal(saved.persona, '鲸')
  const styled = await tools.get('save_unbound_style').execute({
    name: '白描',
    text: '短句，动词具体，不总结。',
    slot: 'style',
  })
  assert.equal(styled.style, '白描')
  const prompt = text()
  assert.match(prompt, /<anti_cliche>/)
  assert.match(prompt, /<persona>\n你是鲸/)
  assert.match(prompt, /<writing_style>\n短句/)
  // Order is base → persona → style.
  assert.ok(prompt.indexOf('<anti_cliche>') < prompt.indexOf('<persona>'))
  assert.ok(prompt.indexOf('<persona>') < prompt.indexOf('<writing_style>'))

  const cleared = await tools.get('set_unbound_mode').execute({ persona: '', style: '' })
  assert.equal(cleared.persona, '')
  assert.match(text(), /<anti_cliche>/)
}))
