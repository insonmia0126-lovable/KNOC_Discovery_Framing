import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import * as XLSX from "xlsx";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(fs.readFileSync(path.join(root, "sample-data/corpus.json"), "utf8"));
const out = path.join(root, "sample-data/files");
fs.mkdirSync(out, { recursive: true });

const fontPath = path.join(root, "sample-data/fonts/NotoSansKR-Regular.otf");
if (!fs.existsSync(fontPath)) {
  fs.mkdirSync(path.dirname(fontPath), { recursive: true });
  const res = await fetch(
    "https://github.com/google/fonts/raw/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf",
  );
  if (!res.ok) throw new Error("한글 글꼴을 받지 못했습니다.");
  fs.writeFileSync(fontPath, Buffer.from(await res.arrayBuffer()));
}
const fontBytes = fs.readFileSync(fontPath);

async function writePdf(name, pages, { emptyFirst = false } = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  for (const [index, pageText] of pages.entries()) {
    const page = doc.addPage([595, 842]);
    if (emptyFirst && index === 0) continue;
    const lines = String(pageText).split("\n");
    let y = 800;
    for (const line of lines) {
      page.drawText((line.length ? line : " ").slice(0, 180), { font, size: 10, x: 40, y });
      y -= 16;
    }
  }
  fs.writeFileSync(path.join(out, name), Buffer.from(await doc.save()));
}

for (const doc of corpus.documents) {
  await writePdf(doc.originalName, doc.pages, { emptyFirst: Boolean(doc.emptyFirstPage) });
}
const initial = corpus.documents[0];
fs.copyFileSync(path.join(out, initial.originalName), path.join(out, "가상_수송로_차질_초기분석_복제본.pdf"));
fs.writeFileSync(path.join(out, "손상된_파일.pdf"), Buffer.from("%PDF-1.4\nthis is not a complete pdf"));

for (const text of corpus.texts) {
  fs.writeFileSync(path.join(out, text.originalName), text.text, "utf8");
}
const book = XLSX.utils.book_new();
const sheet = XLSX.utils.aoa_to_sheet(corpus.schedule.rows);
XLSX.utils.book_append_sheet(book, sheet, "일정");
XLSX.writeFile(book, path.join(out, corpus.schedule.originalName));
console.log("wrote", fs.readdirSync(out).length, "files");
