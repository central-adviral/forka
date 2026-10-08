import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

// The Central speaks one vocabulary (funil, meta, teste, link A/B) and every page title matches its
// menu label. The old words keep creeping back in copy-pasted strings, so this scans the text a user
// can see -- string literals, template text and JSX text, never comments or identifiers -- and fails
// on any of them. "card" is not guarded: it is also a component and class name, too noisy to ban.
const BANNED: RegExp[] = [
  /\bprojetos?\b/i,
  /\balvos?\b/i,
  /\bhipóteses?\b/i,
  /\bexperimentos?\b/i,
  /Regras do jogo/i,
  /Regras de campanha/i,
  /Regras de destino/i,
  /Painel de Controle/i,
  /Funil de tráfego/i,
  /Fila de atenção/i,
  /A\/B de link/i,
  /Saúde das páginas/i,
]

const ROOTS = ['src/app', 'src/components', 'src/lib']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function visibleText(text: string): string {
  // A lone lowercase token is a key, a slug or an enum value, not copy; paths and query params are routes.
  if (/^[a-z0-9_-]+$/.test(text)) return ''
  return text.replace(/[?&][\w-]+=/g, ' ').replace(/\/[a-z][\w-]*/g, ' ')
}

function bannedTerms(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const hits: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      const text = visibleText(node.text)
      for (const pattern of BANNED) {
        const match = text.match(pattern)
        if (match) {
          const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
          hits.push(`${fileName}:${line} "${match[0]}"`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

describe('vocabulary guard', () => {
  it('flags old terms in visible text but not in comments, identifiers or routes', () => {
    const source = [
      '// the projeto comment is fine',
      "const projectId = 'projeto'",
      'const href = `${base}/backlog?projeto=${slug}`',
      "const title = 'Novo projeto'",
      'const el = <p>Acima do alvo</p>',
    ].join('\n')
    expect(bannedTerms('sample.tsx', source)).toEqual(['sample.tsx:4 "projeto"', 'sample.tsx:5 "alvo"'])
  })

  it('finds no old term in the screens', () => {
    const hits = ROOTS.flatMap(sourceFiles).flatMap((path) => bannedTerms(path, readFileSync(path, 'utf8')))
    expect(hits).toEqual([])
  })
})
