# Zaytan Hub — Consolidação Financeiro + RH + Gestão (protótipo)

> Protótipo de um sistema organizacional único, construído a partir do **Zaytan Hub Financeiro** (base e
> identidade visual) e do **CRM · RH** (trazido integralmente). Roda com **dados fictícios**; o Supabase
> real não é lido nem gravado. Nome mantido: *Zaytan Hub Financeiro*.
>
> Documentos relacionados: [SUPABASE-MAPA.md](SUPABASE-MAPA.md) · [ROADMAP-PROJECAO-COMERCIAL.md](ROADMAP-PROJECAO-COMERCIAL.md)

**Como rodar:** `npm ci` → `npm run dev` → <http://localhost:8080>. Na tela de login há um botão por perfil
fictício (senha `demo1234`). O menu do usuário tem **Restaurar dados de demonstração**.

---

## 1. Diagnóstico

### Financeiro (pasta `Financeiro`, repositório `ZaytanAssessoria/Financeiro`)

- React 19 + TanStack Start/Router (SPA) + TanStack Query + shadcn/ui + Tailwind 4, publicado na Vercel.
- Supabase próprio (`ieqkhecsyarszhhonaor`), multiempresa com RLS por empresa e **cargos configuráveis**
  (capacidades como `mov_gerir`, `contas_gerir`, `pag_diario_gerir`).
- Coração do sistema: **extrato → revisão → aprovação (aprende regras) → relatórios**, com subsistemas de
  contas a pagar (recorrências → previstos), cobranças de clientes conciliadas pelo extrato, processos
  parcelados, Pix do dia auditado, vendas e integração com o Banco Inter.
- Toda a camada de dados está concentrada em `src/lib/queries.ts` (132 chamadas ao Supabase) — o que
  permitiu trocar o banco por um simulado sem mexer nas telas.
- 18 páginas no menu, 5 rotas que só redirecionavam, 185 testes unitários de regras de dinheiro/datas.

### CRM · RH (repositório `ZaytanAssessoria/CRM_RH`)

- React 18 + Vite em **JavaScript puro, um arquivo de 11.380 linhas** (`RHApp.jsx`) mais o módulo de regras
  da folha (`folha/regras.js`). O README descreve uma arquitetura modular em TypeScript **que não existe**.
- Supabase próprio (`apatabasuxkgqxabuqdj`): tabelas-documento (JSON por registro) + tabelas oficiais do
  extrato da contabilidade. **Sem funções/triggers; RLS aberta** a qualquer usuário logado.
- Navegação por estado interno (sem URLs); permissões (perfil e empresa) aplicadas **só na interface**.
- 440 casos de conferência de cálculo embutidos + 138 testes das regras da folha.
- Visual próprio (Tailwind 3, paleta slate/azul), diferente do Financeiro.

### O que isso significa para a consolidação

1. Os sistemas **não compartilham dados, login nem modelo de empresa** — a consolidação é de interface
   (Fase 1); banco e autenticação únicos ficam para fases seguintes (ver [SUPABASE-MAPA.md](SUPABASE-MAPA.md) §6).
2. O RH foi **preservado inteiro** (toda a lógica e as 11 mil linhas) e passou a ser dirigido pelas rotas do
   shell unificado, em vez de reescrito — reescrever 11 mil linhas de regras de folha seria o maior risco
   de perda de funcionalidade.
3. A identidade visual do Financeiro virou a do produto: o RH foi convertido para os mesmos tokens (cores,
   fontes, raios, sombras, botões, abas, KPIs, modais, tabelas).

---

## 2. Inventário

### 2.1 Financeiro

| Sistema | Tela (rota antiga) | Funcionalidade | Dados utilizados | Pode consolidar? | Observação |
|---|---|---|---|---|---|
| Fin | Dashboard (`/`) | saldo atual/consolidado, período, entradas×saídas, saldo diário, despesas por categoria (drill-down), próximos vencimentos, boletos do mês, últimas entradas/saídas, saldo Inter × app, **ajuste de saldo (master)**, PDF | movimentacoes, contas_bancarias, previstos, cobrancas, inter | Sim | vira **Gestão › Dashboard › Visão geral** |
| Fin | Relatórios (`/relatorios`) | 6 tipos × sintético/analítico, filtros completos, matriz mês×categoria, **Excel multi-abas, PDF combinado, impressão** | movimentacoes (competência), plano_contas | Sim | vira **Dashboard › Análises financeiras** |
| Fin | Movimentações (`/movimentacoes`) | extrato editável, filtros, abas entradas/saídas, lote (recategorizar/excluir), aviso de duplicata, trava de FITID, Excel | movimentacoes, plano_contas, contas | Sim | **Caixa › Movimentações** (+ PDF) |
| Fin | Fluxo de Caixa (`/fluxo-caixa`) | saldo acumulado, entradas×saídas diárias, KPIs do período, **projeção** (horizontes, saldo mínimo, alerta de negativo), Excel/PDF | movimentacoes, previstos, cobrancas | Sim | **Caixa › Fluxo realizado** e **Caixa › Projeção de caixa** |
| Fin | Importar + IA (`/importar`) | OFX/PDF C6/CSV/Excel, detecção de conta, dedup por FITID e conteúdo, acerto de saldo pelo extrato, sync Banco Inter, envio para revisão | movimentacoes, contas_bancarias, RPC categorizar | Sim | **Extratos › 1. Importar** |
| Fin | Revisão (`/revisao`) | fila de pendentes por lote, sugestão, aprovar (aprende regra), descartar, re-sugerir, aprender do histórico | movimentacoes pendentes, RPCs | Sim | **Extratos › 2. Revisar e classificar** |
| Fin | Conferir extrato (`/conferir-extrato`) | arquivo × app: conferem/faltam/sobram/divergentes + saldo banco × app | movimentacoes, contas | Sim | **Extratos › 3. Conferir com o banco** |
| Fin | Contas a Pagar (`/contas-a-pagar`) | mês, status pago/aberto/vencida, pagar (1 ou lote), reabrir, excluir ocorrência/regra, importar planilha, limpar duplicatas, nova conta | previstos, recorrentes | Sim | **Pagamentos › Contas do mês** |
| Fin | Recorrentes (`/recorrentes`) | CRUD de regras (entrada e saída), modos de vencimento, boletos/carnê, prévia, propagação da edição | recorrentes → previstos | Sim | **Pagamentos › Recorrências** |
| Fin | Processos (`/processos`) | acordos parcelados, registrar parcela, histórico, **comprovantes** | pagamentos_processos(+parcelas), storage | Sim | **Pagamentos › Dívidas e acordos** |
| Fin | Pagamentos Diários (`/pagamentos-diarios`) | Pix do dia, chave validada, pago imutável, estorno (master), histórico auditado, Excel | pagamentos_diarios(+histórico) | Sim | **Pagamentos › Pix do dia** |
| Fin | Clientes (`/clientes`) | mensalidades, cobranças geradas e conciliadas pelo extrato, inadimplência, faixa de 12 meses | clientes, cobrancas | Sim | **Receitas e vendas › Clientes e cobranças** |
| Fin | Vendas (`/vendas`) | registro de vendas (fora do saldo), KPIs, filtros, Excel | vendas | Sim | **Receitas e vendas › Vendas** |
| Fin | Plano de Contas (`/plano-de-contas`) | árvore, competência por categoria, fora dos relatórios, copiar de outra empresa | plano_contas | Não | mantida (Financeiro) |
| Fin | Ajustes (`/ajustes`) | contas bancárias, integração Inter, regras de categorização, feriados e dia útil | contas, regras, feriados, RPCs | Não | mantida (Financeiro) |
| Fin | Orçamento (`/orcamento`) | meta por categoria × realizado | orcamentos (**0 linhas em produção**) | — | **removida da navegação** (§7) |
| Fin | Usuários (`/usuarios`) | criar/editar logins (master/admin) | RPC + /api/usuarios | Não | **Gestão › Usuários** |
| Fin | Empresas (`/empresas`) | empresas, membros, cargos e capacidades (master) | empresas, membros, cargos | Não | **Gestão › Empresas e cargos** |
| Fin | Login | e-mail/senha | Auth | — | mantido (+ contas de demonstração) |
| Fin | Conciliação, Entradas, Saídas, Previstos, Saldo diário | só redirecionavam | — | — | redirecionamentos mantidos/atualizados |

