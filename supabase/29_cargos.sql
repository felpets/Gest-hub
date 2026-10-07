-- ============================================================
--  ZAYTAN HUB — Cargos configuráveis (RBAC dinâmico)
--  Rode no SQL Editor DEPOIS do 28. Aditivo e idempotente.
--
--  Substitui os 3 papéis FIXOS por um catálogo de CARGOS editável:
--    - cargos             : os 3 de sistema (admin/operador/visualizador)
--                           + os que o master criar
--    - cargo_capacidades  : quais permissões cada cargo tem
--
--  Os 3 cargos de sistema são semeados com EXATAMENTE as permissões de
--  hoje → nada muda de comportamento ao migrar. O master edita/cria cargos
--  em Empresas › Cargos; a RLS passa a consultar a tabela (não mais listas
--  fixas). Leitura segue liberada a qualquer membro; os cargos controlam
--  o que a UI mostra e o que cada um pode GRAVAR.
--
--  Catálogo de capacidades (chaves estáveis):
--    ver_dashboard  · ver_relatorios · mov_gerir · contas_gerir
--    clientes_gerir · plano_gerir    · config_gerir
-- ============================================================

-- ─── 1) Tabelas de cargos ───────────────────────────────────
create table if not exists public.cargos (
  chave      text primary key,           -- 'admin' | 'operador' | 'visualizador' | 'c_<uuid>'
  nome       text not null,
  is_sistema boolean not null default false,
  ordem      int not null default 100,
  criado_em  timestamptz not null default now()
);

create table if not exists public.cargo_capacidades (
  cargo_chave text not null references public.cargos(chave) on delete cascade,
  capacidade  text not null,
  primary key (cargo_chave, capacidade)
);
create index if not exists cargo_capacidades_chave_idx on public.cargo_capacidades(cargo_chave);

-- ─── 2) Seed: os 3 de sistema com as permissões atuais ──────
insert into public.cargos (chave, nome, is_sistema, ordem) values
  ('admin',        'Administrador', true, 1),
  ('operador',     'Operador',      true, 2),
  ('visualizador', 'Visualizador',  true, 3)
on conflict (chave) do update set is_sistema = excluded.is_sistema;

-- admin: todas as capacidades
insert into public.cargo_capacidades (cargo_chave, capacidade)
select 'admin', c from unnest(array[
  'ver_dashboard','ver_relatorios','mov_gerir','contas_gerir',
  'clientes_gerir','plano_gerir','config_gerir'
]) c
on conflict do nothing;

-- operador: dia a dia (sem plano de contas nem configurações)
insert into public.cargo_capacidades (cargo_chave, capacidade)
select 'operador', c from unnest(array[
  'ver_dashboard','ver_relatorios','mov_gerir','contas_gerir','clientes_gerir'
]) c
on conflict do nothing;

-- visualizador: somente leitura
insert into public.cargo_capacidades (cargo_chave, capacidade)
select 'visualizador', c from unnest(array[
  'ver_dashboard','ver_relatorios'
]) c
on conflict do nothing;

-- ─── 3) empresa_membros.papel agora referencia cargos.chave ─
-- Troca o CHECK de 3 valores por uma FK ao catálogo (aceita cargos novos).
alter table public.empresa_membros drop constraint if exists empresa_membros_papel_chk;
alter table public.empresa_membros drop constraint if exists empresa_membros_papel_fk;
alter table public.empresa_membros
  add constraint empresa_membros_papel_fk
  foreign key (papel) references public.cargos(chave) on update cascade;

-- ─── 4) RLS das tabelas de cargos ───────────────────────────
-- Leitura p/ qualquer autenticado (a UI precisa das definições p/ montar
-- a navegação). Escrita só via RPCs SECURITY DEFINER (validam is_master).
alter table public.cargos            enable row level security;
alter table public.cargo_capacidades enable row level security;

drop policy if exists cargos_read on public.cargos;
create policy cargos_read on public.cargos
  for select to authenticated using ( true );

drop policy if exists cargo_capacidades_read on public.cargo_capacidades;
create policy cargo_capacidades_read on public.cargo_capacidades
  for select to authenticated using ( true );

