# Prompts do Figma — o resto das telas do app

O módulo **Pagamentos › Pix do dia** já foi desenhado (o prompt das telas 1 a 6) e já está
implementado em `src/modulos/financeiro/telas/pix-celular*.tsx`. Este arquivo tem os prompts do
**resto do app**, na ordem em que vale a pena pedir.

Três regras para não desmontar o que já existe:

1. **Um prompt por vez.** O arquivo de Pagamentos saiu bom porque pedia um módulo, não o sistema
   inteiro. Um prompt com 30 telas devolve 30 telas rasas.
2. **Cole o _Bloco comum_ no começo de cada prompt.** É ele que garante a mesma identidade, a mesma
   casca de app e as mesmas regras de permissão em todos os arquivos.
3. **Peça reaproveitamento explícito.** Cada prompt termina mandando usar os componentes da página
   de componentes do arquivo de Pagamentos (card, badge de status, card de resumo, item da timeline).

## Uma correção antes de continuar

O primeiro prompt pedia *"azul-marinho profundo"*, mas o que voltou — e o que está no app hoje — é o
**laranja do Zaytan Hub**. Os tokens do desenho estão em `src/styles.css`, presos a `.app-celular`.
Se os prompts novos pedirem azul, o app fica com duas identidades. O Bloco comum abaixo já traz as
cores corretas, tiradas do código.

---

## Bloco comum (cole no começo de TODO prompt)

```
CONTEXTO DO PRODUTO
Zaytan Hub — app Android de gestão financeira e de pessoas, usado por duas empresas (Zaytan e
Laportec). O app é o mesmo sistema do site rodando dentro de um WebView: o desenho de celular é uma
casca (topo enxuto + barra inferior) e cada tela é a versão de 360 dp de uma tela que já existe no
computador. Quem usa são poucas pessoas, todo dia, para trabalhar — não é um app de consumidor.
Idioma: português do Brasil. Frame: Android 360x800 dp, Material Design 3, modo claro e escuro.
Tom: profissional, sóbrio e confiável, como um app de banco corporativo. Foco em legibilidade de
valores; nada decorativo.

ESTE PROMPT CONTINUA UM ARQUIVO QUE JÁ EXISTE
O módulo "Pagamentos do Dia" (lista do Pix do dia, detalhe, novo Pix, confirmação, estorno, filtros)
já foi desenhado, com uma página de componentes reutilizáveis. Reaproveite aqueles componentes e
aquele espaçamento. Não invente um segundo estilo de card, de badge, de campo ou de barra de ação.

IDENTIDADE (idêntica à do módulo Pagamentos — não mude)
- Primária: laranja #F84F2F. O texto SOBRE a primária é escuro (#101010), não branco.
- No modo escuro a primária clareia para #FD9878, para o texto escuro continuar legível.
- Superfícies da primária: #FEDBD0 (item selecionado) e #FEF3EF (etiquetas, botões tonais, trilha da
  timeline). No escuro as duas viram #3D2119.
- Claro: fundo #FFFFFF, cartão #FFFFFF, texto #1F1F22, texto secundário #7A7A80, borda #E5E5E5.
- Escuro: fundo #1F1F22, cartão #2B2B2F, texto #FAFAFA, secundário #A8A8AE, borda branca a 8%.
- Status: verde #3AA85B (pago, recebido, entrada), âmbar #F9AD26 (pendente, a vencer),
  vermelho #D63B0F (vencido, estornado, saída).
- Tipografia Inter. Valores monetários em semibold, com números tabulares.
- Cantos de 12 dp nos cards, espaçamento em múltiplos de 8.
- Dinheiro sempre no formato brasileiro: R$ 1.184,04. Datas: 25/09. Horas: 14h37.
- Nenhum texto abaixo de 11 px: a tela é um aparelho de verdade, não a régua do Figma.

CASCA DO APP (em todas as telas)
- Topo fixo: título da tela à esquerda e, logo abaixo, o seletor de empresa (dropdown "Zaytan");
  as ações da página ficam à direita do título, numa linha que rola quando não cabem; abaixo de
  tudo, as abas da tela em chips que rolam na horizontal.
- Barra inferior fixa com 4 itens: Início, Pagamentos, Movimentações, Mais. O item ativo tem o
  ícone dentro de um retângulo arredondado #FEDBD0 (#3D2119 no escuro) e o rótulo em laranja.
- "Mais" abre uma folha inferior, com o menu inteiro.
- Nada pode ultrapassar 360 dp de largura: a página nunca rola para o lado. Tabela de computador
  vira lista de cards. A última linha da lista nunca fica escondida atrás da barra inferior.

REGRA DE PERMISSÃO (vale para todas as telas)
Cada aba e cada botão de ação só aparece para quem tem a permissão do cargo. Desenhe a variante
"sem permissão": o botão simplesmente some (não fica cinza desabilitado) e, quando a tela inteira é
fechada para aquele cargo, um aviso discreto ocupa o lugar do conteúdo.

ESTADOS OBRIGATÓRIOS DE CADA TELA
vazio (dizendo o que fazer em seguida), carregando (skeleton com a forma do conteúdo real) e erro de
conexão com botão "Tentar novamente".
```

