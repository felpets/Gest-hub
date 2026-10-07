// Relatórios Analítico × Sintético por categoria: as linhas nascem do PLANO DE
// CONTAS (todas as categorias, zeradas incluídas), e só então os totais são
// cruzados com as movimentações. Puro e testável.
//
// - Sintético: pai e filhas na ordem do código, cada uma com seu total (zerada
//   sai como 0), subtotal implícito no pai (soma das filhas + lançamentos
//   gravados direto nele) e linha de TOTAL no fim.
// - Analítico: a mesma espinha, abrindo cada lançamento sob a sua categoria.
//
// A competência NÃO é resolvida aqui: as movimentações chegam já filtradas pelo
// período via dataComp (useMovimentacoesRelatorio + aplicaFiltros). Categoria
// oculta dos relatórios aparece na listagem (decisão de produto), mas os seus
// lançamentos não estão na base — a linha fica 0 e é marcada `foraRelatorios`.
import type { Conta, Movimentacao } from "@/lib/queries";
import { caminhoConta } from "@/lib/categorias";

export type ModeloRelatorio = "sintetico" | "analitico";

// Linha já na ordem final de exibição. `nivel` orienta o estilo (indentação e
// negrito) na tela, no PDF e no Excel.
export type LinhaCategoria = {
  nivel: "pai" | "filha" | "lancamento" | "vazio" | "total";
  texto: string;          // nome da categoria (com código), descrição do lançamento ou rótulo do total
  data?: string;          // dd/MM — só em lançamentos (data REAL do pagamento)
  valor: number | null;   // null na linha "sem lançamentos no período"
  pct: number | null;     // % sobre o total do relatório; null onde não se aplica
  foraRelatorios?: boolean; // categoria marcada "não entra em relatórios"
};

const r2 = (n: number) => Math.round(n * 100) / 100;

// Pais do tipo pedido na ordem do código, cada um seguido das suas filhas
// (também por código). Código vazio ordena por nome, no fim.
export function categoriasOrdenadas(contas: Conta[], tipo: "receita" | "despesa"): Conta[] {
  const cmp = (a: Conta, b: Conta) =>
    (a.codigo || "￿").localeCompare(b.codigo || "￿", "pt-BR", { numeric: true }) ||
    a.nome.localeCompare(b.nome, "pt-BR");
  const pais = contas.filter((c) => !c.parentId && c.tipo === tipo).sort(cmp);
  return pais.flatMap((p) => [p, ...contas.filter((c) => c.parentId === p.id).sort(cmp)]);
}

const rotulo = (c: Conta) => (c.codigo ? `${c.codigo} ${c.nome}` : c.nome);

// Total lançado DIRETO em cada caminho-categoria (sem herança pai/filha) e o
// resto que não casa com o plano (texto livre, renomeada ou sem categoria).
function totaisDiretos(movs: Movimentacao[], tipoMov: "in" | "out", caminhos: Set<string>) {
  const porCaminho = new Map<string, number>();
  let semCategoria = 0;
  for (const m of movs) {
    if (m.tipo !== tipoMov) continue;
    const cat = (m.cat ?? "").trim();
    if (caminhos.has(cat)) porCaminho.set(cat, r2((porCaminho.get(cat) ?? 0) + m.valor));
    else semCategoria = r2(semCategoria + m.valor);
  }
  return { porCaminho, semCategoria };
}

export type RelatorioCategorias = {
  linhas: LinhaCategoria[];
  total: number; // total geral (entradas OU saídas, conforme o tipo)
};

// Monta o relatório de um tipo de categoria (receita→entradas, despesa→saídas).
// `movs` deve chegar já recortado pelo período/filtros (por competência).
export function montarRelatorioCategorias(
  contas: Conta[],
  movs: Movimentacao[],
  tipo: "receita" | "despesa",
  modelo: ModeloRelatorio
): RelatorioCategorias {
  const tipoMov: "in" | "out" = tipo === "receita" ? "in" : "out";
  const ordenadas = categoriasOrdenadas(contas, tipo);
  const caminhoDe = new Map(ordenadas.map((c) => [c.id, caminhoConta(c, contas)]));
  const { porCaminho, semCategoria } = totaisDiretos(movs, tipoMov, new Set(caminhoDe.values()));

  // Total do pai = lançado direto nele + soma das filhas.
  const totalDe = (c: Conta): number => {
    const direto = porCaminho.get(caminhoDe.get(c.id)!) ?? 0;
    if (c.parentId) return direto;
    const filhas = ordenadas.filter((f) => f.parentId === c.id);
    return r2(direto + filhas.reduce((s, f) => s + (porCaminho.get(caminhoDe.get(f.id)!) ?? 0), 0));
  };

  const totalGeral = r2(
    ordenadas.filter((c) => !c.parentId).reduce((s, c) => s + totalDe(c), 0) + semCategoria
  );
  const pct = (v: number) => (totalGeral ? r2((v / totalGeral) * 100) : 0);

  // Lançamentos de um caminho, mais antigos primeiro (data real na exibição).
  const lancamentosDe = (caminho: string) =>
    movs
      .filter((m) => m.tipo === tipoMov && (m.cat ?? "").trim() === caminho)
      .sort((a, b) => a.dataISO.localeCompare(b.dataISO));

  const linhas: LinhaCategoria[] = [];
  const abrirLancamentos = (c: Conta) => {
    if (modelo !== "analitico") return;
    const lancs = lancamentosDe(caminhoDe.get(c.id)!);
    for (const m of lancs)
      linhas.push({ nivel: "lancamento", texto: m.ia || m.desc, data: m.date, valor: m.valor, pct: null });
    // "sem lançamentos" só onde não há mais nada por baixo: numa folha, ou num
    // pai sem filhas. Pai com filhas zeradas já mostra as filhas dizendo isso.
    const temFilhas = !c.parentId && ordenadas.some((f) => f.parentId === c.id);
    if (lancs.length === 0 && !temFilhas)
      linhas.push({ nivel: "vazio", texto: "sem lançamentos no período", valor: null, pct: null });
  };

  for (const c of ordenadas) {
    const v = totalDe(c);
    linhas.push({
      nivel: c.parentId ? "filha" : "pai",
      texto: rotulo(c),
      valor: v,
      pct: pct(v),
      foraRelatorios: c.ocultoRelatorios || undefined,
    });
    abrirLancamentos(c);
  }

  // O que não casou com o plano não pode sumir do total.
  if (semCategoria !== 0) {
    linhas.push({ nivel: "pai", texto: "(sem categoria)", valor: semCategoria, pct: pct(semCategoria) });
    if (modelo === "analitico") {
      const caminhos = new Set(caminhoDe.values());
      for (const m of movs
        .filter((mv) => mv.tipo === tipoMov && !caminhos.has((mv.cat ?? "").trim()))
        .sort((a, b) => a.dataISO.localeCompare(b.dataISO)))
        linhas.push({ nivel: "lancamento", texto: m.ia || m.desc, data: m.date, valor: m.valor, pct: null });
    }
  }

  linhas.push({
    nivel: "total",
    texto: tipo === "receita" ? "TOTAL DE ENTRADAS" : "TOTAL DE SAÍDAS",
    valor: totalGeral,
    pct: totalGeral ? 100 : 0,
  });

  return { linhas, total: totalGeral };
}