### 2.2 RH

| Sistema | Tela (módulo › sub) | Funcionalidade | Dados utilizados | Pode consolidar? | Observação |
|---|---|---|---|---|---|
| RH | Dashboard | 15 KPIs clicáveis, painéis de pendências (rescisões, pagamentos, VT, treinamento) | funcionários, pagamentos, candidatos, atestados, turmas | Não | **RH › Painel do RH** |
| RH | Dashboard de Recrutamento (perfil recrutamento) | KPIs e funil do recrutamento | candidatos | Não | mesmo lugar, conforme o perfil |
| RH | Funcionários › Lista | filtros avançados, cadastro completo (5 abas), ViaCEP, importação inteligente, exclusão em cascata, efetivar/estender treino, exportar | funcionarios (+ pagamentos, atestados, documentos) | Não | **RH › Funcionários › Lista** |
| RH | Funcionários › Documentos | pastas por funcionário, upload/substituir/histórico | documentos + bucket | Não | **RH › Funcionários › Documentos** |
| RH | Funcionários › Treinamento | painel de trainees (cards/lista/agenda), editar, efetivar, encerrar | funcionarios.treinamento | Sim | **RH › Treinamento › Trainees** |
| RH | Funcionários › Turmas | custo por turma (VT + outros) | treinamentos | Sim | **RH › Treinamento › Turmas** |
| RH | Folha › Proc. Treinamento | cálculo por dias reais, pagar salário/VT/VR do trainee | funcionarios.treinamento/benefícios | Sim | **RH › Treinamento › Cálculo e pagamento** |
| RH | Recrutamento › Candidatos | kanban/lista, filtros, importação, contratação automática, entrevistas, WhatsApp, PDF | candidatos, funcionarios | Não | **RH › Recrutamento › Candidatos** |
| RH | Recrutamento › Banco de Talentos | candidatos 4+ estrelas | candidatos | Não | **RH › Recrutamento › Banco de talentos** |
| RH | Recrutamento › Agenda e Entrevistas | agenda global (entrevistas, pagamentos, treinos, rescisões, atestados) | vários | Não | **RH › Recrutamento › Agenda e entrevistas** |
| RH | Recrutamento › Roteiro | banco de perguntas | perguntas | Não | **RH › Recrutamento › Roteiro** |
| RH | Atestados e Faltas | registros, tipos personalizados, anexos, descontos, gera linhas de falta, "Aplicar no VR" | atestados, pagamentos, config | Não | **RH › Atestados e faltas** |
| RH | Folha › Extrato Mensal | importação de PDF oficial (OCR), versões, conferência, holerites, significado de eventos | extratos_mensais, folha_eventos, bucket extratos | Não | **RH › Folha › Extrato mensal** |
| RH | Folha › Folha de Repasse | saldos por pessoa, complementos, ajustes, conciliações, pagamentos com alocação, fechamento de competência, referências, anual | funcionarios.repasse, extratos, pagamentos, config | Não | **RH › Folha › Folha de repasse** |
| RH | Folha › Benefícios (VT/VR/Vale/Geral) | controles e pagamentos de VT, VR, vale, importação da relação de líquidos | funcionarios.beneficios, pagamentos | Parcial | **RH › Folha › Benefícios** (redundância com Repasse › Adiantamento documentada) |
| RH | Folha › Rescisões | cálculo, parcelas, reabrir/reativar (admin), carta de demissão, importação da folha de rescisão | funcionarios.rescisao | Não | **RH › Folha › Rescisões** |
| RH | Folha › Pagamento Diário | Pix/dinheiro avulsos com chave do cadastro | pagamentos_diarios (RH) | Sim (futuro) | **RH › Folha › Pagamento diário** (redundância com o Pix do Financeiro) |
| RH | Indicadores | headcount, turnover, por empresa/departamento, gastos | funcionarios | Sim | **Gestão › Dashboard › Pessoas › Indicadores** |
| RH | Relatórios (9 tipos + conferência de cálculos) | tabelas exportáveis (Excel/CSV/PDF/imprimir) | funcionarios, pagamentos | Sim | **Gestão › Dashboard › Pessoas › Relatórios** |
| RH | Configurações | geral, RH (cargos/salários), benefícios, jornada, financeiro, zerar dados | config | Não | **RH › Configurações do RH** |
| RH | Menu lateral, cabeçalho, busca global, notificações | navegação própria | — | Sim | substituídos pelo shell unificado; busca e notificações preservadas na barra do RH |

---

## 3. Redundâncias encontradas

