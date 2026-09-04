# Hub de Cliente + Funis de Venda Plurais — Design

## Contexto e motivação

Hoje, dentro de um `client` (ex: "Gustavo VOE"), existem dois tipos de
funcionalidade misturados na mesma navegação:

- **Testes A/B** (`tests`) — já plural, já tem lista + "Novo teste".
- **Funil de Vendas** (LaunchOps: vendas + gasto de mídia) — hoje é **singular
  por cliente**: os campos `clients.launchops_operacao_ids` e
  `clients.launchops_produto_nomes` guardam um único mapeamento, e a página
  `/dashboard/clients/[clientSlug]/funnel` mostra um único dashboard. A
  credencial de acesso ao LaunchOps (`LAUNCHOPS_SUPABASE_URL`/
  `LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY`) é hoje uma variável de ambiente
  **global** da Vercel — um segredo só, compartilhado por todos os clientes.

O usuário quer três coisas nesta mesma leva de trabalho:

1. **Funil de Venda plural** — um cliente pode ter vários funis de venda
   (ex: "1K LATAM", "Alunos 1K Por Dia"), do mesmo jeito que já tem vários
   testes A/B.
2. **Credencial por cliente, não global** — em vez de uma variável de
   ambiente única compartilhada, a URL e a chave de acesso à fonte de dados
   do funil (hoje sempre o LaunchOps) viram campos na aba **Integrações**
   de cada cliente, do mesmo jeito que o token da Hubla já é por cliente.
   No caso real de hoje (só "Gustavo VOE"), o usuário mesmo vai colar a
   URL/chave do seu LaunchOps ali — mas a estrutura já nasce pronta pra um
   cliente futuro ter uma fonte diferente, sem precisar mexer em variável
   de ambiente da Vercel.
3. **Atribuição de gasto continua automática, sem vínculo manual** — o
   relatório "Por anúncio" já casa gasto com clique pela identidade do
   próprio anúncio (`fb_ad_id`/`utm_term`), nunca por uma relação declarada
   entre teste e funil. Com múltiplos funis por cliente, isso só muda no
   "de onde" a soma de gasto é buscada: em vez de olhar o gasto de um único
   funil, o relatório soma o gasto de **todos os funis daquele cliente**,
   e casa por ID/nome do anúncio como sempre fez. Decisão explícita do
   usuário: não quer escolher manualmente "esse teste é desse funil" — quer
   que a atribuição continue vindo só do que a Meta já manda no clique e na
   venda.

**Estado real do banco (verificado em 2026-09-04, antes de escrever esta
spec):** nenhum client tem `launchops_operacao_ids`/`launchops_produto_nomes`
preenchido ainda, e as 4 tabelas do funil (`sales`, `ad_spend_daily`,
`ad_creative_spend_daily`, `funnel_sync_state`) estão todas vazias — a
sincronização com o LaunchOps ainda não rodou de verdade. **Isso significa
que não existe nenhum dado real para migrar ou re-mapear** — a mudança de
modelo de dado é só criar a estrutura nova, sem backfill.

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
   (`launchops_operacao_ids`/`launchops_produto_nomes`).
5. Aba **Integrações** do cliente ganha uma seção nova, **"Fonte de dados do
   Funil de Vendas"** (URL + chave de acesso) — client-wide, compartilhada
   por todos os funis daquele cliente. Continua com Domínio e Hubla como já
   é hoje.
6. O dashboard de funil que já existe (cone, KPIs, pizza de pagamento) passa
   a ser **por funil**, não por cliente — a mesma tela, só trocando a chave
   de filtro.
7. Job de sincronização (`/api/internal/sync-funnel`) passa a iterar
   `sales_funnels`, resolvendo a credencial de acesso pelo `client_id` de
   cada funil (não mais uma única credencial global).
