# AB Test Tool — Visual Design

Complementa [2026-08-25-ab-test-tool-design.md](2026-08-25-ab-test-tool-design.md). Aquele
documento define arquitetura e dados; este define a aparência do dashboard e, em particular,
substitui a seção "Dashboard" original (relatório em tabela) pelo conceito de canvas de nós
descrito abaixo.

## Contexto

Ferramenta interna (sem marca pública por enquanto), mas com investimento deliberado em
identidade visual. Referência trazida pelo usuário: um mapeador de funil estilo
Voluum/Funnelytics — canvas escuro, cards com métricas embutidas, linhas coloridas
conectando nós conforme o fluxo de tráfego e conversão.

## Tokens de design

**Cor** (dark, tema único em todo o dashboard — login, listas, formulários e canvas):

| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#0B0E1A` | Fundo base |
| `--surface` | `#141829` | Cards, sidebar, nós |
| `--surface-2` | `#1B2036` | Inputs, chips aninhados |
| `--border` | `rgba(255,255,255,0.08)` | Bordas |
| `--text` | `#E8EAF2` | Texto primário |
| `--text-dim` | `#8A90A6` | Texto secundário/labels |
| `--violet` | `#7C6FF0` | Accent estrutural (headers, botões primários) |
| `--blue` | `#4F8EF7` | Linha de tráfego (fluxo neutro) |
| `--teal` | `#2DD4A8` | Conversão/sucesso |
| `--amber` | `#F5B94D` | Destaque de variante líder (distinto do teal — "está ganhando" ≠ "converteu") |
| `--rose` | `#F76C6C` | Pausado / fallback / voltar |

**Tipografia** (Google Fonts):
- **Space Grotesk** (500/600/700) — display: nomes de teste, títulos, números grandes.
- **Inter** (400/500/600) — corpo/UI: labels, formulários, navegação.
- **JetBrains Mono** (400/500) — utilitária: porcentagens, valores, URLs, tracking IDs,
  timestamps. Uso deliberado: monoespaçado sinaliza "medição precisa" e diferencia dado de
  texto humano.

## Telas

Rascunho publicado como canvas de design:
https://claude.ai/code/artifact/8b156469-0fe3-42ed-9d18-f80b7604b485
(arquivos-fonte em `design/Login.dc.html`, `design/Main.dc.html`, `design/Report.dc.html`,
`design/canvas.json`).

### Login

Cartão centralizado (400px) sobre fundo com grid de pontos sutil e glow radial violeta atrás
do cartão. Campos de e-mail/senha, botão primário violeta. Sem cadastro público (fora de
escopo — usuário é criado manualmente).

### Dashboard (lista de clientes/testes)

Sidebar fixa (248px) com lista de clientes (avatar com iniciais + nome, cliente ativo
destacado com fundo violeta translúcido) e rodapé com usuário logado. Área principal: lista
de testes em cards empilhados, cada um mostrando nome, slug (mono), pill de status
(Ativo=teal / Pausado=rose), indicador de variante líder, acessos totais e taxa de conversão
geral.

### Relatório do teste — canvas de nós

Substitui a tabela simples do spec técnico original. Layout em três colunas conectadas por
linhas SVG (bezier), lidas da esquerda pra direita:

1. **Nó de entrada** — link de redirecionamento (`ir.dominio.com/slug`) e total de acessos.
2. **Nós de variante** (um por variante, empilhados verticalmente) — nome, peso-alvo %,
   acessos, conversões, URL de destino (truncada, mono).
3. **Nós de conversão** (um por variante, alinhado horizontalmente ao nó da variante
   correspondente) — taxa de conversão em destaque (mono, grande) e contagem de vendas/leads.

**Lógica de cor das linhas** (confirmada com o usuário, espelhando a referência):
- Entrada → variante: azul (`--blue`), espessura proporcional ao volume de acessos da
  variante.
- Variante → conversão: teal (`--teal`) normalmente; **âmbar (`--amber`)** na variante líder
  (maior taxa de conversão) — o card da variante líder também recebe glow/borda âmbar e badge
  "Líder". Esse é o elemento de assinatura da tela: responde visualmente à pergunta que a
  ferramenta existe para responder ("qual variante está ganhando?").
- Entrada → fallback (quando configurado): rosa (`--rose`), linha tracejada — usada só
  quando o teste tem `fallback_url`, refletindo o caso de borda do spec técnico.

**Barra superior**: nome do teste, slug, pill de status, três estatísticas agregadas
(acessos / conversões / taxa geral) e ação "Pausar teste".

## Nota de implementação

O canvas do relatório **não precisa de uma lib de node-graph** (React Flow, etc.) — o número
de variantes é pequeno (2–6, conforme spec técnico) e o layout é determinístico, não
arrastável. Implementar como uma função que calcula posições (entrada fixa à esquerda; N
variantes distribuídas verticalmente; N nós de conversão alinhados) e renderiza:
- Os nós como `div`s posicionados absolutamente dentro de um container `position: relative`.
- As linhas como um único `<svg>` absoluto atrás dos nós, com paths bezier calculados a
  partir das mesmas coordenadas dos nós (evita duplicar lógica de layout).

Essa abordagem mantém o componente simples e testável (função pura de posições → coordenadas
SVG), sem dependência nova.

## Fora de escopo (mantido do spec técnico)

Sem alterações ao modelo de dados, fluxos de redirecionamento/conversão ou aos itens fora de
escopo já listados em
[2026-08-25-ab-test-tool-design.md](2026-08-25-ab-test-tool-design.md#escopo). Este documento
cobre apenas a camada visual.
