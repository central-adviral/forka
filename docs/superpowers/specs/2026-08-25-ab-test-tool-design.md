# AB Test Tool — Design

## Contexto e motivação

Ferramenta para testes A/B/n de páginas de captura e vendas, com redirecionamento e
randomização de tráfego por percentual configurável entre versões — incluindo destinos
de checkout diferentes. Uso interno inicialmente (gestão de tráfego para múltiplos
clientes/nichos), com possibilidade de virar produto no futuro.

**Dores que motivam o projeto:**
- Falta de controle para testar versões que vivem em plataformas/domínios diferentes
  (o split nativo de cada funil não cobre isso).
- Falta de relatórios de conversão bons, cruzando dados de forma unificada.
- Necessidade de rotear tráfego para destinos de checkout diferentes (não só páginas).

**Quem constrói e opera:** a ferramenta é construída e implantada via Claude Code; o
usuário opera exclusivamente pelo dashboard, sem necessidade de tocar em código.

## Escopo

- Multi-cliente/projeto desde o início, com isolamento de dados entre eles.
- Testes A/B/n (2 ou mais variantes por teste), com peso percentual configurável por
  variante (soma deve ser 100%).
- Split por URL completa — cada variante aponta para uma URL de destino própria
  (página de captura, página de vendas, ou checkout).
- Persistência por visitante: o mesmo visitante recebe sempre a mesma variante em
  visitas subsequentes ao mesmo teste (cookie).
- Link de acesso via subdomínio próprio do usuário (ex: `ir.seudominio.com/slug`).
- Rastreio de conversão real (não só tráfego), com dois métodos configuráveis por
  teste:
  1. **Webhook Hubla** — para testes de venda, via evento `invoice.payment_succeeded`.
  2. **Thank-you page** — para testes de captura, via visita a uma URL de "obrigado"
     configurada por variante.
- Relatório por teste: visitas, conversões e taxa de conversão por variante.

**Fora de escopo (v1):**
- Significância estatística automática / declaração de vencedor automática.
- Segmentação de split por origem, dispositivo ou geo (só split aleatório ponderado +
  persistência).
- Integração com outras plataformas de checkout ou CRMs/e-mail marketing além de
  Hubla e do método genérico de thank-you page (extensível depois, sem
  reestruturação, adicionando um novo `source` de conversão).
- Multi-tenancy self-service (cadastro público, planos, cobrança) — hoje é o próprio
  usuário quem cria os clientes/projetos.

## Arquitetura

Aplicação única em **Next.js (App Router)**, hospedada na **Vercel**, com
**Supabase** como banco de dados (Postgres) e provedor de autenticação.

- **Domínio de redirecionamento**: subdomínio do usuário (ex: `ir.seudominio.com`)
  apontado via CNAME para a Vercel, roteando para a mesma aplicação.
- **Domínio do dashboard**: pode compartilhar o mesmo deploy (rota separada) ou usar
  outro subdomínio — sem custo de infraestrutura adicional.
- **Banco**: Supabase Postgres. Isolamento multi-cliente via Row Level Security (RLS),
  escopado por `client_id`.
- **Autenticação**: Supabase Auth (e-mail/senha) protegendo todas as rotas do
  dashboard. A rota de redirecionamento (`/r/[slug]`) e o endpoint de webhook são
  públicos por natureza.

Justificativa: um único código-fonte e um único deploy, stack madura e comum (fácil
de um dev contratado assumir no futuro), autenticação e RLS prontas via Supabase sem
precisar construir isolamento multi-tenant na mão.

## Modelo de dados

- **clients** — cliente/projeto do usuário (`id`, `name`, `slug`).
- **tests** — teste A/B/n (`id`, `client_id`, `name`, `slug` único, `status`
  ativo/pausado, `fallback_url`, `conversion_method`: `hubla_webhook` |
  `thank_you_page`).
- **variants** — variante de um teste (`id`, `test_id`, `name`, `weight_pct`,
  `destination_url`, `thank_you_url` opcional).
- **click_events** — registro de cada redirecionamento (`id`, `test_id`,
  `variant_id`, `visitor_id`, `tracking_id`, `source_utms` jsonb, `created_at`).
- **conversions** — registro de conversão (`id`, `click_event_id`, `source`
  (`hubla_webhook` | `thank_you_page`), `external_event_id` para idempotência,
  `value_cents` opcional, `created_at`).

Relações: 1 client → N tests → N variants; cada `click_event` referencia um
`variant`; cada `conversion` referencia um `click_event` via `tracking_id`
(join na criação, FK direta depois de resolvida).