| Grupo | O que o código mostrou | Decisão |
|---|---|---|
| **Movimentações × Fluxo de Caixa** | O Fluxo repetia, só para leitura e sem filtros, a mesma lista de lançamentos da tela Movimentações; o que ele tinha de único eram os gráficos, os KPIs do período e a projeção. | **Uma tela: Caixa**, com 3 abas (Movimentações · Fluxo realizado · Projeção de caixa). A lista duplicada saiu do Fluxo; o PDF da lista passou para Movimentações (agora respeitando os filtros). |
| **Recorrentes × Contas a Pagar × Processos × Pix do dia** | Os quatro modelam "algo a pagar com data e status", em 3 modelos de dados; Contas a Pagar e Recorrentes rodam a mesma reconciliação e o "Nova conta" é uma cópia reduzida do diálogo de Recorrentes; processos e Pix não apareciam em nenhuma visão de vencimentos. | **Uma tela: Pagamentos**, com 5 abas. A nova **Visão geral** junta as três fontes numa agenda única (vencidas + próximos 7/15/30 dias), respeitando as permissões de cada fonte. As regras e travas de cada modelo ficaram intactas. |
| **Importar × Conferir extrato × Revisão ("divisão")** | Mesmo parser e mesma chave de conciliação; a Revisão é o passo seguinte da importação. **Não existe função de dividir/ratear transação** no código — a "divisão" é a classificação por categoria (pai/filho) na revisão. | **Uma tela: Extratos**, com os 3 passos em abas numeradas e contador de pendentes. |
| **Dashboard × Relatórios** | Ambos mostram entradas/saídas/resultado e despesas por categoria; o Dashboard tem saldo, projeção e pendências; Relatórios tem as análises e as exportações analítica/sintética. | **Dashboard da Gestão** com abas Visão geral · Análises financeiras · Pessoas (RH). Nenhuma exportação foi perdida. |
| **Indicadores × Relatórios do RH** | Duas entradas de menu para análises de pessoas. | Viraram a aba **Pessoas** do Dashboard (seletor Indicadores/Relatórios). |
| **Treinamento espalhado (RH)** | Funcionários › Treinamento, Funcionários › Turmas e Folha › Proc. Treinamento usam o mesmo `f.treinamento`. | **Uma seção: RH › Treinamento** (Trainees · Turmas · Cálculo e pagamento). |
| **Ajustes × Plano de Contas** | Ajustes tinha um resumo de categorias só para leitura que leva ao Plano de Contas. | Mantido (é um atalho), sem nova duplicação. |
| **Pix do Financeiro × Pagamento Diário do RH** | Mesmo conceito ("Pix a fazer no dia"), mas em **bancos diferentes** e com regras diferentes (no Financeiro, pago é imutável e auditado; no RH, reversível e com chave puxada do cadastro). | **Mantidos**, cada um no seu pilar. Unificar exige migração de dados (Fase 3). |
| **Vale (Benefícios) × Repasse › Adiantamento (RH)** | Mesmo lançamento, com checagens diferentes (o Vale não confere permissão nem competência fechada). | **Mantidos** — consolidar exige alinhar as travas; documentado como próxima etapa. |
| **Três formas de mudar o saldo inicial** (Ajustes, Importar, Dashboard) | Só a do Dashboard é auditada. | Mantidas; recomendação: centralizar na do Dashboard (auditada). |
| **Duas fórmulas de "saldo projetado"** (Dashboard × Fluxo) | Escopos diferentes (vencidas incluídas ou não; cobranças incluídas ou não). | Mantidas e **rotuladas como projeção**; recomendação: unificar a regra numa próxima etapa. |

---

## 4. Nova arquitetura

```text
Zaytan Hub (Zaytan Hub Financeiro)
│
├── Financeiro
│   ├── Caixa ................ Movimentações · Fluxo realizado · Projeção de caixa
│   ├── Extratos ............. 1. Importar · 2. Revisar e classificar · 3. Conferir com o banco
│   ├── Pagamentos ........... Visão geral · Contas do mês · Recorrências · Dívidas e acordos · Pix do dia
│   ├── Receitas e vendas .... Clientes e cobranças · Vendas
│   ├── Plano de contas
│   └── Ajustes
│
├── RH
│   ├── Painel do RH
│   ├── Funcionários ......... Lista de funcionários · Documentos
│   ├── Treinamento .......... Trainees · Turmas · Cálculo e pagamento
│   ├── Recrutamento ......... Candidatos · Banco de talentos · Agenda e entrevistas · Roteiro
│   ├── Atestados e faltas
│   ├── Folha de pagamento ... Extrato mensal · Folha de repasse · Benefícios · Rescisões · Pagamento diário
│   └── Configurações do RH
│
└── Gestão
    ├── Dashboard ............ Visão geral · Análises financeiras · Pessoas (Indicadores · Relatórios)
    ├── Usuários
    └── Empresas e cargos
    (futuro, documentado: Projeção comercial — ver ROADMAP-PROJECAO-COMERCIAL.md)
```

- **Menu lateral:** 16 itens em 3 grupos recolhíveis (antes: 18 itens no Financeiro + 11 no RH, em dois
  sistemas). O grupo da tela atual abre sozinho; cada item respeita cargo e perfil do RH.
- **Abas na URL** (`?aba=`), então qualquer visão pode ser compartilhada por link.
- **Permissões:** as capacidades do Financeiro continuam valendo por aba. O pilar RH é liberado **pessoa
  a pessoa** (tabela `rh_acessos`, em Gestão › Usuários), com o **perfil e a empresa do RH** — que o
  banco também aplica. Ver [PRODUCAO-RH.md](PRODUCAO-RH.md).
- **Entrada por cargo:** quem não usa o Dashboard cai direto na sua área (Pix → Pagamentos; RH → Painel do RH).
- **Realizado × projetado:** a projeção de caixa tem aba própria com aviso explícito; o KPI do painel diz
  "PROJEÇÃO"; a projeção comercial futura terá camada separada (contrato em `src/modulos/gestao/projecao-comercial`).

---

## 5. Matriz de preservação

