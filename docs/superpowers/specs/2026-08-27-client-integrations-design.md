# Client Integrations (domain + Hubla) — Design

## Contexto e motivação

Hoje o link de redirecionamento de todo teste usa um único domínio global
(`NEXT_PUBLIC_REDIRECT_DOMAIN`) e o webhook da Hubla usa um único token global
(`HUBLA_WEBHOOK_TOKEN`). Isso não escala: cada cliente do usuário roda campanhas
com seu próprio domínio e sua própria conta Hubla. O usuário quer uma aba
"Integrações" por cliente onde ele mesmo cadastra o domínio daquele cliente e o
token de webhook da Hubla daquele cliente, sem precisar de uma variável de
ambiente global por integração.

**Quem opera:** um único usuário (dono da ferramenta) gerencia vários clientes
próprios — não é multi-tenant com login por cliente. "Cliente" continua sendo
uma linha de dados (`clients`), não uma conta separada.

**Escala esperada:** 1–2 clientes internos inicialmente. O desenho evita
construir automação cara (API da Vercel) que só se paga em escala maior — ver
"Fora de escopo" abaixo.

## Escopo

- Domínio de redirecionamento configurável **por cliente** (não por teste
  individual — todos os testes de um cliente compartilham o mesmo domínio).
- Token de webhook da Hubla configurável **por cliente**.
- Uma aba/página "Integrações" dentro de cada cliente no dashboard, com duas
  seções: Domínio e Hubla.
- Checagem de DNS: um botão "Verificar" que consulta publicamente (sem
  credencial nenhuma) se o CNAME do domínio já aponta para o alvo esperado, e
  atualiza `domain_status` de acordo.
- O link do teste (mostrado no relatório) passa a usar o domínio do cliente
  quando configurado e verificado; cai num domínio padrão (o da própria
  Vercel) quando o cliente ainda não configurou nada — testes continuam
  funcionando desde o primeiro dia, sem depender de domínio próprio.
- Webhook da Hubla passa a ser por cliente: `/api/webhooks/hubla/[clientSlug]`,
  validado contra o token daquele cliente específico.

## Fora de escopo (v1)

