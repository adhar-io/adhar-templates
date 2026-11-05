/**
 * The skeleton template syntax the platform's two scaffolders implement — the
 * Console's (apps/console/app/server/template-render.ts) and the CLI's
 * (cmd/apps/scaffold.go) — and NOTHING more:
 *
 *   ${{ values.<key> }}            with `| dump|lower|upper|escape` and `x or <default>`
 *   {% if %} {% elif %} {% else %} {% endif %}   paths, literals, ==, !=, not, and, or, ( )
 *   the whitespace-trimming {%- … -%} forms
 *
 * A file that uses anything else (a loop, a `{{ }}` block, a filter neither
 * scaffolder knows) is not rendered by them: the scaffolder DROPS it from the
 * new repository and reports nothing a developer would see. So this renderer
 * throws on the same inputs, and the tests render every file they check.
 */

export type Values = Record<string, unknown>

function getByPath(ctx: Values, path: string): unknown {
  const parts = path.split('.').map((p) => p.trim())
  let cur: unknown = ctx
  if (parts.length === 1 && !(parts[0] in ctx) && ctx.values && typeof ctx.values === 'object') cur = ctx.values
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Values)) cur = (cur as Values)[p]
    else return undefined
  }
  return cur
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return String(v)
}

function applyFilter(name: string, src: unknown): unknown {
  if (name === 'dump') return JSON.stringify(src ?? null)
  const v = String(src ?? '')
  if (name === 'escape') {
    return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }
  return name === 'lower' ? v.toLowerCase() : v.toUpperCase()
}

function literalOrPath(raw: string, ctx: Values): unknown {
  const str = raw.match(/^'(.*)'$|^"(.*)"$/)
  if (str) return str[1] ?? str[2] ?? ''
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null' || raw === 'none') return null
  return evalExpr(raw, ctx)
}

export function evalExpr(expr: string, ctx: Values): unknown {
  const e = expr.trim()
  const piped = e.match(/^\(\s*(.+?)\s*\|\s*parseRepoUrl\s*\)\.(\w+)$/)
  if (piped) {
    const [rawHost, query = ''] = String(getByPath(ctx, piped[1]) ?? '').split('?')
    const q = new URLSearchParams(query)
    const parsed: Record<string, string> = {
      host: rawHost.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '').replace(/\/+$/, ''),
      owner: q.get('owner') ?? '',
      repo: (q.get('repo') ?? '').replace(/\.git$/, ''),
    }
    return parsed[piped[2]] ?? ''
  }
  const grouped = e.match(/^\(\s*(.+)\s*\)\s*\|\s*(lower|upper|dump|escape)$/)
  if (grouped) return applyFilter(grouped[2], evalExpr(grouped[1], ctx))
  const orExpr = e.match(/^(.+?)\s+or\s+(.+)$/)
  if (orExpr) {
    const lhs = evalExpr(orExpr[1], ctx)
    if (lhs !== undefined && lhs !== null && lhs !== '' && lhs !== false && lhs !== 0) return lhs
    return literalOrPath(orExpr[2].trim(), ctx)
  }
  const filt = e.match(/^(.+?)\s*\|\s*(lower|upper|dump|escape)$/)
  if (filt) return applyFilter(filt[2], getByPath(ctx, filt[1].trim()))
  if (/[|()]|\s(and|if|else|not|in)\s|[~+]/.test(e)) {
    throw new Error(`template expression ${JSON.stringify(e)} uses syntax the platform's scaffolders do not implement`)
  }
  return getByPath(ctx, e)
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0) return false
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return !(s === '' || s === 'false' || s === '0' || s === 'no')
  }
  return Boolean(v)
}

