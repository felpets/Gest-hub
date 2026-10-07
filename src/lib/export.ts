// jsPDF (+autotable) e xlsx são pesados (~1.2MB juntos). Como só são usados ao
// CLICAR em exportar, são carregados sob demanda (import dinâmico) dentro das
// funções — assim não entram no bundle inicial do Dashboard.

import { entregarArquivo } from "@/lib/salvar-arquivo";

// Converte um <svg> (ex.: gráfico do recharts) em PNG, para embutir no PDF.
// Sem dependência nova: serializa o SVG, desenha num canvas e exporta dataURL.
// Devolve também as dimensões reais (p/ manter a proporção no PDF).
export async function svgToPng(
  svg: SVGSVGElement,
  opts?: {
    background?: string;
    scale?: number;
    // Força todos os rótulos (<text>) p/ esta cor. Usado no PDF p/ manter os
    // gráficos legíveis mesmo quando a tela está no modo escuro (texto claro).
    forceTextColor?: string;
    // Troca cores exatas de fill/stroke (ex.: cores do tema escuro → claras),
    // para o gráfico embutido no PDF sair sempre num visual claro.
    recolor?: { from: string; to: string }[];
  }
): Promise<{ dataUrl: string; width: number; height: number }> {
  const scale = opts?.scale ?? 2;
  const bg = opts?.background ?? "#ffffff";
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || svg.clientWidth || 600));
  const height = Math.max(1, Math.round(rect.height || svg.clientHeight || 320));

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  // Recolore o clone p/ um visual claro no PDF (o SVG na tela pode estar escuro).
  if (opts?.recolor?.length) {
    const map = new Map(opts.recolor.map((r) => [r.from, r.to]));
    clone.querySelectorAll("*").forEach((el) => {
      const f = el.getAttribute("fill");
      if (f && map.has(f)) el.setAttribute("fill", map.get(f)!);
      const s = el.getAttribute("stroke");
      if (s && map.has(s)) el.setAttribute("stroke", map.get(s)!);
    });
  }
  if (opts?.forceTextColor) {
    clone.querySelectorAll("text").forEach((t) => t.setAttribute("fill", opts.forceTextColor!));
  }

  const xml = new XMLSerializer().serializeToString(clone);
  const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);

  const img = new Image();
  img.width = width;
  img.height = height;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Falha ao renderizar o gráfico para imagem."));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponível.");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Card de destaque do topo de uma seção (os mesmos KPIs que aparecem na tela).
export type PdfKpi = { label: string; value: string; hint?: string };

export type PdfChart = {
  dataUrl: string;
  width: number;
  height: number;
  caption?: string;
  // KPIs desta seção — usados quando o PDF combina vários relatórios e cada um
  // precisa dos seus próprios números (com um só, eles vão no topo do documento).
  kpis?: PdfKpi[];
  legend?: { label: string; color: string }[];
};

// Papel de cada linha da tabela (alinhado a `rows`): categoria pai/TOTAL em
// negrito, filha indentada, lançamento esmaecido. Ausente = linha comum.
export type PdfRowKind = "pai" | "filha" | "lancamento" | "vazio" | "total";

export type PdfTable = {
  title?: string;
  columns: string[];
  rows: (string | number)[][];
  rowKinds?: (PdfRowKind | undefined)[];
};

