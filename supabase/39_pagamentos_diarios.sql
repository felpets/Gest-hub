-- ============================================================
--  ZAYTAN HUB — Pagamentos Diários (lista de Pix do dia)
--  Rode no SQL Editor DEPOIS do 38. Aditivo e idempotente.
--
--  Lista operacional dos Pix a fazer no dia: chave, titular recebedor e
--  valor. É um controle À PARTE — NÃO gera movimentação nem mexe no saldo
--  das contas bancárias (o dinheiro sai no extrato, como sempre).
--
--  Três garantias que a tela SOZINHA não daria (por isso vivem aqui):
--    1) Pagamento marcado como PAGO nunca é excluído nem alterado. O banco
--       recusa o DELETE e o UPDATE dos campos financeiros — vale para
--       qualquer caminho (tela, API, SQL do próprio usuário).
--       Errou? Só o master ESTORNA (fn_estornar_pagamento_diario): a linha
--       continua lá, marcada, fora dos totais, com o motivo registrado.
--    2) Todo insert/alteração/exclusão vai para pagamentos_diarios_historico
--       com antes/depois, quem fez, quando e a COMPETÊNCIA (mês) — o
--       histórico mensal. Ninguém escreve nessa tabela: só o gatilho.
--    3) Capacidade PRÓPRIA: 'pag_diario_gerir'. Sem ela não se vê nem a
--       lista nem as chaves Pix. Vem com um cargo novo "Pagamentos
--       Diários", que tem essa capacidade e mais nenhuma.
-- ============================================================

-- ─── 1) Tabela dos pagamentos ───────────────────────────────
create table if not exists public.pagamentos_diarios (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  data           date not null default current_date,
  titular        text not null,
  chave_pix      text not null,
  tipo_chave     text not null default 'outro'
                   check (tipo_chave in ('cpf','cnpj','email','telefone','aleatoria','outro')),
  valor          numeric(14,2) not null check (valor > 0),
  descricao      text,
  pago           boolean not null default false,
  pago_em        timestamptz,
  pago_por       uuid,
  estornado      boolean not null default false,
  estornado_em   timestamptz,
  estorno_motivo text,
  criado_em      timestamptz not null default now(),
  criado_por     uuid default auth.uid(),
  atualizado_em  timestamptz not null default now()
);

create index if not exists pagamentos_diarios_empresa_data_idx
  on public.pagamentos_diarios (empresa_id, data desc);
create index if not exists pagamentos_diarios_abertos_idx
  on public.pagamentos_diarios (empresa_id, pago, data);

-- ─── 2) Histórico mensal (append-only, escrito só pelo gatilho) ─
-- Sem FK para pagamentos_diarios de propósito: o histórico de um pagamento
-- excluído tem que sobreviver ao pagamento.
create table if not exists public.pagamentos_diarios_historico (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  pagamento_id   uuid not null,
  competencia    text not null,                -- 'YYYY-MM' da DATA do pagamento
  acao           text not null
                   check (acao in ('criado','alterado','pago','estornado','excluido')),
  campos         text[] not null default '{}', -- o que mudou (só em 'alterado')
  dados_antes    jsonb,
  dados_depois   jsonb,
  -- Cópia dos campos-chave p/ a tela não precisar abrir o jsonb.
  titular        text,
  chave_pix      text,
  valor          numeric(14,2),
  autor_id       uuid,
  autor_email    text,
  ocorrido_em    timestamptz not null default now()
);

create index if not exists pag_diarios_hist_comp_idx
  on public.pagamentos_diarios_historico (empresa_id, competencia, ocorrido_em desc);
create index if not exists pag_diarios_hist_pagamento_idx
  on public.pagamentos_diarios_historico (pagamento_id);

