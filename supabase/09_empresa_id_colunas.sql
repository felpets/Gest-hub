-- ============================================================
--  ZAYTAN HUB — Multiempresa (2/6): coluna empresa_id (NULLABLE) + índices
--  Rode DEPOIS do 08. Aditivo e seguro: não quebra o app atual
--  (a coluna ainda aceita nulo; o NOT NULL só entra no 11).
-- ============================================================

alter table public.clientes           add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;
alter table public.movimentacoes      add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;
alter table public.previstos          add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;
alter table public.regras             add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;
alter table public.plano_contas       add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;
alter table public.recorrentes        add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;
alter table public.planejamento_meses add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;
alter table public.planejamento_itens add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;
alter table public.configuracoes      add column if not exists empresa_id uuid references public.empresas(id) on delete restrict;

create index if not exists clientes_empresa_idx           on public.clientes(empresa_id);
create index if not exists movimentacoes_empresa_idx      on public.movimentacoes(empresa_id);
create index if not exists previstos_empresa_idx          on public.previstos(empresa_id);
create index if not exists regras_empresa_idx             on public.regras(empresa_id);
create index if not exists plano_contas_empresa_idx       on public.plano_contas(empresa_id);
create index if not exists recorrentes_empresa_idx        on public.recorrentes(empresa_id);
create index if not exists planejamento_meses_empresa_idx on public.planejamento_meses(empresa_id);
create index if not exists planejamento_itens_empresa_idx on public.planejamento_itens(empresa_id);
-- configuracoes terá PK = empresa_id no 11, então não precisa de índice dedicado.
