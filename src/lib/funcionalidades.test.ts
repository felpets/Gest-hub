import { describe, it, expect } from "vitest";
import { FUNCIONALIDADES, ligada, lerMapa, nomeFuncionalidade } from "@/lib/funcionalidades";

describe("funcionalidades opcionais", () => {
  it("não tem chave repetida", () => {
    const chaves = FUNCIONALIDADES.map((f) => f.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("sem nada gravado, vale o padrão do catálogo", () => {
    // Dívidas e acordos nasce LIGADA: desligar é escolha de quem administra,
    // e ninguém perde de vista um acordo já cadastrado sem pedir.
    expect(ligada(null, "dividas_acordos")).toBe(true);
    expect(ligada({}, "dividas_acordos")).toBe(true);
    expect(ligada(undefined, "dividas_acordos")).toBe(true);
  });

  it("o valor gravado manda — inclusive quando é false", () => {
    expect(ligada({ dividas_acordos: false }, "dividas_acordos")).toBe(false);
    expect(ligada({ dividas_acordos: true }, "dividas_acordos")).toBe(true);
  });

  it("lerMapa ignora o que não é do catálogo e o que não é booleano", () => {
    expect(lerMapa({ dividas_acordos: false, inventado: true })).toEqual({ dividas_acordos: false });
    expect(lerMapa({ dividas_acordos: "sim" })).toEqual({});
    expect(lerMapa(null)).toEqual({});
    expect(lerMapa("texto")).toEqual({});
    expect(lerMapa([1, 2])).toEqual({});
  });

  it("nomeFuncionalidade cai na própria chave quando não conhece", () => {
    expect(nomeFuncionalidade("dividas_acordos")).toBe("Dívidas e acordos");
    expect(nomeFuncionalidade("outra")).toBe("outra");
  });
});
