-- ============================================================================
--  ZAYTAN HUB — MÓDULO RH · RETRATO DO BANCO (apenas para registro)
--
--  Retirado do projeto de produção (Financeiro) em 24/09/2026. É um RETRATO do
--  que está no ar, para consulta e conferência — não é a migração oficial. Quem
--  cria e altera as tabelas são os arquivos numerados, nesta ordem:
--
--    42_rh_modulo.sql              tabelas rh_*, RLS, buckets e acessos
--    43_pix_ve_pagamentos_rh.sql   fn_rh_pagamentos_para_pix (Pix do dia)
--    48_rh_compromissos_financeiros.sql  fn_rh_compromissos_financeiros
--    49_recorrentes_do_rh.sql      fn_rh_totais_mensais (recorrência puxa do RH)
--    59_folha_liquida_adiantamento_pago.sql  folha_liquida só com o adiantamento pago
--
--  Se for preciso recriar do zero, rode os numerados. Este arquivo serve para
--  responder "o que existe hoje e por quê" sem abrir o Dashboard do Supabase.
--
--  ── Como o RH guarda os dados ──────────────────────────────────────────────
--  O módulo RH veio do CRM RH (JavaScript) e guarda cada registro como um
--  documento JSONB na coluna `data`. As colunas soltas ao lado (nome, empresa,
--  status, competencia, valor…) são ESPELHOS de campos do JSONB: existem para o
--  banco poder filtrar, indexar e aplicar RLS sem abrir o documento. Quem grava
--  é sempre o app, pelos dois lugares ao mesmo tempo.
--
--  Exceção: a folha oficial (rh_extratos_mensais, rh_folha_eventos, rh_folhas,
--  rh_folha_itens) é colunada de verdade — ela nasceu aqui, importada do PDF do
--  contador, e precisa somar por coluna.
--
--  ── Quantidade de registros no dia do retrato ─────────────────────────────
--    rh_funcionarios ......  67      rh_pagamentos .........  254
--    rh_candidatos ........ 174      rh_pagamentos_diarios ..  13
--    rh_atestados .........  53      rh_extratos_mensais ....  58
--    rh_documentos ........   5      rh_folha_eventos ....... 511
--    rh_treinamentos ......   1      rh_folhas / folha_itens .  0
--    rh_perguntas .........   7      rh_folha_importacoes ...   0
--    rh_config ............   1      rh_acessos .............   4
-- ============================================================================


-- ============================================================================
--  1) CADASTROS (documento JSONB + colunas-espelho)
-- ============================================================================

-- Pessoas. `data` traz o cadastro inteiro: salarioBase, dataAdmissao,
-- dataRegistro, tipoContrato, beneficios.{vt,vr,adiantamento,convenio},
-- rescisao.{dataDesligamento,…}, treinamento, dados bancários e chave Pix.
-- O cálculo de VT/VR lê daqui (ver src/modulos/rh/RHApp.jsx).
create table if not exists public.rh_funcionarios (
  id            text primary key,          -- id do CRM RH (texto, não uuid)
  nome          text,
  empresa       text,                      -- empresa do RH, por NOME (não uuid)
  cargo         text,
  departamento  text,
  status        text,                      -- Ativo | Afastado | Desligado
  data          jsonb not null,
  updated_at    timestamptz not null default now()
);

