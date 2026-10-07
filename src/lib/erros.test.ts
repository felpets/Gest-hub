import { describe, it, expect } from "vitest";
import { msgErro } from "@/lib/erros";

const GENERICO = "Algo deu errado. Tente de novo.";

describe("msgErro", () => {
  it("Error → sua message", () => {
    expect(msgErro(new Error("Falhou ao salvar"))).toBe("Falhou ao salvar");
  });

  it("objeto do Supabase { message } → message", () => {
    expect(msgErro({ message: "duplicate key value", code: "23505" })).toBe("duplicate key value");
  });

  it("string não vazia → ela mesma", () => {
    expect(msgErro("erro cru")).toBe("erro cru");
  });

  it("null / undefined / vazio / sem message → fallback genérico", () => {
    expect(msgErro(null)).toBe(GENERICO);
    expect(msgErro(undefined)).toBe(GENERICO);
    expect(msgErro("")).toBe(GENERICO);
    expect(msgErro("   ")).toBe(GENERICO);
    expect(msgErro({ code: 500 })).toBe(GENERICO);
    expect(msgErro(new Error(""))).toBe(GENERICO);
  });
});
