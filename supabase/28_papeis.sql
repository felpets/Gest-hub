-- ============================================================
--  ZAYTAN HUB — Papéis (RBAC) por empresa
--  Rode no SQL Editor DEPOIS do 27. Aditivo e idempotente.
--
--  Cada vínculo login↔empresa ganha um PAPEL:
--    - admin        : acesso total (lança, importa, configura, gerencia)
--    - operador     : dia a dia (lança, importa, revisa, clientes) —
--                     NÃO mexe em Plano de Contas, Ajustes nem contas bancárias
--    - visualizador : SOMENTE LEITURA (dashboard, relatórios, fluxo)
--
--  O default do papel é 'admin' → ao rodar esta migração NINGUÉM perde
--  acesso; os membros atuais seguem com acesso total até você trocar o
--  papel deles em Empresas › Membros.
--
--  Enforcement em DOIS níveis: a UI esconde o que o papel não usa E a RLS
--  aqui recusa gravação indevida (mesmo via API). Leitura segue liberada
--  para qualquer membro da empresa — o Visualizador vê tudo, só não grava.
-- ============================================================

-- ─── 1) Coluna de papel no vínculo empresa↔usuário ──────────
alter table public.empresa_membros
  add column if not exists papel text not null default 'admin';

alter table public.empresa_membros drop constraint if exists empresa_membros_papel_chk;
alter table public.empresa_membros
  add constraint empresa_membros_papel_chk
  check (papel in ('admin', 'operador', 'visualizador'));

-- ─── 2) Helpers de papel (SECURITY DEFINER = não recursivos) ─
-- Rodam como owner: as leituras internas de empresa_membros/perfis NÃO
-- reaplicam a RLS dessas tabelas (evita "infinite recursion in policy").

-- Papel do usuário atual na empresa (o master é sempre 'admin').
create or replace function public.papel_na_empresa(empresa uuid)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when public.is_master() then 'admin'
    else (
      select m.papel
      from public.empresa_membros m
      where m.empresa_id = empresa and m.user_id = auth.uid()
      limit 1
    )
  end;
$$;

-- Pode GRAVAR dados operacionais? (admin ou operador; master sempre).
create or replace function public.pode_gravar_empresa(empresa uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_master()
      or exists (
        select 1 from public.empresa_membros m
        where m.empresa_id = empresa and m.user_id = auth.uid()
          and m.papel in ('admin', 'operador')
      );
$$;

-- Pode ADMINISTRAR? (só admin; master sempre). Config, plano de contas, acessos.
create or replace function public.pode_administrar_empresa(empresa uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_master()
      or exists (
        select 1 from public.empresa_membros m
        where m.empresa_id = empresa and m.user_id = auth.uid()
          and m.papel = 'admin'
      );
$$;

grant execute on function public.papel_na_empresa(uuid)        to authenticated;
grant execute on function public.pode_gravar_empresa(uuid)     to authenticated;
grant execute on function public.pode_administrar_empresa(uuid) to authenticated;

-- ─── 3) Reescrita das policies por papel ────────────────────
-- Padrão em cada tabela: SELECT p/ qualquer membro (tem_acesso_empresa) +
-- uma policy de escrita (for all) conforme o papel. Como policies
-- permissivas são OR'd, o SELECT continua valendo p/ todos; INSERT/UPDATE/
-- DELETE só passam se a policy de escrita permitir.

-- Grupo OPERACIONAL — admin + operador gravam; visualizador só lê.
do $$
declare t text;
begin
  foreach t in array array[
    'clientes', 'movimentacoes', 'previstos', 'regras',
    'recorrentes', 'planejamento_meses', 'planejamento_itens', 'cobrancas'
  ] loop
    execute format('drop policy if exists "acesso total autenticados" on public.%I;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_tenant', t);
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format('drop policy if exists %I on public.%I;', t || '_write', t);
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using ( public.tem_acesso_empresa(empresa_id) );
    $f$, t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using ( public.pode_gravar_empresa(empresa_id) )
        with check ( public.pode_gravar_empresa(empresa_id) );
    $f$, t || '_write', t);
  end loop;