| Funcionalidade antiga | Nova localização | Status |
|---|---|---|
| Dashboard (Financeiro) | Gestão › Dashboard › Visão geral | Consolidada |
| Relatórios (Financeiro) | Gestão › Dashboard › Análises financeiras | Renomeada/consolidada |
| Movimentações | Financeiro › Caixa › Movimentações | Consolidada (+ PDF filtrado) |
| Fluxo de Caixa (realizado) | Financeiro › Caixa › Fluxo realizado | Consolidada |
| Fluxo de Caixa (projeção) | Financeiro › Caixa › Projeção de caixa | Consolidada, rotulada como projeção |
| Saldo diário (redirect) | Gestão › Dashboard › Visão geral | Mantida |
| Importar + IA / Conciliação (redirect) | Financeiro › Extratos › Importar | Consolidada |
| Revisão (inclusive `?lote=`) | Financeiro › Extratos › Revisar e classificar | Consolidada |
| Conferir extrato | Financeiro › Extratos › Conferir com o banco | Consolidada |
| Contas a Pagar / Previstos (redirect) | Financeiro › Pagamentos › Contas do mês | Consolidada |
| Recorrentes | Financeiro › Pagamentos › Recorrências | Consolidada |
| Processos | Financeiro › Pagamentos › Dívidas e acordos | Consolidada |
| Pagamentos Diários (Pix) | Financeiro › Pagamentos › Pix do dia | Consolidada |
| — (novo agrupamento, sem dado novo) | Financeiro › Pagamentos › Visão geral | Criada a partir dos dados existentes |
| Clientes / Cobranças | Financeiro › Receitas e vendas › Clientes e cobranças | Consolidada |
| Vendas | Financeiro › Receitas e vendas › Vendas | Consolidada |
| Entradas / Saídas (redirects) | Financeiro › Caixa › Movimentações | Mantida |
| Plano de Contas | Financeiro › Plano de contas | Movida |
| Ajustes (contas, Inter, regras, feriados) | Financeiro › Ajustes | Movida |
| Orçamento | — (dados, hooks e testes preservados) | **Removida da navegação** |
| Usuários | Gestão › Usuários | Movida |
| Empresas, membros e cargos | Gestão › Empresas e cargos | Movida (+ capacidade "Acessar o RH") |
| Ajuste de saldo (master) | Gestão › Dashboard › Visão geral | Mantida |
| Dashboard do RH / Dashboard de Recrutamento | RH › Painel do RH | Mantida |
| Funcionários (lista, cadastro, importação) | RH › Funcionários › Lista | Mantida |
| Documentos | RH › Funcionários › Documentos | Mantida |
| Treinamento (painel) | RH › Treinamento › Trainees | Consolidada |
| Turmas de Treinamento | RH › Treinamento › Turmas | Consolidada |
| Processamento de Treinamento | RH › Treinamento › Cálculo e pagamento | Consolidada |
| Candidatos / Banco de Talentos / Agenda / Roteiro | RH › Recrutamento › (abas) | Mantidas |
| Atestados e Faltas | RH › Atestados e faltas | Mantida |
| Extrato Mensal | RH › Folha › Extrato mensal | Mantida |
| Folha de Repasse (total, adiantamento, referências, anual) | RH › Folha › Folha de repasse | Mantida |
| Benefícios (VT, VR, Vale, geral) | RH › Folha › Benefícios | Mantida |
| Rescisões | RH › Folha › Rescisões | Mantida |
| Pagamento Diário (RH) | RH › Folha › Pagamento diário | Mantida (redundância documentada) |
| Indicadores de RH | Gestão › Dashboard › Pessoas › Indicadores | Movida |
| Relatórios de RH + Conferência de cálculos | Gestão › Dashboard › Pessoas › Relatórios | Movida |
| Configurações do RH | RH › Configurações do RH | Mantida |
| Busca global de funcionários + notificações do RH | Barra do RH (topo de cada tela do RH) | Mantida |
| Perfis do RH (admin, rh, financeiro, recrutamento) e restrição por empresa | Menu e telas do RH | Mantida |
| Login | Login (com contas de demonstração) | Mantida |

---

## 6. Alterações realizadas

**Base e dados fictícios**

- Base copiada do Financeiro para este repositório (sem `.git`, `.env.production` e extratos reais).
- `src/lib/mock/` — banco simulado com as mesmas tabelas dos dois projetos (`rh.*` para o RH), cliente
  compatível com o supabase-js, **policies (RLS) espelhadas**, gatilhos (trava/histórico do Pix),
  cascatas, unicidades, as **25 RPCs** reimplementadas com as mesmas regras, auth simulado, storage em
  memória, versões simuladas de `/api/usuarios` e `/api/inter/sync`, e sementes fictícias relativas à data
  de hoje (6 meses de extrato, clientes, contas, Pix, acordos, vendas; 24 funcionários, 18 candidatos,
  extratos oficiais de 2 competências, repasses, atestados, rescisões, turma).
- `src/lib/supabase.ts` — `VITE_DATA_MODE` (padrão **mock**; `real` só se pedido explicitamente).
- `.env.example` sem o endereço/chave do projeto real; `vercel.json` **sem o cron** de sincronização do
  Banco Inter (um deploy do protótipo não deve tocar dado real); favicon; documentos antigos do
  Financeiro movidos para `docs/legado/`.
- `src/lib/mock/mock.test.ts` — 14 testes do simulador (RLS por cargo, trava do Pix, aprendizado, cobranças, cascatas, unicidade, feriados, namespace do RH).

**Navegação e shell**

- `src/lib/navegacao.ts` — menu dos 3 pilares, abas das telas consolidadas, mapa rota ↔ módulo do RH e perfis do RH.
- `src/lib/permissoes.ts` — `rh_acessar` (derivada do acesso ao RH, fora do catálogo de cargos), rota liberada por qualquer uma de várias capacidades,
  casamento de prefixo em fronteira de segmento, entrada por cargo.
- `src/components/AppShell.tsx` — modo embutido (`TelaEmbutida`), barra de abas, trilha Pilar › Tela,
  selo de protótipo, menu do usuário (restaurar dados), seletor de empresa do RH no cabeçalho (sincronizado com o do Financeiro), rodapé.
- `src/components/AppSidebar.tsx` — 3 grupos recolhíveis, filtros por cargo e perfil do RH.
- `src/components/AbasPagina.tsx`, `src/lib/use-abas.ts` — abas na URL filtradas por permissão.

**Rotas**

- Novas: `/financeiro/{caixa,extratos,pagamentos,receitas,plano-de-contas,ajustes}`, `/gestao/{usuarios,empresas}`,
  `/rh` (layout) e `/rh/{funcionarios,treinamento,recrutamento,atestados,folha,configuracoes}`, `/` (Dashboard da Gestão).
- As 22 URLs antigas redirecionam para a aba correspondente (inclusive `/revisao?lote=`). Todas usam
  `<Navigate>` no componente, como o Financeiro original. Um `redirect` no `beforeLoad` corria com a
  hidratação da página pré-renderizada e gerava o erro React #418 em cerca de 1 a cada 10 cargas
  (medido: 9 em 95 antes, 0 em 208 depois).
