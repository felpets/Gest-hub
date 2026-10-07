import { describe, it, expect } from "vitest";
import {
  cronogramaParcelas,
  filtraProcessos,
  parcelasPagas,
  pctPago,
  proximoVencimento,
  resumoProcessos,
  saldoDevedor,
  totalDoAcordo,
} from "@/lib/processos";
import type { PagamentoProcesso } from "@/lib/queries";

const proc = (p: Partial<PagamentoProcesso> = {}): PagamentoProcesso => ({
  id: "p1",
  nome: "Banco Itaú",
  valor: 2940,
  diaPagamento: 5,
  parcelaAtual: 5,
  parcelasTotal: 18,
  chavePix: "12345678900",
  ativo: true,
  criadoEm: "2026-06-01",
  ...p,
});

describe("as contas de um acordo", () => {
  it("a parcela atual ainda não foi paga", () => {
    expect(parcelasPagas(proc({ parcelaAtual: 5 }))).toBe(4);
    expect(parcelasPagas(proc({ parcelaAtual: 1 }))).toBe(0);
  });

  it("acordo encerrado tem todas as parcelas pagas", () => {
    expect(parcelasPagas(proc({ ativo: false, parcelaAtual: 3 }))).toBe(18);
    expect(pctPago(proc({ ativo: false }))).toBe(100);
    expect(saldoDevedor(proc({ ativo: false }))).toBe(0);
  });

  it("o total é a parcela vezes o número de parcelas", () => {
    expect(totalDoAcordo(proc())).toBe(52920);
  });

  it("o saldo devedor inclui a parcela que está correndo", () => {
    // Faltam a 5ª até a 18ª = 14 parcelas.
    expect(saldoDevedor(proc({ parcelaAtual: 5 }))).toBe(2940 * 14);
    // Última parcela correndo: ainda se deve uma.
    expect(saldoDevedor(proc({ parcelaAtual: 18 }))).toBe(2940);
  });

  it("parcela além do total não vira saldo negativo", () => {
    expect(saldoDevedor(proc({ parcelaAtual: 20 }))).toBe(0);
    expect(pctPago(proc({ parcelaAtual: 30 }))).toBe(100);
  });

  it("não divide por zero quando o acordo não tem parcelas", () => {
    expect(pctPago(proc({ parcelasTotal: 0 }))).toBe(0);
  });
});

describe("o próximo vencimento", () => {
  it("é neste mês quando o dia ainda não passou", () => {
    expect(proximoVencimento(proc({ diaPagamento: 20 }), "2026-10-06")).toBe("2026-10-20");
  });

  it("é hoje quando hoje é o dia", () => {
    expect(proximoVencimento(proc({ diaPagamento: 6 }), "2026-10-06")).toBe("2026-10-06");
  });

  it("continua neste mês quando o dia passou e ninguém registrou o pagamento", () => {
    // É a parcela atrasada: empurrá-la para novembro esconderia o atraso.
    expect(proximoVencimento(proc({ diaPagamento: 5 }), "2026-10-06")).toBe("2026-10-05");
  });

  it("só vai para o mês seguinte depois do pagamento do mês", () => {
    const h = [{ pagoEm: "2026-10-05" }];
    expect(proximoVencimento(proc({ diaPagamento: 5 }), "2026-10-06", h)).toBe("2026-11-05");
  });

  it("pagamento de outro mês não adianta a parcela", () => {
    const h = [{ pagoEm: "2026-09-05" }];
    expect(proximoVencimento(proc({ diaPagamento: 5 }), "2026-10-06", h)).toBe("2026-10-05");
  });

  it("vira o ano em dezembro", () => {
    const h = [{ pagoEm: "2026-12-05" }];
    expect(proximoVencimento(proc({ diaPagamento: 5 }), "2026-12-06", h)).toBe("2027-01-05");
  });

  it("dia 31 em mês curto cai no último dia", () => {
    expect(proximoVencimento(proc({ diaPagamento: 31 }), "2027-02-01")).toBe("2027-02-28");
  });

  it("acordo encerrado não vence mais", () => {
    expect(proximoVencimento(proc({ ativo: false }), "2026-10-06")).toBeNull();
  });
});

