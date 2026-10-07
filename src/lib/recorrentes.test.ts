import { describe, it, expect } from "vitest";
import { regraDatasMudou, type RegraDatas } from "@/lib/recorrentes";

const base: RegraDatas = { dia: 5, modoDia: "fixo", diaUtilN: null, dia2: null, inicio: "2026-01-01", fim: "2026-12-01" };

describe("regraDatasMudou", () => {
  it("mesma regra → não mudou (mesmo com dia fora de 1..31 normalizado igual)", () => {
    expect(regraDatasMudou(base, { ...base })).toBe(false);
    expect(regraDatasMudou({ ...base, dia: 40 }, { ...base, dia: 31 })).toBe(false);
  });

  it("dia diferente → mudou", () => {
    expect(regraDatasMudou(base, { ...base, dia: 10 })).toBe(true);
    // 28 e 31 já não são a mesma coisa: 31 é "último dia do mês".
    expect(regraDatasMudou({ ...base, dia: 28 }, { ...base, dia: 31 })).toBe(true);
  });

  it("período diferente (início ou fim, por ano/mês) → mudou", () => {
    expect(regraDatasMudou(base, { ...base, inicio: "2026-02-01" })).toBe(true);
    expect(regraDatasMudou(base, { ...base, fim: "2027-06-01" })).toBe(true);
    // dia da data de início não importa — só ano/mês
    expect(regraDatasMudou(base, { ...base, inicio: "2026-01-15" })).toBe(false);
  });

  it("tirar ou pôr prazo (fim ↔ null) → mudou", () => {
    expect(regraDatasMudou(base, { ...base, fim: null })).toBe(true);
    expect(regraDatasMudou({ ...base, fim: null }, base)).toBe(true);
    expect(regraDatasMudou({ ...base, fim: null }, { ...base, fim: null })).toBe(false);
  });

  it("modo/dia útil/quinzena diferentes → mudou", () => {
    expect(regraDatasMudou(base, { ...base, modoDia: "dia_util", diaUtilN: 5 })).toBe(true);
    const du: RegraDatas = { ...base, modoDia: "dia_util", diaUtilN: 5 };
    expect(regraDatasMudou(du, { ...du, diaUtilN: 3 })).toBe(true);
    const q: RegraDatas = { ...base, modoDia: "quinzenal", dia2: 20 };
    expect(regraDatasMudou(q, { ...q, dia2: 25 })).toBe(true);
    expect(regraDatasMudou(q, { ...q })).toBe(false);
  });
});
