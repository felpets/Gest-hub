# Zaytan Hub — Financeiro · RH · Gestão

Sistema organizacional único da empresa, consolidando o **Zaytan Hub Financeiro** e o **CRM · RH** em uma
só aplicação, com três pilares no menu: **Financeiro**, **RH** e **Gestão**.

> ⚠️ **Por padrão o app abre em modo protótipo, com dados fictícios** (`src/lib/mock`): nada é lido nem
> gravado no Supabase real. O modo real é `npm run dev:real` (ver abaixo).

- Decisões, inventário, redundâncias, arquitetura e matriz de preservação: [`docs/CONSOLIDACAO.md`](docs/CONSOLIDACAO.md)
- Mapa dos bancos (tabelas, funções, policies, dependências): [`docs/SUPABASE-MAPA.md`](docs/SUPABASE-MAPA.md)
- Retrato do banco do RH (tabelas `rh_*`, RLS, funções e buckets, comentado): [`supabase/schema-rh.sql`](supabase/schema-rh.sql)
- Saída do protótipo (RH no banco do Financeiro, Pix × pagamento diário): [`docs/PRODUCAO-RH.md`](docs/PRODUCAO-RH.md)
- Futuro: projeção a partir do CRM Comercial: [`docs/ROADMAP-PROJECAO-COMERCIAL.md`](docs/ROADMAP-PROJECAO-COMERCIAL.md)

**Stack:** React 19 · Vite 7 · TanStack Router/Start (SPA) · TanStack Query · Supabase · Tailwind v4 +
shadcn/ui · Recharts · Vitest · Vercel. O módulo RH (JavaScript, preservado do CRM RH) é carregado sob demanda.

## O que tem no menu

```
GESTÃO
└─ Dashboard ........ Histórico · Projeção de caixa · Pessoas (RH)
FINANCEIRO
├─ Caixa ............ Movimentações · Fluxo realizado · Análises financeiras · Cartões
├─ Extratos ......... 1. Importar · 2. Revisar e classificar · 3. Conferir com o banco
├─ Pagamentos ....... Pix do dia · Contas do mês (com as recorrências) · Dívidas e acordos*
├─ Receitas e vendas  Clientes · Cobranças (contas a receber) · Vendas
└─ Análise financeira Mensal · Evolução · Por categoria · Fluxo · Receitas · Despesas
RH
├─ Painel do RH
├─ Funcionários ..... Lista · Documentos · Atestados e faltas
├─ Treinamento ...... Trainees · Turmas · Cálculo e pagamento
├─ Recrutamento ..... Candidatos · Banco de talentos · Agenda e entrevistas · Roteiro
└─ Folha de pagamento Extrato mensal · Folha de repasse · Benefícios · Rescisões · Pagamento diário

⚙ CONFIGURAÇÕES (engrenagem, canto superior direito — vale para o sistema inteiro)
├─ Geral .................... aparência e preferências deste login
├─ Financeiro ............... Ajustes (contas, regras, feriados, Inter) · Plano de contas
├─ RH ....................... configurações do RH (benefícios, cargos, jornada, adiantamento)
├─ Usuários e permissões .... Usuários · Empresas e cargos
└─ Funcionalidades .......... liga/desliga o que é opcional

* Dívidas e acordos é opcional: sai do menu quando desligada em Configurações › Funcionalidades.
```

Cada item e cada aba só aparece para quem tem a permissão correspondente. **A Gestão é do cargo
Administrador** (ou de quem for liberado pessoa a pessoa em Configurações › Usuários — migração 54):
não basta ter acesso ao Financeiro. As URLs antigas (`/movimentacoes`, `/ajustes`, `/gestao/usuarios`,
`/rh/atestados`, `/financeiro/caixa?aba=projecao`, `/?aba=analises`…) continuam abrindo: levam à aba ou à
seção equivalente.

**Análises financeiras** é uma tela só, com duas portas: o item **Análise financeira** no menu e a aba
**Caixa › Análises financeiras** (quem trabalha no caixa chega nelas sem desviar). Nada foi duplicado.

