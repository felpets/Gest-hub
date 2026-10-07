# Roadmap — Projeção financeira a partir do CRM Comercial / Revisional

> **Status: FUTURO. Nada disto está implementado no protótipo.** O código tem apenas o contrato de tipos e
> uma chave desligada (`src/modulos/gestao/projecao-comercial/contrato.ts`,
> `PROJECAO_COMERCIAL_ATIVA = false`) para fixar a arquitetura desde já.

## 1. Regra de ouro: REALIZADO ≠ PROJEÇÃO

| | Realizado | Projeção de caixa (já existe) | Projeção comercial (futuro) |
|---|---|---|---|
| Fonte | `movimentacoes` confirmadas (extrato) | `previstos` + `cobrancas` em aberto | vendas e parcelas do CRM Comercial |
| Onde aparece | Caixa › Movimentações/Fluxo realizado; Dashboard › Análises | Caixa › Projeção de caixa; KPI "PROJEÇÃO · saldo no fim do mês" | Gestão (área própria, a criar) |
| Muda o saldo? | **sim** (é o saldo) | não | **nunca** |
| Rótulo obrigatório | — | "Projeção" | "PROJETADO" em todo número |

Regras:

1. Nenhum indicador soma realizado com projetado. Quando os dois aparecem juntos (ex.: gráfico), cada um
   tem sua série e sua legenda, como no gráfico "Realizado × projetado" do Caixa.
2. O dinheiro de uma venda só entra no realizado quando aparece no extrato (importação/Inter) e é
   confirmado na revisão. A projeção comercial apenas **acompanha** o que ainda falta receber.
3. Parcelas já recebidas no CRM e já conciliadas no extrato ficam marcadas (`valorConciliadoNoExtrato`)
   para nunca serem contadas duas vezes.

## 2. Exemplo do escopo

Venda de **R$ 2.000**, cliente pagou **R$ 500**:

| Visão | O que mostra |
|---|---|
| Financeiro realizado | R$ 500 (quando o Pix/boleto aparecer no extrato) |
| Projeção comercial | Recebido R$ 500 · **A receber R$ 1.500** · vendedor responsável · comissão estimada |

## 3. Visão gerencial futura (Gestão)

```
Vendas por vendedor (PROJETADO)
Vendedor A   Venda total R$ X   Recebido R$ Y   Em aberto R$ Z   Comissão estimada R$ W
Vendedor B   Venda total R$ X   Recebido R$ Y   Em aberto R$ Z   Comissão estimada R$ W
```

Permitirá ver: vendedores com maior saldo a receber, valores pendentes de cobrança, potencial de entrada
de caixa, estimativa de comissão, custos futuros e o fechamento financeiro projetado — sempre separado do
realizado.

## 4. Fonte de dados identificada (somente leitura, projeto "Zaytan CRM Produção")

| Tabela | Campos úteis |
|---|---|
| `vendas` | `valor_venda`, `valor_original`, `vendedor_id`, `supervisor_id`, `equipe`, `status`, `venda_valida`, `pagamento_integral`, `estornado_em`, `deleted_at`, `created_at`, `cliente_id` |
| `venda_comprovantes` | comprovantes por venda |
| `juridico_caso_pagamentos` | `valor`, `vencimento`, `pago_em` (parcelas) |
| `juridico_quitacoes` | `valor_alvo`, `valor_entrada`, `acordo_parcelas`, `acordo_valor_parcela`, `quitado_em` |
| `metas`, `equipes`, `profiles` | metas por vendedor/equipe e nomes |

Observações: o CRM é multi-tenant (`cliente_id` = escritório/empresa cliente da Zaytan) e usa outro Auth.
Será preciso um de-para `cliente_id` → `empresas.id` do Zaytan Hub.

## 5. Etapas propostas

1. **Contrato (feito):** tipos `VendaProjetada`, `ResumoVendedor`, `PontoProjecao` e a porta
   `FonteProjecaoComercial`.
2. **Leitura segura:** Edge Function com credencial própria (nunca a service role no navegador) que devolve
   vendas e parcelas já normalizadas por empresa.
3. **Regras de negócio a definir com o comercial:** o que conta como "venda fechada" (`venda_valida`,
   estornos, exclusões), regra de comissão, custos futuros por venda.
4. **Tela na Gestão:** "Projeção comercial", com os números rotulados como PROJETADOS e drill-down por
   vendedor; nenhuma alteração nas telas do realizado.
5. **Conciliação:** marcar parcelas do CRM que já apareceram no extrato (mesma técnica da conciliação de
   cobranças: nome + valor + janela de data).
6. **Somente depois:** combinar a projeção comercial com a projeção de caixa num gráfico com séries
   separadas.
