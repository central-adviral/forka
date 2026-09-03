# Dashboard de Funil de Vendas (LaunchOps → ab-test-tool) — Design

## Contexto e motivação

O usuário roda operações de tráfego pago (Meta Ads → Hubla) que hoje só têm
visibilidade via consultas manuais no Supabase do projeto **LaunchOps
Blacksheep** (`vgxivkxkbsspekmkaqhw`). Ele quer um dashboard interno para
acompanhar o funil (leads → vendas → receita → ROAS/CAC) sem precisar rodar
SQL toda vez, e quer que esse painel viva dentro do **ab-test-tool**
(`/Users/vitor/projetos/ab-test-tool`) — a ferramenta de teste A/B que ele já
opera, multi-cliente, single-owner (`clients.owner_id = auth.uid()`).

**Por que dentro do ab-test-tool e não um app separado:** reaproveita auth,
modelo de cliente e infraestrutura de deploy já prontos. Cada operação do
LaunchOps (ex: `1K_LATAM`) vira um `client` do ab-test-tool, do mesmo jeito
que hoje um cliente tem testes A/B, ele passa a ter também uma aba de funil de
vendas.

**Fonte de dados real, não o espelho:** durante a investigação descobrimos
que `voe_matricula` (espelho do Sistema VOE) está com o cursor de sync
travado desde 26/08 — não é confiável para dado recente. A tabela
`public.vendas` do LaunchOps, alimentada diretamente por `plataforma='hubla'`,
está atualizada até o dia corrente e é a fonte correta para vendas. Gasto de
mídia vem de `public.meta_ads_daily` (nível conta/operação) e
`public.anuncio` + `public.anuncio_dia` (nível anúncio individual, com
`ad_id`/`ad_name`).

**Visão de produto (fora do escopo desta v1):** o usuário eventualmente quer
que clientes externos do ab-test-tool consigam plugar o próprio funil sem ter
um banco como o LaunchOps — colando só credenciais (token Hubla + token Meta
Ads), do mesmo jeito que a Hubla já é integrada por cliente hoje
(`/api/webhooks/hubla/[clientSlug]`). Esta v1 é **só para o usuário testar**,
mas o modelo de dados é desenhado para não precisar de retrabalho quando essa
ingestão direta por cliente existir — ver "Extensibilidade" abaixo.

## Escopo

- Duas tabelas novas no Supabase do ab-test-tool: `sales` (vendas) e
  `ad_spend_daily` (gasto agregado por dia). Uma terceira,
  `ad_creative_spend_daily`, guarda gasto por anúncio individual para o
  cruzamento com o relatório de teste A/B por anúncio.
- Coluna nova em `clients`: `launchops_operacao_ids uuid[]`, mapeando um
  client do ab-test-tool para uma ou mais `operacoes.id` do LaunchOps (cobre
  o caso real encontrado de `1K_LATAM` e `1K-LATAM` como duas operações quase
  duplicadas que devem ser somadas sob o mesmo client).
- Job de sincronização periódico (Vercel Cron) que lê do LaunchOps via um
  segundo cliente Supabase (service role) e faz upsert incremental nas 3
  tabelas acima, por client.
- Aba nova "Funil de Vendas" por client no dashboard: vendas/receita/gasto
  por dia, ROAS, CAC.
- `get_test_report_by_ad` (relatório de teste por anúncio, já existente)
  passa a trazer `spend`, `cpm`, `ctr` do anúncio junto com clicks/conversões
  que já mostra hoje.
- Captura de `fb_ad_id`, `fb_adset_id`, `fb_campaign_id` no clique
  (`src/app/r/[slug]/route.ts`), além dos UTMs padrão já capturados —
  necessário para casar clique com gasto por `ad_id` (mais confiável que
  `utm_term`/nome, que hoje já é usado com `{{ad.name}}`).

## Fora de escopo (v1)

- **Ingestão direta por cliente** (Alternativa 3 discutida: cliente cola
  token Hubla/Meta Ads sem precisar de um banco tipo LaunchOps). O modelo de
  dados já deixa essa porta aberta (coluna `source` nas 3 tabelas), mas
  implementar a UI de credenciais e o worker de ingestão direta fica para
  quando houver um cliente real pedindo isso.
