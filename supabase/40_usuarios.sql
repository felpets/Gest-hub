-- ============================================================
--  ZAYTAN HUB — Cadastro de usuários (aba Usuários)
--  Rode no SQL Editor DEPOIS do 39. Aditivo e idempotente.
--
--  Dá nome próprio aos logins e uma listagem que o ADMIN (não só o master)
--  consegue enxergar — hoje `listar_membros` é master-only.
--
--  O que esta migração NÃO faz: trocar e-mail e senha. Isso mora em
--  auth.users, que só a Admin API do Supabase mexe com segurança, então
--  acontece na função server-side /api/usuarios (pasta api/, service role).
--  Aqui fica só o que é seguro no Postgres: o nome e a leitura da lista.
--
--  Regra de quem vê quem (a MESMA que a função server-side aplica de novo,
--  por conta própria — a tela não é a guarda):
--    - master  : todos os logins, inclusive quem ainda não tem empresa.
--    - admin   : só quem é membro de uma empresa que ELE administra, e
--                nunca um master.
--    - o resto : ninguém.
-- ============================================================

-- ─── 1) Nome do usuário ─────────────────────────────────────
-- Fica em perfis (nosso), não no metadata do auth: assim entra em join e
-- ordenação sem depender do formato interno do Supabase.
alter table public.perfis
  add column if not exists nome text;

-- ─── 2) O chamador administra alguma empresa? ───────────────
-- Usada pela tela para decidir se mostra a aba. Master sempre pode.
create or replace function public.pode_gerir_usuarios()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select public.is_master()
      or exists (
        select 1 from public.empresa_membros m
        where m.user_id = auth.uid() and m.papel = 'admin'
      );
$fn$;

grant execute on function public.pode_gerir_usuarios() to authenticated;

-- ─── 3) Lista dos usuários que o chamador pode gerenciar ────
-- SECURITY DEFINER porque precisa ler auth.users e os perfis dos outros
-- (a RLS de perfis só deixa cada um ver o próprio).
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
    -- O master também enxerga quem ainda não foi vinculado a empresa nenhuma
    -- (login criado no painel do Supabase e esquecido, por exemplo).
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
        -- O admin não fica sabendo das outras empresas do usuário.
        and (public.is_master() or em.empresa_id in (select id from minhas))
    ), '[]'::jsonb)
  from alvos a
  join auth.users u on u.id = a.user_id
  left join public.perfis p on p.user_id = u.id
  -- Admin nenhum mexe no cadastro de um master.
  where public.is_master() or not coalesce(p.is_master, false)
  order by coalesce(nullif(btrim(p.nome), ''), u.email::text);
$fn$;

grant execute on function public.listar_usuarios_gerenciaveis() to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select public.pode_gerir_usuarios();
--   select user_id, email, nome, is_master, vinculos from public.listar_usuarios_gerenciaveis();
--   -- logado como admin de uma empresa só, a lista tem que trazer apenas os
--   -- membros dela e nenhum master.
