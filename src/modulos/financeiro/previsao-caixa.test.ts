import { describe, it, expect } from "vitest";
import { HORIZONTES, HORIZONTE_PADRAO, fimHorizonte } from "@/modulos/financeiro/previsao-caixa";

describe("horizontes da previsão de caixa", () => {
  it("abre no mês corrente", () => {
    expect(HORIZONTE_PADRAO).toBe("mesAtual");
    expect(HORIZONTES[0].id).toBe("mesAtual");
  });

  it("'Este mês' vai até o último dia do mês, mesmo nos de 30, 31 e em fevereiro", () => {
    expect(fimHorizonte("2026-09-23", "mesAtual")).toBe("2026-09-30");
    expect(fimHorizonte("2026-08-01", "mesAtual")).toBe("2026-08-31");
    expect(fimHorizonte("2026-02-10", "mesAtual")).toBe("2026-02-28");
    expect(fimHorizonte("2028-02-10", "mesAtual")).toBe("2028-02-29"); // bissexto
    expect(fimHorizonte("2026-12-31", "mesAtual")).toBe("2026-12-31");
  });

  it("'até o fim do mês que vem' e os prazos em dias continuam como eram", () => {
    expect(fimHorizonte("2026-09-23", "mesSeg")).toBe("2026-10-31");
    expect(fimHorizonte("2026-12-15", "mesSeg")).toBe("2027-01-31"); // vira o ano
    expect(fimHorizonte("2026-09-23", "30d")).toBe("2026-10-23");
    expect(fimHorizonte("2026-09-23", "90d")).toBe("2026-12-22");
  });

  it("cada horizonte tem a frase do veredito", () => {
    for (const h of HORIZONTES) expect(h.frase.length).toBeGreaterThan(0);
  });
});
