# Hub de Cliente + Funis de Venda Plurais — Design

## Contexto e motivação

Hoje, dentro de um `client` (ex: "Gustavo VOE"), existem dois tipos de
funcionalidade misturados na mesma navegação:

- **Testes A/B** (`tests`) — já plural, já tem lista + "Novo teste".
- **Funil de Vendas** (LaunchOps: vendas + gasto de mídia) — hoje é **singular
  por cliente**: os campos `clients.launchops_operacao_ids` e
  `clients.launchops_produto_nomes` guardam um único mapeamento, e a página
  `/dashboard/clients/[clientSlug]/funnel` mostra um único dashboard.

O usuário quer que **Funil de Venda também seja plural**, do mesmo jeito que
teste já é — um cliente pode ter vários funis de venda (ex: "1K LATAM",
"Alunos 1K Por Dia"), cada um rastreando uma operação/produto diferente do
LaunchOps. Isso pede uma tela de entrada nova por cliente, separando os dois
tipos de funil antes de listar qualquer um dos dois.

**Estado real do banco (verificado em 2026-09-04, antes de escrever esta
spec):** nenhum client tem `launchops_operacao_ids`/`launchops_produto_nomes`
preenchido ainda, e as 4 tabelas do funil (`sales`, `ad_spend_daily`,
`ad_creative_spend_daily`, `funnel_sync_state`) estão todas vazias — a
sincronização com o LaunchOps ainda não rodou de verdade (variáveis de
ambiente pendentes). **Isso significa que não existe nenhum dado real para
migrar ou re-mapear** — a mudança de modelo de dado é só criar a estrutura
nova, sem backfill.

## Escopo

1. Nova tela "hub" por cliente, com dois cartões ilustrados: **Funis de
   Teste** e **Funis de Venda**. Aprovada visualmente com o usuário via
   mockup (companheiro de brainstorming) em 2026-09-04.
2. Novo modelo de dado: tabela `sales_funnels` (um funil de venda é sua
   própria entidade, filha de `client`, do mesmo jeito que `tests` já é).
3. Nova lista "Funis de Venda" por cliente (mesma estrutura visual da lista
   de testes: nome, resumo do mapeamento, receita/ROAS recentes, status de
   sincronização, toggle ativo/pausado, "+ Novo funil").
4. Formulário "Novo funil de venda" / "Editar funil" — nome + mapeamento
   LaunchOps (`operacao_ids`/`produto_nomes`), o que **substitui** os campos
   que a spec anterior (`2026-09-03-funnel-dashboard-design.md`) tinha
   colocado na aba Integrações do cliente.
5. O dashboard de funil que já existe (cone, KPIs, pizza de pagamento) passa
   a ser **por funil**, não por cliente — a mesma tela, só trocando a chave
   de filtro.
6. Job de sincronização (`/api/internal/sync-funnel`) passa a iterar
   `sales_funnels` em vez de `clients`.
7. Aba **Integrações** do cliente perde a seção de mapeamento LaunchOps —
   volta a conter só o que é de fato client-wide: Domínio e token da Hubla.

## Fora de escopo (mantido igual à spec anterior)

- Ingestão direta por cliente (cliente colando o próprio token do Meta
  Ads/Hubla) — já registrado como ideia futura na memória do projeto,
  não muda com esta spec.
- Multi-usuário / RBAC.
- Qualquer alteração no rastreamento de teste A/B (`click_events`,
  `conversions`, RPCs de relatório) — este trabalho não toca nisso.

## Modelo de dados

Migration nova `0032_sales_funnels.sql` (sequência após `0031`):

```sql
create table sales_funnels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  slug text not null,
  launchops_operacao_ids uuid[],
  launchops_produto_nomes text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, slug)
);

alter table sales_funnels enable row level security;
create policy "sales_funnels_via_client_owner" on sales_funnels
  for all using (exists (select 1 from clients c where c.id = sales_funnels.client_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from clients c where c.id = sales_funnels.client_id and c.owner_id = auth.uid()));

grant select, insert, update, delete on sales_funnels to authenticated;

-- As 4 tabelas do funil passam a ser escopadas por funil, não por cliente.
-- Sem dado existente pra migrar (todas as 4 estão vazias hoje) -- troca direta,
-- sem coluna de transição.
alter table sales drop column client_id;
alter table sales add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;

alter table ad_spend_daily drop column client_id;
alter table ad_spend_daily add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
-- unique (client_id, source, operacao_id, data) vira:
alter table ad_spend_daily drop constraint ad_spend_daily_client_id_source_operacao_id_data_key;
alter table ad_spend_daily add constraint ad_spend_daily_funnel_source_operacao_data_key
  unique (sales_funnel_id, source, operacao_id, data);

alter table ad_creative_spend_daily drop column client_id;
alter table ad_creative_spend_daily add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
alter table ad_creative_spend_daily drop constraint ad_creative_spend_daily_client_id_source_data_ad_id_ad_name_key;
alter table ad_creative_spend_daily add constraint ad_creative_spend_daily_funnel_source_data_ad_key
  unique nulls not distinct (sales_funnel_id, source, data, ad_id, ad_name);
drop index if exists ad_creative_spend_daily_report_idx;
create index ad_creative_spend_daily_report_idx
  on ad_creative_spend_daily(sales_funnel_id, ad_id, ad_name, data);

alter table funnel_sync_state drop constraint funnel_sync_state_pkey;
alter table funnel_sync_state drop column client_id;
alter table funnel_sync_state add column sales_funnel_id uuid not null references sales_funnels(id) on delete cascade;
alter table funnel_sync_state add primary key (sales_funnel_id, entity);

-- Campos antigos no client nunca foram preenchidos (confirmado 2026-09-04) -- remove
-- sem necessidade de backfill.
alter table clients drop column launchops_operacao_ids;
alter table clients drop column launchops_produto_nomes;
```

