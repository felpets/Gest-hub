import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, GraduationCap, UserMinus, UserPlus, Users, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { brl } from "@/lib/format";
import { useAcessoRH } from "@/modulos/rh/acesso";
import { supabase as rh } from "@/modulos/rh/lib/supabase";

type Func = {
  empresa?: string;
  status?: string;
  tipoContrato?: string;
  salarioBase?: number;
  dataAdmissao?: string;
  rescisao?: { dataDesligamento?: string; pago?: boolean } | null;
  treinamento?: { encerramento?: { fechado?: boolean } } | null;
};

// Resumo de pessoas na visão da Gestão — as MESMAS definições dos KPIs do
// Painel do RH (ativos, em treinamento, admissões/desligamentos do mês e a
// folha pelos salários cadastrados). Só leitura, na empresa ativa do topo.
//
// O cálculo está separado do desenho porque as duas telas do Início leem daqui:
// a de computador (este arquivo) e a de celular (inicio-celular.tsx).
export function useKpisPessoas() {
  const { empresa } = useAcessoRH({ seguirFinanceiro: true });
  const { data: funcs = [] } = useQuery({
    queryKey: ["rh-resumo", empresa],
    queryFn: async () => {
      const { data, error } = await rh.from("funcionarios").select("data");
      if (error) throw error;
      const lista = ((data ?? []) as { data: Func }[]).map((r) => r.data);
      return empresa ? lista.filter((f) => (f.empresa ?? "") === empresa) : lista;
    },
  });

  const hoje = new Date();
  const comp = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const ativos = funcs.filter((f) => f.status !== "Desligado");
  const emTreino = ativos.filter((f) => f.tipoContrato === "Treinamento" && !f.treinamento?.encerramento?.fechado).length;
  const admissoes = funcs.filter((f) => (f.dataAdmissao ?? "").startsWith(comp)).length;
  const desligamentos = funcs.filter((f) => (f.rescisao?.dataDesligamento ?? "").startsWith(comp)).length;
  const folha = ativos.reduce((s, f) => s + (Number(f.salarioBase) || 0), 0);
  const rescPend = funcs.filter((f) => f.rescisao && !f.rescisao.pago).length;

  const kpis = [
    { label: "Funcionários ativos", valor: String(ativos.length), icon: Users },
    { label: "Em treinamento", valor: String(emTreino), icon: GraduationCap },
    { label: "Admissões no mês", valor: String(admissoes), icon: UserPlus },
    { label: "Desligamentos no mês", valor: String(desligamentos), meta: rescPend ? `${rescPend} rescisão(ões) a pagar` : undefined, icon: UserMinus },
    { label: "Folha (salários cadastrados)", valor: brl(folha), icon: Wallet },
  ];

  return { kpis, empresa, comp };
}

export function ResumoPessoas() {
  const { kpis, empresa, comp } = useKpisPessoas();

  return (
    <Card className="card-elevated border-border/70 p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h3 className="font-display text-base font-semibold">Pessoas</h3>
          <p className="text-xs text-muted-foreground">
            Do módulo RH{empresa ? ` · ${empresa}` : " · todas as empresas"} · competência {comp.split("-").reverse().join("/")}
          </p>
        </div>
        <Link to="/" search={{ aba: "pessoas" }} className="text-xs text-primary font-medium inline-flex items-center gap-1 hover:underline">
          Indicadores e relatórios de RH <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl bg-secondary/50 px-4 py-3">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <k.icon className="h-3.5 w-3.5" /> {k.label}
            </div>
            <p className="mt-1 font-numeric text-xl font-semibold tabular-nums">{k.valor}</p>
            {k.meta && <p className="text-[11px] text-destructive mt-0.5">{k.meta}</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}
