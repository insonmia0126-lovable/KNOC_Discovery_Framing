"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell, Status, api } from "@/components/shell";

type Item = {
  id: string;
  item_kind: string;
  statement_kind: string;
  purpose: string;
  status_text: string;
  judgment: string;
  next_action: string;
  owner_role: string | null;
  due_on: string | null;
  consult_with: string | null;
  supplement: string;
  task_status: string;
};
type Evidence = {
  id: string;
  title: string;
  location: string;
  excerpt: string;
  published_on: string | null;
  claim: string;
};
type Candidate = {
  id: string;
  title: string;
  department: string | null;
  published_on: string | null;
  doc_type: string | null;
  score: number;
  score_method: string;
  similarity: string;
  differences: string;
  gaps: string;
  mode: string;
};
type Detail = {
  handover: Record<string, string | number | null>;
  items: Item[];
  evidences: Evidence[];
  candidates: Candidate[];
  conflicts: { id: string; kind: string; note: string; resolution_note: string | null }[];
  events: { id: string; actor: string; actor_role: string; reason: string; at: string; version: number; result: string }[];
  interview: { question_id: string; question: string; why: string; answer: string | null }[];
  questions: { id: string; question: string; answer: string; used_status: string }[];
  runs: { id: string; provider: string; model: string; is_demo: number; output_status: string; error: string | null }[];
};

