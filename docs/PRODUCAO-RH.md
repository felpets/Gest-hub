# Saída do protótipo — RH no banco do Financeiro

Roteiro para o Zaytan Hub passar a usar os dados reais: o Financeiro como já está e o RH trazido do
projeto "ZAYTAN CRM RH" para o projeto Financeiro (caminho A). Tudo aditivo: nada do Financeiro é
alterado e o projeto antigo do RH só é lido.

## O que muda

| Tema | Antes | Agora |
|---|---|---|
| Login | um no Financeiro, outro no RH | só o do Financeiro |
| Onde o RH guarda os dados | projeto `apatabasuxkgqxabuqdj` | tabelas `rh_*` no projeto Financeiro (`ieqkhecsyarszhhonaor`) |
| Quem entra no RH | qualquer login do projeto RH (4 contas genéricas, todas com acesso total) | só quem o master liberar em **Gestão › Usuários › RH** (tabela `rh_acessos`); o master sempre entra |
| Segurança no banco | "logado vê tudo" | o banco aplica a empresa e o perfil de cada acesso (`rh_pode`) |
| Empresas no RH | lista fixa no código, todas juntas, com filtro em cada tela | vêm do cadastro (**Gestão › Empresas e cargos**: empresa só do Financeiro, só do RH ou dos dois); **uma empresa por vez**, escolhida no topo como no Financeiro, e "Todas as empresas" para quem tem o RH sem restrição (usada no fechamento da folha) |
| Alcance do acesso ao RH | tudo | todas as empresas, ou só as marcadas (uma ou várias) |
| Pix do dia × pagamento diário do RH | listas separadas | o Pix do dia **vê** (só leitura) o que o RH lançou para a empresa; o RH **não vê** o Pix do Financeiro |

## Situação em 17/09/2026

| Passo | Situação |
|---|---|
| 1. Migrações 42 e 43 no projeto Financeiro | ✅ aplicadas (15 tabelas `rh_*` com RLS, 2 buckets privados, `rh_pode`, `fn_rh_pagamentos_para_pix`) |
| 2. RH liberado para `ti.laportec@gmail.com` (cargo Pagamentos Diários na Laportec) | ✅ administrador do RH, todas as empresas |
| 2b. Migração 44 (empresas por módulo, RH em várias empresas) | ✅ aplicada |
| 2c. Migração 45 (administração por pessoa, na tela Usuários › Acessos) | ✅ aplicada |
| 2d. Migração 46 (registro de alterações de usuários, exclusão de login) | ✅ aplicada — a exclusão passa por `/api/usuarios`, então só funciona no site da Vercel (ou `vercel dev`) |
| 2e. Migração 47 (funcionalidades opcionais por empresa) | ✅ aplicada — coluna `configuracoes.funcionalidades` |
| 2f. Migração 48 (o RH aparece no Financeiro) | ✅ aplicada — `fn_rh_compromissos_financeiros`, conferida com os dados reais |
| 2g. Migração 49 (recorrência com o valor do RH) | ✅ aplicada — `recorrentes.fonte_rh` + `fn_rh_totais_mensais` |
| 3. Cópia dos dados | ✅ última em 29/09/2026: tudo do CRM antigo está no sistema novo, com as mesmas somas |
| 4. Teste com login real (`npm run dev:real`) | ⏳ com vocês |
| 5. Virada (cópia final com `--espelhar`) | ⏳ |
| 6. Publicação na Vercel | ⏳ |

Números da última cópia — **29/09/2026** (`npm run rh:copiar-dados -- --gravar`):

| Tabela | Veio do CRM antigo | Só do sistema novo | Soma conferida |
|---|---:|---:|---:|
| Funcionários | 67 | 1 | — |
| Candidatos | 223 | 1 | — |
| Pagamentos | 256 | 2 | R$ 233.785,58 |
| Atestados | 58 | 0 | — |
| Documentos | 3 | 2 | — |
| Treinamentos | 0 | 1 | — |
| Perguntas | 7 | 0 | — |
| Pagamentos diários | 13 | 0 | R$ 2.335,62 |
| Extratos | 58 | 0 | líquido R$ 40.865,38 |
| Verbas (folha_eventos) | 511 | 0 | R$ 201.650,46 |
| Arquivos (bucket `documentos`) | 1 | 2 | — |

