"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/components/shell";

export default function PrintPage() {
  const params = useParams<{ id: string }>();
  const [text, setText] = useState("불러오는 중입니다.");
  useEffect(() => {
    api<string>(`/api/handovers/${params.id}/export?format=md`).then(setText).catch((e: Error) => setText(e.message));
  }, [params.id]);
  return (
    <article className="mx-auto max-w-3xl bg-white p-8">
      <button className="no-print mb-4 rounded bg-[#0b1f44] px-3 py-2 text-white" onClick={() => window.print()}>인쇄</button>
      <pre className="mt-4 whitespace-pre-wrap font-sans text-base">{text}</pre>
    </article>
  );
}
