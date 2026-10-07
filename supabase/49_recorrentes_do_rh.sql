-- ============================================================
--  ZAYTAN HUB — Recorrência com o valor vindo do RH
--  Rode no SQL Editor DEPOIS do 48. Aditiva e idempotente.
--
--  O Financeiro tem recorrências de Folha (Salários, Adiantamento, Vale
--  Transporte, Vale Refeição) criadas como LEMBRETE de vencimento, com valor
--  simbólico de R$ 1,00 — porque o valor de verdade mora no RH. Isto liga as
--  duas pontas: a recorrência passa a puxar o total do mês direto do cadastro
--  do RH, e ninguém redigita nada.
--
--  Regras espelhadas do RH (RHApp.jsx), para os números baterem com a tela de lá:
--    salarios     soma de salarioBase dos ATIVOS (bruto cadastrado)
--    folha_liquida  salarios - adiantamento: o que sai do banco no dia do
--                 pagamento, já que o adiantamento saiu no dia 20
--    adiantamento por pessoa: valor fixo, percentual próprio ou o % da empresa
--                 (mesma regra de valorAdiantamento / migração 48)
--    vt           por pessoa: valor do dia × diasUteis da configuração. O valor
--                 do dia é o campo valorDia OU a soma das conduções (qtd × valor).
--                 É o CUSTO CHEIO, sem abater os 6% do funcionário — o dinheiro
--                 sai inteiro do caixa (mesma definição de custoMensalFuncionario).
--    vr           por pessoa: vrDiario × dias do mês. Os dias seguem vrBaseDias:
--                 'uteis' (padrão), 'corridos' ou 'fixo' (vrDiasFixos). Quando a
--                 pessoa tem diasTrabalhados preenchido, vale o que está lá.
--
--  O que esta função NÃO faz: ratear VR por admissão/desligamento no meio do mês
--  (config vrProporcionalAdmissao). Se essa opção estiver ligada, o retorno vem
--  com vr_aproximado = true e a tela avisa, em vez de entregar um número errado
--  com cara de exato.
-- ============================================================

-- ─── 1) De onde vem o valor de uma recorrência ──────────────
alter table public.recorrentes
  add column if not exists fonte_rh text;

alter table public.recorrentes drop constraint if exists recorrentes_fonte_rh_chk;
alter table public.recorrentes
  add constraint recorrentes_fonte_rh_chk
  check (fonte_rh is null or fonte_rh in ('salarios', 'folha_liquida', 'adiantamento', 'vt', 'vr'));

comment on column public.recorrentes.fonte_rh is
  'null = valor fixo digitado. Senão, o valor de cada mês vem do RH (fn_rh_totais_mensais).';

