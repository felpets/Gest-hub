import { describe, it, expect } from "vitest";
import {
  diferenca, erroParcelamento, parcelasIguais, redimensionar, somaParcelas, somarMeses,
} from "@/lib/parcelamento";

describe("parcelamento de venda", () => {
  it("anda de mês mantendo o dia, e encolhe no mês curto", () => {
    expect(somarMeses("2026-09-10", 0)).toBe("2026-09-10");
    expect(somarMeses("2026-09-10", 3)).toBe("2026-12-10");
    expect(somarMeses("2026-11-15", 2)).toBe("2027-01-15");
    // 31 de janeiro + 1 mês não existe: cai no último dia de fevereiro.
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("parcelas iguais fecham no centavo, com a sobra na primeira", () => {
    const p = parcelasIguais(6000, 3, "2026-09-10");
    expect(p.map((x) => x.valor)).toEqual([2000, 2000, 2000]);
    expect(p.map((x) => x.vencimento)).toEqual(["2026-09-10", "2026-10-10", "2026-11-10"]);

    // 10.000 em 3 não divide redondo: 3.333,34 + 3.333,33 + 3.333,33 = 10.000.
    const q = parcelasIguais(10000, 3, "2026-10-10");
    expect(q.map((x) => x.valor)).toEqual([3333.34, 3333.33, 3333.33]);
    expect(somaParcelas(q)).toBe(10000);
  });

  it("uma parcela só é a venda inteira", () => {
    expect(parcelasIguais(1500, 1, "2026-09-10")).toEqual([{ valor: 1500, vencimento: "2026-09-10" }]);
  });

  it("aceita o parcelamento livre quando a soma fecha", () => {
    const livres = [
      { valor: 2000, vencimento: "2026-10-10" },
      { valor: 3000, vencimento: "2026-11-10" },
      { valor: 2000, vencimento: "2026-12-10" },
      { valor: 3000, vencimento: "2027-01-10" },
    ];
    expect(somaParcelas(livres)).toBe(10000);
    expect(diferenca(livres, 10000)).toBe(0);
    expect(erroParcelamento(livres, 10000)).toBeNull();
  });

  it("avisa quando a soma não bate com o valor da venda", () => {
    const faltando = [{ valor: 2000, vencimento: "2026-10-10" }, { valor: 3000, vencimento: "2026-11-10" }];
    expect(erroParcelamento(faltando, 10000)).toMatch(/Faltam/);
    const sobrando = [{ valor: 8000, vencimento: "2026-10-10" }, { valor: 3000, vencimento: "2026-11-10" }];
    expect(erroParcelamento(sobrando, 10000)).toMatch(/a mais/);
  });

  it("recusa parcela sem valor ou sem data", () => {
    expect(erroParcelamento([], 100)).toMatch(/ao menos uma/);
    expect(erroParcelamento([{ valor: 0, vencimento: "2026-10-10" }], 0)).toMatch(/maior que zero/);
    expect(erroParcelamento([{ valor: 100, vencimento: "" }], 100)).toMatch(/data de vencimento/);
  });

  it("tolera o centavo do rateio, mas não um erro de verdade", () => {
    // 3 parcelas com 1 centavo de diferença: aceita.
    expect(erroParcelamento(parcelasIguais(10000, 3, "2026-10-10"), 10000)).toBeNull();
    expect(erroParcelamento([{ valor: 99.9, vencimento: "2026-10-10" }], 100)).toMatch(/Faltam/);
  });

  it("mudar a quantidade preserva o que já foi digitado", () => {
    const atual = [
      { valor: 2000, vencimento: "2026-10-10" },
      { valor: 3000, vencimento: "2026-11-10" },
    ];
    const maior = redimensionar(atual, 4, 10000, "2026-10-10");
    expect(maior).toHaveLength(4);
    expect(maior.slice(0, 2)).toEqual(atual);
    expect(redimensionar(atual, 1, 10000, "2026-10-10")).toEqual([atual[0]]);
    expect(redimensionar(atual, 2, 10000, "2026-10-10")).toBe(atual);
  });
});
