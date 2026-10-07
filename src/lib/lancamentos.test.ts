import { describe, it, expect } from "vitest";
import {
  montarCompromissos, parcelasDoAcordo, resumoPeriodo, serieFluxo,
  type CompromissoRH, type Fontes, type MovLike,
} from "@/lib/lancamentos";

const SET = { de: "2026-09-01", ate: "2026-09-30" };

type PrevistoDoTeste = NonNullable<Fontes["previstos"]>[number];

const previsto = (p: Partial<PrevistoDoTeste> = {}): PrevistoDoTeste => ({
  id: "p1", data: "2026-09-10", descricao: "Aluguel", categoria: "Estrutura / Aluguel", valor: 1000,
  tipo: "out", recorrenteId: null, pago: false, pagoEm: null, pagoValor: null, ...p,
});

describe("compromissos: juntar as origens sem duplicar", () => {
  it("previsto em aberto entra pelo vencimento; pago entra pela data do pagamento", () => {
    const fontes: Fontes = {
      previstos: [
        previsto({ id: "aberto" }),
        previsto({ id: "pago-no-mes", pago: true, pagoEm: "2026-09-12", pagoValor: 990 }),
        previsto({ id: "vence-no-mes-pago-depois", data: "2026-09-28", pago: true, pagoEm: "2026-10-03" }),
      ],
    };
    const c = montarCompromissos(fontes, SET);
    expect(c.map((x) => x.refId)).toEqual(["aberto", "pago-no-mes"]);
    // O valor efetivamente pago manda sobre o previsto.
    expect(c.find((x) => x.refId === "pago-no-mes")?.valor).toBe(990);
  });

  it("recorrência e conta avulsa se distinguem, e só a avulsa em aberto é editável", () => {
    const c = montarCompromissos(
      { previstos: [previsto({ id: "a" }), previsto({ id: "b", recorrenteId: "r1" })] },
      SET,
    );
    expect(c.find((x) => x.refId === "a")).toMatchObject({ origem: "conta", editavel: true });
    expect(c.find((x) => x.refId === "b")).toMatchObject({ origem: "recorrencia", editavel: false });
  });

  it("cobrança cancelada não conta; a paga entra com o nome do cliente", () => {
    const fontes: Fontes = {
      cobrancas: [
        { id: "c1", clienteId: "cli1", competencia: "2026-09-01", vencimento: "2026-09-05", valor: 500, status: "aberto", pagoEm: null, pagoValor: null },
        { id: "c2", clienteId: "cli1", competencia: "2026-09-01", vencimento: "2026-09-05", valor: 500, status: "cancelado", pagoEm: null, pagoValor: null },
        { id: "c3", clienteId: "cli2", competencia: "2026-09-01", vencimento: "2026-09-08", valor: 700, status: "pago", pagoEm: "2026-09-09", pagoValor: 700 },
      ],
      nomeCliente: (id) => (id === "cli1" ? "Padaria do Zé" : "Mercado Sol"),
    };
    const c = montarCompromissos(fontes, SET);
    expect(c.map((x) => x.refId)).toEqual(["c1", "c3"]);
    expect(c[0].descricao).toBe("Mensalidade · Padaria do Zé");
    expect(c[0].tipo).toBe("in");
    expect(c[1].liquidado).toBe(true);
  });

  it("cliente com duas mensalidades: cada cobrança leva o nome da sua", () => {
    const c = montarCompromissos({
      cobrancas: [
        { id: "a", clienteId: "cli1", competencia: "2026-09-01", vencimento: "2026-09-05", valor: 500, status: "aberto", pagoEm: null, pagoValor: null, descricao: "Mensalidade", vendaId: null },
        { id: "b", clienteId: "cli1", competencia: "2026-09-01", vencimento: "2026-09-20", valor: 300, status: "aberto", pagoEm: null, pagoValor: null, descricao: "Suporte técnico", vendaId: null },
      ],
      nomeCliente: () => "Padaria do Zé",
    }, SET);
    expect(c.map((x) => x.descricao)).toEqual(["Mensalidade · Padaria do Zé", "Suporte técnico · Padaria do Zé"]);
  });

  it("Pix estornado sai da conta; quem lançou vem junto quando o banco registrou", () => {
    const fontes: Fontes = {
      pix: [
        { id: "x1", data: "2026-09-03", titular: "João", descricao: "diária", valor: 150, pago: false, pagoEm: null, estornado: false },
        { id: "x2", data: "2026-09-04", titular: "Maria", descricao: "", valor: 200, pago: true, pagoEm: "2026-09-04T12:00:00Z", estornado: false },
        { id: "x3", data: "2026-09-05", titular: "Erro", descricao: "", valor: 900, pago: true, pagoEm: "2026-09-05T12:00:00Z", estornado: true },
      ],
      autorPix: (id) => (id === "x1" ? "kimberly@laportec.com" : ""),
    };
    const c = montarCompromissos(fontes, SET);
    expect(c.map((x) => x.refId)).toEqual(["x1", "x2"]);
    expect(c[0].responsavel).toBe("kimberly@laportec.com");
    expect(c[1].liquidado).toBe(true);
  });

  it("acordo gera uma parcela por mês da janela, respeitando meses curtos", () => {
    const acordo = { id: "a1", nome: "Acordo Banco", valor: 800, diaPagamento: 31, parcelaAtual: 3, parcelasTotal: 12, ativo: true };
    expect(parcelasDoAcordo(acordo, { de: "2026-01-01", ate: "2026-03-31" })).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    // Fora da janela não entra: a de janeiro cai antes do dia 15.
    expect(parcelasDoAcordo({ ...acordo, diaPagamento: 5 }, { de: "2026-01-15", ate: "2026-02-28" })).toEqual(["2026-02-05"]);
    expect(montarCompromissos({ acordos: [{ ...acordo, ativo: false }] }, SET)).toEqual([]);
  });

  it("o RH entra como saída, marcando o que é projeção e o que já foi pago", () => {
    const rh: CompromissoRH[] = [
      { id: "r1", origem: "adiantamento", fonte: "rh_pagamentos", pessoa: "Ana", funcionarioId: "f1", competencia: "2026-09", data: "2026-09-18", valor: 1200, status: "projetado", descricao: "Adiantamento quinzenal (RH)", empresaRH: "Laportec" },
      { id: "r2", origem: "salario", fonte: "projecao", pessoa: "Bia", funcionarioId: "f2", competencia: "2026-09", data: "2026-09-30", valor: 1800, status: "projetado", descricao: "Salário — folha (projeção do RH)", empresaRH: "Laportec" },
      { id: "r3", origem: "diario", fonte: "rh_pagamentos_diarios", pessoa: "Caio", funcionarioId: null, competencia: "2026-09", data: "2026-09-02", valor: 90, status: "realizado", descricao: "Pagamento diário (RH)", empresaRH: "Laportec" },
    ];
    const c = montarCompromissos({ rh }, SET);
    expect(c.map((x) => x.origem)).toEqual(["rh_diario", "rh_adiantamento", "rh_salario"]);
    expect(c.every((x) => x.tipo === "out")).toBe(true);
    expect(c.find((x) => x.id === "rh-r2")?.projecao).toBe(true);
    expect(c.find((x) => x.id === "rh-r1")?.projecao).toBe(false);
    expect(c.find((x) => x.id === "rh-r3")?.liquidado).toBe(true);
  });

  it("recorrência ligada ao RH cobre a rubrica: a folha não aparece duas vezes", () => {
    const rh: CompromissoRH[] = [
      { id: "r1", origem: "adiantamento", fonte: "rh_pagamentos", pessoa: "Ana", funcionarioId: "f1", competencia: "2026-09", data: "2026-09-18", valor: 1200, status: "projetado", descricao: "Adiantamento (RH)", empresaRH: "Laportec" },
      { id: "r2", origem: "salario", fonte: "projecao", pessoa: "Bia", funcionarioId: "f2", competencia: "2026-09", data: "2026-09-30", valor: 1800, status: "projetado", descricao: "Salário (RH)", empresaRH: "Laportec" },
      { id: "r3", origem: "diario", fonte: "rh_pagamentos_diarios", pessoa: "Caio", funcionarioId: null, competencia: "2026-09", data: "2026-09-02", valor: 90, status: "projetado", descricao: "Diário (RH)", empresaRH: "Laportec" },
    ];
    // Com a recorrência de folha ligada, só o salário sai da lista por pessoa.
    const comFolha = montarCompromissos({ rh, origensRHCobertas: new Set(["rh_salario" as const]) }, SET);
    expect(comFolha.map((c) => c.origem).sort()).toEqual(["rh_adiantamento", "rh_diario"]);
    // Com as duas ligadas, sobra o pagamento diário (que não vem de recorrência).
    const comAmbas = montarCompromissos(
      { rh, origensRHCobertas: new Set(["rh_salario" as const, "rh_adiantamento" as const]) },
      SET,
    );
    expect(comAmbas.map((c) => c.origem)).toEqual(["rh_diario"]);
    // Sem nenhuma recorrência ligada, tudo aparece.
    expect(montarCompromissos({ rh }, SET)).toHaveLength(3);
  });

  it("sai ordenado por data", () => {
    const c = montarCompromissos(
      { previstos: [previsto({ id: "z", data: "2026-09-20" }), previsto({ id: "a", data: "2026-09-02" })] },
      SET,
    );
    expect(c.map((x) => x.data)).toEqual(["2026-09-02", "2026-09-20"]);
  });
});