- Telas do Financeiro movidas para `src/modulos/financeiro/telas/` e `src/modulos/gestao/telas/` (sem mudar a lógica).

**Telas**

- Fluxo de Caixa com `visao="realizado" | "projecao"` (aviso de projeção; lista duplicada trocada por atalho;
  subtítulo do PDF corrigido).
- Movimentações: botão **PDF** da lista filtrada.
- Nova `visao-pagamentos.tsx` (agenda unificada de saídas).
- Nova `ResumoPessoas.tsx` (Pessoas na Visão geral da Gestão, mesmas definições do painel do RH).
- Painel: link "Ver todos" dos vencimentos corrigido (ia para Movimentações); KPI rotulado "PROJEÇÃO";
  seletores de mês mais largos; cartão de saldo que era cortado no celular (grade sem `min-width: 0`).
- Login: contas de demonstração, texto dos 3 pilares, sem alegações que o sistema não cumpre.

**RH**

- `src/modulos/rh/RHApp.jsx` + `folha/regras.js` trazidos do CRM_RH; `RHApp` ganhou o modo **embutido**
  (módulo/sub vindos da rota, `irPara` → navegação de rota, barra com busca/notificações/status).
- `scripts/rh/converter-visual.mjs` — conversão reproduzível das cores do RH para os tokens do Financeiro
  (2.238 trocas; idempotente) + ajustes manuais nos componentes-base (Btn, Card, Kpi, Tabs, Modal, PageHeader, tabelas fixas).
- `src/modulos/rh/ModuloRH.tsx` — o RH é carregado sob demanda (pacote separado).
- Botões de ação principal e seletores ativos do RH em "tinta" (preto), KPIs informativos sem laranja —
  o laranja fica para destaques, como no Financeiro.
- Correções: KPI com tom "rose" sem classe; atalho "Entrevistas" do painel apontava para uma sub-aba
  inexistente; filtro "Pendentes/Pagos" do VT derrubava a tela; horários da jornada viravam 0.
- `scripts/rh/*.mjs` — testes do RH apontando para a nova pasta e incluídos no `npm test`.
- Autotestes do RH (dentro do `RHApp.jsx`): os trechos de relatórios reais da contabilidade traziam nomes,
  CPFs e RGs de funcionários — trocados por fictícios (com CPFs de dígito válido). Valores, datas, códigos
  de verba e layout ficaram iguais, então os 440 cálculos continuam conferindo o mesmo formato real.
- Token novo `--warning-ink` (texto de alerta legível) em `src/styles.css`.

**Documentação e preparação**

- `docs/CONSOLIDACAO.md` (este), `docs/SUPABASE-MAPA.md`, `docs/ROADMAP-PROJECAO-COMERCIAL.md`.
- `src/modulos/gestao/projecao-comercial/contrato.ts` (+ testes) — só contrato, desligado.
- `supabase/42_rh_modulo.sql` e `43_pix_ve_pagamentos_rh.sql` — RH no banco do Financeiro e Pix do dia
  lendo os pagamentos diários do RH (ver [PRODUCAO-RH.md](PRODUCAO-RH.md)).
- `scripts/e2e/` — testes de ponta a ponta no Chrome (`npm run test:e2e`, `npm run test:e2e:interacoes`)
  e um servidor estático para testar o build como na Vercel.

---

## 7. Funcionalidades removidas

| O que era | Por que saiu | O que substitui / como a capacidade foi preservada |
|---|---|---|
| **Tela Orçamento** (`/orcamento`, item de menu) | Pedido do escopo; a análise confirmou que **nenhuma outra tela, relatório, projeção ou API** usa `orcamentos`, e a tabela tem **0 linhas** em produção. | A URL leva ao Dashboard. **Tabela, hooks (`useOrcamentos`…), `lib/orcamento.ts` e seus 11 testes foram mantidos** — reativar a tela é trazer um arquivo de volta. |
| Lista de lançamentos repetida dentro do Fluxo de Caixa | Era uma cópia só-leitura, sem filtros, da lista de Movimentações. | Aba **Movimentações** ao lado (com filtros e edição); o **PDF** da lista foi para lá; o Excel/PDF completos continuam no Fluxo realizado. |
| Abas internas "Realizado/Projeção" do Fluxo | Viraram abas da página Caixa. | Mesmo conteúdo, agora com separação explícita. |
| Menu lateral, cabeçalho e submenu próprios do RH | Substituídos pelo shell único. | Menu unificado + abas; **busca global e notificações do RH** continuam na barra do RH. |
| Itens de menu "Indicadores" e "Relatórios" do RH | Consolidados na análise gerencial. | Gestão › Dashboard › Pessoas. |
| Campo de busca do cabeçalho do Financeiro | **Não fazia nada** (sem estado nem ação). | Trilha "Pilar › Tela"; a busca de funcionários do RH segue funcionando. |
| Selos "SOC 2 Ready / SSO habilitado" e banco real citado no login | Alegações que o sistema não cumpre. | Texto dos três pilares. |

Nenhuma regra de negócio, cálculo, trava ou tabela foi removida.

---

## 8. Roadmap

Resumo (detalhes em [ROADMAP-PROJECAO-COMERCIAL.md](ROADMAP-PROJECAO-COMERCIAL.md)):

1. **Projeção comercial (futuro, não implementado):** vendas do CRM Comercial/Revisional → vendido,
   recebido, em aberto, por vendedor, comissão estimada, custos futuros — **sempre separado do realizado**.
   O realizado só muda quando o dinheiro aparece no extrato.
2. **Banco e login únicos** (Fase 2/3, [SUPABASE-MAPA.md](SUPABASE-MAPA.md) §6): Auth do Financeiro como login do
   Zaytan Hub; RH num schema `rh` com `empresa_id` e RLS por capacidade.
3. **Redundâncias que dependem de dados:** unificar Pix do Financeiro × Pagamento diário do RH; alinhar
   Vale × Repasse › Adiantamento; uma única regra de "saldo projetado"; um único ponto (auditado) para
   mexer no saldo inicial.
4. **Custo de pessoal no Financeiro:** usar os itens da Folha de Repasse (`itensDaReferencia`) e o extrato
   oficial como fonte da conciliação com as categorias "Folha De Pagamento" — sem somar os dois.
5. **Segurança:** RLS por empresa no RH; revogar `EXECUTE` de `anon` nas funções `SECURITY DEFINER`;
   proteção contra senhas vazadas.
6. **Pendências do RH que dependem do banco:** criar por migration as colunas de `candidatos` que o app já
   grava; RLS por empresa (ver §9 e o mapa do banco).