-- Candidatos do recrutamento. `data` guarda o funil, as estrelas da avaliação,
-- as entrevistas e o vínculo com a ficha criada na contratação.
create table if not exists public.rh_candidatos (
  id          text primary key,
  nome        text,
  empresa     text,
  telefone    text,
  area        text,
  vaga        text,
  origem      text,
  status      text,                        -- etapa do funil
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create index if not exists rh_candidatos_empresa_idx on public.rh_candidatos (empresa);
create index if not exists rh_candidatos_area_idx    on public.rh_candidatos (area);

-- Atestados e faltas. `data` tem datas, tipo, horas e o efeito no vale.
create table if not exists public.rh_atestados (
  id          text primary key,
  func_id     text,
  empresa     text,
  tipo        text,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Documentos da pessoa. O arquivo mora no bucket rh-documentos; aqui fica o
-- caminho, dentro de `data`.
create table if not exists public.rh_documentos (
  id          text primary key,
  func_id     text,
  empresa     text,
  categoria   text,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Turmas de treinamento (custo por turma, participantes, período).
create table if not exists public.rh_treinamentos (
  id           text primary key,
  nome         text,
  empresa      text,
  data_inicio  date,
  data         jsonb not null,
  updated_at   timestamptz not null default now()
);

create index if not exists rh_treinamentos_empresa_idx on public.rh_treinamentos (empresa);
create index if not exists rh_treinamentos_inicio_idx  on public.rh_treinamentos (data_inicio);

-- Roteiro de entrevista (perguntas padrão do recrutamento).
create table if not exists public.rh_perguntas (
  id    text primary key,
  data  jsonb not null
);


-- ============================================================================
--  2) PAGAMENTOS
-- ============================================================================

-- Pagamentos por competência: salário, adiantamento, VT, VR, rescisão,
-- treinamento, avulso. `data` guarda dataPrevista, dataRealizada, status,
-- forma, período do vale e o histórico de estorno.
-- É a fonte do Pix do dia (fn_rh_pagamentos_para_pix) e dos compromissos que a
-- projeção de caixa lê (fn_rh_compromissos_financeiros).
create table if not exists public.rh_pagamentos (
  id              text primary key,
  funcionario_id  text,
  empresa         text,
  competencia     text,                    -- "YYYY-MM"
  tipo            text,                    -- Salário | Adiantamento | VT | VR | …
  valor           numeric,
  data            jsonb not null,
  updated_at      timestamptz not null default now()
);

-- Pagamento diário/avulso (Pix, dinheiro), sem competência. Aparece no Pix do
-- dia do Financeiro, só para leitura.
create table if not exists public.rh_pagamentos_diarios (
  id              text primary key,
  data_pagamento  date,
  empresa         text,
  pessoa          text,
  valor           numeric,
  data            jsonb not null,
  updated_at      timestamptz not null default now()
);

create index if not exists rh_pagamentos_diarios_empresa_idx on public.rh_pagamentos_diarios (empresa);
create index if not exists rh_pagamentos_diarios_data_idx    on public.rh_pagamentos_diarios (data_pagamento);


-- ============================================================================
--  3) FOLHA OFICIAL (importada do PDF do contador — colunada de verdade)
-- ============================================================================

-- Uma linha por pessoa por competência: o demonstrativo oficial.
-- A chave (competencia, cpf) é o que impede importar a mesma folha duas vezes.
create table if not exists public.rh_extratos_mensais (
  id               uuid primary key default gen_random_uuid(),
  competencia      text not null,          -- "YYYY-MM"
  empresa          text,
  cnpj             text,
  filial           text,
  funcionario_id   text,                   -- casado com rh_funcionarios.id (sem FK: o id é do CRM)
  nome             text not null,
  cpf              text,
  matricula        text,
  cargo            text,
  cbo              text,
  departamento     text,
  centro_custo     text,
  vinculo          text,
  situacao         text,
  admissao         date,
  horas_mensais    numeric,
  salario_base     numeric,
  proventos        numeric,
  descontos        numeric,
  base_inss        numeric,
  base_fgts        numeric,
  valor_fgts       numeric,
  base_irrf        numeric,
  liquido          numeric,
  emissao          date,
  layout           text,                   -- layout de PDF reconhecido na leitura
  pagina           integer,
  arquivo          text,
  arquivo_hash     text,                   -- detecta reimportação do mesmo PDF
  versao           integer,
  pdf_url          text,                   -- bucket rh-extratos
  importacao_id    uuid,
  data_importacao  timestamptz not null default now(),
  criado_em        timestamptz not null default now(),
  unique (competencia, cpf)
);

create index if not exists rh_extratos_matricula_idx on public.rh_extratos_mensais (competencia, matricula);

-- Verbas (eventos) de cada extrato: provento ou desconto, linha por linha.
create table if not exists public.rh_folha_eventos (
  id                uuid primary key default gen_random_uuid(),
  extrato_id        uuid references public.rh_extratos_mensais(id) on delete cascade,
  funcionario_id    text,
  competencia       text not null,
  codigo            text,                  -- código da verba na folha do contador
  descricao         text not null,
  tipo              text not null,         -- provento | desconto | base…
  quantidade        numeric,
  referencia        numeric,
  referencia_texto  text,
  valor             numeric,
  origem            text not null default 'extrato mensal',
  ordem             integer,
  pagina            integer
);

create index if not exists rh_eventos_extrato_idx on public.rh_folha_eventos (extrato_id);

-- Folha importada em outro formato (estrutura antiga, hoje sem uso: 0 linhas).
create table if not exists public.rh_folhas (
  id                     uuid primary key default gen_random_uuid(),
  competencia            text not null,
  funcionario_id         text,
  matricula              text,
  nome                   text not null,
  cpf                    text,
  cargo                  text,
  empresa                text,
  departamento           text,
  cbo                    text,
  admissao               date,
  situacao               text,
  salario_base           numeric,
  total_proventos        numeric,
  total_descontos        numeric,
  liquido                numeric,
  base_inss              numeric,
  excedente_inss         numeric,
  base_fgts              numeric,
  valor_fgts             numeric,
  base_irrf              numeric,
  status                 text not null default 'Importada',
  necessita_conferencia  boolean not null default false,
  data_pagamento         date,
  pdf_url                text,
  importacao_id          uuid,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now(),
  unique (competencia, cpf)
);

create index if not exists rh_folhas_competencia_idx on public.rh_folhas (competencia);
create index if not exists rh_folhas_empresa_idx     on public.rh_folhas (empresa);

create table if not exists public.rh_folha_itens (
  id                     uuid primary key default gen_random_uuid(),
  folha_id               uuid not null references public.rh_folhas(id) on delete cascade,
  tipo                   text not null,
  codigo                 text,
  descricao              text not null,
  quantidade             numeric,
  referencia             numeric,
  valor                  numeric,
  necessita_conferencia  boolean not null default false,
  ordem                  integer
);

create index if not exists rh_folha_itens_folha_idx on public.rh_folha_itens (folha_id);

-- Log de cada importação de folha (arquivo, avisos, quem importou).
create table if not exists public.rh_folha_importacoes (
  id                uuid primary key default gen_random_uuid(),
  competencia       text,
  arquivo           text,
  pdf_url           text,
  qtd_funcionarios  integer,
  qtd_avisos        integer,
  nao_encontrados   jsonb,
  avisos            jsonb,
  status            text not null default 'Concluída',
  importado_por     text,
  criado_em         timestamptz not null default now()
);


-- ============================================================================
--  4) CONFIGURAÇÃO DO RH (uma linha só, id = 1)
-- ============================================================================
--  Tudo o que muda o cálculo mora em `data`. As chaves presentes hoje:
--
--   Benefícios e vales
--     vtBaseDias              "uteis" (padrão) | "fixo"  → base de dias do VT
--     diasUteis               22 — só vale quando vtBaseDias = "fixo"
--     taxaVT                  6 — teto do desconto do funcionário, em % do salário
--     vtPassagemPadrao        valor sugerido de passagem
--     vrDiario                27.2 — valor do dia de VR
--     vrBaseDias              "uteis" (padrão) | "corridos" | "fixo"
--     vrDiasFixos             22 — só vale quando vrBaseDias = "fixo"
--     vrProporcionalAdmissao  true → rateia VT e VR de quem entra/sai no mês
--
--   Adiantamento (vale)
--     percentualAdiant 40 · valeDia 20 · valeAjuste "antes" · valeCorteDia
--
--   Salário e jornada
--     baseDiaSalario "mes" (divide pelo mês real) | "30" · diaPagamento
--     jornadaHoras · jornadaEntrada · jornadaAlmocoIni/Fim · jornadaSaida
--     percentualINSS (só sugestão na rescisão)
--
--   Cadastro e aparência
--     cargos · salariosPorCargo · nomeEmpresa · logo · corTema
--     folhaReferencias · repasseImports (histórico de importações do repasse)
--
--  NÃO há chave `feriados` em uso: os feriados nacionais são calculados no
--  código (mesma regra de fn_feriados_nacionais, migração 26). Se algum dia
--  entrar um feriado só da empresa, ele vem numa chave `feriados` (array de
--  "YYYY-MM-DD") e vale POR CIMA dos nacionais.
--
--  A cópia do CRM RH (scripts/rh/copiar-do-crm-rh.mjs) NÃO traz esta tabela por
--  padrão — o sistema antigo não conhece essas opções e as sobrescreveria.
-- ============================================================================
create table if not exists public.rh_config (
  id    integer primary key default 1,
  data  jsonb not null default '{}'::jsonb
);