**Conta bancária.** Quando a empresa tem duas ou mais contas ativas, um seletor deixa ler os números de uma
conta só ou de todas (consolidado). Ele fica na barra do topo e também ao lado dos filtros do **Histórico**,
da **Projeção de caixa**, do **Fluxo realizado** e das **Análises financeiras** — a escolha é a mesma nas
quatro. Na projeção, o saldo de partida é o da conta escolhida, mas as contas a pagar e as cobranças são da
empresa inteira; a tela avisa isso.

## Gestão › Dashboard

Duas leituras, lado a lado, com **um filtro de período** governando a tela inteira (mês atual · mês anterior
· escolher mês · período):

**Histórico — só o extrato.** Tudo aqui vem de movimentação que já passou pelo extrato, na data real em que o
dinheiro andou. Nada de previsto: conta a pagar, Pix do dia e recorrência só aparecem quando são pagas.
O cartão do topo mostra **saldo no banco · receita recebida · o que já saiu · a diferença entre os dois**;
abaixo, um gráfico de **Receitas por categoria** e um de **Despesas por categoria**, cada um com a sua lista
de lançamentos logo embaixo. **Clicar numa barra filtra a lista daquele gráfico**; clicar de novo desfaz.
Mês que já passou é tratado como **fechado** e mostra o saldo do fim do período. O botão **Mostrar
investimentos** traz de volta as categorias marcadas como fora dos relatórios (aplicação, resgate,
transferência entre contas próprias), para conferência.

**Projeção de caixa.** O saldo de hoje mais tudo o que está em aberto, por horizonte (este mês — o padrão —
30, 60, 90 dias ou até o fim do mês que vem), com o veredito de sobra ou falta e a lista do que compõe.

**Pessoas (RH)** traz os indicadores e os relatórios do RH, no mesmo lugar.

**Realizado × projetado.** Realizado é o extrato; projetado é compromisso em aberto (conta, recorrência,
mensalidade, Pix, acordo ou folha do RH). Quando o compromisso é pago, ele **sai** da projeção — o dinheiro
passa a aparecer pelo extrato, e o mesmo valor nunca conta duas vezes.

## Extratos: importar → revisar → conferir

**Importar.** OFX, CSV, Excel e PDF. O destino pode ser uma conta bancária **ou um cartão de crédito** — o
cartão aparece na mesma lista de destinos, e a planilha que vai para um cartão tem o sinal invertido
(compra é gasto). O leitor reconhece o layout de fatura que o cartão manda, ignorando as colunas que não
interessam (categoria do banco, portador, dígitos do cartão, valor em dólar e câmbio).

**Duplicatas.** O sistema reconhece o que já entrou, pelo identificador do banco (FITID) ou pelo conteúdo
(dia + valor + tipo + descrição), e separa a repetição que está no próprio arquivo. Dá para importar o mesmo
extrato duas vezes sem medo.

**Revisar e classificar.** As sugestões de categoria já vêm preenchidas — por regra e pelo histórico — e a
aprovação é em lote.

**Conferir com o banco.** Compara o saldo do extrato com o saldo do sistema na mesma data e lista o que falta
de cada lado. Foi assim que apareceram, no histórico real, 5 lançamentos duplicados e 24 que nunca tinham
sido lançados.

## Pagamentos e recebimentos

**Pix do dia.** A lista do dia, com baixa individual. A chave pode ser digitada ou colada como **Pix copia e
cola** (BR Code / EMV, migração 55): o sistema lê valor, nome e chave do código, confere o CRC e aceita
também a **imagem do QR**.

**Pix do dia em tempo real (migração 58).** Dois pagadores na mesma lista não se atropelam mais: o que um
lança, altera, paga, estorna ou exclui aparece na tela do outro na hora, sem recarregar a página. Quem tem a
capacidade `pag_diario_gerir` também é **avisado de qualquer tela do sistema** — aviso no canto, som curto,
notificação do computador (quando a aba está em segundo plano) e um contador no item **Pagamentos** do menu,
que zera ao abrir a tela. O aviso diz **quem** fez, **o quê**, **quanto** e **para quem**, e quem fez a ação
nunca é avisado do próprio clique (o autor vem do histórico da migração 39). Rajada — marcar 12 como pagos de
uma vez — vira **um** aviso só. Cada pessoa liga ou desliga som e notificação em **Configurações › Geral ›
Avisos do Pix do dia**; a escolha vale por aparelho.

