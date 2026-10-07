import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Trash2, Barcode, Copy, Check } from "lucide-react";
import type { Boleto } from "@/lib/queries";

// Editor de uma lista de códigos de pagamento (boleto/PIX).
// `carne` mostra rótulo "mês N" (cada código vai para um mês, na ordem).
export function BoletosEditor({
  value, onChange, carne,
}: {
  value: Boleto[];
  onChange: (v: Boleto[]) => void;
  carne?: boolean;
}) {
  const add = () => onChange([...value, { tipo: "boleto", codigo: "" }]);
  const upd = (i: number, patch: Partial<Boleto>) =>
    onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const rm = (i: number) => onChange(value.filter((_, j) => j !== i));

  return (
    <div className="grid gap-2">
      {value.map((b, i) => (
        <div key={i} className="flex items-center gap-2">
          {carne && <span className="text-[11px] text-muted-foreground w-11 shrink-0">mês {i + 1}</span>}
          <Select value={b.tipo} onValueChange={(v) => upd(i, { tipo: v as Boleto["tipo"] })}>
            <SelectTrigger className="h-9 w-[94px] shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="boleto">Boleto</SelectItem>
              <SelectItem value="pix">PIX</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="h-9 flex-1 font-mono text-xs"
            value={b.codigo}
            onChange={(e) => upd(i, { codigo: e.target.value })}
            placeholder={b.tipo === "boleto" ? "Linha digitável / código de barras" : "PIX copia-e-cola / chave"}
          />
          <Button type="button" variant="ghost" size="sm"
            className="h-9 w-9 p-0 text-destructive hover:text-destructive shrink-0" onClick={() => rm(i)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="h-8 w-fit" onClick={add}>
        <Plus className="h-3.5 w-3.5 mr-1" />Adicionar {carne ? "mês" : "boleto/PIX"}
      </Button>
    </div>
  );
}

// Célula de exibição: um chip com a contagem que abre os códigos com botão de copiar.
export function BoletosCell({ boletos }: { boletos: Boleto[] }) {
  const [copied, setCopied] = useState<number | null>(null);
  if (!boletos.length) return <span className="text-muted-foreground text-[11px]">—</span>;

  const copy = async (codigo: string, i: number) => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard indisponível */
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 text-[11px] rounded-md bg-secondary px-2 py-1 hover:bg-secondary/70 transition-colors">
          <Barcode className="h-3 w-3" />
          {boletos.length} {boletos.length === 1 ? "código" : "códigos"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-2">
        <p className="text-xs font-medium px-1 pb-1.5">Códigos de pagamento</p>
        <div className="grid gap-1.5">
          {boletos.map((b, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
              <Badge variant="outline" className="text-[10px] uppercase shrink-0">{b.tipo}</Badge>
              <span className="flex-1 font-mono text-[11px] truncate" title={b.codigo}>{b.codigo || "—"}</span>
              <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 shrink-0"
                onClick={() => copy(b.codigo, i)} title="Copiar código" disabled={!b.codigo}>
                {copied === i ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
