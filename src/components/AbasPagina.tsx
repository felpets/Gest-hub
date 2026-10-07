import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AbaVisivel = { id: string; titulo: string; icon: LucideIcon; badge?: number };

// Barra de abas das telas consolidadas (fica no cabeçalho da página, sob o
// título). A aba ativa vive na URL (?aba=), então dá para compartilhar o link.
export function AbasPagina({
  abas,
  ativa,
  onTrocar,
}: {
  abas: AbaVisivel[];
  ativa: string;
  onTrocar: (id: string) => void;
}) {
  if (abas.length <= 1) return null;
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {abas.map((a) => {
        const on = a.id === ativa;
        return (
          <button
            key={a.id}
            role="tab"
            aria-selected={on}
            onClick={() => onTrocar(a.id)}
            className={cn(
              "group relative inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap px-3 pb-3 pt-1.5 text-sm font-medium transition-colors",
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <a.icon className={cn("h-4 w-4 stroke-[1.7]", on ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
            {a.titulo}
            {!!a.badge && a.badge > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular-nums">
                {a.badge}
              </span>
            )}
            <span className={cn("absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-colors", on ? "bg-primary" : "bg-transparent")} />
          </button>
        );
      })}
    </div>
  );
}