**Contas do mês e recorrências.** A regra e o que ela gera vivem na mesma tela. O vencimento pode ser **dia
fixo (1 a 31)**, **último dia do mês**, **N-ésimo dia útil** (o 5º dia útil da folha, na contagem
trabalhista) ou **quinzenal**. Dia que não existe no mês cai no último dia dele — 31 em fevereiro é 28 (ou
29) — e vencimento em fim de semana ou feriado é antecipado para o dia útil anterior, nunca para depois
(migração 57).

**Recorrência com valor do RH.** Uma recorrência pode tirar o valor de cada mês direto do RH (migração 49):
**folha líquida**, **salários**, **adiantamento**, **vale-transporte** ou **vale-refeição**. A conta em aberto
se atualiza sozinha quando o RH muda; conta já paga nunca muda. Com a recorrência ligada, o Dashboard deixa
de listar aquela rubrica pessoa a pessoa — o mesmo dinheiro não aparece duas vezes.

**Cliente → venda → cobrança → caixa.** Uma venda aponta para o cliente do cadastro e pode gerar as próprias
cobranças — **à vista, em parcelas iguais ou com valor e data livres em cada parcela** (a soma é conferida
contra o valor da venda, no app e no banco). Cada cliente pode ter **várias mensalidades**, cada uma com o
seu valor, dia de vencimento e vigência (migração 52). As cobranças aparecem em **Receitas › Cobranças**,
entram no caixa como **entrada prevista** e saem da projeção quando o recebimento é registrado.

**Cartões.** Em **Caixa › Cartões**, o demonstrativo de cada cartão: fatura por fatura e gastos por
categoria, a partir do extrato importado dele (migrações 51 e 53). Qualquer saldo positivo conta como
**pagamento de fatura** e fica fora dos gastos por categoria — senão a despesa apareceria duas vezes (uma na
compra, outra no pagamento).

## Categorias: o plano de contas manda

Cada categoria do plano de contas pode ser marcada, e a marcação vale também para as subcategorias:

- **Fora dos relatórios** — aplicação, resgate e transferência entre contas próprias não são receita nem
  despesa; contá-las inflaria os dois lados. O botão *Mostrar investimentos* traz de volta quando se quer
  conferir.
- **Investimento em anúncios** — cada empresa chama de um jeito ("Investimento em Meta Ads", "Leads"); a
  marcação é que diz qual é (migração 54).
- **Compensada** (migração 56) — o que entra e o que sai na categoria se anula, e o cartão do topo mostra só
  o líquido do período. É o caso de aporte recebido × investimento pago com ele: o delta cai no lado que
  sobrou (receita, se sobrou aporte; saída, se gastou mais). Os lançamentos continuam inteiros no
  detalhamento, e a tela explica a conta.
- **Competência** — a categoria pode competir ao mês anterior, ao seguinte ou a partir de um dia de corte.
  É o que explica a diferença entre o caixa (data real) e o relatório do contador: na Laportec, os salários
  competem ao mês anterior.

## RH

**Vale-transporte e vale-refeição pelo calendário real.** O mês entra com os dias úteis que ele tem de fato —
fevereiro 18, agosto 21, dezembro 22 — e não com um número fixo. Os **feriados nacionais** entram sozinhos,
pela mesma regra do Financeiro (fixos + móveis da Páscoa: Carnaval, Sexta-feira Santa, Corpus Christi); o que
for só da empresa continua podendo ser cadastrado e vale por cima. **Quinzena** é paga pelos dias úteis reais
do período (01–15 e 16 ao fim do mês: 8, 10 ou 11 dias, conforme o mês), e as duas somadas fecham o mês
exato. Quem **entra ou sai no meio do mês** recebe proporcional, no VT e no VR; quem está **afastado** não
recebe vale. Todas essas convenções são trocáveis em Configurações › RH — inclusive voltar o VT ao número
fixo, para quem fechou com a contabilidade nessa base.

