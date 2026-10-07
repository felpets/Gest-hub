import { describe, it, expect } from "vitest";
import {
  FILTROS_PADRAO,
  contarPorSituacao,
  filtrarPagamentos,
  intervaloDe,
  listaVisivel,
  quantosFiltros,
  situacaoDe,
  type Filtros,
} from "@/lib/pix-filtros";
import type { PagamentoDiario } from "@/lib/queries";

const pag = (p: Partial<PagamentoDiario> & { id: string }): PagamentoDiario => ({
  data: "2026-09-28",
  titular: "João Pereira",
  chavePix: "joao@empresa.com",
  tipoChave: "email",
  valor: 100,
  descricao: "",
  pago: false,
  pagoEm: null,
  estornado: false,
  estornadoEm: null,
  estornoMotivo: "",
  criadoEm: "2026-09-28T08:00:00Z",
  ...p,
});

const f = (mudanca: Partial<Filtros> = {}): Filtros => ({ ...FILTROS_PADRAO, ...mudanca });

describe("situação derivada", () => {
  it("estornado vence pago: o dinheiro voltou", () => {
    expect(situacaoDe(pag({ id: "a", pago: true, estornado: true }))).toBe("estornado");
    expect(situacaoDe(pag({ id: "b", pago: true }))).toBe("pago");
    expect(situacaoDe(pag({ id: "c" }))).toBe("pendente");
  });
});

describe("intervalo do período", () => {
  const dia = "2026-09-28";

  it("o dia é só ele", () => {
    expect(intervaloDe(f(), dia)).toEqual({ de: dia, ate: dia });
  });

  it("7 dias olha para trás, e inclui o dia escolhido", () => {
    expect(intervaloDe(f({ periodo: "7dias" }), dia)).toEqual({
      de: "2026-09-22",
      ate: "2026-09-28",
    });
  });

  it("o mês vai do primeiro ao último dia — inclusive em fevereiro", () => {
    expect(intervaloDe(f({ periodo: "mes" }), dia)).toEqual({
      de: "2026-09-01",
      ate: "2026-09-30",
    });
    expect(intervaloDe(f({ periodo: "mes" }), "2024-02-10")).toEqual({
      de: "2024-02-01",
      ate: "2024-02-29",
    });
    expect(intervaloDe(f({ periodo: "mes" }), "2026-02-10")).toEqual({
      de: "2026-02-01",
      ate: "2026-02-28",
    });
  });

  it("personalizado sem uma das pontas não limita aquele lado", () => {
    const so = intervaloDe(f({ periodo: "personalizado", de: "2026-09-10" }), dia);
    expect(so.de).toBe("2026-09-10");
    expect(so.ate > "2030-01-01").toBe(true);
  });
});

