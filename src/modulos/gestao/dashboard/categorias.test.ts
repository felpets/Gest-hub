import { describe, it, expect } from "vitest";
import { porCategoria, comOutras, compensacaoDe, totaisRealizados } from "@/modulos/gestao/dashboard/categorias";

const m = (tipo: "in" | "out", cat: string, valor: number) => ({ tipo, cat, valor });

// O caso da Zaytan: o aporte entra e vira anúncio. Marcadas as duas categorias,
// o cartão do Dashboard mostra só a diferença do período.
const APORTES = "Receitas / Aportes";
const ADS = "Investimento em Meta Ads / Aportes";
const compensa = (cat: string) => cat === APORTES || cat === ADS;

describe("categorias do Dashboard", () => {
  it("agrupa pelo caminho da categoria, do maior para o menor", () => {
    const r = porCategoria([m("out", "Ads / Meta", 100), m("out", "Aluguel", 900), m("out", "Ads / Meta", 50), m("in", "Receitas", 10)], "out");
    expect(r).toEqual([{ name: "Aluguel", value: 900 }, { name: "Ads / Meta", value: 150 }]);
  });

  it("sem categoria vira '(sem categoria)'", () => {
    expect(porCategoria([m("out", "", 40)], "out")).toEqual([{ name: "(sem categoria)", value: 40 }]);
  });

  it("as menores viram uma linha só, sem perder valor", () => {
    // já vem do maior para o menor, como porCategoria devolve
    const fatias = [5, 4, 3, 2, 1].map((n) => ({ name: `c${n}`, value: n * 10 }));
    const r = comOutras(fatias, 3);
    expect(r).toHaveLength(3);
    expect(r[2]).toEqual({ name: "outras 3 categorias", value: 60 });
    expect(r.reduce((s, f) => s + f.value, 0)).toBe(150);
  });
});

describe("categorias compensadas", () => {
  it("sobrou aporte: o líquido entra na receita e as duas categorias saem dos totais cheios", () => {
    const t = totaisRealizados(
      [m("in", APORTES, 19500), m("out", ADS, 2650), m("in", "Receitas / Mensalidades", 3600), m("out", "Aluguel", 6500)],
      compensa,
    );
    expect(t.entrou).toBe(3600 + 16850);
    expect(t.saiu).toBe(6500);
    expect(t.qtdEntrou).toBe(2); // a mensalidade + a linha do líquido
    expect(t.qtdSaiu).toBe(1);
    expect(t.compensacao).toMatchObject({ ativa: true, entrou: 19500, saiu: 2650, liquido: 16850, qtd: 2 });
    expect(t.compensacao.categorias).toEqual([ADS, APORTES].sort());
  });

  it("gastou mais do que entrou: o líquido vira saída", () => {
    const t = totaisRealizados([m("in", APORTES, 1000), m("out", ADS, 4000), m("in", "Receitas / Mensalidades", 500)], compensa);
    expect(t.entrou).toBe(500);
    expect(t.saiu).toBe(3000);
    expect(t.compensacao.liquido).toBe(-3000);
  });

  it("empate não vira nem receita nem saída", () => {
    const t = totaisRealizados([m("in", APORTES, 2000), m("out", ADS, 2000)], compensa);
    expect(t).toMatchObject({ entrou: 0, saiu: 0, qtdEntrou: 0, qtdSaiu: 0 });
    expect(t.compensacao.liquido).toBe(0);
  });

  it("sem categoria marcada, nada muda", () => {
    const movs = [m("in", "Receitas / Mensalidades", 1000), m("out", "Aluguel", 400)];
    const t = totaisRealizados(movs, () => false);
    expect(t).toMatchObject({ entrou: 1000, saiu: 400, qtdEntrou: 1, qtdSaiu: 1 });
    expect(t.compensacao.ativa).toBe(false);
  });

  it("compensacaoDe soma só as marcadas", () => {
    const c = compensacaoDe([m("in", APORTES, 100), m("in", "Outra", 999), m("out", ADS, 30)], compensa);
    expect(c).toMatchObject({ entrou: 100, saiu: 30, liquido: 70, qtd: 2 });
  });
});
