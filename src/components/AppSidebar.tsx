import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDown, TrendingUp } from "lucide-react";
import { useEmpresa } from "@/lib/empresa";
import { podeAcessar, podeGerirUsuarios } from "@/lib/permissoes";
import { usePendentesCount } from "@/lib/queries";
import { usePixNaoVistos } from "@/lib/avisos-pix";
import { MENU, pilarDaRota, podeVerModuloRH, type ItemMenu, type Pilar } from "@/lib/navegacao";
import { useAcessoRH } from "@/modulos/rh/acesso";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const CHAVE_FECHADOS = "zaytan.menu.fechados";

function lerFechados(): Pilar[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_FECHADOS) ?? "[]") as Pilar[];
  } catch {
    return [];
  }
}

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { isMaster, papel, caps } = useEmpresa();
  const { perfil } = useAcessoRH();
  const { data: pendentesCount = 0 } = usePendentesCount();
  const pixNovos = usePixNaoVistos();
  const { state } = useSidebar();
  const recolhido = state === "collapsed";
  const pilarAtual = pilarDaRota(path);
  const [fechados, setFechados] = useState<Pilar[]>([]);
  useEffect(() => setFechados(lerFechados()), []);

  const alternar = (p: Pilar, aberto: boolean) => {
    setFechados((atual) => {
      const novo = aberto ? atual.filter((x) => x !== p) : [...new Set([...atual, p])];
      try {
        localStorage.setItem(CHAVE_FECHADOS, JSON.stringify(novo));
      } catch {
        /* preferência só desta sessão */
      }
      return novo;
    });
  };

  // Raízes de pilar ("/" e "/rh") só ficam ativas na própria página — senão o
  // "Painel do RH" acenderia junto com qualquer outra tela do RH.
  const RAIZES = new Set(["/", "/rh"]);
  const isActive = (u: string) => (RAIZES.has(u) ? path === u || path === u + "/" : path === u || path.startsWith(u + "/"));
  // Mesmas regras do guarda de rota (AppShell) + as telas de administração +
  // o perfil do RH (que limita módulos dentro do pilar RH).
  const visivel = (i: ItemMenu) => {
    if (i.especial === "master") return isMaster;
    if (i.especial === "gerir_usuarios") return podeGerirUsuarios(isMaster, papel);
    if (i.moduloRH && !podeVerModuloRH(perfil, i.moduloRH)) return false;
    return podeAcessar(caps, i.url);
  };

  // Número na bolinha do item. "pix" = lançamentos que chegaram de outra
  // pessoa e ainda não foram vistos; zera ao abrir a tela do Pix do dia.
  const contagem = (i: ItemMenu) =>
    i.badge === "pendentes" ? pendentesCount : i.badge === "pix" ? pixNovos : 0;

  const renderItem = (item: ItemMenu) => (
    <SidebarMenuItem key={item.url}>
      <SidebarMenuButton
        asChild
        isActive={isActive(item.url)}
        tooltip={item.titulo}
        className="h-9 rounded-lg data-[active=true]:bg-secondary data-[active=true]:text-foreground data-[active=true]:font-medium"
      >
        <Link to={item.url} className="flex items-center gap-3 px-3">
          <item.icon className="h-[18px] w-[18px] stroke-[1.6]" />
          <span className="text-sm">{item.titulo}</span>
          {contagem(item) > 0 ? (
            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular-nums">
              {contagem(item)}
            </span>
          ) : isActive(item.url) ? (
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
          ) : null}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="px-4 py-5 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-4">
        <Link to="/" className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
            <span className="font-display text-[13px] font-bold tracking-tight">FINANCE</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              HUB
            </span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-2 group-data-[collapsible=icon]:px-0">
        {MENU.map((grupo) => {
          const itens = grupo.itens.filter(visivel);
          if (itens.length === 0) return null;
          // Recolhido em ícones não existe "grupo fechado": todos os ícones aparecem.
          const aberto = recolhido || pilarAtual === grupo.pilar || !fechados.includes(grupo.pilar);
          return (
            <Collapsible key={grupo.pilar} open={aberto} onOpenChange={(v) => alternar(grupo.pilar, v)}>
              <SidebarGroup className="py-1">
                <SidebarGroupLabel asChild className="px-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80">
                  <CollapsibleTrigger className="flex w-full items-center justify-between hover:text-foreground">
                    <span className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${pilarAtual === grupo.pilar ? "bg-primary" : "bg-muted-foreground/40"}`} />
                      {grupo.titulo}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${aberto ? "" : "-rotate-90"}`} />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu className="gap-0.5">{itens.map(renderItem)}</SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
