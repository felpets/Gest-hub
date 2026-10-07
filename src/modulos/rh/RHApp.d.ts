// Tipos do módulo RH (o código segue em JSX, preservado do CRM RH).
import type { ComponentType, ReactNode } from "react";

export type UsuarioRH = {
  email?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

export type RHAppProps = {
  usuario: UsuarioRH;
  onSair?: () => void;
  // Modo embutido no shell unificado: módulo/sub-aba vindos da rota.
  embutido?: boolean;
  abaExterna?: string;
  subExterna?: string;
  onNavegar?: (modulo: string, sub: string) => void;
  abasSlot?: ReactNode;
  // Empresas do RH vindas do cadastro (módulo RH), no lugar da lista fixa.
  empresas?: string[];
};

declare const RHApp: ComponentType<RHAppProps>;
export default RHApp;
