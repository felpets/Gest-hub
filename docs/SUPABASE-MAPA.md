# Mapa do Supabase — Financeiro e RH

> Levantamento **somente leitura** feito em 16/09/2026 (catálogo do Postgres, `pg_policies`, `pg_proc`,
> `pg_trigger`, `cron.job`, `storage.buckets` e o linter de segurança do Supabase). Nenhum dado real foi
> lido para o protótipo e **nenhuma alteração** foi feita nos bancos.

## 1. Onde cada sistema vive

Os dois sistemas estão na **mesma organização** ("Zaytan Projetos"), mas em **projetos diferentes**, com
bancos e bases de login (Auth) separados:

| Sistema | Projeto Supabase | Ref | Região |
|---|---|---|---|
| Financeiro (Zaytan Hub Financeiro) | Financeiro | `ieqkhecsyarszhhonaor` | sa-east-1 |
| CRM RH | ZAYTAN CRM RH | `apatabasuxkgqxabuqdj` | ca-central-1 |
| CRM Comercial / Revisional (futuro: projeção) | Zaytan CRM Produção | `tknzwtobtlrjgolzyfml` | us-east-1 |

Consequências para a consolidação:

- **Não existe dependência de dados entre Financeiro e RH hoje.** Nenhuma FK, view ou função cruza os projetos.
- **Um mesmo usuário tem dois logins diferentes** (um em cada Auth). O protótipo usa um login só; no modo
  real isso exige unificar a autenticação (ver §6).
- **Empresa tem dois modelos:** no Financeiro é a tabela `empresas` (uuid, com membros e cargos); no RH é
  um texto (`"Laportec"`, `"Avora"`, `"Zaytan"`) gravado em cada registro.
- **Nome de tabela repetido:** `pagamentos_diarios` existe nos dois projetos, com esquemas diferentes. O
  protótipo separa o RH no namespace `rh.*` para não colidir.

## 2. Financeiro (`ieqkhecsyarszhhonaor`)

### Tabelas (linhas em 16/09/2026)

| Tabela | Linhas | Papel | Usada por (tela nova) |
|---|---:|---|---|
| `empresas` | 3 | multiempresa | todo o app |
| `perfis` | 4 | `is_master`, nome | todo o app |
| `empresa_membros` | 7 | usuário × empresa × cargo | todo o app, Gestão › Empresas/Usuários |
| `cargos` / `cargo_capacidades` | 4 / 18 | RBAC configurável | todo o app, Gestão › Empresas |
| `contas_bancarias` | 4 | contas, saldo inicial, ajuste auditado | Caixa, Extratos, Ajustes, Dashboard |
| `movimentacoes` | 1297 | extrato (pendente → confirmada) | Caixa, Extratos, Dashboard |
| `plano_contas` | 168 | categorias hierárquicas + competência | Plano de contas e quase tudo |
| `regras_categorizacao` | 241 | regras aprendidas/manuais | Extratos › Revisar, Ajustes |
| `recorrentes` | 34 | regra mensal | Pagamentos › Recorrências/Contas |
| `previstos` | 854 | contas a pagar/receber materializadas | Pagamentos, Caixa › Projeção, Dashboard |
| `clientes` / `cobrancas` | 1 / 0 | mensalidades + conciliação | Receitas › Clientes, Dashboard |
| `cliente_mensalidades` | — | várias mensalidades por cliente (migração 52, **ainda não aplicada**) | Receitas › Clientes |
| `vendas` | 0 | controle de vendas (fora do saldo) | Receitas › Vendas |
| `pagamentos_processos` / `_parcelas` | 3 / 0 | acordos parcelados + comprovantes | Pagamentos › Dívidas e acordos |
| `pagamentos_diarios` / `_historico` | 23 / 52 | Pix do dia com trava e auditoria | Pagamentos › Pix do dia |
| `feriados` | 0 | feriados da empresa (dia útil) | Ajustes |
| `integracoes_inter` | 0 | credenciais Banco Inter (só via RPC) | Ajustes, Extratos |
| `orcamentos` | **0** | metas por categoria | **tela removida da navegação** (dados preservados) |
| `configuracoes` | 3 | saldo inicial legado | nenhum uso na UI (legado) |
| `regras` | 10 | regras legadas | nenhum uso na UI (legado) |
| `planejamento_meses` / `_itens` | 6 / 0 | planejamento antigo | nenhum uso na UI (legado) |

### Relacionamentos principais

```
empresas ──< empresa_membros >── auth.users        cargos ──< cargo_capacidades
   │                    └── papel → cargos.chave
   ├──< contas_bancarias ──< movimentacoes >── plano_contas (categoria_sugerida_id)
   ├──< plano_contas (parent_id → plano_contas, RESTRICT)
   │       ├──< regras_categorizacao (CASCADE)      └──< orcamentos (CASCADE)
   ├──< recorrentes ──< previstos (CASCADE)
   ├──< clientes ──< cobrancas (CASCADE) >── movimentacoes (SET NULL)
   │       └──< cliente_mensalidades (CASCADE) ──< cobrancas.mensalidade_id (SET NULL)
   ├──< pagamentos_processos ──< pagamentos_processos_parcelas (CASCADE)
   ├──< pagamentos_diarios        pagamentos_diarios_historico (sem FK, sobrevive à exclusão)
   └──< vendas, feriados, integracoes_inter, configuracoes, regras, planejamento_*
```