7. **Qualidade:** passar o Prettier no repositório (o lint do CI é só informativo por causa disso) e, com o
   tempo, dividir o `RHApp.jsx` em módulos — os testes do RH dependem de âncoras de texto nesse arquivo
   (`scripts/rh/rodar-conferencia.mjs`), então a divisão deve começar pelas regras puras.

---

## 9. Validação

| Verificação | Resultado |
|---|---|
| Typecheck do app (`tsc --noEmit`) | ✅ sem erros |
| Build de produção (`vite build` + pré-renderização) | ✅ (RH em pacote separado, carregado sob demanda) |
| Testes unitários (`vitest`) | ✅ 23 arquivos, 280 testes (Financeiro original, simulador do banco, acesso ao RH por pessoa, Pix × RH, cliente do RH, empresas do RH, permissões/navegação, período do dashboard, compromissos realizado × projetado, funcionalidades opcionais, contrato da projeção) |
| Conferência de cálculos do RH (`scripts/rh/rodar-conferencia.mjs`) | ✅ 440/440 — igual ao original |
| Regras da folha (`scripts/rh/testar-regras.mjs`) | ✅ 138/138 — igual ao original |
| Navegação ponta a ponta no build de produção (`npm run test:e2e`) | ✅ 98/98: 7 perfis fictícios com entrada, menu e bloqueios esperados; todas as telas e abas com o Master; as 22 URLs antigas; nenhum erro de console |
| Fluxos reais (`npm run test:e2e:interacoes`) | ✅ 44/44: aprovar revisão em lote (e aprender regras), pagar Pix com auditoria, cadastrar funcionário, filtro do VT, jornada, RH restrito à Laportec, Operador sem Ajustes, Pix do dia vendo o RH (e o RH sem ver o Pix), master liberando o RH para uma pessoa, RH separado por empresa (Laportec 13 · Zaytan 4 · todas 22) e o Financeiro acompanhando a troca, empresa só do RH, RH em duas empresas, login só do RH e administração dada a outra pessoa (sem poder tirar a própria), exclusão de login com o registro de alterações mantido |
| Celular (390 px) | ✅ Dashboard, Pagamentos, Caixa, RH › Folha e RH › Recrutamento sem rolagem horizontal |
| Modo escuro | ✅ RH e Pagamentos conferidos por captura de tela |
| URLs antigas × hidratação | ✅ 0 erros em 208 cargas completas (22 URLs antigas e 4 diretas, 8 vezes cada) |
| Autenticação e permissões | ✅ cobertas pelos testes do simulador e pelos perfis na navegação |
| Supabase real | ✅ **nenhuma escrita**: só consultas de catálogo/linter; o app usa o banco simulado por padrão |

O Chrome instalado na máquina é usado pelos testes ponta a ponta (`CHROME_PATH` para outro caminho).
Para o build de produção: `npm run build`, `node scripts/e2e/servir-dist.mjs dist/client 4173` e
`npm run test:e2e -- http://127.0.0.1:4173`.

### Bugs do RH encontrados na auditoria

| Bug | Situação |
|---|---|
| Kpi com tom "rose" gerava classe `undefined` | corrigido |
| Atalho "Entrevistas" do painel ia para uma sub-aba inexistente | corrigido (vai para a Agenda) |
| Controle de VT quebra ao filtrar "Pendentes"/"Pagos" (variável usada antes de declarada) | corrigido (só reordenação; regra intacta) |
| Jornada nas Configurações: horário "08:30" vira 0 | corrigido (campos de horário gravam texto) |
| Upsert de `candidatos` grava colunas que as migrations não criam (no banco real elas existem) | documentado |
| Toda permissão do RH é só de interface (RLS aberta) | documentado (Fase 3) |

---

## 10. Segunda rodada — reorganização Gestão · Financeiro · RH (17/09/2026)

A primeira rodada juntou os dois sistemas. Esta arrumou a casa: tirou caminho repetido, deu um período só
ao Dashboard e fez o RH aparecer no Financeiro sem ninguém redigitar nada.

### 10.1 Redundâncias desta rodada

| Encontrado | O que o código mostrava | Decisão |
|---|---|---|
| **Pagamentos › Visão geral × Contas do mês** | A Visão geral era uma agenda só de leitura das mesmas contas que a tela Contas do mês já lista com ações — mais acordos e Pix, que agora aparecem no Dashboard. | **Removida da navegação.** A agenda completa (contas, recorrências, acordos, Pix e RH juntos) virou o **Detalhamento de saídas** do Dashboard. |
| **Pagamentos › Recorrências × Contas do mês** | A regra que se repete e o que ela gera viviam em abas diferentes; a tela de Contas já tinha um botão para ir e voltar. | **Uma tela só:** Contas do mês mostra as contas do período e, abaixo, as regras que as geram. `Recorrentes` ganhou a opção `embutida` — é o mesmo componente, não uma cópia. |
| **Configurações espalhadas** | Ajustes do Financeiro, Plano de contas, Configurações do RH, Usuários e Empresas e cargos eram cinco itens de menu em três pilares diferentes. | **Uma área só** (`/configuracoes`), na engrenagem do canto superior direito, com as mesmas telas dentro. Nada foi reescrito. |
| **RH › Atestados e faltas** | Única seção do RH com uma tela só, e o assunto é a pessoa. | Virou **aba de Funcionários** (Lista · Documentos · Atestados e faltas). |
| **Pagamento do RH × saída do Financeiro** | O RH lançava adiantamento, salário e pagamento diário; o Financeiro não enxergava (só o Pix do dia via os diários). Resultado: lançar de novo à mão, ou o dinheiro sumir da projeção. | **Função de leitura no banco** (migração 48): o Financeiro lê o compromisso onde ele nasce. Zero cópia. |
| **Dívidas e acordos** | Aba fixa para uma funcionalidade que a empresa quase não usa. | Virou **opcional** (Configurações › Funcionalidades). Desligar tira do menu e do dashboard; os registros continuam no banco. |
| **Restaurar dados de demonstração** | Ficava no menu do usuário, longe de qualquer configuração. | Foi para Configurações › Geral. |

### 10.2 Dashboard: um período, uma verdade

- `src/lib/periodo.ts` — mês atual · mês anterior · escolher mês · período personalizado. **Mês que já
  passou é fechado**: mostra só realizado, sem projeção (decisão de quem administra: automático, sem
  ninguém precisar "fechar o mês" na mão).
