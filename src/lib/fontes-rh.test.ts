import { describe, it, expect } from "vitest";
import {
  FONTES_RH, ehFonteRH, nomeFonteRH, origemRHCoberta, porCompetencia, valorDaFonte,
  type TotaisRH,
} from "@/lib/fontes-rh";

const totais: TotaisRH = {
  competencia: "2026-09",
  salarios: 38450,
  adiantamento: 12540,
  vt: 9156.62,
  vr: 7180.8,
  pessoas: 20,
  folhaLiquida: 30000,
  vrAproximado: false,
};

describe("valor da recorrência vindo do RH", () => {
  it("não tem chave repetida", () => {
    const chaves = FONTES_RH.map((f) => f.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("cada fonte devolve o total certo", () => {
    expect(valorDaFonte(totais, "salarios")).toBe(38450);
    expect(valorDaFonte(totais, "adiantamento")).toBe(12540);
    expect(valorDaFonte(totais, "vt")).toBe(9156.62);
    expect(valorDaFonte(totais, "vr")).toBe(7180.8);
  });

  it("a folha líquida desconta só o adiantamento que foi pago — o valor vem pronto do banco", () => {
    expect(valorDaFonte(totais, "folha_liquida")).toBe(30000);
  });

  it("sem a migração 59, a folha líquida cai na conta antiga (salário menos o previsto)", () => {
    const antigo = { ...totais, folhaLiquida: null };
    expect(valorDaFonte(antigo, "folha_liquida")).toBe(25910);
    // Adiantamento maior que o salário não vira valor negativo.
    expect(valorDaFonte({ ...antigo, adiantamento: 99999 }, "folha_liquida")).toBe(0);
  });

  it("sem totais devolve null — quem chama mantém o valor que já estava", () => {
    expect(valorDaFonte(undefined, "vt")).toBeNull();
    expect(valorDaFonte(null, "salarios")).toBeNull();
  });

  it("só aceita as chaves do catálogo", () => {
    expect(ehFonteRH("vt")).toBe(true);
    expect(ehFonteRH("folha")).toBe(false);
    expect(ehFonteRH(null)).toBe(false);
    expect(nomeFonteRH("adiantamento")).toBe("Adiantamento quinzenal");
    expect(nomeFonteRH(null)).toBe("");
  });

  it("indexa por competência", () => {
    const mapa = porCompetencia([totais, { ...totais, competencia: "2026-10" }]);
    expect(mapa.get("2026-09")?.salarios).toBe(38450);
    expect(mapa.get("2026-11")).toBeUndefined();
  });

  it("a recorrência ligada ao RH cobre a rubrica — o Dashboard não repete a folha", () => {
    expect(origemRHCoberta("salarios")).toBe("rh_salario");
    expect(origemRHCoberta("folha_liquida")).toBe("rh_salario");
    expect(origemRHCoberta("adiantamento")).toBe("rh_adiantamento");
    // VT e VR não têm linha por pessoa no Dashboard: não há o que esconder.
    expect(origemRHCoberta("vt")).toBeNull();
    expect(origemRHCoberta("vr")).toBeNull();
  });
});
