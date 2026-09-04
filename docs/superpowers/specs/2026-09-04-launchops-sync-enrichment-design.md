# Ampliar o Sync do LaunchOps (reconciliação + hierarquia de campanha) — Design

## Contexto e motivação

Uma análise de arquitetura de dados (rascunho publicado como artifact em
2026-09-04) identificou que o ab-test-tool guarda venda e gasto de mídia em
dois lugares que nunca se cruzam por chave de verdade: `conversions`
(atribuída por clique de teste) e `sales`/`ad_creative_spend_daily`
(sincronizadas do LaunchOps, por produto/anúncio). Isso gera três limitações:

1. **Sem reconciliação** entre `conversions` e `sales` — a mesma compra pode,
   em tese, gerar um registro de receita em cada tabela sem nenhum vínculo.
2. **Gasto de anúncio sem hierarquia de campanha** — `ad_creative_spend_daily`
   só guarda `ad_id`/`ad_name`, sem `campaign_id`/`adset_id`.

(Uma terceira lacuna do rascunho original — identidade de comprador, pra
LTV/recompra — foi discutida e **adiada por decisão consciente do Vitor**
em 2026-09-04: guardar e-mail/telefone/nome no ab-test-tool, mesmo copiando
de um campo que a Hubla já manda pro LaunchOps, é a primeira vez que dado
pessoal de comprador entraria nesse banco, e isso merece mais tempo de
decisão sobre retenção/LGPD do que cabe nesta etapa. Ver "Fora de escopo".)

**Achado que muda o escopo original:** inspecionando o schema real do banco
do LaunchOps (`vgxivkxkbsspekmkaqhw`, verificado em 2026-09-04), as três
lacunas acima já têm o dado resolvido do lado do LaunchOps, só não são
lidas pelo sync de hoje:

- `vendas.transaction_id_plataforma` — o id da transação na Hubla, o mesmo
  valor que o ab-test-tool já grava em `conversions.external_event_id`
  (`invoice.id`, ver `src/lib/domain/hubla.ts`). É a chave de reconciliação
  que faltava. Não é dado pessoal — é só um identificador de transação.
- `anuncio.campaign_id`, `campaign_name`, `adset_id`, `adset_name` — já
  presentes na mesma tabela que `sync-ad-creative-spend.ts` já lê hoje
  (`fetchLaunchOpsAdCreatives` só seleciona `id, ad_id, ad_name`).

Ou seja: as três lacunas do rascunho original, para clientes que já usam o
LaunchOps, não exigem nenhuma tabela nova nem infraestrutura nova — só
ampliar o `select` de duas funções de sync que já existem e adicionar
colunas nas tabelas que já existem.

**Verificado com dado real de produção (2026-09-04, após a primeira versão
desta spec):** a hipótese central não pôde ser confirmada nesta sessão (sem
acesso ao projeto Supabase de produção real via MCP — só a duas contas que
apontavam para projetos sem relação com produção), mas foi confirmada
depois, com acesso direto aos dois bancos reais: o id
`05a61998-5922-441a-a1ff-a27efc71ff7e` (cliente Gustavo VOE) aparece em
`vendas.transaction_id_plataforma` (LaunchOps) e em
`conversions.external_event_id` (ab-test-tool), batendo
caractere-por-caractere. A chave de reconciliação funciona como desenhado.
O casamento continua sendo tratado como best-effort no código (ver
"Tratamento de erros e casos de borda") — a confirmação remove a incerteza
sobre o *formato* do dado, não elimina os casos em que uma venda
simplesmente não tem uma conversão correspondente (a maioria não tem).

## Escopo

1. **`sales` ganha 2 colunas**: `transaction_id_plataforma`, `conversion_id`
   (FK opcional para `conversions.id`).
2. **`sync-sales.ts`** amplia a leitura do LaunchOps para trazer
   `transaction_id_plataforma` de `vendas`, e tenta casar esse valor com
   `conversions.external_event_id` antes de gravar — se achar, preenche
   `conversion_id`; se não achar, grava a venda normalmente com
   `conversion_id = null`.
3. **`ad_creative_spend_daily` ganha 4 colunas**: `campaign_id`,
   `campaign_name`, `adset_id`, `adset_name`.
4. **`sync-ad-creative-spend.ts`** amplia a leitura de `anuncio` para trazer
   esses 4 campos (já presentes na tabela) e os grava junto com o gasto
   diário.

