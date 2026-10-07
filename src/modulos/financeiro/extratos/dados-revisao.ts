// ─── Revisar e classificar: o estado da revisão ─────────────────────────────
// A segunda etapa dos Extratos em duas telas — a de computador (telas/revisao,
// uma tabela) e a de celular (telas/extratos-celular, cartões). O que não pode
// divergir mora aqui: de onde vem a categoria escolhida de cada pendência, o
// que conta como "pronta para aprovar" e o que aprovar e descartar fazem.
//
// A regra central: cada pendência começa com a categoria SUGERIDA pela máquina,
// e a escolha de quem revisa vence sobre ela até a lista mudar. Era isso que
// estava preso dentro da tela grande.
import { useEffect, useMemo, useState } from "react";
import {
  usePendentes,
  usePlanoContas,
  useAprovarLote,
  useDeleteMovimentacao,
  useDeleteMovimentacoesBatch,
  useSemearHistorico,
  useSugerirCategorias,
  type Pendente,
} from "@/lib/queries";

// Referência estável: `data ?? []` criaria um array novo a cada render e o
// efeito que semeia as escolhas rodaria para sempre.
const SEM_PENDENTES: Pendente[] = [];

export function useRevisao(lote?: string) {
  const { data, isLoading } = usePendentes(lote);
  const pendentes = data ?? SEM_PENDENTES;
  const { data: contas = [] } = usePlanoContas();

  const aprovar = useAprovarLote();
  const excluirUma = useDeleteMovimentacao();
  const excluirTodasMut = useDeleteMovimentacoesBatch();
  const semear = useSemearHistorico();
  const sugerir = useSugerirCategorias();

  // Categoria escolhida por pendência (id do plano de contas). Começa na
  // sugestão da máquina e preserva o que a pessoa já trocou.
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  useEffect(() => {
    setEscolhas((antes) => {
      const agora: Record<string, string> = {};
      for (const p of pendentes) agora[p.id] = antes[p.id] ?? p.sugeridaId ?? "";
      return agora;
    });
  }, [pendentes]);

  const escolher = (id: string, catId: string) =>
    setEscolhas((antes) => ({ ...antes, [id]: catId }));

  const comCategoria = useMemo(
    () => pendentes.filter((p) => escolhas[p.id]),
    [pendentes, escolhas],
  );
  const comSugestao = useMemo(() => pendentes.filter((p) => p.sugeridaId).length, [pendentes]);

  // Sem plano de contas não há o que escolher — e aprovar sem categoria é o
  // que a etapa inteira existe para impedir.
  const semPlano = contas.length === 0;

  const aprovarUma = async (id: string) => {
    const catId = escolhas[id];
    if (!catId) return;
    await aprovar.mutateAsync([{ id, categoria_id: catId }]);
  };

  const aprovarTodas = async () => {
    const payload = comCategoria.map((p) => ({ id: p.id, categoria_id: escolhas[p.id] }));
    if (payload.length === 0) return;
    await aprovar.mutateAsync(payload);
  };

  // Descarta tudo o que está na tela: o lote, quando a revisão está filtrada
  // por um; senão, todas as pendências da empresa.
  const excluirTodas = () => excluirTodasMut.mutateAsync(pendentes.map((p) => p.id));

  return {
    pendentes,
    contas,
    carregando: isLoading,
    escolhas,
    escolher,
    comCategoria,
    semCategoria: pendentes.length - comCategoria.length,
    comSugestao,
    semPlano,
    aprovar,
    aprovarUma,
    aprovarTodas,
    excluirUma,
    excluirTodasMut,
    excluirTodas,
    semear,
    sugerir,
  };
}
