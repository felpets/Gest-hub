import { describe, it, expect } from "vitest";
import { caminhoConta, metaDoMes, realizadoDaCategoria, cruzarOrcamento } from "@/lib/orcamento";
import type { Conta, Movimentacao, Orcamento } from "@/lib/queries";

const conta = (p: Partial<Conta> & Pick<Conta, "id" | "nome" | "parentId">): Conta => ({
  tipo: "despesa", codigo: "", ocultoRelatorios: false, investimentoAnuncios: false, compensar: false,
  competenciaModo: "pagamento", competenciaDiaCorte: null, ...p,
});

// Plano: Marketing (pai) > Ads (filha); Aluguel (raiz, sem filhas).
const CONTAS: Conta[] = [
  conta({ id: "mkt", nome: "Marketing", parentId: null }),
  conta({ id: "ads", nome: "Ads", parentId: "mkt" }),
  conta({ id: "alu", nome: "Aluguel", parentId: null }),
];

const orc = (p: Partial<Orcamento> & Pick<Orcamento, "planoContaId" | "valorMeta">): Orcamento => ({
  id: `${p.planoContaId}-${p.competencia ?? "padrao"}`,
  competencia: null,
  ...p,
});

const mov = (cat: string, valor: number, dataISO = "2026-08-10", tipo: "in" | "out" = "out"): Movimentacao => ({
  id: `${cat}-${valor}`, date: "", dataISO, desc: "", ia: "", cat, conf: 1, valor, tipo, contaId: null, fitid: null,
});

describe("caminhoConta", () => {
  it("raiz = nome; filha = 'Pai / Filho'", () => {
    expect(caminhoConta(CONTAS[2], CONTAS)).toBe("Aluguel");
    expect(caminhoConta(CONTAS[1], CONTAS)).toBe("Marketing / Ads");
  });
});

describe("metaDoMes", () => {
  const orcs = [
    orc({ planoContaId: "alu", valorMeta: 1000 }), // padrão
    orc({ planoContaId: "alu", competencia: "2026-08-01", valorMeta: 1200 }), // override ago
  ];
  it("override do mês vence o padrão", () => {
    expect(metaDoMes(orcs, "alu", "2026-08")?.valor).toBe(1200);
    expect(metaDoMes(orcs, "alu", "2026-08")?.escopo).toBe("mes");
  });
  it("sem override cai no padrão", () => {
    expect(metaDoMes(orcs, "alu", "2026-09")?.valor).toBe(1000);
    expect(metaDoMes(orcs, "alu", "2026-09")?.escopo).toBe("padrao");
  });
  it("sem meta → null", () => {
    expect(metaDoMes(orcs, "mkt", "2026-08")).toBeNull();
  });
});

describe("realizadoDaCategoria", () => {
  const movs = [
    mov("Aluguel", 500),
    mov("Marketing / Ads", 300),
    mov("Marketing", 100), // lançado direto na pai
    mov("Aluguel", 999, "2026-07-10"), // outro mês
    mov("Aluguel", 50, "2026-08-10", "in"), // outro tipo
  ];
  it("folha: match exato", () => {
    expect(realizadoDaCategoria(movs, "Aluguel", false, "out", "2026-08")).toBe(500);
  });
  it("pai: soma filhas + lançado direto na pai", () => {
    expect(realizadoDaCategoria(movs, "Marketing", true, "out", "2026-08")).toBe(400);
  });
  it("respeita mês e tipo", () => {
    expect(realizadoDaCategoria(movs, "Aluguel", false, "out", "2026-07")).toBe(999);
    expect(realizadoDaCategoria(movs, "Aluguel", false, "in", "2026-08")).toBe(50);
  });
});

describe("cruzarOrcamento", () => {
  const orcs = [
    orc({ planoContaId: "alu", valorMeta: 1000 }),
    orc({ planoContaId: "mkt", valorMeta: 200 }),
  ];
  const movs = [mov("Aluguel", 1100), mov("Marketing / Ads", 50)];

  it("resolve pct/restante/estouro; categoria sem meta fica de fora", () => {
    const r = cruzarOrcamento(CONTAS, orcs, movs, "2026-08");
    const alu = r.find((x) => x.planoContaId === "alu")!;
    const mkt = r.find((x) => x.planoContaId === "mkt")!;
    expect(r).toHaveLength(2); // 'ads' não tem meta

    expect(alu.realizado).toBe(1100);
    expect(alu.pctConsumido).toBe(110);
    expect(alu.restante).toBe(-100);
    expect(alu.estourou).toBe(true);

    // pai Marketing soma a filha Ads (50), meta 200
    expect(mkt.realizado).toBe(50);
    expect(mkt.pctConsumido).toBe(25);
    expect(mkt.estourou).toBe(false);
  });

  it("meta 0 não divide por zero", () => {
    const r = cruzarOrcamento(CONTAS, [orc({ planoContaId: "alu", valorMeta: 0 })], [mov("Aluguel", 10)], "2026-08");
    expect(r[0].pctConsumido).toBe(0);
    expect(r[0].estourou).toBe(true);
  });

  it("categoria 'conta no mês anterior': pagamento de agosto entra em julho", () => {
    const contas = [conta({ id: "alu", nome: "Aluguel", parentId: null, competenciaModo: "anterior" })];
    const orcs = [orc({ planoContaId: "alu", valorMeta: 1000 })];
    const movs = [mov("Aluguel", 900, "2026-08-05")]; // pago em ago
    // No orçamento de JULHO, o pagamento de agosto aparece (competência julho).
    expect(cruzarOrcamento(contas, orcs, movs, "2026-07")[0].realizado).toBe(900);
    // No orçamento de AGOSTO, não aparece (competência é julho).
    expect(cruzarOrcamento(contas, orcs, movs, "2026-08")[0].realizado).toBe(0);
  });

  it("categoria oculta não entra no orçamento", () => {
    const contas = [conta({ id: "alu", nome: "Aluguel", parentId: null, ocultoRelatorios: true })];
    const orcs = [orc({ planoContaId: "alu", valorMeta: 1000 })];
    const r = cruzarOrcamento(contas, orcs, [mov("Aluguel", 500)], "2026-08");
    expect(r).toHaveLength(0);
  });
});