-- ─── 2) Totais do RH por competência ────────────────────────
create or replace function public.fn_rh_totais_mensais(p_empresa uuid, p_de date, p_ate date)
returns table (
  competencia   text,
  salarios      numeric,
  adiantamento  numeric,
  vt            numeric,
  vr            numeric,
  pessoas       int,
  vr_aproximado boolean
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_nome     text;
  v_cfg      jsonb;
  v_pct      numeric;
  v_dias_ut  numeric;   -- diasUteis da configuração (usado no VT)
  v_vr_dia   numeric;
  v_vr_base  text;
  v_vr_fixos numeric;
  v_feriados text[];
  v_prop     boolean;
begin
  -- Mesma régua da migração 48: quem já vê o dinheiro da empresa.
  if not (public.is_master()
          or public.cargo_tem(p_empresa, 'ver_dashboard')
          or public.cargo_tem(p_empresa, 'contas_gerir')) then
    raise exception 'Sem permissão para ver os totais do RH desta empresa'
      using errcode = '42501';
  end if;

  select e.nome into v_nome from public.empresas e where e.id = p_empresa;
  if v_nome is null then
    return;
  end if;

  select c.data into v_cfg from public.rh_config c order by c.id limit 1;
  v_pct      := coalesce(nullif(v_cfg->>'percentualAdiant', '')::numeric, 40);
  v_dias_ut  := coalesce(nullif(v_cfg->>'diasUteis', '')::numeric, 22);
  v_vr_dia   := coalesce(nullif(v_cfg->>'vrDiario', '')::numeric, 0);
  v_vr_base  := coalesce(nullif(v_cfg->>'vrBaseDias', ''), 'uteis');
  v_vr_fixos := coalesce(nullif(v_cfg->>'vrDiasFixos', '')::numeric, 22);
  v_prop     := coalesce((v_cfg->>'vrProporcionalAdmissao')::boolean, false);
  -- Feriados do RH (config.feriados). Sem a lista, "dia útil" é só segunda a
  -- sexta — exatamente como a tela do RH conta hoje.
  select coalesce(array_agg(x), '{}') into v_feriados
    from jsonb_array_elements_text(coalesce(v_cfg->'feriados', '[]'::jsonb)) x;

  return query
  with comps as (
    select to_char(d, 'YYYY-MM') as comp, d::date as ini,
           (d + interval '1 month - 1 day')::date as fim
      from generate_series(date_trunc('month', p_de), date_trunc('month', p_ate), interval '1 month') d
  ),
  dias as (
    select c.comp,
           (c.fim - c.ini + 1)                                            as corridos,
           count(*) filter (
             where extract(isodow from g.d) < 6
               and not (to_char(g.d, 'YYYY-MM-DD') = any (v_feriados))
           )::numeric                                                     as uteis
      from comps c
      cross join lateral generate_series(c.ini, c.fim, interval '1 day') g(d)
     group by c.comp, c.ini, c.fim
  ),
  ativos as (
    select coalesce((f.data->>'salarioBase')::numeric, 0)                                   as salario,
           coalesce((f.data->'beneficios'->'adiantamento'->>'ativo')::boolean, false)       as adi_ativo,
           coalesce(nullif(f.data->'beneficios'->'adiantamento'->>'tipo', ''), 'padrao')    as adi_tipo,
           coalesce((f.data->'beneficios'->'adiantamento'->>'percentual')::numeric, 0)      as adi_pct,
           coalesce((f.data->'beneficios'->'adiantamento'->>'valorManual')::numeric, 0)     as adi_manual,
           coalesce((f.data->'beneficios'->'vt'->>'ativo')::boolean, false)                 as vt_ativo,
           coalesce(nullif(f.data->'beneficios'->'vt'->>'modo', ''), 'passagens')           as vt_modo,
           coalesce((f.data->'beneficios'->'vt'->>'valorDia')::numeric, 0)                  as vt_valor_dia,
           f.data->'beneficios'->'vt'->'conducoes'                                          as vt_conducoes,
           coalesce((f.data->'beneficios'->'vr'->>'ativo')::boolean, false)                 as vr_ativo,
           nullif(btrim(coalesce(f.data->'beneficios'->'vr'->>'diasTrabalhados', '')), '')  as vr_dias_pessoa
      from public.rh_funcionarios f
     where lower(coalesce(f.status, '')) = 'ativo'
       and public.rh_empresa_corresponde(v_nome, f.empresa)
  ),
  porPessoa as (
    select a.*,
           -- Valor do dia do VT: campo próprio ou a soma das conduções.
           case when not a.vt_ativo then 0
                when a.vt_modo = 'valorDia' then a.vt_valor_dia
                else coalesce((
                  select sum(coalesce((c.value->>'qtd')::numeric, 0) * coalesce((c.value->>'valor')::numeric, 0))
                    from jsonb_each(coalesce(a.vt_conducoes, '{}'::jsonb)) c
                ), 0)
           end as vt_dia
      from ativos a
  )
  select d.comp,
         round(coalesce(sum(p.salario), 0), 2),
         round(coalesce(sum(case
           when not p.adi_ativo             then 0
           when p.adi_tipo = 'valor'        then p.adi_manual
           when p.adi_tipo = 'personalizado' then p.salario * p.adi_pct / 100
           else p.salario * v_pct / 100
         end), 0), 2),
         round(coalesce(sum(p.vt_dia * v_dias_ut), 0), 2),
         round(coalesce(sum(case when not p.vr_ativo then 0 else
           coalesce(p.vr_dias_pessoa::numeric,
                    case v_vr_base when 'corridos' then d.corridos::numeric
                                   when 'fixo'     then v_vr_fixos
                                   else d.uteis end) * v_vr_dia
         end), 0), 2),
         count(p.*)::int,
         v_prop
    from dias d
    left join porPessoa p on true
   group by d.comp, d.corridos, d.uteis
   order by d.comp;
end $$;

revoke execute on function public.fn_rh_totais_mensais(uuid, date, date) from public, anon;
grant  execute on function public.fn_rh_totais_mensais(uuid, date, date) to authenticated;

-- ─── Conferência ────────────────────────────────────────────
--   select * from public.fn_rh_totais_mensais('<empresa_id>', date '2026-09-01', date '2026-11-30');
--   select id, descricao, valor, fonte_rh from public.recorrentes where fonte_rh is not null;
