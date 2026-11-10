"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const links = [
  ["/", "현황"],
  ["/library", "자료실"],
  ["/handovers/new", "새 인수인계"],
  ["/settings", "설정"],
];

export function role() {
  if (typeof window === "undefined") return "predecessor";
  return localStorage.getItem("demo-role") || "predecessor";
}

export function actor() {
  if (typeof window === "undefined") return "전임자";
  return localStorage.getItem("demo-actor") || "전임자";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-demo-role", role());
  headers.set("x-demo-actor", actor());
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(data.error || "요청 실패");
  }
  const type = response.headers.get("content-type") || "";
  if (type.includes("json")) return response.json();
  return (await response.text()) as T;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const [who, setWho] = useState("predecessor");
  const [name, setName] = useState("전임자");
  useEffect(() => {
    setWho(role());
    setName(actor());
  }, []);
  function save(nextRole: string, nextName: string) {
    localStorage.setItem("demo-role", nextRole);
    localStorage.setItem("demo-actor", nextName);
    setWho(nextRole);
    setName(nextName);
  }
  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-4">
          <div className="mr-auto">
            <p className="text-xs font-semibold tracking-wide text-teal-700">국가 에너지 안보의 바통을 잇다</p>
            <Link href="/" className="text-xl font-bold text-[#0b1f44]">KNOC Discovery & Framing</Link>
          </div>
          <nav className="flex flex-wrap gap-3 text-sm" aria-label="주요">
            {links.map(([href, label]) => (
              <Link key={href} className="rounded px-2 py-1 hover:bg-slate-100" href={href}>{label}</Link>
            ))}
          </nav>
          <label className="text-sm text-slate-600">
            데모 역할
            <select
              className="ml-2 rounded border px-2 py-1"
              aria-label="데모 역할"
              value={who}
              onChange={(e) => {
                const map: Record<string, string> = { predecessor: "전임자", successor: "후임자", reader: "읽기" };
                save(e.target.value, map[e.target.value] || "읽기");
              }}
            >
              <option value="predecessor">전임자</option>
              <option value="successor">후임자</option>
              <option value="reader">읽기</option>
            </select>
          </label>
          <span className="text-sm text-slate-500">{name}</span>
        </div>
        <p className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-950">
          단일 PC 데모입니다. 역할 선택은 로그인이 아니며, 서버는 이 역할 표시만 검사합니다. 화면의 분석은 등록 자료와 입력에 한정되고 정책 조치를 실행하지 않습니다.
        </p>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

export function Status({ value }: { value: string }) {
  const label: Record<string, string> = {
    draft_ai: "AI 초안",
    predecessor_review: "전임자 검토 중",
    predecessor_confirmed: "전임자 확정",
    successor_accepted: "후임자 인수 확인",
    success: "추출 성공",
    partial: "부분 실패",
    failed: "실패",
    queued: "대기",
    unsupported: "미지원",
    not_started: "미착수",
    in_progress: "진행 중",
    done: "완료",
    on_hold: "보류",
    not_applicable: "해당 없음",
    restricted: "열람 제한",
    readable_local: "로컬 열람",
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-sm text-teal-900">
      <span aria-hidden className="h-2 w-2 rounded-full bg-teal-700" />
      {label[value] || value}
    </span>
  );
}