---

## Prompt 1 — Início (o Dashboard da Gestão) ✅ feito

> Desenhado e **implementado** em [`src/modulos/gestao/telas/inicio-celular.tsx`](../src/modulos/gestao/telas/inicio-celular.tsx)
> (as três abas), com os números vindo de `dashboard/dados-periodo.ts` — o mesmo gancho da tela de
> computador. O prompt fica aqui como registro do que foi pedido.

```
[COLE O BLOCO COMUM AQUI]

MÓDULO: INÍCIO — o painel da Gestão. Três abas: "Histórico" | "Projeção de caixa" | "Pessoas (RH)".
Um seletor de conta bancária fica ao lado dos filtros das duas primeiras abas: "Todas as contas
(consolidado)" ou uma conta específica ("Inter · 1234-5").

TELA 1 — HISTÓRICO (aba inicial): o que já aconteceu
- Filtro de período em chips: "Mês atual" (ativo) · "Mês anterior" · "Escolher mês" · "Período".
  Ao escolher "Período", aparecem dois campos de data (de / até).
- Cartão de resumo, empilhado em 4 blocos (no computador é uma linha só):
  · Saldo em conta — R$ 48.210,55 — "em 29/09 · conta Inter"
  · Receita recebida — R$ 92.400,00 em verde — "12 entradas no período"
  · Já saiu — R$ 77.185,10 em vermelho — "84 saídas no período"
  · Diferença — R$ 15.214,90 em faixa verde clara — "entrou mais do que saiu"
  O saldo é separado dos outros três de propósito (é o dinheiro de hoje, não do período): mostre a
  separação com uma barrinha ou um espaço maior, não com um sinal de mais.
- Gastos por categoria: rosca ou barras horizontais, com legenda em lista (categoria, valor, %).
  Tocar numa categoria filtra a lista abaixo.
- Lista do extrato do período: cada linha com data, descrição, etiqueta de categoria, e o valor com
  sinal e cor (entrada verde, saída vermelha). Rolagem infinita, agrupada por dia.

TELA 2 — PROJEÇÃO DE CAIXA: o que vem pela frente
- Chips de horizonte: "Este mês" (ativo) · "30 dias" · "60 dias" · "90 dias" · "Até o fim do mês que
  vem".
- A conta em uma linha, empilhada no celular: hoje R$ 48.210,55 + entra R$ 31.000,00 − sai
  R$ 22.480,00 = termina R$ 56.730,55.
- Gráfico de área do saldo dia a dia, com a linha do zero marcada e um alfinete no dia de saldo mais
  baixo. Se o saldo cruza o zero, o trecho fica vermelho e um aviso aparece acima: "o saldo fica
  negativo em 12/10 · R$ -3.400,00".
- Aviso de escopo, discreto: "o saldo de partida é da conta escolhida; contas e cobranças são da
  empresa inteira".
- Lista do que compõe a projeção, agrupada por semana: cada item com data, descrição, origem
  (conta a pagar / cobrança) e valor.

TELA 3 — PESSOAS (RH): cinco indicadores em cartões de 2 colunas
Funcionários ativos (38) · Em treinamento (4) · Admissões no mês (3) · Desligamentos no mês (1, com
a observação "1 rescisão a pagar") · Folha, salários cadastrados (R$ 112.400,00).
Abaixo, dois atalhos em lista: "Indicadores" e "Relatórios".

ESTADOS
- Sem movimentação no período: "Nenhum lançamento em setembro" + botão "Importar extrato".
- Sem acesso à Gestão (a maioria dos cargos): a aba não existe e o app abre em Pagamentos; desenhe
  o aviso que aparece a quem chega pela URL: "Esta área é do Administrador".

ENTREGÁVEIS
As três telas em modo claro, a tela 1 também em escuro, e os componentes novos (bloco de resumo,
chip de período, item de extrato, cartão de indicador) acrescentados à página de componentes.
```

