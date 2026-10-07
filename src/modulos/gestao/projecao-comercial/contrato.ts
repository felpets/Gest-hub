// ─── Projeção comercial (ROADMAP — NÃO IMPLEMENTADO) ───────────────────────
// Contrato da futura integração com o CRM Comercial/Revisional (projeto
// Supabase "Zaytan CRM Produção"). Nada aqui é usado pelas telas ainda: o
// arquivo existe para fixar, desde já, a regra de ouro:
//
//            REALIZADO (extrato)  ≠  PROJETADO (vendas/contratos)
//
// • Realizado = `movimentacoes` confirmadas. É a única fonte de saldo,
//   fluxo realizado e análises financeiras. Nunca recebe valor projetado.
// • Projeção de caixa (já existe) = contas a pagar + cobranças em aberto,
//   na aba Financeiro › Caixa › Projeção.
// • Projeção comercial (futura) = vendas fechadas no CRM, com o quanto já foi
//   recebido e o quanto está em aberto. Vive numa camada própria e só aparece
//   com rótulo "PROJETADO"; nunca é somada a um indicador realizado.
//
// Ver docs/ROADMAP-PROJECAO-COMERCIAL.md.

export const PROJECAO_COMERCIAL_ATIVA = false;

// Uma venda do CRM, já normalizada para a visão financeira.
// Origem prevista: vendas (valor_venda, vendedor_id, status, venda_valida,
// pagamento_integral) + juridico_caso_pagamentos (valor, vencimento, pago_em).
export type VendaProjetada = {
  vendaId: string;
  empresaId: string;          // empresa do Zaytan Hub a que a venda pertence
  clienteNome: string;
  vendedorId: string;
  vendedorNome: string;
  fechadaEm: string;          // YYYY-MM-DD
  valorContratado: number;    // total da venda
  valorRecebido: number;      // pagamentos confirmados no CRM
  valorEmAberto: number;      // contratado − recebido (nunca negativo)
  parcelasFuturas: { vencimento: string; valor: number }[];
  // Recebido no CRM que JÁ apareceu no extrato (conciliado). Só isto pode ser
  // comparado com o realizado — e mesmo assim sem ser somado de novo.
  valorConciliadoNoExtrato: number;
};

// Resumo por vendedor (a "visão gerencial de projeção" do roadmap).
export type ResumoVendedor = {
  vendedorId: string;
  vendedorNome: string;
  vendido: number;
  recebido: number;
  emAberto: number;
  comissaoEstimada: number;   // regra de comissão a definir (configurável)
};

// Série da projeção: sempre separada da série realizada.
export type PontoProjecao = {
  data: string;
  entradaProjetada: number;   // parcelas a receber das vendas
  saidaProjetada: number;     // comissões e custos futuros estimados
};

// Porta de entrada da integração. A implementação real (leitura do CRM via
// Edge Function/serviço com credencial própria) entra numa fase futura.
export interface FonteProjecaoComercial {
  listarVendas(empresaId: string, de: string, ate: string): Promise<VendaProjetada[]>;
}

export function resumirPorVendedor(vendas: VendaProjetada[], taxaComissao = 0): ResumoVendedor[] {
  const mapa = new Map<string, ResumoVendedor>();
  for (const v of vendas) {
    const r = mapa.get(v.vendedorId) ?? {
      vendedorId: v.vendedorId, vendedorNome: v.vendedorNome, vendido: 0, recebido: 0, emAberto: 0, comissaoEstimada: 0,
    };
    r.vendido += v.valorContratado;
    r.recebido += v.valorRecebido;
    r.emAberto += Math.max(v.valorContratado - v.valorRecebido, 0);
    r.comissaoEstimada = Math.round(r.vendido * taxaComissao * 100) / 100;
    mapa.set(v.vendedorId, r);
  }
  return [...mapa.values()].sort((a, b) => b.emAberto - a.emAberto);
}
