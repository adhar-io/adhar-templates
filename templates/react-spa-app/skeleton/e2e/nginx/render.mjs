// Renders nginx-app.conf the way the nginx buildpack does when the container
// starts: Go text/template with an `env` function. Only the constructs that
// file uses are implemented — `env "X"`, `or`, `and`, `if`/`else`/`end` and the
// `{{-`/`-}}` trim markers — and anything else is an error, exactly as a
// template the buildpack cannot render stops nginx from starting.
//
//   node e2e/nginx/render.mjs nginx-app.conf > rendered.conf   (reads process.env)
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function render(source, env) {
  const tokens = []
  let pos = 0
  const re = /\{\{(-?)\s*([\s\S]*?)\s*(-?)\}\}/g
  for (let m; (m = re.exec(source)); ) {
    tokens.push({ text: source.slice(pos, m.index) }, { action: m[2], trimLeft: m[1] === '-', trimRight: m[3] === '-' })
    pos = m.index + m[0].length
  }
  tokens.push({ text: source.slice(pos) })
  // Trim markers remove ALL adjacent whitespace, newlines included.
  tokens.forEach((t, i) => {
    if (!t.action) return
    if (t.trimLeft && tokens[i - 1]) tokens[i - 1].text = tokens[i - 1].text.replace(/\s+$/, '')
    if (t.trimRight && tokens[i + 1]) tokens[i + 1].text = tokens[i + 1].text.replace(/^\s+/, '')
  })

  const value = (expr) => {
    const e = expr.trim()
    let m
    if ((m = e.match(/^"((?:[^"\\]|\\.)*)"$/))) return JSON.parse(`"${m[1]}"`)
    if ((m = e.match(/^env\s+"([^"]*)"$/))) return env[m[1]] ?? ''
    if ((m = e.match(/^\((.*)\)$/s))) return value(m[1])
    if ((m = e.match(/^(and|or)\s+(.+)$/s))) {
      const args = splitArgs(m[2]).map(value)
      if (m[1] === 'and') return args.find((a) => !a) ?? args[args.length - 1]
      return args.find((a) => a) ?? args[args.length - 1]
    }
    throw new Error(`unsupported template expression: {{ ${expr} }}`)
  }

  let out = ''
  const stack = [] // { taking, taken, outer }
  const emitting = () => stack.every((s) => s.taking)
  for (const t of tokens) {
    if (!t.action) {
      if (emitting()) out += t.text
      continue
    }
    const a = t.action
    let m
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
function splitArgs(s) {
  const args = []
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
