"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell, Status, api } from "@/components/shell";

type Handover = {
  id: string;
  name: string;
  status: string;
  as_of: string;
  confirmed_version: number | null;
  accepted_version: number | null;
  predecessor_role: string;
  successor_role: string;
};
type Stats = {
  registeredFiles: number;
  uniqueDocuments: number;
  extractSuccess: number;
  extractPartial: number;
  extractFailed: number;
  indexed: number;
  totalPages: number;
  targetPdfCount: number;
  fullCorpusVerification: string;
  note: string;
};

export default function HomePage() {
  const [rows, setRows] = useState<Handover[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [origin, setOrigin] = useState("");
  const [qr, setQr] = useState("");
  useEffect(() => {
    const here = window.location.origin;
    setOrigin(here);
    import("qrcode").then((QR) => QR.toDataURL(here, { margin: 1, width: 220 })).then(setQr);
    Promise.all([api<Handover[]>("/api/handovers"), api<Stats>("/api/stats")])
      .then(([h, s]) => {
        setRows(h);
        setStats(s);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  return (
    <Shell>
      <h1 className="text-2xl font-bold text-[#0b1f44]">인수인계 현황</h1>
      <p className="mt-2 max-w-3xl text-slate-700">
        과거의 분석을 오늘의 판단으로, 오늘의 판단을 다음 담당자의 실행으로 넘깁니다. 검색만으로 끝내지 않고 전임자 확정과 후임자 인수까지 남깁니다.
      </p>
      <section className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white p-4">
        {qr ? <Image src={qr} alt="이 사이트로 연결되는 QR 코드" width={140} height={140} unoptimized /> : <div className="h-[140px] w-[140px] bg-slate-100" />}
        <div>
          <p className="text-sm text-slate-500">지금 화면으로 바로 연결</p>
          {origin ? <a className="text-lg font-semibold text-[#0f766e] underline" href={origin}>{origin}</a> : <p>주소를 확인하는 중입니다.</p>}
          <p className="mt-1 max-w-md text-sm text-slate-600">휴대폰 카메라로 QR을 비추면 이 주소가 열립니다. 샘플은 가상 시나리오입니다.</p>
        </div>
      </section>
      {error && <p className="mt-4 rounded bg-red-50 p-3 text-red-800">{error}</p>}
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats && [
          ["등록 파일", stats.registeredFiles],
          ["중복 제외", stats.uniqueDocuments],
          ["추출 성공", stats.extractSuccess],
          ["부분 실패", stats.extractPartial],
          ["실패", stats.extractFailed],
          ["색인 완료", stats.indexed],
          ["총 페이지", stats.totalPages],
          ["목표 PDF", `${stats.targetPdfCount} (검증 ${stats.fullCorpusVerification})`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-[#0b1f44]">{value}</p>
          </div>
        ))}
      </section>
      {stats && <p className="mt-3 text-sm text-slate-600">{stats.note}</p>}
      <div className="mt-6 flex gap-3">
        <Link className="rounded bg-[#0b1f44] px-4 py-2 text-white" href="/handovers/new">새 인수인계</Link>
        <Link className="rounded border border-[#0b1f44] px-4 py-2" href="/library">자료실</Link>
      </div>
      <h2 className="mt-8 text-lg font-semibold">현재 인계 건</h2>
      {!rows.length && !error && <p className="mt-2 text-slate-600">아직 인수인계 건이 없습니다. 자료실에서 합성 자료를 등록한 뒤 새 건을 만드세요.</p>}
      <ul className="mt-3 space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Link className="font-semibold text-[#0f766e]" href={`/handovers/${row.id}`}>{row.name}</Link>
              <Status value={row.status} />
            </div>
            <p className="mt-1 text-sm text-slate-600">
              기준일 {row.as_of} · {row.predecessor_role} → {row.successor_role} · 확정 {row.confirmed_version ?? "없음"} · 인수 {row.accepted_version ?? "없음"}
            </p>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
