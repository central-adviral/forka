# Modo de teste: Página vs Checkout — Design

## Contexto e motivação

Hoje a ferramenta suporta um único modelo de teste: o link `/r/[slug]` sorteia
uma variante por peso no clique do anúncio e redireciona direto pra URL de
destino daquela variante — cada variante é uma página de vendas inteira.

O usuário quer um segundo modo: manter **uma única página de vendas** (sem
duplicar) e fazer o sorteio no nível do **checkout**. Um link de campanha só,
que sempre leva à mesma página, mas cujo botão de comprar aponta pra um de N
checkouts diferentes, decidido pela ferramenta.

**Restrição inegociável:** um único link de campanha pro Meta Ads, nos dois
modos. O cliente nunca deve precisar rodar dois anúncios pra rodar um teste.

**Escala esperada:** 1–2 clientes internos. O desenho evita infraestrutura
pesada — ver "Fora de escopo".

## Decisão central: o sorteio continua sendo um só

O sorteio permanece em `/r/[slug]`, no clique do anúncio, gravando o
`click_events` de sempre (variante + visitante + `tracking_id`). O modo checkout
**não move o sorteio para a página**.

Consequência: `get_test_report`, `get_test_report_by_source`,
`get_test_report_by_ad`, o cálculo de significância e o webhook da Hubla
continuam funcionando sem nenhuma alteração, porque todos derivam de
`click_events.variant_id`. Não existe RPC "por checkout" — no modo checkout, a
variante **é** o checkout.

A rota nova `/c/[slug]` apenas resolve e redireciona: não sorteia, não escreve
no banco no caminho feliz, e por isso é idempotente (o visitante pode voltar da
Hubla e clicar em comprar de novo sem trocar de variante nem duplicar acesso).

### Mecanismo escolhido: go-link, não snippet JS

O botão de comprar recebe um href estático da própria ferramenta
(`https://{dominio-do-cliente}/c/{test-slug}`). Alternativa considerada e
rejeitada: snippet JS na página de vendas lendo um parâmetro da URL e
reescrevendo o `href` do botão.

Motivos da escolha:

- Nenhum JS na página do cliente, nenhum seletor de botão pra quebrar quando o
  layout muda. Confirmado com o usuário que o botão é um `<a href>` editável
  (`<a href="https://pay.hub.la/...">`), não um widget fechado.
- Vários botões de compra na mesma página recebem o mesmo href.
- Trocar checkouts, pesos ou adicionar uma variante **não exige tocar na página
  do cliente de novo**.
- A ferramenta passa a **garantir** o `utm_content` no checkout, em vez de
  depender do construtor de página repassar o parâmetro.

Custo aceito: um hop extra (~150ms) no clique do botão.

## Escopo

- Campo `test_type` (`page` | `checkout`) no teste, imutável após a criação.
- Campo `sales_page_url` no teste, obrigatório quando `test_type = 'checkout'`.
- No modo checkout, `variants.destination_url` passa a guardar o link do
  checkout (`pay.hub.la/...`) daquela variante.
- Rota nova `/c/[slug]` (go-link do botão de comprar).
- `/r/[slug]` passa a escolher o destino conforme o `test_type`.
- UI: seletor de tipo, campo de página de vendas, rótulos condicionais, bloco
  "Link do botão de comprar" no relatório, selo na lista de testes, aviso
  reforçado ao apagar teste de checkout.

## Fora de escopo

- **Nó "página de vendas" no canvas do relatório.** Decisão explícita do
  usuário de adiar. No modo checkout, o canvas continua desenhando
  `link do teste → variante (com o link do checkout) → conversão`, o que é
  correto e legível; o que não aparece é o passo compartilhado da página de
  vendas. Inserir esse nó exige refazer o cálculo de posições e arestas em
  `computeReportLayout` — é a maior peça de trabalho do conjunto, e a
  informação que ela acrescenta é justamente a que o operador já conhece por
  ter configurado o teste. Fica pra uma rodada posterior.
