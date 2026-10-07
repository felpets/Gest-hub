-- ============================================================
--  ZAYTAN HUB — Multiempresa (4/6): chaves especiais + fitid + NOT NULL
--  Rode DEPOIS de publicar o APP NOVO (que envia empresa_id) e DEPOIS do 10.
--  ATENÇÃO: rode UMA ÚNICA VEZ (faz drop de PK/coluna). Os demais arquivos
--  são idempotentes, este não.
-- ============================================================

-- ── (opcional, antes de tudo) conferir órfãos do planejamento ──
-- Se retornar linhas, ajuste antes (a FK composta abaixo falharia):
-- select i.* from public.planejamento_itens i
--   left join public.planejamento_meses m
--     on m.empresa_id = i.empresa_id and m.ordem = i.mes_ordem
--   where m.ordem is null;

-- ── 1) configuracoes: de linha única (id boolean) para 1 por empresa ──
alter table public.configuracoes drop constraint if exists configuracoes_pkey;
alter table public.configuracoes drop column if exists id;            -- remove o boolean + o check(id)
alter table public.configuracoes alter column empresa_id set not null;
alter table public.configuracoes add primary key (empresa_id);        -- 1 linha por empresa

-- ── 2) planejamento_meses: PK composta (empresa_id, ordem) ──
alter table public.planejamento_meses alter column empresa_id set not null;
alter table public.planejamento_meses drop constraint if exists planejamento_meses_pkey;
alter table public.planejamento_meses add primary key (empresa_id, ordem);

-- ── 3) planejamento_itens: empresa_id NOT NULL + FK composta para o mês ──
alter table public.planejamento_itens alter column empresa_id set not null;
alter table public.planejamento_itens drop constraint if exists planejamento_itens_mes_fk;
alter table public.planejamento_itens
  add constraint planejamento_itens_mes_fk
  foreign key (empresa_id, mes_ordem)
  references public.planejamento_meses(empresa_id, ordem)
  on delete cascade;

-- ── 4) fitid único POR EMPRESA (não global) ──
-- FITID só é único dentro do banco de UMA empresa; o índice global causaria
-- falso "duplicado" e vazaria a existência de dados entre empresas.
drop index if exists public.movimentacoes_fitid_key;
create unique index if not exists movimentacoes_fitid_empresa_key
  on public.movimentacoes (empresa_id, fitid) where fitid is not null;

-- ── 5) NOT NULL nas demais tabelas ──
alter table public.clientes      alter column empresa_id set not null;
alter table public.movimentacoes alter column empresa_id set not null;
alter table public.previstos     alter column empresa_id set not null;
alter table public.regras        alter column empresa_id set not null;
alter table public.plano_contas  alter column empresa_id set not null;
alter table public.recorrentes   alter column empresa_id set not null;
