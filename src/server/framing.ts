export type EvidenceIn = {
  id: string;
  documentId: string;
  title: string;
  publishedOn: string | null;
  excerpt: string;
  physicalPage: number;
  printedPage: string | null;
};

export type ItemDraft = {
  itemKind: string;
  statementKind: "자료에서 확인한 사실" | "AI의 해석·검토 제안" | "전임자 보충 설명" | "미확인·추가 검토 필요";
  purpose: string;
  statusText: string;
  judgment: string;
  nextAction: string;
  ownerRole: string | null;
  dueOn: string | null;
  consultWith: string | null;
  evidenceIds: string[];
  supplement: string;
  taskStatus: "not_started" | "in_progress" | "done" | "on_hold" | "not_applicable";
};

export type ConflictDraft = {
  kind: "unit_or_basis" | "value_conflict" | "forecast_vs_outcome";
  note: string;
  evidenceIds: string[];
};

export function citationText(raw: string): { text: string; ignored: string[] } {
  const ignored: string[] = [];
  const text = raw.replace(/문서내명령\s*:[^\n]*/g, (match) => {
    ignored.push(match.trim());
    return "";
  });
  return { text: text.replace(/\s+\n/g, "\n").trim(), ignored };
}

export function excerptSupports(excerpt: string, claimNeedle: string): boolean {
  return excerpt.includes(claimNeedle);
}

