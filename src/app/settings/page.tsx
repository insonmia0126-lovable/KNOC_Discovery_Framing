"use client";

import { useEffect, useState } from "react";
import { Shell, api } from "@/components/shell";

type Settings = {
  org_name: string;
  work_types: string;
  mode: "demo" | "live";
  model_base_url: string;
  model_name: string;
  embed_model: string | null;
  timeout_ms: number;
  llmKeyConfigured: boolean;
  supportedFormats: string[];
  unsupported: string[];
  twoModelCheck: string;
  authMode: string;
};

export default function SettingsPage() {
  const [row, setRow] = useState<Settings | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api<Settings>("/api/settings").then(setRow).catch((e: Error) => setMessage(e.message));
  }, []);
  if (!row) return <Shell><p>{message || "설정을 불러오는 중입니다."}</p></Shell>;
  return (
    <Shell>
      <h1 className="text-2xl font-bold text-[#0b1f44]">설정</h1>
      <p className="mt-2 text-sm text-slate-600">{row.authMode}</p>
      <form
        className="mt-4 grid max-w-xl gap-3 rounded border bg-white p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const saved = await api<Settings>("/api/settings", {
              method: "PATCH",
              body: JSON.stringify({
                orgName: row.org_name,
                workTypes: row.work_types,
                mode: row.mode,
                modelBaseUrl: row.model_base_url,
                modelName: row.model_name,
                embedModel: row.embed_model || "",
                timeoutMs: Number(row.timeout_ms),
              }),
            });
            setRow(saved);
            setMessage("저장했습니다. 키 값은 화면에 보이지 않습니다.");
          } catch (err) {
            setMessage(err instanceof Error ? err.message : "저장 실패");
          }
        }}
      >
        <label>기관명<input className="mt-1 w-full rounded border p-2" value={row.org_name} onChange={(e) => setRow({ ...row, org_name: e.target.value })} /></label>
        <label>업무 분류<input className="mt-1 w-full rounded border p-2" value={row.work_types} onChange={(e) => setRow({ ...row, work_types: e.target.value })} /></label>
        <label>모델 연결
          <select className="mt-1 w-full rounded border p-2" value={row.mode} onChange={(e) => setRow({ ...row, mode: e.target.value as "demo" | "live" })}>
            <option value="demo">합성자료 데모 / 실제 AI 호출 없음</option>
            <option value="live">실제 모델</option>
          </select>
        </label>
        <label>모델 주소<input className="mt-1 w-full rounded border p-2" value={row.model_base_url} onChange={(e) => setRow({ ...row, model_base_url: e.target.value })} /></label>
        <label>모델 이름<input className="mt-1 w-full rounded border p-2" value={row.model_name} onChange={(e) => setRow({ ...row, model_name: e.target.value })} /></label>
        <label>제한 시간(ms)<input className="mt-1 w-full rounded border p-2" type="number" value={row.timeout_ms} onChange={(e) => setRow({ ...row, timeout_ms: Number(e.target.value) })} /></label>
        <p className="text-sm">키 설정 여부: {row.llmKeyConfigured ? "환경변수에 있음" : "없음"}</p>
        <p className="text-sm">임베딩 색인: 연결 안 됨. 키워드 색인만 사용합니다.</p>
        <p className="text-sm">지원 형식: {row.supportedFormats.join(", ")}</p>
        <p className="text-sm">지원하지 않음: {row.unsupported.join(", ")}</p>
        <p className="text-sm">모델 2종 검증: {row.twoModelCheck}</p>
        <button className="w-fit rounded bg-[#0b1f44] px-4 py-2 text-white">저장</button>
        {message && <p>{message}</p>}
      </form>
    </Shell>
  );
}