**O RH no Financeiro.** Adiantamento, salário e pagamento diário lançados no RH aparecem como saídas do
Financeiro, por pessoa, sem ninguém redigitar nada (migração 48). Enquanto a contabilidade não fecha o valor,
o sistema mostra uma **projeção** calculada com o salário cadastrado e o percentual de adiantamento; quando o
RH lança o valor real, é o valor real que aparece — no mesmo lugar.

**Folha oficial.** O extrato mensal é importado do PDF do contador, verba por verba, com trava contra
reimportar a mesma competência (competência + CPF) e contra o mesmo arquivo (hash). A estrutura das tabelas
está comentada em [`supabase/schema-rh.sql`](supabase/schema-rh.sql).

## Empresas e acessos

**Empresas.** Em Configurações › Empresas e cargos, cada empresa é criada para o **Financeiro**, para o **RH**
ou para **os dois**. A empresa ativa do topo vale para os dois pilares: no RH, o seletor mostra só as
empresas do RH que a pessoa pode ver e separa os dados por elas.

**Acessos.** Em Configurações › Usuários, o botão **Acessos** de cada linha define o que a pessoa vê, com
quatro chaves independentes:

- **Financeiro:** o cargo em cada empresa do Financeiro (ou sem acesso);
- **RH:** o perfil e as empresas — todas (com a opção "Todas as empresas", que o fechamento da folha exige)
  ou só as marcadas;
- **Gestão:** o Dashboard é do cargo Administrador; aqui se libera para mais alguém, pessoa a pessoa;
- **Administração — Empresas e cargos:** acesso total. Quem cria empresas, cargos e acessos pode dar a si
  mesmo qualquer acesso, por isso não existe administração parcial. Ninguém tira a própria.

O master também cria logins sem empresa (para quem só usa o RH) e **exclui logins**: a pessoa perde o acesso
na hora, mas nada do que ela fez some. A aba **Registro de alterações** guarda criação, mudanças de cadastro
e de acesso e as exclusões (com o que a pessoa tinha e o motivo), sempre com quem fez e quando — ninguém
edita nem apaga esse registro.

---

## Rodando

Pré-requisito: **Node 22+** (testado também no 26).

```bash
npm ci
npm run dev        # http://localhost:8080
```

Na tela de login há um botão para cada perfil fictício (senha de todos: `demo1234`):

| Perfil | Login | O que vê |
|---|---|---|
| Diretoria (Master) | diretoria@zaytanhub.demo | tudo, em todas as empresas |
| Ana Souza (Administradora) | financeiro@zaytanhub.demo | Financeiro, RH e Gestão nas empresas dela |
| Bruno Martins (Operador) | operador@zaytanhub.demo | operação financeira (sem Ajustes, sem RH e sem Gestão) |
| Carla Nunes (Visualizador) | leitura@zaytanhub.demo | Fluxo e Projeção de caixa |
| Diego Alves (Pagamentos Diários) | pix@zaytanhub.demo | só Pagamentos › Pix do dia |
| Larissa Prado (RH, restrita à Laportec) | rh@zaytanhub.demo | só o RH da Laportec (sem Financeiro) |
| Paulo Mendes (Recrutamento, Laportec e Avora) | recrutamento@zaytanhub.demo | só painel e funil de Recrutamento das duas empresas |

**Restaurar dados de demonstração** fica em Configurações › Geral (engrenagem no topo). As alterações feitas
na demonstração ficam no `localStorage` do navegador.

### Modo real (dados da empresa)

`npm run dev:real` usa `.env.real.local` (fora do Git): `VITE_DATA_MODE=real` + `VITE_SUPABASE_URL`/
`VITE_SUPABASE_ANON_KEY` do projeto Financeiro. O RH usa o **mesmo projeto e o mesmo login** (tabelas
`rh_*`); quem entra no RH é liberado pessoa a pessoa em **Configurações › Usuários**. O Pix do dia enxerga,
só para leitura, os pagamentos diários lançados no RH.

