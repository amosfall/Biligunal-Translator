import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  SectionType,
  CommentRangeStart,
  CommentRangeEnd,
  CommentReference,
} from "docx";
import { saveAs } from "file-saver";

interface ParagraphPair {
  en: string;
  zh: string;
}

interface AnalysisBilingual {
  en: string;
  zh: string;
}

interface CharacterInfo {
  name: AnalysisBilingual;
  description: AnalysisBilingual;
}

interface ArticleAnalysis {
  summary: AnalysisBilingual;
  narrativeDetail: AnalysisBilingual;
  themes: AnalysisBilingual[];
  pros: AnalysisBilingual[];
  cons: AnalysisBilingual[];
  plotSynopsis?: AnalysisBilingual;
  characters?: CharacterInfo[];
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

interface ExportOptions {
  title: { en: string; zh: string };
  author: { en: string; zh: string };
  content: ParagraphPair[];
  annotations: Annotations;
  analysis: ArticleAnalysis | null;
}

function makeSpacer(): Paragraph {
  return new Paragraph({ spacing: { after: 200 } });
}

function makeSectionHeader(text: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        bold: true,
        size: 28,
        font: "Arial",
      }),
    ],
    spacing: { before: 600, after: 300 },
    heading: HeadingLevel.HEADING_2,
  });
}