-- ─── 5) Helper de capacidade (SECURITY DEFINER = não recursivo) ─
-- O usuário TEM a capacidade `cap` na empresa se o cargo dele a inclui
-- (o master sempre tem tudo).
create or replace function public.cargo_tem(empresa uuid, cap text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_master()
      or exists (
        select 1
        from public.empresa_membros m
        join public.cargo_capacidades cc on cc.cargo_chave = m.papel
        where m.empresa_id = empresa
          and m.user_id = auth.uid()
          and cc.capacidade = cap
      );
$$;

grant execute on function public.cargo_tem(uuid, text) to authenticated;

-- ─── 6) Policies de ESCRITA por capacidade ──────────────────
-- Substituem as _write da migração 28 (que usavam pode_gravar/pode_administrar).
-- SELECT continua como está (tem_acesso_empresa). Mapa tabela→capacidade
-- é estrutural (aqui); cargo→capacidade é dado (editável pelo master).
do $$
declare rec record;
begin
  for rec in
    select t, cap from (
      select unnest(array['movimentacoes','regras','planejamento_meses','planejamento_itens']) as t, 'mov_gerir'::text as cap
      union all select unnest(array['previstos','recorrentes']),            'contas_gerir'
      union all select unnest(array['clientes','cobrancas']),               'clientes_gerir'
      union all select unnest(array['plano_contas']),                       'plano_gerir'
      union all select unnest(array['configuracoes','contas_bancarias','feriados']), 'config_gerir'
    ) x
  loop
    execute format('drop policy if exists %I on public.%I;', rec.t || '_write', rec.t);
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using ( public.cargo_tem(empresa_id, %L) )
        with check ( public.cargo_tem(empresa_id, %L) );
    $f$, rec.t || '_write', rec.t, rec.cap, rec.cap);
  end loop;
end $$;

-- regras_categorizacao (regras GLOBAIS têm empresa_id null): escrita da
-- empresa exige 'mov_gerir'; o master segue gerenciando tudo via _master.
drop policy if exists regras_categorizacao_write on public.regras_categorizacao;
create policy regras_categorizacao_write on public.regras_categorizacao
  for all to authenticated
  using ( empresa_id is not null and public.cargo_tem(empresa_id, 'mov_gerir') )
  with check ( empresa_id is not null and public.cargo_tem(empresa_id, 'mov_gerir') );

-- ─── 7) RPCs de vínculo aceitam qualquer cargo do catálogo ──
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
  if not exists (select 1 from public.cargos where chave = p_papel) then
    raise exception 'Cargo invalido: %', p_papel;
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
  if not exists (select 1 from public.cargos where chave = p_papel) then
    raise exception 'Cargo invalido: %', p_papel;
  end if;
  update public.empresa_membros
    set papel = p_papel
    where empresa_id = p_empresa and user_id = p_user;
end $$;

-- ─── 8) RPCs de gestão de cargos (só master) ────────────────
-- Cria ou atualiza um cargo e substitui suas capacidades de uma vez.
-- Novo cargo (p_chave nulo/vazio) recebe uma chave interna única.
create or replace function public.salvar_cargo(
  p_chave text, p_nome text, p_caps text[]
)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_chave text;
  v_cap   text;
  v_valid text[] := array[
    'ver_dashboard','ver_relatorios','mov_gerir','contas_gerir',
    'clientes_gerir','plano_gerir','config_gerir'
  ];
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode gerenciar cargos';
  end if;
  if coalesce(btrim(p_nome), '') = '' then
    raise exception 'Informe o nome do cargo';
  end if;

  v_chave := nullif(btrim(p_chave), '');
  if v_chave is null then
    v_chave := 'c_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  end if;

  foreach v_cap in array coalesce(p_caps, '{}'::text[]) loop
    if not (v_cap = any(v_valid)) then
      raise exception 'Capacidade invalida: %', v_cap;
    end if;
  end loop;

  insert into public.cargos (chave, nome)
    values (v_chave, btrim(p_nome))
    on conflict (chave) do update set nome = excluded.nome;

  -- O admin é sempre todo-poderoso (trava de segurança).
  if v_chave = 'admin' then
    p_caps := v_valid;
  end if;

  delete from public.cargo_capacidades where cargo_chave = v_chave;
  insert into public.cargo_capacidades (cargo_chave, capacidade)
    select v_chave, distinct_cap
    from unnest(coalesce(p_caps, '{}'::text[])) as distinct_cap
    on conflict do nothing;

  return v_chave;
end $$;

-- Exclui um cargo personalizado (sistema não; em uso não).
create or replace function public.excluir_cargo(p_chave text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode excluir cargos';
  end if;
  if exists (select 1 from public.cargos where chave = p_chave and is_sistema) then
    raise exception 'Cargos de sistema nao podem ser excluidos';
  end if;
  if exists (select 1 from public.empresa_membros where papel = p_chave) then
    raise exception 'Cargo em uso por um ou mais membros. Troque o papel deles antes.';
  end if;
  delete from public.cargos where chave = p_chave;  -- cascade nas capacidades
end $$;

grant execute on function public.vincular_membro_por_email(uuid, text, text) to authenticated;
grant execute on function public.definir_papel_membro(uuid, uuid, text)      to authenticated;
grant execute on function public.salvar_cargo(text, text, text[])            to authenticated;
grant execute on function public.excluir_cargo(text)                         to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select c.chave, c.nome, array_agg(cc.capacidade order by cc.capacidade)
--     from public.cargos c
--     left join public.cargo_capacidades cc on cc.cargo_chave = c.chave
--    group by c.chave, c.nome order by c.ordem;
--   select public.cargo_tem('<empresa>', 'mov_gerir');
