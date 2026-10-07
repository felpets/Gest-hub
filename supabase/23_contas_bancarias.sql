-- ============================================================
--  ZAYTAN HUB — Contas bancárias por empresa (parte 1/2: ADITIVO)
--  Rode no SQL Editor DEPOIS do 22. ADITIVO e IDEMPOTENTE (pode reexecutar).
--  - Cria a tabela contas_bancarias (1..N por empresa; saldo inicial POR CONTA).
--  - Adiciona movimentacoes.conta_id (NULLABLE aqui) + índice.
--  - Backfill: cria uma "Conta principal" por empresa (carrega o saldo inicial
--    que hoje vive em configuracoes) e carimba todas as movs nela.
--  - criar_empresa() passa a semear a conta padrão.
--  O aperto final (conta_id NOT NULL + índice FITID por conta) fica no 24_*,
--  que só deve rodar DEPOIS de publicar o app novo (que envia conta_id).
-- ============================================================

-- ─── Tabela de contas bancárias ─────────────────────────────
create table if not exists public.contas_bancarias (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas(id) on delete restrict,
  nome               text not null,                 -- apelido exibido ("Itaú PJ")
  banco              text,                           -- rótulo livre / ORG do OFX
  bank_id            text,                           -- <BANKID>  (fingerprint OFX)
  acct_id            text,                           -- <ACCTID>  (fingerprint OFX)
  acct_type          text,                           -- <ACCTTYPE> CHECKING/SAVINGS...
  saldo_inicial      numeric(14,2) not null default 0,
  saldo_inicial_data date not null default current_date,
  ativo              boolean not null default true,  -- soft-delete
  ordem              integer not null default 0,     -- ordenação no seletor
  cor                text,                           -- opcional (badge/legenda)
  criado_em          timestamptz not null default now()
);
create index if not exists contas_bancarias_empresa_idx on public.contas_bancarias(empresa_id, ordem);

-- Fingerprint p/ auto-match do OFX (banco + número). Nulos = conta manual.
create unique index if not exists contas_bancarias_fingerprint_key
  on public.contas_bancarias (empresa_id, bank_id, acct_id)
  where bank_id is not null and acct_id is not null;

-- RLS por empresa (mesmo padrão de 12_policies.sql).
alter table public.contas_bancarias enable row level security;
drop policy if exists contas_bancarias_tenant on public.contas_bancarias;
create policy contas_bancarias_tenant on public.contas_bancarias
  for all to authenticated
  using ( public.tem_acesso_empresa(empresa_id) )
  with check ( public.tem_acesso_empresa(empresa_id) );

-- ─── movimentacoes.conta_id (NULLABLE nesta fase) ───────────
alter table public.movimentacoes
  add column if not exists conta_id uuid references public.contas_bancarias(id) on delete restrict;
create index if not exists movimentacoes_conta_idx on public.movimentacoes(empresa_id, conta_id, data);

-- ─── Backfill: 1 conta padrão por empresa + carimbo das movs ──
-- Idempotente: reusa a conta padrão pelo nome; só carimba movs com conta_id nulo.
do $$
declare r record; v_conta uuid;
begin
  for r in
    select e.id as empresa_id,
           coalesce(c.saldo_inicial, 0)                as saldo,
           coalesce(c.saldo_inicial_data, current_date) as saldo_data
    from public.empresas e
    left join public.configuracoes c on c.empresa_id = e.id
  loop
    select id into v_conta
      from public.contas_bancarias
      where empresa_id = r.empresa_id and nome = 'Conta principal'
      limit 1;

    if v_conta is null then
      insert into public.contas_bancarias (empresa_id, nome, banco, saldo_inicial, saldo_inicial_data, ordem)
      values (r.empresa_id, 'Conta principal', 'Conta PJ', r.saldo, r.saldo_data, 0)
      returning id into v_conta;
    end if;

    update public.movimentacoes
      set conta_id = v_conta
      where empresa_id = r.empresa_id and conta_id is null;
  end loop;
end $$;

-- ─── criar_empresa(): semeia a conta padrão nas empresas novas ──
create or replace function public.criar_empresa(p_nome text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_empresa uuid;
begin
  if not public.is_master() then
    raise exception 'Apenas o master pode criar empresas';
  end if;
  insert into public.empresas (nome) values (p_nome) returning id into v_empresa;
  insert into public.empresa_membros (empresa_id, user_id) values (v_empresa, auth.uid())
    on conflict do nothing;
  insert into public.configuracoes (empresa_id) values (v_empresa)
    on conflict (empresa_id) do nothing;  -- seed da config da empresa
  insert into public.contas_bancarias (empresa_id, nome, banco, ordem)
    values (v_empresa, 'Conta principal', 'Conta PJ', 0)
    on conflict do nothing;               -- seed da conta padrão
  return v_empresa;
end $$;

grant execute on function public.criar_empresa(text) to authenticated;

-- Conferência:
--   select empresa_id, count(*) from public.contas_bancarias group by 1;      -- 1 por empresa
--   select count(*) from public.movimentacoes where conta_id is null;         -- deve ser 0
--   select nome, saldo_inicial, saldo_inicial_data from public.contas_bancarias order by criado_em;
