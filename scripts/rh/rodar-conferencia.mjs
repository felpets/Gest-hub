// Roda a suíte de conferência de cálculos embutida no RHApp.jsx (componente ConferenciaCalculos)
// direto em Node, sem precisar abrir o app no navegador.
//
// Uso:  node scripts/rh/rodar-conferencia.mjs [caminho para src/modulos/rh/RHApp.jsx]
// (sem argumento, assume src/modulos/rh/RHApp.jsx relativo à raiz do repo)
//
// Como funciona: o RHApp.jsx é um único arquivo React (JSX) que o Node não consegue importar
// direto. Este script extrai só os trechos PUROS (sem JSX) de que os testes precisam — os
// helpers de cálculo do topo do arquivo, o parser da contabilidade, e o corpo da função
// ConferenciaCalculos (cortado antes do "return (" que monta a tela) — e roda esse pedaço
// isolado como um módulo Node comum.
//
// Os blocos são achados por ÂNCORA de texto (início/fim), não por número de linha — assim o
// script não quebra toda vez que alguém edita código ANTES desses trechos no arquivo. Se uma
// âncora sumir (função renomeada/removida), o erro abaixo aponta exatamente qual.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || path.join(aqui, "..", "..", "src", "modulos", "rh", "RHApp.jsx");
const linhas = fs.readFileSync(file, "utf8").split("\n");

function acharLinha(regex, apartirDe = 0) {
  for (let i = apartirDe; i < linhas.length; i++) if (regex.test(linhas[i])) return i;
  throw new Error(`Âncora não encontrada: ${regex} (procurando a partir da linha ${apartirDe + 1}). O RHApp.jsx mudou — ajuste as âncoras no topo de scripts/rodar-conferencia.mjs.`);
}
// Extrai da linha que bate com inicioRe até a linha ANTES da que bate com fimRe.
function bloco(inicioRe, fimRe, apartirDe = 0) {
  const i = acharLinha(inicioRe, apartirDe);
  const j = acharLinha(fimRe, i + 1);
  return { texto: linhas.slice(i, j).join("\n"), fimIndex: j };
}

// helpers base: soDigitos ... normalizarTexto/matchDepto/separarCargoDepto, e também os que ELES
// chamam mais abaixo — matchLista, inferirArea/areaDe, parseDataFlex/parseHoraFlex (até autoMapear,
// exclusive; daí em diante o arquivo volta a ter coisa que não roda fora do navegador).
// A âncora antiga parava em MESES_NOME e deixava matchLista de fora: separarCargoDepto quebrava
// com "matchLista is not defined" no primeiro teste que o chamasse.
const b1 = bloco(/^const soDigitos = /, /^function autoMapear\(/);
// parser da contabilidade: parseNumBR ... parseExtratoMensalOficial (até ImportarExtratoModal, exclusive)
const b2 = bloco(/^const parseNumBR = /, /^function ImportarExtratoModal\(/);
// ehFimDeSemana + contarDiasUteis (até statusFinanceiroTreino, exclusive)
const b3 = bloco(/^const ehFimDeSemana = /, /^function statusFinanceiroTreino\(/);
// VERBAS_RESCISAO + VERBAS_PROV_KEYS/DESC_KEYS (até RescisaoModal, exclusive)
const b4 = bloco(/^const VERBAS_RESCISAO = /, /^function RescisaoModal\(/);
// corpo de ConferenciaCalculos, sem a linha "function ConferenciaCalculos() {" e sem o JSX final
const b5Ini = acharLinha(/^function ConferenciaCalculos\(\)/);
const b5Fim = acharLinha(/^\s*return \(/, b5Ini + 1);
const b5texto = linhas.slice(b5Ini + 1, b5Fim).join("\n");

// Os trechos extraídos podem usar as regras da folha (FR.*), que moram num módulo próprio. O arquivo
// temporário fica em src/, então o caminho relativo é o mesmo que o RHApp.jsx usa.
const script = `import * as FR from "./folha/regras.js";\n` + [b1.texto, b2.texto, b3.texto, b4.texto, b5texto].join("\n") + `
const _falhas = res.filter((r) => !r.ok);
console.log(_falhas.length === 0 ? \`\${res.length}/\${res.length} OK\` : \`\${res.length - _falhas.length}/\${res.length} — \${_falhas.length} FALHA(S)\`);
for (const f of _falhas) console.log(\`  [\${f.g}] \${f.nome} — obtido \${f.got}, esperado \${f.exp}\`);
if (_falhas.length > 0) process.exitCode = 1;
`;

const tmp = file.replace(/\.jsx$/, "") + ".__conferencia_tmp.mjs";
fs.writeFileSync(tmp, script, "utf8");
try {
  const { execSync } = await import("node:child_process");
  execSync(`node "${tmp}"`, { stdio: "inherit" });
} finally {
  fs.unlinkSync(tmp);
}
