// Barra de filtros de movimentações (Movimentações e Relatórios).
// Quatro controles SEPARADOS — período (chips + range picker), categorias
// (multi-seleção hierárquica com busca), faixa de valor e busca por descrição —
// mais a linha de filtros ativos (badges removíveis + limpar + contador).
// Estado 100% controlado pelo pai; a lógica pura vive em lib/filtros-movimentacoes.
import { useMemo, useState, type ReactNode } from "react";
import type { DateRange } from "react-day-picker";
import { ptBR } from "react-day-picker/locale";
import { Search, Tags, X, Calendar as CalendarIcon, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { brl, norm } from "@/lib/format";
import { pad, ddMM } from "@/lib/datas";
import type { Conta, Movimentacao } from "@/lib/queries";
import {
  type Filtros, FILTROS_VAZIO, PRESETS, SEM_CATEGORIA,
  rangePreset, mesmoRange, filtrosAtivos, resumoPeriodo, opcoesDeCategoria,
} from "@/lib/filtros-movimentacoes";

// Date ↔ ISO pelas PARTES no fuso local (nunca new Date("YYYY-MM-DD"), que é UTC
// e mudaria o dia no Brasil). Mesmo cuidado documentado em lib/datas.ts.
const isoToDate = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const dateToISO = (dt: Date): string =>
  `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

// Rótulo curto do range p/ o botão (dd/MM quando as pontas são do mesmo ano).
const rotuloCurto = (f: Filtros): string => {
  if (f.de && f.ate) {
    const mesmoAno = f.de.slice(0, 4) === f.ate.slice(0, 4);
    return mesmoAno ? `${ddMM(f.de)} – ${ddMM(f.ate)}` : resumoPeriodo(f);
  }
  if (f.de) return `desde ${ddMM(f.de)}`;
  if (f.ate) return `até ${ddMM(f.ate)}`;
  return "Personalizado";
};

// Rótulo de uma categoria selecionada: "Filho" p/ "Pai / Filho"; sentinel → texto.
const rotuloCat = (v: string): string => {
  if (v === SEM_CATEGORIA) return "Sem categoria";
  const i = v.indexOf(" / ");
  return i >= 0 ? v.slice(i + 3) : v;
};

const rotuloValor = (min: number | null, max: number | null): string => {
  if (min != null && max != null) return `${brl(min)} – ${brl(max)}`;
  if (min != null) return `≥ ${brl(min)}`;
  return `≤ ${brl(max!)}`;
};

function BadgeFiltro({ children, onRemove, title }: { children: ReactNode; onRemove: () => void; title?: string }) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1 font-normal" title={title}>
      {children}
      <button onClick={onRemove} className="rounded-sm hover:bg-foreground/10 p-0.5" aria-label="Remover filtro">
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

export function FiltrosMovimentacoes({
  value, onChange, planoContas, movimentos, visiveis, className,
}: {
  value: Filtros;
  onChange: (f: Filtros) => void;
  planoContas: Conta[];
  movimentos: Movimentacao[]; // lista SEM filtro: opções de categoria + total do contador
  visiveis: number; // nº de linhas visíveis após o filtro (contador "N de M")
  className?: string;
}) {
  const [calOpen, setCalOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [valOpen, setValOpen] = useState(false);

  const set = (patch: Partial<Filtros>) => onChange({ ...value, ...patch });

  // Opções de categoria: plano de contas (hierárquico) ∪ soltas do extrato.
  // A lista vive em lib/filtros-movimentacoes — a folha de filtros do celular
  // usa a mesma.
  const { grupos, temSemCategoria } = useMemo(
    () => opcoesDeCategoria(planoContas, movimentos),
    [planoContas, movimentos],
  );

  const nCats = value.cats?.size ?? 0;
  const isOn = (v: string) => value.cats?.has(v) ?? false;
  const toggleCat = (v: string) => {
    const n = new Set(value.cats ?? []);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    set({ cats: n.size === 0 ? null : n }); // Set vazio normalizado p/ null
  };

  const temPeriodo = value.de !== null || value.ate !== null;
  const temValor = value.valorMin !== null || value.valorMax !== null;
  const personalizadoAtivo =
    temPeriodo && !PRESETS.some((p) => mesmoRange(value, rangePreset(p.id)));

  const range: DateRange | undefined = temPeriodo
    ? { from: value.de ? isoToDate(value.de) : undefined, to: value.ate ? isoToDate(value.ate) : undefined }
    : undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Linha 1: os quatro controles */}
      <div className="flex flex-wrap items-center gap-2">
        {/* (a) Período: chips de preset + personalizado */}
        <div className="flex items-center gap-1 text-xs">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => set(rangePreset(p.id))}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                mesmoRange(value, rangePreset(p.id))
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-secondary/60"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("h-9 text-xs font-medium", personalizadoAtivo && "border-foreground")}>
              <CalendarIcon className="h-4 w-4 mr-1.5 text-muted-foreground" />
              {personalizadoAtivo ? rotuloCurto(value) : "Personalizado"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              numberOfMonths={2}
              locale={ptBR}
              defaultMonth={value.de ? isoToDate(value.de) : undefined}
              selected={range}
              onSelect={(r) => {
                set({ de: r?.from ? dateToISO(r.from) : null, ate: r?.to ? dateToISO(r.to) : null });
                if (r?.from && r?.to && r.from.getTime() !== r.to.getTime()) setCalOpen(false);
              }}
            />
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">{resumoPeriodo(value)}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => set({ de: null, ate: null })}>
                Limpar
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* (b) Categorias: multi-seleção hierárquica com busca */}
        <Popover open={catOpen} onOpenChange={setCatOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("h-9 text-xs font-medium", nCats > 0 && "border-foreground")}>
              <Tags className="h-4 w-4 mr-1.5 text-muted-foreground" />
              Categorias
              {nCats > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 font-numeric tabular-nums">{nCats}</Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0" align="start">
            <Command filter={(v, s) => (norm(v).includes(norm(s)) ? 1 : 0)}>
              <CommandInput placeholder="Buscar categoria..." />
              <CommandList>
                <CommandEmpty>Nenhuma categoria.</CommandEmpty>
                {temSemCategoria && (
                  <CommandGroup>
                    <CommandItem value="sem categoria" onSelect={() => toggleCat(SEM_CATEGORIA)}>
                      <Checkbox checked={isOn(SEM_CATEGORIA)} className="pointer-events-none mr-2" />
                      Sem categoria
                    </CommandItem>
                  </CommandGroup>
                )}
                {grupos.map((g) => (
                  <CommandGroup key={g.titulo} heading={g.titulo}>
                    {g.opcoes.map((o) => (
                      <CommandItem
                        key={o.value}
                        value={`${g.titulo} ${o.label}`}
                        onSelect={() => toggleCat(o.value)}
                        className={o.filho ? "pl-7" : "font-medium"}
                      >
                        <Checkbox checked={isOn(o.value)} className="pointer-events-none mr-2" />
                        {o.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <span className="text-[11px] text-muted-foreground">Categoria-pai inclui as subcategorias</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={nCats === 0} onClick={() => set({ cats: null })}>
                Limpar
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* (c) Faixa de valor */}
        <Popover open={valOpen} onOpenChange={setValOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("h-9 text-xs font-medium", temValor && "border-foreground")}>
              <SlidersHorizontal className="h-4 w-4 mr-1.5 text-muted-foreground" />
              {temValor ? rotuloValor(value.valorMin, value.valorMax) : "Valor"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="start">
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label className="text-xs">De (R$)</Label>
                <Input
                  type="number" min={0} step="0.01" inputMode="decimal" placeholder="0,00"
                  className="h-9"
                  value={value.valorMin ?? ""}
                  onChange={(e) => set({ valorMin: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : null })}
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Até (R$)</Label>
                <Input
                  type="number" min={0} step="0.01" inputMode="decimal" placeholder="—"
                  className="h-9"
                  value={value.valorMax ?? ""}
                  onChange={(e) => set({ valorMax: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : null })}
                />
              </div>
            </div>
            <div className="flex justify-end mt-2">
              <Button variant="ghost" size="sm" className="h-7 text-xs" disabled={!temValor}
                onClick={() => set({ valorMin: null, valorMax: null })}>
                Limpar
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* (d) Busca por nome/descrição */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por descrição..."
            className="pl-8 h-9"
            value={value.busca}
            onChange={(e) => set({ busca: e.target.value })}
          />
        </div>
      </div>

      {/* Linha 2: filtros ativos */}
      {filtrosAtivos(value) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {temPeriodo && (
            <BadgeFiltro onRemove={() => set({ de: null, ate: null })}>{resumoPeriodo(value)}</BadgeFiltro>
          )}
          {[...(value.cats ?? [])].map((c) => (
            <BadgeFiltro key={c} title={c === SEM_CATEGORIA ? undefined : c} onRemove={() => toggleCat(c)}>
              {rotuloCat(c)}
            </BadgeFiltro>
          ))}
          {temValor && (
            <BadgeFiltro onRemove={() => set({ valorMin: null, valorMax: null })}>
              {rotuloValor(value.valorMin, value.valorMax)}
            </BadgeFiltro>
          )}
          {value.busca.trim() !== "" && (
            <BadgeFiltro onRemove={() => set({ busca: "" })}>“{value.busca.trim()}”</BadgeFiltro>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange(FILTROS_VAZIO)}>
            <X className="h-3.5 w-3.5 mr-1" />
            Limpar filtros
          </Button>
          <span className="ml-auto text-xs text-muted-foreground font-numeric tabular-nums">
            {visiveis} de {movimentos.length} transações
          </span>
        </div>
      )}
    </div>
  );
}