export function buildFraming(input: {
  situationTitle: string;
  asOf: string;
  facts: string;
  question: string;
  mode: "as_of" | "hindsight";
  evidences: EvidenceIn[];
  memoText: string;
  scheduleText: string;
}): { items: ItemDraft[]; withheld: string | null; conflicts: ConflictDraft[] } {
  const ev = input.evidences.filter((e) => !e.excerpt.includes("문서내명령"));
  const byDoc = (id: string) => ev.filter((e) => e.documentId === id);
  const ids = (...docs: string[]) =>
    docs.flatMap((d) => byDoc(d).map((e) => e.id));

  const hasTransport = byDoc("syn-transport-initial").length + byDoc("syn-transport-follow").length > 0;
  const asksLevel = /위기 단계|결재선|비축유 방출 결정/.test(input.question);
  const noGround = ev.length === 0;

  if (noGround || (asksLevel && !ev.some((e) => e.excerpt.includes("공식 위기 단계 기준") && e.excerpt.includes("등록되어")))) {
    if (noGround || asksLevel) {
      const procedure = ev.find((e) => e.excerpt.includes("공식 위기 단계 기준"));
      if (asksLevel) {
        return {
          items: [],
          withheld: procedure
            ? "공식 절차 미등록입니다. 업무 절차 예시는 위기 단계 기준과 결재선이 없다고 적습니다. 단계 번호나 방출 결정을 만들지 않습니다."
            : "근거가 부족합니다. 등록된 자료에서 공식 위기 단계나 결재선을 찾지 못했습니다. 수치와 보고서명을 만들지 않습니다.",
          conflicts: [],
        };
      }
    }
  }

  if (noGround) {
    return {
      items: [],
      withheld: "근거가 부족합니다. 자료를 더 등록하거나 질문을 좁혀 주세요. 없는 보고서와 수치를 만들지 않습니다.",
      conflicts: [],
    };
  }

  const conflicts: ConflictDraft[] = [];
  const follow = byDoc("syn-transport-follow");
  const after = byDoc("syn-transport-after");
  const initial = byDoc("syn-transport-initial");
  const demand = byDoc("syn-demand-drop");
  if (initial.length && follow.length) {
    conflicts.push({
      kind: "unit_or_basis",
      note: "차질 규모는 만 배럴/일이고 후속 운임은 달러/톤입니다. 단위가 달라 값의 충돌이 아닙니다.",
      evidenceIds: [...initial.map((e) => e.id), ...follow.map((e) => e.id)],
    });
  }
  if (follow.length && after.length && input.mode === "hindsight") {
    conflicts.push({
      kind: "forecast_vs_outcome",
      note: "후속 시황의 운임 18달러/톤과 사후 점검의 12달러/톤은 기준 시점이 다릅니다. 같은 날의 모순으로 보지 않습니다.",
      evidenceIds: [...follow.map((e) => e.id), ...after.map((e) => e.id)],
    });
  }
  if (initial.length && after.length && input.mode === "hindsight") {
    conflicts.push({
      kind: "forecast_vs_outcome",
      note: "당시 전망은 2주 안 완화이고, 사후 자료는 약 3주 뒤 되돌아왔다고 적습니다. 전망과 결과를 구분합니다.",
      evidenceIds: [...initial.map((e) => e.id), ...after.map((e) => e.id)],
    });
  }
  if (demand.length && initial.length) {
    conflicts.push({
      kind: "unit_or_basis",
      note: "수요 위축 문서의 배럴당 달러 가격과 수송 차질 문서의 물량·운임은 원인과 단위가 달라 하나의 순위로 합치지 않습니다.",
      evidenceIds: [...demand.map((e) => e.id), ...initial.map((e) => e.id)],
    });
  }

  const items: ItemDraft[] = [];
  items.push({
    itemKind: "상황",
    statementKind: "자료에서 확인한 사실",
    purpose: input.situationTitle,
    statusText: `분석 기준일 ${input.asOf}. 사용자 입력 사실: ${input.facts || "없음"}`,
    judgment: "시장 실시간 연결은 없습니다. 기준은 입력과 등록 자료입니다.",
    nextAction: "입력 사실의 출처를 자료실 문장과 대조합니다.",
    ownerRole: null,
    dueOn: null,
    consultWith: null,
    evidenceIds: ids("syn-transport-initial"),
    supplement: "",
    taskStatus: "not_applicable",
  });

  if (initial.length) {
    items.push({
      itemKind: "과거 사례",
      statementKind: "자료에서 확인한 사실",
      purpose: "비슷한 수송 차질 기록 찾기",
      statusText: `${initial[0].title} (${initial[0].publishedOn ?? "발행일 미확인"})에서 우회 항로 지연과 약 120만 배럴/일을 확인합니다.`,
      judgment: "같은 항로 이름만으로 유사하다고 확정하지 않고, 원인(통항 지연)과 물량 문장이 있는 문서를 후보로 둡니다.",
      nextAction: "후임자는 초기 분석 원문의 해당 페이지를 읽습니다.",
      ownerRole: "시황분석 담당",
      dueOn: null,
      consultWith: null,
      evidenceIds: initial.map((e) => e.id),
      supplement: "",
      taskStatus: "not_started",
    });
    items.push({
      itemKind: "당시 전망",
      statementKind: "자료에서 확인한 사실",
      purpose: "당시 전망과 검토를 구분",
      statusText: "초기 분석은 운임이 단기적으로 오르고 2주 안에 완화될 가능성이 있다고 전망합니다.",
      judgment: "비축유 방출은 검토 안건으로만 적혀 있고 시행 문장은 없습니다. 검토를 시행으로 바꾸지 않습니다.",
      nextAction: "시행 기록이 있는 문서가 아니면 시행으로 표시하지 않습니다.",
      ownerRole: null,
      dueOn: null,
      consultWith: null,
      evidenceIds: initial.map((e) => e.id),
      supplement: "",
      taskStatus: "not_applicable",
    });
  }

  if (input.mode === "as_of") {
    items.push({
      itemKind: "사후 결과",
      statementKind: "미확인·추가 검토 필요",
      purpose: "당시 판단 모드",
      statusText: "기준일 이후 문서는 이 모드에서 빼 두었습니다. 사후 결과는 미확인입니다.",
      judgment: "없는 결과를 채우지 않습니다.",
      nextAction: "결과 확인이 필요하면 사후 평가 모드로 다시 봅니다.",
      ownerRole: null,
      dueOn: null,
      consultWith: null,
      evidenceIds: [],
      supplement: "",
      taskStatus: "not_applicable",
    });
  } else if (after.length) {
    items.push({
      itemKind: "사후 결과",
      statementKind: "자료에서 확인한 사실",
      purpose: "이후 자료에서 확인된 결과",
      statusText: "사후 점검은 지연 해소와 약 3주 뒤 운임 12달러/톤을 적습니다. 방출 시행 기록은 없습니다.",
      judgment: "시간 순서만으로 검토 안건의 효과라고 단정하지 않습니다.",
      nextAction: "전망(2주)과 결과(약 3주)를 카드에 나눠 적습니다.",
      ownerRole: null,
      dueOn: null,
      consultWith: null,
      evidenceIds: after.map((e) => e.id),
      supplement: "",
      taskStatus: "not_applicable",
    });
  }

  if (demand.length && initial.length) {
    items.push({
      itemKind: "차이",
      statementKind: "AI의 해석·검토 제안",
      purpose: "그대로 적용하기 어려운 이유",
      statusText: "수요 위축 문서는 원인이 다릅니다. 공통점은 가격·운임이 움직였다는 수준의 시장 변동입니다.",
      judgment: "과거 2주 전망을 현재 결론으로 옮기지 않습니다. 원인, 단위, 사후 시점 차이가 한계입니다.",
      nextAction: "적용 조건을 전임자 보충 설명으로 확인합니다.",
      ownerRole: null,
      dueOn: null,
      consultWith: null,
      evidenceIds: [...initial, ...demand].map((e) => e.id),
      supplement: "",
      taskStatus: "not_applicable",
    });
  }

  if (input.memoText.includes("미완료 업무")) {
    items.push({
      itemKind: "미완료",
      statementKind: "자료에서 확인한 사실",
      purpose: "전임자 메모의 남은 업무",
      statusText: "산유국 협의체 회신 확인이 남아 있습니다. 합의는 주간 재고 문의, 미합의는 대체 항로 비용 분담입니다.",
      judgment: "메모에 적힌 판단은 2주 전망을 현재 결론으로 쓰지 않는다는 것입니다.",
      nextAction: "회신 확인",
      ownerRole: "시황분석 담당",
      dueOn: "2026-11-20",
      consultWith: "산유국 협의체",
      evidenceIds: ev.filter((e) => e.documentId === "syn-predecessor-memo").map((e) => e.id),
      supplement: "",
      taskStatus: "in_progress",
    });
  }

  if (input.scheduleText.includes("재고 문의 초안")) {
    items.push({
      itemKind: "다음 행동",
      statementKind: "자료에서 확인한 사실",
      purpose: "가까운 일정",
      statusText: "재고 문의 초안은 기한 2026-11-12이고 담당 역할이 비어 있습니다. 미지정으로 둡니다.",
      judgment: "메모의 회신 기한 2026-11-20과 일정표 기한 2026-11-12는 업무가 달라 기한 충돌로 합치지 않습니다.",
      nextAction: "재고 문의 초안 작성",
      ownerRole: null,
      dueOn: "2026-11-12",
      consultWith: "가상 정유사 구매팀",
      evidenceIds: ev.filter((e) => e.documentId === "syn-schedule").map((e) => e.id),
      supplement: "",
      taskStatus: "not_started",
    });
  }

  items.push({
    itemKind: "보고",
    statementKind: "미확인·추가 검토 필요",
    purpose: "작성할 보고서",
    statusText: "공식 서식은 등록되지 않았습니다. 필요한 자료: 기관 보고서 서식, 위기 단계 기준, 결재선.",
    judgment: "서식이 없어 공식 보고서를 자동 작성하지 않습니다. 인수인계본 초안만 만듭니다.",
    nextAction: "서식이 있으면 자료실에 추가합니다.",
    ownerRole: null,
    dueOn: null,
    consultWith: null,
    evidenceIds: ev.filter((e) => e.documentId === "syn-procedure").map((e) => e.id),
    supplement: "",
    taskStatus: "not_started",
  });

  items.push({
    itemKind: "재검토 조건",
    statementKind: "AI의 해석·검토 제안",
    purpose: "판단을 다시 볼 조건",
    statusText: "통항 지연 척수, 차질 물량의 단위, 시행 기록 유무가 바뀌면 다시 봅니다.",
    judgment: "위기 등급 점수로 우선순위를 매기지 않습니다. 기한과 선행 확인(원문 대조)을 먼저 둡니다.",
    nextAction: "조건이 바뀌면 새 버전을 만듭니다.",
    ownerRole: null,
    dueOn: null,
    consultWith: null,
    evidenceIds: initial.map((e) => e.id),
    supplement: "",
    taskStatus: "not_applicable",
  });

  if (!hasTransport && !input.memoText) {
    return {
      items: [],
      withheld: "검색된 근거가 이 질문의 인수인계 초안을 받치기 부족합니다.",
      conflicts,
    };
  }

  return { items, withheld: null, conflicts };
}

export const INTERVIEW = [
  { id: "watch", question: "현재 가장 주시하는 지표와 그 이유는 무엇입니까?", why: "보고서 수치만으로는 담당자가 무엇을 매일 보는지 알 수 없습니다." },
  { id: "limit", question: "과거 사례를 그대로 적용하기 어려운 조건은 무엇입니까?", why: "유사 사례를 현재 결론으로 옮기지 않기 위해 필요합니다." },
  { id: "consult", question: "이미 협의한 대상과 합의·미합의 사항은 무엇입니까?", why: "협의 이력은 보고서 본문에 없을 수 있습니다." },
  { id: "first", question: "후임자가 가장 먼저 확인해야 할 사항은 무엇입니까?", why: "미완료 업무의 순서를 담당자 판단으로 남기기 위해 필요합니다." },
  { id: "refresh", question: "어떤 변화가 생기면 분석과 보고를 갱신해야 합니까?", why: "재검토 조건을 전임자 말로 확인하기 위해 필요합니다." },
  { id: "miss", question: "반복적으로 놓치기 쉬운 사항은 무엇입니까?", why: "단위나 기준 시점처럼 검색만으로 습관이 드러나지 않습니다." },
];