---

## Prompt 2 — Movimentações (o Caixa) ✅ feito

> Desenhado e **implementado** em
> [`movimentacoes-celular.tsx`](../src/modulos/financeiro/telas/movimentacoes-celular.tsx) (a lista, os
> filtros e a seleção em lote) e [`caixa-celular.tsx`](../src/modulos/financeiro/telas/caixa-celular.tsx)
> (Fluxo realizado, Análises e Cartões). As somas vêm de `lib/agregacoes.ts`, as mesmas das Análises de
> computador. O prompt fica aqui como registro do que foi pedido.

```
[COLE O BLOCO COMUM AQUI]

MÓDULO: MOVIMENTAÇÕES (Caixa). Quatro abas: "Movimentações" | "Fluxo realizado" |
"Análises financeiras" | "Cartões".

TELA 1 — MOVIMENTAÇÕES (aba inicial)
É o extrato bancário já classificado. No computador é uma tabela (Data, Descrição, Categoria,
Confiança, Valor); no celular vira lista de cards.
- Ações no topo: "Importar extrato" e "Nova movimentação".
- Abas internas em chips: Todas (128) · Entradas (12) · Saídas (116).
- Busca por descrição e um botão de filtros que abre folha inferior: conta bancária, categoria
  (com busca e agrupada por categoria-mãe), faixa de valor (de / até) e período.
- Card de movimentação: data curta (25/09) à esquerda; descrição do banco em uma linha
  (PIX RECEBIDO CLIENTE X); abaixo, a descrição explicada (Cliente X — mensalidade de junho);
  etiqueta de categoria; valor à direita, verde com + ou vermelho com −.
  Quando a categoria veio da classificação automática e a confiança é baixa, um pontinho âmbar e o
  texto "confira a categoria".
- Seleção múltipla por toque longo, com barra inferior: "Recategorizar (7)" e "Excluir".
- Folha de recategorizar: um seletor de categoria com busca e o resumo "7 movimentações".

TELA 2 — FLUXO REALIZADO
Gráfico de barras de entradas e saídas mês a mês (últimos 12 meses), com legenda e valores
abreviados no eixo (R$ 92k). Abaixo, lista mês a mês: mês, entrou, saiu, diferença.

TELA 3 — ANÁLISES FINANCEIRAS
Uma tela de leitura, em cartões empilhados: Mensal · Evolução · Por categoria · Fluxo · Receitas ·
Despesas. Cada cartão tem título, o gráfico e um rodapé com o número principal. No celular os
gráficos são de altura fixa (180 dp) e a legenda vai embaixo, nunca ao lado.

TELA 4 — CARTÕES
- Lista de cartões: apelido, bandeira, final (•••• 4417), dia do fechamento e do vencimento, e o
  total da fatura aberta em destaque.
- Detalhe do cartão: seletor de fatura (mês), total, gastos por categoria e a lista de lançamentos
  com data, descrição, categoria e valor. Ação "Importar fatura".

ESTADOS
- Vazio: "Nenhuma movimentação importada" + botão "Importar extrato".
- Carregando: skeleton de 6 cards.
- Sem permissão de gerir movimentações: some a seleção múltipla, some "Nova movimentação", a lista
  continua visível.

ENTREGÁVEIS
As quatro telas em modo claro, a tela 1 também em escuro, e os componentes novos (card de
movimentação, chip de conta, cartão de gráfico, card de cartão de crédito) na página de componentes.
```

---

## Prompt 3 — Mais, Configurações e entrada no app ✅ feito (sem "esqueci a senha", tela de escolher empresa e sessão expirada)

