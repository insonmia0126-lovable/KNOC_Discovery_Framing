import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import * as XLSX from "xlsx";
import type { AppDb } from "./db";
import { openDb, dataDir } from "./db";
import { INDEX_VERSION, PARSER_VERSION, extractPdf, pagesFromPlain, readMeta, sha256, type PageText } from "./extract";
import { SCORE_METHOD, eligibleByTime, rankDocuments, type SearchDoc } from "./search";
import { INTERVIEW, buildFraming, citationText, type EvidenceIn, type ItemDraft } from "./framing";
import { completeFraming, liveConfigFromEnv } from "../providers/llm";

export type Role = "predecessor" | "successor" | "reader";

const now = () => new Date().toISOString();

function id(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function assertRole(role: Role, allowed: Role[]) {
  if (!allowed.includes(role)) {
    const error = new Error("이 데모 역할로는 해당 작업을 할 수 없습니다.");
    (error as Error & { status: number }).status = 403;
    throw error;
  }
}

export function libraryStats(db: AppDb) {
  const docs = db.prepare("SELECT * FROM documents").all() as Record<string, unknown>[];
  const pages = db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number };
  const uniq = new Set(docs.map((d) => String(d.sha256))).size;
  const count = (status: string) => docs.filter((d) => d.extract_status === status).length;
  return {
    registeredFiles: docs.length,
    uniqueDocuments: uniq,
    extractSuccess: count("success"),
    extractPartial: count("partial"),
    extractFailed: count("failed"),
    indexed: count("success") + count("partial"),
    totalPages: pages.n,
    duplicateFiles: docs.length - uniq,
    targetPdfCount: 6000,
    fullCorpusVerification: "미실시",
    note: "6,000개는 목표 자료 규모입니다. 아래 숫자는 이 저장소에 실제로 등록한 파일만 집계합니다.",
  };
}

export function listDocuments(db: AppDb) {
  return db.prepare("SELECT * FROM documents ORDER BY created_at DESC").all();
}

export function getDocument(db: AppDb, documentId: string) {
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
  if (!doc) return null;
  const chunks = db
    .prepare("SELECT * FROM chunks WHERE document_id = ? ORDER BY physical_page")
    .all(documentId);
  return { document: doc, chunks };
}

