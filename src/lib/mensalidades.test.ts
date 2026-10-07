import { describe, it, expect } from "vitest";
import {
  ID_LEGADO, cobrancasDaMensalidade, mensalidadesDoCliente, situacaoMensalidade, statusDoCliente,
} from "@/lib/mensalidades";
import type { Cliente, Cobranca, Mensalidade } from "@/lib/queries";

const cliente = (p: Partial<Cliente> = {}): Cliente => ({
  id: "c1", nome: "Alexandre", status: "Pago", mens: 1000, ticket: 0, atraso: 0, ativo: true,
  diaVencimento: 1, clienteDesde: "2026-01-01", chaveOfx: "", criadoEm: "2026-01-01T00:00:00Z", ...p,
});
const mens = (p: Partial<Mensalidade>): Mensalidade => ({
  id: "m1", clienteId: "c1", descricao: "Mensalidade", valor: 1000, diaVencimento: 1,
  inicio: "2026-01-01", ativo: true, criadoEm: "2026-01-01T00:00:00Z", ...p,
});
const cob = (p: Partial<Cobranca>): Cobranca => ({
  id: Math.random().toString(36).slice(2), clienteId: "c1", competencia: "2026-09-01", vencimento: "2026-09-01",
  valor: 1000, status: "aberto", pagoEm: null, pagoValor: null, movimentacaoId: null, vendaId: null,
  mensalidadeId: "m1", parcela: null, parcelasTotal: null, formaPagamento: "", descricao: "", criadoPor: null, ...p,
});

describe("mensalidadesDoCliente", () => {
  it("com a tabela, lista só as do cliente", () => {
    const todas = [mens({ id: "m1" }), mens({ id: "m2", clienteId: "outro" }), mens({ id: "m3", descricao: "Suporte" })];
    expect(mensalidadesDoCliente(cliente(), true, todas).map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  it("sem a tabela (banco sem a migração 52), a mensalidade do cliente vira uma só", () => {
    const [m] = mensalidadesDoCliente(cliente({ mens: 750, diaVencimento: 10 }), false, []);
    expect(m).toMatchObject({ id: ID_LEGADO, valor: 750, diaVencimento: 10 });
    expect(mensalidadesDoCliente(cliente({ mens: 0 }), false, [])).toEqual([]);
  });
});

describe("cobrancasDaMensalidade", () => {
  const lista = [
    cob({ mensalidadeId: "m1", competencia: "2026-08-01" }),
    cob({ mensalidadeId: "m2", competencia: "2026-08-01" }),
    cob({ mensalidadeId: null, competencia: "2026-01-01" }),          // anterior à migração
    cob({ mensalidadeId: null, vendaId: "v1", competencia: "2026-08-01" }), // parcela de venda
    cob({ mensalidadeId: "m1", status: "cancelado", competencia: "2026-07-01" }),
  ];

  it("separa por mensalidade e deixa venda e cancelada de fora", () => {
    expect(cobrancasDaMensalidade(mens({ id: "m2" }), false, lista)).toHaveLength(1);
  });

  it("as cobranças antigas, sem mensalidade, ficam com a primeira do cliente", () => {
    const r = cobrancasDaMensalidade(mens({ id: "m1" }), true, lista);
    expect(r.map((c) => c.competencia).sort()).toEqual(["2026-01-01", "2026-08-01"]);
  });
});

describe("situacaoMensalidade", () => {
  const HOJE = "2026-09-21";

  it("o atraso conta desde a cobrança vencida mais antiga, não só a do mês", () => {
    const s = situacaoMensalidade([
      cob({ competencia: "2026-08-01", vencimento: "2026-08-20" }),
      cob({ competencia: "2026-09-01", vencimento: "2026-09-20" }),
      cob({ competencia: "2026-07-01", vencimento: "2026-07-20", status: "pago" }),
    ], HOJE, "2026-09-01");
    expect(s.atrasoDias).toBe(32);
    expect(s.emAtraso).toBe(2);
    expect(s.valorEmAtraso).toBe(2000);
    expect(s.doMes?.competencia).toBe("2026-09-01");
  });

  it("a que vence hoje ainda não está atrasada", () => {
    expect(situacaoMensalidade([cob({ vencimento: HOJE })], HOJE, "2026-09-01").atrasoDias).toBe(0);
  });
});

describe("statusDoCliente", () => {
  const ok = { atrasoDias: 0, emAtraso: 0, valorEmAtraso: 0, doMes: cob({ status: "pago" }) };
  const aberta = { ...ok, doMes: cob({ status: "aberto" }) };
  const atrasada = { ...ok, atrasoDias: 12, emAtraso: 1, valorEmAtraso: 500 };

  it("uma mensalidade atrasada basta para o cliente estar atrasado", () => {
    expect(statusDoCliente(true, [ok, atrasada])).toBe("Atrasado");
  });
  it("todas pagas no mês = pago; alguma em aberto = pendente", () => {
    expect(statusDoCliente(true, [ok, ok])).toBe("Pago");
    expect(statusDoCliente(true, [ok, aberta])).toBe("Pendente");
  });
  it("cliente inativo não é cobrado", () => {
    expect(statusDoCliente(false, [atrasada])).toBe("Inativo");
  });
});
