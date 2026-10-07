-- ============================================================
--  ZAYTAN HUB — Módulo RH dentro do projeto Financeiro
--
--  Traz as tabelas do CRM RH (projeto "ZAYTAN CRM RH") para este banco, com o
--  prefixo rh_, para o Zaytan Hub usar um login só. Os dados são copiados à parte
--  (scripts/rh/copiar-do-crm-rh.mjs); o projeto antigo não é alterado.
--
--  Aditiva e idempotente: só cria objetos novos, não mexe em nada do Financeiro.
--
--  Acesso: POR USUÁRIO (tabela rh_acessos), não por cargo — hoje só uma pessoa
--  usa o RH. O master sempre acessa. Diferente do CRM RH (policies "logado vê
--  tudo"), aqui o banco aplica a empresa e o perfil de cada acesso:
--    - lista de empresas preenchida → só registros delas (nas tabelas que têm empresa);
--    - perfil 'recrutamento' → só candidatos, roteiro de perguntas e configuração.
--
--  Este arquivo já traz rh_acessos.empresas (lista). Bancos que rodaram a versão
--  anterior (coluna empresa, uma só) são ajustados pela 44_empresas_por_modulo.sql.
-- ============================================================

-- ─── 1) Quem acessa o RH ────────────────────────────────────
create table if not exists public.rh_acessos (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- null = administrador do RH (tudo, inclusive Configurações)
  perfil     text check (perfil is null or perfil in ('rh', 'financeiro', 'recrutamento')),
  -- null = todas as empresas; senão os nomes como o RH grava ("Laportec", "Zaytan"…)
  empresas   text[] constraint rh_acessos_empresas_validas check (empresas is null or cardinality(empresas) >= 1),
  criado_em  timestamptz not null default now(),
  criado_por uuid default auth.uid()
);

alter table public.rh_acessos enable row level security;
revoke all on public.rh_acessos from anon;

drop policy if exists rh_acessos_ler on public.rh_acessos;
create policy rh_acessos_ler on public.rh_acessos
  for select to authenticated
  using (user_id = auth.uid() or public.is_master());

drop policy if exists rh_acessos_master on public.rh_acessos;
create policy rh_acessos_master on public.rh_acessos
  for all to authenticated
  using (public.is_master())
  with check (public.is_master());

-- Pode ler/gravar a tabela do RH `p_tabela` num registro da empresa `p_empresa`?
-- p_empresa null = tabela sem empresa (configuração, perguntas, importações, arquivos).
create or replace function public.rh_pode(p_tabela text, p_empresa text default null)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_master()
      or exists (
        select 1
        from public.rh_acessos a
        where a.user_id = auth.uid()
          and (a.empresas is null or p_empresa is null
               or exists (select 1 from unnest(a.empresas) x
                          where lower(btrim(x)) = lower(btrim(p_empresa))))
          and (a.perfil is distinct from 'recrutamento'
               or p_tabela in ('candidatos', 'perguntas', 'config'))
      );
$$;

revoke execute on function public.rh_pode(text, text) from public, anon;
grant execute on function public.rh_pode(text, text) to authenticated;

-- ─── 2) Tabelas (mesmas colunas do CRM RH) ──────────────────
-- Documentos: o app guarda o registro inteiro em `data`; as outras colunas servem para busca.
create table if not exists public.rh_funcionarios (
  id text primary key, nome text, empresa text, cargo text, departamento text, status text,
  data jsonb not null, updated_at timestamptz not null default now()
);

create table if not exists public.rh_candidatos (
  id text primary key, nome text, empresa text, telefone text,
  data jsonb not null, updated_at timestamptz not null default now(),
  area text, vaga text, origem text, status text
);
create index if not exists rh_candidatos_area_idx on public.rh_candidatos (area);
create index if not exists rh_candidatos_empresa_idx on public.rh_candidatos (empresa);

create table if not exists public.rh_pagamentos (
  id text primary key, funcionario_id text, empresa text, competencia text, tipo text, valor numeric,
  data jsonb not null, updated_at timestamptz not null default now()
);

create table if not exists public.rh_atestados (
  id text primary key, func_id text, empresa text, tipo text,
  data jsonb not null, updated_at timestamptz not null default now()
);

create table if not exists public.rh_documentos (
  id text primary key, func_id text, empresa text, categoria text,
  data jsonb not null, updated_at timestamptz not null default now()
);

