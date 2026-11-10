import { NextResponse } from "next/server";
import {
  acceptHandover,
  answerInterview,
  askSuccessor,
  confirmHandover,
  createHandover,
  db,
  discover,
  drainQueue,
  exportHandover,
  frame,
  getDocument,
  handoverDetail,
  libraryStats,
  listDocuments,
  listHandovers,
  publicSettings,
  registerFile,
  resolveConflict,
  seedSamples,
  updateItem,
  updateSettings,
  type Role,
} from "@/server/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function roleOf(request: Request): Role {
  const role = request.headers.get("x-demo-role") || "predecessor";
  if (role === "successor" || role === "reader" || role === "predecessor") return role;
  return "reader";
}

function actorOf(request: Request) {
  return request.headers.get("x-demo-actor") || roleOf(request);
}

function fail(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: number }).status) : 400;
  const message = error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
  return NextResponse.json({ error: message }, { status: status || 400 });
}

async function handle(request: Request, parts: string[]) {
  const database = db();
  const [a, b, c, d] = parts;
  try {
    if (request.method === "GET" && a === "stats") return NextResponse.json(libraryStats(database));
    if (request.method === "GET" && a === "settings") return NextResponse.json(publicSettings(database));
    if (request.method === "PATCH" && a === "settings") {
      const body = await request.json();
      updateSettings(database, body);
      return NextResponse.json(publicSettings(database));
    }
    if (request.method === "GET" && a === "documents" && !b) return NextResponse.json(listDocuments(database));
    if (request.method === "GET" && a === "documents" && b) {
      const found = getDocument(database, b);
      if (!found) return NextResponse.json({ error: "문서가 없습니다." }, { status: 404 });
      const doc = found.document as { rights_status: string };
      if (doc.rights_status === "restricted") {
        return NextResponse.json({ error: "열람이 제한된 문서입니다. 본문을 열지 않습니다." }, { status: 403 });
      }
      return NextResponse.json(found);
    }
    if (request.method === "POST" && a === "documents") {
      const form = await request.formData();
      const handoverId = String(form.get("handoverId") || "") || null;
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      const registered = [];
      for (const file of files) {
        if (file.size > 30 * 1024 * 1024) {
          registered.push({ name: file.name, error: "30MB를 넘는 파일은 받지 않습니다." });
          continue;
        }
        const bytes = Buffer.from(await file.arrayBuffer());
        const saved = registerFile(database, { originalName: file.name, bytes, handoverId });
        registered.push({ name: file.name, ...saved });
      }
      await drainQueue(database, files.length || 1);
      return NextResponse.json({ registered, stats: libraryStats(database) });
    }
    if (request.method === "POST" && a === "seed") {
      return NextResponse.json(await seedSamples(database));
    }
    if (request.method === "POST" && a === "jobs" && b === "drain") {
      const n = await drainQueue(database, 50);
      return NextResponse.json({ drained: n, stats: libraryStats(database) });
    }
    if (request.method === "GET" && a === "handovers" && !b) return NextResponse.json(listHandovers(database));
    if (request.method === "POST" && a === "handovers" && !b) {
      const body = await request.json();
      const handoverId = createHandover(database, body);
      return NextResponse.json({ id: handoverId });
    }
    if (a === "handovers" && b && c === "export" && request.method === "GET") {
      const url = new URL(request.url);
      const format = url.searchParams.get("format") === "json" ? "json" : "md";
      const body = exportHandover(database, b, format);
      return new NextResponse(body, {
        headers: {
          "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="handover.${format === "json" ? "json" : "md"}"`,
        },
      });
    }
    if (request.method === "GET" && a === "handovers" && b && !c) {
      const detail = handoverDetail(database, b);
      if (!detail) return NextResponse.json({ error: "없습니다." }, { status: 404 });
      return NextResponse.json(detail);
    }
    if (request.method === "POST" && a === "handovers" && b && c === "discover") {
      const body = await request.json();
      return NextResponse.json(discover(database, b, body.mode === "hindsight" ? "hindsight" : "as_of"));
    }
    if (request.method === "POST" && a === "handovers" && b && c === "frame") {
      const body = await request.json();
      return NextResponse.json(await frame(database, b, body.mode === "hindsight" ? "hindsight" : "as_of"));
    }
    if (request.method === "PATCH" && a === "handovers" && b && c === "items" && d) {
      const body = await request.json();
      return NextResponse.json(updateItem(database, roleOf(request), actorOf(request), b, d, body) ?? { ok: true });
    }
    if (request.method === "POST" && a === "handovers" && b && c === "confirm") {
      const body = await request.json().catch(() => ({ reason: "" }));
      confirmHandover(database, roleOf(request), actorOf(request), b, body.reason || "전임자 확정");
      return NextResponse.json({ ok: true });
    }
    if (request.method === "POST" && a === "handovers" && b && c === "accept") {
      acceptHandover(database, roleOf(request), actorOf(request), b);
      return NextResponse.json({ ok: true });
    }
    if (request.method === "POST" && a === "handovers" && b && c === "interview") {
      const body = await request.json();
      answerInterview(database, roleOf(request), b, body.questionId, body.answer || "");
      return NextResponse.json({ ok: true });
    }
    if (request.method === "POST" && a === "handovers" && b && c === "ask") {
      const body = await request.json();
      return NextResponse.json(askSuccessor(database, roleOf(request), b, body.question || ""));
    }
    if (request.method === "POST" && a === "conflicts" && b) {
      const body = await request.json();
      resolveConflict(database, roleOf(request), b, body.note || "");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "없는 주소입니다." }, { status: 404 });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path: parts = [] } = await ctx.params;
  return handle(request, parts);
}
export async function POST(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path: parts = [] } = await ctx.params;
  return handle(request, parts);
}
export async function PATCH(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path: parts = [] } = await ctx.params;
  return handle(request, parts);
}