- **Trocar o `test_type` de um teste já criado.** Proibido por decisão do
  usuário: acessos e vendas gravados sob uma semântica somariam no mesmo
  relatório com registros de outra semântica, produzindo números errados de
  forma silenciosa. Para mudar a mecânica, cria-se um teste novo com link novo.
- **Usar o go-link também no modo página.** Hoje, no teste de página, o
  `utm_content` sai do `/r/` pra página de vendas e precisa sobreviver sozinho
  até o `pay.hub.la` — se o construtor de página não repassar o parâmetro, a
  venda chega sem tracking e a atribuição se perde silenciosamente. O go-link
  resolveria isso também. **Não fazer agora**: o modo página funciona e não deve
  regredir nesta mudança. Registrado como melhoria futura de alto valor.
- Campo "checkout padrão" como rede de proteção ao apagar teste (avaliado e
  rejeitado — ver "Casos de borda", situação 4).
- Editor visual drag-and-drop de funil. Avaliado e rejeitado: o formulário com
  seletor de tipo cobre o caso com três campos de texto.
- Testes combinados página × checkout (fatorial 2×2).
- Botões de compra apontando pra produtos diferentes na mesma página.

## Modelo de dados

Migration nova (`0012_test_type_checkout.sql`).

### Colunas novas em `tests`

```sql
alter table tests
  add column test_type text not null default 'page'
    check (test_type in ('page','checkout')),
  add column sales_page_url text;

alter table tests
  add constraint tests_checkout_requires_sales_page
    check (test_type <> 'checkout' or sales_page_url is not null);
```

O `default 'page'` faz todo teste existente virar modo página automaticamente.
A migration é puramente aditiva: nenhum dado existente é reescrito.

RLS existente em `tests` (`tests_via_client_owner`, `FOR ALL`) já cobre as
colunas novas — nenhuma policy nova.

### Imutabilidade de `test_type`

Não basta omitir o campo do server action: `grant ... update on tests to
authenticated` está ativo e a Data API é acessível pelo browser, então um
`PATCH` direto poderia trocar o tipo. Trigger:

```sql
create or replace function forbid_test_type_change() returns trigger
language plpgsql as $$
begin
  if new.test_type is distinct from old.test_type then
    raise exception 'test_type is immutable';
  end if;
  return new;
end;
$$;

create trigger tests_test_type_immutable
  before update on tests
  for each row execute function forbid_test_type_change();
```

### RPC `create_test_with_variants`

A função ganha dois parâmetros. PostgreSQL faz overload por assinatura, então
`create or replace` com lista de argumentos diferente criaria uma **segunda**
função e deixaria a chamada ambígua no PostgREST. A migration precisa dropar a
versão antiga primeiro:

```sql
drop function if exists create_test_with_variants(uuid, text, text, text, text, jsonb);
```

Nova assinatura, na ordem:
`(p_client_id uuid, p_name text, p_slug text, p_fallback_url text,
p_conversion_method text, p_test_type text, p_sales_page_url text,
p_variants jsonb)`.

Corpo: mantém a checagem de posse do cliente e a validação de pesos somando
100, e acrescenta antes do insert:

```sql
if p_test_type = 'checkout' and (p_sales_page_url is null or p_sales_page_url = '') then
  raise exception 'checkout tests require a sales page url';
end if;
```

O insert em `tests` passa a incluir `test_type` e `sales_page_url`. Refazer
`revoke all ... from public` e `grant execute ... to authenticated` para a nova
assinatura.

### Índice

`getLatestTrackingId` filtra por `(test_id, visitor_id)` ordenando por
`created_at desc`. Os índices existentes (`0005`) cobrem só `test_id` e
`variant_id` isoladamente, o que faria a consulta varrer todos os cliques do
teste no caminho do botão de comprar:

```sql
create index click_events_test_visitor_created_idx
  on click_events (test_id, visitor_id, created_at desc);
```

