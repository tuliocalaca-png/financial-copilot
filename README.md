# Financial Copilot Backend

Backend em Node.js + TypeScript para um copiloto financeiro no **WhatsApp**.

## Stack

- Node.js 20+
- TypeScript, Fastify
- Supabase (Postgres)
- OpenAI (só para “vestir” fatos já calculados em linguagem natural)
- WhatsApp Cloud API
- Luxon (fusos e períodos em `America/Sao_Paulo`)

## O que esta versão faz

- **Registro de gasto** (um valor por mensagem; vários valores continuam bloqueados).
- **Consultas por período** com totais e quantidade de lançamentos vindos do banco; opcional **por categoria** (agregação real em `transactions.category`).
- **Relatórios automáticos** configuráveis (diário / semanal / mensal), horário, fuso e inclusão de categorias.
- **Agendamento**: `setInterval` de 1 minuto no processo + `POST /internal/cron/reports` para cron externo (Railway, GitHub Actions, etc.).
- **Sem inventar números**: a OpenAI recebe JSON com fatos; consultas vazias têm resposta determinística antes do modelo.

## Estrutura

```text
SRC/
  api/
    server.ts
    webhook.route.ts
    cron.route.ts
  core/
    config.ts
    types.ts
  db/
    supabase.ts
  integrations/
    whatsapp.client.ts
  services/
    daily-limit.service.ts      # legado (não usado nas respostas gerais do webhook)
    expense-parser.service.ts
    inbound-resolution.service.ts
    intent.service.ts
    openai.service.ts
    persistence.service.ts
    period-resolver.service.ts
    report-scheduler.service.ts
    report-settings.service.ts
    spending-query.service.ts
    transaction-helpers.ts
  index.ts
supabase/
  schema.sql
  migrations/002_user_report_settings.sql
```

## Pré-requisitos

- Projeto Supabase
- App WhatsApp Cloud API
- Chave OpenAI

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `OPENAI_API_KEY` | sim | |
| `SUPABASE_URL` | sim | |
| `SUPABASE_KEY` | sim | **service_role** no servidor |
| `WHATSAPP_TOKEN` | sim | |
| `WHATSAPP_PHONE_ID` | sim | |
| `PORT` | não | padrão `3000` |
| `CRON_SECRET` | não | se vazio, `POST /internal/cron/reports` responde **503** |

## SQL (Supabase)

1. **Projeto novo**: execute o arquivo [`supabase/schema.sql`](supabase/schema.sql) inteiro no SQL Editor.
2. **Projeto já existente** com o schema antigo: execute também a migração [`supabase/migrations/002_user_report_settings.sql`](supabase/migrations/002_user_report_settings.sql).

A tabela `user_report_settings` guarda:

- `user_id`, `is_enabled`, `frequencies` (`daily` \| `weekly` \| `monthly`), `time_of_day` (`HH:mm`), `timezone`, `include_categories`, `last_run_*`, `created_at`, `updated_at`.

## Instalação e execução

```bash
npm install
npm run dev
```

Healthcheck:

```bash
curl http://localhost:3000/health
```

Build / produção:

```bash
npm run build
npm start
```

## Endpoints

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/health` | Saúde |
| `GET` | `/webhook/whatsapp` | Verificação Meta |
| `POST` | `/webhook/whatsapp` | Mensagens |
| `POST` | `/internal/cron/reports` | Dispara envio de relatórios (header `x-cron-secret: <CRON_SECRET>` ou `Authorization: Bearer <CRON_SECRET>`) |

## Regras de negócio (resumo)

- **Fuso padrão** dos períodos na conversa: `America/Sao_Paulo`.
- **Semana** na conversa e no relatório semanal: **segunda → domingo** (semana civil com início na segunda).
- **Relatório diário** (agendado): gastos **do dia até o minuto do disparo** no fuso do usuário.
- **Relatório semanal** (agendado): só **segundas**; período = **semana anterior** completa.
- **Relatório mensal** (agendado): só **dia 1**; período = **mês civil anterior** completo.
- **Categorias em consultas**: só categorias que existem em transações de **despesa** no intervalo (entradas com categoria de receita são excluídas, como no serviço de limite legado).

## Como testar

### Webhook (JSON direto)

```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"5511999999999","messageText":"gastei 50 no uber"}'
```

### Consultas (com dados no banco)

- `quanto gastei hoje` / `ontem`
- `quanto gastei no dia 10 de março`
- `quanto gastei em março` / `no mês de março`
- `quanto gastei no mês atual` / `mês anterior`
- `quanto gastei na semana passada` / `esta semana até agora`
- `quanto gastei hoje por categoria`

### Relatórios (configuração)

- `quero relatório diário às 20h`
- `quero relatório semanal e mensal às 9h`
- `quero só semanal`
- `desative meus relatórios`
- `mude meu relatório para 19h`
- `quero relatório diário por categoria`

Confira a linha em `user_report_settings` no Supabase após cada comando.

### Cron manual

```bash
curl -X POST http://localhost:3000/internal/cron/reports \
  -H "x-cron-secret: SEU_CRON_SECRET"
```

### Railway

1. Defina `CRON_SECRET` nas variáveis do serviço.
2. Crie um **Cron Job** que chame `POST https://<seu-app>.railway.app/internal/cron/reports` com o header acima (ex.: a cada 1–5 minutos). O processo também roda o scheduler interno a cada 1 minuto; o endpoint serve para redundância e para ambientes que dormem (use o cron do provedor se o dyno for efêmero).

## Limitações explícitas

- O **resolver de período** cobre as formas descritas nos exemplos e variações comuns em PT-BR; frases muito ambíguas caem no **mês atual** quando há intenção clara de consulta (`quanto gastei` sem data explícita).
- Comandos de **relatório** são interpretados por regras determinísticas em português; frases fora do padrão podem cair na resposta genérica (sem inventar configuração).

## Scripts

- `npm run dev` — desenvolvimento com watch
- `npm run build` — compila para `dist/`
- `npm start` — executa `dist/SRC/index.js`
- `npm run typecheck` — checagem de tipos