- **Registro automático do domínio no projeto da Vercel via API.** Isso exige
  guardar um token da API da Vercel no sistema — overkill para 1–2 clientes.
  Esse passo continua manual: o usuário avisa o operador (via chat) quando um
  cliente termina de configurar o DNS, e o operador roda `vercel domains add`
  uma vez. Documentar isso claramente na UI (ver "Tratamento de erros e casos
  de borda").
- Múltiplos domínios por cliente, ou domínio por teste individual.
- Múltiplas contas Hubla por cliente (um cliente = um token).
- Rotação automática de token, ou histórico de tokens antigos.
- Editar o slug de um cliente depois de criado (o slug já é imutável hoje;
  isso não muda).

## Modelo de dados

Migration nova (`0010_client_integrations.sql`), adicionando 3 colunas em
`clients`:

- `custom_domain text` — ex: `ir.gustavovoe.com`. Nulo até o cliente
  configurar.
- `domain_status text not null default 'unconfigured' check (domain_status in ('unconfigured','pending','verified'))`
  — `unconfigured`: sem domínio cadastrado. `pending`: domínio cadastrado, mas
  o CNAME ainda não foi encontrado na última checagem. `verified`: a última
  checagem encontrou o CNAME apontando corretamente (isso NÃO significa que o
  domínio já foi registrado no projeto da Vercel — ver nota acima).
- `hubla_webhook_token text` — nulo até o cliente colar o token dele.

Sem tabela nova. RLS existente em `clients` (`clients_owner_all`, `FOR ALL`)
já cobre essas colunas — nenhuma policy nova necessária.

## Fluxo de domínio

1. Na aba Integrações do cliente, campo de texto pro domínio + botão Salvar.
2. Ao salvar, grava `custom_domain` e reseta `domain_status` para `pending`.
3. A tela sempre mostra o CNAME que o cliente precisa criar no DNS dele:
   ```
   Tipo: CNAME
   Nome: ir (ou o subdomínio que ele escolheu)
   Valor: cname.vercel-dns.com
   ```
   (`cname.vercel-dns.com` é o alvo fixo da Vercel para qualquer subdomínio —
   não muda por cliente.)
4. Botão "Verificar" chama uma rota server-side que roda
   `dns.promises.resolveCname(custom_domain)` (biblioteca nativa do Node, sem
   nenhuma credencial externa) e checa se `cname.vercel-dns.com` está entre os
   resultados. Atualiza `domain_status` para `verified` ou mantém `pending` e
   mostra a mensagem correspondente.
5. Abaixo do botão, um aviso fixo (sempre visível quando `domain_status !=
   'unconfigured'`):
   > "Depois que o DNS estiver verificado, avise o responsável técnico para
   > finalizar o registro do domínio — esse último passo ainda é manual."

## Fluxo de conversão — Hubla por cliente

1. Na aba Integrações, campo de texto pro token da Hubla + botão Salvar, que
   grava em `hubla_webhook_token`.
2. A tela mostra o link pronto pra colar no painel da Hubla:
   `https://{redirect_domain}/api/webhooks/hubla/{client.slug}` (usa o
   `custom_domain` verificado do cliente se houver, senão o domínio padrão da
   Vercel — mesma lógica de fallback do link de teste).
3. **Rota do webhook muda** de `/api/webhooks/hubla/route.ts` (estática) para
   `/api/webhooks/hubla/[clientSlug]/route.ts` (dinâmica):
   - Busca o cliente pelo `clientSlug` da URL (service-role, já que é rota
     pública).
   - Se o cliente não existe ou não tem `hubla_webhook_token` configurado,
     responde 404 (não 401 — evita confirmar pra quem está sondando que o
     slug existe mas falta configurar).
   - Valida o header `x-hubla-token` contra o `hubla_webhook_token` **daquele
     cliente**, usando a mesma função `verifyHublaToken` já existente
     (comparação em tempo constante).
   - Resto do fluxo igual ao atual (parse do payload, busca do `click_event`
     por `tracking_id`, idempotência via `insertConversionIfNew`).
   - **Checagem extra de isolamento:** depois de achar o `click_event`, conferir
     que o teste dele pertence a ESTE cliente (join
     `click_events → tests → clients`, comparar `clients.id` com o cliente da
     URL). Se não bater, tratar como não encontrado (`{ok: true, attributed:
     false}`) — evita que um token vazado de um cliente confirme conversão
     em teste de outro cliente, mesmo sendo baixa probabilidade dado que
     `tracking_id` já é aleatório e único.
4. **Migração do webhook global existente**: a rota antiga
   `/api/webhooks/hubla` (sem slug) é removida nesta mudança. Isso é uma
   mudança visível para quem já tiver configurado o webhook antigo na Hubla —
   vai passar a receber 404 até reconfigurar com a nova URL por cliente. Como
   hoje ninguém tem um webhook real configurado em produção ainda (é a
   primeira vez que o app está no ar), o impacto prático é zero — mas registrar
   aqui para não surpreender depois.

## UI: aba "Integrações"

Nova página `src/app/dashboard/clients/[clientSlug]/integrations/page.tsx`,
com link a partir do cabeçalho da tela de lista de testes do cliente (ao lado
de "Novo teste"). Duas seções (Domínio, Hubla) empilhadas, seguindo os tokens
visuais já estabelecidos (cores, fontes, cards escuros) do resto do
dashboard.

## Mudanças em código existente

- `src/app/dashboard/clients/[clientSlug]/tests/[testSlug]/page.tsx`: a
  construção de `redirectUrl` passa a buscar `custom_domain`/`domain_status`
  do cliente (via join ou query separada) em vez de usar só
  `process.env.NEXT_PUBLIC_REDIRECT_DOMAIN` diretamente — usa o domínio do
  cliente apenas se `domain_status === 'verified'`, senão cai no padrão da
  Vercel.
- Mesma lógica de fallback é extraída para uma função pura testável (ex:
  `resolveRedirectDomain(client, defaultDomain)`), reaproveitada tanto no link
  do teste quanto no link do webhook mostrado na aba Integrações.
- `src/lib/repo/conversion-repo.ts`: `getClickEventByTrackingId` precisa
  retornar também o `client_id` (ou slug) dono do teste, para a checagem de
  isolamento do webhook.

## Tratamento de erros e casos de borda

- Domínio salvo mas nunca verificado → link do teste continua usando o
  domínio padrão da Vercel (nunca mostra um domínio "quebrado" pro cliente
  copiar).
- Verificação de DNS falha por timeout/erro de rede → tratar como "não
  verificado ainda", nunca deixar a checagem derrubar a página.
- Cliente apaga o token da Hubla depois de já ter configurado o webhook lá →
  próximas chamadas àquele endpoint passam a 404 (mesmo comportamento de
  "cliente sem token configurado").
- Dois clientes tentando usar o mesmo `custom_domain` → **fora de escopo
  agora** (sem constraint de unicidade); se acontecer na prática, o último a
  ter o domínio de fato registrado na Vercel "ganha" o tráfego — aceitável
  para 1–2 clientes internos, revisitar se crescer.

## Estratégia de testes

- Unitário: `resolveRedirectDomain` — retorna domínio do cliente só quando
  `verified`, senão o padrão.
- Unitário: verificação de DNS — função isolada que recebe o resultado de
  `resolveCname` e decide `verified`/`pending`, testável sem rede de verdade
  (a chamada real ao DNS fica numa camada fina não testada por unit test).
- Integração: rota `/api/webhooks/hubla/[clientSlug]` — token certo de um
  cliente não deve validar contra outro cliente; cliente sem token configurado
  → 404; isolamento entre clientes (conversão de um `tracking_id` de um
  cliente não é aceita pela rota de outro cliente).
- Integração: RLS — dono do cliente consegue ler/escrever `custom_domain` e
  `hubla_webhook_token` do próprio cliente; outro usuário não.
