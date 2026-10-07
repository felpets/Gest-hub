-- ============================================================
--  ZAYTAN HUB — Por que o saldo do Dashboard não bate com o banco
--  Consulta de LEITURA (nenhum update). Rode no SQL Editor.
--
--  ATENÇÃO: o editor do Supabase mostra só o resultado da ÚLTIMA consulta
--  do arquivo. Por isso o diagnóstico principal é UMA consulta só (a de
--  baixo). Os detalhamentos vêm depois, comentados — para rodar um deles,
--  SELECIONE o bloco com o mouse e aperte Ctrl+Enter.
--
--  O Dashboard soma só movimentações 'confirmada'. O botão "Acertar saldo
--  pelo banco" soma TODAS (confirmadas + pendentes). Quando sobra gente na
--  tela Revisão, os dois discordam pelo valor exato das pendentes.
-- ============================================================

with mov as (
  select m.*,
         case when m.tipo = 'in' then m.valor else -m.valor end as delta
  from public.movimentacoes m
),
por_conta as (
  select
    c.id,
    e.nome as empresa,
    c.nome as conta,
    c.saldo_inicial,
    c.saldo_inicial_data,
    count(m.id) filter (where m.categoria_status = 'pendente')            as qtd_pendentes,
    coalesce(sum(m.delta) filter (where m.categoria_status = 'confirmada'), 0) as soma_confirmadas,
    coalesce(sum(m.delta) filter (where m.categoria_status = 'pendente'), 0)   as soma_pendentes
  from public.contas_bancarias c
  join public.empresas e on e.id = c.empresa_id
  left join mov m
         on m.conta_id = c.id
        and m.data >= c.saldo_inicial_data
  group by e.nome, c.id, c.nome, c.saldo_inicial, c.saldo_inicial_data
),
-- Mesma data + valor + tipo + descrição mais de uma vez na mesma conta.
dups as (
  select conta_id,
         sum(vezes - 1)         as linhas_duplicadas,
         sum((vezes - 1) * delta) as impacto_duplicatas
  from (
    select m.conta_id, m.data, m.descricao, m.tipo, m.valor,
           max(m.delta) as delta,
           count(*)     as vezes
    from mov m
    group by m.conta_id, m.data, m.descricao, m.tipo, m.valor
    having count(*) > 1
  ) x
  group by conta_id
)
select
  p.empresa,
  p.conta,
  p.saldo_inicial,
  p.saldo_inicial_data,
  -- (A) O que a tela mostra hoje:
  p.saldo_inicial + p.soma_confirmadas                     as saldo_no_dashboard,
  -- (B) O que mostraria se as pendentes contassem — compare com o banco:
  p.saldo_inicial + p.soma_confirmadas + p.soma_pendentes  as saldo_com_pendentes,
  p.qtd_pendentes,
  p.soma_pendentes,
  coalesce(d.linhas_duplicadas, 0)                         as linhas_duplicadas,
  coalesce(d.impacto_duplicatas, 0)                        as impacto_duplicatas
from por_conta p
left join dups d on d.conta_id = p.id
order by p.empresa, p.conta;

-- ─── Como ler o resultado ───────────────────────────────────
--   saldo_com_pendentes ≈ saldo do banco
--       → é só isso. As pendentes explicam a diferença inteira.
--   linhas_duplicadas > 0
--       → extrato importado duas vezes; "impacto_duplicatas" é o quanto
--         elas inflam o saldo. Detalhe no bloco 2 abaixo.
--   nenhum dos dois fecha
--       → o saldo_inicial está errado; compare com o extrato na
--         saldo_inicial_data.


-- ─── Bloco 2 · as pendentes, uma a uma ──────────────────────
-- Selecione daqui até o ; e aperte Ctrl+Enter.
--
-- select m.data, m.descricao, m.tipo, m.valor, c.nome as conta
-- from public.movimentacoes m
-- join public.contas_bancarias c on c.id = m.conta_id
-- where m.categoria_status = 'pendente'
-- order by m.data desc, m.valor desc;


-- ─── Bloco 3 · as duplicatas, uma a uma ─────────────────────
-- Algumas são reais (a mesma compra duas vezes no dia). O sinal de alerta é
-- o mesmo lançamento com fitid diferente — típico de importar o extrato em
-- dois formatos (OFX e depois CSV).
--
-- select m.data, m.descricao, m.tipo, m.valor,
--        count(*) as vezes,
--        array_agg(coalesce(m.fitid, '(sem fitid)') order by m.fitid) as fitids
-- from public.movimentacoes m
-- group by m.conta_id, m.data, m.descricao, m.tipo, m.valor
-- having count(*) > 1
-- order by m.data desc, m.valor desc;


-- ═══════════════════════════════════════════════════════════
--  Bloco 4 · O app está recebendo TODAS as movimentações?
--  (rode este bloco sozinho: selecione daqui até o ; final)
--
--  O app busca as movimentações ordenadas por data DESCENDENTE e sem
--  paginar. Se a API cortar o resultado num teto de linhas, ele fica com as
--  MAIS RECENTES e perde as antigas — e o saldo sobe, porque o que se perde
--  é sobretudo saída velha.
--
--  Se "saldo_se_o_app_so_viu_1000" bater com o valor da tela, é isto.
-- ═══════════════════════════════════════════════════════════
with base as (
  select m.data,
         case when m.tipo = 'in' then m.valor else -m.valor end as delta,
         row_number() over (order by m.data desc) as rn,
         c.saldo_inicial
  from public.movimentacoes m
  join public.contas_bancarias c on c.id = m.conta_id
  join public.empresas e on e.id = c.empresa_id
  where e.nome = 'Laportec'
    and c.nome = 'Conta principal'
    and m.categoria_status = 'confirmada'
    and m.data >= c.saldo_inicial_data
)
select
  count(*)                                                as total_confirmadas,
  min(saldo_inicial)                                      as saldo_inicial,
  coalesce(sum(delta), 0)                                 as soma_de_todas,
  min(saldo_inicial) + coalesce(sum(delta), 0)            as saldo_correto,
  coalesce(sum(delta) filter (where rn <= 1000), 0)       as soma_das_1000_recentes,
  min(saldo_inicial) + coalesce(sum(delta) filter (where rn <= 1000), 0)
                                                          as saldo_se_o_app_so_viu_1000,
  coalesce(sum(delta) filter (where rn > 1000), 0)        as soma_das_que_ficaram_de_fora,
  count(*) filter (where rn > 1000)                       as qtd_que_ficaram_de_fora
from base;
