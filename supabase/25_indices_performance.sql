-- ============================================================
--  ZAYTAN HUB — Índices de performance (aditivo, idempotente)
--  Rode no SQL Editor quando quiser. Não altera dados nem estrutura lógica.
-- ============================================================

-- Caminho de leitura principal de movimentacoes (a maior tabela):
--  - fetchMovimentacoes: filtra (empresa_id, categoria_status='confirmada') e
--    ordena por data desc (extrato/relatórios/saldo).
--  - fetchPendentes: filtra (empresa_id, categoria_status='pendente') e ordena
--    por data desc (tela de revisão).
-- Os índices atuais cobrem só o filtro; a ordenação vira um Sort explícito a
-- cada carga. Com `data` como 3ª coluna, o índice entrega as linhas já ordenadas.
create index if not exists movimentacoes_empresa_status_data_idx
  on public.movimentacoes (empresa_id, categoria_status, data desc);

-- Observação: movimentacoes_status_idx (empresa_id, categoria_status) passa a ser
-- prefixo deste índice (redundante). NÃO remover aqui — drop de índice não é
-- aditivo; fica como candidato a uma futura migração de limpeza, se desejado.
