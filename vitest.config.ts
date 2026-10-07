import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Testes das funções puras de domínio (saldo, conciliação, datas, parser).
// Ambiente node: sem DOM, rápido. `@/` resolve via tsconfig paths.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
