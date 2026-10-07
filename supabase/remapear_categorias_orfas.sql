-- ============================================================
--  ZAYTAN HUB — Remapeia lançamentos órfãos para as categorias atuais
--  Baseado no diagnóstico de 24/08/2026. Rode no SQL Editor.
--
--  REVISE antes de rodar: cada UPDATE diz de onde → para onde e quanto.
--  Os certos estão ativos; os que dependem de decisão estão COMENTADOS
--  no fim. Pode rodar mais de uma vez sem risco (depois do primeiro
--  remapeamento, não sobra linha com o texto antigo).
--
--  O match ignora espaços duplicados/bordas (regexp) — os textos antigos
--  têm variação de espaçamento. O destino precisa ser o caminho EXATO do
--  plano atual ("Pai / Filha").
-- ============================================================

-- Função de apoio inline: normaliza espaços para casar o texto antigo.
--   regexp_replace(trim(categoria), '\s+', ' ', 'g')

-- ── LAPORTEC ────────────────────────────────────────────────
-- (pega o id pela tabela de empresas para não depender de uuid colado à mão)

-- 1) Grupo "Cartão" virou "Despesas Bancarias"
--    Cartão / Taxa Crédito (4 lanç, R$ 12.191,28) → Despesas Bancarias / Taxas
update public.movimentacoes m
set categoria = 'Despesas Bancarias / Taxas'
from public.empresas e
where e.id = m.empresa_id and e.nome = 'Laportec'
  and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Cartão / Taxa Crédito';

--    Cartão / Despesas Bancarias (15 lanç, R$ 23.477,49) → Despesas Bancarias / Taxas
update public.movimentacoes m
set categoria = 'Despesas Bancarias / Taxas'
from public.empresas e
where e.id = m.empresa_id and e.nome = 'Laportec'
  and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Cartão / Despesas Bancarias';

--    Cartão (direto na raiz, 2 lanç, R$ 2.345,49) → Despesas Bancarias
update public.movimentacoes m
set categoria = 'Despesas Bancarias'
from public.empresas e
where e.id = m.empresa_id and e.nome = 'Laportec'
  and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Cartão';

-- 2) Alugueis por imóvel viraram um "Aluguel" só
--    (se preferir manter a separação por imóvel, NÃO rode estes dois:
--     recrie "Aluguel 1001/1002" e "Aluguel 913" como filhas de Pagamentos
--     Fixos na tela — os lançamentos religam sozinhos pelo nome antigo)
--    Aluguel 1001/1002 (2 lanç, R$ 14.077,79) → Pagamentos Fixos / Aluguel
update public.movimentacoes m
set categoria = 'Pagamentos Fixos / Aluguel'
from public.empresas e
where e.id = m.empresa_id and e.nome = 'Laportec'
  and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Pagamentos Fixos / Aluguel 1001/1002';

--    Aluguel 913 (3 lanç, R$ 6.133,11) → Pagamentos Fixos / Aluguel
update public.movimentacoes m
set categoria = 'Pagamentos Fixos / Aluguel'
from public.empresas e
where e.id = m.empresa_id and e.nome = 'Laportec'
  and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Pagamentos Fixos / Aluguel 913';

-- 3) Enel por imóvel virou "Enel"
--    Enel 913 (2 lanç, R$ 956,86) e Enel 1001 (1 lanç, R$ 197,49)
update public.movimentacoes m
set categoria = 'Pagamentos Fixos / Enel'
from public.empresas e
where e.id = m.empresa_id and e.nome = 'Laportec'
  and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') in
      ('Pagamentos Fixos / Enel 913', 'Pagamentos Fixos / Enel 1001');

-- 4) Devoluções: nome antigo e variação de caixa
--    Outros / devolução para clientes (1 lanç, R$ 12.211,98) → caixa correta
update public.movimentacoes m
set categoria = 'Outros / Devolução para Clientes'
from public.empresas e
where e.id = m.empresa_id and e.nome = 'Laportec'
  and lower(regexp_replace(trim(m.categoria), '\s+', ' ', 'g')) = 'outros / devolução para clientes'
  and m.categoria <> 'Outros / Devolução para Clientes';