8. `get_test_report_by_ad`/`get_test_report_by_source` passam a agregar
   `ad_creative_spend_daily` de **todos os `sales_funnels` do cliente** do
   teste (via `join sales_funnels ... where client_id = v_client_id`, no
   lugar do antigo `acsd.client_id = v_client_id` direto), continuando a
   casar por `fb_ad_id`/`utm_term` exatamente como já fazia com um funil
   só. Nenhum campo novo no teste, nenhuma escolha manual do usuário.

## Fora de escopo

- Ingestão direta batendo na API do Meta Ads/Hubla usando o token do
  próprio cliente final (sem nenhum banco tipo LaunchOps no meio) — isso
  continua diferente do item 2 do escopo acima: aqui a fonte ainda é "um
  banco Postgres/Supabase no formato do LaunchOps", só a credencial de
  acesso a ele que vira por cliente. Ingestão direta de verdade (schema
  arbitrário, sem ser LaunchOps) continua fora, registrada na memória do
  projeto como ideia futura.
- Multi-usuário / RBAC.
- Qualquer alteração no rastreamento de clique/conversão do teste A/B em si
  (`click_events`, `conversions`) — este trabalho não toca nisso, só no que
  cruza com gasto de mídia.

## Modelo de dados

Migration nova `0032_sales_funnels.sql` (sequência após `0031`):

