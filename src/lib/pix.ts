// Chaves Pix: detectar o tipo, normalizar para gravar e formatar para ler.
//
// Quem digita a chave está com o comprovante na mão e cola do jeito que veio
// ("123.456.789-09", "(11) 98888-7777", "FULANO@EMPRESA.COM"). Aqui a chave
// vira uma forma canônica ANTES de ir para o banco — assim a mesma chave não
// entra duas vezes com máscaras diferentes e a busca da tela encontra ela.
// O tipo é deduzido do formato; o usuário pode corrigir na tela se quiser.
//
// Também aceita o Pix copia e cola (o texto do QR code, padrão BR Code do
// Banco Central). O QR estático traz a chave dentro: ela é extraída e gravada
// como chave comum. O dinâmico (cobrança de banco/maquininha) não traz chave —
// só um endereço que o banco do pagador consulta —, então o código inteiro é
// gravado, com o tipo "copia_cola", para ser colado no app do banco.

export type TipoChavePix = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria" | "outro" | "copia_cola";

export const TIPOS_CHAVE: { valor: TipoChavePix; label: string }[] = [
  { valor: "cpf", label: "CPF" },
  { valor: "cnpj", label: "CNPJ" },
  { valor: "email", label: "E-mail" },
  { valor: "telefone", label: "Telefone" },
  { valor: "aleatoria", label: "Chave aleatória" },
  { valor: "copia_cola", label: "Pix copia e cola (QR code)" },
  { valor: "outro", label: "Outra" },
];

export const labelTipoChave = (t: string) => TIPOS_CHAVE.find((x) => x.valor === t)?.label ?? t;

const soDigitos = (s: string) => s.replace(/\D/g, "");