function insertPages(db: AppDb, documentId: string, pages: PageText[], method: string) {
  db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);
  const insert = db.prepare(
    `INSERT INTO chunks (id, document_id, physical_page, printed_page, section_id, text, method, quality)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ignored = pages.flatMap((p) => p.ignored);
  for (const page of pages) {
    insert.run(
      id("chk"),
      documentId,
      page.physicalPage,
      page.printedPage,
      `p${page.physicalPage}`,
      page.text,
      method,
      page.quality,
    );
  }
  const empty = pages.filter((p) => p.quality !== "ok").length;
  const status = pages.length === 0 ? "failed" : empty && empty < pages.length ? "partial" : empty ? "failed" : "success";
  const meta = readMeta(pages.map((p) => p.text).join("\n"));
  db.prepare(
    `UPDATE documents SET title = COALESCE(?, title), title_source = CASE WHEN ? IS NULL THEN title_source ELSE 'extracted' END,
      published_on = COALESCE(?, published_on), published_on_source = CASE WHEN ? IS NULL THEN published_on_source ELSE 'extracted' END,
      department = COALESCE(?, department), department_source = CASE WHEN ? IS NULL THEN department_source ELSE 'extracted' END,
      doc_type = COALESCE(?, doc_type), page_count = ?, extract_status = ?, ignored_instructions = ?
     WHERE id = ?`,
  ).run(
    meta.title,
    meta.title,
    meta.publishedOn,
    meta.publishedOn,
    meta.department,
    meta.department,
    meta.docType,
    pages.length,
    status,
    ignored.length ? JSON.stringify(ignored) : null,
    documentId,
  );
  return status;
}

export async function processJob(db: AppDb, jobId: string) {
  const job = db.prepare("SELECT * FROM index_jobs WHERE id = ?").get(jobId) as
    | { id: string; document_id: string; attempts: number; stage: string }
    | undefined;
  if (!job || (job.stage !== "queued" && job.stage !== "retry")) return;
  db.prepare(
    "UPDATE index_jobs SET stage = 'extracting', attempts = ?, started_at = ?, error_summary = NULL WHERE id = ?",
  ).run(job.attempts + 1, now(), job.id);
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(job.document_id) as
    | { stored_path: string; original_name: string }
    | undefined;
  if (!doc?.stored_path) {
    db.prepare("UPDATE index_jobs SET stage = 'failed', finished_at = ?, error_summary = ? WHERE id = ?").run(
      now(),
      "파일 경로 없음",
      job.id,
    );
    return;
  }
  try {
    const buf = fs.readFileSync(doc.stored_path);
    const name = doc.original_name.toLowerCase();
    let pages: PageText[] = [];
    let method = "plain";
    let note: string | null = null;
    if (name.endsWith(".pdf")) {
      const extracted = await extractPdf(buf);
      pages = extracted.pages;
      note = extracted.note;
      method = "pdfjs";
      if (note && pages.length === 0) {
        db.prepare("UPDATE documents SET extract_status = 'failed', extract_note = ? WHERE id = ?").run(
          note,
          job.document_id,
        );
        db.prepare("UPDATE index_jobs SET stage = 'failed', finished_at = ?, error_summary = ? WHERE id = ?").run(
          now(),
          note,
          job.id,
        );
        return;
      }
    } else if (name.endsWith(".xlsx")) {
      const book = XLSX.read(buf, { type: "buffer" });
      const lines: string[] = ["가상 시나리오·합성 자료"];
      for (const sheet of book.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1 }) as unknown[][];
        for (const row of rows) lines.push((row as unknown[]).map((c) => String(c ?? "")).join(" | "));
      }
      pages = pagesFromPlain(lines.join("\n"));
      method = "xlsx";
    } else if (name.endsWith(".txt")) {
      pages = pagesFromPlain(buf.toString("utf8"));
      method = "txt";
    } else {
      db.prepare("UPDATE documents SET extract_status = 'unsupported', extract_note = ? WHERE id = ?").run(
        "지원하지 않는 형식",
        job.document_id,
      );
      db.prepare("UPDATE index_jobs SET stage = 'failed', finished_at = ?, error_summary = ? WHERE id = ?").run(
        now(),
        "미지원 형식",
        job.id,
      );
      return;
    }
    const status = insertPages(db, job.document_id, pages, method);
    db.prepare("UPDATE documents SET extract_note = ? WHERE id = ?").run(note, job.document_id);
    db.prepare("UPDATE index_jobs SET stage = ?, finished_at = ? WHERE id = ?").run(
      status === "failed" ? "failed" : "done",
      now(),
      job.id,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "처리 실패";
    db.prepare("UPDATE documents SET extract_status = 'failed', extract_note = ? WHERE id = ?").run(
      message,
      job.document_id,
    );
    db.prepare("UPDATE index_jobs SET stage = 'failed', finished_at = ?, error_summary = ? WHERE id = ?").run(
      now(),
      message,
      job.id,
    );
  }
}

export async function drainQueue(db: AppDb, limit = 20) {
  const jobs = db
    .prepare("SELECT id FROM index_jobs WHERE stage IN ('queued','retry') ORDER BY rowid LIMIT ?")
    .all(limit) as { id: string }[];
  for (const job of jobs) await processJob(db, job.id);
  return jobs.length;
}

export function registerFile(
  db: AppDb,
  file: { originalName: string; bytes: Buffer; handoverId?: string | null; synthetic?: boolean },
) {
  const safeName = path.basename(file.originalName).replace(/[^\w.\-가-힣 ]+/g, "_");
  const hash = sha256(file.bytes);
  const existing = db.prepare("SELECT id FROM documents WHERE sha256 = ? AND original_name = ?").get(hash, safeName) as
    | { id: string }
    | undefined;
  if (existing) return { documentId: existing.id, duplicate: true };
  const documentId = id("doc");
  const stored = path.join(dataDir(), "originals", `${documentId}_${safeName}`);
  fs.writeFileSync(stored, file.bytes);
  const ext = safeName.toLowerCase();
  const supported = ext.endsWith(".pdf") || ext.endsWith(".txt") || ext.endsWith(".xlsx");
  db.prepare(
    `INSERT INTO documents (
      id, original_name, stored_path, title, title_source, sha256, published_on, published_on_source,
      doc_type, department, department_source, access_scope, rights_status, ai_transfer, version_label,
      page_count, extract_status, extract_note, is_synthetic, handover_id, created_at
    ) VALUES (?, ?, ?, ?, 'unknown', ?, NULL, 'unknown', NULL, NULL, 'unknown', ?, 'readable_local', 'unknown', '1', NULL, ?, NULL, ?, ?, ?)`,
  ).run(
    documentId,
    safeName,
    stored,
    safeName,
    hash,
    file.handoverId ? "handover" : "library",
    supported ? "queued" : "unsupported",
    file.synthetic ? 1 : 0,
    file.handoverId ?? null,
    now(),
  );
  if (!supported) {
    db.prepare("UPDATE documents SET extract_note = ? WHERE id = ?").run("지원하지 않는 형식", documentId);
  } else {
    db.prepare(
      `INSERT INTO index_jobs (id, document_id, stage, attempts, parser_version, index_version, resume_at)
       VALUES (?, ?, 'queued', 0, ?, ?, 'start')`,
    ).run(id("job"), documentId, PARSER_VERSION, INDEX_VERSION);
  }
  return { documentId, duplicate: false };
}

export function markRestricted(db: AppDb, originalName: string) {
  db.prepare(
    "UPDATE documents SET rights_status = 'restricted', ai_transfer = 'denied' WHERE original_name = ?",
  ).run(originalName);
}

function docsForSearch(db: AppDb, handoverId: string | null, includeRestricted: boolean): SearchDoc[] {
  const rows = db.prepare("SELECT * FROM documents").all() as Record<string, string>[];
  const out: SearchDoc[] = [];
  for (const row of rows) {
    if (row.handover_id && row.handover_id !== handoverId) continue;
    if (row.rights_status === "restricted" && !includeRestricted) continue;
    if (row.extract_status !== "success" && row.extract_status !== "partial") continue;
    const chunks = db.prepare("SELECT text FROM chunks WHERE document_id = ?").all(row.id) as { text: string }[];
    out.push({
      id: row.id,
      title: row.title || row.original_name,
      publishedOn: row.published_on,
      rights: row.rights_status || "readable_local",
      text: chunks.map((c) => c.text).join("\n"),
    });
  }
  return out;
}

export function createHandover(
  db: AppDb,
  input: {
    name: string;
    predecessorRole: string;
    successorRole: string;
    scope: string;
    asOf: string;
    timezone: string;
    facts: string;
    factSources: string;
    unknowns: string;
    geo: string;
    observations: string;
    question: string;
  },
) {
  const handoverId = id("hnd");
  const ts = now();
  db.prepare(
    `INSERT INTO handovers (
      id, name, predecessor_role, successor_role, scope, as_of, timezone, facts, fact_sources, unknowns, geo,
      observations, question, status, current_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft_ai', 1, ?, ?)`,
  ).run(
    handoverId,
    input.name,
    input.predecessorRole,
    input.successorRole,
    input.scope,
    input.asOf,
    input.timezone,
    input.facts,
    input.factSources,
    input.unknowns,
    input.geo,
    input.observations,
    input.question,
    ts,
    ts,
  );
  for (const q of INTERVIEW) {
    db.prepare(
      `INSERT INTO interview (id, handover_id, question_id, question, why, answer, linked_item_kind)
       VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(id("iv"), handoverId, q.id, q.question, q.why);
  }
  return handoverId;
}

function corpusIdByTitle(db: AppDb): Map<string, string> {
  const rows = db.prepare("SELECT id, title, original_name FROM documents").all() as {
    id: string;
    title: string;
    original_name: string;
  }[];
  const map = new Map<string, string>();
  const aliases: Record<string, string> = {
    "가상 수송로 차질 초기 분석": "syn-transport-initial",
    "가상 수송로 차질 후속 시황": "syn-transport-follow",
    "가상 수송로 차질 사후 점검": "syn-transport-after",
    "가상 수요 위축에 따른 가격 변동": "syn-demand-drop",
    "가상 열람제한 예시": "syn-restricted",
    "가상 빈 페이지 포함 문서": "syn-sparse-page",
    "전임자 업무 메모": "syn-predecessor-memo",
    "업무 절차 예시": "syn-procedure",
    "협의 일정표": "syn-schedule",
  };
  for (const row of rows) {
    const key = aliases[row.title] || aliases[row.original_name.replace(/_/g, " ")];
    if (key) map.set(key, row.id);
  }
  return map;
}

export function discover(db: AppDb, handoverId: string, mode: "as_of" | "hindsight") {
  const handover = db.prepare("SELECT * FROM handovers WHERE id = ?").get(handoverId) as
    | Record<string, string>
    | undefined;
  if (!handover) throw new Error("인수인계 건이 없습니다.");
  db.prepare("DELETE FROM candidates WHERE handover_id = ?").run(handoverId);
  db.prepare("DELETE FROM evidences WHERE handover_id = ?").run(handoverId);
  const catalog = docsForSearch(db, handoverId, false);
  const ranked = rankDocuments(handover.question || handover.name, catalog, { limit: 8 });
  const excluded: { title: string; warning: string }[] = [];
  const kept: typeof ranked = [];
  for (const row of catalog) {
    const gate = eligibleByTime(row.publishedOn, mode, handover.as_of);
    if (!gate.include && gate.warning) excluded.push({ title: row.title, warning: gate.warning });
  }
  for (const hit of ranked) {
    const doc = catalog.find((d) => d.id === hit.id);
    if (!doc) continue;
    const gate = eligibleByTime(doc.publishedOn, mode, handover.as_of);
    if (!gate.include) continue;
    kept.push(hit);
    const chunks = db
      .prepare("SELECT * FROM chunks WHERE document_id = ? ORDER BY physical_page")
      .all(hit.id) as { id: string; text: string; physical_page: number; printed_page: string }[];
    const chunk = chunks.find((c) => c.text && hit.hits.some((h) => c.text.includes(h))) || chunks.find((c) => c.text);
    if (!chunk) continue;
    const { text } = citationText(chunk.text);
    const excerpt = text.slice(0, 500);
    db.prepare(
      `INSERT INTO evidences (id, handover_id, chunk_id, document_id, location, excerpt, claim, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'stored_text_match')`,
    ).run(
      id("ev"),
      handoverId,
      chunk.id,
      hit.id,
      `물리 ${chunk.physical_page}쪽 / 인쇄 ${chunk.printed_page || "미확인"}쪽`,
      excerpt,
      hit.hits.join(", "),
      );
    const differences =
      doc.text.includes("수요 위축") && (handover.question.includes("수송") || handover.name.includes("수송"))
        ? "원인은 수요 위축으로 적혀 있어 수송 차질과 같지 않습니다."
        : gate.warning === "사후 자료"
          ? "기준일 이후 자료입니다. 당시 판단에 섞지 않습니다."
          : "자료에 없는 비교 항목은 비교 불가로 둡니다.";
    db.prepare(
      `INSERT INTO candidates (id, handover_id, mode, document_id, period_label, score, score_method, similarity, differences, gaps, review_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate')`,
    ).run(
      id("case"),
      handoverId,
      mode,
      hit.id,
      doc.publishedOn,
      hit.score,
      SCORE_METHOD,
      `검색 토큰 일치: ${hit.hits.join(", ")}`,
      differences,
      doc.text.includes("미확인") ? "문서가 미확인이라고 밝힌 항목이 있습니다." : "",
    );
  }
  return { kept: kept.length, excluded, method: SCORE_METHOD };
}

function evidenceViews(db: AppDb, handoverId: string): EvidenceIn[] {
  const alias = corpusIdByTitle(db);
  const reverse = new Map([...alias.entries()].map(([k, v]) => [v, k]));
  const rows = db.prepare("SELECT * FROM evidences WHERE handover_id = ?").all(handoverId) as Record<string, string>[];
  const docs = db.prepare("SELECT id, title, published_on FROM documents").all() as Record<string, string>[];
  return rows.map((row) => {
    const doc = docs.find((d) => d.id === row.document_id);
    const chunk = db.prepare("SELECT physical_page, printed_page FROM chunks WHERE id = ?").get(row.chunk_id) as
      | { physical_page: number; printed_page: string }
      | undefined;
    return {
      id: row.id,
      documentId: reverse.get(row.document_id) || row.document_id,
      title: doc?.title || "",
      publishedOn: doc?.published_on || null,
      excerpt: row.excerpt,
      physicalPage: chunk?.physical_page || 0,
      printedPage: chunk?.printed_page || null,
    };
  });
}

function textOf(db: AppDb, titleIncludes: string) {
  const docs = db.prepare("SELECT id, title FROM documents").all() as { id: string; title: string }[];
  const doc = docs.find((d) => (d.title || "").includes(titleIncludes));
  if (!doc) return "";
  const chunks = db.prepare("SELECT text FROM chunks WHERE document_id = ?").all(doc.id) as { text: string }[];
  return chunks.map((c) => c.text).join("\n");
}

function saveItems(db: AppDb, handoverId: string, version: number, items: ItemDraft[]) {
  db.prepare("DELETE FROM handover_items WHERE handover_id = ? AND version = ?").run(handoverId, version);
  const insert = db.prepare(
    `INSERT INTO handover_items (
      id, handover_id, version, item_kind, statement_kind, purpose, status_text, judgment, next_action,
      owner_role, due_on, consult_with, evidence_ids, supplement, review_status, task_status, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
  );
  items.forEach((item, index) => {
    insert.run(
      id("item"),
      handoverId,
      version,
      item.itemKind,
      item.statementKind,
      item.purpose,
      item.statusText,
      item.judgment,
      item.nextAction,
      item.ownerRole,
      item.dueOn,
      item.consultWith,
      JSON.stringify(item.evidenceIds),
      item.supplement,
      item.taskStatus,
      index,
    );
  });
}

export async function frame(db: AppDb, handoverId: string, mode: "as_of" | "hindsight") {
  const handover = db.prepare("SELECT * FROM handovers WHERE id = ?").get(handoverId) as Record<string, string>;
  if (!handover) throw new Error("인수인계 건이 없습니다.");
  discover(db, handoverId, mode);
  const evidences = evidenceViews(db, handoverId);
  const knownIds = new Set(
    (db.prepare("SELECT id FROM evidences WHERE handover_id = ?").all(handoverId) as { id: string }[]).map((e) => e.id),
  );
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get() as {
    mode: string;
    model_base_url: string;
    model_name: string;
    timeout_ms: number;
  };
  const started = Date.now();
  let items: ItemDraft[] = [];
  let withheld: string | null = null;
  let provider = "demo";
  let model = "synthetic-rules";
  let isDemo = 1;
  let error: string | null = null;
  let output = "ok";

  if (settings.mode === "live") {
    const config = liveConfigFromEnv(settings);
    provider = "openai-compatible";
    isDemo = 0;
    if ("error" in config) {
      error = config.error;
      output = "error";
      model = settings.model_name || "unset";
    } else {
      try {
        const allowedDocs = new Set(
          (db.prepare("SELECT id FROM documents WHERE ai_transfer = 'allowed_synthetic'").all() as { id: string }[]).map(
            (d) => d.id,
          ),
        );
        const payloadEv = (db.prepare("SELECT * FROM evidences WHERE handover_id = ?").all(handoverId) as Record<string, string>[])
          .filter((e) => allowedDocs.has(e.document_id))
          .map((e) => ({ id: e.id, excerpt: e.excerpt.slice(0, 400) }));
        const live = await completeFraming(config, { question: handover.question, evidences: payloadEv });
        model = live.model;
        for (const item of live.json.items) {
          for (const evidenceId of item.evidenceIds) {
            if (!knownIds.has(evidenceId)) throw new Error("모델이 없는 근거 id를 반환했습니다.");
          }
        }
        items = live.json.items;
        withheld = live.json.withheld;
      } catch (err) {
        error = err instanceof Error ? err.message : "모델 호출 실패";
        output = "error";
      }
    }
  } else {
    const draft = buildFraming({
      situationTitle: handover.name,
      asOf: handover.as_of,
      facts: handover.facts,
      question: handover.question,
      mode,
      evidences,
      memoText: textOf(db, "전임자 업무 메모"),
      scheduleText: textOf(db, "협의 일정표"),
    });
    items = draft.items;
    withheld = draft.withheld;
    db.prepare("DELETE FROM conflicts WHERE handover_id = ?").run(handoverId);
    for (const conflict of draft.conflicts) {
      db.prepare(
        `INSERT INTO conflicts (id, handover_id, kind, note, evidence_ids) VALUES (?, ?, ?, ?, ?)`,
      ).run(id("conf"), handoverId, conflict.kind, conflict.note, JSON.stringify(conflict.evidenceIds));
    }
  }

  if (output === "ok") saveItems(db, handoverId, Number(handover.current_version), items);
  db.prepare(
    `INSERT INTO generation_runs (
      id, handover_id, provider, model, prompt_version, as_of, evidence_ids, input_status, output_status, duration_ms, error, is_demo
    ) VALUES (?, ?, ?, ?, 'framing-v1', ?, ?, 'registered', ?, ?, ?, ?)`,
  ).run(
    id("gen"),
    handoverId,
    provider,
    model,
    handover.as_of,
    JSON.stringify([...knownIds]),
    output,
    Date.now() - started,
    error,
    isDemo,
  );
  if (error) {
    const wrapped = new Error(error);
    (wrapped as Error & { status: number }).status = 502;
    throw wrapped;
  }
  return { withheld, count: items.length, demo: Boolean(isDemo) };
}

export function listHandovers(db: AppDb) {
  return db.prepare("SELECT * FROM handovers ORDER BY updated_at DESC").all();
}

export function handoverDetail(db: AppDb, handoverId: string) {
  const handover = db.prepare("SELECT * FROM handovers WHERE id = ?").get(handoverId);
  if (!handover) return null;
  const version = (handover as { current_version: number }).current_version;
  return {
    handover,
    items: db
      .prepare("SELECT * FROM handover_items WHERE handover_id = ? AND version = ? ORDER BY sort_order")
      .all(handoverId, version),
    evidences: db.prepare(
      `SELECT e.*, d.title, d.published_on, d.original_name, c.physical_page, c.printed_page, c.text AS chunk_text
       FROM evidences e JOIN documents d ON d.id = e.document_id JOIN chunks c ON c.id = e.chunk_id
       WHERE e.handover_id = ?`,
    ).all(handoverId),
    candidates: db.prepare(
      `SELECT c.*, d.title, d.department, d.published_on, d.doc_type FROM candidates c
       JOIN documents d ON d.id = c.document_id WHERE c.handover_id = ? ORDER BY c.score DESC`,
    ).all(handoverId),
    conflicts: db.prepare("SELECT * FROM conflicts WHERE handover_id = ?").all(handoverId),
    events: db.prepare("SELECT * FROM review_events WHERE handover_id = ? ORDER BY at").all(handoverId),
    interview: db.prepare("SELECT * FROM interview WHERE handover_id = ?").all(handoverId),
    questions: db.prepare("SELECT * FROM successor_questions WHERE handover_id = ? ORDER BY created_at").all(handoverId),
    runs: db
      .prepare(
        "SELECT id, provider, model, prompt_version, as_of, output_status, duration_ms, error, is_demo, evidence_ids FROM generation_runs WHERE handover_id = ?",
      )
      .all(handoverId),
  };
}

function event(
  db: AppDb,
  handoverId: string,
  actor: string,
  role: Role,
  before: unknown,
  after: unknown,
  reason: string,
  version: number,
  result: string,
) {
  db.prepare(
    `INSERT INTO review_events (id, handover_id, actor, actor_role, before_json, after_json, reason, at, version, result)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id("rev"), handoverId, actor, role, JSON.stringify(before), JSON.stringify(after), reason, now(), version, result);
}

export function updateItem(
  db: AppDb,
  role: Role,
  actor: string,
  handoverId: string,
  itemId: string,
  patch: Partial<{
    purpose: string;
    statusText: string;
    judgment: string;
    nextAction: string;
    ownerRole: string | null;
    dueOn: string | null;
    consultWith: string | null;
    supplement: string;
    taskStatus: string;
    statementKind: string;
  }>,
) {
  assertRole(role, ["predecessor"]);
  const handover = db.prepare("SELECT * FROM handovers WHERE id = ?").get(handoverId) as {
    current_version: number;
    status: string;
    confirmed_version: number | null;
  };
  const item = db.prepare("SELECT * FROM handover_items WHERE id = ? AND handover_id = ?").get(itemId, handoverId) as
    | Record<string, unknown>
    | undefined;
  if (!handover || !item) throw new Error("항목이 없습니다.");
  let version = handover.current_version;
  let targetId = itemId;
  if (handover.status === "predecessor_confirmed" || handover.status === "successor_accepted") {
    version += 1;
    const rows = db
      .prepare("SELECT * FROM handover_items WHERE handover_id = ? AND version = ?")
      .all(handoverId, handover.current_version) as Record<string, unknown>[];
    const insert = db.prepare(
      `INSERT INTO handover_items (
        id, handover_id, version, item_kind, statement_kind, purpose, status_text, judgment, next_action,
        owner_role, due_on, consult_with, evidence_ids, supplement, review_status, task_status, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reopened', ?, ?)`,
    );
    for (const row of rows) {
      const nextId = id("item");
      if (row.id === itemId) targetId = nextId;
      insert.run(
        nextId,
        handoverId,
        version,
        row.item_kind,
        row.statement_kind,
        row.purpose,
        row.status_text,
        row.judgment,
        row.next_action,
        row.owner_role,
        row.due_on,
        row.consult_with,
        row.evidence_ids,
        row.supplement,
        row.task_status,
        row.sort_order,
      );
    }
    db.prepare("UPDATE handovers SET current_version = ?, status = 'predecessor_review', updated_at = ? WHERE id = ?").run(
      version,
      now(),
      handoverId,
    );
    event(db, handoverId, actor, role, { status: handover.status }, { status: "predecessor_review", version }, "확정본 수정으로 새 버전", version, "reopened");
  } else {
    db.prepare("UPDATE handovers SET status = 'predecessor_review', updated_at = ? WHERE id = ?").run(now(), handoverId);
  }
  const current = db
    .prepare("SELECT * FROM handover_items WHERE id = ? AND version = ?")
    .get(targetId, version) as Record<string, unknown>;
  db.prepare(
    `UPDATE handover_items SET purpose=?, status_text=?, judgment=?, next_action=?, owner_role=?, due_on=?, consult_with=?, supplement=?, task_status=?, statement_kind=?
     WHERE id = ? AND version = ?`,
  ).run(
    patch.purpose ?? current.purpose,
    patch.statusText ?? current.status_text,
    patch.judgment ?? current.judgment,
    patch.nextAction ?? current.next_action,
    patch.ownerRole === undefined ? current.owner_role : patch.ownerRole,
    patch.dueOn === undefined ? current.due_on : patch.dueOn,
    patch.consultWith === undefined ? current.consult_with : patch.consultWith,
    patch.supplement ?? current.supplement,
    patch.taskStatus ?? current.task_status,
    patch.statementKind ?? current.statement_kind,
    targetId,
    version,
  );
  return { itemId: targetId, version };
  event(db, handoverId, actor, role, current, patch, "항목 수정", version, "edited");
}

export function confirmHandover(db: AppDb, role: Role, actor: string, handoverId: string, reason: string) {
  assertRole(role, ["predecessor"]);
  const handover = db.prepare("SELECT * FROM handovers WHERE id = ?").get(handoverId) as {
    current_version: number;
    status: string;
  };
  if (!handover) throw new Error("인수인계 건이 없습니다.");
  const items = db
    .prepare("SELECT COUNT(*) AS n FROM handover_items WHERE handover_id = ? AND version = ?")
    .get(handoverId, handover.current_version) as { n: number };
  if (!items.n) throw new Error("확정할 초안이 없습니다.");
  db.prepare(
    "UPDATE handovers SET status = 'predecessor_confirmed', confirmed_version = ?, updated_at = ? WHERE id = ?",
  ).run(handover.current_version, now(), handoverId);
  event(db, handoverId, actor, role, { status: handover.status }, { status: "predecessor_confirmed" }, reason, handover.current_version, "confirmed");
}

export function acceptHandover(db: AppDb, role: Role, actor: string, handoverId: string) {
  assertRole(role, ["successor"]);
  const handover = db.prepare("SELECT * FROM handovers WHERE id = ?").get(handoverId) as {
    status: string;
    confirmed_version: number | null;
  };
  if (!handover) throw new Error("인수인계 건이 없습니다.");
  if (handover.status !== "predecessor_confirmed" || !handover.confirmed_version) {
    throw new Error("전임자 확정 버전만 인수할 수 있습니다.");
  }
  db.prepare(
    "UPDATE handovers SET status = 'successor_accepted', accepted_version = ?, accepted_at = ?, updated_at = ? WHERE id = ?",
  ).run(handover.confirmed_version, now(), now(), handoverId);
  event(
    db,
    handoverId,
    actor,
    role,
    { status: handover.status },
    { status: "successor_accepted", version: handover.confirmed_version },
    "후임자 인수 확인",
    handover.confirmed_version,
    "accepted",
  );
}

export function answerInterview(db: AppDb, role: Role, handoverId: string, questionId: string, answer: string) {
  assertRole(role, ["predecessor"]);
  db.prepare("UPDATE interview SET answer = ?, linked_item_kind = '보충' WHERE handover_id = ? AND question_id = ?").run(
    answer,
    handoverId,
    questionId,
  );
  const handover = db.prepare("SELECT current_version, status FROM handovers WHERE id = ?").get(handoverId) as {
    current_version: number;
    status: string;
  };
  if (handover.status === "predecessor_confirmed" || handover.status === "successor_accepted") {
    db.prepare("UPDATE handovers SET status = 'predecessor_review', updated_at = ? WHERE id = ?").run(now(), handoverId);
  }
  const itemId = id("item");
  db.prepare(
    `INSERT INTO handover_items (
      id, handover_id, version, item_kind, statement_kind, purpose, status_text, judgment, next_action,
      owner_role, due_on, consult_with, evidence_ids, supplement, review_status, task_status, sort_order
    ) VALUES (?, ?, ?, '보충', '전임자 보충 설명', ?, ?, '', '', NULL, NULL, NULL, '[]', ?, 'open', 'not_applicable', 99)`,
  ).run(itemId, handoverId, handover.current_version, questionId, answer, answer);
}

export function askSuccessor(db: AppDb, role: Role, handoverId: string, question: string) {
  assertRole(role, ["successor", "predecessor", "reader"]);
  const handover = db.prepare("SELECT * FROM handovers WHERE id = ?").get(handoverId) as Record<string, string | number | null>;
  const confirmed = Number(handover.confirmed_version || 0);
  const items = confirmed
    ? (db.prepare("SELECT * FROM handover_items WHERE handover_id = ? AND version = ?").all(handoverId, confirmed) as Record<string, string>[])
    : [];
  const blob = items.map((i) => `${i.purpose} ${i.status_text} ${i.judgment} ${i.supplement}`).join("\n");
  const drafts = db
    .prepare("SELECT status_text, supplement FROM handover_items WHERE handover_id = ? AND version = ?")
    .all(handoverId, handover.current_version) as { status_text: string; supplement: string }[];
  const inDraftOnly = drafts.some((d) => question && (d.supplement.includes(question) || d.status_text.includes(question.slice(0, 8))));
  let answer = "확정본과 접근 가능한 자료에서 이 질문의 문장을 찾지 못했습니다. 없는 내용은 만들지 않습니다.";
  let used = confirmed ? "확정본" : "확정본 없음";
  if (confirmed && blob.includes(question.slice(0, 12)) && question.length > 4) {
    const hit = items.find((i) => `${i.purpose} ${i.status_text} ${i.judgment}`.includes(question.slice(0, 8)));
    answer = hit ? `${hit.statement_kind}: ${hit.status_text}` : answer;
  } else if (!confirmed) {
    answer = "아직 전임자 확정본이 없습니다. 초안을 확정 사실처럼 답하지 않습니다.";
    used = "초안·미확정";
  } else if (inDraftOnly) {
    used = "초안·미확정 참고";
    answer = "현재 초안에만 가까운 문장이 있습니다. 확정본은 수정하지 않았고, 확정 사실로 보지 않습니다.";
  }
  db.prepare(
    `INSERT INTO successor_questions (id, handover_id, question, answer, used_status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id("sq"), handoverId, question, answer, used, now());
  return { answer, used };
}

export function exportHandover(db: AppDb, handoverId: string, format: "json" | "md") {
  const detail = handoverDetail(db, handoverId);
  if (!detail) throw new Error("없습니다.");
  const evidences = detail.evidences as Record<string, string>[];
  const safe = {
    ...detail,
    evidences: evidences.map((e) => ({
      ...e,
      chunk_text: undefined,
    })),
  };
  if (format === "json") return JSON.stringify(safe, null, 2);
  const h = detail.handover as Record<string, string | number | null>;
  const lines = [
    `# ${h.name}`,
    "",
    "합성자료 데모에서 만든 인수인계본일 수 있습니다. 페트로넷 원문이 아닙니다.",
    "",
    `- 상태: ${h.status}`,
    `- 현재 버전: ${h.current_version}`,
    `- 확정 버전: ${h.confirmed_version ?? "없음"}`,
    `- 인수 버전: ${h.accepted_version ?? "없음"}`,
    `- 기준일: ${h.as_of} (${h.timezone})`,
    `- 전임 역할: ${h.predecessor_role}`,
    `- 후임 역할: ${h.successor_role}`,
    "",
    "## 카드",
  ];
  for (const item of detail.items as Record<string, string | null>[]) {
    lines.push(`### ${item.item_kind}: ${item.purpose}`);
    lines.push(`- 구분: ${item.statement_kind}`);
    lines.push(`- 내용: ${item.status_text}`);
    lines.push(`- 판단: ${item.judgment}`);
    lines.push(`- 다음 행동: ${item.next_action}`);
    lines.push(`- 담당 역할: ${item.owner_role || "미지정"}`);
    lines.push(`- 기한: ${item.due_on || "미지정"}`);
    lines.push(`- 협의 대상: ${item.consult_with || "미지정"}`);
    lines.push(`- 업무 상태: ${item.task_status}`);
    lines.push(`- 보충: ${item.supplement || "없음"}`);
    lines.push("");
  }
  lines.push("## 근거");
  for (const ev of evidences) {
    if (String(ev.excerpt).includes("999만")) continue;
    lines.push(`- ${ev.title} ${ev.location}: ${ev.excerpt}`);
  }
  return lines.join("\n");
}

export function updateSettings(
  db: AppDb,
  patch: Partial<{ orgName: string; workTypes: string; mode: "demo" | "live"; modelBaseUrl: string; modelName: string; embedModel: string; timeoutMs: number }>,
) {
  const current = db.prepare("SELECT * FROM settings WHERE id = 1").get() as Record<string, string | number>;
  db.prepare(
    `UPDATE settings SET org_name=?, work_types=?, mode=?, model_base_url=?, model_name=?, embed_model=?, timeout_ms=? WHERE id=1`,
  ).run(
    patch.orgName ?? current.org_name,
    patch.workTypes ?? current.work_types,
    patch.mode ?? current.mode,
    patch.modelBaseUrl ?? current.model_base_url,
    patch.modelName ?? current.model_name,
    patch.embedModel ?? current.embed_model,
    patch.timeoutMs ?? current.timeout_ms,
  );
}

export function publicSettings(db: AppDb) {
  const row = db.prepare("SELECT org_name, work_types, mode, model_base_url, model_name, embed_model, timeout_ms FROM settings WHERE id = 1").get() as Record<string, string | number>;
  return {
    ...row,
    llmKeyConfigured: Boolean(process.env.LLM_API_KEY),
    embedConfigured: false,
    supportedFormats: ["pdf", "txt", "xlsx"],
    unsupported: ["hwp", "hwpx", "ocr", "docx", "실시간 시황"],
    twoModelCheck: "미완료",
    authMode: "단일 PC 데모. 역할 헤더는 로그인 권한이 아닙니다.",
  };
}

export function resolveConflict(db: AppDb, role: Role, conflictId: string, note: string) {
  assertRole(role, ["predecessor"]);
  db.prepare("UPDATE conflicts SET resolution = 'predecessor', resolution_note = ?, resolved_at = ? WHERE id = ?").run(
    note,
    now(),
    conflictId,
  );
}

let singleton: AppDb | null = null;
export function db() {
  if (!singleton) singleton = openDb();
  return singleton;
}

export async function seedSamples(db: AppDb) {
  const root = path.join(process.cwd(), "sample-data", "files");
  if (!fs.existsSync(root)) throw new Error("sample-data/files 가 없습니다. npm run generate-samples 를 먼저 실행하세요.");
  const files = fs.readdirSync(root);
  for (const name of files) {
    const bytes = fs.readFileSync(path.join(root, name));
    const before = sha256(bytes);
    registerFile(db, { originalName: name, bytes, synthetic: true });
    const after = sha256(fs.readFileSync(path.join(root, name)));
    if (before !== after) throw new Error("원본 해시가 변했습니다.");
  }
  await drainQueue(db, 50);
  markRestricted(db, "가상_열람제한_예시.pdf");
  const dup = db.prepare("SELECT COUNT(*) AS n FROM documents WHERE sha256 IN (SELECT sha256 FROM documents GROUP BY sha256 HAVING COUNT(*) > 1)").get() as { n: number };
  return { files: files.length, duplicateRows: dup.n, stats: libraryStats(db) };
}
