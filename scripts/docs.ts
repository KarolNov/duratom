/**
 * Builds the docs from their sources, or checks that the committed docs are up to date.
 *
 *   node scripts/docs.ts          writes every generated file
 *   node scripts/docs.ts --check  fails when a generated file differs from what is committed
 *
 * What it generates:
 * - The code blocks between `<!-- snippet: path -->` and `<!-- /snippet -->` in the Markdown docs,
 *   copied from snippet files that `pnpm docs:typecheck` compiles against the source.
 * - `docs/api.md`, the API reference, from the TSDoc of every export of the three entry points.
 * - `llms.txt` (an index) and `llms-full.txt` (every doc in one file).
 * - `docs/tsdoc-examples/`, one module per TSDoc `@example`, so `pnpm docs:typecheck` compiles those
 *   too. Ignored by git; written in both modes.
 *
 * It also fails when an exported value has no TSDoc `@example`, an exported type has no TSDoc, or
 * a Markdown doc has a TypeScript code block outside a snippet marker, since only snippets are
 * compiled.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const problems: string[] = []
const repo = 'https://github.com/KarolNov/duratom/blob/main'
/** The deployed docs site (pnpm site:deploy). */
const site = 'https://duratom-docs.karolnovljakovic.workers.dev'

/** The Markdown docs, in the order `llms-full.txt` joins them. */
const recipes = ['docs/recipes/sync.md', 'docs/recipes/offline.md', 'docs/recipes/repair.md']
const markdown = ['README.md', ...recipes, 'skills/duratom/SKILL.md']

const entryPoints = [
  { name: 'duratom', file: 'src/index.ts' },
  { name: 'duratom/react', file: 'src/react/index.ts' },
  { name: 'duratom/core', file: 'src/core/index.ts' },
]

const read = (path: string) => readFileSync(join(root, path), 'utf8')

