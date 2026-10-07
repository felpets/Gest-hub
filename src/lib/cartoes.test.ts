import { describe, it, expect } from "vitest";
import {
  chaveDescricao, faturaDe, gastosPorCategoria, itensDoCartao, mesesEntreYM, parcelaDe, resumoPorFatura, totalPorMes,
  type PrevistoCartao, type RecorrenteCartao,
} from "@/lib/cartoes";

const rec = (p: Partial<RecorrenteCartao> = {}): RecorrenteCartao => ({
  id: "r1", inicio: "2026-09-01", fim: "2027-08-01", ...p,
});

const prev = (p: Partial<PrevistoCartao> = {}): PrevistoCartao => ({
  id: "p1", data: "2026-09-10", descricao: "Sistema X", categoria: "Sistemas / Claude",
  valor: 500, pago: false, recorrenteId: "r1", cartaoId: "c1", ...p,
});

describe("o que cai em cada cartão", () => {
  it("conta meses entre competências, inclusive", () => {
    expect(mesesEntreYM("2026-09", "2026-09")).toBe(1);
    expect(mesesEntreYM("2026-09", "2027-08")).toBe(12);
    expect(mesesEntreYM("2026-11", "2027-01")).toBe(3);
  });

  it("descobre a parcela pela regra de início e fim", () => {
    expect(parcelaDe(rec(), "2026-09-10")).toEqual({ atual: 1, total: 12 });
    expect(parcelaDe(rec(), "2026-11-10")).toEqual({ atual: 3, total: 12 });
    expect(parcelaDe(rec(), "2027-08-10")).toEqual({ atual: 12, total: 12 });
  });

  it("recorrência contínua não é parcelamento", () => {
    expect(parcelaDe(rec({ fim: null }), "2026-11-10")).toBeNull();
    expect(parcelaDe(undefined, "2026-11-10")).toBeNull();
  });

  it("mês fora do intervalo da regra não vira parcela inventada", () => {
    expect(parcelaDe(rec(), "2026-08-10")).toBeNull();
    expect(parcelaDe(rec(), "2027-09-10")).toBeNull();
  });

  it("lista só o que é do cartão e está na janela, em ordem de data", () => {
    const itens = itensDoCartao(
      [
        prev({ id: "a", data: "2026-10-10" }),
        prev({ id: "b", data: "2026-09-10" }),
        prev({ id: "fora-janela", data: "2027-05-10" }),
        prev({ id: "outro-cartao", data: "2026-09-12", cartaoId: "c2" }),
        prev({ id: "sem-cartao", data: "2026-09-12", cartaoId: null }),
      ],
      [rec()],
      "c1",
      { de: "2026-09-01", ate: "2026-12-31" },
    );
    expect(itens.map((i) => i.id)).toEqual(["b", "a"]);
    expect(itens[0].parcela).toEqual({ atual: 1, total: 12 });
    expect(itens[1].parcela).toEqual({ atual: 2, total: 12 });
  });

  it("marca a contínua e soma o comprometido por mês", () => {
    const itens = itensDoCartao(
      [
        prev({ id: "a", data: "2026-09-10", valor: 150, recorrenteId: "cont" }),
        prev({ id: "b", data: "2026-09-20", valor: 500 }),
        prev({ id: "c", data: "2026-10-10", valor: 150, recorrenteId: "cont" }),
      ],
      [rec(), rec({ id: "cont", fim: null })],
      "c1",
      { de: "2026-09-01", ate: "2026-12-31" },
    );
    expect(itens.find((i) => i.id === "a")?.contínua).toBe(true);
    expect(itens.find((i) => i.id === "b")?.contínua).toBe(false);
    expect(totalPorMes(itens)).toEqual([
      { mes: "2026-09", total: 650, itens: 2 },
      { mes: "2026-10", total: 150, itens: 1 },
    ]);
  });
});

describe("faturaDe", () => {
  const fecha28vence5 = { diaFechamento: 28, diaVencimento: 5 };
  it("compra até o fechamento cai na fatura que vence no mês seguinte", () => {
    expect(faturaDe("2026-09-10", fecha28vence5)).toBe("2026-10");
    expect(faturaDe("2026-09-28", fecha28vence5)).toBe("2026-10");
  });
  it("compra depois do fechamento pula uma fatura", () => {
    expect(faturaDe("2026-09-29", fecha28vence5)).toBe("2026-11");
    expect(faturaDe("2026-12-30", fecha28vence5)).toBe("2027-02");
  });
  it("vencimento depois do fechamento vence no mesmo mês", () => {
    expect(faturaDe("2026-09-10", { diaFechamento: 20, diaVencimento: 28 })).toBe("2026-09");
    expect(faturaDe("2026-09-21", { diaFechamento: 20, diaVencimento: 28 })).toBe("2026-10");
  });
  it("sem fechamento cadastrado vale o mês da compra", () => {
    expect(faturaDe("2026-09-29", { diaFechamento: null, diaVencimento: null })).toBe("2026-09");
  });
});

describe("demonstrativo do cartão", () => {
  const cartao = { diaFechamento: 28, diaVencimento: 5 };
  const l = (dataISO: string, valor: number, tipo: "in" | "out", categoria = "") => ({ dataISO, valor, tipo, categoria });

  it("resume gastos e créditos por fatura, da mais recente para a mais antiga", () => {
    const r = resumoPorFatura([l("2026-08-10", 100, "out"), l("2026-09-02", 50, "out"), l("2026-09-03", 20, "in")], cartao);
    expect(r).toEqual([
      { mes: "2026-10", gastos: 50, creditos: 20, itens: 2 },
      { mes: "2026-09", gastos: 100, creditos: 0, itens: 1 },
    ]);
  });

  it("valor positivo é pagamento da fatura: não entra nos gastos, nem com categoria", () => {
    const r = gastosPorCategoria([
      l("2026-09-01", 236.4, "out", "Adm / Material"),
      l("2026-09-05", 36.4, "in", "Adm / Material"),
      l("2026-09-06", 90, "out"),
      l("2026-09-07", 5000, "in"),
    ]);
    expect(r).toEqual([{ categoria: "Adm / Material", total: 236.4 }, { categoria: "", total: 90 }]);
  });

  it("chaveDescricao ignora caixa, acento e pontuação", () => {
    expect(chaveDescricao("ANTHROPIC  CLAUDE*")).toBe(chaveDescricao("anthropic claude"));
    expect(chaveDescricao("Kalúnga")).toBe("kalunga");
  });
});
