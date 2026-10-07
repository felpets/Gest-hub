-- ============================================================
--  ZAYTAN HUB — Quem vê a Gestão (Dashboard)
--  Rode no SQL Editor DEPOIS do 53. Aditiva e idempotente. Requer 42 e 46.
--
--  Como estava: a Gestão abria para qualquer cargo com ver_dashboard ou
--  ver_relatorios — Operador e Visualizador inclusive.
--
--  Regra nova: a Gestão é do master e do cargo Administrador (na empresa
--  ativa). Fora isso, só quem for liberado pessoa a pessoa em Configurações ›
--  Usuários — o mesmo desenho do acesso ao RH (rh_acessos): uma linha aqui =
--  liberado, em todas as empresas em que a pessoa já tem acesso. A regra é
--  aplicada pelo app (lib/empresa: capacidade "gestao_acessar").
-- ============================================================

begin;

create table if not exists public.gestao_acessos (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  criado_em  timestamptz not null default now(),
  criado_por uuid default auth.uid()
);

comment on table public.gestao_acessos is
  'Pessoas liberadas para a Gestão sem ser Administrador. Master e cargo admin já veem.';

alter table public.gestao_acessos enable row level security;
revoke all on public.gestao_acessos from anon;
grant select, insert, delete on public.gestao_acessos to authenticated;

drop policy if exists gestao_acessos_ler on public.gestao_acessos;
create policy gestao_acessos_ler on public.gestao_acessos
  for select to authenticated
  using (user_id = auth.uid() or public.is_master());

drop policy if exists gestao_acessos_master on public.gestao_acessos;
create policy gestao_acessos_master on public.gestao_acessos
  for all to authenticated
  using (public.is_master())
  with check (public.is_master());

-- ─── Registro de alterações (migração 46) ───────────────────
alter table public.usuarios_historico drop constraint if exists usuarios_historico_acao_check;
alter table public.usuarios_historico add constraint usuarios_historico_acao_check check (acao in (
  'criado', 'alterado', 'acesso_financeiro', 'acesso_rh', 'acesso_gestao', 'administracao', 'excluido'));

create or replace function public.tg_log_gestao_acessos()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  perform public.fn_log_usuario(
    coalesce(new.user_id, old.user_id),
    'acesso_gestao',
    jsonb_build_object('antes', tg_op = 'DELETE', 'depois', tg_op = 'INSERT')
  );
  return null;
end $$;

drop trigger if exists log_gestao_acessos on public.gestao_acessos;
create trigger log_gestao_acessos
  after insert or delete on public.gestao_acessos
  for each row execute function public.tg_log_gestao_acessos();

commit;

-- ─── Conferência ────────────────────────────────────────────
--   select u.email from public.gestao_acessos g join auth.users u on u.id = g.user_id;