- **Funil completo com etapas de lead** (touchpoints, `campanha_funil_etapas`
  do LaunchOps). Esta v1 cobre só vendas + gasto; leads/etapas ficam para
  iteração futura.
- **Correção retroativa do "gasto sem operação"** — durante a investigação
  achamos gasto do Meta Ads em `meta_ads_daily` com `operacao_id null`
  (crescente desde 30/08, R$245 → R$1.218/dia). Isso é resolvido pela "Fase 3"
  já mapeada dentro do próprio LaunchOps (comentário da tabela
  `campanha_meta_frente`), não faz parte deste dashboard. Efeito prático: o
  spend mostrado pode estar levemente subestimado até essa fase rodar lá.
- Multi-usuário / RBAC — mantém o modelo atual (owner único).
- Alertas automáticos de queda de vendas/CPL. Fica para depois de o dashboard
  básico estar validado em uso real.
- Backfill de `fb_ad_id` em cliques antigos — impossível (o dado nunca foi
  capturado); relatório por anúncio cai no fallback por nome para cliques
  anteriores a esta mudança.

## Extensibilidade (por que o modelo de dados é assim)

`sales` e `ad_spend_daily`/`ad_creative_spend_daily` têm uma coluna
`source text not null` (`'launchops_sync'` nesta v1). O relatório e a UI só
leem essas tabelas — nunca sabem se o dado veio de um sync do LaunchOps ou
(no futuro) de um webhook direto da Hubla / pull direto da API do Meta Ads
daquele cliente. Quando a ingestão direta existir, ela escreve nas mesmas
tabelas com outro valor de `source`; nenhuma mudança no relatório ou na tela é
necessária.

## Modelo de dados

Migration nova `NNNN_funnel_dashboard.sql` (número sequencial seguinte ao
último existente):

```sql
alter table clients add column launchops_operacao_ids uuid[];
alter table clients add column launchops_produto_nomes text[];

create table sales (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  source text not null default 'launchops_sync',
  external_id text not null,           -- vendas.id do LaunchOps (uuid as text)
  data_venda timestamptz not null,
  produto text,
  status text not null,                -- 'aprovada' | outros valores da origem, sem normalizar
  valor_bruto numeric,
  valor_liquido numeric,
  metodo_pagamento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, source, external_id)
);

create table ad_spend_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  source text not null default 'launchops_sync',
  operacao_id uuid not null,           -- uma linha por operação do LaunchOps, não agregada
  data date not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  leads bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, source, operacao_id, data)
);

create table ad_creative_spend_daily (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  source text not null default 'launchops_sync',
  data date not null,
  ad_id text,                          -- pode ser null se a origem só tiver nome
  ad_name text,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  link_clicks bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (client_id, source, data, ad_id, ad_name)
);

create index ad_creative_spend_daily_report_idx
  on ad_creative_spend_daily(client_id, ad_id, ad_name, data);

create table funnel_sync_state (
  client_id uuid not null references clients(id) on delete cascade,
  entity text not null check (entity in ('sales','ad_spend_daily','ad_creative_spend_daily')),
  cursor_updated_at timestamptz,       -- null = nunca sincronizou, lê tudo
  last_run_at timestamptz,
  last_result text,                    -- 'ok' | 'error'
  last_message text,
  primary key (client_id, entity)
);

alter table sales enable row level security;
alter table ad_spend_daily enable row level security;
alter table ad_creative_spend_daily enable row level security;
alter table funnel_sync_state enable row level security;

create policy "sales_via_client_owner" on sales
  for select using (exists (select 1 from clients c where c.id = sales.client_id and c.owner_id = auth.uid()));
create policy "ad_spend_daily_via_client_owner" on ad_spend_daily
  for select using (exists (select 1 from clients c where c.id = ad_spend_daily.client_id and c.owner_id = auth.uid()));
create policy "ad_creative_spend_daily_via_client_owner" on ad_creative_spend_daily
  for select using (exists (select 1 from clients c where c.id = ad_creative_spend_daily.client_id and c.owner_id = auth.uid()));
create policy "funnel_sync_state_via_client_owner" on funnel_sync_state
  for select using (exists (select 1 from clients c where c.id = funnel_sync_state.client_id and c.owner_id = auth.uid()));

grant select on sales, ad_spend_daily, ad_creative_spend_daily, funnel_sync_state to authenticated;
grant all on sales, ad_spend_daily, ad_creative_spend_daily, funnel_sync_state to service_role;
```

