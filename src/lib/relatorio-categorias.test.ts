import { describe, it, expect } from "vitest";
import { categoriasOrdenadas, montarRelatorioCategorias } from "@/lib/relatorio-categorias";
import type { Conta, Movimentacao } from "@/lib/queries";

const conta = (o: Partial<Conta> & { id: string; nome: string }): Conta => ({
  tipo: "despesa", codigo: "", parentId: null, ocultoRelatorios: false, investimentoAnuncios: false, compensar: false,
  competenciaModo: "pagamento", competenciaDiaCorte: null, ...o,
});

const mov = (o: Partial<Movimentacao> & { cat: string; valor: number }): Movimentacao => ({
  id: Math.random().toString(36).slice(2), date: "05/08", dataISO: "2026-08-05",
  desc: "desc", ia: "", conf: 1, tipo: "out", contaId: null, fitid: null, ...o,
});

// Plano: 3.1 Marketing (3.1.1 Ads, 3.1.2 Design) · 3.2 Ocupação (3.2.1 Aluguel) ·
// 9.9 Transferências (oculta) · 1.1 Vendas (receita).
const CONTAS: Conta[] = [
  conta({ id: "mk", nome: "Marketing", codigo: "3.1" }),
  conta({ id: "ads", nome: "Ads", codigo: "3.1.1", parentId: "mk" }),
  conta({ id: "dsg", nome: "Design", codigo: "3.1.2", parentId: "mk" }),
  conta({ id: "ocu", nome: "Ocupação", codigo: "3.2" }),
  conta({ id: "alu", nome: "Aluguel", codigo: "3.2.1", parentId: "ocu" }),
  conta({ id: "trf", nome: "Transferências", codigo: "9.9", ocultoRelatorios: true }),
  conta({ id: "vnd", nome: "Vendas", codigo: "1.1", tipo: "receita" }),
];

const MOVS: Movimentacao[] = [
  mov({ cat: "Marketing / Ads", valor: 800, dataISO: "2026-08-04", date: "04/08", desc: "FACEBOOK" }),
  mov({ cat: "Marketing / Ads", valor: 200, dataISO: "2026-08-07", date: "07/08", desc: "GOOGLE" }),
  mov({ cat: "Marketing", valor: 50, desc: "direto no pai" }),   // lançado direto no pai
  mov({ cat: "Ocupação / Aluguel", valor: 1200, desc: "ALUGUEL" }),
  mov({ cat: "Categoria Antiga", valor: 33, desc: "renomeada" }), // não casa com o plano
  mov({ cat: "Vendas", valor: 5000, tipo: "in", desc: "PIX CLIENTE" }),
];

describe("categoriasOrdenadas", () => {
  it("pai seguido das filhas, na ordem do código, só do tipo pedido", () => {
    expect(categoriasOrdenadas(CONTAS, "despesa").map((c) => c.id)).toEqual([
      "mk", "ads", "dsg", "ocu", "alu", "trf",
    ]);
    expect(categoriasOrdenadas(CONTAS, "receita").map((c) => c.id)).toEqual(["vnd"]);
  });

  it("código numérico ordena como número (3.10 depois de 3.9)", () => {
    const cs = [conta({ id: "a", nome: "A", codigo: "3.10" }), conta({ id: "b", nome: "B", codigo: "3.9" })];
    expect(categoriasOrdenadas(cs, "despesa").map((c) => c.codigo)).toEqual(["3.9", "3.10"]);
  });
});

