-- ============================================================
--  ZAYTAN HUB — Contas bancárias (parte 2/2: APERTO)
--  ⚠️  Rode UMA vez, e SÓ DEPOIS de publicar o app novo (que envia conta_id
--      em toda inserção de movimentação). Rodar antes quebraria os inserts
--      do app antigo (que ainda não manda conta_id).
--  - Garante conta_id em todas as movs (rede de segurança p/ o intervalo).
--  - Torna movimentacoes.conta_id NOT NULL.
--  - Move o índice único de FITID para (empresa_id, conta_id, fitid): o mesmo
--    FITID pode existir legitimamente em bancos/contas diferentes.
-- ============================================================

-- 1) Rede de segurança: carimba qualquer mov que tenha ficado sem conta
--    (ex.: inserida pelo app antigo entre o 23 e o deploy). Usa a 1ª conta
--    da empresa (a "Conta principal" do backfill).
do $$
declare r record; v_conta uuid;
begin
  for r in select distinct empresa_id from public.movimentacoes where conta_id is null loop
    select id into v_conta
      from public.contas_bancarias
      where empresa_id = r.empresa_id
      order by ordem, criado_em
      limit 1;
    if v_conta is not null then
      update public.movimentacoes set conta_id = v_conta
        where empresa_id = r.empresa_id and conta_id is null;
    end if;
  end loop;
end $$;

-- 2) conta_id obrigatório
alter table public.movimentacoes alter column conta_id set not null;

-- 3) FITID único POR CONTA (antes era por empresa)
drop index if exists public.movimentacoes_fitid_empresa_key;
create unique index if not exists movimentacoes_fitid_conta_key
  on public.movimentacoes (empresa_id, conta_id, fitid) where fitid is not null;

-- Conferência:
--   select count(*) from public.movimentacoes where conta_id is null;  -- 0
