// Seletor do modo de vencimento — dia fixo / último dia do mês / N-ésimo dia
// útil / quinzenal — compartilhado por Contas a Pagar (regra + importação) e
// Recorrentes.
//
// "Último dia do mês" não é um modo novo no banco: é o modo fixo com dia 31.
// Como a data é montada por isoDiaDoMes (o dia que não existe naquele mês cai
// no último dia dele), dia 31 já significa "último dia" em todo mês — fevereiro
// inclusive. Aqui a opção só dá nome a isso, para quem não quer adivinhar.
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { clampDia } from "@/lib/format";
import type { ModoDia } from "@/lib/queries";

export type ModoPatch = Partial<{ modoDia: ModoDia; dia: number; diaUtilN: number; dia2: number }>;

export const DIA_ULTIMO = 31;
const ehUltimoDia = (modoDia: ModoDia, dia: number) => modoDia === "fixo" && dia >= DIA_ULTIMO;

// Texto curto do modo, para listagens ("dia 5" / "5º dia útil" / "dias 5 e 20").
export function descreveVencimento(r: { modoDia: ModoDia; dia: number; diaUtilN: number | null; dia2: number | null }): string {
  if (r.modoDia === "dia_util") return `${r.diaUtilN ?? 1}º dia útil`;
  if (r.modoDia === "quinzenal") return `dias ${r.dia} e ${r.dia2 ?? 28}`;
  if (ehUltimoDia(r.modoDia, r.dia)) return "último dia do mês";
  return `dia ${r.dia}`;
}

export function ModoFields({
  modoDia, dia, diaUtilN, dia2, onChange, compact,
}: {
  modoDia: ModoDia; dia: number; diaUtilN: number; dia2: number;
  onChange: (patch: ModoPatch) => void;
  compact?: boolean;
}) {
  const cls = compact ? "h-8" : "h-9";
  const ultimo = ehUltimoDia(modoDia, dia);
  return (
    <div className={compact ? "flex items-center gap-1.5" : "grid gap-3"}>
      <Select
        value={ultimo ? "ultimo_dia" : modoDia}
        onValueChange={(v) => {
          if (v === "ultimo_dia") return onChange({ modoDia: "fixo", dia: DIA_ULTIMO });
          // Saindo de "último dia" para dia fixo, o 31 volta a um dia comum.
          if (v === "fixo") return onChange({ modoDia: "fixo", dia: ultimo ? 5 : dia });
          onChange({ modoDia: v as ModoDia });
        }}
      >
        <SelectTrigger className={`${cls} ${compact ? "w-[150px]" : ""}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="fixo">Dia fixo</SelectItem>
          <SelectItem value="ultimo_dia">Último dia do mês</SelectItem>
          <SelectItem value="dia_util">Dia útil (folha)</SelectItem>
          <SelectItem value="quinzenal">Quinzenal (2x/mês)</SelectItem>
        </SelectContent>
      </Select>
      {modoDia === "fixo" && !ultimo && (
        <Input type="number" min={1} max={31} value={dia} title="Dia do mês (1–31). Em mês mais curto, cai no último dia dele."
          onChange={(e) => onChange({ dia: clampDia(e.target.valueAsNumber) })}
          className={`${cls} ${compact ? "w-16" : ""}`} />
      )}
      {modoDia === "dia_util" && (
        <Input type="number" min={1} max={27} value={diaUtilN} title="N-ésimo dia útil (ex.: 5 = salário). Sábado conta na contagem."
          onChange={(e) => onChange({ diaUtilN: clampDia(e.target.valueAsNumber, 27) })}
          className={`${cls} ${compact ? "w-16" : ""}`} />
      )}
      {modoDia === "quinzenal" && (
        <div className="flex items-center gap-1.5">
          <Input type="number" min={1} max={31} value={dia} title="1º vencimento"
            onChange={(e) => onChange({ dia: clampDia(e.target.valueAsNumber) })}
            className={`${cls} w-16`} />
          <Input type="number" min={1} max={31} value={dia2} title="2º vencimento"
            onChange={(e) => onChange({ dia2: clampDia(e.target.valueAsNumber) })}
            className={`${cls} w-16`} />
        </div>
      )}
    </div>
  );
}