Roteiro completo (migrações, cópia dos dados do CRM RH, virada e Vercel):
[`docs/PRODUCAO-RH.md`](docs/PRODUCAO-RH.md).

---

## APK Android (o Pix do dia no celular)

O app Android **é este mesmo site**: o build (`dist/client`) vai empacotado dentro do APK e roda num
WebView, pelo Capacitor. Não há um segundo código a manter — o que se corrige aqui entra no app no APK
seguinte. A diferença é a abertura: o app começa em **Financeiro › Pagamentos › Pix do dia**, a tarefa de
quem paga, com o resto do Hub inteiro no menu e as mesmas permissões de cargo.

Quem compila é o GitHub — nenhuma máquina do escritório precisa de Android Studio:
**Actions › APK Android › Run workflow**, e o `.apk` sai em *Artifacts*.

Três coisas mudam dentro do app, e é tudo:

| Tema | No site | No APK |
|---|---|---|
| Tela de abertura | Dashboard | Pagamentos › Pix do dia (`src/lib/nativo.ts`) |
| Exportar PDF/Excel | baixa o arquivo | grava e abre o compartilhar do Android (`src/lib/salvar-arquivo.ts`) |
| `/api/usuarios`, `/api/inter/sync` | mesma origem | vão para o site na Vercel (`VITE_API_BASE`) |

**Desenho de app.** Em janela estreita (o APK, ou o site num celular) a casca troca — cabeçalho enxuto e
barra de baixo com Início, Pagamentos, Movimentações e Mais — e os três itens da barra já têm tela
própria, desenhada no Figma:

| Barra de baixo | Telas de app | Arquivos |
|---|---|---|
| Início | Histórico · Projeção de caixa · Pessoas | `modulos/gestao/telas/inicio-celular.tsx` |
| Pagamentos | Pix do dia, detalhe, novo Pix, estorno e filtros | `modulos/financeiro/telas/pix-celular*.tsx` |
| Pagamentos | Contas do mês (com as recorrências) · Dívidas e acordos | `modulos/financeiro/telas/contas-celular.tsx` |
| Movimentações | Movimentações · Fluxo realizado · Análises · Cartões | `movimentacoes-celular.tsx`, `caixa-celular.tsx` |
| Mais › Extratos | Revisar e classificar · Conferir com o banco (Importar usa a tela comum) | `modulos/financeiro/telas/extratos-celular.tsx` |
| Mais › Receitas e vendas | Clientes · Cobranças · Vendas | `modulos/financeiro/telas/receitas-celular.tsx` |
| Mais › Configurações | lista de seções → seção, pelo endereço | `routes/configuracoes.tsx` |

O RH **não** tem tela de app: os dados dele vivem dentro do `RHApp.jsx` (o normalizador de funcionário,
o catálogo de cargos), e desenhar as telas por fora criaria um segundo RH. Ele abre no celular como está.

Nenhuma delas tem regra própria: os números vêm dos mesmos ganchos e das mesmas funções puras da tela de
computador (`lib/agregacoes.ts`, `lib/filtros-movimentacoes.ts`, `dashboard/dados-periodo.ts`). O resto do
Hub continua abrindo, na versão de computador dentro da casca.

Passo a passo, secrets, assinatura e o que ainda não foi conferido:
[`docs/apk-android.md`](docs/apk-android.md).

---

## Estrutura

