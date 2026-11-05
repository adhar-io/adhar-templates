/**
 * The editor extension and IDE plugin ids the templates install exist where
 * they are installed from:
 *
 *   - VS Code extensions on the VS Code Marketplace (VS Code, Dev Containers)
 *     AND on Open VSX (code-server, VSCodium), which carry different catalogues;
 *   - IntelliJ plugins on the JetBrains Marketplace.
 *
 * Needs the network, so it runs only when asked:  cd tests && deno task test:net
 * Run it whenever editor-ids.json changes, and record what it printed there.
 */
import { assertEquals } from '@std/assert'
import { ROOT } from './lib/templates.ts'

const NET = Deno.env.get('ADHAR_NET_TESTS') === '1'
const IDS = JSON.parse(Deno.readTextFileSync(`${ROOT}/tests/editor-ids.json`)) as {
  vscode: Record<string, unknown>
  vscodeUnwanted: Record<string, unknown>
  jetbrains: Record<string, unknown>
}

async function marketplace(id: string): Promise<string | undefined> {
  const r = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json;api-version=3.0-preview.1' },
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: id }], pageSize: 1 }], flags: 0x1 | 0x2 }),
  })
  const d = await r.json()
  const e = d?.results?.[0]?.extensions?.[0]
  if (!e || `${e.publisher?.publisherName}.${e.extensionName}`.toLowerCase() !== id.toLowerCase()) return undefined
  return e.versions?.[0]?.version
}

async function openVsx(id: string): Promise<string | undefined> {
  const dot = id.indexOf('.')
  const r = await fetch(`https://open-vsx.org/api/${id.slice(0, dot)}/${id.slice(dot + 1)}`)
  if (!r.ok) {
    await r.body?.cancel()
    return undefined
  }
  const d = await r.json()
  return d?.error ? undefined : d?.version
}

async function jetbrains(id: string): Promise<string | undefined> {
  const r = await fetch(`https://plugins.jetbrains.com/api/plugins/intellij/${encodeURIComponent(id)}`)
  if (!r.ok) {
    await r.body?.cancel()
    return undefined
  }
  return (await r.json())?.name
}

Deno.test({
  name: 'every VS Code extension is on the VS Code Marketplace and on Open VSX',
  ignore: !NET,
  sanitizeResources: false,
  async fn() {
    const missing: string[] = []
    for (const id of Object.keys(IDS.vscode)) {
      const [m, o] = await Promise.all([marketplace(id), openVsx(id)])
      console.log(`${id.padEnd(46)} marketplace=${m ?? 'MISSING'} open-vsx=${o ?? 'MISSING'}`)
      if (!m) missing.push(`${id}: not on the VS Code Marketplace`)
      if (!o) missing.push(`${id}: not on Open VSX (code-server cannot install it)`)
    }
    assertEquals(missing, [])
  },
})

Deno.test({
  name: 'every unwanted VS Code extension is a real Marketplace extension',
  ignore: !NET,
  sanitizeResources: false,
  async fn() {
    const missing: string[] = []
    for (const id of Object.keys(IDS.vscodeUnwanted)) if (!(await marketplace(id))) missing.push(id)
    assertEquals(missing, [])
  },
})

Deno.test({
  name: 'every IntelliJ plugin is on the JetBrains Marketplace',
  ignore: !NET,
  sanitizeResources: false,
  async fn() {
    const missing: string[] = []
    for (const id of Object.keys(IDS.jetbrains)) {
      const name = await jetbrains(id)
      console.log(`${id.padEnd(40)} ${name ?? 'MISSING'}`)
      if (!name) missing.push(id)
    }
    assertEquals(missing, [])
  },
})