describe("o resumo da carteira de acordos", () => {
  const lista = [
    proc({ id: "a", valor: 2940, parcelaAtual: 5, parcelasTotal: 18 }),
    proc({ id: "b", valor: 1080, parcelaAtual: 9, parcelasTotal: 24 }),
    proc({ id: "c", valor: 1310, ativo: false, parcelasTotal: 10 }),
  ];

  it("separa abertos de encerrados", () => {
    const r = resumoProcessos(lista);
    expect(r.abertos.map((p) => p.id)).toEqual(["a", "b"]);
    expect(r.encerrados.map((p) => p.id)).toEqual(["c"]);
  });

  it("o valor do mês soma só as parcelas em aberto", () => {
    expect(resumoProcessos(lista).valorMes).toBe(2940 + 1080);
  });

  it("o total restante soma o que falta de cada um, e o encerrado não entra", () => {
    expect(resumoProcessos(lista).totalRestante).toBe(2940 * 14 + 1080 * 16);
  });
});

describe("a busca por acordo", () => {
  const lista = [
    proc({ id: "a", nome: "Banco Itaú" }),
    proc({ id: "b", nome: "Receita Federal", chavePix: "99988877700" }),
  ];

  it("sem busca devolve tudo", () => {
    expect(filtraProcessos(lista, "   ")).toHaveLength(2);
  });

  it("acha pelo nome, sem ligar para maiúsculas", () => {
    expect(filtraProcessos(lista, "RECEITA").map((p) => p.id)).toEqual(["b"]);
  });

  it("acha pela chave Pix", () => {
    expect(filtraProcessos(lista, "999888").map((p) => p.id)).toEqual(["b"]);
  });
});

describe("o cronograma de parcelas", () => {
  const p = proc({ valor: 1000, parcelaAtual: 3, parcelasTotal: 5, diaPagamento: 10 });

  it("mostra a parcela paga com a data e o comprovante do histórico", () => {
    const c = cronogramaParcelas(
      p,
      [{ numero: 1, pagoEm: "2026-08-11", valor: 980, comprovantePath: "x.pdf" }],
      "2026-10-06",
    );
    expect(c[0]).toEqual({
      numero: 1,
      data: "2026-08-11",
      valor: 980,
      situacao: "paga",
      comprovante: true,
    });
  });

  it("parcela antes da atual sem registro conta como paga, só sem data", () => {
    const c = cronogramaParcelas(p, [], "2026-10-06");
    expect(c[1]).toEqual({
      numero: 2,
      data: null,
      valor: 1000,
      situacao: "paga",
      comprovante: false,
    });
  });

  it("projeta a atual no próximo vencimento e as seguintes mês a mês", () => {
    const c = cronogramaParcelas(p, [], "2026-10-06");
    expect(c[2]).toMatchObject({ numero: 3, data: "2026-10-10", situacao: "a_vencer" });
    expect(c[3]).toMatchObject({ numero: 4, data: "2026-11-10", situacao: "a_vencer" });
    expect(c[4]).toMatchObject({ numero: 5, data: "2026-12-10", situacao: "a_vencer" });
  });

  it("a parcela atual fica VENCIDA quando o dia do mês já passou", () => {
    const atrasado = proc({ valor: 500, parcelaAtual: 2, parcelasTotal: 3, diaPagamento: 5 });
    const c = cronogramaParcelas(atrasado, [], "2026-10-06");
    expect(c[1]).toMatchObject({ numero: 2, data: "2026-10-05", situacao: "vencida" });
    // E a seguinte continua no futuro.
    expect(c[2]).toMatchObject({ numero: 3, data: "2026-11-05", situacao: "a_vencer" });
  });

  it("registrado o pagamento do mês, a parcela seguinte volta a ser a_vencer", () => {
    const pago = proc({ valor: 500, parcelaAtual: 3, parcelasTotal: 3, diaPagamento: 5 });
    const c = cronogramaParcelas(
      pago,
      [{ numero: 2, pagoEm: "2026-10-05", valor: 500, comprovantePath: null }],
      "2026-10-06",
    );
    expect(c[1]).toMatchObject({ numero: 2, situacao: "paga", data: "2026-10-05" });
    expect(c[2]).toMatchObject({ numero: 3, data: "2026-11-05", situacao: "a_vencer" });
  });

  it("tem uma linha por parcela do acordo", () => {
    expect(cronogramaParcelas(p, [], "2026-10-06")).toHaveLength(5);
  });

  it("acordo encerrado: tudo pago, nada projetado", () => {
    const fim = proc({ ativo: false, parcelasTotal: 3, valor: 700 });
    const c = cronogramaParcelas(fim, [], "2026-10-06");
    expect(c.map((x) => x.situacao)).toEqual(["paga", "paga", "paga"]);
  });
});
