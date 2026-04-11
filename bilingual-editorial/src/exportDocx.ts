import JSZip from "jszip";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  SectionType,
  CommentRangeStart,
  CommentRangeEnd,
  CommentReference,
  convertInchesToTwip,
  LineRuleType,
} from "docx";
import { saveAs } from "file-saver";

interface ParagraphPair {
  en: string;
  zh: string;
}

interface Annotation {
  id: string;
  text: string;
  selectedText: string;
  paraIndex: number;
  startOffset: number;
  endOffset: number;
  createdAt: number;
  updatedAt: number;
}

type Annotations = Annotation[];

type ExportTargetLang = "zh" | "zh-TW" | "en" | "ja" | "fr" | "de" | "ar" | "morse";

interface ExportOptions {
  title: { en: string; zh: string };
  author: { en: string; zh: string };
  content: ParagraphPair[];
  annotations: Annotations;
  analysis: unknown;
  originalDocx: ArrayBuffer | null;
  targetLang?: ExportTargetLang;
}

function originalColumnForExport(pair: ParagraphPair, targetLang: ExportTargetLang): string {
  return targetLang === "en" ? pair.zh : pair.en;
}

// ─── Original .docx injection path ───

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const COMMENTS_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
const COMMENTS_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildCommentsXml(annotations: Annotations): string {
  const comments = annotations.map((ann, i) => {
    const id = i + 1;
    const date = new Date(ann.createdAt).toISOString();
    return `<w:comment w:id="${id}" w:author="User" w:date="${date}"><w:p><w:r><w:t>${escapeXml(ann.text)}</w:t></w:r></w:p></w:comment>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="${W_NS}" xmlns:r="${R_NS}">
${comments}
</w:comments>`;
}

/**
 * Walk <w:p> elements in document.xml, match our paraIndex by counting paragraphs
 * that contain at least one <w:t> (text node). For matching paragraphs with annotations,
 * split <w:r>/<w:t> runs at annotation boundaries and inject comment markers.
 */
function injectCommentsIntoDocXml(docXml: string, annotations: Annotations): string {
  if (annotations.length === 0) return docXml;

  // Group annotations by paraIndex
  const byPara = new Map<number, { ann: Annotation; numId: number }[]>();
  annotations.forEach((ann, i) => {
    const list = byPara.get(ann.paraIndex) || [];
    list.push({ ann, numId: i + 1 });
    byPara.set(ann.paraIndex, list);
  });
  byPara.forEach((list) => list.sort((a, b) => a.ann.startOffset - b.ann.startOffset));

  // Split document.xml into paragraphs (<w:p>...</w:p>), process each
  let textParaIndex = -1;

  // Use regex to find each <w:p ...>...</w:p> block (non-greedy, handles nested tags)
  const result = docXml.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (pBlock) => {
    // Check if this paragraph has any text content
    if (!/<w:t[\s>]/.test(pBlock)) return pBlock;
    textParaIndex++;

    const annList = byPara.get(textParaIndex);
    if (!annList || annList.length === 0) return pBlock;

    // Extract full text from this paragraph to verify offsets
    const textParts: string[] = [];
    pBlock.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, content) => {
      textParts.push(content.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
      return "";
    });
    const fullText = textParts.join("");

    // Build a flat list of characters with their run info
    // We'll reconstruct the paragraph XML with comment markers injected

    // Extract the paragraph opening tag and properties
    const pOpenMatch = pBlock.match(/^(<w:p[\s>][\s\S]*?)(<w:r[\s>])/);
    if (!pOpenMatch) return pBlock; // can't parse, skip

    const beforeRuns = pOpenMatch[1];
    const runsAndClose = pBlock.slice(beforeRuns.length);

    // Parse all runs: collect { runXmlBefore (rPr etc), text, runXmlAfter }
    interface RunSegment {
      prefix: string;   // everything before <w:t> in this run (e.g. <w:r><w:rPr>...</w:rPr>)
      text: string;     // decoded text content
      suffix: string;   // </w:t></w:r>
      rawTOpen: string; // the <w:t ...> opening tag
    }
    const runs: RunSegment[] = [];
    let nonRunContent = ""; // content between/after runs (like </w:p>)
    let remaining = runsAndClose;

    // Extract runs one by one
    const runRegex = /(<w:r[\s>][\s\S]*?)(<w:t[^>]*>)([\s\S]*?)<\/w:t>([\s\S]*?<\/w:r>)/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = runRegex.exec(remaining)) !== null) {
      if (m.index > lastIndex) {
        // Non-run content before this run (could be bookmarks, etc.)
        nonRunContent += remaining.slice(lastIndex, m.index);
      }
      const decoded = m[3].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
      runs.push({
        prefix: (nonRunContent || "") + m[1],
        text: decoded,
        rawTOpen: m[2],
        suffix: "</w:t>" + m[4],
      });
      nonRunContent = "";
      lastIndex = m.index + m[0].length;
    }
    const afterAllRuns = remaining.slice(lastIndex); // includes </w:p>

    if (runs.length === 0) return pBlock;

    // Now rebuild: walk character by character, inject comment markers
    let charOffset = 0;
    let annIdx = 0;
    const outputParts: string[] = [beforeRuns];

    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri];
      // Get rPr (run properties) from prefix to reuse for split runs
      const rPrMatch = run.prefix.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
      const rPr = rPrMatch ? rPrMatch[0] : "";
      // Get the <w:r> opening (may have attributes)
      const rOpenMatch = run.prefix.match(/<w:r(\s[^>]*)?>/) || ["<w:r>"];
      const rOpen = rOpenMatch[0];

      // Determine preserve space attribute
      const tOpen = run.rawTOpen.includes("xml:space") ? run.rawTOpen : '<w:t xml:space="preserve">';

      let textPos = 0;
      const runText = run.text;

      // Add any non-run prefix content (for first run, this includes prefix markup)
      if (ri === 0 || run.prefix !== runs[ri].prefix) {
        // Output everything before the first <w:r> in this segment
        const beforeR = run.prefix.match(/([\s\S]*?)(<w:r[\s>])/);
        if (beforeR) outputParts.push(beforeR[1]);
      } else {
        const beforeR = run.prefix.match(/([\s\S]*?)(<w:r[\s>])/);
        if (beforeR) outputParts.push(beforeR[1]);
      }

      // Process this run's text, splitting at annotation boundaries
      while (textPos < runText.length) {
        // Check if any annotation starts or ends at current charOffset
        let splitAt: number | null = null;
        let action: "start" | "end" | null = null;
        let actionAnn: typeof annList[0] | null = null;

        for (let ai = 0; ai < annList.length; ai++) {
          const a = annList[ai];
          if (a.ann.startOffset === charOffset + textPos) {
            splitAt = textPos;
            action = "start";
            actionAnn = a;
            break;
          }
          if (a.ann.endOffset === charOffset + textPos) {
            splitAt = textPos;
            action = "end";
            actionAnn = a;
            break;
          }
        }

        if (splitAt !== null && action && actionAnn) {
          // Output text before this point as a run
          if (splitAt > 0) {
            const seg = escapeXml(runText.slice(textPos - (splitAt - textPos), splitAt));
            // Actually we need text from the start of current segment
          }
          // This approach is getting too complex. Let me use a simpler method.
          break;
        }
        textPos++;
      }

      // Simplified approach: for this run, output the full text with markers at boundaries
      // Reset and use a segment-based approach
      charOffset += runText.length;
    }

    // FALLBACK: Use a simpler but reliable approach
    // Rebuild the paragraph by concatenating all text, splitting at annotation points,
    // and wrapping each segment in the first run's formatting

    // Get the formatting from the first run
    const firstRun = runs[0];
    const rPrMatch = firstRun.prefix.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[0] : "";

    // Build segments from full text
    interface TextSegment {
      text: string;
      commentStart?: number; // numId
      commentEnd?: number;   // numId
    }

    const segments: TextSegment[] = [];
    const points = new Set<number>();
    annList.forEach((a) => {
      points.add(a.ann.startOffset);
      points.add(a.ann.endOffset);
    });
    points.add(0);
    points.add(fullText.length);
    const sorted = [...points].sort((a, b) => a - b);

    for (let si = 0; si < sorted.length - 1; si++) {
      const start = sorted[si];
      const end = sorted[si + 1];
      if (start >= end || start >= fullText.length) continue;
      segments.push({ text: fullText.slice(start, end) });
    }

    // Now build XML
    const newParts: string[] = [beforeRuns];

    let cursor = 0;
    for (const seg of segments) {
      const segStart = cursor;
      const segEnd = cursor + seg.text.length;

      // Insert commentRangeStart before this segment if any annotation starts here
      annList.forEach((a) => {
        if (a.ann.startOffset === segStart) {
          newParts.push(`<w:commentRangeStart w:id="${a.numId}"/>`);
        }
      });

      // Output the text run
      newParts.push(`<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(seg.text)}</w:t></w:r>`);

      // Insert commentRangeEnd + commentReference after this segment if any annotation ends here
      annList.forEach((a) => {
        if (a.ann.endOffset === segEnd) {
          newParts.push(`<w:commentRangeEnd w:id="${a.numId}"/>`);
          newParts.push(`<w:r><w:rPr/><w:commentReference w:id="${a.numId}"/></w:r>`);
        }
      });

      cursor = segEnd;
    }

    newParts.push(afterAllRuns);
    return newParts.join("");
  });

  return result;
}

