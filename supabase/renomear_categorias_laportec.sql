-- ============================================================
--  ZAYTAN HUB — Renomeia as categorias do Laportec (nomes mais claros)
--  e propaga os novos nomes para TODOS os lançamentos já gravados.
--
--  ⚠️ ORDEM: rode o remapear_categorias_orfas.sql ANTES deste — os destinos
--  de lá usam os nomes atuais; depois deste renomeio eles ficariam velhos.
--
--  Como funciona: fotografa os caminhos ("Pai / Filha") antes, aplica os
--  renomes no plano, fotografa depois e atualiza as movimentações de todo
--  caminho que mudou — inclusive filhas de pai renomeado. Rode o script
--  INTEIRO de uma vez (usa tabelas temporárias da mesma sessão).
-- ============================================================

begin;

-- ── Foto ANTES ──────────────────────────────────────────────
create temp table cat_antes as
select p.id, p.empresa_id,
       case when p.parent_id is null then p.nome
            else pai.nome || ' / ' || p.nome end as caminho
from public.plano_contas p
left join public.plano_contas pai on pai.id = p.parent_id
join public.empresas e on e.id = p.empresa_id
where e.nome = 'Laportec';

-- ── Renomes no plano ────────────────────────────────────────
-- Grafia e acentos
update public.plano_contas p set nome = 'Despesas Bancárias'        from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Despesas Bancarias';
update public.plano_contas p set nome = 'Investimentos Automáticos' from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Investimentos Automaticos';
update public.plano_contas p set nome = 'Folha de Pagamento'        from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Folha De Pagamento';
update public.plano_contas p set nome = '13º Salário'               from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = '13º salário';
update public.plano_contas p set nome = 'Máquinas e Equipamentos'   from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Maquinas/ Equipamento';
update public.plano_contas p set nome = 'Móveis'                    from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Moveis';
update public.plano_contas p set nome = 'Seguro do Imóvel'          from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Seguro Imovel';
update public.plano_contas p set nome = 'Internet (Claro)'          from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Internet claro';
update public.plano_contas p set nome = 'Reembolso'                 from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Rembolso';
update public.plano_contas p set nome = 'Lira Advogados'            from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome ~ '^Lira\s+Advogados$' and p.nome <> 'Lira Advogados';

-- Códigos 3.10 triplicados (Exame Admissional mantém o 3.10)
update public.plano_contas p set nome = 'Farmácia', codigo = '3.13' from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Farmacia';
update public.plano_contas p set nome = 'Sentença', codigo = '3.14' from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Senteça';

-- Leads: padrão "Fornecedor - Tipo" (agrupa por fornecedor na leitura);
-- códigos reordenados para Zaytan/Daniel/RH ficarem juntos
update public.plano_contas p set nome = 'Zaytan - Aporte'                    from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Aporte Zaytan';
update public.plano_contas p set nome = 'Zaytan - Mensalidade'               from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Mensalidade Zaytan';
update public.plano_contas p set nome = 'Daniel - Aporte', codigo = '2.3'    from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Aporte Daniel';
update public.plano_contas p set nome = 'Daniel - Mensalidade', codigo = '2.4' from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Mensalidade Daniel';
update public.plano_contas p set nome = 'RH - Aporte'                        from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Aporte RH';

-- Grupos que prometem outra coisa para quem lê de fora
update public.plano_contas p set nome = 'Compras e Equipamentos'  from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Ativos';
update public.plano_contas p set nome = 'Sócios'                  from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Provisões';
update public.plano_contas p set nome = 'Sistemas e Assinaturas'  from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Sistema';

-- Desambiguação: "Limpeza" (serviço, em Terceiros) vs "Material de Limpeza"
update public.plano_contas p set nome = 'Serviço de Limpeza'      from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Limpeza';

-- Diligência estava sem código (ordenava no fim)
update public.plano_contas p set codigo = '13.5'                  from public.empresas e where e.id = p.empresa_id and e.nome = 'Laportec' and p.nome = 'Diligência' and coalesce(p.codigo, '') = '';

-- "Cyntia" ficou como está: me diga o serviço prestado que eu completo
-- (ex.: 'Cyntia (Recepção)').

-- ── Foto DEPOIS + propagação para as movimentações ──────────
create temp table cat_depois as
select p.id, p.empresa_id,
       case when p.parent_id is null then p.nome
            else pai.nome || ' / ' || p.nome end as caminho
from public.plano_contas p
left join public.plano_contas pai on pai.id = p.parent_id
join public.empresas e on e.id = p.empresa_id
where e.nome = 'Laportec';

update public.movimentacoes m
set categoria = d.caminho
from cat_antes a
join cat_depois d on d.id = a.id and d.caminho <> a.caminho
where m.empresa_id = a.empresa_id
  and trim(m.categoria) = a.caminho;

-- ── Conferência: não pode ter sobrado órfão NOVO ────────────
-- (aparecem só os pendentes conhecidos: Ponto Novo, Tecnologia/Infra,
--  Receita Operacional — e nada com os nomes antigos daqui de cima)
with caminhos as (
  select p.empresa_id,
         case when p.parent_id is null then p.nome
              else pai.nome || ' / ' || p.nome end as caminho
  from public.plano_contas p
  left join public.plano_contas pai on pai.id = p.parent_id
)
select coalesce(nullif(trim(m.categoria), ''), '(vazio)') as categoria_gravada,
       count(*) as lancamentos,
       sum(m.valor) filter (where m.tipo = 'out') as total_saidas
from public.movimentacoes m
join public.empresas e on e.id = m.empresa_id
where e.nome = 'Laportec'
  and m.categoria_status = 'confirmada'
  and not exists (
    select 1 from caminhos c
    where c.empresa_id = m.empresa_id and c.caminho = trim(m.categoria)
  )
group by 1
order by total_saidas desc nulls last;

commit;

-- ── OPCIONAIS (fora da transação; descomente se quiser) ─────

-- Aplicações financeiras fora de receitas/despesas (o dinheiro continua seu;
-- hoje "Investimentos" infla as saídas em R$ 9.119,56):
-- update public.plano_contas p set oculto_relatorios = true
-- from public.empresas e
-- where e.id = p.empresa_id and e.nome = 'Laportec'
--   and p.nome in ('Investimentos', 'Investimentos Automáticos');

-- Pendentes do remapeamento anterior, JÁ com os nomes novos como destino:
-- update public.movimentacoes m set categoria = 'Sistemas e Assinaturas'
-- from public.empresas e where e.id = m.empresa_id and e.nome = 'Laportec'
--   and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Tecnologia / Infra';
-- update public.movimentacoes m set categoria = 'Outros / ???'   -- Ponto Novo: decidir
-- from public.empresas e where e.id = m.empresa_id and e.nome = 'Laportec'
--   and regexp_replace(trim(m.categoria), '\s+', ' ', 'g') = 'Outros / Ponto Novo';
