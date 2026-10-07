import { describe, it, expect } from "vitest";
import type { Movimentacao } from "@/lib/queries";
import { buildDailyBalance, buildConsolidatedBalance, saldoFromContas } from "@/lib/saldo";

// Fábrica de movimentação: só os campos que os cálculos de saldo leem importam
// (dataISO, tipo, valor, contaId); o resto é preenchido para satisfazer o tipo.
function mov(p: Partial<Movimentacao> & Pick<Movimentacao, "dataISO" | "tipo" | "valor">): Movimentacao {
  return {
    id: p.id ?? `${p.dataISO}-${p.valor}-${p.tipo}`,
    date: "",
    dataISO: p.dataISO,
    desc: p.desc ?? "",
    ia: "",
    cat: "",
    conf: 1,
    valor: p.valor,
    tipo: p.tipo,
    contaId: p.contaId ?? null,
    fitid: p.fitid ?? null,
  };
}

describe("buildDailyBalance", () => {
  it("parte do saldo inicial e acumula por dia", () => {
    const movs = [
      mov({ dataISO: "2026-07-02", tipo: "in", valor: 100 }),
      mov({ dataISO: "2026-07-03", tipo: "out", valor: 30 }),
    ];
    const { series, saldoAtual } = buildDailyBalance(movs, 50, "2026-07-01");

    expect(series[0]).toMatchObject({ date: "2026-07-01", saldo: 50 }); // ponto base
    expect(series[1]).toMatchObject({ date: "2026-07-02", saldo: 150 });
    expect(series[2]).toMatchObject({ date: "2026-07-03", saldo: 120 });
    expect(saldoAtual).toBe(120);
  });

  it("ignora movimentações anteriores à data inicial (já embutidas no saldo)", () => {
    const movs = [
      mov({ dataISO: "2026-06-30", tipo: "in", valor: 999 }), // antes do início → ignorada
      mov({ dataISO: "2026-07-01", tipo: "in", valor: 10 }),
    ];
    const { saldoAtual, series } = buildDailyBalance(movs, 100, "2026-07-01");
    expect(saldoAtual).toBe(110);
    // só o ponto base + o dia 01.
    expect(series).toHaveLength(2);
  });

  it("soma várias movimentações no mesmo dia", () => {
    const movs = [
      mov({ dataISO: "2026-07-01", tipo: "in", valor: 100 }),
      mov({ dataISO: "2026-07-01", tipo: "out", valor: 40 }),
      mov({ dataISO: "2026-07-01", tipo: "in", valor: 5 }),
    ];
    const { saldoAtual } = buildDailyBalance(movs, 0, "2026-07-01");
    expect(saldoAtual).toBe(65);
  });

  it("não acumula erro de ponto flutuante (arredonda a 2 casas)", () => {
    const movs = [
      mov({ dataISO: "2026-07-01", tipo: "in", valor: 0.1 }),
      mov({ dataISO: "2026-07-02", tipo: "in", valor: 0.2 }),
    ];
    const { saldoAtual } = buildDailyBalance(movs, 0, "2026-07-01");
    expect(saldoAtual).toBe(0.3);
  });
});

describe("buildConsolidatedBalance", () => {
  it("cada conta contribui 0 antes da sua data de abertura", () => {
    const a = { movs: [], saldoInicial: 100, dataInicial: "2026-07-01" };
    const b = { movs: [], saldoInicial: 500, dataInicial: "2026-07-10" };
    const { series, saldoAtual } = buildConsolidatedBalance([a, b]);

    // Antes de 10/07 só a conta A "existe".
    const p01 = series.find((p) => p.date === "2026-07-01");
    const p10 = series.find((p) => p.date === "2026-07-10");
    expect(p01?.saldo).toBe(100);
    expect(p10?.saldo).toBe(600);
    expect(saldoAtual).toBe(600);
  });

  it("saldo consolidado = soma dos saldos atuais das contas", () => {
    const a = {
      movs: [mov({ dataISO: "2026-07-05", tipo: "in", valor: 50 })],
      saldoInicial: 100,
      dataInicial: "2026-07-01",
    };
    const b = {
      movs: [mov({ dataISO: "2026-07-06", tipo: "out", valor: 20 })],
      saldoInicial: 200,
      dataInicial: "2026-07-01",
    };
    const { saldoAtual } = buildConsolidatedBalance([a, b]);
    expect(saldoAtual).toBe(330); // (100+50) + (200-20)
  });

  it("lista vazia → série vazia e saldo 0", () => {
    expect(buildConsolidatedBalance([])).toEqual({ series: [], saldoAtual: 0 });
  });
});

describe("saldoFromContas", () => {
  const contas = [
    { id: "c1", saldoInicial: 100, saldoInicialData: "2026-07-01" },
    { id: "c2", saldoInicial: 200, saldoInicialData: "2026-07-01" },
  ];

  it("conta específica usa o saldo inicial dela (movimentos já vêm filtrados)", () => {
    // Contrato: no modo conta-específica o chamador passa só as movs da conta.
    const movs = [mov({ dataISO: "2026-07-02", tipo: "in", valor: 10, contaId: "c1" })];
    const { saldoAtual } = saldoFromContas(contas, movs, "c1");
    expect(saldoAtual).toBe(110); // 100 (saldoInicial de c1) + 10
  });

  it("consolidado agrupa por conta_id e soma", () => {
    const movs = [
      mov({ dataISO: "2026-07-02", tipo: "in", valor: 10, contaId: "c1" }),
      mov({ dataISO: "2026-07-02", tipo: "out", valor: 50, contaId: "c2" }),
    ];
    const { saldoAtual } = saldoFromContas(contas, movs, null);
    expect(saldoAtual).toBe(260); // (100+10) + (200-50)
  });

  it("conta inexistente cai para saldo inicial 0", () => {
    const { saldoAtual } = saldoFromContas(contas, [], "nao-existe");
    expect(saldoAtual).toBe(0);
  });
});
