-- ============================================================
--  ZAYTAN HUB — Registro de alterações de usuários e exclusão de login
--
--  1) usuarios_historico: tudo que muda num login — criação, nome/e-mail/senha,
--     acessos ao Financeiro, ao RH, administração e exclusão — com quem fez e
--     quando. Só aceita inclusão: ninguém altera nem apaga (nem o servidor).
--     Sem chave estrangeira: o registro sobrevive à exclusão do login.
--  2) Gatilhos nas tabelas de acesso registram as mudanças feitas pela tela.
--     O que o servidor faz (/api/usuarios: criar, alterar, excluir) ele mesmo
--     registra, com o autor certo.
--  3) Login excluído (exclusão "suave" do Supabase Auth) sai da lista de usuários.
--
--  Aditiva. Requer 42, 44 e 45.
-- ============================================================

-- ─── 1) Histórico ───────────────────────────────────────────
create table if not exists public.usuarios_historico (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  email       text,
  nome        text,
  acao        text not null check (acao in (
                'criado', 'alterado', 'acesso_financeiro', 'acesso_rh', 'administracao', 'excluido')),
  detalhes    jsonb not null default '{}'::jsonb,
  autor_id    uuid,
  autor_email text,
  ocorrido_em timestamptz not null default now()
);
create index if not exists usuarios_historico_ocorrido_idx on public.usuarios_historico (ocorrido_em desc);
create index if not exists usuarios_historico_user_idx on public.usuarios_historico (user_id);

alter table public.usuarios_historico enable row level security;
revoke all on public.usuarios_historico from anon, authenticated;
grant select on public.usuarios_historico to authenticated;

drop policy if exists usuarios_historico_ler on public.usuarios_historico;
create policy usuarios_historico_ler on public.usuarios_historico
  for select to authenticated
  using (public.is_master());

create or replace function public.tg_usuarios_historico_imutavel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'O registro de alterações de usuários não pode ser alterado nem apagado';
end $$;

drop trigger if exists usuarios_historico_imutavel on public.usuarios_historico;
create trigger usuarios_historico_imutavel
  before update or delete on public.usuarios_historico
  for each row execute function public.tg_usuarios_historico_imutavel();

-- Grava uma linha do histórico com o nome e o e-mail do momento.
create or replace function public.fn_log_usuario(
  p_user uuid, p_acao text, p_detalhes jsonb, p_autor uuid default auth.uid()
)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.usuarios_historico (user_id, email, nome, acao, detalhes, autor_id, autor_email)
  select p_user,
         (select u.email::text from auth.users u where u.id = p_user),
         (select p.nome from public.perfis p where p.user_id = p_user),
         p_acao,
         coalesce(p_detalhes, '{}'::jsonb),
         p_autor,
         (select u.email::text from auth.users u where u.id = p_autor);
$$;
revoke execute on function public.fn_log_usuario(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.fn_log_usuario(uuid, text, jsonb, uuid) to service_role;

-- ─── 2) Gatilhos das tabelas de acesso ──────────────────────
-- Só registram mudanças feitas por alguém logado (a tela). O servidor
-- (/api/usuarios) registra as dele, com o autor.
create or replace function public.tg_log_empresa_membros()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_empresa uuid := coalesce(new.empresa_id, old.empresa_id);
  v_antes   text := case when tg_op = 'INSERT' then null else old.papel end;
  v_depois  text := case when tg_op = 'DELETE' then null else new.papel end;
begin
  if auth.uid() is null or v_antes is not distinct from v_depois then
    return null;
  end if;
  perform public.fn_log_usuario(
    coalesce(new.user_id, old.user_id),
    'acesso_financeiro',
    jsonb_build_object(
      'empresaId', v_empresa,
      'empresa', (select e.nome from public.empresas e where e.id = v_empresa),
      'antes', (select c.nome from public.cargos c where c.chave = v_antes),
      'depois', (select c.nome from public.cargos c where c.chave = v_depois)
    )
  );
  return null;
