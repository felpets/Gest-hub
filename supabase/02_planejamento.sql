-- ============================================================
--  ZAYTAN HUB — Planejamento (previsto x realizado por mês)
--  Rode no SQL Editor DEPOIS do schema.sql.
-- ============================================================

-- ─── Meses do horizonte de planejamento ─────────────────────
create table if not exists public.planejamento_meses (
  ordem integer primary key,        -- 0,1,2... ordem cronológica
  label text not null,              -- ex.: "Mai/25"
  atual boolean not null default false
);

-- ─── Itens (uma linha por item × mês) ───────────────────────
create table if not exists public.planejamento_itens (
  id         uuid primary key default gen_random_uuid(),
  categoria  text not null,         -- ex.: "Receita Operacional"
  tipo       text not null check (tipo in ('receita','custo')),
  item       text not null,         -- ex.: "Mensalidade LaPortec"
  cat_ordem  integer not null,      -- ordem da categoria
  item_ordem integer not null,      -- ordem do item dentro da categoria
  mes_ordem  integer not null,      -- referencia planejamento_meses.ordem
  previsto   numeric(12,2) not null default 0,
  realizado  numeric(12,2)          -- null = ainda não realizado
);

-- ─── RLS (mesmo padrão: só autenticado) ─────────────────────
alter table public.planejamento_meses enable row level security;
alter table public.planejamento_itens enable row level security;

do $$
declare t text;
begin
  foreach t in array array['planejamento_meses','planejamento_itens'] loop
    execute format('drop policy if exists "acesso total autenticados" on public.%I;', t);
    execute format($f$
      create policy "acesso total autenticados" on public.%I
        for all to authenticated using (true) with check (true);
    $f$, t);
  end loop;
end $$;

-- ============================================================
--  SEED
-- ============================================================
-- truncate public.planejamento_meses, public.planejamento_itens;

insert into public.planejamento_meses (ordem, label, atual) values
  (0,'Mar/25',false),
  (1,'Abr/25',false),
  (2,'Mai/25',true),
  (3,'Jun/25',false),
  (4,'Jul/25',false),
  (5,'Ago/25',false)
on conflict (ordem) do nothing;

-- Cada item traz dois arrays de 6 posições (previsto / realizado).
-- O unnest abre em 6 linhas (uma por mês). null = não realizado.
insert into public.planejamento_itens
  (categoria, tipo, item, cat_ordem, item_ordem, mes_ordem, previsto, realizado)
select t.cat, t.tipo, t.item, t.cat_ordem, t.item_ordem, u.ord - 1, u.prev, u.real
from (
  values
    -- Receita Operacional (cat 0)
    ('Receita Operacional','receita','Mensalidade LaPortec',0,0, array[1500,1500,1500,1500,1500,1500]::numeric[], array[1500,1500,1500,null,null,null]::numeric[]),
    ('Receita Operacional','receita','Mensalidade Star5',   0,1, array[2200,2200,2200,2200,2200,2200]::numeric[], array[2200,2200,2200,null,null,null]::numeric[]),
    ('Receita Operacional','receita','Mensalidade ELOS',    0,2, array[1800,1800,1800,1800,1800,1800]::numeric[], array[1800,1800,1800,null,null,null]::numeric[]),
    ('Receita Operacional','receita','Mensalidade TITÃS',   0,3, array[1200,1200,1200,1200,1200,1200]::numeric[], array[1200,1200,0,null,null,null]::numeric[]),
    ('Receita Operacional','receita','Mensalidade Dakal',   0,4, array[980,980,980,980,980,980]::numeric[],       array[980,980,980,null,null,null]::numeric[]),
    ('Receita Operacional','receita','Mensalidade Allure',  0,5, array[1450,1450,1450,1450,1450,1450]::numeric[], array[0,1450,1450,null,null,null]::numeric[]),
    ('Receita Operacional','receita','Mensalidade OTTO',    0,6, array[950,950,950,950,950,950]::numeric[],       array[950,950,950,null,null,null]::numeric[]),
    ('Receita Operacional','receita','Projetos extras',     0,7, array[0,700,1500,2200,3200,4200]::numeric[],     array[0,750,1370,null,null,null]::numeric[]),
    -- Tecnologia (cat 1)
    ('Tecnologia','custo','Lovable Pro',       1,0, array[100,100,100,100,100,100]::numeric[], array[100,100,100,null,null,null]::numeric[]),
    ('Tecnologia','custo','VPS N8N (Hetzner)', 1,1, array[80,80,80,80,80,80]::numeric[],       array[80,80,80,null,null,null]::numeric[]),
    ('Tecnologia','custo','Claude Code',       1,2, array[92,92,92,92,92,92]::numeric[],       array[92,92,92,null,null,null]::numeric[]),
    ('Tecnologia','custo','OpenAI / ChatGPT',  1,3, array[110,110,110,110,110,110]::numeric[], array[110,110,110,null,null,null]::numeric[]),
    ('Tecnologia','custo','Supabase Pro',      1,4, array[130,130,130,130,130,130]::numeric[], array[130,130,130,null,null,null]::numeric[]),
    ('Tecnologia','custo','Cursor IDE',        1,5, array[80,80,80,80,80,80]::numeric[],       array[80,80,80,null,null,null]::numeric[]),
    -- Marketing (cat 2)
    ('Marketing','custo','Meta Ads — campanhas',2,0, array[1500,1800,2000,2000,2200,2500]::numeric[], array[1200,1750,3200,null,null,null]::numeric[]),
    ('Marketing','custo','Criativos (Hub)',     2,1, array[800,900,950,900,1000,1000]::numeric[],     array[750,920,950,null,null,null]::numeric[]),
    -- Pessoal (cat 3)
    ('Pessoal','custo','Designer Marina',3,0, array[1500,1800,1800,1800,1800,1800]::numeric[], array[1500,1800,1800,null,null,null]::numeric[]),
    ('Pessoal','custo','Dev Vinícius',   3,1, array[3000,3200,3200,3200,3200,3200]::numeric[], array[3000,3200,3200,null,null,null]::numeric[]),
    -- Operacional (cat 4)
    ('Operacional','custo','Vivo Fibra',              4,0, array[220,220,220,220,220,220]::numeric[], array[220,220,220,null,null,null]::numeric[]),
    ('Operacional','custo','Regus (endereço fiscal)', 4,1, array[480,480,480,480,480,480]::numeric[], array[480,480,480,null,null,null]::numeric[]),
    -- Tributos (cat 5)
    ('Tributos','custo','DAS Simples Nacional',5,0, array[620,680,720,750,780,820]::numeric[], array[610,690,720,null,null,null]::numeric[])
) as t(cat, tipo, item, cat_ordem, item_ordem, prevs, reals)
cross join lateral unnest(t.prevs, t.reals) with ordinality as u(prev, real, ord);
