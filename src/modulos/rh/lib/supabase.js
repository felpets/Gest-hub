// Cliente de dados do módulo RH.
//
// Protótipo (padrão): banco SIMULADO em memória, com dados fictícios, no
// namespace "rh.*" — nada sai do navegador e o Supabase real não é tocado.
//
// Modo real (VITE_DATA_MODE=real): o RH usa o MESMO projeto e o mesmo login do
// Financeiro. As tabelas têm o prefixo rh_ e o banco aplica a empresa e o perfil
// de cada acesso (tabela rh_acessos). Ver supabase/42_rh_modulo.sql.
import { supabase as principal, isMock } from "@/lib/supabase";
import { createMockClient } from "@/lib/mock";
import { clienteRH } from "./cliente-rh";

export const supabase = isMock ? createMockClient("rh") : clienteRH(principal);
