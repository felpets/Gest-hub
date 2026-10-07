// ─── Clientes: a sincronização e o que cada um deve ─────────────────────────
// Usado pelas duas telas de Financeiro › Receitas › Clientes — a de computador
// (telas/clientes) e a de celular (telas/receitas-celular).
//
// Duas coisas moram aqui porque não podem ficar presas a uma tela:
//   · a sincronização de cobranças, que roda ao ABRIR a área. Sem ela a lista
//     chega sem as cobranças do mês, e o celular mostraria um cliente em dia
//     que na verdade tem mensalidade a vencer;
//   · quanto cada cliente deve, que é o número que o cartão do celular mostra
//     e o que a tela grande resume nos indicadores.
import { useEffect, useMemo, useRef } from "react";
import {
  useClientes,
  useCobrancas,
  useSincronizarCobrancas,
  statusCobranca,
  type Cobranca,
} from "@/lib/queries";
import { useEmpresa } from "@/lib/empresa";

export function useSincronizacaoCobrancas() {
  const { empresaId } = useEmpresa();
  const sync = useSincronizarCobrancas();
  const feitoPara = useRef<string | null>(null);
  useEffect(() => {
    if (!empresaId || feitoPara.current === empresaId) return;
    feitoPara.current = empresaId;
    sync.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);
  // Devolvido para a tela poder dizer "conciliando…" enquanto roda.
  return sync;
}

export type EmAberto = {
  // Soma do que está em aberto (no prazo + vencido). Cancelada e paga ficam de fora.
  total: number;
  qtd: number;
  // A parte do total que já passou do vencimento.
  vencido: number;
  qtdVencidas: number;
};

const ZERO: EmAberto = { total: 0, qtd: 0, vencido: 0, qtdVencidas: 0 };

export function useClientesComSaldo(hoje: string, busca = "") {
  const { data: clientes = [], isLoading, error } = useClientes();
  const { data: cobrancas = [] } = useCobrancas();

  const porCliente = useMemo(() => {
    const map = new Map<string, EmAberto>();
    for (const c of cobrancas) {
      const st = statusCobranca(c, hoje);
      if (st !== "pendente" && st !== "vencido") continue;
      const e = map.get(c.clienteId) ?? { ...ZERO };
      e.total += c.valor;
      e.qtd += 1;
      if (st === "vencido") {
        e.vencido += c.valor;
        e.qtdVencidas += 1;
      }
      map.set(c.clienteId, e);
    }
    return map;
  }, [cobrancas, hoje]);

  const lista = useMemo(() => {
    const s = busca.trim().toLowerCase();
    const base = s ? clientes.filter((c) => c.nome.toLowerCase().includes(s)) : clientes;
    // Quem deve aparece primeiro, e dentro disso o maior saldo — é o que se
    // procura ao abrir a lista no celular.
    return [...base].sort((a, b) => {
      const ea = porCliente.get(a.id)?.total ?? 0;
      const eb = porCliente.get(b.id)?.total ?? 0;
      if (ea !== eb) return eb - ea;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
  }, [clientes, busca, porCliente]);

  return {
    clientes,
    cobrancas,
    lista,
    emAbertoDe: (id: string): EmAberto => porCliente.get(id) ?? ZERO,
    carregando: isLoading,
    erro: error,
  };
}

// As cobranças de um cliente, agrupadas como o detalhe mostra: primeiro o que
// ele ainda deve, depois o que já foi recebido.
export function cobrancasDoCliente(cobrancas: Cobranca[], clienteId: string, hoje: string) {
  const dele = cobrancas
    .filter((c) => c.clienteId === clienteId)
    .sort((a, b) => b.vencimento.localeCompare(a.vencimento));
  return {
    emAberto: dele.filter((c) => {
      const st = statusCobranca(c, hoje);
      return st === "pendente" || st === "vencido";
    }),
    recebidas: dele.filter((c) => c.status === "pago"),
    canceladas: dele.filter((c) => c.status === "cancelado"),
  };
}
