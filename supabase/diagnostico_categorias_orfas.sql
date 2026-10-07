-- ============================================================
--  ZAYTAN HUB — Diagnóstico: lançamentos "(sem categoria)" nos relatórios
--  Rode no SQL Editor. SÓ LEITURA — não altera nada.
--
--  Contexto: a movimentação grava a categoria como TEXTO ("Pai / Filha").
--  Renomear/excluir uma categoria deixava os lançamentos antigos apontando
--  para o nome que não existe mais → caem em "(sem categoria)" (no Laportec,
--  R$ 176.995,36 = 23% das saídas). O app agora propaga renomeações; este
--  script lista o estrago antigo para decidirmos o remapeamento.
-- ============================================================

-- Os caminhos VÁLIDOS hoje são: nome da raiz ("Pai") e "Pai / Filha".
with caminhos as (
  select p.empresa_id,
         case when p.parent_id is null then p.nome
              else pai.nome || ' / ' || p.nome end as caminho
  from public.plano_contas p
  left join public.plano_contas pai on pai.id = p.parent_id
)
select
  e.nome                                   as empresa,
  coalesce(nullif(trim(m.categoria), ''), '(vazio)') as categoria_gravada,
  count(*)                                 as lancamentos,
  sum(m.valor) filter (where m.tipo = 'out') as total_saidas,
  sum(m.valor) filter (where m.tipo = 'in')  as total_entradas,
  min(m.data)                              as de,
  max(m.data)                              as ate
from public.movimentacoes m
join public.empresas e on e.id = m.empresa_id
where m.categoria_status = 'confirmada'
  and not exists (
    select 1 from caminhos c
    where c.empresa_id = m.empresa_id
      and c.caminho = trim(m.categoria)
  )
group by e.nome, coalesce(nullif(trim(m.categoria), ''), '(vazio)')
order by e.nome, total_saidas desc nulls last;

-- Como ler o resultado, por linha:
--   • O nome antigo ainda faz sentido? RECRIE a categoria com esse nome exato
--     na tela (Plano de Contas) — os lançamentos religam sozinhos. Depois, se
--     quiser outro nome, renomeie pela tela: agora a renomeação propaga.
--   • O nome deveria virar uma categoria que JÁ existe? Renomeie via SQL:
--       update public.movimentacoes
--       set categoria = 'Nome Novo / Filha Nova'   -- caminho EXATO do plano
--       where empresa_id = '<uuid da empresa>'
--         and trim(categoria) = 'Nome Antigo / Filha Antiga';
--   • "(vazio)" são lançamentos confirmados sem categoria — reclassifique na
--     tela de Movimentações (dá para filtrar e recategorizar em lote).
