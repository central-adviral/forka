# Banco de Ideias

Itens levantados durante o desenvolvimento que ficaram fora do escopo do momento —
não são bugs nem trabalho em andamento, são candidatos a próxima rodada.

## Redesign visual (mockup "Forka Redesign", 2026-09-04)

- **Score de criativos** (painel com ranking 0-100 por criativo, nas telas de
  Funil de Teste e Funil de Venda). O próprio mockup marca "critério em
  definição" — falta decidir a fórmula/pesos antes de implementar. Para Funil
  de Teste já existe dado suficiente (gasto, receita, cliques, vendas por
  anúncio via `get_test_report_by_ad`); para Funil de Venda depende da
  reconciliação anúncio↔venda da spec `launchops-sync-enrichment`.
- **Linha de mini-KPIs no topo do Hub** (Receita 30d / ROAS médio / Testes
  ativos / Melhor variante). Não precisa de infra nova, mas precisa de queries
  agregadas novas (soma de receita entre funis, ROAS médio, melhor variante
  entre testes ativos) — passou de "puro visual" pra "lógica nova".
- **Página "Sistema de design" (Studio)** do mockup — referência de paleta/
  tipografia/espaçamento. É material de dev, não fica claro que valha a pena
  como página real dentro do app em produção.