describe("realizado × projetado", () => {
  const movs: MovLike[] = [
    { dataISO: "2026-09-03", tipo: "in", valor: 5000 },
    { dataISO: "2026-09-05", tipo: "out", valor: 1200 },
    { dataISO: "2026-08-31", tipo: "in", valor: 9999 }, // fora do período
  ];

  it("o realizado vem do extrato; só compromisso EM ABERTO vira projeção", () => {
    const comps = montarCompromissos(
      {
        previstos: [
          previsto({ id: "aberta", valor: 1000 }),
          // Já paga: o dinheiro saiu e aparece no extrato — não pode contar de novo.
          previsto({ id: "paga", valor: 700, pago: true, pagoEm: "2026-09-05", pagoValor: 700 }),
        ],
      },
      SET,
    );
    const r = resumoPeriodo(movs, comps, SET);
    expect(r.entradasRealizadas).toBe(5000);
    expect(r.saidasRealizadas).toBe(1200);
    expect(r.resultadoRealizado).toBe(3800);
    expect(r.saidasPrevistas).toBe(1000);      // só a conta em aberto
    expect(r.entradasPrevistas).toBe(0);
    expect(r.resultadoPrevisto).toBe(2800);    // 3800 − 1000
  });

  it("mês fechado não projeta mais nada", () => {
    const comps = montarCompromissos({ previstos: [previsto({ id: "aberta", valor: 1000 })] }, SET);
    const r = resumoPeriodo(movs, comps, SET, true);
    expect(r.saidasPrevistas).toBe(0);
    expect(r.resultadoPrevisto).toBe(r.resultadoRealizado);
  });

  it("a série do gráfico separa realizado de previsto, por dia ou por mês", () => {
    const comps = montarCompromissos({ previstos: [previsto({ id: "aberta", data: "2026-09-10", valor: 1000 })] }, SET);
    const dia = serieFluxo(movs, comps, SET, "dia");
    expect(dia.map((p) => p.chave)).toEqual(["2026-09-03", "2026-09-05", "2026-09-10"]);
    expect(dia[0]).toMatchObject({ rotulo: "03/09", entradas: 5000, saidas: 0 });
    expect(dia[2]).toMatchObject({ saidas: 0, saidasPrevistas: 1000 });

    const mes = serieFluxo(movs, comps, { de: "2026-08-01", ate: "2026-09-30" }, "mes");
    expect(mes.map((p) => p.chave)).toEqual(["2026-08", "2026-09"]);
    expect(mes[0]).toMatchObject({ rotulo: "ago/26", entradas: 9999 });
    expect(mes[1]).toMatchObject({ entradas: 5000, saidas: 1200, saidasPrevistas: 1000 });
  });

  it("no período fechado a série mostra só o realizado", () => {
    const comps = montarCompromissos({ previstos: [previsto({ id: "aberta", data: "2026-09-10" })] }, SET);
    const s = serieFluxo(movs, comps, SET, "dia", true);
    expect(s.some((p) => p.saidasPrevistas > 0)).toBe(false);
  });
});
