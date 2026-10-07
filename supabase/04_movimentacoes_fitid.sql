-- ============================================================
--  ZAYTAN HUB — FITID nas movimentações (deduplicação de OFX)
--  Rode no SQL Editor DEPOIS do schema.sql.
-- ============================================================

-- Identificador único da transação no banco (vem do <FITID> do OFX).
alter table public.movimentacoes add column if not exists fitid text;

-- Índice único PARCIAL: impede importar 2x o mesmo FITID,
-- mas permite vários nulos (CSV/Excel e lançamentos manuais não têm FITID).
create unique index if not exists movimentacoes_fitid_key
  on public.movimentacoes (fitid) where fitid is not null;
