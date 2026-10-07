import { describe, it, expect } from "vitest";
import {
  projecaoFimMes,
  buildProjecao,
  lancamentosFuturos,
  itensDaProjecao,
  resumoPorMes,
  mergeRealizadoProjetado,
  type PrevistoProj,
  type LancamentoFuturo,
} from "@/lib/projecao";
import type { SaldoPoint } from "@/lib/saldo";

const prev = (p: Partial<PrevistoProj> & Pick<PrevistoProj, "data" | "tipo" | "valor">): PrevistoProj => ({
  pago: false,
  ...p,
});

describe("projecaoFimMes", () => {
  const DE = "2026-08-01";
  const ATE = "2026-08-31";

  it("soma o impacto dos previstos em aberto no período", () => {
    const previstos = [
      prev({ data: "2026-08-10", tipo: "out", valor: 200 }),
      prev({ data: "2026-08-20", tipo: "in", valor: 50 }),
    ];
    const r = projecaoFimMes(1000, previstos, DE, ATE);
    expect(r.impacto).toBe(-150);
    expect(r.saldoProjetado).toBe(850);
    expect(r.qtd).toBe(2);
  });

  it("previsto PAGO não entra (deixou de ser obrigação em aberto)", () => {
    const previstos = [
      prev({ data: "2026-08-10", tipo: "out", valor: 200, pago: true }),
      prev({ data: "2026-08-15", tipo: "out", valor: 80 }),
    ];
    const r = projecaoFimMes(1000, previstos, DE, ATE);
    expect(r.impacto).toBe(-80);
    expect(r.saldoProjetado).toBe(920);
    expect(r.qtd).toBe(1);
  });

  it("inclui vencido-não-pago do mês (de = início do mês) para não subestimar", () => {
    const previstos = [prev({ data: "2026-08-03", tipo: "out", valor: 300 })]; // vencido, em aberto
    const r = projecaoFimMes(1000, previstos, DE, ATE);
    expect(r.saldoProjetado).toBe(700);
    expect(r.qtd).toBe(1);
  });

  it("ignora previstos fora do intervalo", () => {
    const previstos = [
      prev({ data: "2026-07-31", tipo: "out", valor: 999 }),
      prev({ data: "2026-09-01", tipo: "out", valor: 999 }),
    ];
    const r = projecaoFimMes(1000, previstos, DE, ATE);
    expect(r.impacto).toBe(0);
    expect(r.saldoProjetado).toBe(1000);
    expect(r.qtd).toBe(0);
  });

  it("arredonda centavos", () => {
    const previstos = [
      prev({ data: "2026-08-05", tipo: "in", valor: 0.1 }),
      prev({ data: "2026-08-06", tipo: "in", valor: 0.2 }),
    ];
    expect(projecaoFimMes(0, previstos, DE, ATE).saldoProjetado).toBe(0.3);
  });
});

const lf = (dataISO: string, tipo: "in" | "out", valor: number): LancamentoFuturo => ({ dataISO, tipo, valor });

describe("buildProjecao", () => {
  const HOJE = "2026-08-11";
  const FIM = "2026-08-31";

  it("ponto-base = saldo inicial (hoje, não projetado) e acumula os futuros", () => {
    const lancs = [lf("2026-08-15", "out", 200), lf("2026-08-20", "in", 50)];
    const p = buildProjecao(1000, HOJE, lancs, FIM);
    expect(p.series[0]).toMatchObject({ date: HOJE, saldo: 1000, projetado: false });
    expect(p.series.at(-1)).toMatchObject({ date: "2026-08-20", saldo: 850, projetado: true });
    expect(p.saldoFinal).toBe(850);
  });

  it("aponta o saldo mínimo do período (não necessariamente o final)", () => {
    const lancs = [lf("2026-08-12", "out", 900), lf("2026-08-20", "in", 500)];
    const p = buildProjecao(1000, HOJE, lancs, FIM);
    expect(p.saldoMinimo).toEqual({ date: "2026-08-12", saldo: 100 });
    expect(p.saldoFinal).toBe(600);
  });

  it("detecta quando o saldo fica negativo e o primeiro dia", () => {
    const lancs = [lf("2026-08-12", "out", 400), lf("2026-08-14", "out", 800)];
    const p = buildProjecao(1000, HOJE, lancs, FIM);
    expect(p.ficaNegativo).toBe(true);
    expect(p.primeiroDiaNegativo).toBe("2026-08-14"); // 1000-400=600; -800 => -200
  });

  it("ignora lançamentos fora do horizonte e sem futuros fica plano", () => {
    const lancs = [lf("2026-09-05", "out", 999), lf("2026-08-01", "out", 999)];
    const p = buildProjecao(1000, HOJE, lancs, FIM);
    expect(p.series).toHaveLength(1); // só o ponto-base
    expect(p.saldoFinal).toBe(1000);
    expect(p.ficaNegativo).toBe(false);
    expect(p.primeiroDiaNegativo).toBeNull();
  });
});

