import { Landmark, ChevronsUpDown, Check } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEmpresa } from "@/lib/empresa";
import { useContasBancarias } from "@/lib/queries";

// Seletor de conta bancária. A escolha é do sistema inteiro (a queryKey das
// movimentações inclui a conta, então saldo, gráficos e listas refazem sozinhos)
// — trocar aqui é o mesmo que trocar na barra de cima.
//
// Aparece só quando a empresa tem 2+ contas ativas: com uma conta só, o filtro
// não escolheria nada.
//
// Duas roupas, o mesmo botão:
//   "topo"    → o chip da barra superior; ele não cabe em tela pequena.
//   "acoes"   → ao lado dos filtros de uma tela (é o do Dashboard), na altura dos
//               outros botões e visível em qualquer tamanho de tela.
//   "celular" → a pastilha do desenho de app, na mesma linha dos filtros de período.
export function SeletorConta({ variant = "topo" }: { variant?: "topo" | "acoes" | "celular" }) {
  const { contaId, trocarConta } = useEmpresa();
  const { data: contas = [] } = useContasBancarias();
  const ativas = contas.filter((c) => c.ativo);
  if (ativas.length < 2) return null;
  const ativa = ativas.find((c) => c.id === contaId);
  const label = contaId ? (ativa?.nome ?? "Conta") : "Todas as contas";

  const cls = variant === "topo"
    ? "hidden lg:flex items-center gap-2 h-9 px-3 rounded-lg bg-secondary/60 hover:bg-secondary text-sm font-medium transition-colors"
    : variant === "celular"
      ? "inline-flex shrink-0 items-center gap-1.5 h-8 px-3 rounded-full border border-border/70 bg-card text-[12px] font-semibold"
      : "inline-flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background hover:bg-secondary text-sm font-medium transition-colors";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cls} title={variant === "acoes" ? "Ver os números de uma conta ou de todas" : "Conta bancária ativa"}>
        <Landmark className="h-4 w-4 text-muted-foreground" />
        <span className="max-w-[140px] truncate">{label}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {variant === "acoes" && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              De qual conta são os números
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => trocarConta(null)} className="gap-2">
          <Check className={`h-4 w-4 ${contaId === null ? "opacity-100" : "opacity-0"}`} />
          <span className="truncate">Todas as contas</span>
        </DropdownMenuItem>
        {ativas.map((c) => (
          <DropdownMenuItem key={c.id} onClick={() => trocarConta(c.id)} className="gap-2">
            <Check className={`h-4 w-4 ${c.id === contaId ? "opacity-100" : "opacity-0"}`} />
            <span className="truncate">{c.nome}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