function evalCondition(cond: string, ctx: Values): boolean {
  const toks = cond.match(/\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|==|!=|\(|\)|[A-Za-z_][\w.]*|-?\d+(?:\.\d+)?|\S)/g)
    ?.map((t) => t.trim()) ?? []
  let i = 0
  const fail = (why: string): never => {
    throw new Error(`template condition ${JSON.stringify(cond.trim())}: ${why}`)
  }
  const atom = (): unknown => {
    const t = toks[i++]
    if (t === undefined) return fail('ends early')
    if (t === '(') {
      const v = orExpr()
      if (toks[i++] !== ')') fail('unbalanced parentheses')
      return v
    }
    if (/^['"]/.test(t)) return t.slice(1, -1)
    if (/^-?\d/.test(t)) return Number(t)
    if (t === 'true' || t === 'True') return true
    if (t === 'false' || t === 'False') return false
    if (t === 'none' || t === 'null' || t === 'None') return null
    if (['and', 'or', 'not', 'in', 'is', ')', '==', '!='].includes(t) || !/^[A-Za-z_]/.test(t)) {
      return fail(`unexpected ${JSON.stringify(t)}`)
    }
    return getByPath(ctx, t)
  }
  const cmp = (): unknown => {
    const left = atom()
    const op = toks[i]
    if (op === '==' || op === '!=') {
      i++
      const eq = stringify(left) === stringify(atom())
      return op === '==' ? eq : !eq
    }
    return left
  }
  const notExpr = (): boolean => {
    if (toks[i] === 'not') {
      i++
      return !notExpr()
    }
    return truthy(cmp())
  }
  const andExpr = (): boolean => {
    let v = notExpr()
    while (toks[i] === 'and') {
      i++
      const r = notExpr()
      v = v && r
    }
    return v
  }
  const orExpr = (): boolean => {
    let v = andExpr()
    while (toks[i] === 'or') {
      i++
      const r = andExpr()
      v = v || r
    }
    return v
  }
  if (toks.length === 0) fail('is empty')
  const res = orExpr()
  if (i !== toks.length) fail(`unexpected ${JSON.stringify(toks[i])}`)
  return res
}

type Tag = { kind: 'if' | 'elif' | 'else' | 'endif'; cond: string; start: number; end: number }

function resolveConditionals(s: string, ctx: Values): string {
  const tags: Tag[] = []
  const tagRe = /\{%\s*(if|elif|else|endif)\b([^%]*)%\}/g
  for (let m; (m = tagRe.exec(s));) {
    tags.push({ kind: m[1] as Tag['kind'], cond: m[2], start: m.index, end: m.index + m[0].length })
  }
  if (tags.length === 0) return s
  let k = 0
  const where = (t: Tag) => `{% ${t.kind} %} at offset ${t.start}`
  const block = (from: number, out: boolean): [string, number, Tag | undefined] => {
    let text = ''
    let pos = from
    while (k < tags.length) {
      const t = tags[k]
      if (t.kind !== 'if') {
        if (out) text += s.slice(pos, t.start)
        return [text, t.start, t]
      }
      if (out) text += s.slice(pos, t.start)
      k++
      let taken = false
      let take = out && evalCondition(t.cond, ctx)
      let next = t.end
      for (;;) {
        const [body, , closer] = block(next, take)
        if (take) {
          text += body
          taken = true
        }
        if (!closer) throw new Error(`unclosed ${where(t)}`)
        k++
        next = closer.end
        if (closer.kind === 'endif') break
        if (closer.kind === 'elif') take = out && !taken && evalCondition(closer.cond, ctx)
        else take = out && !taken
      }
      pos = next
    }
    if (out) text += s.slice(pos)
    return [text, s.length, undefined]
  }
  const [text, , stray] = block(0, true)
  if (stray) throw new Error(`${where(stray)} has no matching {% if %}`)
  return text
}

/** Template syntax neither scaffolder implements, which would get the file dropped. */
export function unsupportedSyntax(src: string): string[] {
  const found: string[] = []
  const tag = /\{%-?\s*(\w+)/g
  for (let m; (m = tag.exec(src));) {
    if (!['if', 'elif', 'else', 'endif'].includes(m[1])) found.push(`{% ${m[1]} %}`)
  }
  // `{#` opens a comment in Nunjucks/Jinja; `{{` without the `$` is an output block.
  if (src.includes('{#')) found.push('{# (a comment in Nunjucks; write the shell without it)')
  if (/(^|[^$]){{/.test(src)) found.push('{{ without $ (only ${{ … }} is substituted)')
  return found
}

export function renderContent(src: string, values: Values): string {
  const ctx: Values = { values, ...values }
  let s = src
    .replace(/[ \t]*\r?\n?[ \t]*\{%-/g, '{%')
    .replace(/\{%-/g, '{%')
    .replace(/-%\}[ \t]*\r?\n?/g, '%}')
    .replace(/-%\}/g, '%}')
  s = resolveConditionals(s, ctx)
  s = s.replace(/\$\{\{\s*([\s\S]+?)\s*\}\}/g, (_, ex: string) => stringify(evalExpr(ex, ctx)))
  if (/\$\{\{|\{%/.test(s)) throw new Error('template syntax left after rendering')
  return s
}