-- ============================================================================
--  5) QUEM ENTRA NO RH (acesso pessoa a pessoa, não por cargo)
-- ============================================================================
--  O RH não é capacidade de cargo do Financeiro: é liberado um a um em
--  Configurações › Usuários. `empresas` nulo = todas as empresas do RH.
create table if not exists public.rh_acessos (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  perfil      text check (perfil is null or perfil in ('rh','financeiro','recrutamento')),
  empresas    text[] check (empresas is null or cardinality(empresas) >= 1),
  criado_em   timestamptz not null default now(),
  criado_por  uuid default auth.uid()
);

-- Toda mudança de acesso fica registrada.
create trigger log_rh_acessos
  after insert or update or delete on public.rh_acessos
  for each row execute function tg_log_rh_acessos();


-- ============================================================================
--  6) SEGURANÇA (RLS) — uma porta só: rh_pode()
-- ============================================================================
--  Todas as tabelas rh_* têm RLS LIGADA, com uma política única por tabela
--  (`rh_acesso`, para o papel authenticated, valendo em ALL) que chama
--  rh_pode(tabela, empresa). Quem é master passa sempre; quem tem perfil
--  'recrutamento' só alcança candidatos, perguntas e config; e o array
--  `empresas` do acesso limita por empresa do RH (comparação sem caixa e sem
--  espaços). Nas tabelas filhas a empresa vem da mãe por subconsulta
--  (rh_folha_eventos → rh_extratos_mensais; rh_folha_itens → rh_folhas).
--
--  rh_acessos é a exceção: cada um lê o próprio acesso (ou tudo, se master), e
--  só o master escreve.