Todas as escritas (`insert`/`upsert`) são feitas pelo job de sync via service
role — por isso as policies de `authenticated` são só `select`, seguindo o
mesmo padrão de `click_events`/`conversions` já existente no schema.

## Fluxo de sincronização (job)

**Gatilho:** Vercel Cron (`vercel.json`) apontando para
`GET /api/internal/sync-funnel` (protegida por um secret de header, padrão do
próprio Vercel Cron). Frequência inicial: a cada 1h — suficiente para um
painel de acompanhamento, sem sobrecarregar nenhum dos dois bancos.

**Conexão com o LaunchOps:** um segundo cliente `@supabase/supabase-js`
(não o `service-role.ts` existente, que aponta para o banco do próprio
ab-test-tool), configurado com `LAUNCHOPS_SUPABASE_URL` e
`LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY`. **Recomendação de segurança:** não usar
a service role key completa do projeto LaunchOps aqui — criar uma role de
Postgres dedicada, só com `SELECT` nas 4 tabelas necessárias
(`vendas`, `meta_ads_daily`, `anuncio`, `anuncio_dia`), e usar essa role via
uma view ou RPC restrita. Isso fica como recomendação explícita para o
usuário decidir/configurar antes de ir para produção — não é implementado
automaticamente nesta spec, mesma lógica de "não aplicar RLS sem policy sem
perguntar" já usada nesta sessão.

**Passos, por client com `launchops_operacao_ids`/`launchops_produto_nomes`
preenchido:**

1. **Sales:** `select * from vendas where plataforma = 'hubla' and status =
   'aprovada' and produto_nome = any(:produto_nomes) and updated_at >
   :cursor`. Upsert em `sales` on `(client_id, source, external_id)`.
2. **Ad spend (conta):** `select * from meta_ads_daily where operacao_id =
   any(:operacao_ids) and updated_at > :cursor`, agregado por dia **por
   operação** (não pooling entre operações antes de gravar — ver nota
   abaixo). Upsert em `ad_spend_daily`, uma linha por `(client_id, source,
   operacao_id, data)`.
3. **Ad spend (criativo):** `select a.*, ad.spend, ad.impressions,
   ad.link_clicks from anuncio_dia ad join anuncio a on a.id = ad.anuncio_id
   where a.operacao_id = any(:operacao_ids) and ad.updated_at > :cursor`.
   Upsert em `ad_creative_spend_daily` com `ad_id = a.ad_id`,
   `ad_name = a.ad_name`.
4. Atualiza `funnel_sync_state` (cursor, `last_run_at`, `last_result`) por
   entidade — mesmo padrão de `wh_pull_estado` do LaunchOps.

**Por que `ad_spend_daily` guarda uma linha por operação em vez de um total já
somado:** um client pode ter mais de uma `operacao_id` mapeada (o caso real de
`1K_LATAM`/`1K-LATAM`). Se o sync agregasse as duas antes de gravar, um sync
incremental que só traz linhas atualizadas de uma das operações
sobrescreveria o total do dia com um valor parcial, perdendo silenciosamente
o gasto da outra. Guardando uma linha por operação, cada upsert é
independente e correto isoladamente; a soma entre operações do mesmo client
acontece na leitura (`funnel-repo.ts`, `group by data`), nunca na escrita.

**Por que `sales` filtra por produto e não por operação:** a tabela `vendas`
do LaunchOps não tem `operacao_id` — só `produto_nome`. Por isso
`clients.launchops_produto_nomes` existe separado de
`launchops_operacao_ids`: o primeiro filtra vendas, o segundo filtra gasto de
mídia. Preenchidos juntos na tela de edição do client (campo de texto livre
nesta v1, sem autocomplete).

## Relatório por anúncio com gasto (mudança em RPC existente)