### Funções (RPC) e o que usa cada uma

| Função | Uso |
|---|---|
| `fn_categorizar_pendentes`, `fn_aprovar_lote`, `fn_semear_regras_do_historico`, `fn_normaliza_descricao` | Extratos (importar/revisar), Ajustes |
| `fn_gerar_cobrancas`, `fn_conciliar_cobrancas` | Receitas › Clientes, Dashboard |
| `fn_limpar_previstos_vencidos`, `fn_feriados_efetivos`, `fn_ajustar_dia_util` | Pagamentos, Ajustes |
| `fn_estornar_pagamento_diario` | Pagamentos › Pix (só master) |
| `fn_ajustar_saldo_inicial` | Dashboard (só master, com motivo) |
| `criar_empresa`, `fn_excluir_empresa`, `listar_membros`, `vincular_membro_por_email`, `definir_papel_membro`, `salvar_cargo`, `excluir_cargo`, `copiar_plano_contas` | Gestão › Empresas, Plano de contas |
| `listar_usuarios_gerenciaveis`, `fn_log_usuario` | Configurações › Usuários (registro de alterações) |
| `fn_rh_pagamentos_para_pix` | Pagamentos › Pix do dia (pagamentos diários do RH, só leitura) |
| `fn_rh_compromissos_financeiros` (+ `rh_data`, `rh_dia_util_ate`) | Dashboard e detalhamento de saídas: adiantamento, salário e pagamento diário do RH, por pessoa, projetados ou realizados (migração 48) |
| `fn_rh_totais_mensais` | Recorrência de Folha com valor do RH: salários, adiantamento, VT e VR somados por competência (migração 49) |
| `fn_cobrancas_da_venda` | Venda → cobranças: confere a soma das parcelas e grava tudo numa transação (migração 50) |
| `fn_membros_da_empresa` | "Cadastrado por" nas telas, sem precisar ser master (migração 50) |
| `fn_inter_status/salvar/toggle/remover` | Ajustes, Extratos |
| internas de RLS/gatilho | `is_master`, `tem_acesso_empresa`, `cargo_tem`, `papel_na_empresa`, `pode_*`, `fn_caminho_categoria`, `fn_categoria_por_caminho`, `fn_chave_estabelecimento`, `fn_dia_util*`, `fn_feriados_nacionais`, `fn_pascoa`, `fn_trgm_threshold` |

### Gatilhos e rotinas

- `pagamentos_diarios_trava` (BEFORE): Pix **pago** não pode ser excluído nem alterado; carimba `pago_em/pago_por`.
- `pagamentos_diarios_log` (AFTER): grava o histórico mensal com antes/depois e autor.
- `regra_categoria_mesma_empresa` e `set_atualizado_em` em `regras_categorizacao`.
- `pg_cron` **`apagar-previstos-vencidos`** (03:00): apaga entradas vencidas e saídas pagas de meses anteriores.
- Vercel Cron `/api/cron/inter-sync` (09:00 UTC) + funções `/api/usuarios` e `/api/inter/sync` (service role).

### Policies (RLS)

Leitura = membro da empresa (`tem_acesso_empresa`), exceto `pagamentos_diarios`/`_historico` (exige a
capacidade `pag_diario_gerir`). Escrita = `cargo_tem(empresa_id, <capacidade>)`:

| Capacidade | Tabelas |
|---|---|
| `mov_gerir` | movimentacoes, regras, regras_categorizacao, planejamento_* |
| `contas_gerir` | previstos, recorrentes, pagamentos_processos(+parcelas), bucket `comprovantes` |
| `clientes_gerir` | clientes, cobrancas |
| `plano_gerir` | plano_contas, orcamentos |
| `config_gerir` | contas_bancarias, feriados, configuracoes |
| `vendas_gerir` | vendas |
| `pag_diario_gerir` | pagamentos_diarios (leitura e escrita) |
| master | empresas, empresa_membros, perfis (+ regras globais) |

Storage: bucket privado `comprovantes` (pasta = empresa).

## 3. RH (`apatabasuxkgqxabuqdj`)