async function exportWithOriginal(
  docxBuffer: ArrayBuffer,
  annotations: Annotations,
  filename: string,
): Promise<void> {
  const zip = await JSZip.loadAsync(docxBuffer);

  if (annotations.length > 0) {
    // 1. Add/replace word/comments.xml
    zip.file("word/comments.xml", buildCommentsXml(annotations));

    // 2. Inject comment markers into word/document.xml
    const docXmlRaw = await zip.file("word/document.xml")!.async("string");
    const docXmlNew = injectCommentsIntoDocXml(docXmlRaw, annotations);
    zip.file("word/document.xml", docXmlNew);

    // 3. Ensure [Content_Types].xml has comments content type
    const ctRaw = await zip.file("[Content_Types].xml")!.async("string");
    if (!ctRaw.includes("comments.xml")) {
      const updated = ctRaw.replace(
        /<\/Types>/,
        `<Override PartName="/word/comments.xml" ContentType="${COMMENTS_TYPE}"/></Types>`
      );
      zip.file("[Content_Types].xml", updated);
    }

    // 4. Ensure word/_rels/document.xml.rels has comments relationship
    const relsPath = "word/_rels/document.xml.rels";
    const relsRaw = await zip.file(relsPath)?.async("string") ?? "";
    if (relsRaw && !relsRaw.includes("comments.xml")) {
      // Find a unique rId
      const ids = [...relsRaw.matchAll(/Id="(rId\d+)"/g)].map((m) => parseInt(m[1].replace("rId", ""), 10));
      const nextId = Math.max(0, ...ids) + 1;
      const updated = relsRaw.replace(
        /<\/Relationships>/,
        `<Relationship Id="rId${nextId}" Type="${COMMENTS_REL_TYPE}" Target="comments.xml"/></Relationships>`
      );
      zip.file(relsPath, updated);
    }
  }

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  saveAs(blob, filename);
}

