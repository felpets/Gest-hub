// Categorias do plano de contas: caminho-texto e resolução das flags de
// relatório (ocultar / modo de competência). Puro e testável.
import type { Conta } from "@/lib/queries";
import type { CompetenciaModo } from "@/lib/datas";

// Caminho-texto da categoria, igual ao gravado em Movimentacao.cat:
// raiz -> "Pai"; filha -> "Pai / Filho".
export function caminhoConta(conta: Conta, contas: Conta[]): string {
  if (!conta.parentId) return conta.nome;
  const pai = contas.find((c) => c.id === conta.parentId);
  return pai ? `${pai.nome} / ${conta.nome}` : conta.nome;
}

// Renomear (ou mover de pai) uma categoria muda o caminho-texto gravado nas
// movimentações — o dela e, se ela for pai, o de cada filha ("Pai / Filha"
// carrega o nome do pai). Devolve os pares [caminhoAntigo, caminhoNovo] a
// propagar. Sem mudança de caminho → lista vazia.
export function paresRenomeacao(
  contas: Conta[],
  id: string,
  novoNome: string,
  novoParentId: string | null
): [string, string][] {
  const atual = contas.find((c) => c.id === id);
  if (!atual) return [];
  const depois = contas.map((c) => (c.id === id ? { ...c, nome: novoNome, parentId: novoParentId } : c));
  const pares: [string, string][] = [];
  for (const c of [atual, ...contas.filter((f) => f.parentId === id)]) {
    const antigo = caminhoConta(c, contas);
    const novo = caminhoConta(depois.find((d) => d.id === c.id)!, depois);
    if (antigo !== novo) pares.push([antigo, novo]);
  }
  return pares;
}

export type RegraCompetencia = { modo: CompetenciaModo; diaCorte: number | null };
const PAGAMENTO: RegraCompetencia = { modo: "pagamento", diaCorte: null };

export type CatFlags = {
  ocultoDe: (cat: string) => boolean;
  anunciosDe: (cat: string) => boolean;
  compensaDe: (cat: string) => boolean;
  competenciaDe: (cat: string) => RegraCompetencia;
};

// Resolve, a partir do plano de contas, as flags de relatório por CAMINHO-categoria,
// com HERANÇA pai→filho (filha sem regra própria herda a do pai). O match é por
// texto-caminho, igual ao gravado em Movimentacao.cat; caminho não-encontrado
// (texto livre / categoria renomeada) = sem flag / competência = mês do pagamento.
export function resolverFlags(contas: Conta[]): CatFlags {
  const byId = new Map(contas.map((c) => [c.id, c]));
  const ocultoEfetivo = (c: Conta): boolean => {
    if (c.ocultoRelatorios) return true;
    const pai = c.parentId ? byId.get(c.parentId) : undefined;
    return pai ? pai.ocultoRelatorios : false;
  };
  // Regra própria se não for "pagamento"; senão herda a do pai.
  const competenciaEfetiva = (c: Conta): RegraCompetencia => {
    if (c.competenciaModo !== "pagamento") return { modo: c.competenciaModo, diaCorte: c.competenciaDiaCorte };
    const pai = c.parentId ? byId.get(c.parentId) : undefined;
    if (pai && pai.competenciaModo !== "pagamento") return { modo: pai.competenciaModo, diaCorte: pai.competenciaDiaCorte };
    return PAGAMENTO;
  };

  // Investimento em anúncios: marcando o pai, as filhas entram junto — a
  // empresa marca "Investimento em Meta Ads" uma vez e as campanhas seguem.
  const anunciosEfetivo = (c: Conta): boolean => {
    if (c.investimentoAnuncios) return true;
    const pai = c.parentId ? byId.get(c.parentId) : undefined;
    return pai ? pai.investimentoAnuncios : false;
  };

  // Compensação (migração 56): marcando o pai, as filhas entram junto.
  const compensaEfetivo = (c: Conta): boolean => {
    if (c.compensar) return true;
    const pai = c.parentId ? byId.get(c.parentId) : undefined;
    return pai ? pai.compensar : false;
  };

  const ocultos = new Set<string>();
  const anuncios = new Set<string>();
  const compensadas = new Set<string>();
  const competencias = new Map<string, RegraCompetencia>();
  for (const c of contas) {
    const cam = caminhoConta(c, contas);
    if (ocultoEfetivo(c)) ocultos.add(cam);
    if (anunciosEfetivo(c)) anuncios.add(cam);
    if (compensaEfetivo(c)) compensadas.add(cam);
    const reg = competenciaEfetiva(c);
    if (reg.modo !== "pagamento") competencias.set(cam, reg);
  }
  // Categoria apagada ou renomeada no plano deixa o texto "Pai / Filho" gravado
  // nos lançamentos antigos. Sem achar o caminho inteiro, vale a marca do PAI —
  // senão o lançamento fica órfão e escapa das regras da categoria de cima.
  const tem = (conjunto: Set<string>, cat: string) => {
    const c = (cat ?? "").trim();
    if (!c) return false;
    if (conjunto.has(c)) return true;
    const corte = c.indexOf(" / ");
    return corte > 0 && conjunto.has(c.slice(0, corte));
  };

  return {
    ocultoDe: (cat) => tem(ocultos, cat),
    anunciosDe: (cat) => tem(anuncios, cat),
    compensaDe: (cat) => tem(compensadas, cat),
    competenciaDe: (cat) => {
      const c = (cat ?? "").trim();
      const corte = c.indexOf(" / ");
      return competencias.get(c) ?? (corte > 0 ? competencias.get(c.slice(0, corte)) : undefined) ?? PAGAMENTO;
    },
  };
}
