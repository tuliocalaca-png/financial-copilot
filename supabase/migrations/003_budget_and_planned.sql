-- Migration 003: orçamento mensal + transações planejadas
-- Rode no SQL Editor do Supabase depois do schema base e da migration 002.
-- Sem RLS por ora (consistente com o restante do projeto).

-- ─── Orçamento mensal / limite diário ────────────────────────────────────────
create table if not exists public.user_budget_settings (
  user_id                uuid          not null references public.users (id) on delete cascade,
  monthly_budget         numeric(12,2) not null default 0,
  is_enabled             boolean       not null default false,
  is_daily_limit_enabled boolean       not null default false,
  daily_limit_mode       text          not null default 'auto'
                           constraint user_budget_settings_mode_check
                           check (daily_limit_mode in ('auto', 'manual')),
  manual_daily_limit     numeric(12,2)          null,
  created_at             timestamptz   not null default now(),
  updated_at             timestamptz   not null default now(),
  primary key (user_id)
);

comment on table public.user_budget_settings is
  'Orçamento mensal e configuração de limite diário por usuário.';

-- ─── Transações planejadas (a pagar / a receber) ─────────────────────────────
create table if not exists public.planned_transactions (
  id          uuid          not null default gen_random_uuid(),
  user_id     uuid          not null references public.users (id) on delete cascade,
  amount      numeric(12,2) not null,
  description text          not null default 'movimento futuro',
  category    text          not null default 'outros',
  type        text          not null
                constraint planned_transactions_type_check
                check (type in ('income', 'expense')),
  due_date    date          not null,
  status      text          not null default 'pending'
                constraint planned_transactions_status_check
                check (status in ('pending', 'done', 'cancelled')),
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),
  primary key (id)
);

create index if not exists idx_planned_transactions_user_due
  on public.planned_transactions (user_id, due_date);

create index if not exists idx_planned_transactions_user_status
  on public.planned_transactions (user_id, status);

comment on table public.planned_transactions is
  'Contas a pagar e a receber registradas pelo usuário via WhatsApp.';
