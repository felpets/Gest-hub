import { describe, it, expect } from "vitest";
import {
  agruparPor, alcancaHoje, contemHoje, dentro, diasNoPeriodo, mesAnterior, mesSeguinte,
  mesesEntreISO, nomeMes, nomeMesCurto, periodoDoMes, periodoFechado, periodoPadrao,
  periodoPersonalizado, rotuloPeriodo, ultimoDiaDoMes,
} from "@/lib/periodo";

describe("período do dashboard", () => {
  it("o mês vira um intervalo fechado, com fevereiro certo", () => {
    expect(periodoDoMes("2026-09")).toEqual({ modo: "mes", de: "2026-09-01", ate: "2026-09-30", mes: "2026-09" });
    expect(ultimoDiaDoMes("2026-02")).toBe("2026-02-28");
    expect(ultimoDiaDoMes("2028-02")).toBe("2028-02-29"); // bissexto
  });

  it("anda de mês virando o ano nos dois sentidos", () => {
    expect(mesAnterior("2026-01")).toBe("2025-12");
    expect(mesSeguinte("2026-12")).toBe("2027-01");
    expect(mesesEntreISO("2026-11-15", "2027-02-03")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("o padrão é o mês de hoje", () => {
    expect(periodoPadrao("2026-09-17")).toEqual({ modo: "mes_atual", de: "2026-09-01", ate: "2026-09-30", mes: "2026-09" });
  });

  it("o personalizado aceita as pontas trocadas", () => {
    expect(periodoPersonalizado("2026-09-30", "2026-09-01")).toEqual({
      modo: "personalizado", de: "2026-09-01", ate: "2026-09-30", mes: "2026-09",
    });
    expect(periodoPersonalizado("2026-08-20", "2026-09-10").mes).toBe("");
  });

  it("mês fechado é o que já passou — mês corrente e futuro seguem projetando", () => {
    const hoje = "2026-09-17";
    expect(periodoFechado(periodoDoMes("2026-08"), hoje)).toBe(true);
    expect(periodoFechado(periodoDoMes("2026-09"), hoje)).toBe(false);
    expect(periodoFechado(periodoDoMes("2026-10"), hoje)).toBe(false);
    // O último dia do mês anterior ainda é passado; o primeiro do mês atual não.
    expect(periodoFechado(periodoPersonalizado("2026-08-01", "2026-08-31"), hoje)).toBe(true);
    expect(periodoFechado(periodoPersonalizado("2026-08-01", "2026-09-01"), hoje)).toBe(false);
  });

  it("sabe se o período alcança ou contém hoje", () => {
    const hoje = "2026-09-17";
    expect(alcancaHoje(periodoDoMes("2026-09"), hoje)).toBe(true);
    expect(alcancaHoje(periodoDoMes("2026-07"), hoje)).toBe(false);
    expect(contemHoje(periodoDoMes("2026-09"), hoje)).toBe(true);
    expect(contemHoje(periodoDoMes("2026-10"), hoje)).toBe(false);
  });

  it("agrupa por dia em períodos curtos e por mês nos longos", () => {
    expect(diasNoPeriodo(periodoDoMes("2026-09"))).toBe(30);
    expect(agruparPor(periodoDoMes("2026-09"))).toBe("dia");
    expect(agruparPor(periodoPersonalizado("2026-01-01", "2026-12-31"))).toBe("mes");
  });

  it("os rótulos saem em português", () => {
    expect(nomeMes("2026-09")).toBe("Setembro 2026");
    expect(nomeMesCurto("2026-03")).toBe("mar");
    expect(rotuloPeriodo(periodoDoMes("2026-09"))).toBe("Setembro 2026");
    expect(rotuloPeriodo(periodoPersonalizado("2026-09-05", "2026-10-02"))).toBe("05/09/2026 a 02/10/2026");
  });

  it("dentro respeita as duas pontas e ignora data vazia", () => {
    const p = periodoDoMes("2026-09");
    expect(dentro(p, "2026-09-01")).toBe(true);
    expect(dentro(p, "2026-09-30")).toBe(true);
    expect(dentro(p, "2026-08-31")).toBe(false);
    expect(dentro(p, "")).toBe(false);
  });
});
