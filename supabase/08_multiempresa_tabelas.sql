-- ============================================================
--  ZAYTAN HUB — Multiempresa (1/6): tabelas base + helpers + RLS
--  Rode no SQL Editor. Parte da migração multiempresa: 08 → 09 → 10
--  (aditivos, seguros), depois publique o app novo, e só então 11 → 12 → 13.
--  Isolamento de dados: cada empresa só vê os próprios dados.
-- ============================================================

create extension if not exists "pgcrypto";

-- ─── Tabelas de tenancy ─────────────────────────────────────
create table if not exists public.empresas (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  criado_em timestamptz not null default now()
);

-- Marca quem é MASTER (vê/gerencia todas as empresas).
create table if not exists public.perfis (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  is_master boolean not null default false,
  criado_em timestamptz not null default now()
);

-- Liga usuários (logins) às empresas que podem acessar.
create table if not exists public.empresa_membros (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  criado_em  timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index if not exists empresa_membros_user_idx on public.empresa_membros(user_id);

-- ─── Helpers para RLS (SECURITY DEFINER = não recursivo) ─────
-- Rodam como owner, então leituras internas de perfis/empresa_membros
-- NÃO reaplicam a RLS dessas tabelas (evita "infinite recursion in policy").
create or replace function public.is_master()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.perfis p
    where p.user_id = auth.uid() and p.is_master
  );
$$;

create or replace function public.tem_acesso_empresa(empresa uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_master()
      or exists (
        select 1 from public.empresa_membros m
        where m.empresa_id = empresa and m.user_id = auth.uid()
      );
$$;

grant execute on function public.is_master() to authenticated;
grant execute on function public.tem_acesso_empresa(uuid) to authenticated;

-- ─── RLS das tabelas de tenancy ─────────────────────────────
alter table public.empresas        enable row level security;
alter table public.perfis          enable row level security;
alter table public.empresa_membros enable row level security;

-- empresas: usuário vê as que acessa; só master cria/edita/exclui.
drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas
  for select to authenticated using ( public.tem_acesso_empresa(id) );

drop policy if exists empresas_master_write on public.empresas;
create policy empresas_master_write on public.empresas
  for all to authenticated using ( public.is_master() ) with check ( public.is_master() );

-- perfis: cada um vê o próprio; master vê/edita todos.
drop policy if exists perfis_self_select on public.perfis;
create policy perfis_self_select on public.perfis
  for select to authenticated using ( user_id = auth.uid() or public.is_master() );

drop policy if exists perfis_master_write on public.perfis;
create policy perfis_master_write on public.perfis
  for all to authenticated using ( public.is_master() ) with check ( public.is_master() );

-- empresa_membros: cada um vê os próprios vínculos; master gerencia tudo.
drop policy if exists membros_select on public.empresa_membros;
create policy membros_select on public.empresa_membros
  for select to authenticated using ( user_id = auth.uid() or public.is_master() );

drop policy if exists membros_master_write on public.empresa_membros;
create policy membros_master_write on public.empresa_membros
  for all to authenticated using ( public.is_master() ) with check ( public.is_master() );