// Aceita o que o Pix aceita: até 77 caracteres e um @ com domínio com ponto.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Dígitos verificadores do CPF (peso decrescente, resto < 2 vira 0).
function cpfValido(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

// Dígitos verificadores do CNPJ (pesos 2..9 ciclando da direita para a esquerda).
function cnpjValido(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (ate: number) => {
    let soma = 0;
    let peso = 2;
    for (let i = ate - 1; i >= 0; i--) {
      soma += Number(d[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

// ─── Pix copia e cola (BR Code / EMV) ───────────────────────
// Campos TLV: 2 dígitos de id, 2 de tamanho, o valor. Os que interessam:
//   26..51  conta do recebedor (GUI br.gov.bcb.pix): 01 chave · 02 descrição · 25 URL (dinâmico)
//   54 valor · 59 nome do recebedor · 60 cidade · 62/05 txid · 63 CRC16
export type PixLido = {
  codigo: string;        // o código inteiro, como foi colado (sem quebras de linha)
  chave: string | null;  // QR estático
  url: string | null;    // QR dinâmico
  valor: number | null;
  nome: string;
  cidade: string;
  descricao: string;
  txid: string;
  crcOk: boolean;
};

// Quebra de linha vira nada (o código às vezes chega quebrado); espaço interno
// fica — o nome do recebedor tem espaço e entra no CRC.
const limparCodigo = (raw: string) => raw.replace(/[\r\n\t]/g, "").trim();

export function ehPixCopiaECola(raw: string): boolean {
  const s = limparCodigo(raw);
  return s.startsWith("000201") && /br\.gov\.bcb\.pix/i.test(s);
}

function lerTlv(s: string): Map<string, string> | null {
  const campos = new Map<string, string>();
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const tam = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(id) || !Number.isInteger(tam) || i + 4 + tam > s.length) return null;
    campos.set(id, s.slice(i + 4, i + 4 + tam));
    i += 4 + tam;
  }
  return campos;
}

// CRC16-CCITT (polinômio 0x1021, início 0xFFFF), sobre o código até o "6304" inclusive.
function crc16(s: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(s)) {
    crc ^= byte << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function lerPixCopiaECola(raw: string): PixLido | null {
  const codigo = limparCodigo(raw);
  if (!ehPixCopiaECola(codigo)) return null;
  const campos = lerTlv(codigo);
  if (!campos) return null;

  let chave: string | null = null;
  let url: string | null = null;
  let descricao = "";
  for (let id = 26; id <= 51; id++) {
    const conta = campos.get(String(id));
    if (!conta) continue;
    const sub = lerTlv(conta);
    if (!sub || (sub.get("00") ?? "").toLowerCase() !== "br.gov.bcb.pix") continue;
    chave = sub.get("01")?.trim() || null;
    url = sub.get("25")?.trim() || null;
    descricao = sub.get("02")?.trim() ?? "";
    break;
  }
  if (!chave && !url) return null;

  const valorTxt = campos.get("54");
  const valor = valorTxt && Number.isFinite(Number(valorTxt)) ? Number(valorTxt) : null;
  const adicionais = campos.get("62") ? lerTlv(campos.get("62")!) : null;
  const crc = campos.get("63") ?? "";
  const semCrc = codigo.slice(0, codigo.length - crc.length);

  return {
    codigo,
    chave,
    url,
    valor,
    nome: campos.get("59")?.trim() ?? "",
    cidade: campos.get("60")?.trim() ?? "",
    descricao,
    txid: adicionais?.get("05")?.trim() ?? "",
    crcOk: crc.length === 4 && semCrc.endsWith("6304") && crc16(semCrc).toUpperCase() === crc.toUpperCase(),
  };
}

// Deduz o tipo pelo formato. 11 dígitos é ambíguo (CPF ou celular com DDD):
// desempata pelos dígitos verificadores — se não fecham como CPF, é telefone.
export function detectarTipoChave(raw: string): TipoChavePix {
  const s = raw.trim();
  if (!s) return "outro";
  if (ehPixCopiaECola(s)) return "copia_cola";
  if (UUID_RE.test(s)) return "aleatoria";
  if (s.includes("@")) return EMAIL_RE.test(s) ? "email" : "outro";
  // Sobrou algo que não é dígito nem pontuação de número → não é documento.
  if (/[^\d\s.\-/()+]/.test(s)) return "outro";

  const d = soDigitos(s);
  const comDdi = s.trimStart().startsWith("+");
  if (d.length === 14) return "cnpj";
  if (d.length === 11) return !comDdi && cpfValido(d) ? "cpf" : "telefone";
  if (d.length === 10 || d.length === 12 || d.length === 13) return "telefone";
  return "outro";
}

// Forma canônica que vai para o banco: documento só com dígitos, telefone em
// E.164 (+55DDNNNNNNNNN), e-mail e chave aleatória em minúsculas.
export function normalizarChavePix(raw: string, tipo: TipoChavePix = detectarTipoChave(raw)): string {
  if (tipo === "copia_cola") return limparCodigo(raw);
  const s = raw.trim();
  if (tipo === "cpf" || tipo === "cnpj") return soDigitos(s);
  if (tipo === "email" || tipo === "aleatoria") return s.toLowerCase();
  if (tipo === "telefone") {
    const d = soDigitos(s);
    if (!d) return "";
    // 10/11 dígitos = número nacional (falta o DDI); 12/13 já vêm com o 55.
    return `+${d.length >= 12 && d.startsWith("55") ? d : `55${d}`}`;
  }
  return s.replace(/\s+/g, " ");
}

// Volta à máscara que a pessoa reconhece — só para exibir/copiar na tela.
export function formatarChavePix(chave: string, tipo: TipoChavePix = detectarTipoChave(chave)): string {
  const d = soDigitos(chave);
  if (tipo === "cpf" && d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (tipo === "cnpj" && d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (tipo === "telefone") {
    const nac = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
    if (nac.length === 10 || nac.length === 11) {
      return `(${nac.slice(0, 2)}) ${nac.slice(2, nac.length - 4)}-${nac.slice(-4)}`;
    }
  }
  return chave;
}

// Para caber numa célula de tabela: o copia e cola tem 100+ caracteres.
export function resumirChavePix(chave: string, tipo: TipoChavePix = detectarTipoChave(chave)): string {
  if (tipo !== "copia_cola") return formatarChavePix(chave, tipo);
  const lido = lerPixCopiaECola(chave);
  const quem = lido?.nome ? ` · ${lido.nome}` : "";
  return `${chave.slice(0, 14)}…${chave.slice(-4)}${quem}`;
}

// Mensagem do que está errado, ou null se a chave serve. Chave "outra" só
// precisa não estar vazia — é a saída para casos que o Pix ainda não previu.
export function erroChavePix(raw: string, tipo: TipoChavePix = detectarTipoChave(raw)): string | null {
  const s = raw.trim();
  if (!s) return "Informe a chave Pix.";
  if (tipo === "copia_cola") {
    const lido = lerPixCopiaECola(s);
    if (!lido) return "Código Pix copia e cola inválido — copie o código inteiro do QR code.";
    if (!lido.crcOk) return "O código Pix está incompleto ou foi alterado — copie de novo, inteiro.";
    return null;
  }
  if (s.length > 77) return "Chave Pix muito longa (máximo de 77 caracteres).";
  const d = soDigitos(s);
  switch (tipo) {
    case "cpf":
      return cpfValido(d) ? null : "CPF inválido — confira os dígitos.";
    case "cnpj":
      return cnpjValido(d) ? null : "CNPJ inválido — confira os dígitos.";
    case "email":
      return EMAIL_RE.test(s) ? null : "E-mail inválido.";
    case "telefone": {
      const nac = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
      return nac.length === 10 || nac.length === 11
        ? null
        : "Telefone inválido — use DDD + número (ex.: 11 98888-7777).";
    }
    case "aleatoria":
      return UUID_RE.test(s) ? null : "Chave aleatória inválida (são 32 caracteres com hífens).";
    default:
      return null;
  }
}
