import { describe, it, expect } from "vitest";
import { caminhoConta, resolverFlags, paresRenomeacao } from "@/lib/categorias";
import type { Conta } from "@/lib/queries";

const conta = (p: Partial<Conta> & Pick<Conta, "id" | "nome" | "parentId">): Conta => ({
  tipo: "despesa", codigo: "", ocultoRelatorios: false, investimentoAnuncios: false, compensar: false,
  competenciaModo: "pagamento", competenciaDiaCorte: null, ...p,
});

describe("caminhoConta", () => {
  const contas = [
    conta({ id: "t", nome: "Transferências", parentId: null }),
    conta({ id: "ti", nome: "Interna", parentId: "t" }),
  ];
  it("raiz = nome; filha = 'Pai / Filho'", () => {
    expect(caminhoConta(contas[0], contas)).toBe("Transferências");
    expect(caminhoConta(contas[1], contas)).toBe("Transferências / Interna");
  });
});

describe("resolverFlags", () => {
  it("marca a categoria com a flag (por caminho)", () => {
    const contas = [conta({ id: "t", nome: "Transferências", parentId: null, ocultoRelatorios: true })];
    const f = resolverFlags(contas);
    expect(f.ocultoDe("Transferências")).toBe(true);
    expect(f.competenciaDe("Transferências").modo).toBe("pagamento");
  });

  it("HERANÇA: pai oculto → filha também oculta", () => {
    const contas = [
      conta({ id: "t", nome: "Transferências", parentId: null, ocultoRelatorios: true }),
      conta({ id: "ti", nome: "Interna", parentId: "t" }), // sem flag própria
    ];
    const f = resolverFlags(contas);
    expect(f.ocultoDe("Transferências / Interna")).toBe(true);
  });

  it("competência: modo independente do ocultar", () => {
    const contas = [conta({ id: "s", nome: "Salários", parentId: null, competenciaModo: "anterior" })];
    const f = resolverFlags(contas);
    expect(f.competenciaDe("Salários")).toEqual({ modo: "anterior", diaCorte: null });
    expect(f.ocultoDe("Salários")).toBe(false);
  });

  it("herança de competência: filha herda o modo do pai", () => {
    const contas = [
      conta({ id: "c", nome: "Cartão", parentId: null, competenciaModo: "corte_seguinte", competenciaDiaCorte: 25 }),
      conta({ id: "cf", nome: "Anuidade", parentId: "c" }),
    ];
    const f = resolverFlags(contas);
    expect(f.competenciaDe("Cartão / Anuidade")).toEqual({ modo: "corte_seguinte", diaCorte: 25 });
  });

  it("categoria sem regra → mês do pagamento", () => {
    const contas = [conta({ id: "a", nome: "Aluguel", parentId: null })];
    expect(resolverFlags(contas).competenciaDe("Aluguel")).toEqual({ modo: "pagamento", diaCorte: null });
    expect(resolverFlags(contas).competenciaDe("Inexistente")).toEqual({ modo: "pagamento", diaCorte: null });
  });

  it("categoria não marcada / texto livre / renomeada → sem flag", () => {
    const contas = [conta({ id: "a", nome: "Aluguel", parentId: null })];
    const f = resolverFlags(contas);
    expect(f.ocultoDe("Aluguel")).toBe(false);
    expect(f.ocultoDe("Categoria Antiga")).toBe(false);
    expect(f.competenciaDe("").modo).toBe("pagamento");
  });

  it("ignora espaços ao redor do caminho gravado", () => {
    const contas = [conta({ id: "t", nome: "Transferências", parentId: null, ocultoRelatorios: true })];
    const f = resolverFlags(contas);
    expect(f.ocultoDe("  Transferências  ")).toBe(true);
  });
});

describe("paresRenomeacao", () => {
  const contas = [
    conta({ id: "mk", nome: "Marketing", parentId: null }),
    conta({ id: "ads", nome: "Ads", parentId: "mk" }),
    conta({ id: "dsg", nome: "Design", parentId: "mk" }),
    conta({ id: "ocu", nome: "Ocupação", parentId: null }),
  ];

  it("renomear folha: só o caminho dela", () => {
    expect(paresRenomeacao(contas, "ads", "Anúncios", "mk")).toEqual([
      ["Marketing / Ads", "Marketing / Anúncios"],
    ]);
  });

  it("renomear pai: o dele e o de cada filha", () => {
    expect(paresRenomeacao(contas, "mk", "Comercial", null)).toEqual([
      ["Marketing", "Comercial"],
      ["Marketing / Ads", "Comercial / Ads"],
      ["Marketing / Design", "Comercial / Design"],
    ]);
  });

  it("mover filha para outro pai", () => {
    expect(paresRenomeacao(contas, "ads", "Ads", "ocu")).toEqual([
      ["Marketing / Ads", "Ocupação / Ads"],
    ]);
  });

  it("salvar sem mudar nome/pai: nada a propagar", () => {
    expect(paresRenomeacao(contas, "ads", "Ads", "mk")).toEqual([]);
    expect(paresRenomeacao(contas, "mk", "Marketing", null)).toEqual([]);
  });

  it("id inexistente: nada a propagar", () => {
    expect(paresRenomeacao(contas, "nope", "X", null)).toEqual([]);
  });
});

// Categoria apagada do plano: o lançamento antigo guarda o texto "Pai / Filho".
// A marca do pai continua valendo — senão a linha escapa da regra (foi o caso
// de "Investimento em Meta Ads / Aportes", apagada com o pai marcado).
describe("categoria que não existe mais no plano", () => {
  const plano = [
    conta({ id: "ads", nome: "Investimento em Meta Ads", parentId: null, compensar: true, investimentoAnuncios: true }),
    conta({ id: "rev", nome: "Revisional", parentId: "ads" }),
    conta({ id: "prov", nome: "Provisões", parentId: null, ocultoRelatorios: true }),
  ];

  it("filha apagada herda compensação, anúncios e 'fora dos relatórios' do pai", () => {
    const f = resolverFlags(plano);
    expect(f.compensaDe("Investimento em Meta Ads / Aportes")).toBe(true);
    expect(f.anunciosDe("Investimento em Meta Ads / Aportes")).toBe(true);
    expect(f.ocultoDe("Provisões / Investimentos")).toBe(true);
  });

  it("a filha que existe continua valendo, e categoria de outro pai não é afetada", () => {
    const f = resolverFlags(plano);
    expect(f.compensaDe("Investimento em Meta Ads / Revisional")).toBe(true);
    expect(f.compensaDe("Receitas / Mensalidades")).toBe(false);
    expect(f.ocultoDe("Outros / Alimentação")).toBe(false);
  });
});