- `src/lib/lancamentos.ts` — junta contas, recorrências, mensalidades, Pix, acordos e RH numa lista só de
  **compromissos**, e separa realizado de projetado. A regra que evita contar duas vezes: compromisso
  liquidado **sai** da projeção, porque o dinheiro passa a aparecer pelo extrato.
- A tela: indicadores → Entradas vs Saídas → fluxo do saldo → detalhamento de entradas → detalhamento de
  saídas → próximos movimentos → despesas por categoria → pessoas. Tudo no mesmo filtro.
- **Cadastrar do Dashboard:** "Nova entrada" e "Nova saída" gravam um previsto do Financeiro — a mesma
  tabela que Pagamentos e a projeção de caixa já leem. Por isso o lançamento aparece na hora em todo lugar.

### 10.3 RH → Financeiro (migração 48)

`fn_rh_compromissos_financeiros(empresa, de, ate)` devolve, por pessoa:

1. o que o RH **já lançou** (`rh_pagamentos`, tipos Adiantamento e Salário) — `Realizado` vira realizado,
   o resto vira projetado;
2. os **pagamentos diários** do RH (`rh_pagamentos_diarios`);
3. uma **projeção**, só onde (1) ainda não existe: salário cadastrado × percentual de adiantamento (a mesma
   regra de `valorAdiantamento` no RHApp), na data do vale (dia útil até o dia 20) e do salário (último dia
   útil do mês da competência — que é a data que o RH grava em `dataPrevista`).

`Desconto Falta` fica de fora de propósito: abate o salário, não sai do banco.

**Escopo por cargo:** a folha por pessoa é para quem já vê o dinheiro da empresa inteira (`ver_dashboard`
ou `contas_gerir`, e o master). Quem tem só `pag_diario_gerir` (o cargo do Pix) recebe apenas os pagamentos
diários — os mesmos que já via. A chave Pix **não** sai por essa função.

### 10.4 A recorrência de Folha puxando o valor do RH (migração 49)

As recorrências de **Folha de Pagamento** (Adiantamento, Salários, Vale Transporte, Vale Refeição) existiam
com valor simbólico de R$ 1,00: eram lembretes de vencimento, porque o valor de verdade mora no RH. Quem
administra decidiu **mantê-las** — e ligá-las ao RH.

Em Pagamentos › Contas do mês, a recorrência agora tem **"De onde vem o valor"**:

| Fonte | O que soma |
|---|---|
| Folha — líquido a pagar | salários cadastrados − adiantamento (o que sai do banco no dia do pagamento) |
| Salários — bruto cadastrado | soma dos salários dos ativos |
| Adiantamento quinzenal | a mesma regra da migração 48 (percentual da empresa, próprio ou valor fixo) |
| Vale-transporte | valor do dia de cada um × dias úteis da configuração, pelo custo cheio da empresa |
| Vale-refeição | valor do dia × dias do mês, na base escolhida no RH |

Três garantias:

1. **A conta em aberto acompanha** o RH a cada reconciliação (que já roda ao abrir Contas do mês); a conta
   **já paga nunca muda** — o que foi pago, foi pago.
2. **Sem os totais do RH** (fora do ar, migração não rodada, cargo sem direito), o valor gravado continua
   valendo. A conta nunca é zerada por falta de resposta.
3. **Nada aparece duas vezes:** com a recorrência de folha ligada, o Dashboard deixa de listar aquela
   rubrica pessoa a pessoa. O pagamento diário do RH, que não vem de recorrência, continua aparecendo.

Limite conhecido: o valor usado é o total do RH do **mês do vencimento**. Se a folha de setembro for paga
em outubro, entra a foto de outubro — a diferença só aparece quando alguém entra ou sai no meio do caminho.
O rateio de VR por admissão/desligamento (`vrProporcionalAdmissao`) não é feito: se a opção estiver ligada
no RH, a função devolve `vr_aproximado` e a tela avisa, em vez de entregar número errado com cara de exato.

### 10.5 Validação desta rodada

| Verificação | Resultado |
|---|---|
| Typecheck (`tsc --noEmit`) e build de produção | ✅ sem erros |
| Testes unitários (`vitest`) | ✅ 290 em 24 arquivos (+50 desta rodada: período, compromissos, funcionalidades, navegação, fontes do RH, RPCs do RH no simulador) |
| Cálculos e regras do RH | ✅ 440/440 e 138/138 — inalterados |
| Navegação (`npm run test:e2e`) | ✅ 107/107 — 7 perfis, todas as telas e abas, 23 URLs antigas (incluindo as que passaram a redirecionar para Configurações) |
| Fluxos reais (`npm run test:e2e:interacoes`) | ✅ 66/66 — cadastrar entrada pelo Dashboard e vê-la na hora, folha do RH como saída projetada, recorrência puxando o valor do RH (sem tocar no que já foi pago) e o Dashboard não repetindo a folha, mês fechado sem projeção, Dívidas e acordos ligando/desligando sem apagar nada, Configurações reunindo tudo |
| Celular (`npm run test:e2e:celular`) | ✅ 6/6 telas a 390 px, sem rolagem horizontal e sem erro de console |
| Banco de produção | ✅ migrações 47, 48 e 49 aplicadas e conferidas com os dados reais; nenhuma linha de dado alterada |

Dois defeitos encontrados pelos próprios testes e corrigidos:

1. **Mês fechado ainda mostrava "previstas"** na legenda do gráfico Entradas vs Saídas. As séries de
   previsto agora somem do gráfico e da legenda quando o período já passou — a tela não promete uma
   projeção que não existe mais.
2. **O cargo de Pagamentos Diários conseguia ler a folha inteira** pela função nova (nomes e valores por
   pessoa). Passou a receber só os pagamentos diários, que era o que ele já via.

---

## 11. Terceira rodada — cliente → venda → cobrança → caixa (21/09/2026)

### 11.1 O que já existia (e foi reaproveitado)

| Peça | Situação antes | O que virou |
|---|---|---|
| `clientes` | cadastro com mensalidade, dia de vencimento e chave do OFX | **mantido como está** — não nasceu uma segunda tabela de clientes |
| `cobrancas` | uma por cliente/mês, gerada por `fn_gerar_cobrancas`, conciliada com o extrato | ganhou `venda_id`, `parcela`, `parcelas_total`, `forma_pagamento`, `descricao` e `criado_por` |
| `vendas` | registro solto: cliente como TEXTO, sem parcelas, sem ligação com cobrança | ganhou `cliente_id`, `descricao` e `criado_por`; passou a gerar cobranças |
| `previstos` / `recorrentes` | contas a pagar e as regras que as geram | ganharam `cartao_id` — é só isso que faltava para a leitura por cartão |
| `plano_contas` | já tinha o marcador "fora dos relatórios" | ganhou `investimento_anuncios`, no mesmo formato |
| Categorias de ferramentas e cartão | já existiam ("Sistemas › Claude", "Cartão › Fatura", "Investimento em Meta Ads", "Leads") | **nada foi recriado**: a tela nova lê o que já estava lá |

