// ─── Parcelamento de uma venda ─────────────────────────────────────────────
// Uma venda vira cobranças (contas a receber). O parcelamento pode ser em
// parcelas iguais ou livre — valor e data de cada uma definidos à mão, que é o
// caso real de "2.000 em outubro, 3.000 em novembro…".
//
// Dinheiro em CENTAVOS na divisão: 10.000 / 3 em float dá 3333,333… e a soma
// não fecha. Aqui a sobra vai para a PRIMEIRA parcela, que é como se cobra.
//
// Puro: sem React, sem banco, sem relógio implícito.

export type Parcela = { valor: number; vencimento: string };
export type ModoParcelamento = "sem" | "avista" | "iguais" | "personalizado";

const pad2 = (n: number) => String(n).padStart(2, "0");
const r2 = (n: number) => Math.round(n * 100) / 100;

// Mesmo dia, N meses à frente. Dia 31 em mês curto cai no último dia do mês.
export function somarMeses(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const alvoMes = m - 1 + n;
  const ano = y + Math.floor(alvoMes / 12);
  const mes = ((alvoMes % 12) + 12) % 12;
  const ultimo = new Date(ano, mes + 1, 0).getDate();
  return `${ano}-${pad2(mes + 1)}-${pad2(Math.min(d, ultimo))}`;
}

// N parcelas iguais a partir de uma data, uma por mês.
export function parcelasIguais(total: number, n: number, primeiroVencimento: string): Parcela[] {
  const qtd = Math.max(1, Math.floor(n));
  const centavos = Math.round(Math.abs(total) * 100);
  const base = Math.floor(centavos / qtd);
  const sobra = centavos - base * qtd;
  return Array.from({ length: qtd }, (_, i) => ({
    // A sobra dos centavos entra na primeira parcela.
    valor: (base + (i === 0 ? sobra : 0)) / 100,
    vencimento: somarMeses(primeiroVencimento, i),
  }));
}

export function somaParcelas(parcelas: Parcela[]): number {
  return r2(parcelas.reduce((s, p) => s + (Number.isFinite(p.valor) ? p.valor : 0), 0));
}

// Diferença entre o que foi parcelado e o valor da venda (positivo = sobrou).
export function diferenca(parcelas: Parcela[], total: number): number {
  return r2(somaParcelas(parcelas) - r2(Math.abs(total)));
}

// Mensagem do que impede gerar as cobranças, ou null quando está tudo certo.
// A tolerância é de um centavo por parcela — a mesma que o banco aplica.
export function erroParcelamento(parcelas: Parcela[], total: number): string | null {
  if (parcelas.length === 0) return "Informe ao menos uma parcela.";
  if (parcelas.some((p) => !(p.valor > 0))) return "Toda parcela precisa de um valor maior que zero.";
  if (parcelas.some((p) => !p.vencimento)) return "Toda parcela precisa de uma data de vencimento.";
  const dif = diferenca(parcelas, total);
  if (Math.abs(dif) > parcelas.length * 0.01) {
    return dif > 0
      ? `As parcelas somam ${fmtDif(dif)} a mais que o valor da venda.`
      : `Faltam ${fmtDif(-dif)} para fechar o valor da venda.`;
  }
  return null;
}

const fmtDif = (v: number) =>
  `R$ ${v.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d),)/g, ".")}`;

// Ajusta a lista quando muda a quantidade: mantém o que já foi digitado e
// completa (ou corta) o resto, sem apagar o trabalho de quem estava editando.
export function redimensionar(parcelas: Parcela[], n: number, total: number, primeiroVencimento: string): Parcela[] {
  const qtd = Math.max(1, Math.floor(n));
  if (qtd === parcelas.length) return parcelas;
  if (qtd < parcelas.length) return parcelas.slice(0, qtd);
  const base = parcelasIguais(total, qtd, parcelas[0]?.vencimento || primeiroVencimento);
  return base.map((p, i) => parcelas[i] ?? p);
}
