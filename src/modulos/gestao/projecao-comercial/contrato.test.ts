import { describe, expect, it } from "vitest";
import { PROJECAO_COMERCIAL_ATIVA, resumirPorVendedor, type VendaProjetada } from "./contrato";

const venda = (p: Partial<VendaProjetada>): VendaProjetada => ({
  vendaId: "v", empresaId: "e", clienteNome: "c", vendedorId: "a", vendedorNome: "Vendedor A",
  fechadaEm: "2026-09-01", valorContratado: 0, valorRecebido: 0, valorEmAberto: 0,
  parcelasFuturas: [], valorConciliadoNoExtrato: 0, ...p,
});

describe("projeção comercial (roadmap)", () => {
  it("fica desligada neste protótipo", () => {
    expect(PROJECAO_COMERCIAL_ATIVA).toBe(false);
  });

  it("exemplo do escopo: venda de R$ 2.000 com R$ 500 pagos deixa R$ 1.500 em aberto", () => {
    const [r] = resumirPorVendedor([venda({ valorContratado: 2000, valorRecebido: 500 })], 0.1);
    expect(r).toMatchObject({ vendido: 2000, recebido: 500, emAberto: 1500, comissaoEstimada: 200 });
  });

  it("ordena vendedores pelo saldo a receber", () => {
    const r = resumirPorVendedor([
      venda({ vendedorId: "a", vendedorNome: "A", valorContratado: 1000, valorRecebido: 900 }),
      venda({ vendedorId: "b", vendedorNome: "B", valorContratado: 3000, valorRecebido: 0 }),
    ]);
    expect(r.map((x) => x.vendedorNome)).toEqual(["B", "A"]);
  });
});
