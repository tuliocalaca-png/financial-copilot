-- Financial Copilot — schema único alinhado ao backend (Fastify + supabase-js)
-- Rode uma vez em um projeto Supabase novo. Use SUPABASE_KEY = service_role no servidor
-- (a chave service_role ignora RLS; anon/authenticated ficam bloqueados sem políticas explícitas).

-- ---------------------------------------------------------------------------
-- Extensão para gen_random_uuid()
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1) users — colunas usadas pelo backend
--     getOrCreateUserByPhone: select id; eq phone_number; insert phone_number
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null,
  created_at timestamptz not null default now(),
  constraint users_phone_number_nonempty check (char_length(trim(phone_number)) > 0)
);

create unique index users_phone_number_key on public.users (phone_number);

comment on table public.users is 'Usuários identificados pelo número de telefone (WhatsApp).';
comment on column public.users.phone_number is 'Identificador estável do usuário; deve bater com o "to/from" da API WhatsApp.';

-- ---------------------------------------------------------------------------
-- 2) transactions — saveExpense + calculateDailyLimit
--     insert: user_id, amount, category, description
--     query: select amount; eq user_id; gte/lt created_at (mês corrente)
-- ---------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount numeric(14, 2) not null,
  category text not null,
  description text not null,
  created_at timestamptz not null default now(),
  constraint transactions_amount_positive check (amount > 0),
  constraint transactions_category_nonempty check (char_length(trim(category)) > 0),
  constraint transactions_description_nonempty check (char_length(trim(description)) > 0)
);

create index transactions_user_id_created_at_idx
  on public.transactions (user_id, created_at);

comment on table public.transactions is 'Despesas registradas pelo copiloto.';
comment on column public.transactions.amount is 'Valor sempre > 0; somado no cálculo do limite diário do mês.';

-- ---------------------------------------------------------------------------
-- 3) message_events — saveMessageEvent + rastreamento
--     insert: user_id, direction, message_text, intent (nullable)
-- ---------------------------------------------------------------------------
create table public.message_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  direction text not null,
  message_text text not null,
  intent text,
  created_at timestamptz not null default now(),
  constraint message_events_direction_check check (direction in ('inbound', 'outbound')),
  constraint message_events_message_text_nonempty check (char_length(trim(message_text)) > 0)
);

create index message_events_user_id_created_at_idx
  on public.message_events (user_id, created_at desc);

comment on table public.message_events is 'Log de mensagens entrada/saída e intenção detectada.';
comment on column public.message_events.intent is 'Valores esperados pelo app: expense, spending_query, report_settings, multi_expense_blocked, unknown ou null.';

-- ---------------------------------------------------------------------------
-- 4) user_report_settings — relatórios automáticos (WhatsApp)
-- ---------------------------------------------------------------------------
create table public.user_report_settings (
  user_id uuid primary key references public.users (id) on delete cascade,
  is_enabled boolean not null default false,
  frequencies text[] not null default '{}',
  time_of_day text not null default '09:00',
  timezone text not null default 'America/Sao_Paulo',
  include_categories boolean not null default false,
  last_run_daily date,
  last_run_weekly text,
  last_run_monthly text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_report_settings_time_format check (time_of_day ~ '^\d{2}:\d{2}$')
);

create index user_report_settings_enabled_idx
  on public.user_report_settings (is_enabled)
  where is_enabled = true;

comment on table public.user_report_settings is 'Agendamento de relatórios por WhatsApp (diário/semanal/mensal).';

-- ---------------------------------------------------------------------------
-- Row Level Security — backend com service_role não é afetado; expõe tabelas sem acesso público acidental.
-- ---------------------------------------------------------------------------
alter table public.users enable row level security;
alter table public.transactions enable row level security;
alter table public.message_events enable row level security;
alter table public.user_report_settings enable row level security;
