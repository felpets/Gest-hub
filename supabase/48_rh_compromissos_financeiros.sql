-- ============================================================
--  ZAYTAN HUB — O RH aparece no Financeiro (fonte única)
--  Rode no SQL Editor DEPOIS do 47. Aditiva e idempotente.
--
--  Problema que resolve: um pagamento nasce no RH (adiantamento, salário,
--  pagamento diário) e o Financeiro não enxergava — ou enxergava só o Pix do
--  dia (migração 43). Resultado: o mesmo dinheiro era lançado duas vezes, ou
--  simplesmente sumia da projeção de caixa.
--
--  Como resolve: uma função de LEITURA que devolve os compromissos do RH já no
--  vocabulário do Financeiro (data, valor, projetado/realizado). Nada é
--  copiado: o dado continua morando no RH e o Financeiro lê de lá. Quando o
--  RH marca como pago com o valor real, o Financeiro passa a ver o valor real
--  no mesmo lugar — sem ninguém redigitar.
--
--  De onde vem cada linha:
--    1. rh_pagamentos (Adiantamento/Salário) — o que o RH já lançou por
--       pessoa. status 'Realizado' → realizado; o resto → projetado.
--    2. rh_pagamentos_diarios — o pagamento diário do RH.
--    3. PROJEÇÃO, só quando (1) ainda não existe para a competência: salário
--       cadastrado × percentual de adiantamento (a mesma regra da tela do RH,
--       valorAdiantamento em RHApp.jsx). É o caso "amanhã tem o adiantamento
--       e a contabilidade ainda não fechou o valor".
--
--  Quem enxerga: a folha por pessoa (nome e valor) vai para quem já vê o
--  dinheiro da empresa inteira — dashboard ou contas a pagar. Foi a escolha de
--  quem administra. O cargo de Pagamentos Diários (só Pix) recebe apenas os
--  pagamentos diários, que ele já via. Chave Pix NÃO sai por aqui.
-- ============================================================

-- Texto do RH → date sem explodir quando o campo está vazio ou fora do padrão.
create or replace function public.rh_data(p_txt text)
returns date
language sql immutable
set search_path = public, pg_temp
as $$
  select case when p_txt ~ '^\d{4}-\d{2}-\d{2}' then left(btrim(p_txt), 10)::date end;
$$;

