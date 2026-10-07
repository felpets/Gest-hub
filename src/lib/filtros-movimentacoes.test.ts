import { describe, it, expect } from "vitest";
import { deslocamentoCompetencia } from "@/lib/filtros-movimentacoes";


// ─── Competência × data do pagamento ────────────────────────
// O caso real: "Folha de Pagamento / Salários" conta no mês anterior. O salário
// pago em setembro entra no relatório de agosto — e o relatório de setembro
// fica menor que o caixa de setembro, pelo valor exato dos salários.
describe("deslocamentoCompetencia", () => {
  const SAL = "Folha de Pagamento / Salários";
  const m = (dataISO: string, dataComp: string, tipo: "in" | "out", valor: number, cat = SAL) =>
    ({ dataISO, dataComp, tipo, valor, cat });

  it("mostra o que foi pago no período e conta em outro mês", () => {
    const d = deslocamentoCompetencia(
      [m("2026-09-05", "2026-08-05", "out", 15994.59), m("2026-09-10", "2026-09-10", "out", 500, "Aluguel")],
      "2026-09-01", "2026-09-30",
    );
    expect(d).toMatchObject({ saiuSaidas: 15994.59, entrouSaidas: 0, temDiferenca: true });
    expect(d.categorias).toEqual([SAL]);
  });

  it("mostra o que veio de outro mês para dentro do período", () => {
    const d = deslocamentoCompetencia([m("2026-10-05", "2026-09-05", "out", 16000)], "2026-09-01", "2026-09-30");
    expect(d).toMatchObject({ entrouSaidas: 16000, saiuSaidas: 0, temDiferenca: true });
  });

  it("entradas e saídas são contadas em separado", () => {
    const d = deslocamentoCompetencia(
      [m("2026-09-02", "2026-08-02", "in", 300, "Receitas / Comissão"), m("2026-09-03", "2026-08-03", "out", 700)],
      "2026-09-01", "2026-09-30",
    );
    expect(d).toMatchObject({ saiuEntradas: 300, saiuSaidas: 700 });
    expect(d.categorias).toEqual(["Folha de Pagamento / Salários", "Receitas / Comissão"]);
  });

  it("sem regra de competência (ou com o mesmo mês dos dois lados), não há diferença", () => {
    const d = deslocamentoCompetencia(
      [m("2026-09-10", "2026-09-10", "out", 500, "Aluguel"), m("2026-09-20", "2026-09-05", "out", 100)],
      "2026-09-01", "2026-09-30",
    );
    expect(d.temDiferenca).toBe(false);
  });

  it("sem período escolhido, tudo está dentro: nada a explicar", () => {
    const d = deslocamentoCompetencia([m("2026-09-05", "2026-08-05", "out", 15994.59)], null, null);
    expect(d.temDiferenca).toBe(false);
  });
});