```sql
-- Credencial de acesso à fonte de dados do funil, por cliente (substitui as
-- variáveis de ambiente globais LAUNCHOPS_SUPABASE_URL/LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY).
alter table clients add column funnel_source_url text;
alter table clients add column funnel_source_service_role_key text;

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

**Cruzamento de gasto — automático, sem vínculo manual:** a CTE
`ad_spend_agg` de `get_test_report_by_ad`/`get_test_report_by_source` troca
`from ad_creative_spend_daily acsd where acsd.client_id = v_client_id` por:

```sql
from ad_creative_spend_daily acsd
join sales_funnels sf on sf.id = acsd.sales_funnel_id
where sf.client_id = v_client_id
```

Isso soma o gasto de **todos os funis daquele cliente** numa única bolsa, e
o resto da query continua igual: casa com o clique por
`coalesce(nullif(fb_ad_id,''), nullif(utm_term,''))`. Se o cliente não tiver
nenhum funil configurado (caso de hoje), a soma vem vazia e as colunas de
gasto ficam em branco — mesmo comportamento gracioso de sempre, sem
exceção. Não existe cenário onde o usuário precise "escolher" de qual funil
vem o gasto: se dois funis do mesmo cliente acidentalmente mapearem a
mesma operação do LaunchOps, o gasto dela pode ser somado em dobro — isso é
um cuidado de configuração do usuário (mapear operações sem sobrepor), não
algo que o código precise validar.

**Sobre guardar a chave de acesso em texto puro:** segue exatamente o mesmo
padrão já usado pro token de webhook da Hubla (`clients.hubla_webhook_token`)
— sem criptografia adicional nesta v1, protegido pelas mesmas garantias de
RLS/acesso que já protegem o resto da tabela `clients`. Não é uma mudança de
postura de segurança, é consistência com o que já existe.

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
  `launchops_produto_nomes` (a credencial de acesso NÃO fica aqui — fica em
  Integrações, client-wide).
- `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/page.tsx`
  — **substitui** a atual `.../funnel/page.tsx`: mesmo conteúdo (cone, KPIs,
  pizza), trocando o filtro de `client_id` para `sales_funnel_id` resolvido
  pelo slug do funil.
- `src/app/dashboard/clients/[clientSlug]/funis-venda/[funnelSlug]/edit/page.tsx`
  — **nova**: editar nome/mapeamento/pausar, mesmo padrão de
  `tests/[testSlug]/edit`.

## Mudanças em código existente

- `src/app/dashboard/clients/[clientSlug]/integrations/page.tsx` — troca a
  seção de mapeamento LaunchOps (da spec anterior) por uma seção genérica
  "Fonte de dados do Funil de Vendas" (2 campos: URL, chave de acesso).
  Domínio e Hubla continuam como estão.
- `src/lib/launchops/client.ts` (`createLaunchOpsClient`) — deixa de ler
  `process.env.LAUNCHOPS_SUPABASE_URL`/`LAUNCHOPS_SUPABASE_SERVICE_ROLE_KEY`
  e passa a receber `url`/`serviceRoleKey` como parâmetros, buscados do
  `client` dono do funil sendo sincronizado.
- `src/app/api/internal/sync-funnel/route.ts` — a query passa a ser em
  `sales_funnels` (join `clients` pra pegar a credencial), filtrando
  `is_active = true`; para cada funil, cria um `LaunchOpsClient` com a
  credencial do client dono daquele funil (clientes diferentes podem ter
  fontes diferentes; funis do mesmo cliente reaproveitam a mesma conexão).
  Todo `client.id` usado como chave de escrita nas 3 tabelas de sync vira
  `funnel.id`.
- `src/lib/repo/funnel-repo.ts` — `getDailyFunnel`/`getPaymentMethodBreakdown`/
  `getFunnelSyncHealth` trocam o parâmetro `clientId` por `salesFunnelId`.
- Formulário de teste A/B (criar/editar) — **sem mudança nenhuma**. A
  atribuição de gasto continua 100% automática, pela identidade do
  anúncio.
- Cabeçalho do cliente (hoje com botões "Integrações" / "Funil de Vendas" /
  "Novo teste" soltos lado a lado) — o botão solto "Funil de Vendas" some
  daqui, porque agora só se chega em Funis de Venda pelo hub.

## Tratamento de erros e casos de borda

- **Cliente sem `funnel_source_url`/`funnel_source_service_role_key`
  configurado, mas com um `sales_funnel` já criado:** o job de sync pula
  esse funil (mesmo tratamento silencioso e sem derrubar o cron que já
  existe pra client sem mapeamento, só que agora a checagem é na
  credencial do client, não no mapeamento do funil).
- **Um `sales_funnel` é apagado:** os testes daquele cliente continuam
  existindo normalmente — a soma de gasto (que já vem de "todos os funis do
  cliente", nunca de um funil específico "dono" do teste) simplesmente
  passa a somar um funil a menos, sem erro.
- **Dois clientes diferentes com a mesma URL/chave de fonte de dados**
  (ex: dois clientes seus seguindo apontando pro mesmo LaunchOps): sem
  problema — cada `sales_funnel` ainda filtra por `operacao_ids`/
  `produto_nomes` próprios, então não há vazamento de dado entre eles.

## Estratégia de testes

- Integração: RLS de `sales_funnels` — dono do client lê/escreve, outro
  usuário não; mesmo padrão já usado nas outras 4 tabelas.
- Integração: criar dois `sales_funnels` para o mesmo client com o mesmo
  `slug` deve falhar (constraint `unique (client_id, slug)`).
- Integração: `funnel_sync_state` com a nova PK composta
  `(sales_funnel_id, entity)` — duas entidades do mesmo funil não colidem;
  o mesmo `entity` em dois funis diferentes do mesmo client não colide.
- Integração: sync route com 2 clients com `funnel_source_url`/chave
  **diferentes** — dado de um nunca aparece no outro (prova que a
  credencial por cliente funciona de verdade, não só a variável global).
- Integração: `get_test_report_by_ad` com um cliente que tem **dois**
  `sales_funnels` cada um com gasto de anúncios diferentes — o relatório
  soma o gasto dos dois corretamente, casando por `fb_ad_id`/`utm_term`
  como sempre. Cliente sem nenhum funil continua com as colunas de gasto
  em branco, sem quebrar clique/conversão.
- Integração: apagar um `sales_funnel` — os testes daquele cliente
  continuam existindo e seu relatório de clique/conversão continua
  idêntico (só o gasto somado fica menor, sem erro).
- Unitário: `getDailyFunnel`/`getPaymentMethodBreakdown` recebendo
  `salesFunnelId` em vez de `clientId` — mesmos testes já existentes,
  só troca o parâmetro.