`get_test_report_by_ad` ganha um join novo, sem quebrar a assinatura para
quem já chama. O gasto precisa ser **pré-agregado por anúncio numa CTE antes**
de entrar no join principal — juntar `ad_creative_spend_daily` (várias linhas
por anúncio, uma por dia) direto contra `click_events` (várias linhas por
anúncio, uma por clique) multiplicaria as duas cardinalidades e infla o
`spend` somado por clique × por dia:

```sql
with ad_spend_agg as (
  select
    client_id,
    coalesce(ad_id, ad_name) as ad_ref,
    sum(spend) as spend,
    sum(impressions) as impressions,
    sum(link_clicks) as link_clicks
  from ad_creative_spend_daily
  where client_id = (select client_id from tests where id = p_test_id)
    and (p_since is null or data >= p_since::date)
    and (p_until is null or data < p_until::date)
  group by client_id, coalesce(ad_id, ad_name)
)
select
  v.id, v.name,
  coalesce(nullif(ce.source_utms->>'fb_ad_id', ''), nullif(ce.source_utms->>'utm_term', ''), '(sem anúncio)') as ad_name,
  count(distinct ce.id) filter (where ce.is_bot = false)::bigint as clicks,
  count(distinct ce.visitor_id) filter (where ce.is_bot = false)::bigint as visitors,
  count(distinct cv.id) filter (where ce.is_bot = false)::bigint as conversions,
  coalesce(sum(cv.value_cents) filter (where ce.is_bot = false), 0)::bigint as revenue_cents,
  count(distinct ce.id) filter (where ce.is_bot = true)::bigint as bot_clicks,
  max(asa.spend) as ad_spend,
  max(asa.impressions) as ad_impressions,
  max(asa.link_clicks) as ad_link_clicks
from variants v
join tests t on t.id = v.test_id
left join click_events ce on ce.variant_id = v.id
  and (p_since is null or ce.created_at >= p_since)
  and (p_until is null or ce.created_at < p_until)
left join conversions cv on cv.click_event_id = ce.id and cv.source = t.conversion_method
left join ad_spend_agg asa
  on asa.client_id = t.client_id
  and asa.ad_ref = coalesce(ce.source_utms->>'fb_ad_id', ce.source_utms->>'utm_term')
where v.test_id = p_test_id
group by v.id, v.name, ad_name
```

`ad_spend_agg` já é **uma linha por anúncio** (soma de todos os dias da
janela) antes de entrar no join com `click_events`. Por isso o `spend` no
select final usa `max()`, não `sum()`: depois do join, cada anúncio tem o
mesmo valor de `ad_spend_agg` repetido em todas as linhas fanned-out por
clique, e `max()` sobre um valor repetido pega esse valor uma vez só — somar
de novo (`sum()`) voltaria a inflar pelo número de cliques. Isso é o ponto
que o code review pegou na primeira versão desta spec (join direto, sem
pré-agregação) e o teste de integração descrito em "Estratégia de testes"
existe justamente para travar essa regressão. A mesma correção (CTE +
`max()`) se replica em `get_test_report_by_source`.

## UI: aba "Funil de Vendas"

Nova página `src/app/dashboard/clients/[clientSlug]/funnel/page.tsx`, link no
mesmo cabeçalho onde já fica "Integrações" e "Novo teste". Reaproveita
`mini-bar-chart.tsx` (já existe para os relatórios de teste) para o gráfico
diário. Conteúdo:

- Tabela/gráfico diário: vendas, receita bruta/líquida, spend, ROAS, CAC —
  mesmo formato já validado por SQL nesta conversa.
- Indicador de saúde do sync: lê `funnel_sync_state` do client e mostra
  "última sincronização: há X min" + alerta visual se `last_result = 'error'`
  ou se `last_run_at` está a mais de 2x o intervalo do cron sem rodar —
  mesma ideia do `wh_pull_estado` do LaunchOps, exposta na UI em vez de só
  numa tabela.
- Nota fixa (mesmo padrão do aviso de domínio manual em
  client-integrations): "Spend pode estar subestimado — parte do gasto do
  Meta Ads ainda não está atribuída a esta operação na fonte."

`get_test_report_by_ad` enriquecido aparece na página de relatório de teste
já existente (`tests/[testSlug]/page.tsx`), como colunas adicionais na tabela
por anúncio — sem nova página.

## Mudanças em código existente