## Fora de escopo

- **Identidade de comprador (e-mail/telefone/nome), pra qualquer cliente,
  LaunchOps ou não.** Decisão consciente do Vitor em 2026-09-04: mesmo
  vindo de um campo que a Hubla já manda pro LaunchOps, seria a primeira
  vez que dado pessoal de comprador entra no ab-test-tool — merece uma
  decisão própria sobre retenção/LGPD antes de implementar, não uma
  aprovação de carona dentro desta spec. Fica registrado como próximo
  passo possível, não descartado.
- Nenhuma tabela nova (`customers`, `dim_ad`, `fact_sale`). Esta etapa
  enriquece as tabelas que já existem — a decisão de promover pra uma
  tabela dedicada fica para quando surgir uma necessidade concreta (ex: uma
  tela de perfil de comprador).
- Nenhuma mudança de relatório ou de UI. Os campos novos ficam disponíveis
  no banco; usá-los num relatório é um passo separado, depois.
- Reconciliação retroativa por job/varredura — ver "Tratamento de erros e
  casos de borda" sobre por que o casamento é só no momento do sync.
- Tratamento de venda que muda de status (`aprovada` → `reembolsada`) depois
  de já sincronizada — gap conhecido, não introduzido nem resolvido aqui.
- Hierarquia de campanha em `ad_spend_daily` (a tabela de gasto agregado por
  operação, distinta de `ad_creative_spend_daily`) — não foi verificado se
  `meta_ads_daily` (fonte de `ad_spend_daily`) precisa do mesmo tratamento;
  fica para uma iteração futura se fizer falta.

## Modelo de dados

Migration nova `supabase/migrations/0034_launchops_sync_enrichment.sql`
(sequência após `0033_funnel_traffic_metrics.sql`, que foi aplicada em
produção durante o mesmo dia em que esta spec foi escrita — `0033` já está
ocupado):

```sql
alter table sales add column transaction_id_plataforma text;
alter table sales add column conversion_id uuid references conversions(id) on delete set null;

alter table ad_creative_spend_daily add column campaign_id text;
alter table ad_creative_spend_daily add column campaign_name text;
alter table ad_creative_spend_daily add column adset_id text;
alter table ad_creative_spend_daily add column adset_name text;
```

Nenhuma mudança de RLS ou de grants: as colunas novas entram em tabelas que
já têm suas políticas (`sales_via_client_owner`, `ad_creative_spend_daily_via_client_owner`)
e já são escritas só por `service_role` — colunas novas não mudam quem lê
ou escreve.

`conversion_id` é `on delete set null` (não `cascade`): apagar uma
`conversion` (o que hoje só acontece em cascata via apagar um `click_event`
ou um `test`) não deve apagar a venda do funil correspondente — só
desfazer o vínculo.

## Mudanças em código existente

- **`src/lib/launchops/sync-sales.ts`** (nota: esta função já mudou uma vez
  hoje, ver `880ec2f fix: batch LaunchOps sync upserts` — passou a gravar
  em lotes de `UPSERT_BATCH_SIZE = 500` em vez de um upsert único; a
  descrição abaixo já é sobre a versão atual, não a original)
  - `LaunchOpsSaleRow` ganha `transaction_id_plataforma` (`string | null`).
  - `fetchLaunchOpsSalesRows` amplia o `.select(...)` da query em `vendas`
    para incluir esse campo.
  - `syncSalesForFunnel`: antes do `.map()` que monta o payload (a mesma
    passagem única que já existe, antes de ser fatiada nos lotes de 500
    pra gravação), coleta os `transaction_id_plataforma` não-nulos de
    **todo** `rows` (não por lote), busca em `conversions`
    (`select id, external_event_id where external_event_id = any(...)`) e
    monta um mapa `external_event_id → conversion_id`. Cada linha do
    payload ganha `conversion_id: map.get(transaction_id_plataforma) ??
    null`. Uma única consulta extra por chamada de sync, antes de entrar
    no loop de gravação em lotes — não uma consulta por lote nem por
    venda.

