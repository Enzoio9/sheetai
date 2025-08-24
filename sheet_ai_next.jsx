"use client";

// ================================
// Sheet AI — Tudo em um único arquivo (Next.js App Router)
// Tema: preto & branco, preview editável, múltiplas abas, gráficos, histórico,
// import/export (XLSX/CSV/JSON), templates, filtros/busca e atalhos.
// ================================

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { z } from "zod";
import {
  FaMagic,
  FaTable,
  FaDownload,
  FaUpload,
  FaUndo,
  FaRedo,
  FaSearch,
  FaFilter,
  FaTrash,
  FaPlus,
  FaCopy,
  FaChartPie,
  FaChartBar,
  FaChartLine,
  FaHistory,
  FaCogs,
} from "react-icons/fa";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
} from "recharts";

// ================================
// Tipos & validação
// ================================
const CellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const SheetSchema = z.object({
  name: z.string().min(1),
  headers: z.array(z.string()).default([]),
  rows: z.array(z.array(CellSchema)).default([]),
});
const ResponseSchema = z.object({ sheets: z.array(SheetSchema) });

export type Sheet = z.infer<typeof SheetSchema>;

// ================================
// Helpers
// ================================
const LS_HISTORY = "sheet_ai_history_v2";
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const sanitizeSheetName = (n: string) =>
  (n || "Aba").replace(/[\\\\\/?*:\\[\]]/g, " ").slice(0, 31) || "Aba";

function aoaFromSheet(s: Sheet) {
  const aoa: any[] = [];
  if (s.headers?.length) aoa.push(s.headers);
  (s.rows || []).forEach((r) => aoa.push(r));
  return aoa;
}

function inferChartData(sheet?: Sheet) {
  if (!sheet) return [] as { name: string; value: number }[];
  const headers = sheet.headers || [];
  if (headers.length < 2) return [];

  // Procura por colunas comuns: name/título + uma numérica
  let nameIdx = 0;
  let valueIdx = headers.findIndex((h) => /valor|value|quant|qtd|total/i.test(h));
  if (valueIdx < 0) {
    // primeira coluna numérica
    valueIdx = sheet.rows[0]?.findIndex((c) => typeof c === "number") ?? -1;
    if (valueIdx < 0) valueIdx = 1; // fallback
  }

  const out: { name: string; value: number }[] = [];
  for (const r of sheet.rows) {
    const name = String(r[nameIdx] ?? "");
    const raw = r[valueIdx];
    const value = typeof raw === "number" ? raw : Number(raw ?? 0);
    if (name) out.push({ name, value: isFinite(value) ? value : 0 });
  }
  return out;
}

function csvToArrays(text: string) {
  return text
    .split(/\r?\n/)
    .filter((l) => l.length)
    .map((l) => l.split(","));
}

// ================================
// Templates simples
// ================================
const TEMPLATES: string[] = [
  "Orçamento familiar mensal: Despesas Fixas, Variáveis, Economias; total por categoria e saldo final.",
  "Controle de vendas: itens, preço, quantidade, data, vendedor; total por item e por mês; gráfico de barras por vendedor.",
  "Planejamento de projetos: tarefas, responsável, status, início, fim, progresso%; visão Kanban e Gantt simples.",
  "CRM simples: lead, origem, estágio, valor, probabilidade, próximo passo; pipeline por estágio.",
  "Estoque: SKU, produto, categoria, custo, preço, quantidade, mínimo, status; alertas de reposição.",
  "Marketing: campanhas, canal, custo, leads, conversões, CPA, ROI; comparativos mensais.",
];

