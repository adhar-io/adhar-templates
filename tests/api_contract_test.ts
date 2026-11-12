/**
 * Every template that serves HTTP publishes its contract: `api/openapi.yaml`
 * in the skeleton, registered from `catalog-info.yaml` as a `kind: API`
 * entity the Component `providesApis`. The Console reads that entity after a
 * scaffold and registers the file under Design → API & Spec, so a template
 * without it creates an API nobody can find there.
 *
 * Whether a template serves HTTP is read from its skeleton, not from a list
 * kept here: a Component of type `function`, or of type `service` with a
 * `deploy/base/httproute.yaml` (a public host). A `website` (the SPAs) is a
 * page, not an API; a batch service has no route.
 */
import { assert, assertEquals, assertMatch } from '@std/assert'
import { parse as parseYaml, parseAll as parseYamlAll } from '@std/yaml'
import { renderContent, unsupportedSyntax } from './lib/render.ts'
import { exists, read, type Template, templates, valueKeys, valuesFor, type Variant } from './lib/templates.ts'

const ALL = templates()
const VARIANTS: Variant[] = ['defaults', 'all-on', 'all-off']
const CONTRACT = 'api/openapi.yaml'

// deno-lint-ignore no-explicit-any
type Doc = Record<string, any>

/**
 * A description a form will see sooner or later. A bare `${{ values.description }}`
 * in catalog-info.yaml gives a YAML mapping where the colon is, and a quoted
 * one ends at the first `"`: the Console then cannot read the file, so it
 * registers no API for the new application. `| dump` is what survives it.
 */
const HOSTILE_DESCRIPTION = 'A service with a "quoted" word: and a colon'

function catalog(t: Template, variant: Variant, description?: string): Doc[] {
  const values = valuesFor(t, variant)
  if (description !== undefined) values.description = description
  let docs: Doc[]
  try {
    docs = parseYamlAll(renderContent(read(`${t.skeleton}/catalog-info.yaml`), values)) as Doc[]
  } catch (e) {
    throw new Error(
      `${t.id} (${variant}): catalog-info.yaml is not valid YAML with the description ${JSON.stringify(values.description)} — ${(e as Error).message}`,
    )
  }
  return docs.filter((d) => d && typeof d === 'object')
}

function component(t: Template, docs: Doc[]): Doc {
  const c = docs.find((d) => d.kind === 'Component')
  assert(c, `${t.id}: catalog-info.yaml has no Component`)
  return c
}

/** A function, or a service with a public route. */
function servesHttp(t: Template, comp: Doc): boolean {
  const type = comp.spec?.type
  return type === 'function' || (type === 'service' && exists(`${t.skeleton}/deploy/base/httproute.yaml`))
}

const HTTP = ALL.filter((t) => servesHttp(t, component(t, catalog(t, 'defaults'))))

Deno.test('the templates that serve HTTP are recognised from their skeletons', () => {
  // The rule above, checked against what is known to be here: a template
  // that quietly stops matching it would otherwise be exempt without a word.
  const want = [
    'agent-service',
    'function-deno-service',
    'function-go-service',
    'function-java-service',
    'function-nodejs-service',
    'function-python-service',
    'go-web-service',
    'nodejs-web-service',
    'python-web-service',
    'quarkus-web-service',
    'springboot-gateway-service',
    'springboot-hexagon-service',
    'springboot-web-service',
    'tanstack-start-fullstack-app',
  ]
  const got = HTTP.map((t) => t.id)
  assertEquals(want.filter((id) => !got.includes(id)), [], 'no longer recognised as serving HTTP')
})

Deno.test('every template that serves HTTP ships its contract', () => {
  const missing = HTTP.filter((t) => !exists(`${t.skeleton}/${CONTRACT}`)).map((t) => `${t.id}/skeleton/${CONTRACT}`)
  assertEquals(missing, [], 'write the paths the skeleton serves (copy the closest template) and publish it from catalog-info.yaml')
})

