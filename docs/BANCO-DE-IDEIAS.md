# Banco de Ideias

Itens levantados durante o desenvolvimento que ficaram fora do escopo do momento —
não são bugs nem trabalho em andamento, são candidatos a próxima rodada.

## Mais de uma conversão por clique — order bump, upsell, recorrência (2026-09-07)

Hoje um clique só pode gerar **uma** conversão: `conversions` tem
`unique (click_event_id, source)` (`0001_init.sql:49`). Se o mesmo comprador
gerar um segundo `invoice.payment_succeeded` — order bump, upsell em one-click,
ou a renovação mensal de uma assinatura — o insert bate no índice,
`conversion-repo.ts` traduz o erro `23505` para `'duplicate'` e a rota responde
`200 OK`. A venda simplesmente não aparece no relatório.

**Não é urgente: o Vitor confirmou em 07/09 que não vende order bump nem
recorrência hoje.** Vira prioridade no dia em que passar a vender.

**E dá para medir, ao contrário do que eu afirmei primeiro.** A conversão é
rejeitada, mas a **venda sobrevive** em `sales` — duas vendas apontando para o
mesmo tracking id são exatamente uma segunda compra no mesmo clique:

```sql
select count(*) filter (where vendas > 1) as cliques_com_mais_de_uma_compra,
       coalesce(sum(vendas - 1) filter (where vendas > 1), 0) as compras_perdidas
from (
  select utm_content, count(*) as vendas
  from sales
  where utm_content ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
  group by 1
) t;
```

Rodado em produção em 07/09: **0 de 212** cliques com venda tinham mais de uma.
Rodar isso de novo é o jeito de saber se o modelo de negócio mudou sem ninguém
ter avisado.

**Como consertar quando for a hora**: trocar a unicidade para
`(source, external_event_id)` — o id da fatura, único por natureza — e deixar
`click_event_id` como FK repetível. Para `thank_you_page`, que não tem id
externo, gerar um determinístico (`tracking_id` + dia).

Veio da auditoria externa de 07/09 (artifact 945cb013, item F2). A auditoria
afirmava que "upsell e recorrência caem": a restrição é fato verificado, mas a
perda é previsão, não medição. Mitigado em parte no mesmo dia — a rejeição
agora é logada como `[conversion-duplicate-rejected]` em vez de sumir, então se
começar a acontecer aparece nos logs em vez de ser descoberto meses depois.

## Superfície real de LGPD, medida (2026-09-07)

A auditoria de 07/09 reconheceu não ter citado LGPD nenhuma vez. Fui medir
antes de tratar como risco: varrendo todas as colunas do schema, o que a Forka
guarda de dado pessoal é **`click_events.ip` e `click_events.user_agent`**, e
mais nada. **Não existe coluna de e-mail, nome de comprador, CPF, telefone ou
endereço** — a conversão guarda id de transação e valor, nunca a identidade de
quem comprou; o payload da Hubla traz PII mas ela não é persistida.

Ou seja, a superfície existe mas é bem menor do que "operadora de dado pessoal"
sugere. O IP tem finalidade legítima (rate limit de 30/IP/hora em `/r/[slug]`);
a questão em aberto é **retenção** — por quanto tempo ele fica depois de
cumprida essa finalidade. Decisão de produto/jurídico, não técnica: definir um
prazo e apagar o IP depois dele é trabalho de uma tarde quando houver decisão.

## Coletor `/e` — é mudança de produto, não item técnico (2026-09-07)

A arquitetura-alvo da auditoria propõe um coletor de eventos de meio de funil
(`page_view`, `view_content`, `initiate_checkout`, `lead`) para calcular taxa de
checkout iniciado por criativo — a métrica que permite decidir antes de haver
venda suficiente para significância. O ganho é real.

Mas ele exige **instalar um script na página do cliente**, o que reverte uma
decisão de produto explícita: o modo de teste de checkout foi desenhado
"sem JS/snippet na página do cliente", usando `/r` e `/c`. Isso é parte do que
torna o onboarding da Forka mais leve que o do concorrente. O custo não é a
implementação — é fricção de instalação, superfície de suporte ("o script
quebrou meu checkout") e consentimento. Decisão do Vitor, não consequência
técnica.

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
