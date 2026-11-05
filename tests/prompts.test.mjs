import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompt } from '../prompts.js'

test('default prompt enables adult-context continuity without a fixed persona', () => {
  const prompt = buildPrompt()
  assert.match(prompt, /成年人之间自愿/)
  assert.match(prompt, /保持连续性/)
  assert.match(prompt, /不要擅自扮演固定角色/)
  assert.match(prompt, /不是……而是……/)
})

test('anti-cliche block can be disabled independently', () => {
  const prompt = buildPrompt({ antiCliche: false })
  assert.match(prompt, /adult_interaction_contract/)
  assert.doesNotMatch(prompt, /anti_cliche/)
})

test('does not impose prose style or response length', () => {
  const prompt = buildPrompt()
  assert.doesNotMatch(prompt, /字数|字以上|字以下|轻小说|网文|文风/)
})

test('extra instructions are appended without replacing the core contract', () => {
  const prompt = buildPrompt({ extraInstructions: '称呼用户为船长。' })
  assert.match(prompt, /成年人之间自愿/)
  assert.match(prompt, /称呼用户为船长/)
})