**Nota sobre RLS de `sales_funnels`:** diferente das 4 tabelas de dado
sincronizado (que continuam SELECT-only pra `authenticated`, escrita só por
`service_role`), `sales_funnels` recebe policy `for all` — porque é o
usuário, pela UI, quem cria/edita/pausa/apaga um funil (não o job de sync).

**`get_test_report_by_ad`/`get_test_report_by_source`:** o join com
`ad_creative_spend_daily` (adicionado na spec anterior) precisa trocar de
`acsd.client_id = v_client_id` para `acsd.sales_funnel_id = ...` — mas como
**hoje não existe nenhum jeito de saber qual funil de venda corresponde a
qual teste A/B** (são conceitos irmãos, não pai/filho), esse join fica
**sem match nenhum até o usuário mapear um teste a um funil explicitamente**.
Isso não é regressão: hoje mesmo, sem nenhum funil configurado, esse join já
não bate nada (as tabelas estão vazias). Fica registrado como um ponto em
aberto — ver "Não resolvido nesta spec" abaixo.

## Não resolvido nesta spec (decisão do usuário, não bloqueia o resto)

Cruzar "Por anúncio" do relatório de teste A/B com o gasto de um funil de
venda específico exige saber **qual funil pertence a qual teste** — hoje
não existe esse vínculo (client tem N testes e N funis, sem ligação
declarada entre um teste e um funil). Duas opções, para decidir depois:
(a) o teste A/B ganha um campo opcional "funil de venda associado"; (b) o
match continua sendo feito só por `client_id` (voltando a ser client-wide
só para esse join específico, mesmo com múltiplos funis). Não implementado
agora — o relatório por anúncio simplesmente não mostra gasto até isso ser
decidido, sem quebrar nada do que já funciona (clique/conversão continuam
normais).

## Rotas novas

- `src/app/dashboard/clients/[clientSlug]/page.tsx` — **reescrita**: vira o
  hub com os 2 cartões (Funis de Teste / Funis de Venda), cada um já
  mostrando contagem real (`count(*)` de tests / sales_funnels).
- `src/app/dashboard/clients/[clientSlug]/tests/page.tsx` — **nova**: recebe
  o conteúdo que hoje está em `page.tsx` (lista de testes, sem mudança de
  lógica, só de caminho).
- `src/app/dashboard/clients/[clientSlug]/funis-venda/page.tsx` — **nova**:
  lista de `sales_funnels` daquele cliente (nome, mapeamento resumido,
  receita/ROAS via `getDailyFunnel` somado nos últimos 7 dias, saúde de
  sync via `getFunnelSyncHealth`, toggle `is_active`, "+ Novo funil").
- `src/app/dashboard/clients/[clientSlug]/funis-venda/new/page.tsx` —
  **nova**: formulário nome + `launchops_operacao_ids` +
  `launchops_produto_nomes` (mesmos campos que estavam em Integrações,
  agora aqui).
- `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/page.tsx`
  — **substitui** a atual `.../funnel/page.tsx`: mesmo conteúdo (cone, KPIs,
  pizza), trocando o filtro de `client_id` para `sales_funnel_id` resolvido
  pelo slug do funil.
- `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/edit/page.tsx`
  — **nova**: editar nome/mapeamento/pausar, mesmo padrão de
  `tests/[testSlug]/edit`.

## Mudanças em código existente

- `src/app/dashboard/clients/[clientSlug]/integrations/page.tsx` — remove a
  seção de mapeamento LaunchOps adicionada pela spec anterior (Domínio e
  Hubla continuam).
- `src/app/api/internal/sync-funnel/route.ts` — troca a query de `clients`
  (`where launchops_operacao_ids is not null`) para `sales_funnels`
  (`where is_active = true and (launchops_operacao_ids is not null or
  launchops_produto_nomes is not null)`), e todo `client.id` usado como
  chave de escrita vira `funnel.id`.
- `src/lib/repo/funnel-repo.ts` — `getDailyFunnel`/`getPaymentMethodBreakdown`/
  `getFunnelSyncHealth` trocam o parâmetro `clientId` por `salesFunnelId`.
- Cabeçalho do cliente (hoje com botões "Integrações" / "Funil de Vendas" /
  "Novo teste" soltos lado a lado) — o botão solto "Funil de Vendas" some
  daqui, porque agora só se chega em Funis de Venda pelo hub.

## Estratégia de testes

- Integração: RLS de `sales_funnels` — dono do client lê/escreve, outro
  usuário não; mesmo padrão já usado nas outras 4 tabelas.
- Integração: criar dois `sales_funnels` para o mesmo client com o mesmo
  `slug` deve falhar (constraint `unique (client_id, slug)`).
- Integração: `funnel_sync_state` com a nova PK composta
  `(sales_funnel_id, entity)` — duas entidades do mesmo funil não colidem;
  o mesmo `entity` em dois funis diferentes do mesmo client não colide.
- Integração: sync route com 2 funis ativos do mesmo client mapeando
  `operacao_ids` diferentes — dado de um nunca aparece no outro.
- Unitário: `getDailyFunnel`/`getPaymentMethodBreakdown` recebendo
  `salesFunnelId` em vez de `clientId` — mesmos testes já existentes,
  só troca o parâmetro.