-- Dia do vale/da folha ajustado para o dia útil anterior, com os feriados da
-- empresa (fn_dia_util_anterior, migrações 26/32). Mesma ideia do dataValeComp
-- do RH: ninguém recebe DEPOIS por causa do calendário.
create or replace function public.rh_dia_util_ate(p_empresa uuid, p_ano int, p_mes int, p_dia int)
returns date
language sql stable
set search_path = public, pg_temp
as $$
  select public.fn_dia_util_anterior(
           p_empresa,
           make_date(p_ano, p_mes,
                     least(greatest(coalesce(p_dia, 1), 1),
                           extract(day from (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day'))::int))
         );
$$;

create or replace function public.fn_rh_compromissos_financeiros(p_empresa uuid, p_de date, p_ate date)
returns table (
  id             text,
  origem         text,      -- 'adiantamento' | 'salario' | 'diario'
  fonte          text,      -- 'rh_pagamentos' | 'rh_pagamentos_diarios' | 'projecao'
  pessoa         text,
  funcionario_id text,
  competencia    text,      -- 'YYYY-MM'
  data           date,      -- realizada quando existe; senão a prevista
  valor          numeric,
  status         text,      -- 'projetado' | 'realizado'
  descricao      text,
  empresa_rh     text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_nome      text;
  v_cfg       jsonb;
  v_pct       numeric;
  v_vale_dia  int;
  v_dia_folha int;
  v_folha     boolean;   -- pode ver salario/adiantamento por pessoa?
begin
  -- Quem ve o dinheiro da empresa inteira ve a folha por pessoa. O cargo de
  -- Pagamentos Diarios (so Pix) fica com os pagamentos diarios -- que ele ja ve
  -- por fn_rh_pagamentos_para_pix. Salario de terceiro nao e assunto dele.
  v_folha := public.is_master()
             or public.cargo_tem(p_empresa, 'ver_dashboard')
             or public.cargo_tem(p_empresa, 'contas_gerir');

  if not (v_folha or public.cargo_tem(p_empresa, 'pag_diario_gerir')) then
    raise exception 'Sem permissão para ver os compromissos do RH desta empresa'
      using errcode = '42501';
  end if;

  select e.nome into v_nome from public.empresas e where e.id = p_empresa;
  if v_nome is null then
    return;                              -- empresa inexistente: nada a mostrar
  end if;

  select c.data into v_cfg from public.rh_config c order by c.id limit 1;
  v_pct       := coalesce(nullif(v_cfg->>'percentualAdiant', '')::numeric, 40);
  v_vale_dia  := coalesce(nullif(v_cfg->>'valeDia', '')::int, 20);
  -- O salario e pago no ULTIMO dia do mes da competencia: e o que o RH grava
  -- em dataPrevista (31/07, 31/08, 30/09...). O 'diaPagamento' da configuracao
  -- do RH descreve outra coisa, entao nao serve de data aqui.
  v_dia_folha := 31;

  return query
  with
  -- ─── 1) O que o RH já lançou por pessoa ───────────────────
  lancados as (
    select p.id                                                        as id,
           case when p.tipo = 'Adiantamento' then 'adiantamento'
                else 'salario' end                                     as origem,
           p.competencia                                               as competencia,
           p.funcionario_id                                            as funcionario_id,
           coalesce(nullif(p.data->>'nome', ''), f.nome, '')            as pessoa,
           coalesce(public.rh_data(p.data->>'dataRealizada'),
                    public.rh_data(p.data->>'dataPagamento'),
                    public.rh_data(p.data->>'dataPrevista'))            as data,
           coalesce(p.valor, 0)                                        as valor,
           case when p.data->>'status' = 'Realizado'
                  or public.rh_data(p.data->>'dataPagamento') is not null
                then 'realizado' else 'projetado' end                  as status,
           p.empresa                                                   as empresa_rh
      from public.rh_pagamentos p
      left join public.rh_funcionarios f on f.id = p.funcionario_id
     -- 'Desconto Falta' não é saída de caixa: abate o salário, não sai do banco.
     where p.tipo in ('Adiantamento', 'Salário')
       and public.rh_empresa_corresponde(v_nome, p.empresa)
       and v_folha
  ),
  -- ─── 2) Competências que interessam ao período pedido ─────
  -- O salário de uma competência é pago no mês seguinte, então a janela começa
  -- um mês antes do período.
  comps as (
    select to_char(d, 'YYYY-MM') as competencia,
           extract(year from d)::int as ano,
           extract(month from d)::int as mes
      from generate_series(date_trunc('month', p_de) - interval '1 month',
                           date_trunc('month', p_ate), interval '1 month') d
  ),
  -- ─── 3) Projeção: só onde o RH ainda não lançou ───────────
  ativos as (
    select f.id, f.nome, f.empresa,
           coalesce((f.data->>'salarioBase')::numeric, 0)                       as salario,
           coalesce((f.data->'beneficios'->'adiantamento'->>'ativo')::boolean, false) as adi_ativo,
           coalesce(nullif(f.data->'beneficios'->'adiantamento'->>'tipo', ''), 'padrao') as adi_tipo,
           coalesce((f.data->'beneficios'->'adiantamento'->>'percentual')::numeric, 0)  as adi_pct,
           coalesce((f.data->'beneficios'->'adiantamento'->>'valorManual')::numeric, 0) as adi_manual
      from public.rh_funcionarios f
     where lower(coalesce(f.status, '')) = 'ativo'
       and public.rh_empresa_corresponde(v_nome, f.empresa)
       and v_folha
  ),
  projetados as (
    select a.id, a.nome, a.empresa, c.competencia, c.ano, c.mes,
           a.salario,
           -- Mesma regra da tela do RH (valorAdiantamento): valor fixo,
           -- percentual próprio ou o percentual da empresa.
           round(case
             when not a.adi_ativo        then 0
             when a.adi_tipo = 'valor'   then a.adi_manual
             when a.adi_tipo = 'personalizado' then a.salario * a.adi_pct / 100
             else a.salario * v_pct / 100
           end, 2) as adiantamento
      from ativos a
      cross join comps c
  )
  -- ─── Saída ────────────────────────────────────────────────
  select l.id, l.origem, 'rh_pagamentos'::text, l.pessoa, l.funcionario_id, l.competencia,
         l.data, l.valor, l.status,
         case when l.origem = 'adiantamento' then 'Adiantamento quinzenal (RH)'
              else 'Salário — folha (RH)' end,
         l.empresa_rh
    from lancados l
   where l.data between p_de and p_ate
     and l.valor <> 0

  union all

  select 'rhd-' || d.id, 'diario', 'rh_pagamentos_diarios',
         coalesce(nullif(d.pessoa, ''), d.data->>'pessoa', ''), null, to_char(d.data_pagamento, 'YYYY-MM'),
         d.data_pagamento, coalesce(d.valor, 0),
         case when lower(coalesce(d.data->>'pago', '')) in ('true', 't', '1', 'sim')
              then 'realizado' else 'projetado' end,
         coalesce(nullif(d.data->>'descricao', ''), 'Pagamento diário (RH)'),
         d.empresa
    from public.rh_pagamentos_diarios d
   where d.data_pagamento between p_de and p_ate
     and public.rh_empresa_corresponde(v_nome, d.empresa)

  union all

  -- Adiantamento projetado: só quando não existe lançamento do RH na competência.
  select 'proj-adi-' || p.id || '-' || p.competencia, 'adiantamento', 'projecao',
         coalesce(p.nome, ''), p.id, p.competencia,
         public.rh_dia_util_ate(p_empresa, p.ano, p.mes, v_vale_dia),
         p.adiantamento, 'projetado',
         'Adiantamento quinzenal (projeção do RH)', p.empresa
    from projetados p
   where p.adiantamento > 0
     and public.rh_dia_util_ate(p_empresa, p.ano, p.mes, v_vale_dia) between p_de and p_ate
     and not exists (
       select 1 from lancados l
        where l.funcionario_id = p.id and l.competencia = p.competencia and l.origem = 'adiantamento'
     )

  union all

  -- Salário projetado (líquido do repasse = salário − adiantamento), pago no
  -- último dia útil do mês da competência (é a data que o RH usa).
  select 'proj-sal-' || p.id || '-' || p.competencia, 'salario', 'projecao',
         coalesce(p.nome, ''), p.id, p.competencia,
         public.rh_dia_util_ate(p_empresa, p.ano, p.mes, v_dia_folha),
         round(p.salario - p.adiantamento, 2), 'projetado',
         'Salário — folha (projeção do RH)', p.empresa
    from projetados p
   where p.salario - p.adiantamento > 0
     and public.rh_dia_util_ate(p_empresa, p.ano, p.mes, v_dia_folha) between p_de and p_ate
     and not exists (
       select 1 from lancados l
        where l.funcionario_id = p.id and l.competencia = p.competencia and l.origem = 'salario'
     );
end $$;

revoke execute on function public.fn_rh_compromissos_financeiros(uuid, date, date) from public, anon;
grant  execute on function public.fn_rh_compromissos_financeiros(uuid, date, date) to authenticated;

-- As duas auxiliares não vazam nada sozinhas, mas não têm por que ficar
-- abertas para quem não entrou.
revoke execute on function public.rh_data(text) from public, anon;
revoke execute on function public.rh_dia_util_ate(uuid, int, int, int) from public, anon;
grant  execute on function public.rh_data(text) to authenticated;
grant  execute on function public.rh_dia_util_ate(uuid, int, int, int) to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select origem, fonte, status, count(*), sum(valor)
--     from public.fn_rh_compromissos_financeiros('<empresa_id>', date_trunc('month', current_date)::date,
--                                                (date_trunc('month', current_date) + interval '2 month - 1 day')::date)
--    group by 1,2,3 order by 1,2,3;
