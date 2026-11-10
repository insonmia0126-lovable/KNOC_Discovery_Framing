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
    const m = text.match(new RegExp(`${label}\\s*:\\s*(.+)`));
    return m ? m[1].trim() : null;
  };
  const published = pick("발행일");
  return {
    title: pick("제목"),
    publishedOn: published && /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : null,
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
      const raw = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/[ ]{2,}/g, " ")
        .trim();
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
