-- ============================================================
--  ZAYTAN HUB — Multiempresa (5/6): RLS por empresa
--  Rode DEPOIS do 11. Substitui a política permissiva ("acesso total
--  autenticados") por isolamento por empresa em TODAS as tabelas de dados.
--  A partir daqui, cada empresa só vê/grava os próprios dados; o master vê todas.
--  Idempotente.
-- ============================================================

do $$
declare t text;
begin
  foreach t in array array[
    'clientes','movimentacoes','previstos','regras',
    'plano_contas','recorrentes','planejamento_meses','planejamento_itens',
    'configuracoes'
  ] loop
    -- remove a política antiga permissiva e a nova (se reexecutando)
    execute format('drop policy if exists "acesso total autenticados" on public.%I;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_tenant', t);
    -- política por empresa: leitura e gravação só de quem tem acesso à empresa
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using ( public.tem_acesso_empresa(empresa_id) )
        with check ( public.tem_acesso_empresa(empresa_id) );
    $f$, t || '_tenant', t);
  end loop;
end $$;
