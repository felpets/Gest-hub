// ─── Contas do mês: os dados e as regras, num lugar só ──────────────────────
// Usado pelas DUAS telas de Financeiro › Pagamentos › Contas do mês: a de
// computador (telas/contas-a-pagar) e a de celular (telas/contas-celular).
//
// O que mora aqui é o que não pode divergir: quais contas o mês mostra, o que
// cada número do resumo soma, e a manutenção que roda ao abrir a tela. Se uma
// das telas calculasse o seu próprio "vencidas em aberto", o app e o navegador
// contariam histórias diferentes sobre a mesma empresa.
import { useEffect, useMemo, useRef } from "react";
import {
  usePrevistos,
  usePlanoContas,
  useReconciliarRecorrentes,
  useApagarPrevistosVencidos,
  type Previsto,
} from "@/lib/queries";
import { useEmpresa } from "@/lib/empresa";
import { hojeISO, pad } from "@/lib/datas";

// Agrupamento de categorias para os seletores (raiz → filhas), no formato que
// os <Select> das duas telas consomem.
export type CatGroups = { label: string; options: { value: string; label: string }[] }[];

// Mês de uma data, no formato "AAAA-MM" dos filtros.
export const ymDe = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const ymDeHoje = () => ymDe(new Date());

export const fmtMesAno = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
};

export function useCatGroups(): CatGroups {
  const { data: contas = [] } = usePlanoContas();
  return useMemo(() => {
    const roots = contas.filter((c) => !c.parentId);
    return roots.map((root) => ({
      label: root.nome,
      options: [
        { value: root.nome, label: root.nome },
        ...contas
          .filter((c) => c.parentId === root.id)
          .map((c) => ({ value: `${root.nome} / ${c.nome}`, label: c.nome })),
      ],
    }));
  }, [contas]);
}

// Ao abrir a tela (e ao trocar de empresa): limpa previstos vencidos que não
// eram saída em aberto e estende as recorrências até o horizonte. Sem isto, a
// lista do mês chega incompleta — e esta é a razão de a manutenção ser do
// MÓDULO, não da tela: a de celular abre a mesma lista e precisa do mesmo
// preparo. Só com a empresa resolvida: antes disso getEmpresaId() lança.
export function useManutencaoContas() {
  const { empresaId } = useEmpresa();
  const reconciliar = useReconciliarRecorrentes();
  const apagarVencidos = useApagarPrevistosVencidos();
  const feitoPara = useRef<string | null>(null);
  useEffect(() => {
    if (!empresaId || feitoPara.current === empresaId) return;
    feitoPara.current = empresaId;
    apagarVencidos.mutate();
    reconciliar.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);
}

export type DadosContas = {
  hoje: string;
  // Todas as saídas previstas da empresa (base dos filtros e da seleção).
  saidas: Previsto[];
  // O que a lista do mês mostra: as do mês escolhido MAIS as vencidas em
  // aberto de qualquer outro mês. Uma conta vencida não pode sumir só porque
  // o mês virou — é justamente a que alguém precisa ver.
  visiveis: Previsto[];
  aPagarMes: number;
  pagoMes: number;
  vencidas: Previsto[];
  vencidasTotal: number;
  // "A vencer": em aberto no mês e ainda no prazo. É o resumo do celular, e
  // separa-se de aPagarMes (que inclui as já vencidas do próprio mês).
  aVencer: Previsto[];
  aVencerTotal: number;
  carregando: boolean;
  erro: unknown;
};

export function useContasDoMes(mesSel: string): DadosContas {
  const { data: previstos = [], isLoading, error } = usePrevistos();
  const hoje = hojeISO();

  const saidas = useMemo(() => previstos.filter((p) => p.tipo === "out"), [previstos]);

  const visiveis = useMemo(() => {
    const doMes = saidas.filter((p) => p.data.slice(0, 7) === mesSel);
    const vencidasFora = saidas.filter(
      (p) => !p.pago && p.data < hoje && p.data.slice(0, 7) !== mesSel,
    );
    return [...vencidasFora, ...doMes].sort((a, b) => a.data.localeCompare(b.data));
  }, [saidas, mesSel, hoje]);

  return useMemo(() => {
    const aPagarMes = saidas
      .filter((p) => !p.pago && p.data.slice(0, 7) === mesSel)
      .reduce((s, p) => s + p.valor, 0);
    // Pago conta pela data do PAGAMENTO, não pelo vencimento: é o mês em que o
    // dinheiro saiu. Sem pagoEm (registro antigo), o vencimento responde.
    const pagoMes = saidas
      .filter((p) => p.pago && (p.pagoEm ?? p.data).slice(0, 7) === mesSel)
      .reduce((s, p) => s + p.valor, 0);
    const vencidas = saidas.filter((p) => !p.pago && p.data < hoje);
    const aVencer = saidas.filter(
      (p) => !p.pago && p.data >= hoje && p.data.slice(0, 7) === mesSel,
    );
    return {
      hoje,
      saidas,
      visiveis,
      aPagarMes,
      pagoMes,
      vencidas,
      vencidasTotal: vencidas.reduce((s, p) => s + p.valor, 0),
      aVencer,
      aVencerTotal: aVencer.reduce((s, p) => s + p.valor, 0),
      carregando: isLoading,
      erro: error,
    };
  }, [saidas, visiveis, mesSel, hoje, isLoading, error]);
}