A coluna **só do sistema novo** é o que foi cadastrado aqui e o CRM antigo nunca conheceu. Não é
divergência — e é exatamente o que `--espelhar` apagaria, por isso ele só entra na virada, com o CRM
antigo parado.

A configuração do RH **não** é copiada (o `--config` existe, mas reverteria o que foi ajustado aqui).

Até a virada, o CRM RH antigo continua em uso e é a fonte da verdade. Antes de trocar de sistema, rode a
cópia final.

## Passo a passo

1. **Criar a estrutura no banco do Financeiro.** No SQL Editor do projeto Financeiro, rode, nesta
   ordem, [`supabase/42_rh_modulo.sql`](../supabase/42_rh_modulo.sql),
   [`supabase/43_pix_ve_pagamentos_rh.sql`](../supabase/43_pix_ve_pagamentos_rh.sql) e
   [`supabase/44_empresas_por_modulo.sql`](../supabase/44_empresas_por_modulo.sql) e
   [`supabase/45_administracao_por_usuario.sql`](../supabase/45_administracao_por_usuario.sql). Todos podem rodar de
   novo sem efeito colateral. A 44 marca as empresas atuais como Financeiro **e** RH e troca o acesso ao RH
   de uma empresa para uma lista (os acessos atuais são copiados antes).
2. **Liberar o RH para a Kimberly.** Em **Gestão › Usuários**, abra **Acessos** na linha dela e ligue o RH
   (quem só usa o RH pode ser criado em Novo usuário com a empresa "Nenhuma"). Escolha:
   - **perfil no RH:** Administrador;
   - **empresas:** todas.

   Com acesso restrito a uma empresa, ela deixaria de ver os 15 extratos da contabilidade que ainda
   não estão vinculados a um funcionário.
3. **Copiar os dados do RH.** Em `.env.local` (fora do Git), preencha `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `RH_ORIGEM_URL` e `RH_ORIGEM_SERVICE_ROLE_KEY`. As chaves de serviço
   ficam em *Project Settings › API keys* de cada projeto. Depois:
   ```bash
   npm run rh:copiar-dados              # só confere: contagens e somas nos dois lados
   npm run rh:copiar-dados -- --gravar  # copia (pode repetir)
   ```
   O script não imprime nomes, CPFs nem valores individuais, só contagens e somas por tabela. Os
   números da primeira cópia estão na tabela acima.
4. **Testar com o seu login, sem publicar:** `npm run dev:real` e abra http://localhost:8080. Esse
   comando usa `.env.real.local`, com as chaves públicas do Financeiro. Confira:
   - Financeiro: Caixa, Pagamentos e Dashboard com os números de sempre;
   - RH: funcionários, folha e pagamento diário iguais aos do CRM RH, trocando a empresa no topo;
     os 15 extratos sem empresa vinculada só aparecem em "Todas as empresas";
   - Pix do dia: a seção "Pagamentos diários lançados no RH".
5. **Virada.** Avise a Kimberly, pare de usar o CRM RH antigo e rode a cópia final:
   ```bash
   npm run rh:copiar-dados -- --gravar --espelhar
   ```
   `--espelhar` também apaga no destino o que foi apagado na origem, por isso só vale com o CRM RH
   parado. Deixe o CRM RH antigo só para consulta por um tempo.
6. **Publicar na Vercel**, no projeto que servirá o Zaytan Hub:
   - `VITE_DATA_MODE=real`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`;
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET`, para `/api/usuarios`, `/api/inter` e o cron;
   - devolver ao `vercel.json` o cron `/api/cron/inter-sync`, que foi tirado no protótipo.

## Depois da virada

- **Senhas das contas genéricas:** trocar as senhas das 4 contas do projeto RH antigo, ou
  desativá-las, porque elas ainda leem tudo por lá.
- **Leitura do Financeiro por cargo (achado antigo):** hoje qualquer membro de uma empresa **lê** pela API
  todas as tabelas dela, como movimentações e contas. A tela esconde conforme o cargo, mas o banco não
  bloqueia: um login só de Pix consegue ler o extrato. Vale restringir a leitura por capacidade, como já
  é feito no Pix do dia.
- **Unificar de fato Pix × pagamento diário:** hoje é só leitura, e a baixa continua em cada lado.
- **Vale × Repasse (adiantamento):** alinhar as duas regras. Ver
  [CONSOLIDACAO.md](CONSOLIDACAO.md) §8.

---

## O RH dentro do Financeiro (migração 48)

Desde 17/09/2026, o que o RH lança aparece no Financeiro **por leitura**, sem cópia nenhuma:

| Origem no RH | Como aparece no Financeiro | Quando vira realizado |
|---|---|---|
| `rh_pagamentos` tipo **Adiantamento** | saída "Adiantamento quinzenal (RH)", por pessoa | quando o RH marca `status = Realizado` (ou grava `dataPagamento`) |
| `rh_pagamentos` tipo **Salário** | saída "Salário — folha (RH)", por pessoa | idem |
| `rh_pagamentos_diarios` | saída "Pagamento diário (RH)" | quando o RH marca como pago |
| *(nada lançado ainda)* | **projeção**: salário cadastrado × percentual de adiantamento | quando o RH lançar o valor real, ele substitui a projeção sozinho |

`Desconto Falta` não entra: abate o salário, não é saída de caixa.

**Quem vê o quê.** A folha por pessoa (nome e valor) vai para quem já enxerga o dinheiro da empresa
inteira — quem tem *Ver Dashboard* ou *Gerenciar Contas a Pagar*, e o master. O cargo **Pagamentos
Diários** (só Pix) continua recebendo apenas os pagamentos diários do RH, que ele já via. A chave Pix não
sai por essa função.

Conferência com os dados reais (setembro e outubro de 2026, as duas empresas):

```sql
select origem, fonte, status, count(*), sum(valor)
  from public.fn_rh_compromissos_financeiros('<empresa_id>', date '2026-09-01', date '2026-10-31')
 group by 1,2,3 order by 1,2,3;