describe("filtrar a lista", () => {
  const lista = [
    pag({ id: "1", data: "2026-09-28", titular: "João Pereira", valor: 250 }),
    pag({
      id: "2",
      data: "2026-09-28",
      titular: "Transportes Rápido",
      chavePix: "12345678000195",
      tipoChave: "cnpj",
      valor: 380,
      pago: true,
    }),
    pag({
      id: "3",
      data: "2026-09-21",
      titular: "Cloudhost Brasil",
      valor: 55.99,
      descricao: "Hospedagem",
    }),
    pag({ id: "4", data: "2026-09-28", titular: "Studio Aurora", valor: 1200, estornado: true }),
  ];
  const dia = "2026-09-28";

  it("o dia em foco corta o que é de outro dia", () => {
    expect(filtrarPagamentos(lista, f(), dia).map((p) => p.id)).toEqual(["1", "2", "4"]);
  });

  it("sete dias são sete, contados do dia escolhido para trás", () => {
    // 22 a 28. O lançamento do dia 21 fica de fora por um dia — e só aparece
    // quando o período vira o mês. É a diferença que o filtro tem de deixar clara.
    expect(filtrarPagamentos(lista, f({ periodo: "7dias" }), dia).map((p) => p.id)).toEqual([
      "1",
      "2",
      "4",
    ]);
    expect(filtrarPagamentos(lista, f({ periodo: "mes" }), dia).map((p) => p.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("a busca olha titular, chave e descrição", () => {
    expect(
      filtrarPagamentos(lista, f({ periodo: "mes", busca: "hospedagem" }), dia).map((p) => p.id),
    ).toEqual(["3"]);
    expect(
      filtrarPagamentos(lista, f({ periodo: "mes", busca: "RÁPIDO" }), dia).map((p) => p.id),
    ).toEqual(["2"]);
    // A chave formatada também conta: quem procura digita com pontuação.
    expect(
      filtrarPagamentos(lista, f({ periodo: "mes", busca: "12.345.678" }), dia).map((p) => p.id),
    ).toEqual(["2"]);
  });

  it("tipo de chave vazio é 'todos', e não 'nenhum'", () => {
    expect(filtrarPagamentos(lista, f({ periodo: "mes", tipos: [] }), dia)).toHaveLength(4);
    expect(
      filtrarPagamentos(lista, f({ periodo: "mes", tipos: ["cnpj"] }), dia).map((p) => p.id),
    ).toEqual(["2"]);
  });

  it("a faixa de valor inclui as pontas", () => {
    const r = filtrarPagamentos(lista, f({ periodo: "mes", valorMin: 55.99, valorMax: 380 }), dia);
    expect(r.map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("quem lançou vem de fora (o histórico), não do pagamento", () => {
    const autor = (id: string) => (id === "1" ? "ana@zaytan.com" : "bruno@zaytan.com");
    const r = filtrarPagamentos(lista, f({ periodo: "mes", autor: "ana@zaytan.com" }), dia, autor);
    expect(r.map((p) => p.id)).toEqual(["1"]);
  });
});

describe("situação escolhida e contagem", () => {
  const lista = [
    pag({ id: "1" }),
    pag({ id: "2", pago: true }),
    pag({ id: "3", estornado: true }),
    pag({ id: "4" }),
  ];
  const dia = "2026-09-28";

  it("conta cada situação depois dos outros filtros", () => {
    expect(contarPorSituacao(filtrarPagamentos(lista, f(), dia))).toEqual({
      pendente: 2,
      pago: 1,
      estornado: 1,
    });
  });

  it("a aba mostra só a situação escolhida", () => {
    expect(listaVisivel(lista, f({ status: ["pago"] }), dia).map((p) => p.id)).toEqual(["2"]);
    expect(listaVisivel(lista, f({ status: ["pendente", "pago"] }), dia).map((p) => p.id)).toEqual([
      "1",
      "2",
      "4",
    ]);
  });

  it("sem nenhuma situação marcada, mostra tudo em vez de esconder a lista", () => {
    expect(listaVisivel(lista, f({ status: [] }), dia)).toHaveLength(4);
  });
});

describe("contador do botão de filtro", () => {
  it("o padrão não conta nada", () => {
    expect(quantosFiltros(FILTROS_PADRAO)).toBe(0);
  });

  it("a situação não entra na conta: ela é a aba, e está sempre à vista", () => {
    expect(quantosFiltros(f({ status: ["pago", "estornado"] }))).toBe(0);
  });

  it("período, busca, tipo, autor e faixa contam um cada", () => {
    expect(quantosFiltros(f({ periodo: "mes" }))).toBe(1);
    expect(quantosFiltros(f({ periodo: "mes", busca: "cloud" }))).toBe(2);
    expect(quantosFiltros(f({ periodo: "mes", busca: "cloud", tipos: ["cpf"] }))).toBe(3);
    expect(
      quantosFiltros(f({ periodo: "mes", busca: "cloud", tipos: ["cpf"], autor: "ana@x.com" })),
    ).toBe(4);
    expect(
      quantosFiltros(
        f({ periodo: "mes", busca: "c", tipos: ["cpf"], autor: "a@x.com", valorMax: 500 }),
      ),
    ).toBe(5);
  });

  it("espaço em branco na busca não conta como filtro", () => {
    expect(quantosFiltros(f({ busca: "   " }))).toBe(0);
  });
});