> É a cola do app: o menu, o login e as telas que ninguém lembra de desenhar até faltarem.

```
[COLE O BLOCO COMUM AQUI]

MÓDULO: MENU, CONFIGURAÇÕES E ENTRADA.

TELA 1 — FOLHA "MAIS" (abre pela barra inferior, ocupa 85% da altura, cantos superiores de 16 dp)
- Topo: avatar com as iniciais, nome do usuário e, embaixo, o cargo ("Administrador").
- Quando o app está em modo protótipo, uma faixa laranja clara: "Protótipo · dados fictícios — o
  Supabase real não é acessado".
- O menu inteiro, em três grupos com título em caixa alta e cinza:
  GESTÃO: Dashboard
  FINANCEIRO: Caixa · Extratos (com contador de pendências) · Pagamentos (com contador de Pix) ·
             Receitas e vendas · Análise financeira
  RH: Painel do RH · Funcionários · Treinamento · Recrutamento · Folha de pagamento
- Separador e, embaixo: "Configurações", "Modo escuro" (com ícone de lua/sol) e "Sair".
- No rodapé, em 11 px cinza: "versão 1.42".
- Desenhe uma segunda variante da folha para um cargo restrito (só Financeiro › Pagamentos), com os
  grupos Gestão e RH ausentes — não desabilitados, ausentes.

TELA 2 — CONFIGURAÇÕES
Lista de seções agrupadas, cada uma com ícone, título e uma linha de explicação:
  GERAL: "Geral — aparência e preferências deste login"
  FINANCEIRO: "Ajustes do Financeiro — contas bancárias, regras automáticas, feriados e integração
              com o banco" · "Plano de contas — categorias de receita e despesa"
  RH: "Configurações do RH — benefícios, cargos, jornada, adiantamento"
  USUÁRIOS E PERMISSÕES: "Usuários — logins e acessos" · "Empresas e cargos"
  FUNCIONALIDADES: "Ligar ou desligar as partes opcionais do sistema"
Desenhe aberta a seção "Geral" (tema: Claro / Escuro / Do sistema) e a seção "Funcionalidades" (uma
lista de chaves liga-desliga, com "Dívidas e acordos" como exemplo).

TELA 3 — LOGIN
Tela limpa: logo do Zaytan Hub, "Entrar", campos de e-mail e senha (com olho para revelar), botão
primário "Entrar", link "Esqueci minha senha". Variante com erro: "E-mail ou senha incorretos".
Variante carregando: botão com spinner.

TELA 4 — ESCOLHER EMPRESA
Aparece quando o login tem acesso a mais de uma: cartões grandes "Zaytan" e "Laportec", cada um com
a inicial num quadrado, o nome e os módulos liberados ("Financeiro e RH"). O mesmo conteúdo, em
versão compacta, é o dropdown do topo das outras telas — desenhe os dois.

TELA 5 — ESTADOS DO APP
- Sem conexão: ilustração mínima, "Sem conexão com o servidor", botão "Tentar novamente".
- Sem permissão para a tela pedida: "Você não tem acesso a esta tela" e um botão que leva ao
  Pix do dia.
- Sessão expirada: folha inferior "Sua sessão expirou" com botão "Entrar de novo".
- Splash do app: fundo laranja, marca centralizada.

ENTREGÁVEIS
Todas as telas em claro; a folha "Mais" e o Login também em escuro.
```

---

## Prompt 4 — Pagamentos: o que ficou de fora ✅ feito

> Fecha o módulo que já existe. As abas "Contas do mês" e "Dívidas e acordos" ficaram sem desenho.