```

Datas: o adiantamento cai no dia útil até o dia 20 (o `valeDia` da configuração do RH) e o salário no
último dia útil do mês da competência — que é a data que o próprio RH grava em `dataPrevista` (31/07,
31/08, 30/09…). O campo `diaPagamento` da configuração do RH descreve outra coisa e não é usado aqui.

## A recorrência de Folha puxando o valor do RH (migração 49)

As recorrências de Folha do Financeiro (Adiantamento, Salários, Vale Transporte, Vale Refeição) continuam
como lembrete de vencimento — e agora podem tirar o valor de cada mês direto do RH. Em Pagamentos ›
Contas do mês, edite a recorrência e escolha em **"De onde vem o valor"**:

| Fonte | O que soma |
|---|---|
| Folha — líquido a pagar | salários cadastrados − adiantamento |
| Salários — bruto cadastrado | soma dos salários dos ativos |
| Adiantamento quinzenal | percentual da empresa, percentual próprio ou valor fixo de cada um |
| Vale-transporte | valor do dia × dias úteis da configuração, custo cheio da empresa |
| Vale-refeição | valor do dia × dias do mês, na base escolhida no RH |

A conta **em aberto** se atualiza sozinha a cada abertura de Contas do mês; a conta **já paga nunca muda**.
Se os totais do RH não vierem, o valor gravado continua valendo — a conta nunca é zerada.

Com a recorrência de folha ligada, o Dashboard deixa de listar aquela rubrica pessoa a pessoa: o mesmo
dinheiro não aparece duas vezes.

Conferência dos totais:

```sql
select * from public.fn_rh_totais_mensais('<empresa_id>', date '2026-09-01', date '2026-11-30');
```

Em 18/09/2026, com os dados reais: Laportec — salários R$ 38.450,00, adiantamento R$ 12.540,00,
VT R$ 9.156,62, VR R$ 7.180,80 (20 pessoas ativas); Zaytan — R$ 3.330,00 / R$ 1.340,00 / R$ 809,60 /
R$ 598,40 (2 pessoas).
