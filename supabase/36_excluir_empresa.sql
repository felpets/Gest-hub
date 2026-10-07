-- ============================================================
--  ZAYTAN HUB — Excluir empresa inteira (com todos os dados)
--  Rode no SQL Editor. Idempotente (create or replace).
--
--  Usada pelo botão "Excluir" da aba Empresas (só master). Apaga TUDO da
--  empresa numa transação só: ou remove tudo, ou nada — sem meio-termo.
--  SECURITY DEFINER: roda como owner (as FKs 'restrict' para empresas
--  exigem apagar as tabelas filhas primeiro, na ordem certa).
--  Devolve um jsonb com a contagem apagada por tabela (vira o toast).
-- ============================================================

create or replace function public.fn_excluir_empresa(p_empresa uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nome  text;
  v       jsonb := '{}'::jsonb;
  n       bigint;
  n_plano bigint;
  total   bigint := 0;
begin
  if not public.is_master() then
    raise exception 'Apenas o administrador master pode excluir empresas.';
  end if;

  select nome into v_nome from public.empresas where id = p_empresa;
  if v_nome is null then
    raise exception 'Empresa não encontrada.';
  end if;

  -- Ordem respeita as FKs entre as tabelas (filhas antes das mães):
  -- cobrancas→clientes/movimentacoes; movimentacoes→contas_bancarias;
  -- regras_categorizacao/orcamentos→plano_contas; plano_contas→ela mesma.
  delete from public.cobrancas where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('cobrancas', n);

  delete from public.movimentacoes where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('movimentacoes', n);

  delete from public.previstos where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('previstos', n);

  delete from public.recorrentes where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('recorrentes', n);

  delete from public.regras where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('regras', n);

  delete from public.regras_categorizacao where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('regras_categorizacao', n);

  delete from public.orcamentos where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('orcamentos', n);

  delete from public.pagamentos_processos where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('pagamentos_processos', n);

  delete from public.planejamento_itens where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('planejamento_itens', n);

  delete from public.planejamento_meses where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('planejamento_meses', n);

  delete from public.clientes where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('clientes', n);

  delete from public.configuracoes where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('configuracoes', n);

  delete from public.feriados where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('feriados', n);

  delete from public.integracoes_inter where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('integracoes_inter', n);

  -- Plano de contas: filhas primeiro (FK parent_id é 'restrict')
  delete from public.plano_contas where empresa_id = p_empresa and parent_id is not null;
  get diagnostics n_plano = row_count;
  delete from public.plano_contas where empresa_id = p_empresa;
  get diagnostics n = row_count; n_plano := n_plano + n;
  total := total + n_plano; v := v || jsonb_build_object('plano_contas', n_plano);

  delete from public.contas_bancarias where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('contas_bancarias', n);

  delete from public.empresa_membros where empresa_id = p_empresa;
  get diagnostics n = row_count; total := total + n; v := v || jsonb_build_object('membros', n);

  delete from public.empresas where id = p_empresa;

  return v || jsonb_build_object('empresa', v_nome, 'total', total);
end $$;

grant execute on function public.fn_excluir_empresa(uuid) to authenticated;

-- Conferência (depois de excluir pela tela):
--   select nome from public.empresas order by nome;
