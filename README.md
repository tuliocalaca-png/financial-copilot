# Financial Copilot Backend (MVP)

Backend em Node.js + TypeScript para um copiloto financeiro no WhatsApp.

## Stack

- Node.js
- TypeScript
- Fastify
- Supabase
- OpenAI
- WhatsApp Cloud API

## Features implementadas

- `POST /webhook/whatsapp` para receber mensagens
- Detecção de intenção:
  - `expense`
  - `daily_limit_query`
  - `unknown`
- Parser de despesa:
  - extração de valor
  - categorização simples por palavra-chave
- Persistência no Supabase:
  - `users`
  - `transactions`
  - `message_events`
- Cálculo de limite diário:
  - `monthly_budget = 3000`
  - `daily_limit = (monthly_budget - total_spent_month) / remaining_days`
- Geração de resposta com OpenAI (tom sem imposição, focado em consequências)
- Envio da resposta via WhatsApp Cloud API

## Estrutura

```text
SRC/
  api/
    server.ts
    webhook.route.ts
  core/
    config.ts
    types.ts
  db/
    supabase.ts
  integrations/
    whatsapp.client.ts
  services/
    daily-limit.service.ts
    expense-parser.service.ts
    intent.service.ts
    openai.service.ts
    persistence.service.ts
  index.ts
```

## Pré-requisitos

- Node.js 20+
- Projeto Supabase
- App configurado no WhatsApp Cloud API
- Chave da OpenAI

## Configuração

1. Copie o arquivo de ambiente:

```bash
cp .env.example .env
```

2. Preencha as variáveis:

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_ID`
- `PORT` (opcional, padrão 3000)

## Schema Supabase (SQL)

Fonte única: copie e execute o arquivo [`supabase/schema.sql`](supabase/schema.sql) inteiro no SQL Editor do Supabase (projeto novo, uma vez).

Use `SUPABASE_KEY` com a **service_role** no backend; com RLS ativo e sem políticas públicas, chaves `anon` não conseguem ler/escrever essas tabelas.

## Instalação e execução

```bash
npm install
npm run dev
```

Servidor sobe em `http://localhost:3000`.

Healthcheck:

```bash
curl http://localhost:3000/health
```

## Exemplo de webhook (payload direto)

```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "5511999999999",
    "messageText": "gastei 50 no uber"
  }'
```

Também existe suporte a um formato comum de payload do webhook oficial do WhatsApp Cloud.

## Comportamento esperado

- `"gastei 50 no uber"`:
  - identifica `expense`
  - extrai valor `50`
  - categoria provável `transporte`
  - salva em `transactions`
- `"quanto posso gastar hoje"`:
  - identifica `daily_limit_query`
  - calcula limite diário com base no gasto do mês
- sempre salva eventos de entrada e saída em `message_events`
- envia resposta final para o WhatsApp do usuário

## Scripts

- `npm run dev`: desenvolvimento com watch
- `npm run build`: compila TypeScript
- `npm run start`: executa build
- `npm run typecheck`: checagem de tipos