create or replace function public.rh_pode(p_tabela text, p_empresa text default null)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
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

-- Exemplo do que cada tabela tem (as outras seguem o mesmo molde):
--   alter table public.rh_funcionarios enable row level security;
--   create policy rh_acesso on public.rh_funcionarios for all to authenticated
--     using      (rh_pode('funcionarios', coalesce(empresa, '')))
--     with check (rh_pode('funcionarios', coalesce(empresa, '')));
--
--   create policy rh_acessos_ler on public.rh_acessos for select to authenticated
--     using (user_id = auth.uid() or is_master());
--   create policy rh_acessos_master on public.rh_acessos for all to authenticated
--     using (is_master()) with check (is_master());


-- ============================================================================
--  7) FUNÇÕES QUE LIGAM O RH AO FINANCEIRO
-- ============================================================================
--  O Financeiro nunca lê as tabelas do RH direto: pede por estas funções, que
--  traduzem "empresa do Financeiro (uuid)" ↔ "empresa do RH (nome)".
--
--   fn_rh_compromissos_financeiros(p_empresa uuid, p_de date, p_ate date)
--       → o que o RH tem a pagar no período (salário, adiantamento, VT, VR,
--         rescisão…), para a projeção de caixa e o Dashboard.
--
--   fn_rh_pagamentos_para_pix(p_empresa uuid, p_de date, p_ate date)
--       → pagamentos do dia com chave Pix, para o Pix do dia (só leitura).
--
--   fn_rh_totais_mensais(p_empresa uuid, p_de date, p_ate date)
--       → total por competência de salários, adiantamento, VT e VR. É o que a
--         recorrência ligada ao RH usa para o valor se atualizar mês a mês
--         (`vr_aproximado` avisa quando o VR foi estimado). `folha_liquida`
--         (migração 59) é o salário menos o adiantamento que cada pessoa
--         RECEBEU na competência — quem não recebeu entra com o salário cheio.
--
--   fn_empresas_rh() → as empresas do RH que o usuário atual alcança.
--   rh_empresa_corresponde(nome_financeiro, empresa_rh) → casa "Laportec" com
--       "Laportec Serviços", por prefixo, sem caixa.
--   rh_dia_util_ate(empresa, ano, mes, dia) → o dia do mês já antecipado para
--       dia útil (usa fn_dia_util_anterior, migração 26).
--   rh_data(texto) → converte "YYYY-MM-DD…" do JSONB em date com segurança.


-- ============================================================================
--  8) ARQUIVOS (Storage)
-- ============================================================================
--   rh-documentos   documentos das pessoas   · privado
--   rh-extratos     PDFs da folha oficial    · privado
--  Os dois são privados: o acesso é sempre por URL assinada, pelo app.
--  O caminho do arquivo fica no JSONB do registro correspondente.
