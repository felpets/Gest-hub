// Regras puras de recorrências (sem I/O) — testáveis.
import type { RecorrenteInput } from "@/lib/queries";

const clampDia31 = (n: number) => Math.min(31, Math.max(1, Math.round(n)));

export type RegraDatas = Pick<RecorrenteInput, "dia" | "modoDia" | "diaUtilN" | "dia2" | "inicio" | "fim">;

// A regra de DATAS mudou? (dia/modo/período) — se sim, os previstos em aberto
// precisam ser regerados; senão basta atualizar os campos em lugar. Compara
// só ano/mês de início e fim (o dia dessas datas é sempre 01) e o dia já
// normalizado a 1..31.
export function regraDatasMudou(a: RegraDatas, b: RegraDatas): boolean {
  return (
    clampDia31(a.dia) !== clampDia31(b.dia) ||
    a.modoDia !== b.modoDia ||
    (a.diaUtilN ?? null) !== (b.diaUtilN ?? null) ||
    (a.dia2 ?? null) !== (b.dia2 ?? null) ||
    a.inicio.slice(0, 7) !== b.inicio.slice(0, 7) ||
    (a.fim?.slice(0, 7) ?? null) !== (b.fim?.slice(0, 7) ?? null)
  );
}
