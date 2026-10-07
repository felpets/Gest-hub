import { describe, it, expect } from "vitest";
import { numFromInput, clampDia, brl, fmtK } from "@/lib/format";

describe("numFromInput", () => {
  it("NaN (campo vazio) vira 0", () => {
    expect(numFromInput(NaN)).toBe(0);
  });
  it("preserva números válidos, inclusive 0 e negativos", () => {
    expect(numFromInput(12.5)).toBe(12.5);
    expect(numFromInput(0)).toBe(0);
    expect(numFromInput(-80)).toBe(-80);
  });
});

describe("clampDia", () => {
  it("limita ao teto (padrão 31 — qualquer dia do mês)", () => {
    expect(clampDia(31)).toBe(31);
    expect(clampDia(29)).toBe(29);
    expect(clampDia(40)).toBe(31);
  });
  it("piso 1", () => {
    expect(clampDia(0)).toBe(1);
    expect(clampDia(-5)).toBe(1);
  });
  it("arredonda e respeita teto customizado", () => {
    expect(clampDia(5.6)).toBe(6);
    expect(clampDia(30, 23)).toBe(23);
  });
  it("NaN vira 1", () => {
    expect(clampDia(NaN)).toBe(1);
  });
});

describe("brl / fmtK", () => {
  it("brl formata em Real (espaço normalizado p/ não depender do ICU)", () => {
    expect(brl(1234.5).replace(/\s/g, " ")).toBe("R$ 1.234,50");
  });
  it("fmtK compacta acima de mil", () => {
    expect(fmtK(10324.97)).toBe("10,3K");
    expect(fmtK(500)).toBe("500");
  });
});