/** Writes `content` to `path`, or in check mode records a problem when it differs. */
function emit(path: string, content: string) {
  const full = join(root, path)
  const current = existsSync(full) ? readFileSync(full, 'utf8') : undefined
  if (current === content) return
  if (check) problems.push(`${path} is out of date: run pnpm docs`)
  else {
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

// ---------------------------------------------------------------------------------------------
// Snippets

const snippetBlock = /<!-- snippet: (\S+) -->\n[\s\S]*?<!-- \/snippet -->/g

/** `text` with every snippet block filled from its file. */
function fillSnippets(path: string, text: string): string {
  return text.replace(snippetBlock, (_, file: string) => {
    if (!existsSync(join(root, file))) {
      problems.push(`${path}: snippet ${file} does not exist`)
      return `<!-- snippet: ${file} -->\n<!-- /snippet -->`
    }
    const lang = file.endsWith('.tsx') ? 'tsx' : 'ts'
    return `<!-- snippet: ${file} -->\n\n\`\`\`${lang}\n${read(file).trimEnd()}\n\`\`\`\n\n<!-- /snippet -->`
  })
}

/** Records a problem for each TypeScript code block outside a snippet, which nothing compiles. */
function checkUncompiled(path: string, text: string) {
  const outside = text.replace(snippetBlock, '')
  for (const match of outside.matchAll(/^```(ts|tsx|typescript|js|jsx)\s*$/gm)) {
    const line = outside.slice(0, match.index).split('\n').length
    problems.push(
      `${path}: a ${match[1]} code block outside a snippet marker, near line ${line}; move it into docs/snippets/`,
    )
  }
}

const docs = new Map<string, string>()
for (const path of markdown) {
  const filled = fillSnippets(path, read(path))
  checkUncompiled(path, filled)
  docs.set(path, filled)
  emit(path, filled)
}

// ---------------------------------------------------------------------------------------------
// API reference

const program = ts.createProgram(
  entryPoints.map((e) => join(root, e.file)),
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
)
const checker = program.getTypeChecker()

interface Entry {
  name: string
  kind: 'value' | 'type'
  signature: string
  doc: string
  examples: string[]
  members: { name: string; signature: string; doc: string; examples: string[] }[]
}

/** The declaration's source text without its body, its leading comments and `export`. */
function header(node: ts.Node): string {
  const source = node.getSourceFile()
  const body =
    ts.isFunctionLike(node) && 'body' in node && node.body ? (node.body as ts.Node) : undefined
  const end = body ? body.getStart(source) : node.getEnd()
  const text = source.text.slice(node.getStart(source), end).trim()
  return text
    .replace(/^export\s+(declare\s+)?/, '')
    .replace(/[;{]\s*$/, '')
    .trim()
}

/** The prose of a TSDoc comment, and the code of its `@example` tags. */
function tsdoc(symbol: ts.Symbol, declaration?: ts.Declaration) {
  const signature =
    declaration && ts.isFunctionLike(declaration)
      ? checker.getSignatureFromDeclaration(declaration as ts.SignatureDeclaration)
      : undefined
  const parts = signature
    ? signature.getDocumentationComment(checker)
    : symbol.getDocumentationComment(checker)
  const tags = signature ? signature.getJsDocTags() : symbol.getJsDocTags(checker)
  const examples = tags
    .filter((t) => t.name === 'example')
    .map((t) => ts.displayPartsToString(t.text).replace(/^\n+|\n+$/g, ''))
  return { doc: ts.displayPartsToString(parts).trim(), examples }
}

/** The declarations to show for a symbol: the overloads of a function, or its one declaration. */
function shown(symbol: ts.Symbol): ts.Declaration[] {
  const all = symbol.declarations ?? []
  const overloads = all.filter((d) => ts.isFunctionLike(d) && !('body' in d && d.body))
  return overloads.length > 0 ? overloads : all.slice(0, 1)
}

function isValue(declaration: ts.Declaration) {
  return !(
    ts.isInterfaceDeclaration(declaration) ||
    ts.isTypeAliasDeclaration(declaration) ||
    ts.isTypeParameterDeclaration(declaration)
  )
}

function signatureOf(symbol: ts.Symbol, declaration: ts.Declaration): string {
  if (ts.isVariableDeclaration(declaration)) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
    const text = checker.typeToString(
      type,
      declaration,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.MultilineObjectLiterals,
    )
    // The compiler prints an object type on one line; break it into one member per line.
    const pretty = text.startsWith('{')
      ? text
          .replace(/^\{\s*/, '{\n  ')
          .replace(/;\s*(?=\S)/g, ';\n  ')
          .replace(/;\s*\}$/, ';\n}')
      : text
    return `const ${symbol.name}: ${pretty}`
  }
  if (ts.isClassDeclaration(declaration)) {
    // The base classes are internal, so the heritage clause would name a type the reader can't find.
    const params = declaration.typeParameters
      ? `<${declaration.typeParameters.map((p) => p.getText()).join(', ')}>`
      : ''
    return `class ${symbol.name}${params}`
  }
  return header(declaration)
}

/** The public methods and properties of a class, inherited ones included. */
function membersOf(symbol: ts.Symbol): Entry['members'] {
  const type = checker.getDeclaredTypeOfSymbol(symbol)
  const out: Entry['members'] = []
  const own = symbol.declarations?.find(ts.isClassDeclaration)
  /** An inherited member's text with the base class's type parameters replaced by their arguments. */
  const substitute = (text: string, member: ts.Declaration) => {
    const base = ts.findAncestor(member.parent, ts.isClassDeclaration)
    if (!own || !base || base === own) return text
    const args = own.heritageClauses?.[0]?.types[0]?.typeArguments ?? []
    let out = text
    base.typeParameters?.forEach((param, n) => {
      const arg = args[n]
      if (arg) out = out.replace(new RegExp(`\\b${param.name.text}\\b`, 'g'), arg.getText())
    })
    return out
  }
  const constructor = symbol.members?.get('__constructor' as ts.__String)
  for (const declaration of constructor?.declarations ?? []) {
    const { doc, examples } = tsdoc(constructor!, declaration)
    out.push({ name: 'constructor', signature: header(declaration), doc, examples })
  }
  for (const member of checker.getPropertiesOfType(type)) {
    const declarations = shown(member)
    const first = declarations[0]
    if (!first) continue
    const flags = ts.getCombinedModifierFlags(first)
    if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue
    if (member.name.startsWith('#')) continue
    for (const declaration of declarations) {
      const { doc, examples } = tsdoc(member, declaration)
      out.push({
        name: member.name,
        signature: substitute(header(declaration), declaration),
        doc,
        examples,
      })
    }
  }
  return out
}

function entriesOf(file: string): Entry[] {
  const source = program.getSourceFile(join(root, file))!
  const module = checker.getSymbolAtLocation(source)!
  return checker.getExportsOfModule(module).map((exported) => {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const declarations = shown(symbol)
    const value = declarations.some(isValue)
    const signatures = declarations.map((d) => signatureOf(symbol, d))
    const docs = declarations.map((d) => tsdoc(symbol, d))
    const doc = [...new Set(docs.map((d) => d.doc).filter(Boolean))].join('\n\n')
    const examples = docs.flatMap((d) => d.examples)
    const isClass = declarations.some(ts.isClassDeclaration)
    return {
      name: exported.name,
      kind: value ? 'value' : 'type',
      signature: signatures.join('\n'),
      doc,
      examples,
      members: isClass ? membersOf(symbol) : [],
    } satisfies Entry
  })
}

const fence = (code: string) => `\`\`\`ts\n${code}\n\`\`\``

function renderEntry(entry: Entry, level: string): string {
  const out = [`${level} \`${entry.name}\``, '', fence(entry.signature), '']
  if (entry.doc) out.push(entry.doc, '')
  for (const example of entry.examples) out.push(fence(example), '')
  for (const member of entry.members) {
    out.push(`- \`${oneLine(member.signature)}\``)
    if (member.doc) out.push('', indent(member.doc), '')
    for (const example of member.examples) out.push('', indent(fence(example)), '')
  }
  if (entry.members.length > 0) out.push('')
  return out.join('\n')
}

/** A signature on one line, for a list item. */
const oneLine = (text: string) =>
  text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/,?\s+\)/g, ')')

const indent = (text: string) =>
  text
    .split('\n')
    .map((line) => (line ? `  ${line}` : line))
    .join('\n')

const documented = new Map<string, string>()
const api: string[] = [
  '# API reference',
  '',
  '<!-- Generated by scripts/docs.ts from the TSDoc in src/. Edit the TSDoc, then run pnpm docs. -->',
  '',
  'duratom has three entry points. `duratom` is the one most apps need; `duratom/react` adds a hook, and `duratom/core` has the pieces that work without Jotai.',
  '',
]
const allExamples: { name: string; code: string }[] = []

for (const { name, file } of entryPoints) {
  const entries = entriesOf(file)
  const fresh = entries.filter((e) => !documented.has(e.name))
  const shared = entries.filter((e) => documented.has(e.name))
  api.push(`## \`${name}\``, '')
  if (shared.length > 0) {
    const list = shared.map((e) => `\`${e.name}\``).join(', ')
    api.push(`Also exports ${list}, documented under \`${documented.get(shared[0]!.name)}\`.`, '')
  }
  for (const kind of ['value', 'type'] as const) {
    const group = fresh.filter((e) => e.kind === kind)
    if (group.length === 0) continue
    api.push(`### ${kind === 'value' ? 'Functions and values' : 'Types'}`, '')
    for (const entry of group) api.push(renderEntry(entry, '####'))
  }
  for (const entry of fresh) {
    if (!entry.doc) problems.push(`${name}: export ${entry.name} has no TSDoc`)
    if (entry.kind === 'value' && entry.examples.length === 0)
      problems.push(`${name}: export ${entry.name} has no TSDoc @example`)
    documented.set(entry.name, name)
    entry.examples.forEach((code, n) => allExamples.push({ name: `${entry.name}-${n}`, code }))
    for (const member of entry.members)
      member.examples.forEach((code, n) =>
        allExamples.push({ name: `${entry.name}.${member.name}-${n}`, code }),
      )
  }
}

const apiText = `${api.join('\n').trimEnd()}\n`
emit('docs/api.md', apiText)

// ---------------------------------------------------------------------------------------------
// TSDoc examples, compiled by docs/tsconfig.json

/**
 * Names the TSDoc examples use without declaring, so each example can stay a few lines long.
 * Every example is its own module, so unused imports cost nothing.
 */
const prelude = `// Generated by scripts/docs.ts from a TSDoc @example. Do not edit.
import { array, at, collection, deepEqual, docAtom, isMap, liveAtom, Locator, map, MapPath, ArrayPath, record, select, shallowEqual, typedAtom } from 'duratom'
import { AsyncValidationUnsupportedError, create, live, observeLocated, read, reader, UnsupportedValueError, write } from 'duratom/core'
import { useLiveAtom } from 'duratom/react'
import { atom, createStore } from 'jotai'
import * as Y from 'yjs'
import { z } from 'zod'
`

/** Names an example may use without declaring, declared for it unless it declares them itself. */
const ambient: Record<string, string> = {
  store: 'ReturnType<typeof createStore>',
  doc: 'Y.Doc',
  id: 'string',
}

const declares = (code: string, name: string) =>
  new RegExp(`\\b(?:const|let|var)\\s+(?:\\{[^}]*\\b${name}\\b[^}]*\\}|${name}\\b)`).test(code)

const examplesDir = join(root, 'docs/tsdoc-examples')
rmSync(examplesDir, { recursive: true, force: true })
mkdirSync(examplesDir, { recursive: true })
for (const { name, code } of allExamples) {
  const file = `${name.replace(/[^\w.-]/g, '_')}.tsx`
  const declarations = Object.entries(ambient)
    .filter(([name]) => !declares(code, name))
    .map(([name, type]) => `declare const ${name}: ${type}\n`)
    .join('')
  writeFileSync(join(examplesDir, file), `${prelude}${declarations}\n${code}\n\nexport {}\n`)
}

// ---------------------------------------------------------------------------------------------
// llms.txt and llms-full.txt

const titleOf = (text: string) => /^# (.+)$/m.exec(text)?.[1] ?? ''
const summaryOf = (text: string) =>
  text
    .replace(/^# .+\n+/, '')
    .split(/\n\n/)
    .find((p) => p.trim() && !p.startsWith('<!--') && !p.startsWith('#'))
    ?.replace(/\s*\n\s*/g, ' ')
    .trim() ?? ''

const readme = docs.get('README.md')!
const llms = [
  '# duratom',
  '',
  `> ${summaryOf(readme)}`,
  '',
  'Rules an app must follow: set `docAtom` once per Jotai store; setting a typed atom merges a patch into the doc as it is at write time; invalid data comes back as `{ issues }`, never as an exception; a duratom atom follows the doc only while something is subscribed to it.',
  '',
  'The npm package ships `llms-full.txt` (every doc in one file) and an agent skill at `skills/duratom/SKILL.md`.',
  '',
  '## Docs',
  '',
  `- [README](${repo}/README.md): install, quick start, the main API by example`,
  `- [API reference](${site}/api): every export of \`duratom\`, \`duratom/react\` and \`duratom/core\``,
  `- [Agent skill](${repo}/skills/duratom/SKILL.md): how to build with duratom, for coding agents`,
  '',
  '## Recipes',
  '',
  ...recipes.map((path) => {
    const text = docs.get(path)!
    return `- [${titleOf(text)}](${repo}/${path}): ${summaryOf(text)}`
  }),
  '',
  '## Optional',
  '',
  `- [Full docs in one file](${repo}/llms-full.txt)`,
  `- [Example app](${repo}/examples/todo/README.md): a two-pane shared todo list`,
  '',
].join('\n')
emit('llms.txt', llms)

/** A doc for `llms-full.txt`: headings pushed one level down, and markers dropped. */
const forFull = (path: string, text: string) =>
  [
    `<!-- ${path} -->`,
    '',
    text
      .replace(/^<!-- \/?snippet.*-->\n\n?/gm, '')
      .replace(/^<!-- Generated.*-->\n\n/m, '')
      .replace(/^(#+) /gm, '#$1 ')
      .trim(),
  ].join('\n')

const full = [
  '# duratom: full documentation',
  '',
  'Every duratom doc in one file: the README, the recipes and the API reference.',
  '',
  forFull('README.md', readme),
  '',
  ...recipes.flatMap((path) => [forFull(path, docs.get(path)!), '']),
  forFull('docs/api.md', apiText),
  '',
].join('\n')
emit('llms-full.txt', full)

// ---------------------------------------------------------------------------------------------

if (problems.length > 0) {
  for (const problem of problems) console.error(problem)
  process.exit(1)
}
console.log(check ? 'Docs are up to date.' : `Docs written (${relative(root, examplesDir)} too).`)
