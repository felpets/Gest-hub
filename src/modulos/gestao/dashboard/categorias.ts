// Entradas / saídas por categoria: os números do gráfico do Dashboard.

export type FatiaCategoria = { name: string; value: number };

// Agrupa pelo caminho da categoria, do maior para o menor.
export function porCategoria(
  movs: { tipo: "in" | "out"; cat: string; valor: number }[],
  tipo: "in" | "out",
): FatiaCategoria[] {
  const mapa = new Map<string, number>();
  for (const m of movs) {
    if (m.tipo !== tipo) continue;
    const c = m.cat?.trim() || "(sem categoria)";
    mapa.set(c, (mapa.get(c) ?? 0) + m.valor);
  }
  return [...mapa.entries()]
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

// As `limite` maiores; o restante vira uma barra só, para o gráfico não crescer
// sem fim e o total continuar batendo.
export function comOutras(fatias: FatiaCategoria[], limite: number): FatiaCategoria[] {
  if (fatias.length <= limite) return fatias;
  const resto = fatias.slice(limite - 1).reduce((s, f) => s + f.value, 0);
  return [...fatias.slice(0, limite - 1), { name: `outras ${fatias.length - limite + 1} categorias`, value: Math.round(resto * 100) / 100 }];
}


// Nome de categoria no eixo Y. Cortar pelo fim juntaria três barras diferentes
// em três rótulos "Folha De Pagamento…": quem distingue é a filha. Então o pai
// encolhe e, se nem assim couber, some — o caminho inteiro fica no tooltip.
export const rotuloCategoria = (nome: string, max = 24) => {
  if (nome.length <= max) return nome;
  const corte = nome.indexOf(" / ");
  if (corte < 0) return `${nome.slice(0, max - 1)}…`;
  const pai = nome.slice(0, corte);
  const filha = nome.slice(corte + 3);
  const folga = max - filha.length - 3;
  if (folga >= 5) return `${pai.length > folga ? `${pai.slice(0, folga - 1)}…` : pai} / ${filha}`;
  return filha.length > max ? `${filha.slice(0, max - 1)}…` : filha;
};

// ─── Categorias compensadas (migração 56) ───────────────────
// O aporte que entra e vira anúncio: contar os dois cheios infla receita e
// despesa. Marcadas as categorias no plano de contas, o Dashboard mostra só a
// DIFERENÇA do período — em receita quando sobrou, em saída quando faltou.
export type MovDoPeriodo = { tipo: "in" | "out"; cat: string; valor: number };

export type Compensacao = {
  ativa: boolean;
  entrou: number;
  saiu: number;
  liquido: number;   // entrou − saiu
  qtd: number;
  categorias: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function compensacaoDe(movs: MovDoPeriodo[], compensa: (cat: string) => boolean): Compensacao {
  let entrou = 0, saiu = 0, qtd = 0;
  const categorias = new Set<string>();
  for (const m of movs) {
    if (!compensa(m.cat)) continue;
    categorias.add(m.cat);
    qtd++;
    if (m.tipo === "in") entrou += m.valor;
    else saiu += m.valor;
  }
  return { ativa: qtd > 0, entrou: r2(entrou), saiu: r2(saiu), liquido: r2(entrou - saiu), qtd, categorias: [...categorias].sort() };
}

// Entrou / saiu do período com as compensadas entrando só pelo líquido.
export function totaisRealizados(movs: MovDoPeriodo[], compensa: (cat: string) => boolean) {
  const comp = compensacaoDe(movs, compensa);
  let entrou = 0, saiu = 0, qtdEntrou = 0, qtdSaiu = 0;
  for (const m of movs) {
    if (compensa(m.cat)) continue;
    if (m.tipo === "in") { entrou += m.valor; qtdEntrou++; } else { saiu += m.valor; qtdSaiu++; }
  }
  if (comp.liquido > 0) { entrou += comp.liquido; qtdEntrou++; }
  else if (comp.liquido < 0) { saiu += -comp.liquido; qtdSaiu++; }
  return { entrou: r2(entrou), saiu: r2(saiu), qtdEntrou, qtdSaiu, compensacao: comp };
}