create table if not exists public.rh_perguntas (
  id text primary key, data jsonb not null
);

create table if not exists public.rh_treinamentos (
  id text primary key, nome text, empresa text, data_inicio date,
  data jsonb not null, updated_at timestamptz not null default now()
);
create index if not exists rh_treinamentos_empresa_idx on public.rh_treinamentos (empresa);
create index if not exists rh_treinamentos_inicio_idx on public.rh_treinamentos (data_inicio);

create table if not exists public.rh_pagamentos_diarios (
  id text primary key, data_pagamento date, empresa text, pessoa text, valor numeric,
  data jsonb not null, updated_at timestamptz not null default now()
);
create index if not exists rh_pagamentos_diarios_data_idx on public.rh_pagamentos_diarios (data_pagamento);
create index if not exists rh_pagamentos_diarios_empresa_idx on public.rh_pagamentos_diarios (empresa);

create table if not exists public.rh_config (
  id integer primary key default 1, data jsonb not null default '{}'::jsonb
);

-- Folha oficial da contabilidade (relacional).
create table if not exists public.rh_folha_importacoes (
  id uuid primary key default gen_random_uuid(), competencia text, arquivo text, pdf_url text,
  qtd_funcionarios integer, qtd_avisos integer, nao_encontrados jsonb, avisos jsonb,
  status text not null default 'Concluída', importado_por text,
  criado_em timestamptz not null default now()
);
create index if not exists rh_folha_importacoes_comp_idx on public.rh_folha_importacoes (competencia);

create table if not exists public.rh_extratos_mensais (
  id uuid primary key default gen_random_uuid(),
  competencia text not null, empresa text, cnpj text, filial text, funcionario_id text,
  nome text not null, cpf text, cargo text, cbo text, departamento text, centro_custo text,
  vinculo text, situacao text, admissao date, horas_mensais numeric, salario_base numeric,
  proventos numeric, descontos numeric, base_inss numeric, base_fgts numeric, valor_fgts numeric,
  base_irrf numeric, liquido numeric, pdf_url text, importacao_id uuid,
  data_importacao timestamptz not null default now(), criado_em timestamptz not null default now(),
  matricula text, pagina integer, layout text, arquivo text, arquivo_hash text, emissao date, versao integer,
  unique (competencia, cpf)
);
create index if not exists rh_extratos_matricula_idx on public.rh_extratos_mensais (competencia, matricula);

create table if not exists public.rh_folha_eventos (
  id uuid primary key default gen_random_uuid(),
  extrato_id uuid references public.rh_extratos_mensais(id) on delete cascade,
  funcionario_id text, competencia text not null, codigo text, descricao text not null, tipo text not null,
  quantidade numeric, referencia numeric, valor numeric,
  origem text not null default 'extrato mensal', ordem integer, referencia_texto text, pagina integer
);
create index if not exists rh_eventos_extrato_idx on public.rh_folha_eventos (extrato_id);

-- Folha legada (importação antiga via n8n): o app ainda lê.
create table if not exists public.rh_folhas (
  id uuid primary key default gen_random_uuid(),
  competencia text not null, funcionario_id text, matricula text, nome text not null, cpf text,
  cargo text, empresa text, departamento text, cbo text, admissao date, situacao text,
  salario_base numeric, total_proventos numeric, total_descontos numeric, liquido numeric,
  base_inss numeric, excedente_inss numeric, base_fgts numeric, valor_fgts numeric, base_irrf numeric,
  status text not null default 'Importada', necessita_conferencia boolean not null default false,
  data_pagamento date, pdf_url text, importacao_id uuid,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  unique (competencia, cpf)
);
create index if not exists rh_folhas_competencia_idx on public.rh_folhas (competencia);
create index if not exists rh_folhas_empresa_idx on public.rh_folhas (empresa);

create table if not exists public.rh_folha_itens (
  id uuid primary key default gen_random_uuid(),
  folha_id uuid not null references public.rh_folhas(id) on delete cascade,
  tipo text not null, codigo text, descricao text not null, quantidade numeric, referencia numeric,
  valor numeric, necessita_conferencia boolean not null default false, ordem integer
);
create index if not exists rh_folha_itens_folha_idx on public.rh_folha_itens (folha_id);

-- Ficaram no projeto antigo, sem uso na interface: app_state (modo legado),
-- backups (snapshots do n8n), beneficios_mensais e pagamentos_beneficios (vazias).