Validação: soma de `weight_pct` das variantes de um teste deve ser 100%, checada na
criação/edição do teste.

## Fluxo de redirecionamento

1. Requisição chega em `/r/[slug]`.
2. Busca o `test` pelo slug e suas `variants` ativas. Se não encontrado ou teste
   pausado, redireciona para `fallback_url` (ou 404 simples se não configurada).
3. Verifica cookie de persistência (`ir_visitor_id` + mapa de atribuições por teste).
   Se já existe atribuição para este teste, reutiliza a mesma variante.
4. Caso contrário, sorteia uma variante respeitando os pesos configurados e grava a
   atribuição no cookie (validade configurável, ex: 30 dias).
5. Gera um `tracking_id` único, grava o `click_event` (variant, visitor_id, UTMs de
   origem capturados da querystring do anúncio).
6. Monta a URL de destino da variante, anexando o `tracking_id` no parâmetro
   `utm_content` da URL final.
7. Responde com redirect 302 para a URL montada.

## Fluxo de conversão — venda (Hubla)

1. Hubla envia webhook `invoice.payment_succeeded` para `/api/webhooks/hubla`.
2. Endpoint valida o header `x-hubla-token` contra o token configurado; se inválido,
   responde 401 e loga a tentativa.
3. Extrai `event.invoice.firstPaymentSession.utm.content` como `tracking_id`.
4. Busca o `click_event` correspondente. Se não encontrado, ignora (venda não
   atribuída a nenhum teste).
5. Verifica idempotência via `external_event_id` (ID da fatura/evento Hubla); se já
   existe uma conversion com esse ID, ignora silenciosamente.
6. Caso contrário, cria a `conversion` vinculada ao `click_event`, com
   `source = 'hubla_webhook'`.

## Fluxo de conversão — captura (thank-you page)

1. Cada variante de um teste com `conversion_method = 'thank_you_page'` tem uma
   `thank_you_url` configurada.
2. A aplicação expõe uma rota leve (`/ty/[slug]` ou script/pixel na própria thank-you
   page do usuário) que lê o `tracking_id` do cookie/param e registra a `conversion`
   com `source = 'thank_you_page'`.
3. Mesma lógica de idempotência aplicada (evita duplicar conversão em reload da
   página).

## Dashboard

- Login (Supabase Auth) → lista de clientes/projetos → lista de testes do projeto.
- Criar/editar teste: nome, slug, `fallback_url`, método de conversão, variantes
  (nome, peso %, URL de destino, URL de thank-you se aplicável), status.
- Relatório do teste: tabela por variante com visitas, conversões, taxa de
  conversão, destaque visual da variante líder.
- Link final pronto para copiar (`ir.seudominio.com/slug`).

## Tratamento de erros e casos de borda

- Slug inexistente ou teste pausado → `fallback_url` ou 404 simples.
- Soma de pesos ≠ 100% → bloqueado na validação do formulário.
- Webhook duplicado (reenvio da Hubla) → idempotência via `external_event_id`,
  ignorado silenciosamente.
- Webhook com `tracking_id` não reconhecido → ignorado, não gera erro.
- Assinatura de webhook inválida → 401, logado para auditoria.
- Cookie bloqueado/navegação anônima → sem persistência garantida nesse caso;
  limitação conhecida e aceita, sem complexidade extra para cobri-la.

## Estratégia de testes

- Unitário: sorteio ponderado respeita distribuição configurada ao longo de várias
  amostras.
- Unitário: persistência — mesmo visitante sempre recebe a mesma variante em
  requisições repetidas ao mesmo teste.
- Integração: rota `/r/[slug]` — URL final e `tracking_id` corretos dado um teste
  configurado.
- Integração: webhook Hubla — assinatura válida/inválida, tracking_id
  conhecido/desconhecido, evento duplicado (idempotência).
- Integração: thank-you page — registro de conversão e idempotência em reload.
- Segurança: isolamento entre clientes via RLS — cliente A não acessa dados do
  cliente B nem por query nem por manipulação de URL.
- Manual antes de ir ao ar: criar teste real, clicar no link, confirmar cookie,
  checkout e conversão aparecendo no relatório.

## Referências

- [Parâmetros de rastreamento (UTM) no checkout — Hubla](https://help.hub.la/hc/pt-br/parametros-de-rastreamento-no-checkout)
- [Boas práticas de webhook — Hubla](https://hubla.gitbook.io/docs/webhooks/boas-praticas)
- [Eventos de webhook — Hubla](https://hubla.gitbook.io/docs/webhooks/eventos)