```
[COLE O BLOCO COMUM AQUI]

MÓDULO: PAGAMENTOS — as abas que faltam. A aba "Pix do dia" já está desenhada; mantenha os chips de
aba no topo: "Pix do dia" | "Contas do mês" | "Dívidas e acordos".

TELA 1 — CONTAS DO MÊS
- Seletor de mês na linha de cima (‹ Setembro 2026 ›).
- Faixa de resumo com três cartões compactos: "Vencidas em aberto" (R$ 3.280,00, em vermelho),
  "A vencer" (R$ 11.940,00), "Pagas no mês" (R$ 28.115,40, em verde).
- Abas internas: Em aberto (9) · Pagas (22) · Todas.
- Card de conta: nome do fornecedor ("Energia — Enel"), valor à direita, data de vencimento com cor
  por situação (vencida em vermelho, "vence em 3 dias" em âmbar, paga em verde), etiqueta de
  categoria e, quando a conta nasceu de uma recorrência, um ícone de repetição com "mensal".
- Seleção múltipla por toque longo, com barra inferior "Marcar como pagas (4) · R$ 5.210,00" e a
  folha de confirmação (a mesma do Pix, reaproveitada).
- Seção "Recorrências", dentro desta aba, acessível por um cartão no fim da lista:
  "12 recorrências ativas · geram R$ 14.300,00 por mês  ›". A tela de recorrências é uma lista com
  descrição, valor, dia do mês, categoria e uma chave liga-desliga.
- Folha "Nova conta": fornecedor, valor, vencimento, categoria, forma de pagamento, observação, e
  uma chave "repetir todo mês" que abre o campo "até quando".

TELA 2 — DÍVIDAS E ACORDOS (funcionalidade opcional: pode estar desligada)
- Lista de acordos: credor, valor total, quantas parcelas já foram pagas ("4 de 18"), uma barra de
  progresso fina e o valor da próxima parcela com a data.
- Detalhe do acordo: cabeçalho com o total e o saldo devedor, dados do acordo (credor, número,
  início, parcelas, juros), e a lista de parcelas com situação (paga, a vencer, vencida).
- Desenhe o estado "funcionalidade desligada": a aba não aparece na barra de abas.

ENTREGÁVEIS
As duas telas em claro, "Contas do mês" também em escuro, e os componentes novos (card de conta,
barra de progresso do acordo, chip de mês) na página de componentes.
```

---

## Prompt 5 — Extratos (os três passos) ✅ feito (Importar usa a tela comum)

```
[COLE O BLOCO COMUM AQUI]

MÓDULO: EXTRATOS — importar o extrato do banco e classificar o que veio. Três abas numeradas, que
são um passo a passo: "1. Importar" | "2. Revisar e classificar" | "3. Conferir com o banco".
Mostre o progresso: o passo concluído ganha um tique no chip da aba.

TELA 1 — IMPORTAR
- Área de soltar arquivo, adaptada ao celular: botão grande "Escolher arquivo" com o texto
  "OFX ou CSV exportado do banco" e um link "ver modelo".
- Seletor da conta bancária de destino.
- Depois de escolher: cartão do arquivo (nome, tamanho, período detectado "01/09 a 29/09",
  "142 lançamentos") e botão "Importar".
- Resultado da importação: "128 novos · 14 já existiam (ignorados)" e botão "Revisar e classificar".

TELA 2 — REVISAR E CLASSIFICAR
- Contador no topo: "37 de 128 por classificar".
- Lista de cards com a descrição do banco, o valor e um seletor de categoria em destaque. Quando o
  sistema sugeriu uma categoria, ela vem preenchida com um selo "sugestão" e o gesto é confirmar.
- Ações rápidas por card: "Aceitar" e "Trocar categoria" (folha com busca de categoria).
- Seleção múltipla para classificar várias de uma vez.
- Cartão de regra: "Sempre classificar PIX RECEBIDO CLIENTE X como Receita de serviços?" com
  "Criar regra" e "Agora não".

TELA 3 — CONFERIR COM O BANCO
- Comparação de saldos em duas colunas: "Saldo no sistema R$ 48.210,55" × "Saldo no banco
  R$ 48.210,55", com um tique verde quando batem e um alerta vermelho com a diferença quando não.
- Lista de divergências, quando houver: lançamento que está no banco e não no sistema, e o contrário.
- Botão "Conferido" que fecha o período.

ESTADOS
Vazio ("Nenhum extrato importado ainda"), importando (barra de progresso com "142 de 142"),
arquivo inválido ("Não reconhecemos este arquivo — exporte em OFX ou CSV").

ENTREGÁVEIS
As três telas em claro, a tela 2 também em escuro.
```

---

## Prompt 6 — Receitas e vendas ✅ feito