export default function HandoverPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"as_of" | "hindsight">("as_of");
  const [info, setInfo] = useState("");
  const [selected, setSelected] = useState<Evidence | null>(null);
  const [ask, setAsk] = useState("산유국 협의체 회신");

  const load = useCallback(async () => {
    const detail = await api<Detail>(`/api/handovers/${params.id}`);
    setData(detail);
    setSelected(detail.evidences[0] || null);
  }, [params.id]);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  async function run(path: string, body?: unknown) {
    setError("");
    setInfo("");
    try {
      await api(path, { method: "POST", body: body ? JSON.stringify(body) : "{}" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패");
    }
  }

  if (!data) {
    return <Shell><p>{error || "불러오는 중입니다."}</p></Shell>;
  }
  const h = data.handover;
  return (
    <Shell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0b1f44]">{String(h.name)}</h1>
          <p className="mt-1 text-sm text-slate-600">기준일 {String(h.as_of)} {String(h.timezone)} · {String(h.predecessor_role)} → {String(h.successor_role)}</p>
          <p className="mt-1 text-sm">범위: {String(h.scope)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Status value={String(h.status)} />
          <span className="text-sm">현재 {String(h.current_version)} · 확정 {String(h.confirmed_version ?? "없음")} · 인수 {String(h.accepted_version ?? "없음")}</span>
          <Link className="rounded border px-3 py-1 text-sm" href={`/handovers/${params.id}/print`}>인쇄</Link>
          <a className="rounded border px-3 py-1 text-sm" href={`/api/handovers/${params.id}/export?format=md`}>Markdown</a>
          <a className="rounded border px-3 py-1 text-sm" href={`/api/handovers/${params.id}/export?format=json`}>JSON</a>
        </div>
      </div>
      {error && <p className="mt-3 rounded bg-red-50 p-3 text-red-800">{error}</p>}
      {info && <p className="mt-3 rounded bg-teal-50 p-3">{info}</p>}

      <section className="mt-4 rounded border bg-white p-4">
        <h2 className="font-semibold">상황 브리핑</h2>
        <p className="mt-2 text-sm">확인된 사실: {String(h.facts)} (출처: {String(h.fact_sources)})</p>
        <p className="text-sm">미확인: {String(h.unknowns)}</p>
        <p className="text-sm">지역·유종·수송로: {String(h.geo)}</p>
        <p className="text-sm">관찰: {String(h.observations)}</p>
        <p className="text-sm">질문: {String(h.question)}</p>
        <p className="mt-2 text-sm text-slate-500">실시간 시황은 연결되어 있지 않습니다.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="text-sm">과거 분석
            <select className="ml-2 rounded border px-2 py-1" value={mode} onChange={(e) => setMode(e.target.value as "as_of" | "hindsight")}>
              <option value="as_of">당시 판단 재구성</option>
              <option value="hindsight">사후 평가</option>
            </select>
          </label>
          <button className="rounded bg-[#0b1f44] px-3 py-1 text-white" onClick={() => run(`/api/handovers/${params.id}/discover`, { mode })}>유사 사례 찾기</button>
          <button className="rounded bg-[#0f766e] px-3 py-1 text-white" onClick={async () => {
            setError("");
            try {
              const result = await api<{ demo: boolean; withheld: string | null }>(`/api/handovers/${params.id}/frame`, { method: "POST", body: JSON.stringify({ mode }) });
              setInfo(result.demo ? "합성자료 데모 / 실제 AI 호출 없음" : "실제 모델 결과를 저장했습니다.");
              if (result.withheld) setInfo(result.withheld);
              await load();
            } catch (e) {
              setError(e instanceof Error ? e.message : "생성 실패");
            }
          }}>인수인계 초안 만들기</button>
        </div>
        {data.runs[0] && <p className="mt-2 text-sm">최근 생성: {data.runs.at(-1)?.provider} / {data.runs.at(-1)?.model} / {data.runs.at(-1)?.is_demo ? "데모" : "실제"} / {data.runs.at(-1)?.output_status}</p>}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <section className="rounded border bg-white p-4">
            <h2 className="font-semibold">과거 사례</h2>
            {!data.candidates.length && <p className="mt-2 text-sm text-slate-600">아직 후보가 없습니다. 자료를 등록한 뒤 찾기를 누르세요.</p>}
            <ul className="mt-2 space-y-3">
              {data.candidates.map((c) => (
                <li key={c.id} className="border-t pt-2 text-sm">
                  <p className="font-medium">{c.title}</p>
                  <p>시기 {c.published_on || "미확인"} · {c.department || "부서 미확인"} · {c.doc_type || "유형 미확인"} · {c.mode === "hindsight" ? "사후 평가" : "당시 판단"}</p>
                  <p>검색 순위 점수 {c.score}. {c.score_method}</p>
                  <p>비슷한 점: {c.similarity}</p>
                  <p>다른 점: {c.differences}</p>
                  <p>부족: {c.gaps || "없음"}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded border bg-white p-4">
            <h2 className="font-semibold">업무바통 카드</h2>
            {!data.items.length && <p className="mt-2 text-sm">초안이 없습니다. 근거가 없으면 문장을 만들지 않습니다.</p>}
            {data.items.map((item) => (
              <article key={item.id} className="mt-3 border-t pt-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <strong>{item.item_kind}</strong>
                  <span className="rounded bg-slate-100 px-2">{item.statement_kind}</span>
                  <Status value={item.task_status} />
                </div>
                <p className="mt-1">{item.purpose}</p>
                <p>{item.status_text}</p>
                <p>판단: {item.judgment}</p>
                <p>다음: {item.next_action} · 담당 {item.owner_role || "미지정"} · 기한 {item.due_on || "미지정"} · 협의 {item.consult_with || "미지정"}</p>
                <label className="mt-2 grid gap-1">전임자 수정
                  <textarea className="rounded border p-2" defaultValue={item.supplement} id={`sup-${item.id}`} />
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="rounded border px-2 py-1" onClick={async () => {
                    const el = document.getElementById(`sup-${item.id}`) as HTMLTextAreaElement;
                    try {
                      await api(`/api/handovers/${params.id}/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ supplement: el.value, statementKind: el.value ? "전임자 보충 설명" : item.statement_kind }) });
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "수정 실패");
                    }
                  }}>수정 저장</button>
                  {item.task_status !== "not_applicable" && (
                    <select aria-label="업무 상태" defaultValue={item.task_status} onChange={async (e) => {
                      try {
                        await api(`/api/handovers/${params.id}/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ taskStatus: e.target.value }) });
                        await load();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "상태 변경 실패");
                      }
                    }}>
                      <option value="not_started">미착수</option>
                      <option value="in_progress">진행 중</option>
                      <option value="done">완료</option>
                      <option value="on_hold">보류</option>
                    </select>
                  )}
                </div>
              </article>
            ))}
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="rounded bg-[#0b1f44] px-3 py-2 text-white" onClick={() => run(`/api/handovers/${params.id}/confirm`, { reason: "전임자가 근거와 남은 업무를 확인" })}>전임자 확정</button>
              <button className="rounded bg-[#0f766e] px-3 py-2 text-white" onClick={() => run(`/api/handovers/${params.id}/accept`)}>후임자 인수 확인</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">인수 확인은 업무 완료가 아닙니다. 확정 뒤 수정하면 새 버전이 되고 다시 검토 중으로 바뀝니다.</p>
          </section>

          <section className="rounded border bg-white p-4">
            <h2 className="font-semibold">차이·충돌 후보</h2>
            {!data.conflicts.length && <p className="mt-2 text-sm">표시할 충돌 후보가 없습니다.</p>}
            {data.conflicts.map((c) => (
              <div key={c.id} className="mt-2 text-sm">
                <p>{c.kind === "unit_or_basis" ? "단위·기준 차이" : "시점·전망과 결과"}: {c.note}</p>
                {c.resolution_note && <p>전임자 정리: {c.resolution_note}</p>}
                <button className="mt-1 rounded border px-2 py-1" onClick={async () => {
                  const note = window.prompt("선택 근거와 보충 설명을 적으세요.") || "";
                  if (!note) return;
                  try {
                    await api(`/api/conflicts/${c.id}`, { method: "POST", body: JSON.stringify({ note }) });
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "저장 실패");
                  }
                }}>해소 메모</button>
              </div>
            ))}
          </section>

          <section className="rounded border bg-white p-4">
            <h2 className="font-semibold">보완 인터뷰</h2>
            {data.interview.map((q) => (
              <div key={q.question_id} className="mt-3 text-sm">
                <p className="font-medium">{q.question}</p>
                <p className="text-slate-600">필요한 이유: {q.why}</p>
                <textarea className="mt-1 w-full rounded border p-2" defaultValue={q.answer || ""} id={`iv-${q.question_id}`} />
                <button className="mt-1 rounded border px-2 py-1" onClick={async () => {
                  const el = document.getElementById(`iv-${q.question_id}`) as HTMLTextAreaElement;
                  await run(`/api/handovers/${params.id}/interview`, { questionId: q.question_id, answer: el.value });
                }}>보충 설명으로 저장</button>
              </div>
            ))}
          </section>

          <section className="rounded border bg-white p-4">
            <h2 className="font-semibold">후임자 질문</h2>
            <textarea className="mt-2 w-full rounded border p-2" value={ask} onChange={(e) => setAsk(e.target.value)} />
            <button className="mt-2 rounded border px-3 py-1" onClick={async () => {
              try {
                const result = await api<{ answer: string; used: string }>(`/api/handovers/${params.id}/ask`, { method: "POST", body: JSON.stringify({ question: ask }) });
                setInfo(`${result.used}: ${result.answer}`);
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "질문 실패");
              }
            }}>확정본 기준으로 묻기</button>
            <ul className="mt-2 space-y-2 text-sm">
              {data.questions.map((q) => <li key={q.id}><strong>{q.used_status}</strong> {q.question} — {q.answer}</li>)}
            </ul>
          </section>

          <section className="rounded border bg-white p-4 text-sm">
            <h2 className="font-semibold">검토 기록</h2>
            <ul className="mt-2 space-y-1">
              {data.events.map((ev) => <li key={ev.id}>{ev.at} · {ev.actor_role} {ev.actor} · {ev.result} · {ev.reason} · 버전 {ev.version}</li>)}
            </ul>
          </section>
        </div>
        <aside className="rounded border bg-white p-4 lg:sticky lg:top-4 lg:h-fit" aria-label="근거 원문">
          <h2 className="font-semibold">근거 원문</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {data.evidences.map((ev) => (
              <li key={ev.id}>
                <button className="text-left text-teal-800 underline" onClick={() => setSelected(ev)}>{ev.title}</button>
                <div>{ev.location} · 발행 {ev.published_on || "미확인"}</div>
              </li>
            ))}
          </ul>
          {selected ? (
            <p className="mt-3 whitespace-pre-wrap text-sm">{selected.excerpt}</p>
          ) : (
            <p className="mt-3 text-sm text-slate-600">근거를 선택하면 발췌가 여기에 나옵니다.</p>
          )}
        </aside>
      </div>
    </Shell>
  );
}