describe("lancamentosFuturos", () => {
  const HOJE = "2026-08-11";
  const FIM = "2026-08-31";

  it("previsto pago fora; não pago no intervalo entra", () => {
    const previstos = [
      { data: "2026-08-15", tipo: "out" as const, valor: 100, pago: false },
      { data: "2026-08-16", tipo: "out" as const, valor: 999, pago: true },
    ];
    const r = lancamentosFuturos(previstos, [], HOJE, FIM);
    expect(r).toEqual([{ dataISO: "2026-08-15", tipo: "out", valor: 100 }]);
  });

  it("só cobranças EM ABERTO entram como entrada", () => {
    const cobrancas = [
      { vencimento: "2026-08-20", valor: 300, status: "aberto" },
      { vencimento: "2026-08-21", valor: 500, status: "pago" },
      { vencimento: "2026-08-22", valor: 700, status: "cancelado" },
    ];
    const r = lancamentosFuturos([], cobrancas, HOJE, FIM);
    expect(r).toEqual([{ dataISO: "2026-08-20", tipo: "in", valor: 300 }]);
  });

  it("flags desligam fontes", () => {
    const previstos = [{ data: "2026-08-15", tipo: "out" as const, valor: 100, pago: false }];
    const cobrancas = [{ vencimento: "2026-08-20", valor: 300, status: "aberto" }];
    expect(lancamentosFuturos(previstos, cobrancas, HOJE, FIM, { incluirCobrancas: false })).toHaveLength(1);
    expect(lancamentosFuturos(previstos, cobrancas, HOJE, FIM, { incluirPrevistos: false })).toHaveLength(1);
  });
});

describe("mergeRealizadoProjetado", () => {
  it("conecta as linhas na dobradiça (hoje tem realizado E projetado)", () => {
    const realizado: SaldoPoint[] = [
      { day: "01/08", date: "2026-08-01", saldo: 500 },
      { day: "10/08", date: "2026-08-10", saldo: 800 },
    ];
    const proj = buildProjecao(800, "2026-08-11", [lf("2026-08-20", "out", 100)], "2026-08-31");
    const merged = mergeRealizadoProjetado(realizado, proj.series);

    // ordenado por data
    expect(merged.map((m) => m.date)).toEqual(["2026-08-01", "2026-08-10", "2026-08-11", "2026-08-20"]);
    // dobradiça em 11/08: ambos preenchidos com o saldo inicial
    const hinge = merged.find((m) => m.date === "2026-08-11")!;
    expect(hinge.saldoRealizado).toBe(800);
    expect(hinge.saldoProjetado).toBe(800);
    // ponto futuro só tem projetado
    const fut = merged.find((m) => m.date === "2026-08-20")!;
    expect(fut.saldoRealizado).toBeNull();
    expect(fut.saldoProjetado).toBe(700);
  });
});

describe("itensDaProjecao", () => {
  it("segue a mesma regra de lancamentosFuturos e diz de onde veio cada item", () => {
    const previstos = [
      { data: "2026-08-15", tipo: "out" as const, valor: 100, pago: false, descricao: "Aluguel" },
      { data: "2026-08-16", tipo: "out" as const, valor: 999, pago: true, descricao: "Já pago" },
    ];
    const cobrancas = [{ vencimento: "2026-08-20", valor: 300, status: "aberto", descricao: "", clienteId: "c1" }];
    const r = itensDaProjecao(previstos, cobrancas, "2026-08-11", "2026-08-31");
    expect(r).toEqual([
      { dataISO: "2026-08-15", tipo: "out", valor: 100, origem: "previsto", descricao: "Aluguel" },
      { dataISO: "2026-08-20", tipo: "in", valor: 300, origem: "cobranca", descricao: "", clienteId: "c1" },
    ]);
    expect(lancamentosFuturos(previstos, cobrancas, "2026-08-11", "2026-08-31"))
      .toEqual(r.map(({ dataISO, tipo, valor }) => ({ dataISO, tipo, valor })));
  });
});

describe("resumoPorMes", () => {
  it("soma por mês e carrega o saldo de um mês para o outro", () => {
    const r = resumoPorMes(1000, [
      { dataISO: "2026-09-25", tipo: "in", valor: 500 },
      { dataISO: "2026-09-28", tipo: "out", valor: 200.1 },
      { dataISO: "2026-10-05", tipo: "out", valor: 2000 },
    ]);
    expect(r).toEqual([
      { mes: "2026-09", entradas: 500, saidas: 200.1, saldoFinal: 1299.9 },
      { mes: "2026-10", entradas: 0, saidas: 2000, saldoFinal: -700.1 },
    ]);
  });

  it("o último mês termina no mesmo saldo que a projeção diária", () => {
    const lanc = [
      { dataISO: "2026-09-22", tipo: "in" as const, valor: 10 },
      { dataISO: "2026-11-02", tipo: "out" as const, valor: 45.55 },
    ];
    const meses = resumoPorMes(300, lanc);
    expect(meses.at(-1)!.saldoFinal).toBe(buildProjecao(300, "2026-09-21", lanc, "2026-12-31").saldoFinal);
  });

  it("sem lançamento, sem mês", () => {
    expect(resumoPorMes(100, [])).toEqual([]);
  });
});
