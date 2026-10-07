import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

// Chave do localStorage + nome exposto pro script inline do <head> (no-flash).
export const THEME_STORAGE_KEY = "zaytan.theme";

// Estado inicial: reflete a classe já aplicada pelo script inline do __root
// (que roda antes da hidratação). No servidor não há document → assume "light".
function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

type ThemeContextValue = {
  theme: Theme;
  isDark: boolean;
  toggle: () => void;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  const apply = useCallback((t: Theme) => {
    setThemeState(t);
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", t === "dark");
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    }
  }, []);

  const toggle = useCallback(
    () => apply(theme === "dark" ? "light" : "dark"),
    [theme, apply]
  );

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === "dark", toggle, setTheme: apply }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de <ThemeProvider>");
  return ctx;
}

// ─── Cores dos gráficos (recharts) ──────────────────────────────────────────
// O recharts grava fill/stroke como atributo SVG, que não resolve var(--...),
// então as cores que precisam acompanhar o tema vêm daqui (hex por tema). As
// cores de série (laranja/verde/vermelho) ficam nos próprios gráficos — já
// contrastam nos dois fundos.
export type ChartColors = {
  axis: string;    // linhas/labels dos eixos
  grid: string;    // grade
  label: string;   // rótulos de valor / ticks
  ink: string;     // séries "tinta" (linha de resultado, fatia escura da pizza)
  tooltip: { background: string; border: string; color: string };
};

export function chartColors(isDark: boolean): ChartColors {
  return isDark
    ? {
        axis: "#8a8a8a",
        grid: "rgba(255,255,255,0.08)",
        label: "#e4e4e7",
        ink: "#e4e4e7",
        tooltip: { background: "#201f1f", border: "1px solid rgba(255,255,255,0.14)", color: "#e4e4e7" },
      }
    : {
        axis: "#9b9b9b",
        grid: "#F1F1F1",
        label: "#27272a",
        ink: "#0D0C0C",
        tooltip: { background: "#ffffff", border: "1px solid #E5E5E5", color: "#0D0C0C" },
      };
}

export function useChartColors(): ChartColors {
  return chartColors(useTheme().isDark);
}