## Fluxo — modo checkout

1. Clique no anúncio → `/r/{slug}` (com as UTMs de sempre).
2. `/r/` sorteia (ou recupera) a variante, grava `click_events` com
   `tracking_id`, e redireciona para **`tests.sales_page_url`** com
   `utm_content={tracking_id}` — em vez de `variants.destination_url`.
3. Visitante na página de vendas do cliente. Nenhum JS da ferramenta na página.
4. Clique em "Comprar" → `/c/{slug}` (href estático, idêntico em todos os
   botões da página).
5. `/c/` resolve variante + `tracking_id` a partir dos cookies e redireciona
   para `variants.destination_url` (o checkout) com `utm_content={tracking_id}`.
6. Hubla registra a sessão de pagamento com `utm.content`.
7. Webhook `invoice.payment_succeeded` → `parseHublaPaymentSucceeded` →
   match por `tracking_id` → grava `conversions`. Sem alteração.

No modo página, o passo 2 continua usando `variants.destination_url` e os passos
4–5 não existem.

## Rota `/c/[slug]`

Arquivo novo: `src/app/c/[slug]/route.ts`, espelhando o formato de
`src/app/r/[slug]/route.ts` e `src/app/ty/[slug]/route.ts` (service-role client,
`GET`, `params` como Promise).

Algoritmo:

1. `getTestBySlug(db, slug)`.
2. Se `!test`, ou `test.test_type !== 'checkout'`, ou `test.variants.length === 0`
   → 404. **`status` NÃO é checado aqui** — teste pausado continua vendendo
   (ver casos de borda).
3. Resolver a variante, nesta ordem:
   a. cookie de atribuição (`assignmentCookieName(test.slug)`), se o id
      corresponder a uma variante ainda existente;
   b. senão, se houver `VISITOR_COOKIE`, ler `variant_assignments` por
      `(test_id, visitor_id)` — consulta **somente leitura**, sem upsert;
   c. senão — incluindo o caso em que 3b existiu mas voltou `null`, e o caso em
      que o id encontrado aponta pra variante já removida — a variante com
      `is_control = true`; se nenhuma tiver, `variants[0]` (a lista já vem
      ordenada por nome).
4. `tracking_id`: apenas se havia `VISITOR_COOKIE` (casos 3a/3b). Buscar o
   `click_events.tracking_id` mais recente daquele `(test_id, visitor_id)`. Pode
   voltar `null` (ex.: acesso barrado pelo rate limit por IP).
   No caso 3c (visitante orgânico), pular a consulta — não há o que buscar.
5. Redirect 302 para `variants.destination_url` com `utm_content` acrescentado
   se o `tracking_id` existir.
6. **Não** setar cookies, **não** escrever no banco.

### Cookie `sameSite`

O clique no botão é uma navegação top-level GET vindo do domínio do cliente pro
domínio da ferramenta, então o cookie é enviado sob `SameSite=Lax`. Hoje
`src/app/r/[slug]/route.ts` seta os cookies sem `sameSite`, dependendo do
default do navegador. Como `/c/` depende disso pra funcionar, tornar explícito:
`sameSite: 'lax'` nos dois `response.cookies.set` do `/r/`. `httpOnly` e
`secure` permanecem.

Limitação conhecida, já existente hoje e não introduzida aqui: sob ITP do
Safari, com domínio custom via CNAME, a validade do cookie é encurtada. Afeta
apenas a stickiness entre sessões distantes no tempo; a janela entre o clique
no anúncio e o clique no botão é de minutos.

## Tratamento de erros e casos de borda

Princípio: **o botão de comprar nunca quebra**. Entre medir corretamente e
deixar a pessoa comprar, deixar comprar.

1. **Caminho normal** — variante do cookie, com tracking. Cliques repetidos
   levam ao mesmo checkout com o mesmo `tracking_id`.