```
src/
  routes/                 rotas (TanStack Router, file-based)
    index.tsx             Gestão › Dashboard (Histórico · Projeção de caixa · Pessoas)
    configuracoes.tsx     área única de configurações (engrenagem) — seções em ?secao=
    financeiro/           Caixa · Extratos · Pagamentos · Receitas e vendas · Análise financeira
    rh.tsx + rh/          RH (layout único; seções como rotas, sub-telas como abas ?aba=)
    gestao/, *.tsx (raiz) URLs antigas → redirecionam para a aba/seção equivalente
  modulos/
    financeiro/telas/     telas do Financeiro (lógica original)
    financeiro/previsao-caixa.ts  a projeção compartilhada (horizontes e composição)
    gestao/telas/         painel financeiro (Histórico), relatórios, usuários, empresas
    gestao/dashboard/     seletor de período, gráfico por categoria, lista do extrato,
                          cartão do período e o agrupamento por categoria (puro e testado)
    gestao/projecao-comercial/  contrato da projeção futura (desligado)
    rh/RHApp.jsx          módulo RH (CRM RH preservado, modo embutido)
    rh/folha/regras.js    regras da folha (puras, testadas)
  components/             AppShell (shell + modo embutido), AppSidebar (3 pilares),
                          AbasPagina, seletor-conta (conta bancária ativa), ModoFields, ui/
  lib/
    navegacao.ts          menu, abas, seções de configuração e mapa RH
    periodo.ts            o filtro de período do Dashboard (puro e testado)
    lancamentos.ts        junta contas, mensalidades, Pix, acordos e RH numa lista só
    categorias.ts         as marcações do plano de contas (oculto, anúncios, compensada,
                          competência) e a herança para as subcategorias
    filtros-movimentacoes.ts  filtros por período/categoria e o deslocamento de competência
    datas.ts              dia útil (Preceding), competência, dia do mês que não existe
    saldo.ts              saldo por conta e consolidado, série diária
    pix.ts, qr-imagem.ts  chaves Pix, Pix copia e cola (BR Code + CRC16) e leitura do QR
    import-parsers.ts     OFX, CSV, Excel (inclusive o layout de fatura de cartão)
    conciliacao.ts        conferência do extrato com o banco
    cartoes.ts            faturas, gastos por categoria e pagamento de fatura
    mensalidades.ts       várias mensalidades por cliente
    parcelamento.ts       parcelas de uma venda (iguais ou livres) e a conferência da soma
    recorrentes.ts        quando a regra de datas mudou (e os previstos têm de ser refeitos)
    funcionalidades.ts    o que é opcional (Dívidas e acordos) e o padrão de cada um
    fontes-rh.ts          de onde a recorrência de Folha tira o valor de cada mês
    permissoes.ts         capacidades de cargo, acesso ao RH e à Gestão, rota → capacidades
    queries.ts            camada de dados do Financeiro
    nativo.ts             o que muda quando o app roda dentro do APK Android
    salvar-arquivo.ts     PDF/Excel: download no navegador, compartilhar no APK
    mock/                 banco simulado: tabelas, RLS, gatilhos, RPCs, auth, sementes fictícias
scripts/rh/               testes do RH, cópia do CRM RH e conversor de identidade visual
scripts/e2e/             navegação, interações reais e conferência em 390 px (Puppeteer)
android/                  projeto Android do APK (Capacitor) — ícone, splash e Gradle
capacitor.config.ts       nome do app e de onde vêm os arquivos web do APK
supabase/                 migrações do Financeiro — as recentes:
                          48 = compromissos do RH vistos pelo Financeiro
                          49 = recorrência com o valor vindo do RH
                          50 = venda ligada ao cliente, cobrança com parcela e forma
                          51 = cartões e o que cai em cada um
                          52 = várias mensalidades por cliente
                          53 = lançamentos de cartão (extrato do cartão)
                          54 = acesso à Gestão por pessoa e marcação de anúncios
                          55 = Pix copia e cola
                          56 = categoria compensada
                          57 = recorrência com vencimento em qualquer dia (1–31)
                          58 = Pix do dia em tempo real (Realtime + avisos)
                          schema-rh.sql = retrato comentado do banco do RH (registro)
docs/                     documentação da consolidação
api/                      Vercel Functions do Financeiro (usuários, Banco Inter)
```

## Scripts