| Tabela | Linhas | Formato | Uso |
|---|---:|---|---|
| `funcionarios` | 58 | documento (`data` jsonb) + colunas de busca | quase todo o RH (benefícios, treino, repasse e rescisão ficam **dentro** do JSON) |
| `candidatos` | 106 | documento (+ `area`, `vaga`, `origem`, `status` — existem no banco, mas não nas migrations) | Recrutamento |
| `pagamentos` | 243 | documento | adiantamento/vale, salário legado, descontos de falta |
| `atestados` | 40 | documento | Atestados e faltas |
| `documentos` | 2 | documento (metadados) + bucket `documentos` | Documentos |
| `perguntas` | 7 | documento | Roteiro de entrevista |
| `treinamentos` | 0 | documento | Turmas |
| `pagamentos_diarios` | 13 | documento | Pagamento diário (RH) |
| `config` | 1 | um JSON com toda a configuração | Configurações, fechamentos, mapas de eventos |
| `extratos_mensais` / `folha_eventos` | 58 / 511 | relacional (oficial da contabilidade) | Extrato mensal, Folha de repasse |
| `folha_importacoes` | 0 | log de importação | Extrato mensal |
| `folhas` / `folha_itens` | 0 / 0 | legado (n8n) | leitura na Folha |
| `backups` | 17 | snapshots do n8n (23h) | nenhum uso na UI |
| `beneficios_mensais` / `pagamentos_beneficios` | 0 / 0 | modelo relacional nunca usado | nenhum |
| `app_state` | 0 | modo legado (uma linha JSON) | fallback do carregamento |

- **Sem functions, views ou triggers.**
- **Todas as policies são `authenticated → true`.** A restrição por empresa e por perfil
  (`app_metadata.perfil`/`empresa`) é **só de interface**; qualquer login do RH lê tudo pela API.
- Buckets privados: `documentos` e `extratos` (policies também abertas a qualquer autenticado).
- Única FK: `folha_eventos.extrato_id → extratos_mensais` e `folha_itens.folha_id → folhas` (CASCADE).

## 4. Dependências entre os sistemas (hoje e no protótipo)

| Tema | Financeiro | RH | Situação no protótipo |
|---|---|---|---|
| Login | Auth do projeto Financeiro | Auth do projeto RH | um login só; o RH é liberado por pessoa (`rh_acessos`) |
| Empresa | `empresas.id` (uuid) | texto no registro | mapa `EMPRESAS_DEMO` (nome igual nos dois lados) |
| Pix do dia | `pagamentos_diarios` (trava + auditoria) | `pagamentos_diarios` (JSON, pago reversível) | duas listas; o Pix do dia **lê** a do RH (`fn_rh_pagamentos_para_pix`), o RH não lê a do Financeiro |
| Custo de pessoal | categorias "Folha De Pagamento / …" (extrato) | salário, VT, VR, repasse, rescisão (JSON) | Dashboard mostra os dois lados **sem somar** |
| Perfis | cargos + capacidades (RLS) | perfil no metadata (só UI) | `rh_acessos` (perfil + empresa), aplicado também no banco (`rh_pode`) |

## 5. Achados de segurança (linter do Supabase, sem correção aplicada)

- **Financeiro:** 25 funções `SECURITY DEFINER` executáveis pelo papel `anon` (todas conferem
  `is_master`/`auth.uid()` por dentro, mas o ideal é `REVOKE EXECUTE … FROM anon`); `integracoes_inter`
  com RLS sem policy (intencional — só RPC); 2 funções sem `search_path` fixo; `unaccent`/`pg_trgm` no
  schema `public`; proteção contra senhas vazadas desligada.
- **RH:** proteção contra senhas vazadas desligada; RLS aberta (ver §3) — o maior risco ao consolidar.

## 6. Caminho recomendado para o banco (fora deste protótipo)

1. **Fase 1 (feito):** consolidar só a interface; bancos intactos; dados fictícios.
2. **Fase 2 (em andamento — [PRODUCAO-RH.md](PRODUCAO-RH.md)):** o RH vai para o projeto Financeiro, em
   tabelas `rh_*` com as mesmas colunas (`42_rh_modulo.sql`), login único, acesso por pessoa
   (`rh_acessos`) e RLS por empresa/perfil (`rh_pode`). O Pix do dia lê os pagamentos diários do RH
   (`43_pix_ve_pagamentos_rh.sql`). Dados copiados por `scripts/rh/copiar-do-crm-rh.mjs`. Cada empresa
   diz se usa o Financeiro, o RH ou os dois (`empresas.modulos`, `criar_empresa(p_nome, p_modulos)`,
   `fn_definir_modulos_empresa`), a lista de empresas do RH vem de `fn_empresas_rh` e o acesso ao RH
   pode ser de várias empresas (`rh_acessos.empresas`; `44_empresas_por_modulo.sql`). A administração
   (Empresas e cargos = `perfis.is_master`) é ligada por pessoa em Usuários › Acessos, pela
   `fn_definir_master`, que não deixa ninguém tirar a própria nem o sistema ficar sem administrador
   (`45_administracao_por_usuario.sql`). Tudo que muda num login (criação, cadastro, acessos, administração,
   exclusão) vai para `usuarios_historico`, que só aceita inclusão e não tem chave estrangeira, para
   sobreviver à exclusão; a exclusão de login é "suave" no Auth e some da listagem
   (`46_historico_usuarios.sql`).
3. **Fase 3:** trocar o texto da empresa por `empresa_id` (uuid), unificar de fato as duas listas de Pix e
   desligar o projeto antigo do RH.
