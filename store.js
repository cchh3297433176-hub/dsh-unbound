/**
 * File-backed state and style library for dsh-unbound.
 *
 * Everything the plugin renders comes from these two places, so the phone panel
 * (a dsh-go plugin in the same process) can change behaviour by writing files:
 *   $DSH_HOME/unbound/state.json     { enabled, style }
 *   $DSH_HOME/unbound/styles/*.md    one style per file
 *
 * Reads are cached by mtime+size, which keeps a per-step prompt assembly cheap
 * while still noticing an edit made one second ago.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Style used when nothing else is chosen; its file is seeded on first run. */
export const DEFAULT_STYLE_ID = 'anti-cliche'

const cache = new Map()

/** `$DSH_HOME` with the same fallback the rest of DSH uses. */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** Directory holding the state file and the style library. */
export function unboundDir() {
  return join(dshHome(), 'unbound')
}

/** Current state file. */
export function stateFile() {
  return join(unboundDir(), 'state.json')
}

/** Style library directory. */
export function stylesDir() {
  return join(unboundDir(), 'styles')
}

/** Where 0.1.x kept its state; read once for migration. */
function legacyStateFile() {
  return join(dshHome(), 'unbound-state.json')
}

/** Read a small UTF-8 file through the mtime+size cache. */
function readCached(path) {
  let stat
  try {
    stat = statSync(path)
  } catch {
    cache.delete(path)
    return undefined
  }
  const hit = cache.get(path)
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.text
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    cache.delete(path)
    return undefined
  }
  cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, text })
  return text
}

/** Write JSON atomically (tmp + rename) so a reader never sees half a file. */
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, path)
  cache.delete(path)
}

/** Write a UTF-8 text file atomically. */
export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, path)
  cache.delete(path)
}

/** Read one style file by id; `undefined` when it does not exist. */
export function readStyle(id) {
  const safe = String(id ?? '').trim()
  if (safe === '' || safe.includes('/') || safe.includes('\\') || safe.startsWith('.')) return undefined
  return readCached(join(stylesDir(), `${safe}.md`))
}

/** Title of a style body: its first `# ` heading, else the id. */
export function styleTitle(text, fallback) {
  const first = String(text ?? '').split('\n', 1)[0] ?? ''
  const match = /^#\s+(.+)$/.exec(first.trim())
  return match ? match[1].trim() : fallback
}

/** Style body without the leading `# ` heading. */
export function styleBody(text) {
  const lines = String(text ?? '').split('\n')
  if (/^#\s+/.test((lines[0] ?? '').trim())) lines.shift()
  return lines.join('\n').trim()
}

/** List every style file: `{ id, title, chars }`, sorted by title. */
export function listStyles() {
  let names
  try {
    names = readdirSync(stylesDir())
  } catch {
    return []
  }
  const styles = []
  for (const name of names) {
    if (!name.endsWith('.md') || name.startsWith('.')) continue
    const id = name.slice(0, -3)
    const text = readCached(join(stylesDir(), name))
    if (text === undefined) continue
    styles.push({ id, title: styleTitle(text, id), chars: styleBody(text).length })
  }
  return styles.sort((left, right) => left.title.localeCompare(right.title, 'zh'))
}

/** Seed the default style file once, so the directory is never empty. */
export function seedStyles(defaultText) {
  const existing = listStyles()
  if (existing.length > 0) return existing
  writeText(join(stylesDir(), `${DEFAULT_STYLE_ID}.md`), `${defaultText.trim()}\n`)
  return listStyles()
}

/** Turn a user-supplied name into a file id. */
export function styleId(name) {
  const trimmed = String(name ?? '').trim()
  if (trimmed === '') return ''
  return trimmed
    .replace(/\.md$/i, '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Normalize whatever is on disk into `{ enabled, base, style, persona }`.
 *
 * Three independent slots, all pointing at files in the same library:
 *   base     always-on writing hygiene (防八股), seeded as `anti-cliche`
 *   style    how the prose reads (sentence rhythm, diction)
 *   persona  who is talking (role-play identity); empty = no role
 * A v2 state (`{ style }` only) migrates: `anti-cliche` becomes the base, and
 * any other id stays in `style` — so selecting a persona no longer costs the
 * anti-cliché layer.
 */
function normalize(raw, config) {
  const enabled = typeof raw?.enabled === 'boolean' ? raw.enabled : config.enabled !== false
  const isV3 = raw !== null && typeof raw === 'object' && ('base' in raw || 'persona' in raw)
  if (isV3) {
    return {
      enabled,
      base: typeof raw.base === 'string' ? raw.base : DEFAULT_STYLE_ID,
      style: typeof raw.style === 'string' ? raw.style : '',
      persona: typeof raw.persona === 'string' ? raw.persona : '',
    }
  }
  const hasStyle = typeof raw?.style === 'string'
  const antiCliche = typeof raw?.antiCliche === 'boolean'
    ? raw.antiCliche
    : config.antiCliche !== false
  if (hasStyle) {
    // v2: one style file replaced everything, so it also replaced 防八股.
    return {
      enabled,
      base: DEFAULT_STYLE_ID,
      style: raw.style === DEFAULT_STYLE_ID ? '' : raw.style,
      persona: '',
    }
  }
  // v1: only the anti-cliché toggle existed.
  return {
    enabled,
    base: antiCliche ? DEFAULT_STYLE_ID : '',
    style: '',
    persona: '',
  }
}

/** Read the live state, falling back to legacy state then to row config. */
export function readState(config = {}) {
  for (const path of [stateFile(), legacyStateFile()]) {
    const text = readCached(path)
    if (text === undefined) continue
    try {
      return normalize(JSON.parse(text), config)
    } catch {
      // A corrupt file must not take the prompt down.
    }
  }
  return normalize(undefined, config)
}

/** Merge a patch into the state file and return the new state. */
export function writeState(patch, config = {}) {
  const next = { version: 3, ...readState(config), ...patch }
  writeJson(stateFile(), next)
  return {
    enabled: next.enabled,
    base: next.base,
    style: next.style,
    persona: next.persona,
  }
}
