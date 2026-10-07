import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, LabelList } from "recharts";
import { brl, fmtK } from "@/lib/format";
import { useChartColors } from "@/lib/theme";
import { rotuloCategoria, type FatiaCategoria } from "@/modulos/gestao/dashboard/categorias";

// Entradas / saídas por categoria, em barra deitada — a mesma leitura das
// Análises financeiras, em tamanho de dashboard: as maiores primeiro, com o
// valor exato no fim da barra. O caminho "Pai / Filho" fica inteiro (é ele que
// diz do que se trata); o resto das categorias entra em "outras".

export function GraficoCategorias({ dados, cor, altura, selecionada, onSelecionar }: {
  dados: FatiaCategoria[];
  cor: string;
  altura?: number;
  // Clicar numa barra filtra a lista de baixo; clicar de novo desfaz.
  selecionada?: string | null;
  onSelecionar?: (categoria: string) => void;
}) {
  const ct = useChartColors();
  const tick = { fill: ct.label, fontSize: 11, fontWeight: 500 };
  // Uma faixa por barra: com altura fixa, oito categorias viravam rótulos
  // sobrepostos.
  const alto = altura ?? Math.max(150, dados.length * 30 + 34);
  return (
    <div style={{ height: alto }}>
      <ResponsiveContainer>
        <BarChart data={dados} layout="vertical" margin={{ left: 0, right: 84, top: 4, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid stroke={ct.grid} horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} tick={tick} tickFormatter={(v) => fmtK(v)} />
          <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={150} tick={tick} interval={0}
            tickFormatter={(v: string) => rotuloCategoria(v, 24)} />
          <Tooltip cursor={{ fill: "rgba(127,127,127,0.08)" }} formatter={(v: number) => [brl(v), "Total"]}
            contentStyle={{ ...ct.tooltip, borderRadius: 12, fontSize: 12 }} />
          <Bar dataKey="value" fill={cor} radius={[0, 5, 5, 0]} maxBarSize={18}
            cursor={onSelecionar ? "pointer" : undefined}
            onClick={(e: { payload?: FatiaCategoria }) => {
              const nome = e?.payload?.name ?? (e as unknown as FatiaCategoria)?.name;
              if (nome) onSelecionar?.(nome);
            }}>
            {dados.map((d) => (
              <Cell key={d.name} fill={cor}
                fillOpacity={!selecionada || selecionada === d.name ? 1 : 0.35} />
            ))}
            <LabelList dataKey="value" position="right" offset={6} formatter={(v: number) => brl(v)}
              fill={ct.ink} fontSize={11} fontWeight={600} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