end $$;

drop trigger if exists log_empresa_membros on public.empresa_membros;
create trigger log_empresa_membros
  after insert or update or delete on public.empresa_membros
  for each row execute function public.tg_log_empresa_membros();

create or replace function public.tg_log_rh_acessos()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_antes  jsonb := case when tg_op = 'INSERT' then null
                         else jsonb_build_object('perfil', old.perfil, 'empresas', old.empresas) end;
  v_depois jsonb := case when tg_op = 'DELETE' then null
                         else jsonb_build_object('perfil', new.perfil, 'empresas', new.empresas) end;
begin
  if auth.uid() is null or v_antes is not distinct from v_depois then
    return null;
  end if;
  perform public.fn_log_usuario(
    coalesce(new.user_id, old.user_id),
    'acesso_rh',
    jsonb_build_object('antes', v_antes, 'depois', v_depois)
  );
  return null;
end $$;

drop trigger if exists log_rh_acessos on public.rh_acessos;
create trigger log_rh_acessos
  after insert or update or delete on public.rh_acessos
  for each row execute function public.tg_log_rh_acessos();

create or replace function public.tg_log_perfis_master()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_antes  boolean := case when tg_op = 'INSERT' then false else coalesce(old.is_master, false) end;
  v_depois boolean := coalesce(new.is_master, false);
begin
  if auth.uid() is null or v_antes = v_depois then
    return null;
  end if;
  perform public.fn_log_usuario(new.user_id, 'administracao',
    jsonb_build_object('antes', v_antes, 'depois', v_depois));
  return null;
end $$;

drop trigger if exists log_perfis_master on public.perfis;
create trigger log_perfis_master
  after insert or update of is_master on public.perfis
  for each row execute function public.tg_log_perfis_master();

-- ─── 3) Login excluído sai da lista ─────────────────────────
-- Mesma função da migração 40, com o filtro de login excluído (deleted_at).
create or replace function public.listar_usuarios_gerenciaveis()
returns table (
  user_id      uuid,
  email        text,
  nome         text,
  is_master    boolean,
  criado_em    timestamptz,
  ultimo_login timestamptz,
  vinculos     jsonb
)
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  with minhas as (
    -- Empresas onde o CHAMADOR manda.
    select e.id
    from public.empresas e
    where public.is_master()
       or exists (
         select 1 from public.empresa_membros m
         where m.empresa_id = e.id and m.user_id = auth.uid() and m.papel = 'admin'
       )
  ),
  alvos as (
    select distinct m.user_id
    from public.empresa_membros m
    join minhas x on x.id = m.empresa_id
    union
    -- O master também enxerga quem ainda não foi vinculado a empresa nenhuma.
    select u.id from auth.users u where public.is_master()
  )
  select
    u.id,
    u.email::text,
    p.nome,
    coalesce(p.is_master, false),
    u.created_at,
    u.last_sign_in_at,
    coalesce((
      select jsonb_agg(
               jsonb_build_object('empresaId', em.empresa_id, 'empresa', e.nome, 'papel', em.papel)
               order by e.nome
             )
      from public.empresa_membros em
      join public.empresas e on e.id = em.empresa_id
      where em.user_id = u.id
        and (public.is_master() or em.empresa_id in (select id from minhas))
    ), '[]'::jsonb)
  from alvos a
  join auth.users u on u.id = a.user_id
  left join public.perfis p on p.user_id = u.id
  where u.deleted_at is null
    and (public.is_master() or not coalesce(p.is_master, false))
  order by coalesce(nullif(btrim(p.nome), ''), u.email::text);
$fn$;

grant execute on function public.listar_usuarios_gerenciaveis() to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select ocorrido_em, acao, email, detalhes, autor_email
--     from public.usuarios_historico order by ocorrido_em desc limit 20;