describe("montarRelatorioCategorias — sintético", () => {
  const r = montarRelatorioCategorias(CONTAS, MOVS, "despesa", "sintetico");

  it("pai soma as filhas + o lançado direto nele", () => {
    const mk = r.linhas.find((l) => l.texto === "3.1 Marketing")!;
    expect(mk.valor).toBe(1050); // 800 + 200 (Ads) + 50 (direto)
    expect(mk.nivel).toBe("pai");
  });

  it("zerada aparece com 0 (não some)", () => {
    const dsg = r.linhas.find((l) => l.texto === "3.1.2 Design")!;
    expect(dsg).toMatchObject({ nivel: "filha", valor: 0, pct: 0 });
  });

  it("oculta dos relatórios entra na listagem, marcada", () => {
    const trf = r.linhas.find((l) => l.texto === "9.9 Transferências")!;
    expect(trf.foraRelatorios).toBe(true);
  });

  it("o que não casa com o plano vira (sem categoria) e entra no total", () => {
    expect(r.linhas.find((l) => l.texto === "(sem categoria)")!.valor).toBe(33);
    expect(r.total).toBe(1050 + 1200 + 33);
    const tot = r.linhas[r.linhas.length - 1];
    expect(tot).toMatchObject({ nivel: "total", texto: "TOTAL DE SAÍDAS", valor: 2283, pct: 100 });
  });

  it("sintético não abre lançamentos", () => {
    expect(r.linhas.every((l) => l.nivel !== "lancamento")).toBe(true);
  });

  it("receitas: total de ENTRADAS, só categorias de receita", () => {
    const rec = montarRelatorioCategorias(CONTAS, MOVS, "receita", "sintetico");
    expect(rec.total).toBe(5000);
    expect(rec.linhas.map((l) => l.texto)).toEqual(["1.1 Vendas", "TOTAL DE ENTRADAS"]);
  });
});

describe("montarRelatorioCategorias — analítico", () => {
  const r = montarRelatorioCategorias(CONTAS, MOVS, "despesa", "analitico");

  it("lançamentos ficam sob a categoria, mais antigos primeiro", () => {
    const i = r.linhas.findIndex((l) => l.texto === "3.1.1 Ads");
    expect(r.linhas[i + 1]).toMatchObject({ nivel: "lancamento", texto: "FACEBOOK", data: "04/08", valor: 800 });
    expect(r.linhas[i + 2]).toMatchObject({ nivel: "lancamento", texto: "GOOGLE", data: "07/08", valor: 200 });
  });

  it("lançado direto no pai aparece sob o pai", () => {
    const i = r.linhas.findIndex((l) => l.texto === "3.1 Marketing");
    expect(r.linhas[i + 1]).toMatchObject({ nivel: "lancamento", texto: "direto no pai", valor: 50 });
  });

  it("folha zerada ganha 'sem lançamentos no período'", () => {
    const i = r.linhas.findIndex((l) => l.texto === "3.1.2 Design");
    expect(r.linhas[i + 1]).toMatchObject({ nivel: "vazio", valor: null });
  });

  it("pai com filhas não repete 'sem lançamentos' (as filhas já dizem)", () => {
    const i = r.linhas.findIndex((l) => l.texto === "3.2 Ocupação");
    expect(r.linhas[i + 1].nivel).not.toBe("vazio");
  });

  it("(sem categoria) também abre os lançamentos", () => {
    const i = r.linhas.findIndex((l) => l.texto === "(sem categoria)");
    expect(r.linhas[i + 1]).toMatchObject({ nivel: "lancamento", texto: "renomeada", valor: 33 });
  });

  it("mesmo total do sintético", () => {
    expect(r.total).toBe(montarRelatorioCategorias(CONTAS, MOVS, "despesa", "sintetico").total);
  });
});

describe("casos de borda", () => {
  it("sem movimentações: todas as linhas 0 e total 0", () => {
    const r = montarRelatorioCategorias(CONTAS, [], "despesa", "sintetico");
    expect(r.total).toBe(0);
    expect(r.linhas.filter((l) => l.nivel !== "total").every((l) => l.valor === 0)).toBe(true);
    expect(r.linhas[r.linhas.length - 1].pct).toBe(0); // sem divisão por zero
  });

  it("centavos: soma sem lixo de ponto flutuante", () => {
    const movs = [mov({ cat: "Marketing / Ads", valor: 0.1 }), mov({ cat: "Marketing / Ads", valor: 0.2 })];
    const r = montarRelatorioCategorias(CONTAS, movs, "despesa", "sintetico");
    expect(r.linhas.find((l) => l.texto === "3.1.1 Ads")!.valor).toBe(0.3);
  });
});
