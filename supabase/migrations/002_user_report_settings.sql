-- Preferências de relatórios automáticos (uma linha por usuário).
-- Rode no SQL Editor do Supabase após schema base, ou use como referência incremental.

create table if not exists public.user_report_settings (
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

create index if not exists user_report_settings_enabled_idx
  on public.user_report_settings (is_enabled)
  where is_enabled = true;

comment on table public.user_report_settings is 'Agendamento de relatórios por WhatsApp (diário/semanal/mensal).';

alter table public.user_report_settings enable row level security;