// ================================
// Componente principal
// ================================
export default function Page() {
  // Geração
  const [prompt, setPrompt] = useState(
    "Fluxo de caixa mensal com abas Receitas e Despesas, 12 meses, totais e gráfico de pizza."
  );
  const [rows, setRows] = useState(20);
  const [cols, setCols] = useState(6);
  const [sheetsInput, setSheetsInput] = useState("Principal");
  const [headers, setHeaders] = useState(true);
  const [loading, setLoading] = useState(false);

  // Dados
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [active, setActive] = useState(0);

  // Edição & histórico local
  const [history, setHistory] = useState<{
    id: string;
    date: string;
    prompt: string;
    sheets: Sheet[];
  }[]>([]);
  const [undoStack, setUndoStack] = useState<Sheet[][]>([]);
  const [redoStack, setRedoStack] = useState<Sheet[][]>([]);

  // Busca e filtros
  const [query, setQuery] = useState("");
  const [columnFilter, setColumnFilter] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carrega histórico local
  useEffect(() => {
    try {
      const h = JSON.parse(localStorage.getItem(LS_HISTORY) || "[]");
      setHistory(h);
    } catch {}
  }, []);

  // Atalhos
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "enter") {
        e.preventDefault();
        void generate();
      }
      if ((e.ctrlKey || e.metaKey) && k === "s") {
        e.preventDefault();
        downloadXLSX();
      }
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheets]);

  // Pré-visualização editável: salvar estado para undo
  function pushUndo(s: Sheet[]) {
    setUndoStack((st) => [...st, JSON.parse(JSON.stringify(s))]);
    setRedoStack([]);
  }
  function undo() {
    setUndoStack((st) => {
      if (!st.length) return st;
      const prev = st[st.length - 1];
      setRedoStack((r) => [...r, JSON.parse(JSON.stringify(sheets))]);
      setSheets(JSON.parse(JSON.stringify(prev)));
      setActive(0);
      return st.slice(0, -1);
    });
  }
  function redo() {
    setRedoStack((st) => {
      if (!st.length) return st;
      const next = st[st.length - 1];
      setUndoStack((u) => [...u, JSON.parse(JSON.stringify(sheets))]);
      setSheets(JSON.parse(JSON.stringify(next)));
      setActive(0);
      return st.slice(0, -1);
    });
  }

  // Geração
  async function generate() {
    setLoading(true);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          options: {
            rows: Math.max(1, rows),
            cols: Math.max(1, cols),
            headers,
            sheets: sheetsInput.split(",").map((s) => s.trim()).filter(Boolean),
          },
        }),
      });

      const json = await res.json();
      const parsed = ResponseSchema.safeParse(json);
      if (!parsed.success) throw new Error("Resposta inválida do backend.");
      const safe = parsed.data.sheets.map((s) => ({
        name: sanitizeSheetName(s.name),
        headers: s.headers || [],
        rows: s.rows || [],
      }));
      pushUndo(sheets);
      setSheets(safe);
      setActive(0);

      const entry = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        prompt,
        sheets: safe,
      };
      const newHist = [entry, ...history].slice(0, 50);
      setHistory(newHist);
      localStorage.setItem(LS_HISTORY, JSON.stringify(newHist));
    } catch (e: any) {
      alert(e.message || "Falha ao gerar");
    } finally {
      setLoading(false);
    }
  }

  // Import/Export
  function downloadXLSX() {
    if (!sheets.length) return;
    const wb = XLSX.utils.book_new();
    sheets.forEach((tab) => {
      const ws = XLSX.utils.aoa_to_sheet(aoaFromSheet(tab));
      XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(tab.name));
    });
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(wb, `sheet-ai-${ts}.xlsx`);
  }
  function downloadCSV() {
    if (!sheets.length) return;
    const first = sheets[active];
    const ws = XLSX.utils.aoa_to_sheet(aoaFromSheet(first));
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${sanitizeSheetName(first.name)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function downloadJSON() {
    if (!sheets.length) return;
    const blob = new Blob([JSON.stringify({ sheets }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sheet-ai.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function importFile(file: File) {
    const name = file.name.replace(/\.(csv|json|xlsx?|)$/i, "");
    const buf = await file.arrayBuffer();
    let tab: Sheet = { name, headers: [], rows: [] };

    if (/\.(xlsx?|xls)$/i.test(file.name)) {
      const wb = XLSX.read(buf, { type: "array" });
      const first = wb.SheetNames[0];
      const ws = wb.Sheets[first];
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
      if (aoa.length) {
        tab.headers = (aoa[0] as any[]).map((h) => String(h ?? ""));
        tab.rows = aoa.slice(1);
      }
    } else if (/\.csv$/i.test(file.name)) {
      const text = new TextDecoder().decode(new Uint8Array(buf));
      const rows = csvToArrays(text);
      if (rows.length) {
        tab.headers = rows[0].map((h) => String(h ?? ""));
        tab.rows = rows.slice(1);
      }
    } else if (/\.json$/i.test(file.name)) {
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));
      if (Array.isArray(json?.sheets)) {
        pushUndo(sheets);
        setSheets(json.sheets);
        setActive(0);
        return;
      }
      if (Array.isArray(json)) {
        const headers = Array.from(new Set(json.flatMap((o: any) => Object.keys(o || {}))));
        tab.headers = headers;
        tab.rows = json.map((o: any) => headers.map((h) => o?.[h] ?? ""));
      }
    }

    pushUndo(sheets);
    setSheets((prev) => [...prev, tab]);
    setActive(sheets.length);
  }

  // Edição básica de células
  function setCell(r: number, c: number, v: any) {
    pushUndo(sheets);
    setSheets((prev) => {
      const cp = JSON.parse(JSON.stringify(prev)) as Sheet[];
      const tab = cp[active];
      tab.rows[r][c] = v;
      return cp;
    });
  }
  function addRow() {
    pushUndo(sheets);
    setSheets((prev) => {
      const cp = JSON.parse(JSON.stringify(prev)) as Sheet[];
      const tab = cp[active];
      const cols = Math.max(1, tab.headers.length || (tab.rows[0]?.length ?? 1));
      tab.rows.push(Array(cols).fill(""));
      return cp;
    });
  }
  function addCol() {
    pushUndo(sheets);
    setSheets((prev) => {
      const cp = JSON.parse(JSON.stringify(prev)) as Sheet[];
      const tab = cp[active];
      const name = `Coluna ${((tab.headers?.length || 0) + 1).toString()}`;
      tab.headers = [...(tab.headers || []), name];
      tab.rows = tab.rows.map((r) => [...r, ""]);
      return cp;
    });
  }
  function deleteRow(idx: number) {
    pushUndo(sheets);
    setSheets((prev) => {
      const cp = JSON.parse(JSON.stringify(prev)) as Sheet[];
      const tab = cp[active];
      tab.rows.splice(idx, 1);
      return cp;
    });
  }
  function deleteCol(idx: number) {
    pushUndo(sheets);
    setSheets((prev) => {
      const cp = JSON.parse(JSON.stringify(prev)) as Sheet[];
      const tab = cp[active];
      tab.headers.splice(idx, 1);
      tab.rows = tab.rows.map((r) => r.filter((_, i) => i !== idx));
      return cp;
    });
  }
  function duplicateSheet() {
    if (!sheets.length) return;
    pushUndo(sheets);
    setSheets((prev) => {
      const cp = JSON.parse(JSON.stringify(prev)) as Sheet[];
      const s = cp[active];
      const clone = JSON.parse(JSON.stringify(s)) as Sheet;
      clone.name = sanitizeSheetName(`${s.name} (cópia)`);
      cp.splice(active + 1, 0, clone);
      return cp;
    });
    setActive((a) => a + 1);
  }
  function deleteSheet() {
    if (!sheets.length) return;
    pushUndo(sheets);
    setSheets((prev) => {
      const cp = JSON.parse(JSON.stringify(prev)) as Sheet[];
      cp.splice(active, 1);
      return cp;
    });
    setActive((a) => clamp(a - 1, 0, Math.max(0, sheets.length - 2)));
  }

  // Busca & filtro
  const filteredRows = useMemo(() => {
    const s = sheets[active];
    if (!s) return [] as any[];
    let rows = s.rows;
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((r) => r.some((c) => String(c ?? "").toLowerCase().includes(q)));
    }
    if (columnFilter) {
      const [col, val] = columnFilter.split(":");
      const idx = s.headers.findIndex((h) => h === col);
      if (idx >= 0) rows = rows.filter((r) => String(r[idx] ?? "") === val);
    }
    return rows;
  }, [sheets, active, query, columnFilter]);

  const chartData = useMemo(() => inferChartData(sheets[active]), [sheets, active]);

  return (
    <main className="max-w-6xl mx-auto px-4 min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-[#e6e6e6]">
        <div className="flex items-center gap-3 h-14">
          <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center text-white font-extrabold">S</div>
          <div className="font-extrabold tracking-tight">Sheet AI</div>
          <span className="ml-2 rounded-full px-3 py-1 text-xs border border-[#e6e6e6]">βeta</span>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <a className="px-3 py-2 rounded-lg hover:bg-[#f2f2f2]" href="#home">Início</a>
            <a className="px-3 py-2 rounded-lg hover:bg-[#f2f2f2]" href="#view">Resultados</a>
            <a className="px-3 py-2 rounded-lg hover:bg-[#f2f2f2]" href="#settings">Configurações</a>
          </div>
        </div>
      </header>

      {/* Home */}
      <section id="home" className="py-6">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Prompt */}
          <div className="lg:col-span-2 rounded-2xl shadow-sm border border-[#e6e6e6] p-4">
            <h1 className="text-2xl font-extrabold mb-2 flex items-center gap-2"><FaMagic/> Gerar planilha</h1>
            <p className="text-sm text-[#8a8a8a] mb-4">Descreva exatamente a planilha que você precisa.</p>
            <textarea
              className="w-full min-h-36 bg-[#f2f2f2] border-0 rounded-xl focus:outline-none p-3"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />

            <div className="grid md:grid-cols-2 gap-3 mt-4">
              <div className="rounded-2xl shadow-sm border border-[#e6e6e6] p-3">
                <div className="font-bold mb-2">Opções</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <label className="flex flex-col">
                    <span className="text-[#8a8a8a]">Linhas (estimativa)</span>
                    <input
                      type="number"
                      min={1}
                      value={rows}
                      onChange={(e) => setRows(parseInt(e.target.value || "1"))}
                      className="bg-[#f2f2f2] rounded-lg p-2"
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-[#8a8a8a]">Colunas (estimativa)</span>
                    <input
                      type="number"
                      min={1}
                      value={cols}
                      onChange={(e) => setCols(parseInt(e.target.value || "1"))}
                      className="bg-[#f2f2f2] rounded-lg p-2"
                    />
                  </label>
                  <label className="flex flex-col col-span-2">
                    <span className="text-[#8a8a8a]">Aba(s)</span>
                    <input
                      value={sheetsInput}
                      onChange={(e) => setSheetsInput(e.target.value)}
                      className="bg-[#f2f2f2] rounded-lg p-2"
                    />
                  </label>
                  <label className="flex items-center gap-2 col-span-2">
                    <input
                      type="checkbox"
                      checked={headers}
                      onChange={(e) => setHeaders(e.target.checked)}
                    />
                    <span>Incluir linha de cabeçalho</span>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl shadow-sm border border-[#e6e6e6] p-3">
                <div className="font-bold mb-2 flex items-center gap-2">Templates</div>
                <div className="grid grid-cols-1 gap-2">
                  {TEMPLATES.map((t, i) => (
                    <button
                      key={i}
                      className="text-left px-3 py-2 rounded-lg bg-[#f2f2f2] hover:bg-[#eaeaea]"
                      onClick={() => setPrompt(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button
                onClick={generate}
                className="rounded-xl h-12 px-5 font-bold tracking-wide bg-black text-white disabled:opacity-50"
                disabled={loading}
              >
                {loading ? "Gerando..." : "Gerar planilha (Ctrl/Cmd+Enter)"}
              </button>
              <button
                onClick={() => setPrompt("")}
                className="rounded-xl h-12 px-5 font-bold tracking-wide bg-[#f2f2f2]"
              >
                Limpar
              </button>
            </div>
          </div>

          {/* Lateral */}
          <aside className="rounded-2xl shadow-sm border border-[#e6e6e6] p-4">
            <div className="font-extrabold mb-2 flex items-center gap-2"><FaHistory/> Histórico rápido</div>
            {!history.length ? (
              <div className="text-sm text-[#8a8a8a]">Sem histórico ainda.</div>
            ) : (
              <div className="space-y-2 text-sm max-h-64 overflow-auto">
                {history.slice(0, 6).map((h) => (
                  <button
                    key={h.id}
                    className="w-full text-left px-3 py-2 rounded-lg bg-[#f2f2f2] hover:bg-[#eaeaea]"
                    onClick={() => {
                      setSheets(JSON.parse(JSON.stringify(h.sheets)));
                      setActive(0);
                    }}
                  >
                    <div className="text-xs text-[#8a8a8a]">{new Date(h.date).toLocaleString()}</div>
                    <div className="truncate">{h.prompt}</div>
                  </button>
                ))}
              </div>
            )}
            <hr className="my-4 border-[#e6e6e6]" />
            <div className="font-extrabold mb-2 flex items-center gap-2"><FaUpload/> Importar</div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="block w-full text-sm"
            />
          </aside>
        </div>
      </section>

      {/* Resultados */}
      <section id="view" className="py-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-2xl font-extrabold flex items-center gap-2"><FaTable/> Visualização</div>
          <div className="flex gap-2">
            <button
              className="rounded-xl h-10 px-4 font-bold bg-black text-white disabled:opacity-50"
              onClick={downloadXLSX}
              disabled={!sheets.length}
            >
              <FaDownload className="inline mr-2"/> .xlsx
            </button>
            <button
              className="rounded-xl h-10 px-4 font-bold bg-[#f2f2f2]"
              onClick={downloadCSV}
              disabled={!sheets.length}
            >
              .csv
            </button>
            <button
              className="rounded-xl h-10 px-4 font-bold bg-[#f2f2f2]"
              onClick={downloadJSON}
              disabled={!sheets.length}
            >
              .json
            </button>
          </div>
        </div>

        {/* Abas de planilhas */}
        <div className="flex gap-2 overflow-x-auto mb-3">
          {sheets.map((s, i) => (
            <button
              key={i}
              className={`px-3 py-2 rounded-lg text-sm ${
                i === active ? "bg-black text-white" : "bg-[#f2f2f2]"
              }`}
              onClick={() => setActive(i)}
            >
              {s.name}
            </button>
          ))}
          {!!sheets.length && (
            <>
              <button className="px-3 py-2 rounded-lg text-sm bg-[#f2f2f2]" onClick={duplicateSheet}><FaCopy className="inline"/> Duplicar</button>
              <button className="px-3 py-2 rounded-lg text-sm bg-[#f2f2f2]" onClick={addRow}><FaPlus className="inline"/> Linha</button>
              <button className="px-3 py-2 rounded-lg text-sm bg-[#f2f2f2]" onClick={addCol}><FaPlus className="inline"/> Coluna</button>
              <button className="px-3 py-2 rounded-lg text-sm bg-[#f2f2f2]" onClick={undo} title="Undo (Ctrl/Cmd+Z)"><FaUndo className="inline"/></button>
              <button className="px-3 py-2 rounded-lg text-sm bg-[#f2f2f2]" onClick={redo} title="Redo (Ctrl/Cmd+Y)"><FaRedo className="inline"/></button>
              <button className="px-3 py-2 rounded-lg text-sm bg-[#f2f2f2]" onClick={deleteSheet}><FaTrash className="inline"/> Excluir aba</button>
            </>
          )}
        </div>

        {/* Filtros & busca */}
        {!!sheets.length && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative">
              <FaSearch className="absolute left-2 top-1/2 -translate-y-1/2 text-[#8a8a8a]"/>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar em todas as colunas"
                className="pl-8 pr-3 py-2 rounded-lg bg-[#f2f2f2]"
              />
            </div>
            <div className="relative">
              <FaFilter className="absolute left-2 top-1/2 -translate-y-1/2 text-[#8a8a8a]"/>
              <input
                value={columnFilter}
                onChange={(e) => setColumnFilter(e.target.value)}
                placeholder="Filtro por coluna (ex.: Categoria:Alimentos)"
                className="pl-8 pr-3 py-2 rounded-lg bg-[#f2f2f2]"
              />
            </div>
          </div>
        )}

        {/* Tabela editável */}
        <div className="rounded-2xl shadow-sm border border-[#e6e6e6] overflow-x-auto">
          {!sheets.length ? (
            <div className="p-6 text-sm text-[#8a8a8a]">Nenhuma planilha gerada ainda.</div>
          ) : (
            <div className="p-2">
              <div className="font-bold px-2 py-2">{sheets[active]?.name}</div>
              <table className="w-full text-sm">
                <thead className="bg-[#f2f2f2]">
                  {sheets[active]?.headers?.length ? (
                    <tr>
                      {sheets[active].headers.map((h, idx) => (
                        <th key={idx} className="text-left px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span>{h}</span>
                            <button
                              className="text-xs px-2 py-1 rounded bg-black text-white"
                              onClick={() => deleteCol(idx)}
                            >
                              Remover
                            </button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  ) : null}
                </thead>
                <tbody>
                  {filteredRows.slice(0, 500).map((r, ri) => (
                    <tr key={ri} className="odd:bg-white even:bg-[#fafafa]">
                      {r.map((cell: any, ci: number) => (
                        <td key={ci} className="px-3 py-2 border-t border-[#e6e6e6]">
                          <input
                            value={String(cell ?? "")}
                            onChange={(e) => setCell(ri, ci, e.target.value)}
                            className="w-full bg-transparent outline-none"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 border-t border-[#e6e6e6] text-right">
                        <button className="text-xs px-2 py-1 rounded bg-[#f2f2f2]" onClick={() => deleteRow(ri)}>
                          Remover linha
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Gráficos */}
        {!!chartData.length && (
          <div className="grid md:grid-cols-3 gap-4 mt-6">
            <div className="rounded-2xl shadow-sm border border-[#e6e6e6] p-3">
              <div className="font-bold mb-2 flex items-center gap-2"><FaChartPie/> Pizza</div>
              <div className="w-full h-64">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={chartData} dataKey="value" nameKey="name" outerRadius={100} label>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={i % 2 === 0 ? "#000" : "#666"} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl shadow-sm border border-[#e6e6e6] p-3">
              <div className="font-bold mb-2 flex items-center gap-2"><FaChartBar/> Barras</div>
              <div className="w-full h-64">
                <ResponsiveContainer>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="value" fill="#000" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl shadow-sm border border-[#e6e6e6] p-3">
              <div className="font-bold mb-2 flex items-center gap-2"><FaChartLine/> Linhas</div>
              <div className="w-full h-64">
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="value" stroke="#000" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Configurações */}
      <section id="settings" className="py-6">
        <div className="rounded-2xl shadow-sm border border-[#e6e6e6] p-4">
          <div className="font-extrabold mb-2 flex items-center gap-2"><FaCogs/> Configurações</div>
          <div className="text-sm text-[#8a8a8a]">
            Tema branco & preto já aplicado. Atalhos: <b>Ctrl/Cmd+Enter</b> gerar, <b>Ctrl/Cmd+S</b> baixar XLSX.
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#e6e6e6] mt-8">
        <div className="px-4 py-6 text-xs text-[#8a8a8a] flex items-center justify-between">
          <span>© {new Date().getFullYear()} Sheet AI</span>
          <div className="flex gap-4">
            <a className="hover:underline" href="#settings">Configurações</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
