import { describe, it, expect, afterEach, vi } from "vitest";
import { diaUtilAnterior, isoDiaDoMes, nthDiaUtil, ehFimDeSemana, ddMM, fmtBR, pad, hojeISO, todayISO, mesAnterior, mesSeguinte, mesCompetencia, dataCompetencia } from "@/lib/datas";

const SEM_FERIADOS = new Set<string>();

describe("ehFimDeSemana", () => {
  it("detecta sábado e domingo (fuso local, sem parsing UTC)", () => {
    expect(ehFimDeSemana("2026-08-01")).toBe(true); // sábado
    expect(ehFimDeSemana("2026-08-02")).toBe(true); // domingo
    expect(ehFimDeSemana("2026-07-31")).toBe(false); // sexta
    expect(ehFimDeSemana("2026-07-01")).toBe(false); // quarta
  });
});

describe("diaUtilAnterior (convenção Preceding)", () => {
  it("dia útil não é alterado", () => {
    expect(diaUtilAnterior("2026-07-01", SEM_FERIADOS)).toBe("2026-07-01");
  });

  it("sábado antecipa para a sexta do mesmo mês", () => {
    expect(diaUtilAnterior("2026-02-21", SEM_FERIADOS)).toBe("2026-02-20");
  });

  it("CRUZA O MÊS: 01/08 sáb → 31/07 sex (nunca paga depois do vencimento)", () => {
    expect(diaUtilAnterior("2026-08-01", SEM_FERIADOS)).toBe("2026-07-31");
  });

  it("domingo também recua até a sexta", () => {
    expect(diaUtilAnterior("2026-08-02", SEM_FERIADOS)).toBe("2026-07-31");
  });

  it("pula feriado que cai em dia de semana", () => {
    // 07/09/2026 (Independência) é segunda; recua até a sexta anterior.
    const feriados = new Set(["2026-09-07"]);
    expect(diaUtilAnterior("2026-09-07", feriados)).toBe("2026-09-04");
  });

  it("feriado numa quarta recua um dia útil", () => {
    // 01/07 é quarta; marcado como feriado → dia útil anterior é 30/06 (terça).
    const feriados = new Set(["2026-07-01"]);
    expect(diaUtilAnterior("2026-07-01", feriados)).toBe("2026-06-30");
  });
});

describe("nthDiaUtil (contagem trabalhista: sábado conta, pouso antecipa)", () => {
  // Julho/2026 começa numa quarta: 01 qua, 02 qui, 03 sex, 04 sáb, 05 dom, 06 seg…
  it("5º dia útil de julho/2026 = 06/07 seg (o sábado 04 entra na contagem)", () => {
    expect(nthDiaUtil(2026, 7, 5, SEM_FERIADOS)).toBe("2026-07-06");
  });

  it("1º dia útil de julho/2026 = 01/07", () => {
    expect(nthDiaUtil(2026, 7, 1, SEM_FERIADOS)).toBe("2026-07-01");
  });

  it("n <= 0 é tratado como 1 (primeiro dia útil)", () => {
    expect(nthDiaUtil(2026, 7, 0, SEM_FERIADOS)).toBe("2026-07-01");
    expect(nthDiaUtil(2026, 7, -3, SEM_FERIADOS)).toBe("2026-07-01");
  });

  it("n grande demais faz clamp no último dia do mês (31/07 sex)", () => {
    expect(nthDiaUtil(2026, 7, 100, SEM_FERIADOS)).toBe("2026-07-31");
  });

  it("domingo nunca conta (04/07 sáb é o 4º; 05/07 dom é pulado)", () => {
    expect(nthDiaUtil(2026, 7, 4, SEM_FERIADOS)).toBe("2026-07-03"); // sáb 04 → antecipa p/ sex 03
    expect(nthDiaUtil(2026, 7, 5, SEM_FERIADOS)).toBe("2026-07-06"); // seg 06, não dom 05
  });

  it("feriado não conta (03/07 feriado empurra o 4º de 04/07 para 06/07 seg)", () => {
    const feriados = new Set(["2026-07-03"]);
    expect(nthDiaUtil(2026, 7, 4, SEM_FERIADOS)).toBe("2026-07-03"); // sem feriado
    expect(nthDiaUtil(2026, 7, 4, feriados)).toBe("2026-07-06");     // com feriado
  });

  // ── Pouso: o N-ésimo caiu em sábado, antecipa para a sexta ──
  it("quando o N-ésimo cai em sábado, antecipa para a sexta", () => {
    expect(nthDiaUtil(2026, 12, 5, SEM_FERIADOS)).toBe("2026-12-04"); // 05/12 sáb → 04/12 sex
    expect(nthDiaUtil(2026, 6, 5, SEM_FERIADOS)).toBe("2026-06-05");  // 06/06 sáb → 05/06 sex
    expect(nthDiaUtil(2026, 9, 5, SEM_FERIADOS)).toBe("2026-09-04");  // 05/09 sáb → 04/09 sex
  });

  it("1º dia útil em sábado dia 1 antecipa para o mês anterior", () => {
    // 01/08/2026 é sábado: conta como 1º dia útil, mas paga-se na sexta 31/07.
    expect(nthDiaUtil(2026, 8, 1, SEM_FERIADOS)).toBe("2026-07-31");
  });

  it("dois N podem colapsar na mesma data quando o maior cai em sábado", () => {
    // Com 03/07 feriado: 3º = 04/07 sáb → antecipa; 03/07 é feriado → 02/07.
    const feriados = new Set(["2026-07-03"]);
    expect(nthDiaUtil(2026, 7, 2, feriados)).toBe("2026-07-02");
    expect(nthDiaUtil(2026, 7, 3, feriados)).toBe("2026-07-02");
  });
});

