/**
 * AICA2026 制作過程資料を PDF / DOCX 相当へ書き出す。
 * PDF: Chrome for Testing で印刷
 * DOCX: Word が開ける HTML ベースの WordprocessingML 簡易パッケージ
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname);
const HTML = path.join(ROOT, "process.html");
const PDF = path.join(ROOT, "Sound-Sculpture_AICA2026_制作過程.pdf");
const DOCX = path.join(ROOT, "Sound-Sculpture_AICA2026_制作過程.docx");
const CHROME = path.join(
  os.homedir(),
  ".cache/puppeteer/chrome/mac_arm-136.0.7103.94/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);

async function writePdf() {
  const puppeteer = require(path.join(
    ROOT,
    "../../node_modules/puppeteer-core",
  ));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto("file://" + HTML, { waitUntil: "networkidle0" });
  await page.pdf({
    path: PDF,
    format: "A4",
    printBackground: true,
    margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
  });
  await browser.close();
  console.log("PDF:", PDF);
}

/** 最小限の docx（単一 document.xml + HTML 本文をプレーン化して段落化） */
function writeDocx() {
  const html = fs.readFileSync(HTML, "utf8");
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/t[hd]>\s*<t[hd]>/gi, " — ")
    .replace(/<\/(p|h1|h2|h3|li|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const escapeXml = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const paragraphs = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
    )
    .join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aica-docx-"));
  fs.mkdirSync(path.join(tmp, "_rels"));
  fs.mkdirSync(path.join(tmp, "word"));
  fs.writeFileSync(path.join(tmp, "[Content_Types].xml"), contentTypes);
  fs.writeFileSync(path.join(tmp, "_rels", ".rels"), rels);
  fs.writeFileSync(path.join(tmp, "word", "document.xml"), documentXml);

  const outAbs = path.resolve(DOCX);
  if (fs.existsSync(outAbs)) fs.unlinkSync(outAbs);
  execSync(`cd "${tmp}" && zip -qr "${outAbs}" [Content_Types].xml _rels word`, {
    stdio: "inherit",
  });
  console.log("DOCX:", DOCX);
}

(async () => {
  await writePdf();
  writeDocx();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