```
[COLE O BLOCO COMUM AQUI]

MÓDULO: RECEITAS E VENDAS. Três abas: "Clientes" | "Cobranças" | "Vendas".

TELA 1 — CLIENTES
- Busca por nome e lista em cards: nome do cliente, documento (CNPJ/CPF mascarado), e uma linha de
  resumo "R$ 4.200,00 em aberto · 2 cobranças".
- Detalhe do cliente: dados de contato, e as cobranças dele em lista, agrupadas por situação.
- Folha "Novo cliente": nome, documento, e-mail, telefone, observação.

TELA 2 — COBRANÇAS (contas a receber)
- Faixa de resumo com três cartões: "A receber" (R$ 18.400,00, "em aberto, no prazo"), "Vencido"
  (R$ 3.150,00 em vermelho, "4 cobranças"), "Recebido" (R$ 31.900,00 em verde, "pagamentos
  registrados").
- Filtro de mês e busca; abas internas por situação: Todas · A receber · Vencidas · Recebidas.
- Card de cobrança: cliente em destaque, descrição, vencimento, badge de situação (A receber /
  Vencido / Recebido / Cancelado), parcela ("2/6") e valor à direita.
- Detalhe: os dados acima, mais forma de pagamento, origem, quem cadastrou, e o histórico.
- Ação principal "Registrar recebimento": folha com data do recebimento e valor recebido (que pode
  ser diferente do previsto), e o resumo "previsto R$ 1.200,00 · recebido R$ 1.180,00".

TELA 3 — VENDAS
- Lista de vendas: cliente, data, valor, situação e a forma de pagamento.
- Detalhe da venda com os itens e o total, e o vínculo com as cobranças que ela gerou.

ENTREGÁVEIS
As três telas em claro, "Cobranças" também em escuro, e o card de cobrança na página de componentes.
```

---

## Prompt 7 — RH no celular ⏸ não implementado (precisa antes tirar o normalizador de dentro do RHApp.jsx)

> O RH é grande e quem o usa trabalha mais no computador. Peça por último, e só as telas que alguém
> realmente abre no celular.

```
[COLE O BLOCO COMUM AQUI]

MÓDULO: RH — só o que se usa em pé, com o celular na mão.

TELA 1 — PAINEL DO RH
Cartões de pendência empilhados, cada um com o número em destaque, o texto e uma seta:
"3 documentos vencendo em 30 dias" · "2 atestados para conferir" · "1 rescisão a pagar" ·
"4 entrevistas esta semana". Abaixo, os indicadores do mês (admissões, desligamentos, ativos).

TELA 2 — FUNCIONÁRIOS
- Busca e lista de cards: foto ou iniciais, nome, cargo, e um ponto de situação (ativo, em
  treinamento, desligado).
- Detalhe do funcionário, em abas que rolam: Dados · Benefícios · Documentos · Atestados e faltas.
  Em "Dados", os campos vêm em pares rótulo/valor, não em formulário — no celular a leitura é o uso
  comum, e a edição abre numa folha.
- Lista de documentos com validade e um selo vermelho para o que venceu.

TELA 3 — FOLHA DE PAGAMENTO
- Seletor de mês e abas: Extrato mensal · Folha de repasse · Benefícios · Rescisões ·
  Pagamento diário.
- "Extrato mensal": lista de pessoas com o líquido a pagar; ao tocar, a folha do demonstrativo com
  proventos e descontos em duas colunas e o total.
- "Pagamento diário": a mesma linguagem do Pix do dia — cards com nome, valor e o botão de marcar
  como pago — porque é a mesma tarefa, feita por quem paga.

ENTREGÁVEIS
As três telas em claro, o Painel também em escuro.
```

---

## Depois que os arquivos voltarem

- Confira a página de componentes: se cada prompt criou um card de status próprio, unifique antes de
  implementar — é o que evita o mesmo botão de três jeitos dentro do app.
- Texto abaixo de 11 px foi o único desvio que o módulo de Pagamentos precisou corrigir na
  implementação (o desenho usava 8-9 px). O Bloco comum já pede 11 px como piso; se voltar menor,
  corrija no código como foi feito em `pix-celular.tsx`.
- Cores e raios novos entram em `src/styles.css`, dentro de `.app-celular`, para não vazarem para a
  tela de computador.
