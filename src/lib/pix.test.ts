import { describe, it, expect } from "vitest";
import {
  detectarTipoChave, normalizarChavePix, formatarChavePix, erroChavePix, lerPixCopiaECola, resumirChavePix,
} from "@/lib/pix";

const CPF = "529.982.247-25";          // CPF válido (dígitos fecham)
const CNPJ = "11.222.333/0001-81";     // CNPJ válido
const ALEATORIA = "123e4567-e89b-12d3-a456-426614174000";

describe("detectarTipoChave", () => {
  it("documento pela quantidade de dígitos", () => {
    expect(detectarTipoChave(CPF)).toBe("cpf");
    expect(detectarTipoChave("52998224725")).toBe("cpf");
    expect(detectarTipoChave(CNPJ)).toBe("cnpj");
  });

  it("11 dígitos que não fecham como CPF são telefone", () => {
    // Celular com DDD tem o mesmo tamanho de um CPF — o desempate é o DV.
    expect(detectarTipoChave("11987654321")).toBe("telefone");
    expect(detectarTipoChave("(11) 98765-4321")).toBe("telefone");
    // Mesmo com DV de CPF válido, o + na frente diz que é telefone.
    expect(detectarTipoChave("+5511987654321")).toBe("telefone");
  });

  it("e-mail, chave aleatória e o resto", () => {
    expect(detectarTipoChave("financeiro@empresa.com.br")).toBe("email");
    expect(detectarTipoChave(ALEATORIA.toUpperCase())).toBe("aleatoria");
    expect(detectarTipoChave("arroba sem dominio@")).toBe("outro");
    expect(detectarTipoChave("chave qualquer")).toBe("outro");
    expect(detectarTipoChave("  ")).toBe("outro");
    expect(detectarTipoChave("123")).toBe("outro");
  });
});

describe("normalizarChavePix", () => {
  it("documento vira só dígitos", () => {
    expect(normalizarChavePix(CPF)).toBe("52998224725");
    expect(normalizarChavePix(CNPJ)).toBe("11222333000181");
  });

  it("telefone vira E.164 e não duplica o DDI", () => {
    expect(normalizarChavePix("(11) 98765-4321")).toBe("+5511987654321");
    expect(normalizarChavePix("+55 11 98765-4321")).toBe("+5511987654321");
    expect(normalizarChavePix("+5511987654321")).toBe("+5511987654321");
  });

  it("e-mail e chave aleatória em minúsculas", () => {
    expect(normalizarChavePix("Financeiro@Empresa.COM")).toBe("financeiro@empresa.com");
    expect(normalizarChavePix(ALEATORIA.toUpperCase())).toBe(ALEATORIA);
  });

  it("a mesma chave colada de dois jeitos grava igual", () => {
    expect(normalizarChavePix("529.982.247-25")).toBe(normalizarChavePix(" 52998224725 "));
  });
});

