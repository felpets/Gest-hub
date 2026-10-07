import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  mesAnterior, periodoDoMes, periodoPersonalizado, ymDe,
  type ModoPeriodo, type Periodo,
} from "@/lib/periodo";

// Um filtro só para o Dashboard inteiro. Trocar aqui muda saldo, entradas,
// saídas, resultado, gráfico, detalhamentos, projeções, despesas por categoria
// e os números do RH — nada no dashboard tem período próprio.
// As quatro opções e o que cada uma faz com o período: a tela de celular
// (inicio-celular.tsx) desenha as mesmas em pastilhas, e chama a mesma função —
// assim "Mês anterior" quer dizer a mesma coisa nas duas telas.
export const OPCOES_PERIODO: { modo: ModoPeriodo; label: string }[] = [
  { modo: "mes_atual", label: "Mês atual" },
  { modo: "mes_anterior", label: "Mês anterior" },
  { modo: "mes", label: "Escolher mês" },
  { modo: "personalizado", label: "Período" },
];

export function aplicarModoPeriodo(modo: ModoPeriodo, periodo: Periodo, hoje: string): Periodo {
  if (modo === "mes_atual") return periodoDoMes(ymDe(hoje), "mes_atual");
  if (modo === "mes_anterior") return periodoDoMes(mesAnterior(ymDe(hoje)), "mes_anterior");
  if (modo === "mes") return periodoDoMes(periodo.mes || ymDe(hoje), "mes");
  return periodoPersonalizado(periodo.de, periodo.ate);
}

export function SeletorPeriodo({
  periodo, hoje, onChange,
}: {
  periodo: Periodo;
  hoje: string;
  onChange: (p: Periodo) => void;
}) {
  const escolher = (modo: ModoPeriodo) => onChange(aplicarModoPeriodo(modo, periodo, hoje));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Período do dashboard" className="inline-flex rounded-lg border border-border/70 p-0.5">
        {OPCOES_PERIODO.map((o) => (
          <button
            key={o.modo}
            role="tab"
            aria-selected={periodo.modo === o.modo}
            onClick={() => escolher(o.modo)}
            className={cn(
              "h-8 cursor-pointer rounded-md px-2.5 text-xs font-medium transition-colors",
              periodo.modo === o.modo ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>

      {periodo.modo === "mes" && (
        <Input
          type="month"
          aria-label="Mês do dashboard"
          className="h-9 w-[150px]"
          value={periodo.mes || ymDe(hoje)}
          onChange={(e) => e.target.value && onChange(periodoDoMes(e.target.value, "mes"))}
        />
      )}

      {periodo.modo === "personalizado" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date" aria-label="Início do período" className="h-9 w-[150px]"
            value={periodo.de}
            onChange={(e) => e.target.value && onChange(periodoPersonalizado(e.target.value, periodo.ate))}
          />
          <span className="text-sm text-muted-foreground">até</span>
          <Input
            type="date" aria-label="Fim do período" className="h-9 w-[150px]"
            value={periodo.ate}
            onChange={(e) => e.target.value && onChange(periodoPersonalizado(periodo.de, e.target.value))}
          />
        </div>
      )}
    </div>
  );
}