- `src/app/r/[slug]/route.ts`: as duas listas de UTMs capturados (linhas
  36-41 e 84-89) passam a incluir `fb_ad_id`, `fb_adset_id`,
  `fb_campaign_id`. `source_utms` já é `jsonb`, sem mudança de schema em
  `click_events`.
- `src/lib/repo/`: novo `funnel-repo.ts` com as leituras de `sales`,
  `ad_spend_daily`, `funnel_sync_state` para a nova página, seguindo o
  padrão de `conversion-repo.ts`/`redirect-repo.ts`.
- Novo `src/lib/launchops/client.ts`: segundo client Supabase apontado para
  `LAUNCHOPS_SUPABASE_URL`/`LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY`, usado só
  pela rota de sync (nunca no caminho de request do usuário).
- `get_test_report_by_ad`/`get_test_report_by_source`: nova migration
  substituindo as funções (mesmo padrão de `drop function if
  exists`/`create or replace` já usado em `0027`).

## Tratamento de erros e casos de borda

- **LaunchOps indisponível durante o sync:** o job captura o erro, grava
  `last_result = 'error'` + `last_message` em `funnel_sync_state` **sem**
  avançar o cursor, e encerra sem derrubar o cron (próxima execução tenta de
  novo a partir do mesmo ponto). A página do dashboard nunca quebra por isso
  — ela só lê o que já está sincronizado.
- **Client sem `launchops_operacao_ids`/`launchops_produto_nomes`
  configurado:** o job pula esse client silenciosamente (não é erro); a aba
  "Funil de Vendas" mostra estado vazio com instrução de configurar o
  mapeamento.
- **Duas operações quase-duplicadas (`1K_LATAM`/`1K-LATAM`):** resolvido no
  mapeamento (array de ids), soma naturalmente pelo `group by` do sync.
- **Cliques antigos sem `fb_ad_id`:** fallback para `utm_term`/`ad_name` no
  join do relatório por anúncio, como já mostrado na query acima.
- **Venda muda de status depois de sincronizada (ex: aprovada →
  reembolsada):** o filtro de leitura no LaunchOps é `status = 'aprovada'`,
  então uma venda que muda de status simplesmente para de aparecer nas
  próximas leituras incrementais — o registro em `sales` fica com o status
  antigo ("aprovada"), desatualizado. Limitação conhecida da v1, aceitável
  dado o volume baixo de reembolso observado (~1.6% do total na investigação
  desta sessão); documentado aqui para revisitar se o dado de reembolso
  passar a importar para o relatório.

## Estratégia de testes

- Unitário: função pura que decide o `ad_ref` de match (`fb_ad_id` com
  fallback para `utm_term`), testável sem banco.
- Unitário: cálculo de ROAS/CAC a partir de linhas de `sales`/`ad_spend_daily`
  (divisão por zero quando `spend = 0` ou `vendas = 0` deve retornar `null`,
  não erro).
- Integração: RLS das 4 tabelas novas — dono do client lê, outro usuário não;
  nenhuma delas aceita `insert`/`update` de `authenticated` (só service
  role).
- Integração: `get_test_report_by_ad` com dado de `ad_creative_spend_daily`
  presente e ausente (garante que o `left join` não filtra linhas sem gasto
  correspondente, nem duplica clicks/conversões). **Caso específico:** um
  anúncio com múltiplos `click_events` e múltiplos dias de spend na janela do
  relatório deve retornar `ad_spend` igual à soma real do período, não
  multiplicado pelo número de cliques — este é o teste que trava a regressão
  de fan-out encontrada na revisão desta spec.
- Integração: upsert de `ad_creative_spend_daily` com `ad_id` nulo duas vezes
  seguidas para o mesmo `(client_id, source, data, ad_name)` não deve criar
  linha duplicada (depende do `nulls not distinct` na constraint).
- Integração: sync de `ad_spend_daily` — atualizar incrementalmente só uma
  das operações mapeadas a um client não deve alterar a linha da outra
  operação daquele mesmo dia; a leitura agregada (soma das duas linhas) deve
  continuar correta antes e depois do sync parcial.
- Integração: rota de sync — cursor não avança quando a leitura do LaunchOps
  falha; upsert é idempotente (rodar duas vezes com o mesmo dado não duplica
  linha).
