import { lazy, Suspense, useCallback, useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useEmpresa } from "@/lib/empresa";
import { destinoRH } from "@/lib/navegacao";
import { useAcessoRH } from "@/modulos/rh/acesso";

// O RH (≈11 mil linhas, preservadas do CRM RH) só é baixado quando alguém abre
// uma tela de RH — as telas do Financeiro não pagam esse peso.
const RHApp = lazy(() => import("@/modulos/rh/RHApp"));

// Monta o RH dentro do shell unificado, no módulo/sub-aba pedidos pela rota.
// `seguirFinanceiro`: nas telas da Gestão, o RH usa a empresa ativa do seletor do Financeiro.
export function ModuloRH({ modulo, sub, abasSlot, seguirFinanceiro = false }: { modulo: string; sub: string; abasSlot?: ReactNode; seguirFinanceiro?: boolean }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const acesso = useAcessoRH({ seguirFinanceiro });
  const { empresasRH } = useEmpresa();

  // Mesmo formato de usuário que o CRM RH recebia do Supabase Auth; perfil e
  // empresa agora vêm de rh_acessos (o banco aplica a mesma regra).
  const usuario = useMemo(
    () => ({
      email: user?.email,
      user_metadata: { nome: acesso.nome },
      app_metadata: { perfil: acesso.perfil, empresa: acesso.empresa },
    }),
    [user?.email, acesso.nome, acesso.perfil, acesso.empresa]
  );

  const onNavegar = useCallback(
    (m: string, s: string) => {
      const d = destinoRH(m, s);
      navigate({ to: d.to, search: d.search ?? {} });
    },
    [navigate]
  );

  const sair = useCallback(async () => {
    await signOut();
    navigate({ to: "/login" });
  }, [signOut, navigate]);

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Abrindo o RH…
        </div>
      }
    >
      <RHApp embutido usuario={usuario} onSair={sair} abaExterna={modulo} subExterna={sub} onNavegar={onNavegar} abasSlot={abasSlot} empresas={empresasRH} />
    </Suspense>
  );
}
