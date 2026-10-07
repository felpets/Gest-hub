-- ============================================================
--  ZAYTAN HUB — Ajuste do saldo inicial (só master)
--  Rode no SQL Editor DEPOIS do 40. Aditivo e idempotente.
--
--  Um botão no Dashboard para o master encostar o saldo do app no saldo
--  real do banco quando sobra diferença — sem depender de importar um OFX
--  com LEDGERBAL, que é o único caminho existente hoje.
--
--  O ajuste mexe no saldo_inicial da conta, não cria lançamento. Isso é
--  escolha do usuário e tem consequência: nenhuma linha nova aparece no
--  extrato e a curva inteira do gráfico desloca. Por isso a função exige
--  MOTIVO e carimba quem/quando — sem rastro no extrato, o rastro precisa
--  existir em algum lugar, senão daqui a seis meses ninguém explica o
--  número.
--
--  Por que RPC e não um update direto: contas_bancarias aceita escrita de
--  quem tem 'config_gerir' (migração 29). "Só o master" checado apenas na
--  tela seria enfeite — aqui é o banco que recusa.
-- ============================================================

-- ─── 1) Carimbo do último ajuste ────────────────────────────
alter table public.contas_bancarias
  add column if not exists saldo_ajustado_em   timestamptz,
  add column if not exists saldo_ajustado_por  uuid,
  add column if not exists saldo_ajuste_motivo text;

-- ─── 2) A função ────────────────────────────────────────────
--  p_modo = 'saldo'  → p_valor é o SALDO REAL do banco em p_data. A função
--                      soma as movimentações até p_data e resolve o
--                      saldo_inicial que faz a conta fechar.
--  p_modo = 'ajuste' → p_valor é o DELTA aplicado direto no saldo_inicial
--                      (negativo abaixa o saldo). p_data é ignorada.
--
--  A soma conta só movimentações 'confirmada' — é o mesmo conjunto que o
--  Dashboard exibe. Contar as pendentes aqui faria a tela continuar sem
--  bater logo depois do ajuste. A tela avisa quando existem pendentes.
create or replace function public.fn_ajustar_saldo_inicial(
  p_conta  uuid,
  p_modo   text,
  p_valor  numeric,
  p_data   date,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_empresa   uuid;
  v_nome      text;
  v_antes     numeric;
  v_data_ini  date;
  v_soma      numeric;
  v_novo      numeric;
  v_primeira  date;
begin
  if not public.is_master() then
    raise exception 'Apenas o administrador master pode ajustar o saldo inicial.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do ajuste.';
  end if;
  if p_modo not in ('saldo', 'ajuste') then
    raise exception 'Modo invalido: % (use ''saldo'' ou ''ajuste'')', p_modo;
  end if;
  if p_valor is null then
    raise exception 'Informe o valor.';
  end if;

  select empresa_id, nome, saldo_inicial, saldo_inicial_data
    into v_empresa, v_nome, v_antes, v_data_ini
    from public.contas_bancarias
   where id = p_conta;

  if v_empresa is null then
    raise exception 'Conta bancaria nao encontrada.';
  end if;

  if p_modo = 'ajuste' then
    v_novo := round(v_antes + p_valor, 2);
  else
    if p_data is null then
      raise exception 'Informe a data do saldo do banco.';
    end if;

    select coalesce(sum(case when tipo = 'in' then valor else -valor end), 0),
           min(data)
      into v_soma, v_primeira
      from public.movimentacoes
     where conta_id = p_conta
       and empresa_id = v_empresa
       and categoria_status = 'confirmada'
       and data <= p_data;

    v_novo := round(p_valor - coalesce(v_soma, 0), 2);

    -- Ancora no dia anterior ao 1º lançamento, para o gráfico manter todo o
    -- histórico. Sem lançamento nenhum, ancora na própria data informada.
    v_data_ini := case when v_primeira is not null then v_primeira - 1 else p_data end;
  end if;

  update public.contas_bancarias
     set saldo_inicial       = v_novo,
         saldo_inicial_data  = v_data_ini,
         saldo_ajustado_em   = now(),
         saldo_ajustado_por  = auth.uid(),
         saldo_ajuste_motivo = btrim(p_motivo)
   where id = p_conta;

  return jsonb_build_object(
    'conta',              v_nome,
    'saldo_inicial_antes', v_antes,
    'saldo_inicial_depois', v_novo,
    'saldo_inicial_data',  v_data_ini,
    'diferenca',           round(v_novo - v_antes, 2)
  );
end $fn$;

grant execute on function public.fn_ajustar_saldo_inicial(uuid, text, numeric, date, text) to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select nome, saldo_inicial, saldo_inicial_data,
--          saldo_ajustado_em, saldo_ajuste_motivo
--     from public.contas_bancarias order by nome;
--   -- logado como não-master, a chamada abaixo tem que dar erro:
--   select public.fn_ajustar_saldo_inicial('<conta>', 'ajuste', -1, null, 'teste');