-- ─── 3) RLS de todas as tabelas do RH ───────────────────────
do $$
declare
  t record;
  cond text;
begin
  for t in
    select * from (values
      ('funcionarios', 'empresa'), ('candidatos', 'empresa'), ('pagamentos', 'empresa'),
      ('atestados', 'empresa'), ('documentos', 'empresa'), ('treinamentos', 'empresa'),
      ('pagamentos_diarios', 'empresa'), ('extratos_mensais', 'empresa'), ('folhas', 'empresa'),
      ('perguntas', null), ('config', null), ('folha_importacoes', null)
    ) as v(nome, coluna)
  loop
    -- Registro sem empresa preenchida só aparece para quem vê todas as empresas.
    cond := case when t.coluna is null
      then format('public.rh_pode(%L)', t.nome)
      else format('public.rh_pode(%L, coalesce(%I, %L))', t.nome, t.coluna, '')
    end;
    execute format('alter table public.%I enable row level security', 'rh_' || t.nome);
    execute format('revoke all on public.%I from anon', 'rh_' || t.nome);
    execute format('drop policy if exists rh_acesso on public.%I', 'rh_' || t.nome);
    execute format(
      'create policy rh_acesso on public.%I for all to authenticated using (%s) with check (%s)',
      'rh_' || t.nome, cond, cond
    );
  end loop;
end $$;

-- Verbas e itens seguem o extrato/folha a que pertencem.
alter table public.rh_folha_eventos enable row level security;
revoke all on public.rh_folha_eventos from anon;
drop policy if exists rh_acesso on public.rh_folha_eventos;
create policy rh_acesso on public.rh_folha_eventos
  for all to authenticated
  using (public.rh_pode('folha_eventos', coalesce(
    (select x.empresa from public.rh_extratos_mensais x where x.id = extrato_id), '')))
  with check (public.rh_pode('folha_eventos', coalesce(
    (select x.empresa from public.rh_extratos_mensais x where x.id = extrato_id), '')));

alter table public.rh_folha_itens enable row level security;
revoke all on public.rh_folha_itens from anon;
drop policy if exists rh_acesso on public.rh_folha_itens;
create policy rh_acesso on public.rh_folha_itens
  for all to authenticated
  using (public.rh_pode('folha_itens', coalesce(
    (select f.empresa from public.rh_folhas f where f.id = folha_id), '')))
  with check (public.rh_pode('folha_itens', coalesce(
    (select f.empresa from public.rh_folhas f where f.id = folha_id), '')));

-- ─── 4) Arquivos (buckets privados) ─────────────────────────
-- Mesmos caminhos do CRM RH; o app troca "documentos" → "rh-documentos" e "extratos" → "rh-extratos".
insert into storage.buckets (id, name, public)
values ('rh-documentos', 'rh-documentos', false), ('rh-extratos', 'rh-extratos', false)
on conflict (id) do nothing;

drop policy if exists rh_arquivos_ler on storage.objects;
create policy rh_arquivos_ler on storage.objects
  for select to authenticated
  using (bucket_id in ('rh-documentos', 'rh-extratos') and public.rh_pode('documentos'));

drop policy if exists rh_arquivos_gravar on storage.objects;
create policy rh_arquivos_gravar on storage.objects
  for insert to authenticated
  with check (bucket_id in ('rh-documentos', 'rh-extratos') and public.rh_pode('documentos'));

drop policy if exists rh_arquivos_atualizar on storage.objects;
create policy rh_arquivos_atualizar on storage.objects
  for update to authenticated
  using (bucket_id in ('rh-documentos', 'rh-extratos') and public.rh_pode('documentos'))
  with check (bucket_id in ('rh-documentos', 'rh-extratos') and public.rh_pode('documentos'));

drop policy if exists rh_arquivos_apagar on storage.objects;
create policy rh_arquivos_apagar on storage.objects
  for delete to authenticated
  using (bucket_id in ('rh-documentos', 'rh-extratos') and public.rh_pode('documentos'));

-- ─── Conferência ────────────────────────────────────────────
--   select tablename, rowsecurity from pg_tables where tablename like 'rh\_%' order by 1;
--   select * from public.rh_acessos;
-- Liberar o RH para alguém (só master, pela tela Gestão › Usuários ou aqui):
--   insert into public.rh_acessos (user_id, perfil, empresas)
--   select id, null, null from auth.users where email = '<email>';   -- null = todas as empresas