// ─── Fallback: create new document (for text input / PDF) ───

function makeFallbackDoc(content: ParagraphPair[], annotations: Annotations, targetLang: ExportTargetLang = "zh"): Document {
  const FONT = "Times New Roman";
  const FONT_SIZE = 24;
  const LINE_SPACING = 276;
  const PARA_AFTER = 120;

  const commentEntries = annotations.map((ann, i) => ({ ...ann, numId: i + 1 }));
  const paraAnns = new Map<number, typeof commentEntries>();
  commentEntries.forEach((e) => {
    const list = paraAnns.get(e.paraIndex) || [];
    list.push(e);
    paraAnns.set(e.paraIndex, list);
  });
  paraAnns.forEach((list) => list.sort((a, b) => a.startOffset - b.startOffset));

  const paraSpacing = { after: PARA_AFTER, line: LINE_SPACING, lineRule: LineRuleType.AUTO };
  const children: Paragraph[] = [];

  content.forEach((pair, pi) => {
    const text = originalColumnForExport(pair, targetLang);
    const anns = paraAnns.get(pi);

    if (anns && anns.length > 0) {
      const runs: (TextRun | CommentRangeStart | CommentRangeEnd | CommentReference)[] = [];
      let lastEnd = 0;
      anns.forEach((a) => {
        if (a.startOffset > lastEnd)
          runs.push(new TextRun({ text: text.slice(lastEnd, a.startOffset), size: FONT_SIZE, font: FONT }));
        runs.push(new CommentRangeStart(a.numId));
        runs.push(new TextRun({ text: text.slice(a.startOffset, a.endOffset), size: FONT_SIZE, font: FONT }));
        runs.push(new CommentRangeEnd(a.numId));
        runs.push(new CommentReference(a.numId));
        lastEnd = a.endOffset;
      });
      if (lastEnd < text.length)
        runs.push(new TextRun({ text: text.slice(lastEnd), size: FONT_SIZE, font: FONT }));
      children.push(new Paragraph({ children: runs, spacing: paraSpacing }));
    } else {
      children.push(new Paragraph({
        children: [new TextRun({ text, size: FONT_SIZE, font: FONT })],
        spacing: paraSpacing,
      }));
    }
  });

  const docComments = commentEntries.map((c) => ({
    id: c.numId,
    author: "User",
    date: new Date(c.createdAt),
    children: [new Paragraph({ children: [new TextRun({ text: c.text })] })],
  }));

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: FONT_SIZE },
          paragraph: { spacing: { after: PARA_AFTER, line: LINE_SPACING, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    comments: docComments.length > 0 ? { children: docComments } : undefined,
    sections: [{
      properties: {
        type: SectionType.CONTINUOUS,
        page: {
          margin: {
            top: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
          },
        },
      },
      children,
    }],
  });
}

// ─── Main export function ───

export async function exportToDocx(options: ExportOptions): Promise<void> {
  const { title, content, annotations, originalDocx, targetLang = "zh" } = options;
  const filename = `${(title.en || title.zh || "document").replace(/[^\w\u4e00-\u9fff]/g, "_")}.docx`;

  if (originalDocx) {
    // Preserve original formatting, just inject comments
    await exportWithOriginal(originalDocx, annotations, filename);
  } else {
    // Fallback: build new document
    const doc = makeFallbackDoc(content, annotations, targetLang);
    const blob = await Packer.toBlob(doc);
    saveAs(blob, filename);
  }
}