describe("hojeISO vs todayISO (fuso)", () => {
  afterEach(() => vi.useRealTimers());

  it("todayISO usa UTC; hojeISO usa o fuso LOCAL", () => {
    // Instante em que UTC e o Brasil (UTC-3) caem em dias diferentes:
    // 2026-08-10 23:30 em São Paulo = 2026-08-11 02:30 em UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T02:30:00Z"));

    // todayISO (baseado em toISOString) é sempre a data UTC — determinístico.
    expect(todayISO()).toBe("2026-08-11");
    // hojeISO usa getFullYear/Month/Date (locais): num runner UTC-3 seria
    // "2026-08-10". Comparamos com a derivação local para valer em qualquer fuso.
    const d = new Date();
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(hojeISO()).toBe(local);
  });
});

describe("mesAnterior / mesSeguinte", () => {
  it("recuam/avançam um mês, tratando virada de ano", () => {
    expect(mesAnterior("2026-08")).toBe("2026-07");
    expect(mesAnterior("2026-01")).toBe("2025-12");
    expect(mesSeguinte("2026-08")).toBe("2026-09");
    expect(mesSeguinte("2026-12")).toBe("2027-01");
  });
});

describe("mesCompetencia (por modo)", () => {
  it("pagamento = mês da data; anterior/seguinte deslocam sempre", () => {
    expect(mesCompetencia("2026-08-05", "pagamento")).toBe("2026-08");
    expect(mesCompetencia("2026-08-05", "anterior")).toBe("2026-07");
    expect(mesCompetencia("2026-08-05", "seguinte")).toBe("2026-09");
    expect(mesCompetencia("2026-01-15", "anterior")).toBe("2025-12");
    expect(mesCompetencia("2026-12-15", "seguinte")).toBe("2027-01");
  });

  it("corte_seguinte: a partir do dia de corte vai pro mês seguinte", () => {
    expect(mesCompetencia("2026-08-20", "corte_seguinte", 25)).toBe("2026-08"); // antes do corte
    expect(mesCompetencia("2026-08-25", "corte_seguinte", 25)).toBe("2026-09"); // no corte
    expect(mesCompetencia("2026-08-27", "corte_seguinte", 25)).toBe("2026-09"); // depois
  });

  it("corte_anterior: até o dia de corte vai pro mês anterior", () => {
    expect(mesCompetencia("2026-08-05", "corte_anterior", 5)).toBe("2026-07"); // no corte
    expect(mesCompetencia("2026-08-03", "corte_anterior", 5)).toBe("2026-07"); // antes
    expect(mesCompetencia("2026-08-10", "corte_anterior", 5)).toBe("2026-08"); // depois → fica
  });

  it("modo de corte sem dia definido não desloca", () => {
    expect(mesCompetencia("2026-08-27", "corte_seguinte", null)).toBe("2026-08");
  });
});

describe("dataCompetencia", () => {
  it("sem deslocamento devolve a data real", () => {
    expect(dataCompetencia("2026-08-05", "pagamento")).toBe("2026-08-05");
  });
  it("mantém o dia, muda o mês (anterior/seguinte)", () => {
    expect(dataCompetencia("2026-08-05", "anterior")).toBe("2026-07-05");
    expect(dataCompetencia("2026-08-05", "seguinte")).toBe("2026-09-05");
  });
  it("clampa o dia ao tamanho do mês de competência", () => {
    // 31/03 → fevereiro (2026 não bissexto, 28 dias)
    expect(dataCompetencia("2026-03-31", "anterior")).toBe("2026-02-28");
  });
  it("respeita o dia de corte", () => {
    expect(dataCompetencia("2026-08-27", "corte_seguinte", 25)).toBe("2026-09-27");
    expect(dataCompetencia("2026-08-20", "corte_seguinte", 25)).toBe("2026-08-20");
  });
});

describe("formatadores", () => {
  it("pad completa com zero à esquerda", () => {
    expect(pad(7)).toBe("07");
    expect(pad(12)).toBe("12");
  });
  it("ddMM: YYYY-MM-DD → DD/MM", () => {
    expect(ddMM("2026-07-06")).toBe("06/07");
  });
  it("fmtBR: YYYY-MM-DD → DD/MM/AAAA", () => {
    expect(fmtBR("2026-07-06")).toBe("06/07/2026");
  });
});

describe("isoDiaDoMes", () => {
  it("devolve o dia pedido quando o mês tem esse dia", () => {
    expect(isoDiaDoMes(2026, 1, 5)).toBe("2026-01-05");
    expect(isoDiaDoMes(2026, 1, 31)).toBe("2026-01-31");
    expect(isoDiaDoMes(2026, 10, 30)).toBe("2026-10-30");
  });

  it("dia que não existe no mês cai no último dia dele (nunca vira o mês seguinte)", () => {
    expect(isoDiaDoMes(2026, 2, 31)).toBe("2026-02-28");
    expect(isoDiaDoMes(2026, 2, 30)).toBe("2026-02-28");
    expect(isoDiaDoMes(2026, 4, 31)).toBe("2026-04-30");
    expect(isoDiaDoMes(2026, 9, 31)).toBe("2026-09-30");
  });

  it("fevereiro de ano bissexto tem 29", () => {
    expect(isoDiaDoMes(2028, 2, 31)).toBe("2028-02-29");
  });

  it("piso 1 e arredondamento", () => {
    expect(isoDiaDoMes(2026, 3, 0)).toBe("2026-03-01");
    expect(isoDiaDoMes(2026, 3, -4)).toBe("2026-03-01");
    expect(isoDiaDoMes(2026, 3, 5.6)).toBe("2026-03-06");
  });
});