| Comando | Faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção (gera `routeTree.gen.ts`) |
| `npm test` | Vitest (Financeiro, simulador, permissões/navegação, contrato da projeção) + testes do RH |
| `npm run test:rh` | só os testes do RH (conferência de cálculos + regras da folha) |
| `npm run rh:converter-visual` | reaplica a conversão de cores do RH para os tokens do design system |
| `npm run dev:real` | servidor de desenvolvimento com os dados reais (`.env.real.local`) |
| `npm run rh:copiar-dados` | confere/copia os dados do CRM RH antigo para as tabelas `rh_*`. Sem argumento só confere; `--gravar` copia; `--espelhar` também apaga o que saiu da origem; `--config` traz a configuração do RH (não vem por padrão, para não sobrescrever o que foi ajustado aqui) |
| `npm run test:e2e` | navegação ponta a ponta com todos os perfis (Chrome; app rodando em :8080 ou outra base passada como argumento) |
| `npm run test:e2e:interacoes` | fluxos reais (revisão, Pix, cadastro no RH, filtros, troca de conta, restrições) |
| `npm run test:e2e:celular` | confere 390 px: nenhuma tela rola na horizontal e o console fica limpo |
| `npm run apk:preparar` | build do site + copia para dentro do projeto Android |
| `npm run apk:abrir` | abre o projeto Android no Android Studio |
| `npx tsc --noEmit -p tsconfig.json` | typecheck |

## Convenções

- **Realizado ≠ projeção:** saldo, fluxo realizado, Histórico e análises usam só lançamentos confirmados do
  extrato; contas a pagar e cobranças em aberto aparecem apenas nas visões de **projeção**.
- **Dia útil (Preceding)**, **competência por categoria**, **categorias fora dos relatórios** e **valores
  positivos + tipo** — ver `src/lib/datas.ts`, `src/lib/saldo.ts`, `src/lib/categorias.ts`.
- **Multiempresa + cargos:** RLS no banco; na interface, cada rota e cada aba confere as capacidades.
- **Migração é aditiva e idempotente:** arquivo numerado em `supabase/`, que pode rodar de novo sem estragar
  o que já existe.
- **Regra de cálculo é função pura e testada.** O que decide dinheiro (dia útil, competência, parcelas,
  vales, projeção) mora em módulo próprio com teste, não dentro de componente.

## Dados

- Tudo o que aparece no protótipo é **fictício** (`src/lib/mock/seed-*.ts`): empresas, pessoas, CPFs, valores.
- Os autotestes do RH usam trechos de relatórios da contabilidade com **nomes, CPFs e RGs trocados por
  fictícios**; os valores e o layout continuam os dos relatórios, que é o que os testes conferem.
- Não versione extratos, planilhas ou PDFs reais (ver `.gitignore`) nem arquivos `.env`.

## Resultado da validação

| Verificação | Resultado |
|---|---|
| Typecheck e build de produção | ✅ sem erros |
| Testes unitários (`npx vitest run`) | ✅ 420 testes em 32 arquivos |
| Testes do RH (`npm run test:rh`) | ✅ 471/471 cálculos e 138/138 regras da folha |
| Navegação ponta a ponta (`npm run test:e2e`) | ✅ 111/111 (7 perfis, todas as telas e abas, URLs antigas) |
| Fluxos reais (`npm run test:e2e:interacoes`) | ⚠️ 99/100 — a checagem "Cartões: pagamento da fatura" depende da data (falha depois do fechamento do dia 28, também no código anterior) (inclui venda parcelada virando cobrança e entrada prevista, folha do RH como saída projetada, recorrência puxando o valor do RH, clique na barra filtrando o detalhamento, troca de conta bancária e as várias mensalidades por cliente) |
| Celular (`npm run test:e2e:celular`) | ✅ 23/23 telas a 390 px sem rolagem horizontal e sem erro de console |
| Supabase real | ✅ migrações 47 a 57 aplicadas (a 58 liga o tempo real do Pix do dia) |
| APK Android | ✅ compila no workflow *APK Android* em ~3 min (APK em Artifacts); ⏳ falta instalar num aparelho |

Detalhes na seção 9 de [`docs/CONSOLIDACAO.md`](docs/CONSOLIDACAO.md#9-validação).

## Licença

Uso **não comercial**: dá para ler, estudar e testar, mas usar, vender ou oferecer o sistema de forma comercial exige autorização por escrito. Termos completos em [`LICENSE.md`](LICENSE.md).