for (const t of HTTP) {
  Deno.test(`${t.id}: catalog-info.yaml publishes ${CONTRACT} as the API the Component provides, rendered every way`, () => {
    for (const v of VARIANTS) {
      const values = valuesFor(t, v)
      const docs = catalog(t, v, HOSTILE_DESCRIPTION)
      const comp = component(t, docs)
      const apiName = `${values.name}-api`
      const provides = Array.isArray(comp.spec?.providesApis) ? comp.spec.providesApis : []
      assert(provides.includes(apiName), `${t.id} (${v}): the Component's spec.providesApis does not list ${apiName}`)
      const api = docs.find((d) => d.kind === 'API' && d.metadata?.name === apiName)
      assert(api, `${t.id} (${v}): no \`kind: API\` document named ${apiName}`)
      assertEquals(api.apiVersion, 'backstage.io/v1alpha1', `${t.id} (${v}): the API entity's apiVersion`)
      assertEquals(api.spec?.type, 'openapi', `${t.id} (${v}): the API entity's spec.type`)
      assertEquals(api.spec?.definition?.$text, `./${CONTRACT}`, `${t.id} (${v}): spec.definition.$text must name the file in the skeleton`)
      assert(api.metadata?.description, `${t.id} (${v}): the API entity has no description`)
      assertEquals(api.spec?.lifecycle, comp.spec?.lifecycle, `${t.id} (${v}): the API's lifecycle differs from the Component's`)
      assertEquals(api.spec?.owner, comp.spec?.owner, `${t.id} (${v}): the API's owner differs from the Component's`)
    }
  })

  Deno.test(`${t.id}: ${CONTRACT} renders to an OpenAPI 3 document for the application, every way`, () => {
    const file = `${t.skeleton}/${CONTRACT}`
    if (!exists(file)) return // reported by the test above
    const src = read(file)
    assertEquals(unsupportedSyntax(src), [], `${t.id}/skeleton/${CONTRACT}: syntax the scaffolders drop the file for`)
    for (const m of src.matchAll(/values\.(\w+)/g)) {
      assert(valueKeys(t).has(m[1]), `${t.id}/skeleton/${CONTRACT}: values.${m[1]} is not in template.yaml's fetch:template values`)
    }
    for (const v of VARIANTS) {
      const values = valuesFor(t, v)
      const spec = parseYaml(renderContent(src, values)) as Doc
      assertMatch(String(spec.openapi), /^3\.\d/, `${t.id} (${v}): not an OpenAPI 3 document`)
      assertEquals(spec.info?.title, values.name, `${t.id} (${v}): info.title is not the application's name`)
      assert(spec.info?.version, `${t.id} (${v}): info.version`)
      assert(spec.info?.description, `${t.id} (${v}): info.description (the form's description, with a fallback)`)
      assertEquals(spec.servers?.[0]?.url, `https://${values.hostname}`, `${t.id} (${v}): servers[0].url is not the application's host`)
      const paths = Object.entries((spec.paths ?? {}) as Record<string, Doc>)
      assert(paths.length > 0, `${t.id} (${v}): no paths — a contract with nothing in it`)
      for (const [path, item] of paths) {
        assert(path.startsWith('/'), `${t.id} (${v}): path ${JSON.stringify(path)} must start with /`)
        const templ = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])
        for (const [method, op] of Object.entries(item)) {
          if (!['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'].includes(method)) continue
          const label = `${t.id} (${v}): ${method.toUpperCase()} ${path}`
          assert(op && typeof op === 'object', `${label}: not an operation`)
          assert(Object.keys((op as Doc).responses ?? {}).length > 0, `${label}: no responses`)
          const declared = [...(item.parameters ?? []), ...((op as Doc).parameters ?? [])]
            .filter((p: Doc) => p?.in === 'path')
            .map((p: Doc) => p.name)
          for (const name of templ) assert(declared.includes(name), `${label}: path parameter {${name}} is not declared`)
        }
      }
    }
  })
}
