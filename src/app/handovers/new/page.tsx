"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Shell, api } from "@/components/shell";

export default function NewHandoverPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "가상 해협 우회에 따른 시황 인수인계",
    predecessorRole: "시황분석 담당(전임)",
    successorRole: "시황분석 담당(후임)",
    scope: "공통 자료실의 합성 보고서와 전임자 메모·일정",
    asOf: "2024-03-18",
    timezone: "Asia/Seoul",
    facts: "오늘 입력한 사실은 가상 해협 통항 지연이 언급된다는 것뿐입니다.",
    factSources: "담당자 입력. 실시간 시황 연결 없음",
    unknowns: "현재 차질 규모, 시행된 대응, 공식 결재선",
    geo: "가상 해협 / 경질 원유 / 우회 항로",
    observations: "보유한 수량·가격 실측 없음",
    question: "우회 항로 수송 차질과 비슷한 과거 보고는 무엇이며 당시 전망과 남은 업무는 무엇인가",
  });
  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  return (
    <Shell>
      <h1 className="text-2xl font-bold text-[#0b1f44]">새 인수인계</h1>
      <p className="mt-2 text-sm text-slate-600">기준일은 접속한 날짜로 채우지 않습니다. 분석하려는 시점을 직접 적으세요.</p>
      <form
        className="mt-4 grid gap-3 rounded border bg-white p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            const created = await api<{ id: string }>("/api/handovers", { method: "POST", body: JSON.stringify(form) });
            router.push(`/handovers/${created.id}`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "저장 실패");
          }
        }}
      >
        {(
          [
            ["name", "업무명"],
            ["asOf", "분석 기준일"],
            ["timezone", "시간대"],
            ["predecessorRole", "전임자 역할"],
            ["successorRole", "후임자 역할"],
            ["scope", "인계 범위"],
            ["geo", "지역·유종·수송로"],
            ["facts", "확인된 사실"],
            ["factSources", "사실의 출처"],
            ["unknowns", "아직 확인되지 않은 정보"],
            ["observations", "보유한 관찰"],
            ["question", "이번에 볼 질문"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="grid gap-1 text-sm">
            {label}
            {key === "facts" || key === "question" || key === "unknowns" ? (
              <textarea className="rounded border p-2" rows={3} value={form[key]} onChange={(e) => set(key, e.target.value)} required />
            ) : (
              <input className="rounded border p-2" value={form[key]} onChange={(e) => set(key, e.target.value)} required />
            )}
          </label>
        ))}
        {error && <p className="text-red-700">{error}</p>}
        <button className="w-fit rounded bg-[#0f766e] px-4 py-2 text-white">저장하고 탐색</button>
      </form>
    </Shell>
  );
}