2. **Visitante orgânico** (chegou à página sem passar pelo `/r/`) — vai para o
   checkout da variante de controle, **sem tracking**, e não entra no relatório
   de nenhuma variante. Decisão do usuário. Racional: o teste existe pra decidir
   verba de anúncio; sortear tráfego orgânico manda metade dele pro checkout
   possivelmente pior sem gerar dado comparável em troca.
3. **Teste pausado** — `/c/` continua funcionando normalmente. Pausar desliga a
   entrada de gente nova no experimento (`/r/`), e não pode derrubar o botão de
   comprar de uma página que está no ar.
4. **Teste apagado** — 404, sem invenção: a ferramenta não tem como saber o
   destino. Mitigação: `confirm-delete-button.tsx` mostra aviso explícito em
   testes de checkout ("apagar vai quebrar o botão de comprar da página de
   vendas até que ela seja atualizada"), exigindo confirmação. A alternativa de
   um campo "checkout padrão" foi avaliada e rejeitada pelo usuário: um campo a
   mais em toda criação de teste pra cobrir um caso que só ocorre ao apagar um
   teste no ar.
5. **Acesso barrado pelo rate limit por IP** — o `/r/` não grava o
   `click_events`, então não há `tracking_id`. O visitante vai para o checkout
   correto, sem `utm_content`; a venda não é atribuída. Correto: o acesso foi
   considerado suspeito.
6. **Variante removida durante o teste** — o id do cookie não corresponde a
   nenhuma variante; cai no controle (passo 3c).
7. **Teste de tipo `page` recebendo clique em `/c/`** — 404 (configuração
   errada). O bloco do go-link na UI só aparece em testes de checkout, o que
   torna esse caso improvável.
8. **Link de checkout com parâmetros próprios** — preservados. Usar
   `new URL(...)` + `searchParams.set('utm_content', ...)`, mesmo padrão do
   `/r/` atual.
9. **Bot clicando em `/c/`** — apenas redirecionado; nada é gravado, relatório
   não é afetado. Não é necessário rodar `isKnownBot` nesta rota.

## Mudanças em código existente

### `src/lib/domain/` (função pura nova)

Arquivo novo `test-destination.ts`, com teste ao lado (`test-destination.test.ts`):

- `resolveEntryDestination(test, variant): string` — devolve
  `sales_page_url` quando `test_type === 'checkout'`, senão
  `variant.destination_url`.
- `withTrackingId(url: string, trackingId: string | null): string` — acrescenta
  `utm_content` preservando query params existentes; devolve a URL intacta
  quando `trackingId` é `null`.

Ambas usadas por `/r/` e `/c/`, mantendo a montagem de URL num só lugar
testável sem banco.

### `src/lib/repo/redirect-repo.ts`

- `TestWithVariants` ganha `test_type` e `sales_page_url`; `VariantRow` ganha
  `is_control`. `getTestBySlug` seleciona os campos novos.
- `getAssignedVariantId(db, { testId, visitorId }): Promise<string | null>` —
  leitura pura de `variant_assignments` (o `getOrAssignVariant` existente
  escreve, e não serve para o `/c/`).
- `getLatestTrackingId(db, { testId, visitorId }): Promise<string | null>` —
  `click_events`, ordenado por `created_at desc`, limite 1.

### `src/app/r/[slug]/route.ts`

- Destino passa por `resolveEntryDestination` + `withTrackingId`.
- `sameSite: 'lax'` explícito nos dois cookies.
- Nenhuma outra alteração: bot filter, rate limit, sorteio e atribuição
  permanecem idênticos.

### Server actions

- `clients/[clientSlug]/actions.ts` (`createTest`): schema ganha
  `test_type: z.enum(['page','checkout'])` e
  `sales_page_url: httpUrl.optional().or(z.literal(''))`, com refinamento
  exigindo `sales_page_url` quando o tipo é `checkout`. Passa
  `p_test_type` e `p_sales_page_url` ao RPC.
- `tests/[testSlug]/actions.ts` (`updateTest`): schema ganha `sales_page_url`
  opcional; o update de `tests` passa a gravá-lo. **Nunca** escreve `test_type`.
  Antes de gravar, se o teste for `checkout` e o `sales_page_url` vier vazio,
  falhar com mensagem em português — senão quem esvazia o campo na edição recebe
  o erro cru da constraint `tests_checkout_requires_sales_page` do Postgres.

### UI

- `tests/new/page.tsx`: seletor "Tipo de teste"; campo "URL da página de vendas"
  visível apenas no modo checkout; rótulo do campo da variante alterna entre
  "URL de destino" e "Link do checkout", com placeholder de exemplo
  `https://pay.hub.la/...`. No modo página a tela fica idêntica à atual.
- `tests/[testSlug]/edit/`: mesmos rótulos condicionais; `test_type` exibido
  como texto não editável; `sales_page_url` editável.
- `tests/[testSlug]/page.tsx`: `select` do teste inclui `test_type`; bloco novo
  "Link do botão de comprar" (`https://{activeDomain}/c/{test.slug}`) com
  `CopyButton`, visível apenas no modo checkout, acompanhado da instrução de que
  todos os botões de compra da página recebem o mesmo endereço. Demais blocos e
  tabelas inalterados.
- `clients/[clientSlug]/page.tsx`: selo "Página"/"Checkout" por teste na lista.
- `confirm-delete-button.tsx`: aviso adicional em testes de checkout.

O bloco de pixel de thank-you page não muda: a identificação é pelo
`tracking_id` na URL, não pela variante, então ele continua funcionando mesmo
com todas as variantes compartilhando a mesma página de obrigado.

## Estratégia de testes

### Automatizados

- Unitário `test-destination.test.ts`: modo página devolve
  `variant.destination_url`; modo checkout devolve `sales_page_url`;
  `utm_content` acrescentado corretamente; query params pré-existentes do link
  preservados; `trackingId` nulo devolve a URL intacta.
- Rota `src/app/c/[slug]/route.test.ts`, cobrindo cada caso de borda listado
  acima: caminho normal, orgânico → controle sem tracking, teste pausado ainda
  redirecionando, teste inexistente → 404, teste de tipo `page` → 404,
  `tracking_id` ausente por rate limit, variante removida → controle.
- Rota `src/app/r/[slug]/route.test.ts`: caso novo de teste checkout
  redirecionando para a página de vendas; **os casos existentes do modo página
  permanecem intactos** e servem de guarda de regressão.
- Integração `redirect-repo.integration.test.ts`: `getAssignedVariantId` e
  `getLatestTrackingId` (incluindo o caso de múltiplos cliques do mesmo
  visitante, em que deve vir o mais recente).
- Integração: a trigger de imutabilidade rejeita `update` de `test_type` vindo
  de um owner autenticado.
- **A suíte existente inteira precisa passar verde** — é a garantia automática
  de que o modo página não regrediu.

### Verificação manual (obrigatória antes de tráfego pago)

Nenhum teste automatizado alcança a Hubla. Antes de qualquer campanha real:

1. Criar um teste de checkout de ensaio apontando pros checkouts reais.
2. Abrir o link do anúncio; confirmar a chegada na página de vendas; clicar em
   comprar; confirmar o checkout correto com `utm_content` na URL.
3. Repetir em janela anônima até ver os dois checkouts aparecendo (confirma o
   sorteio).
4. Abrir a página de vendas direto, sem passar pelo `/r/`; confirmar que o botão
   leva ao checkout de controle.
5. Fazer uma compra de teste real (valor baixo ou cupom de 100%) e confirmar que
   ela aparece no relatório, na variante certa. **Sem substituto**: é o único
   passo que prova a ponta final, do botão até a venda atribuída.

Ordem de subida recomendada: um cliente, um teste, campanha pequena primeiro.
