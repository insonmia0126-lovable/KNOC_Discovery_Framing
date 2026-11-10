import { createHash } from "crypto";
import { citationText } from "./framing";

export const PARSER_VERSION = "pdfjs-dist-legacy-4";
export const INDEX_VERSION = "keyword-v1";

export function sha256(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

export type PageText = {
  physicalPage: number;
  printedPage: string | null;
  text: string;
  quality: "ok" | "empty" | "failed";
  ignored: string[];
};

export function pagesFromPlain(text: string): PageText[] {
  const { text: clean, ignored } = citationText(text);
  const body = clean.trim();
  return [
    {
      physicalPage: 1,
      printedPage: "1",
      text: body,
      quality: body ? "ok" : "empty",
      ignored,
    },
  ];
}

export function readMeta(text: string): {
  title: string | null;
  publishedOn: string | null;
  department: string | null;
  docType: string | null;
} {
  const pick = (label: string) => {
    const m = text.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`));
    if (!m) return null;
    return m[1].trim().slice(0, 80);
  };
  const published = pick("발행일")?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  return {
    title: pick("제목"),
    publishedOn: published,
    department: pick("작성 부서"),
    docType: pick("문서 유형"),
  };
}

export async function extractPdf(buffer: Buffer): Promise<{ pages: PageText[]; note: string | null }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    const task = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      disableFontFace: true,
    });
    const pdf = await task.promise;
    const pages: PageText[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const parts: string[] = [];
      let lastY: number | null = null;
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        const y = "transform" in item ? Number(item.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) parts.push("\n");
        else if (parts.length > 0 && parts[parts.length - 1] !== "\n") parts.push(" ");
        parts.push(item.str);
        if (y !== null) lastY = y;
      }
      const raw = parts.join("").replace(/[ \t]+\n/g, "\n").replace(/[ ]{2,}/g, " ").trim();
      const { text, ignored } = citationText(raw);
      pages.push({
        physicalPage: i,
        printedPage: String(i),
        text,
        quality: text ? "ok" : "empty",
        ignored,
      });
    }
    return { pages, note: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF 추출 실패";
    return {
      pages: [],
      note: message.slice(0, 300),
    };
  }
}
