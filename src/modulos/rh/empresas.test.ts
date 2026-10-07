import { describe, expect, it } from "vitest";
import {
  empresaRHDoFinanceiro, empresasDoRH, escolherEmpresaRH, nomeModulos, TODAS_EMPRESAS_RH,
} from "@/modulos/rh/empresas";

const CADASTRO = ["Avora", "Laportec", "Zaytan", "Nova Filial"];

describe("empresas do RH", () => {
  it("sem acesso ao RH não há empresa", () => {
    expect(empresasDoRH({ liberado: false, empresas: null }, CADASTRO)).toEqual([]);
  });

  it("acesso a todas: as empresas com o módulo RH, sem repetir", () => {
    expect(empresasDoRH({ liberado: true, empresas: null }, [...CADASTRO, "laportec"])).toEqual(CADASTRO);
  });

  it("acesso a algumas empresas: só elas, com a grafia do cadastro", () => {
    expect(empresasDoRH({ liberado: true, empresas: ["laportec", "Zaytan"] }, CADASTRO)).toEqual(["Laportec", "Zaytan"]);
    expect(empresasDoRH({ liberado: true, empresas: ["Laportec"] }, CADASTRO)).toEqual(["Laportec"]);
  });

  it("casa a empresa do Financeiro com a do RH pelo nome", () => {
    const lista = ["Laportec", "Avora"];
    expect(empresaRHDoFinanceiro("Laportec", lista)).toBe("Laportec");
    expect(empresaRHDoFinanceiro("LAPORTEC Assessoria", lista)).toBe("Laportec");
    expect(empresaRHDoFinanceiro("Laportecx", lista)).toBeNull();
    expect(empresaRHDoFinanceiro(undefined, lista)).toBeNull();
  });

  it("ao entrar: a última escolha vale; senão a do Financeiro; senão a primeira", () => {
    const lista = ["Laportec", "Avora", "Zaytan"];
    expect(escolherEmpresaRH({ lista, podeTodas: true, salva: "Zaytan", nomeFinanceiro: "Avora" })).toBe("Zaytan");
    expect(escolherEmpresaRH({ lista, podeTodas: true, salva: null, nomeFinanceiro: "Avora" })).toBe("Avora");
    expect(escolherEmpresaRH({ lista, podeTodas: true, salva: "Sumiu", nomeFinanceiro: "Outra" })).toBe("Laportec");
  });

  it("'todas as empresas' só vale para quem tem o RH sem restrição", () => {
    expect(escolherEmpresaRH({ lista: ["Laportec", "Avora"], podeTodas: true, salva: TODAS_EMPRESAS_RH })).toBe(TODAS_EMPRESAS_RH);
    expect(escolherEmpresaRH({ lista: ["Laportec", "Avora"], podeTodas: false, salva: TODAS_EMPRESAS_RH })).toBe("Laportec");
  });

  it("nomeia os módulos da empresa", () => {
    expect(nomeModulos(["financeiro", "rh"])).toBe("Financeiro e RH");
    expect(nomeModulos(["rh"])).toBe("Só RH");
    expect(nomeModulos(["financeiro"])).toBe("Só Financeiro");
  });
});
