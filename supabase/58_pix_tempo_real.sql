-- ============================================================
--  ZAYTAN HUB — Pix do dia em tempo real (avisos e lista viva)
--  Rode no SQL Editor DEPOIS do 57. Aditiva e idempotente.
--
--  O problema: dois pagadores abrem o Pix do dia ao mesmo tempo. Um lança um
--  pagamento novo, o outro só vê depois de recarregar a página — e pode pagar
--  duas vezes, ou marcar como pago algo que o colega acabou de estornar.
--
--  A correção não é nova tabela nem novo gatilho: é ligar o Realtime do
--  Supabase nas DUAS tabelas que a migração 39 já criou.
--
--    pagamentos_diarios             manda a lista de todo mundo se atualizar
--    pagamentos_diarios_historico   manda o AVISO ("quem fez o quê")
--
--  O histórico é a fonte do aviso porque é ele que sabe o autor (autor_email,
--  gravado pelo gatilho security definer) e a ação ('criado', 'pago',
--  'alterado', 'estornado', 'excluido'). A tela usa o autor para NÃO avisar
--  quem fez a ação — ninguém precisa de alarme do próprio clique.
--
--  Segurança: o Realtime do Supabase respeita o RLS. As policies da migração
--  39 exigem `cargo_tem(empresa_id, 'pag_diario_gerir')` para ler as duas
--  tabelas, então só quem já podia VER a lista recebe os eventos. Ninguém
--  ganha acesso novo aqui — chave Pix de terceiro continua fechada para quem
--  não tem a capacidade.
-- ============================================================

-- ─── 1) REPLICA IDENTITY ────────────────────────────────────
-- Por padrão o Postgres só publica a CHAVE da linha excluída. Sem o resto das
-- colunas, o Realtime não consegue avaliar o RLS nem o filtro por empresa num
-- DELETE — e o evento seria simplesmente descartado, deixando o pagamento
-- excluído na tela dos outros. Com FULL a linha antiga vem inteira.
-- A tabela é pequena (pagamentos de um dia), então o custo em WAL é irrelevante.
alter table public.pagamentos_diarios replica identity full;

-- O histórico é append-only (só INSERT, e o gatilho é o único que escreve):
-- o padrão já basta, e deixá-lo assim evita dobrar o WAL do log.

-- ─── 2) Publicação supabase_realtime ────────────────────────
-- `alter publication ... add table` dá erro se a tabela já estiver lá, por isso
-- a checagem antes: a migração pode ser rodada de novo sem quebrar.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'pagamentos_diarios'
  ) then
    alter publication supabase_realtime add table public.pagamentos_diarios;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'pagamentos_diarios_historico'
  ) then
    alter publication supabase_realtime add table public.pagamentos_diarios_historico;
  end if;
end $$;

-- ─── Conferência ────────────────────────────────────────────
-- As duas tabelas têm que aparecer aqui:
--   select schemaname, tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename like 'pagamentos_diarios%';
--
-- E o pagamentos_diarios tem que estar em 'f' (full):
--   select relname, relreplident from pg_class
--    where relname in ('pagamentos_diarios', 'pagamentos_diarios_historico');
--
-- No painel do Supabase: Database › Replication › supabase_realtime.
