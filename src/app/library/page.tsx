"use client";

import { useEffect, useState } from "react";
import { Shell, Status, api } from "@/components/shell";

type Doc = {
  id: string;
  original_name: string;
  title: string | null;
  sha256: string;
  published_on: string | null;
  extract_status: string;
  extract_note: string | null;
  rights_status: string;
  page_count: number | null;
  is_synthetic: number;
  department: string | null;
};
type Chunk = { physical_page: number; printed_page: string | null; text: string; quality: string };
type Stats = { registeredFiles: number; uniqueDocuments: number; extractSuccess: number; extractPartial: number; extractFailed: number; indexed: number; totalPages: number; duplicateFiles: number; fullCorpusVerification: string; note: string };

export default function LibraryPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [open, setOpen] = useState<{ title: string; chunks: Chunk[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [d, s] = await Promise.all([api<Doc[]>("/api/documents"), api<Stats>("/api/stats")]);
    setDocs(d);
    setStats(s);
  }
  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, []);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    for (const file of list) form.append("files", file);
    try {
      await api("/api/documents", { method: "POST", body: form });
      setInfo("등록하고 추출을 마쳤습니다. 실패한 파일은 성공 건수에 넣지 않습니다.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "등록 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h1 className="text-2xl font-bold text-[#0b1f44]">자료실</h1>
      <p className="mt-2 text-slate-700">공통 석유보고서와 처리 결과를 둡니다. 목표 6,000개 전체 처리 검증은 {stats?.fullCorpusVerification || "미실시"}입니다.</p>
      {stats && <p className="mt-2 text-sm text-slate-600">등록 {stats.registeredFiles} · 중복 제외 {stats.uniqueDocuments} · 중복 파일 {stats.duplicateFiles} · 성공 {stats.extractSuccess} · 부분 {stats.extractPartial} · 실패 {stats.extractFailed} · 색인 {stats.indexed} · 페이지 {stats.totalPages}</p>}
      <p className="mt-1 text-sm text-slate-500">{stats?.note}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <label className="rounded bg-[#0b1f44] px-4 py-2 text-white">
          PDF·TXT·XLSX 등록
          <input className="sr-only" type="file" multiple accept=".pdf,.txt,.xlsx" onChange={(e) => upload(e.target.files)} />
        </label>
        <label className="rounded border px-4 py-2">
          폴더 등록
          <input className="sr-only" type="file" multiple {...{ webkitdirectory: "", directory: "" }} onChange={(e) => upload(e.target.files)} />
        </label>
        <button
          className="rounded bg-teal-700 px-4 py-2 text-white disabled:opacity-60"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("/api/seed", { method: "POST" });
              setInfo("합성 자료를 등록했습니다. 실제 페트로넷 보고서가 아닙니다.");
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : "등록 실패");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "처리 중" : "합성 자료 등록"}
        </button>
      </div>
      {error && <p className="mt-3 rounded bg-red-50 p-3 text-red-800">{error}</p>}
      {info && <p className="mt-3 rounded bg-teal-50 p-3 text-teal-900">{info}</p>}
      <div className="mt-4 overflow-x-auto rounded border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50">
            <tr>
              {["파일", "제목", "발행일", "상태", "권한", "페이지"].map((h) => <th key={h} className="p-2">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {!docs.length && <tr><td className="p-3" colSpan={6}>등록된 파일이 없습니다.</td></tr>}
            {docs.map((doc) => (
              <tr key={doc.id} className="border-t">
                <td className="p-2">{doc.original_name}{doc.is_synthetic ? " · 합성" : ""}</td>
                <td className="p-2">
                  <button className="text-left text-teal-800 underline" onClick={async () => {
                    try {
                      const data = await api<{ document: Doc; chunks: Chunk[] }>(`/api/documents/${doc.id}`);
                      setOpen({ title: data.document.title || doc.original_name, chunks: data.chunks });
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "열람 실패");
                    }
                  }}>{doc.title || "제목 미확인"}</button>
                  <div className="text-slate-500">{doc.department || "부서 미확인"}</div>
                </td>
                <td className="p-2">{doc.published_on || "미확인"}</td>
                <td className="p-2"><Status value={doc.extract_status} />{doc.extract_note ? <div className="text-red-700">{doc.extract_note}</div> : null}</td>
                <td className="p-2"><Status value={doc.rights_status} /></td>
                <td className="p-2">{doc.page_count ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <aside className="mt-4 rounded border bg-white p-4" aria-label="원문">
          <div className="flex justify-between gap-2">
            <h2 className="font-semibold">{open.title}</h2>
            <button onClick={() => setOpen(null)}>닫기</button>
          </div>
          {open.chunks.map((chunk) => (
            <p key={chunk.physical_page} className="mt-3 whitespace-pre-wrap text-sm">
              <strong>물리 {chunk.physical_page}쪽 / 인쇄 {chunk.printed_page || "미확인"}쪽 · {chunk.quality === "empty" ? "빈 페이지" : "추출"}</strong>
              {"\n"}{chunk.text || "(텍스트 없음)"}
            </p>
          ))}
        </aside>
      )}
    </Shell>
  );
}