-- ─── 3) Trava: pago não se apaga e não se altera ────────────
-- BEFORE INSERT/UPDATE/DELETE. Também carimba pago_em/pago_por e
-- atualizado_em, para a tela não ter que confiar no relógio do cliente.
--
-- Exceção única: quando a EMPRESA inteira está sendo excluída (migração 36),
-- a linha-mãe já sumiu quando o cascade chega aqui — aí a trava sai da
-- frente, senão não dava para excluir empresa nenhuma.
create or replace function public.fn_pagamentos_diarios_trava()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_empresa uuid := case when TG_OP = 'DELETE' then OLD.empresa_id else NEW.empresa_id end;
begin
  if not exists (select 1 from public.empresas where id = v_empresa) then
    return case when TG_OP = 'DELETE' then OLD else NEW end;   -- empresa sendo excluída
  end if;

  if TG_OP = 'DELETE' then
    if OLD.pago then
      raise exception 'Pagamento já marcado como PAGO não pode ser excluído (% — R$ %). Se foi engano, peça ao master para ESTORNAR.',
        OLD.titular, to_char(OLD.valor, 'FM999G999G990D00');
    end if;
    return OLD;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.pago then
      NEW.pago_em  := coalesce(NEW.pago_em, now());
      NEW.pago_por := coalesce(NEW.pago_por, auth.uid());
    end if;
    NEW.criado_por    := coalesce(NEW.criado_por, auth.uid());
    NEW.atualizado_em := now();
    return NEW;
  end if;

  -- UPDATE
  NEW.atualizado_em := now();

  if OLD.pago then
    if not NEW.pago then
      raise exception 'Um pagamento pago não volta para "em aberto". Se foi engano, peça ao master para ESTORNAR.';
    end if;
    if OLD.estornado and not NEW.estornado then
      raise exception 'Um estorno não pode ser desfeito.';
    end if;
    if NEW.data       is distinct from OLD.data
    or NEW.titular    is distinct from OLD.titular
    or NEW.chave_pix  is distinct from OLD.chave_pix
    or NEW.tipo_chave is distinct from OLD.tipo_chave
    or NEW.valor      is distinct from OLD.valor
    or NEW.pago_em    is distinct from OLD.pago_em
    or NEW.pago_por   is distinct from OLD.pago_por then
      raise exception 'Pagamento pago é imutável: data, titular, chave Pix e valor não mudam mais. Estorne e lance de novo.';
    end if;
  end if;

  if NEW.pago and not OLD.pago then
    NEW.pago_em  := coalesce(NEW.pago_em, now());
    NEW.pago_por := coalesce(NEW.pago_por, auth.uid());
  end if;

  return NEW;
end $fn$;

drop trigger if exists pagamentos_diarios_trava on public.pagamentos_diarios;
create trigger pagamentos_diarios_trava
  before insert or update or delete on public.pagamentos_diarios
  for each row execute function public.fn_pagamentos_diarios_trava();

-- ─── 4) Histórico: gatilho que registra tudo ────────────────
create or replace function public.fn_pagamentos_diarios_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_linha   public.pagamentos_diarios;
  v_antes   jsonb;
  v_depois  jsonb;
  v_acao    text;
  v_campos  text[] := '{}';
  v_email   text;
begin
  if TG_OP = 'INSERT' then
    v_linha := NEW; v_acao := 'criado'; v_depois := to_jsonb(NEW);
  elsif TG_OP = 'DELETE' then
    v_linha := OLD; v_acao := 'excluido'; v_antes := to_jsonb(OLD);
  else
    v_linha := NEW; v_antes := to_jsonb(OLD); v_depois := to_jsonb(NEW);
    select coalesce(array_agg(k order by k), '{}')
      into v_campos
      from jsonb_object_keys(v_depois) k
     where (v_antes -> k) is distinct from (v_depois -> k)
       and k <> 'atualizado_em';
    if cardinality(v_campos) = 0 then
      return null;                      -- update que não mudou nada: não polui
    end if;
    v_acao := case
      when not OLD.pago      and NEW.pago      then 'pago'
      when not OLD.estornado and NEW.estornado then 'estornado'
      else 'alterado'
    end;
  end if;

  -- Empresa sendo excluída (migração 36): o histórico vai junto no cascade,
  -- gravar agora só quebraria a FK.
  if not exists (select 1 from public.empresas where id = v_linha.empresa_id) then
    return null;
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();

  insert into public.pagamentos_diarios_historico (
    empresa_id, pagamento_id, competencia, acao, campos,
    dados_antes, dados_depois, titular, chave_pix, valor, autor_id, autor_email
  ) values (
    v_linha.empresa_id, v_linha.id, to_char(v_linha.data, 'YYYY-MM'), v_acao, v_campos,
    v_antes, v_depois, v_linha.titular, v_linha.chave_pix, v_linha.valor, auth.uid(), v_email
  );

  return null;                          -- AFTER trigger: retorno ignorado
end $fn$;

drop trigger if exists pagamentos_diarios_log on public.pagamentos_diarios;
create trigger pagamentos_diarios_log
  after insert or update or delete on public.pagamentos_diarios
  for each row execute function public.fn_pagamentos_diarios_log();