--    Outros / Devolução (11 lanç): tem R$ 93.600 de SAÍDAS e R$ 72.400 de
--    ENTRADAS misturadas. Saída = dinheiro devolvido AO cliente; entrada =
--    valor que RETORNOU para a empresa. Separo por tipo:
update public.movimentacoes m
set categoria = 'Outros / Devolução para Clientes'
from public.empresas e
where e.id = m.empresa_id and e.nome = 'Laportec'
  and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Outros / Devolução'
  and m.tipo = 'out';

update public.movimentacoes m
set categoria = 'Outros / Retorno de Valores'
from public.empresas e
where e.id = m.empresa_id and e.nome = 'Laportec'
  and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Outros / Devolução'
  and m.tipo = 'in';

-- ── PENDENTES DE DECISÃO (comentados — ajuste o destino e descomente) ──

-- Laportec · Outros / Ponto Novo (7 lanç, R$ 5.456,74): o que é "Ponto Novo"?
-- Se ainda faz sentido como categoria, recrie "Ponto Novo" como filha de
-- Outros na tela (religa sozinho). Se virou outra coisa, mapeie:
update public.movimentacoes m set categoria = 'Outros / ???'
 from public.empresas e where e.id = m.empresa_id and e.nome = 'Laportec'
and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Outros / Ponto Novo';

-- Laportec · Tecnologia / Infra (1 lanç, R$ 120,73): grupo "Tecnologia" não
-- existe mais; o atual mais próximo é "Sistema". Confirme o destino:
update public.movimentacoes m set categoria = 'Sistema'
from public.empresas e where e.id = m.empresa_id and e.nome = 'Laportec'
 and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Tecnologia / Infra';

-- Laportec · Receita Operacional / Mensalidades (1 entrada, R$ 1.160,00):
-- é RECEITA — me diga qual é a categoria de receita atual do plano
-- (ex.: 'Receita / Mensalidades') que eu completo:
update public.movimentacoes m set categoria = '???'
from public.empresas e where e.id = m.empresa_id and e.nome = 'Laportec'
 and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Receita Operacional / Mensalidades';

-- Avora · Folha De Pagamento / Senteça (1 lanç, R$ 2.000,00): depende do
-- plano da Avora — se lá o nome já é "Sentença", descomente:
update public.movimentacoes m set categoria = 'Folha De Pagamento / Sentença'
from public.empresas e where e.id = m.empresa_id and e.nome = 'Avora'
and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Folha De Pagamento / Senteça';

-- Zaytan · Anúncios Internos / Google Ads (1 lanç, R$ 40,00): depende do
-- plano da Zaytan — recrie "Anúncios Internos / Google Ads" ou mapeie:
update public.movimentacoes m set categoria = '???'
from public.empresas e where e.id = m.empresa_id and e.nome = 'Zaytan'
 and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Anúncios Internos / Google Ads';

-- ── CONFERÊNCIA (rode depois): deve sobrar só o que ficou pendente ──
with caminhos as (
  select p.empresa_id,
         case when p.parent_id is null then p.nome
              else pai.nome || ' / ' || p.nome end as caminho
  from public.plano_contas p
  left join public.plano_contas pai on pai.id = p.parent_id
)
select e.nome as empresa,
       coalesce(nullif(trim(m.categoria), ''), '(vazio)') as categoria_gravada,
       count(*) as lancamentos,
       sum(m.valor) filter (where m.tipo = 'out') as total_saidas
from public.movimentacoes m
join public.empresas e on e.id = m.empresa_id
where m.categoria_status = 'confirmada'
  and not exists (
    select 1 from caminhos c
    where c.empresa_id = m.empresa_id and c.caminho = trim(m.categoria)
  )
group by 1, 2
order by 1, total_saidas desc nulls last;