end $$;

-- Grupo CONFIGURAÇÃO — só admin grava; operador e visualizador só leem.
do $$
declare t text;
begin
  foreach t in array array[
    'plano_contas', 'configuracoes', 'contas_bancarias', 'feriados'
  ] loop
    execute format('drop policy if exists "acesso total autenticados" on public.%I;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_tenant', t);
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format('drop policy if exists %I on public.%I;', t || '_write', t);
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using ( public.tem_acesso_empresa(empresa_id) );
    $f$, t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using ( public.pode_administrar_empresa(empresa_id) )
        with check ( public.pode_administrar_empresa(empresa_id) );
    $f$, t || '_write', t);
  end loop;
end $$;

-- regras_categorizacao é especial (regras GLOBAIS têm empresa_id null).
-- Leitura: globais + as da empresa. Gravação da empresa: admin/operador.
-- Master continua gerenciando tudo (inclusive globais) via a policy _master.
drop policy if exists regras_categorizacao_write on public.regras_categorizacao;
create policy regras_categorizacao_write on public.regras_categorizacao
  for all to authenticated
  using ( empresa_id is not null and public.pode_gravar_empresa(empresa_id) )
  with check ( empresa_id is not null and public.pode_gravar_empresa(empresa_id) );

-- ─── 4) RPCs de acesso: agora com papel ─────────────────────
-- (assinaturas mudam → dropamos as versões antigas antes de recriar)

drop function if exists public.listar_membros(uuid);
create or replace function public.listar_membros(p_empresa uuid)
returns table (user_id uuid, email text, is_master boolean, papel text)
language sql security definer
set search_path = public, pg_temp
as $$
  select m.user_id, u.email::text, coalesce(p.is_master, false), m.papel
  from public.empresa_membros m
  join auth.users u on u.id = m.user_id
  left join public.perfis p on p.user_id = m.user_id
  where m.empresa_id = p_empresa
    and public.is_master()      -- só master enxerga a lista
  order by u.email;
$$;

-- Vincula um login (por email) já com um papel. Revincular atualiza o papel.
drop function if exists public.vincular_membro_por_email(uuid, text);
create or replace function public.vincular_membro_por_email(
  p_empresa uuid, p_email text, p_papel text default 'operador'
)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid;
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode vincular membros';
  end if;
  if p_papel not in ('admin', 'operador', 'visualizador') then
    raise exception 'Papel invalido: %', p_papel;
  end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email) limit 1;
  if v_uid is null then
    raise exception 'Usuario % nao existe. Crie em Authentication > Users primeiro.', p_email;
  end if;
  insert into public.perfis (user_id) values (v_uid) on conflict (user_id) do nothing;
  insert into public.empresa_membros (empresa_id, user_id, papel)
    values (p_empresa, v_uid, p_papel)
    on conflict (empresa_id, user_id) do update set papel = excluded.papel;
  return v_uid;
end $$;

-- Troca o papel de um membro já vinculado.
create or replace function public.definir_papel_membro(
  p_empresa uuid, p_user uuid, p_papel text
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode definir papeis';
  end if;
  if p_papel not in ('admin', 'operador', 'visualizador') then
    raise exception 'Papel invalido: %', p_papel;
  end if;
  update public.empresa_membros
    set papel = p_papel
    where empresa_id = p_empresa and user_id = p_user;
end $$;

grant execute on function public.vincular_membro_por_email(uuid, text, text) to authenticated;
grant execute on function public.definir_papel_membro(uuid, uuid, text)      to authenticated;
grant execute on function public.listar_membros(uuid)                        to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select public.papel_na_empresa('<empresa>');           -- papel do usuário atual
--   select public.pode_gravar_empresa('<empresa>');        -- true p/ admin/operador
--   select user_id, papel from public.empresa_membros where empresa_id = '<empresa>';
