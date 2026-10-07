-- ============================================================
--  ZAYTAN HUB — Auto-categorização (2/3): sugerida vs confirmada
--  Rode no SQL Editor DEPOIS do 14. ADITIVO e SEGURO:
--  - `categoria` (já existente) continua sendo a categoria CONFIRMADA.
--  - `categoria_sugerida_id` é só o palpite da máquina (nunca conta sozinho).
--  - `categoria_status` default 'confirmada' => TODAS as linhas atuais
--    seguem contando normalmente em dashboard/relatórios/saldo.
--  Idempotente (add column if not exists).
-- ============================================================

-- Palpite da máquina (FK p/ plano de contas). on delete set null: se a
-- categoria sumir, a transação só perde a sugestão (não some).
alter table public.movimentacoes
  add column if not exists categoria_sugerida_id uuid
  references public.plano_contas(id) on delete set null;

-- Estado da categorização da linha:
--   'confirmada' = validada pelo usuário OU lançamento manual (conta nos relatórios).
--   'pendente'   = importada, aguardando revisão (NÃO conta em relatórios/saldo).
-- "sugerida" = pendente + categoria_sugerida_id preenchida.
-- Default 'confirmada' => linhas pré-existentes não são afetadas.
alter table public.movimentacoes
  add column if not exists categoria_status text not null default 'confirmada'
  check (categoria_status in ('pendente','confirmada'));

-- Agrupa as transações de um mesmo arquivo importado (1 lote = 1 upload),
-- para a tela de revisão focar exatamente o que acabou de entrar.
alter table public.movimentacoes
  add column if not exists lote_id uuid;

create index if not exists movimentacoes_status_idx on public.movimentacoes(empresa_id, categoria_status);
create index if not exists movimentacoes_lote_idx   on public.movimentacoes(empresa_id, lote_id);