describe("formatarChavePix", () => {
  it("devolve a máscara que a pessoa reconhece", () => {
    expect(formatarChavePix("52998224725")).toBe("529.982.247-25");
    expect(formatarChavePix("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatarChavePix("+5511987654321")).toBe("(11) 98765-4321");
    expect(formatarChavePix("+551133334444")).toBe("(11) 3333-4444");
  });

  it("e-mail e chave aleatória passam intactos", () => {
    expect(formatarChavePix("financeiro@empresa.com")).toBe("financeiro@empresa.com");
    expect(formatarChavePix(ALEATORIA)).toBe(ALEATORIA);
  });
});

describe("erroChavePix", () => {
  it("aceita as chaves válidas", () => {
    for (const c of [CPF, CNPJ, "financeiro@empresa.com", "(11) 98765-4321", ALEATORIA]) {
      expect(erroChavePix(c)).toBeNull();
    }
  });

  it("recusa documento com dígito verificador errado", () => {
    expect(erroChavePix("529.982.247-26", "cpf")).toMatch(/CPF/);
    expect(erroChavePix("11.222.333/0001-82", "cnpj")).toMatch(/CNPJ/);
    expect(erroChavePix("111.111.111-11", "cpf")).toMatch(/CPF/);
  });

  it("recusa vazio, e-mail quebrado e aleatória incompleta", () => {
    expect(erroChavePix("   ")).toMatch(/Informe/);
    expect(erroChavePix("financeiro@", "email")).toMatch(/mail/);
    expect(erroChavePix("123e4567-e89b", "aleatoria")).toMatch(/aleat/);
    expect(erroChavePix("9999", "telefone")).toMatch(/Telefone/);
  });

  it("tipo 'outro' só exige que não esteja vazia", () => {
    expect(erroChavePix("chave interna 42", "outro")).toBeNull();
  });
});

// ─── Pix copia e cola (BR Code) ─────────────────────────────
// Exemplo do Manual de Padrões para Iniciação do Pix (Banco Central).
const BR_ESTATICO =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";

// Monta um código com o CRC certo (para testar o QR dinâmico e o com valor).
const campo = (id: string, v: string) => `${id}${String(v.length).padStart(2, "0")}${v}`;
function crc(s: string) {
  let c = 0xffff;
  for (const b of new TextEncoder().encode(s)) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, "0");
}
function montar(conta: string, extra = "") {
  const corpo = campo("00", "01") + campo("26", conta) + campo("52", "0000") + campo("53", "986") + extra
    + campo("58", "BR") + campo("59", "LOJA EXEMPLO LTDA") + campo("60", "SAO PAULO") + campo("62", campo("05", "PED123")) + "6304";
  return corpo + crc(corpo);
}

describe("Pix copia e cola", () => {
  it("lê o QR estático do manual do Banco Central: chave, nome e cidade, CRC conferido", () => {
    const l = lerPixCopiaECola(BR_ESTATICO)!;
    expect(l.crcOk).toBe(true);
    expect(l.chave).toBe("123e4567-e12b-12d1-a456-426655440000");
    expect(l.url).toBeNull();
    expect(l.nome).toBe("Fulano de Tal");
    expect(l.cidade).toBe("BRASILIA");
    expect(l.valor).toBeNull();
  });

  it("lê valor, descrição e txid quando vêm no código", () => {
    const cod = montar(campo("00", "br.gov.bcb.pix") + campo("01", "financeiro@empresa.com.br") + campo("02", "Limpeza"), campo("54", "230.00"));
    const l = lerPixCopiaECola(cod)!;
    expect(l.crcOk).toBe(true);
    expect(l.chave).toBe("financeiro@empresa.com.br");
    expect(l.valor).toBe(230);
    expect(l.descricao).toBe("Limpeza");
    expect(l.txid).toBe("PED123");
  });

  it("QR dinâmico: não tem chave, tem o endereço — vira tipo copia e cola", () => {
    const cod = montar(campo("00", "br.gov.bcb.pix") + campo("25", "qr.banco.com.br/v2/cobv/9d36b84f"));
    const l = lerPixCopiaECola(cod)!;
    expect(l.chave).toBeNull();
    expect(l.url).toBe("qr.banco.com.br/v2/cobv/9d36b84f");
    expect(detectarTipoChave(cod)).toBe("copia_cola");
    expect(erroChavePix(cod, "copia_cola")).toBeNull();
  });

  it("aceita o código com quebra de linha (colado de PDF/WhatsApp)", () => {
    const quebrado = BR_ESTATICO.slice(0, 50) + "\n" + BR_ESTATICO.slice(50);
    expect(lerPixCopiaECola(quebrado)?.crcOk).toBe(true);
    expect(normalizarChavePix(quebrado, "copia_cola")).toBe(BR_ESTATICO);
  });

  it("código cortado ou alterado é recusado", () => {
    expect(erroChavePix(BR_ESTATICO.slice(0, -1) + "0", "copia_cola")).toMatch(/incompleto ou foi alterado/);
    expect(erroChavePix(BR_ESTATICO.slice(0, 60), "copia_cola")).toMatch(/inválido/);
    expect(lerPixCopiaECola("financeiro@empresa.com.br")).toBeNull();
  });

  it("o código longo passa do limite de 77 caracteres das chaves comuns", () => {
    expect(BR_ESTATICO.length).toBeGreaterThan(77);
    expect(erroChavePix(BR_ESTATICO, "copia_cola")).toBeNull();
  });

  it("na tabela, o código aparece resumido com o nome do recebedor", () => {
    expect(resumirChavePix(BR_ESTATICO, "copia_cola")).toBe("00020126580014…1D3D · Fulano de Tal");
  });
});