export async function exportToPdf(opts: {
  title: string;
  // Nome da empresa ativa — vira o destaque do cabeçalho e aparece no rodapé.
  company?: string;
  subtitle?: string;
  filename?: string;
  orientation?: "portrait" | "landscape";
  // KPIs em destaque no topo (label + valor) — quebram em várias linhas (4/linha).
  kpis?: PdfKpi[];
  // Um gráfico (legado) — ou vários via `charts`. A legenda do recharts é HTML
  // e não entra no SVG, por isso ela é desenhada aqui no PDF.
  chart?: { dataUrl: string; width: number; height: number } | null;
  legend?: { label: string; color: string }[];
  charts?: PdfChart[];
  // Uma tabela (legado: columns+rows) ou várias seções via `tables`.
  columns?: string[];
  rows?: (string | number)[][];
  tables?: PdfTable[];
}) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF({ orientation: opts.orientation ?? "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const footerY = pageH - 11;        // linha do rodapé
  const contentBottom = footerY - 4; // limite útil do conteúdo
  let y = 15;

  const ensure = (need: number) => {
    if (y + need > contentBottom) {
      doc.addPage();
      y = margin + 2;
    }
  };

  // ── Cabeçalho: faixa da marca + empresa + título + data de geração ──
  doc.setFillColor(255, 77, 28);
  doc.rect(0, 0, pageW, 2, "F");
  if (opts.company) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(255, 77, 28);
    doc.text(opts.company.toUpperCase(), margin, y);
    y += 6.5;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(13, 12, 12);
  doc.text(opts.title, margin, y);
  const agora = new Date();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(
    `Gerado em ${agora.toLocaleDateString("pt-BR")} às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
    pageW - margin, y, { align: "right" }
  );
  if (opts.subtitle) {
    y += 6;
    doc.setFontSize(9.5);
    doc.setTextColor(110);
    doc.text(opts.subtitle, margin, y);
  }
  y += 4.5;
  doc.setDrawColor(230);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // ── KPIs (cards em destaque, 3-4 por linha) ──
  const kpiGap = 4;
  const kpiPerRow = pageW > 220 ? 4 : 3; // retrato (~210mm) cabe melhor com 3
  const kpiBoxW = (pageW - margin * 2 - kpiGap * (kpiPerRow - 1)) / kpiPerRow;
  // Com dica (ex.: "ago/26") o card precisa de uma linha a mais.
  const kpiBoxH = (kpis: PdfKpi[]) => (kpis.some((k) => k.hint) ? 20.5 : 17);
  const kpisHeight = (kpis: PdfKpi[]) =>
    kpis.length ? Math.ceil(kpis.length / kpiPerRow) * (kpiBoxH(kpis) + 4) + 2 : 0;

  const drawKpis = (kpis: PdfKpi[]) => {
    if (!kpis.length) return;
    const boxH = kpiBoxH(kpis);
    for (let r = 0; r < kpis.length; r += kpiPerRow) {
      ensure(boxH + 4);
      kpis.slice(r, r + kpiPerRow).forEach((k, i) => {
        const x = margin + i * (kpiBoxW + kpiGap);
        doc.setFillColor(250, 250, 250);
        doc.setDrawColor(232, 232, 232);
        doc.setLineWidth(0.2);
        doc.roundedRect(x, y, kpiBoxW, boxH, 2, 2, "FD");
        doc.setFillColor(255, 77, 28);
        doc.rect(x, y + 5, 1, boxH - 10, "F");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(130);
        doc.text(k.label.toUpperCase(), x + 4.5, y + 6);
        // Valor: reduz a fonte e corta com "…" p/ nunca vazar da caixa
        // (ex.: "Maior categoria" pode ser um nome longo).
        doc.setFont("helvetica", "bold");
        let fs = 12.5;
        doc.setFontSize(fs);
        while (fs > 8.5 && doc.getTextWidth(k.value) > kpiBoxW - 9) {
          fs -= 0.5;
          doc.setFontSize(fs);
        }
        let valor = k.value;
        if (doc.getTextWidth(valor) > kpiBoxW - 9) {
          while (valor.length > 1 && doc.getTextWidth(`${valor}…`) > kpiBoxW - 9) valor = valor.slice(0, -1);
          valor += "…";
        }
        doc.setTextColor(20);
        doc.text(valor, x + 4.5, y + 13.5);
        if (k.hint) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7);
          doc.setTextColor(140);
          doc.text(k.hint, x + 4.5, y + 18);
        }
      });
      y += boxH + 4;
    }
    y += 2;
  };

  if (opts.kpis?.length) drawKpis(opts.kpis);

  // Desenha uma legenda (swatch + label) a partir de `y`, com quebra de linha.
  const drawLegend = (legend: { label: string; color: string }[]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const sw = 3.2;
    const lineH = 5;
    let lx = margin;
    for (const item of legend) {
      const labelW = doc.getTextWidth(item.label) + sw + 5;
      if (lx + labelW > pageW - margin) {
        lx = margin;
        y += lineH;
      }
      const [r, g, b] = hexToRgb(item.color);
      doc.setFillColor(r, g, b);
      doc.roundedRect(lx, y - 2.6, sw, sw, 0.4, 0.4, "F");
      doc.setTextColor(70);
      doc.text(item.label, lx + sw + 1.5, y);
      lx += labelW;
    }
    y += lineH + 3;
  };

  // ── Gráficos ──
  const charts: PdfChart[] = opts.charts ?? (opts.chart ? [{ ...opts.chart, legend: opts.legend }] : []);
  const multi = charts.length > 1;
  for (const c of charts) {
    const usableW = pageW - margin * 2;
    let imgW = usableW;
    let imgH = (imgW * c.height) / c.width;
    const maxH = multi ? (pageH > 250 ? 96 : 84) : (pageH > 250 ? 112 : 90);
    if (imgH > maxH) {
      imgH = maxH;
      imgW = (imgH * c.width) / c.height;
    }
    const captionH = c.caption ? 6 : 0;
    const legendH = c.legend?.length ? 8 : 0;
    const kpiH = c.kpis?.length ? kpisHeight(c.kpis) : 0;
    // Título + cards + gráfico entram juntos na página: quebrar entre eles
    // deixaria a seção órfã do seu próprio título.
    ensure(captionH + kpiH + imgH + legendH);
    if (c.caption) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(20);
      doc.text(c.caption, margin, y + 4);
      y += captionH;
    }
    if (c.kpis?.length) drawKpis(c.kpis);
    doc.addImage(c.dataUrl, "PNG", margin, y, imgW, imgH);
    y += imgH + 4;
    if (c.legend?.length) drawLegend(c.legend);
  }

  // ── Tabelas (uma ou várias seções) ──
  const tables: PdfTable[] = opts.tables
    ?? (opts.rows?.length && opts.columns ? [{ columns: opts.columns, rows: opts.rows }] : []);
  for (const t of tables) {
    if (!t.rows.length) continue;
    if (t.title) {
      ensure(16);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(20);
      doc.text(t.title, margin, y + 4);
      y += 7;
    }
    // Colunas numéricas (R$, % ou só dígitos) alinham à direita — cabeçalho junto.
    const rightCols = t.columns.map((_, ci) =>
      t.rows.every((r) => {
        const v = String(r[ci] ?? "").trim();
        return v === "" || v === "—" || /R\$/.test(v) || /%$/.test(v) || /^-?\d+([.,]\d+)*$/.test(v);
      })
    );
    autoTable(doc, {
      startY: y,
      head: [t.columns],
      body: t.rows,
      styles: { fontSize: 8.5, cellPadding: 2.8, textColor: [40, 40, 40], lineColor: [235, 235, 235], lineWidth: 0.1 },
      headStyles: { fillColor: [13, 12, 12], textColor: 255, fontStyle: "bold", fontSize: 8 },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      margin: { left: margin, right: margin, bottom: pageH - contentBottom },
      didParseCell: (d) => {
        if (rightCols[d.column.index]) d.cell.styles.halign = "right";
        if (d.section !== "body") return;
        const kind = t.rowKinds?.[d.row.index];
        if (!kind) return;
        if (kind === "pai") {
          d.cell.styles.fontStyle = "bold";
          d.cell.styles.fillColor = [244, 244, 244];
        } else if (kind === "total") {
          d.cell.styles.fontStyle = "bold";
          d.cell.styles.fillColor = [232, 232, 232];
        } else if (kind === "lancamento" || kind === "vazio") {
          d.cell.styles.textColor = [120, 120, 120];
          if (kind === "vazio") d.cell.styles.fontStyle = "italic";
        }
        // Indentação da 1ª coluna: filha um passo, lançamento dois.
        if (d.column.index === 0 && kind !== "pai" && kind !== "total") {
          const pad = d.cell.styles.cellPadding;
          const base = typeof pad === "number" ? pad : 2.8;
          d.cell.styles.cellPadding = { top: base, right: base, bottom: base, left: base + (kind === "filha" ? 4 : 8) };
        }
      },
    });
    const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
    y = (lastY ?? y) + 8;
  }

  // ── Rodapé em todas as páginas: identificação + numeração ──
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(230);
    doc.setLineWidth(0.3);
    doc.line(margin, footerY, pageW - margin, footerY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(150);
    doc.text([opts.company, "Finance HUB"].filter(Boolean).join(" · "), margin, footerY + 4.5);
    doc.text(`Página ${i} de ${totalPages}`, pageW - margin, footerY + 4.5, { align: "right" });
  }

  await entregarArquivo(
    opts.filename ?? `${opts.title.toLowerCase().replace(/\s+/g, "-")}.pdf`,
    doc.output("blob")
  );
}

export async function exportToXlsx(opts: {
  filename: string;
  sheets: { name: string; columns: string[]; rows: (string | number)[][] }[];
}) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of opts.sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.columns, ...s.rows]);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  // `write` + blob em vez de `writeFile`: é o mesmo arquivo, mas passando pelo
  // entregarArquivo ele também chega ao usuário dentro do APK.
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  await entregarArquivo(
    opts.filename.endsWith(".xlsx") ? opts.filename : `${opts.filename}.xlsx`,
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  );
}
