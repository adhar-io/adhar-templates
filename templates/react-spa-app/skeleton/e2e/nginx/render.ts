// Renders nginx-app.conf the way the nginx buildpack does when the container
// starts: Go text/template with an `env` function. Only the constructs that
// file uses are implemented — `env "X"`, `or`, `and`, `if`/`else`/`end` and the
// `{{-`/`-}}` trim markers — and anything else is an error, exactly as a
// template the buildpack cannot render stops nginx from starting.
//
//   node e2e/nginx/render.ts nginx-app.conf > rendered.conf   (reads process.env)
//
// TypeScript that Node runs as it is (Node 22.18+ strips the types itself), so
// it needs no dependency and no build step.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

type Env = Record<string, string | undefined>

/** Literal text, or a `{{ … }}` action (whose text is always ''). */
interface Token {
  text: string
  action?: string
  trimLeft?: boolean
  trimRight?: boolean
}

export function render(source: string, env: Env): string {
  const tokens: Token[] = []
  let pos = 0
  const re = /\{\{(-?)\s*([\s\S]*?)\s*(-?)\}\}/g
  for (let m: RegExpExecArray | null; (m = re.exec(source)); ) {
    tokens.push({ text: source.slice(pos, m.index) }, { text: '', action: m[2], trimLeft: m[1] === '-', trimRight: m[3] === '-' })
    pos = m.index + m[0].length
  }
  tokens.push({ text: source.slice(pos) })
  // Trim markers remove ALL adjacent whitespace, newlines included.
  tokens.forEach((t, i) => {
    if (t.action === undefined) return
    const before = tokens[i - 1]
    const after = tokens[i + 1]
    if (t.trimLeft && before) before.text = before.text.replace(/\s+$/, '')
    if (t.trimRight && after) after.text = after.text.replace(/^\s+/, '')
  })

  const value = (expr: string): string => {
    const e = expr.trim()
    let m: RegExpMatchArray | null
    if ((m = e.match(/^"((?:[^"\\]|\\.)*)"$/))) return JSON.parse(`"${m[1]}"`) as string
    if ((m = e.match(/^env\s+"([^"]*)"$/))) return env[m[1]] ?? ''
    if ((m = e.match(/^\((.*)\)$/s))) return value(m[1])
    if ((m = e.match(/^(and|or)\s+(.+)$/s))) {
      const args = splitArgs(m[2]).map(value)
      const last = args[args.length - 1] ?? ''
      if (m[1] === 'and') return args.find((a) => !a) ?? last
      return args.find((a) => a) ?? last
    }
    throw new Error(`unsupported template expression: {{ ${expr} }}`)
  }

  let out = ''
  const stack: { taking: boolean; taken: boolean }[] = []
  const emitting = () => stack.every((s) => s.taking)
  for (const t of tokens) {
    if (t.action === undefined) {
      if (emitting()) out += t.text
      continue
    }
    const a = t.action
    let m: RegExpMatchArray | null
    if ((m = a.match(/^if\s+(.+)$/s))) {
      const cond = emitting() && Boolean(value(m[1]))
      stack.push({ taking: cond, taken: cond })
    } else if (a === 'else') {
      const top = stack[stack.length - 1]
      if (!top) throw new Error('{{ else }} without {{ if }}')
      top.taking = !top.taken
      top.taken = true
    } else if (a === 'end') {
      if (!stack.pop()) throw new Error('{{ end }} without {{ if }}')
    } else if (emitting()) {
      out += String(value(a))
    } else {
      value(a) // still validated
    }
  }
  if (stack.length) throw new Error('unclosed {{ if }}')
  return out
}

// Split `(a) (b) "c"` into top-level arguments.
function splitArgs(s: string): string[] {
  const args: string[] = []
  let depth = 0
  let quoted = false
  let cur = ''
  for (const ch of s.trim()) {
    if (ch === '"' && !cur.endsWith('\\')) quoted = !quoted
    if (!quoted && ch === '(') depth++
    if (!quoted && ch === ')') depth--
    if (!quoted && depth === 0 && /\s/.test(ch)) {
      if (cur) args.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur) args.push(cur)
  return args
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(render(readFileSync(process.argv[2], 'utf8'), process.env))
}