### 11.2 A trava que precisou mudar

`cobrancas` tinha `UNIQUE (cliente_id, competencia)`: um cliente, uma cobrança por mês. Isso existe para
`fn_gerar_cobrancas` poder rodar de novo sem duplicar a mensalidade — mas impediria a parcela de uma venda
de conviver com a mensalidade do mesmo mês. Virou **índice único parcial**, valendo só onde `venda_id is
null`, e a função passou a usar o mesmo predicado no `on conflict`. O simulador do protótipo ganhou o
mesmo conceito (`unique: [{ cols, onde }]`), senão as duas realidades divergiriam.

### 11.3 Parcelamento

`src/lib/parcelamento.ts` (puro e testado) monta as parcelas iguais **em centavos** — 10.000 em 3 vezes dá
3.333,34 + 3.333,33 + 3.333,33, e a soma fecha — ou aceita valor e data livres em cada uma. A conferência
da soma acontece **duas vezes**: na tela, para avisar antes de salvar, e em `fn_cobrancas_da_venda`, que é
quem realmente grava. Regerar o parcelamento apaga só as parcelas **em aberto**: o que já foi recebido
nunca é desfeito.

### 11.4 Dashboard e Fluxo de Caixa com a mesma conta

O Dashboard calculava entradas/saídas por competência num intervalo de meses; o Caixa somava por data real
nos "últimos N dias". Dois números diferentes para a mesma pergunta. Agora:

- o **Caixa › Fluxo realizado** usa o mesmo `SeletorPeriodo` do Dashboard e as mesmas funções
  (`resumoPeriodo`, `serieFluxo` de `src/lib/lancamentos.ts`);
- os dois gráficos — **Saldo acumulado** e **Entradas vs Saídas** — saem do mesmo componente
  (`src/modulos/financeiro/graficos-fluxo.tsx`) e aparecem lado a lado nas duas telas;
- `src/lib/fluxo.ts` (`resumoRange`, `fluxoDiario`), que só existia para a versão antiga do Caixa, **foi
  removido** junto com os testes dele — era a segunda conta.

### 11.5 Cartões e ferramentas

Não nasceu um módulo de fatura. A fatura continua chegando pelo extrato como uma movimentação; o que se
acrescentou foi **em que cartão cada despesa cai**. Com isso, `src/lib/cartoes.ts` responde, a partir do
que já existe: quanto o cartão compromete em cada um dos próximos 6 meses, e de que itens — com
**"parcela 4 de 12"** derivada do início e do fim da recorrência (recorrência sem fim é "Contínuo", não é
parcelamento).

### 11.6 Pendência conhecida

As vendas antigas (46 no protótipo, e as reais do Financeiro) têm o cliente como texto e **continuam
assim** — a tela mostra o nome e pede que se escolha o cliente do cadastro para ligar as cobranças. Nenhum
vínculo foi adivinhado por semelhança de nome.

### Ajuste de desenho (21/09/2026)

Os dois gráficos voltaram ao desenho de sempre: **Saldo acumulado** em área e **Entradas vs Saídas** em
linhas (barras empilhadas foram atrás). O previsto continua no gráfico, agora como linha **tracejada** da
mesma cor, e some quando o período está fechado. Como o Dashboard e o Caixa desenham pelo mesmo
`graficos-fluxo.tsx`, a mudança valeu para as duas telas ao mesmo tempo — que é justamente o motivo de o
componente ser único.

### Projeção de caixa redesenhada (21/09/2026)

A aba ficou uma conta que se lê de cima para baixo: **Tenho hoje + Vai entrar − Vai sair = Termino com**,
seguida de uma frase com o veredito ("vai faltar dinheiro a partir de…" ou "o dinheiro dá para tudo…").
O gráfico mostra só o futuro, em degraus, verde acima do zero e vermelho abaixo, com o ponto mais baixo
marcado. Embaixo, **Mês a mês** (com quanto o caixa termina cada mês) e **O que vem por aí** (cada conta e
cobrança em ordem de data, com o saldo depois dela e a marca de onde o saldo fica negativo).

Os números não mudaram de fonte: `itensDaProjecao` (em `lib/projecao.ts`) aplica a mesma regra de antes —
só previstos não pagos e cobranças em aberto — e `lancamentosFuturos` passou a derivar dela. A tela saiu de
`fluxo-caixa.tsx` para `projecao-caixa.tsx`.

### Mais de uma mensalidade por cliente (21/09/2026)

Um cliente pode ter várias mensalidades ("Mensalidade", "Suporte técnico", "Hospedagem"...), cada uma com
valor, dia de vencimento e mês de início próprios, e cada uma gera a sua cobrança todo mês. O cartão do
cliente lista todas, com o **atraso de cada uma** — contado desde a cobrança vencida mais antiga, não só a do
mês (antes, uma mensalidade vencida no mês passado aparecia como "0d").

- **Banco — migração 52** (`supabase/52_mensalidades_por_cliente.sql`): tabela `cliente_mensalidades`,
  coluna `cobrancas.mensalidade_id`, trava "uma cobrança por mensalidade e mês" e `fn_gerar_cobrancas`
  gerando por mensalidade. A mensalidade que já existia em cada cliente vira a primeira da lista, e as
  cobranças antigas passam a apontar para ela; nada é apagado. `clientes.mensalidade` continua existindo e
  passa a ser a soma das ativas, mantida por trigger.
- **Adicionar** começa a cobrar no mês corrente (não gera meses atrasados para trás). **Editar** valor ou dia
  refaz só as cobranças em aberto deste mês em diante. **Encerrar** para de cobrar a partir do mês seguinte e
  mantém o histórico; o que estiver atrasado continua aparecendo até ser recebido.
- **Sem a migração no banco**, a tela funciona como antes (uma mensalidade, lida do cliente) e o botão
  Adicionar fica desabilitado, explicando o motivo.
- As cobranças levam o nome da mensalidade para o Dashboard e para a aba Cobranças ("Suporte técnico · Beta").
- Regras em `src/lib/mensalidades.ts` (+ testes); fluxo real no bloco R de `scripts/e2e/interacoes.mjs`.