-- ─── 5) Estorno (só master, com motivo obrigatório) ─────────
-- A linha NÃO sai da tabela: ganha estornado = true, fica fora dos totais e
-- o gatilho registra o antes/depois no histórico.
create or replace function public.fn_estornar_pagamento_diario(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_empresa   uuid;
  v_pago      boolean;
  v_estornado boolean;
begin
  if not public.is_master() then
    raise exception 'Apenas o administrador master pode estornar um pagamento já pago.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do estorno.';
  end if;

  select empresa_id, pago, estornado
    into v_empresa, v_pago, v_estornado
    from public.pagamentos_diarios where id = p_id;

  if v_empresa is null then raise exception 'Pagamento não encontrado.'; end if;
  if not v_pago      then raise exception 'Só dá para estornar um pagamento marcado como pago.'; end if;
  if v_estornado     then raise exception 'Este pagamento já foi estornado.'; end if;

  update public.pagamentos_diarios
     set estornado = true, estornado_em = now(), estorno_motivo = btrim(p_motivo)
   where id = p_id;
end $fn$;

grant execute on function public.fn_estornar_pagamento_diario(uuid, text) to authenticated;

-- ─── 6) Capacidade e cargo próprios ─────────────────────────
insert into public.cargos (chave, nome, is_sistema, ordem)
values ('pagador', 'Pagamentos Diários', false, 4)
on conflict (chave) do nothing;

-- O cargo novo tem SÓ essa capacidade; o admin ganha junto (é todo-poderoso).
-- 'operador' fica de fora de propósito: quem paga é quem tem o cargo.
insert into public.cargo_capacidades (cargo_chave, capacidade)
values ('pagador', 'pag_diario_gerir'),
       ('admin',   'pag_diario_gerir')
on conflict do nothing;

-- ─── 7) salvar_cargo: catálogo de capacidades atualizado ────
-- A migração 38 criou 'vendas_gerir' mas não avisou esta função — salvar um
-- cargo com Vendas marcado dava "Capacidade invalida", e salvar o admin
-- apagava a capacidade dele. Aqui a lista volta a bater com o catálogo.
create or replace function public.salvar_cargo(
  p_chave text, p_nome text, p_caps text[]
)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  v_chave text;
  v_cap   text;
  v_valid text[] := array[
    'ver_dashboard','ver_relatorios','mov_gerir','contas_gerir',
    'clientes_gerir','plano_gerir','config_gerir','vendas_gerir',
    'pag_diario_gerir'
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
end $fn$;

grant execute on function public.salvar_cargo(text, text, text[]) to authenticated;

-- ─── 8) RLS ─────────────────────────────────────────────────
alter table public.pagamentos_diarios            enable row level security;
alter table public.pagamentos_diarios_historico  enable row level security;

-- Diferente do resto do app (onde a LEITURA é livre p/ qualquer membro):
-- aqui a lista tem chave Pix de terceiros, então ver também exige a
-- capacidade. É esse o ponto de ter uma classe de permissão só para isto.
drop policy if exists pagamentos_diarios_select on public.pagamentos_diarios;
create policy pagamentos_diarios_select on public.pagamentos_diarios
  for select to authenticated
  using ( public.cargo_tem(empresa_id, 'pag_diario_gerir') );

drop policy if exists pagamentos_diarios_write on public.pagamentos_diarios;
create policy pagamentos_diarios_write on public.pagamentos_diarios
  for all to authenticated
  using ( public.cargo_tem(empresa_id, 'pag_diario_gerir') )
  with check ( public.cargo_tem(empresa_id, 'pag_diario_gerir') );

-- Histórico: leitura para quem tem a capacidade. NÃO existe policy de
-- insert/update/delete — nem o dono do cargo escreve aqui. Só o gatilho
-- (security definer) grava, e ninguém edita nem apaga o que ele gravou.
drop policy if exists pag_diarios_hist_select on public.pagamentos_diarios_historico;
create policy pag_diarios_hist_select on public.pagamentos_diarios_historico
  for select to authenticated
  using ( public.cargo_tem(empresa_id, 'pag_diario_gerir') );

-- ─── 9) Excluir empresa (migração 36) ───────────────────────
-- As duas tabelas têm FK on delete cascade, e a trava/o log saem da frente
-- quando a empresa já não existe. Nada a mudar na fn_excluir_empresa.

-- ─── Conferência ────────────────────────────────────────────
--   select * from public.pagamentos_diarios where empresa_id = '<empresa>' order by data desc;
--   select acao, competencia, titular, valor, autor_email, ocorrido_em
--     from public.pagamentos_diarios_historico
--    where empresa_id = '<empresa>' order by ocorrido_em desc limit 20;
--   -- a trava funcionando (as duas devem dar erro):
--   --   delete from public.pagamentos_diarios where pago;
--   --   update public.pagamentos_diarios set valor = 1 where pago;
--   select c.chave, c.nome, array_agg(cc.capacidade order by cc.capacidade)
--     from public.cargos c left join public.cargo_capacidades cc on cc.cargo_chave = c.chave
--    group by c.chave, c.nome order by c.ordem;