- **`src/lib/launchops/sync-ad-creative-spend.ts`**
  - `LaunchOpsAdCreative` e `JoinedAdCreativeSpendRow` ganham `campaign_id`,
    `campaign_name`, `adset_id`, `adset_name` (todos `string | null`).
  - `fetchLaunchOpsAdCreatives` amplia o `.select(...)` de `anuncio` para
    incluir os 4 campos.
  - `joinAdCreativeSpend` repassa os 4 campos do `creative` pro resultado
    unido.
  - `syncAdCreativeSpendForFunnel` inclui os 4 campos no payload de upsert.
    A chave de conflito (`sales_funnel_id,source,data,ad_id,ad_name`) não
    muda — campanha/conjunto são atributos do anúncio, não fazem parte da
    identidade da linha.

## Tratamento de erros e casos de borda

- **`transaction_id_plataforma` nulo ou vazio**: venda é gravada
  normalmente, `conversion_id` fica `null`. Não é erro — a maioria das
  vendas de um funil não passou por um teste A/B.
- **Nenhuma `conversion` com aquele `external_event_id`**: mesmo
  comportamento — `conversion_id` fica `null`. Esperado na maioria dos
  casos (nem toda venda vem de um clique de teste).
- **Ordem de chegada — venda sincroniza antes da conversão existir**: o
  sync é incremental (só processa vendas novas/atualizadas desde o último
  cursor, ver `fetchLaunchOpsSalesRows`). Se a venda for sincronizada
  *antes* da conversão correspondente ser gravada no ab-test-tool, essa
  venda específica nunca mais é reprocessada automaticamente (a menos que
  o `updated_at` dela mude de novo no LaunchOps, entrando numa próxima
  janela incremental). **Limitação conhecida e aceita nesta v1** — não
  temos ainda dado real para saber se isso importa na prática. Se importar,
  o próximo passo natural é o webhook da Hubla (`insertConversionIfNew`)
  também tentar casar pra trás contra `sales` já sincronizadas sem vínculo
  — não implementado aqui.
- **Duas conversões com o mesmo `external_event_id`**: não acontece — já
  existe um índice único parcial (`conversions_external_event_id_idx`) que
  garante isso desde a migration `0001`.
- **`anuncio` sem `campaign_id`/`adset_id`** (registro antigo/incompleto no
  LaunchOps): colunas nulas, sem erro — mesmo tratamento gracioso que já
  existe hoje pra `ad_id`/`ad_name` ausentes.
- **Re-sync de uma venda já reconciliada**: se a mesma venda for
  re-sincronizada (ex: `status` mudou), o upsert recalcula o casamento do
  zero. Se a conversão ainda existir com o mesmo `external_event_id`, o
  vínculo se mantém; não há como esse recálculo *perder* um vínculo já
  certo, só ganhar um que faltava.
- **Mesmo `transaction_id_plataforma` em vendas de dois funis/clientes
  diferentes** (não deveria acontecer — cada transação da Hubla é única —
  mas é estruturalmente possível se o LaunchOps duplicar um registro):
  ambas as linhas de `sales` apontariam pro mesmo `conversion_id`, já que
  não há constraint de unicidade impedindo isso. Risco muito baixo,
  registrado como decisão consciente de não adicionar uma constraint agora
  — mesmo padrão de outras regras "garantidas só na aplicação, não no
  banco" já usado no projeto (ex: soma de peso das variantes).

## Estratégia de testes

Segue o padrão já usado no projeto (migration com teste de integração
irmão, ex: `0029_funnel_dashboard.integration.test.ts`):

- **Integração** (`0034_launchops_sync_enrichment.integration.test.ts`):
  colunas novas existem com os tipos certos em `sales` e
  `ad_creative_spend_daily`; apagar uma `conversion` com uma `sales`
  vinculada não apaga a `sales`, só zera `conversion_id`.
- **Unitário** (`sync-sales.test.ts`): dado um lote de `LaunchOpsSaleRow`
  com `transaction_id_plataforma` variados e um conjunto de conversões
  simuladas, o payload gerado tem `conversion_id` certo quando bate,
  `null` quando não bate e quando o campo vem nulo da fonte.
- **Unitário** (`sync-ad-creative-spend.test.ts`): `joinAdCreativeSpend`
  repassa `campaign_id`/`campaign_name`/`adset_id`/`adset_name` do
  `creative` pra linha final, inclusive quando algum vem `null`.
- **Integração** (`sync-sales.integration.test.ts`, já existe — estender):
  rodar `syncSalesForFunnel` com uma `conversion` real pré-existente no
  banco de teste local e um `transaction_id_plataforma` que bate com o
  `external_event_id` dela — confirma o vínculo de ponta a ponta contra
  Postgres de verdade, não só contra o mock.