export async function exportToDocx(options: ExportOptions): Promise<void> {
  const { title, author, content, annotations, analysis } = options;

  // Build comment entries with numeric IDs
  const commentEntries = annotations.map((ann, i) => ({
    ...ann,
    numId: i + 1,
  }));

  // Group annotations by paragraph, sorted by startOffset
  const paraAnnotations = new Map<number, typeof commentEntries>();
  commentEntries.forEach((entry) => {
    const list = paraAnnotations.get(entry.paraIndex) || [];
    list.push(entry);
    paraAnnotations.set(entry.paraIndex, list);
  });
  paraAnnotations.forEach((list) => list.sort((a, b) => a.startOffset - b.startOffset));

  // --- Build document sections ---

  const children: Paragraph[] = [];

  // Title page
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: title.en || "Untitled",
          bold: true,
          size: 56,
          font: "Georgia",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  );

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: title.zh || "无标题",
          bold: true,
          size: 48,
          font: "SimSun",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  if (author.en || author.zh) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: [author.en, author.zh].filter(Boolean).join(" / "),
            italics: true,
            size: 28,
            font: "Georgia",
            color: "666666",
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
      })
    );
  }

  // Separator
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "─".repeat(40),
          color: "CCCCCC",
          size: 20,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  );

  // --- English Full Text ---
  children.push(makeSectionHeader("English"));

  content.forEach((pair, paraIndex) => {
    const anns = paraAnnotations.get(paraIndex);
    if (anns && anns.length > 0) {
      // Split text into segments: plain text and annotated ranges
      const runs: (TextRun | CommentRangeStart | CommentRangeEnd | CommentReference)[] = [];
      let lastEnd = 0;
      anns.forEach((ann) => {
        if (ann.startOffset > lastEnd) {
          runs.push(new TextRun({ text: pair.en.slice(lastEnd, ann.startOffset), size: 24, font: "Georgia" }));
        }
        runs.push(new CommentRangeStart(ann.numId));
        runs.push(new TextRun({ text: pair.en.slice(ann.startOffset, ann.endOffset), size: 24, font: "Georgia" }));
        runs.push(new CommentRangeEnd(ann.numId));
        runs.push(new CommentReference(ann.numId));
        lastEnd = ann.endOffset;
      });
      if (lastEnd < pair.en.length) {
        runs.push(new TextRun({ text: pair.en.slice(lastEnd), size: 24, font: "Georgia" }));
      }
      children.push(new Paragraph({ children: runs, spacing: { after: 300 } }));
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: pair.en, size: 24, font: "Georgia" }),
          ],
          spacing: { after: 300 },
        })
      );
    }
  });

  // Page break before Chinese section
  children.push(
    new Paragraph({
      children: [new PageBreak()],
    })
  );

  // --- Chinese Full Text ---
  children.push(makeSectionHeader("中文"));

  content.forEach((pair) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: pair.zh,
            size: 24,
            font: "SimSun",
          }),
        ],
        spacing: { after: 300 },
      })
    );
  });

  // --- Analysis Section (optional) ---
  if (analysis) {
    children.push(
      new Paragraph({
        children: [new PageBreak()],
      })
    );

    children.push(makeSectionHeader("Analysis / 分析"));

    // Summary
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Overview / 概览", bold: true, size: 24, font: "Arial" }),
        ],
        spacing: { before: 400, after: 200 },
      })
    );
    if (analysis.summary.en) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: analysis.summary.en, italics: true, size: 22, font: "Georgia" }),
          ],
          spacing: { after: 100 },
        })
      );
    }
    if (analysis.summary.zh) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: analysis.summary.zh, size: 22, font: "SimSun" }),
          ],
          spacing: { after: 300 },
        })
      );
    }

    // Key Themes
    if (analysis.themes.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Key Themes / 核心主题", bold: true, size: 24, font: "Arial" }),
          ],
          spacing: { before: 400, after: 200 },
        })
      );
      analysis.themes.forEach((theme) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `• ${[theme.en, theme.zh].filter(Boolean).join(" / ")}`,
                size: 22,
                font: "Georgia",
              }),
            ],
            spacing: { after: 100 },
          })
        );
      });
    }

    // Narrative Analysis
    if (analysis.narrativeDetail.en || analysis.narrativeDetail.zh) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Narrative Analysis / 叙事分析", bold: true, size: 24, font: "Arial" }),
          ],
          spacing: { before: 400, after: 200 },
        })
      );
      if (analysis.narrativeDetail.en) {
        analysis.narrativeDetail.en.split("\n").forEach((para) => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: para, italics: true, size: 22, font: "Georgia" }),
              ],
              spacing: { after: 100 },
            })
          );
        });
      }
      children.push(makeSpacer());
      if (analysis.narrativeDetail.zh) {
        analysis.narrativeDetail.zh.split("\n").forEach((para) => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: para, size: 22, font: "SimSun" }),
              ],
              spacing: { after: 100 },
            })
          );
        });
      }
    }

    // Plot Synopsis
    if (analysis.plotSynopsis && (analysis.plotSynopsis.en || analysis.plotSynopsis.zh)) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Plot Synopsis / 剧情梗概", bold: true, size: 24, font: "Arial" }),
          ],
          spacing: { before: 400, after: 200 },
        })
      );
      if (analysis.plotSynopsis.en) {
        analysis.plotSynopsis.en.split("\n").forEach((para) => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: para, italics: true, size: 22, font: "Georgia" }),
              ],
              spacing: { after: 100 },
            })
          );
        });
      }
      children.push(makeSpacer());
      if (analysis.plotSynopsis.zh) {
        analysis.plotSynopsis.zh.split("\n").forEach((para) => {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: para, size: 22, font: "SimSun" }),
              ],
              spacing: { after: 100 },
            })
          );
        });
      }
    }

    // Characters
    if (analysis.characters && analysis.characters.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Characters / 人物介绍", bold: true, size: 24, font: "Arial" }),
          ],
          spacing: { before: 400, after: 200 },
        })
      );
      analysis.characters.forEach((char) => {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: char.name.en, bold: true, size: 22, font: "Georgia" }),
              ...(char.name.zh ? [new TextRun({ text: ` / ${char.name.zh}`, bold: true, size: 22, font: "SimSun" })] : []),
            ],
            spacing: { before: 200, after: 100 },
          })
        );
        if (char.description.en) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: char.description.en, italics: true, size: 20, font: "Georgia", color: "555555" }),
              ],
              spacing: { after: 50 },
            })
          );
        }
        if (char.description.zh) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: char.description.zh, size: 20, font: "SimSun", color: "555555" }),
              ],
              spacing: { after: 200 },
            })
          );
        }
      });
    }

    // Pros
    if (analysis.pros.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Strengths / 写作优点", bold: true, size: 24, font: "Arial", color: "FF0080" }),
          ],
          spacing: { before: 400, after: 200 },
        })
      );
      analysis.pros.forEach((pro, i) => {
        const parts: TextRun[] = [
          new TextRun({ text: `${String(i + 1).padStart(2, "0")}. `, bold: true, size: 22, font: "Arial" }),
        ];
        if (pro.en) parts.push(new TextRun({ text: pro.en, italics: true, size: 22, font: "Georgia" }));
        if (pro.en && pro.zh) parts.push(new TextRun({ text: " — ", size: 22 }));
        if (pro.zh) parts.push(new TextRun({ text: pro.zh, size: 22, font: "SimSun" }));
        children.push(new Paragraph({ children: parts, spacing: { after: 100 } }));
      });
    }

    // Cons
    if (analysis.cons.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Critique / 写作缺点", bold: true, size: 24, font: "Arial", color: "7928CA" }),
          ],
          spacing: { before: 400, after: 200 },
        })
      );
      analysis.cons.forEach((con, i) => {
        const parts: TextRun[] = [
          new TextRun({ text: `${String(i + 1).padStart(2, "0")}. `, bold: true, size: 22, font: "Arial" }),
        ];
        if (con.en) parts.push(new TextRun({ text: con.en, italics: true, size: 22, font: "Georgia" }));
        if (con.en && con.zh) parts.push(new TextRun({ text: " — ", size: 22 }));
        if (con.zh) parts.push(new TextRun({ text: con.zh, size: 22, font: "SimSun" }));
        children.push(new Paragraph({ children: parts, spacing: { after: 100 } }));
      });
    }
  }

  // Build the document with comments
  const docComments = commentEntries.map((c) => ({
    id: c.numId,
    author: "User",
    date: new Date(c.createdAt),
    children: [
      new Paragraph({
        children: [new TextRun({ text: c.text })],
      }),
    ],
  }));

  const doc = new Document({
    comments: docComments.length > 0 ? { children: docComments } : undefined,
    sections: [
      {
        properties: {
          type: SectionType.CONTINUOUS,
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${(title.en || title.zh || "translation").replace(/[^\w\u4e00-\u9fff]/g, "_")}.docx`;
  saveAs(blob, filename);
}
