/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback, ChangeEvent } from "react";
import { isLegacyHkuInput, isLegacyMeijiInput, isLegacyZhongXiInput } from "../lib/akiEasterEggs";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, Menu, Upload, Loader2, AlertCircle, X, Trash2, Database, Monitor, MessageSquare, FileDown, LogOut, ChevronDown, Globe, HelpCircle, Search, ChevronUp } from "lucide-react";
import mammoth from "mammoth";
import JSON5 from "json5";
import FloatingTextFollowup from "./FloatingTextFollowup";
import { useAppAuth } from "./auth/AppAuthContext";
import {
  decodeAki,
  AKI_SITE_URL,
  extractAkiCipherFromTranslatedParagraph,
  isProbablyAkiCipher,
  prepareAkiImportText,
  splitAkiPasteIntoCipherAndEgg,
} from "../lib/customCipher";
import { buildAkiTranslatedColumnAsync } from "../lib/akiTranslatedColumn";
import { mergeRefinedParagraphs, shouldRefineDecodedAkiText } from "../lib/refineAkiZh";
import { stripUrlsForTranslation } from "../lib/stripUrlsForTranslation";
import {
  GUEST_TRANSLATION_LIMIT_MESSAGE,
  incrementGuestTranslationSuccessIfVisitor,
  isGuestTranslationQuotaExceeded,
} from "../lib/guestTranslationLimit";
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

async function extractPdfText(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it: any) => it.str ?? "").join(" "));
  }
  return pages.join("\n\n");
}

type SourceLang = "en" | "fr" | "ja" | "de" | "ar" | "zh-TW" | "zh" | "aki";
const SOURCE_LANG_LABELS: Record<SourceLang, string> = {
  en: "English",
  fr: "Français",
  de: "Deutsch",
  ar: "العربية",
  ja: "日本語",
  "zh-TW": "繁體中文",
  zh: "简体中文",
  /** 仅 AKI 密文→中文解码结果页左栏展示，不出现在用户手选原文语种里 */
  aki: "AKI码",
};
type TargetLang = "zh" | "zh-TW" | "en" | "ja" | "fr" | "de" | "ar" | "morse" | "aki";
const TARGET_LANG_LABELS: Record<TargetLang, string> = {
  zh: "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  fr: "Français",
  de: "Deutsch",
  ar: "العربية",
  morse: "摩斯密码",
  aki: "AKI码",
};
const TARGET_LANG_KEY = "bilingual-editorial-target-lang";
const ALL_TARGET_LANGS: TargetLang[] = ["zh", "zh-TW", "en", "ja", "fr", "de", "ar", "morse", "aki"];

function getAkiMemeApiUrl(): string {
  const u = import.meta.env.VITE_AKI_MEME_API?.trim();
  return u && u.length > 0 ? u : "/api/aki-meme";
}
/** 未保存过目标语时：游客默认「译成 AKI 码」；登录用户见下方 useLayoutEffect 回落为简体中文 */
function readStoredTargetLang(): TargetLang {
  try {
    const t = localStorage.getItem(TARGET_LANG_KEY);
    if (t && ALL_TARGET_LANGS.includes(t as TargetLang)) return t as TargetLang;
  } catch {
    /* ignore */
  }
  return "aki";
}
const SOURCE_LANG_KEY = "bilingual-editorial-source-lang";
/** 用户可选 / 历史记录中的原文语种（不含仅用于栏目标题的 aki） */
const ALL_SOURCE_LANGS: SourceLang[] = ["en", "fr", "de", "ar", "ja", "zh-TW", "zh"];
function readStoredSourceLang(): SourceLang {
  try {
    const s = localStorage.getItem(SOURCE_LANG_KEY);
    if (s && ALL_SOURCE_LANGS.includes(s as SourceLang)) return s as SourceLang;
  } catch {
    /* ignore */
  }
  return "en";
}

/** 根据正文抽样推断原文语种，用于上传/粘贴翻译时与提示词一致（避免日文内容仍按「英文」翻译） */
function detectSourceLang(text: string): SourceLang {
  const sample = text.slice(0, 6000);
  const total = sample.replace(/\s/g, "").length;
  if (total === 0) return "en";

  const jp = (sample.match(/[\u3040-\u309f\u30a0-\u30ff]/g) ?? []).length;
  const fr = (sample.match(/[àâæçéèêëïîôœùûüÿÀÂÆÇÉÈÊËÏÎÔŒÙÛÜŸ«»]/g) ?? []).length;
  const cjk = (sample.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const arScript = (sample.match(/[\u0600-\u06FF]/g) ?? []).length;

  if (arScript >= 8 || arScript / Math.max(total, 1) > 0.04) return "ar";
  if (jp >= 8 || jp / Math.max(total, 1) > 0.04) return "ja";
  if (cjk / Math.max(total, 1) > 0.12) {
    const trad = (sample.match(/[與個從來為說這還種麼對應學關點開國問題數經現實請過當無電業長門時書車東見發會費問買義馬區陽連運達邊選識護機關號環點傳聞開製紐統經際談請變農術認觀議質輸辦導歡歷齊齒壞搖損撥擊則競級約書費術導統議選護環識農齊齒歡歷壞損擊競臺灣匯整資訊]/g) ?? []).length;
    return trad > 3 ? "zh-TW" : "zh";
  }
  if (fr / Math.max(total, 1) > 0.008) return "fr";
  return "en";
}

const LOCAL_USERNAME_STORAGE = "bilingual-editorial-username";

function readLocalUsernameBoot(): string | null {
  if (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim()) return null;
  try {
    return localStorage.getItem(LOCAL_USERNAME_STORAGE);
  } catch {
    return null;
  }
}

interface ParagraphPair {
  en: string;
  zh: string;
}

/** 同一轮翻译 / 解码共用一个 errState，避免重复 setError */
type AkiMemeErrorState = { reported: boolean };

/**
 * 调用 /api/aki-meme（与 VITE_AKI_MEME_API）；供「译成 AKI」与「AKI 密文解码后补梗」共用。
 */
async function fetchAkiMemeApi(
  memeUrl: string,
  text: string,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
  errState: AkiMemeErrorState
): Promise<{ zh: string; en: string } | null> {
  try {
    const r = await fetch(memeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) {
      if (!errState.reported) {
        errState.reported = true;
        let serverMsg = "";
        try {
          const errJson = (await r.json()) as { error?: string };
          serverMsg = typeof errJson.error === "string" ? errJson.error : "";
        } catch {
          /* 可能返回了 HTML 404 页面 */
        }
        if (r.status === 503) {
          setError(
            serverMsg ||
              "AKI 动态梗未启用：请在部署环境（如 Vercel）配置 DEEPSEEK_API_KEY，并确保可访问「动态梗」接口。"
          );
        } else if (r.status === 404) {
          setError(
            "找不到动态梗接口。若前端托管在纯静态站，请在构建环境变量中设置 VITE_AKI_MEME_API 为含 /api/aki-meme 的完整后端地址。"
          );
        } else {
          setError(serverMsg || `动态梗服务不可用（HTTP ${r.status}）。仅显示密文。`);
        }
      }
      return null;
    }
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("json")) {
      if (!errState.reported) {
        errState.reported = true;
        setError(
          "动态梗接口返回的不是 JSON（多为静态站把 /api 指到了网页，实际没有后端）。请用含 api/ 的 Vercel 全栈部署，或设置 VITE_AKI_MEME_API。"
        );
      }
      return null;
    }
    let j: { eligible?: boolean; zh?: string; en?: string };
    try {
      j = (await r.json()) as { eligible?: boolean; zh?: string; en?: string };
    } catch {
      if (!errState.reported) {
        errState.reported = true;
        setError("动态梗接口响应无法解析为 JSON（可能被替换成了 HTML）。");
      }
      return null;
    }
    if (j.eligible === false) return null;
    const zh = String(j.zh ?? "").trim();
    const en = String(j.en ?? "").trim();
    if (!zh) return null;
    return { zh, en };
  } catch {
    if (!errState.reported) {
      errState.reported = true;
      setError(`无法连接动态梗服务（${memeUrl}）。请检查网络、CORS，或配置 VITE_AKI_MEME_API 指向正确的 API 域名。`);
    }
    return null;
  }
}

function getOriginalColumnText(pair: ParagraphPair, targetLang: TargetLang): string {
  return targetLang === "en" ? pair.zh : pair.en;
}
function getTranslatedColumnText(pair: ParagraphPair, targetLang: TargetLang): string {
  return targetLang === "en" ? pair.en : pair.zh;
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

/** 规范化 analysis，兼容新的双语格式和旧的纯中文字符串格式 */
function normalizeAnalysis(raw: unknown): ArticleAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const toBilingual = (v: unknown): AnalysisBilingual => {
    if (v && typeof v === 'object') {
      const b = v as Record<string, unknown>;
      if ('en' in b || 'zh' in b) {
        return {
          en: typeof b.en === 'string' ? b.en.trim() : '',
          zh: typeof b.zh === 'string' ? b.zh.trim() : '',
        };
      }
    }
    // 向后兼容：旧格式为纯中文字符串
    const s = typeof v === 'string' ? v.trim() : '';
    return { en: '', zh: s };
  };

  const toArr = (v: unknown): AnalysisBilingual[] => {
    if (!Array.isArray(v)) return [];
    return v.map(item => toBilingual(item));
  };

  const summary = toBilingual(o.summary ?? o.Summary);
  const narrativeDetail = toBilingual(o.narrativeDetail ?? (o as Record<string, unknown>).narrative_detail);
  const themes = toArr(o.themes ?? o.Themes);
  const pros = toArr(o.pros ?? o.Pros);
  const cons = toArr(o.cons ?? o.Cons);
  const plotSynopsis = toBilingual(o.plotSynopsis ?? o.plot_synopsis ?? o.PlotSynopsis);
  const characters: CharacterInfo[] = (() => {
    const raw = o.characters ?? o.Characters;
    if (!Array.isArray(raw)) return [];
    return raw.map((c: unknown) => {
      if (!c || typeof c !== 'object') return { name: { en: '', zh: '' }, description: { en: '', zh: '' } };
      const ch = c as Record<string, unknown>;
      return {
        name: toBilingual(ch.name ?? ch.Name),
        description: toBilingual(ch.description ?? ch.Description),
      };
    }).filter((c: CharacterInfo) => c.name.en || c.name.zh);
  })();

  const hasContent = summary.en || summary.zh || narrativeDetail.en || narrativeDetail.zh ||
    themes.length > 0 || pros.length > 0 || cons.length > 0 ||
    plotSynopsis.en || plotSynopsis.zh || characters.length > 0;
  if (!hasContent) return null;

  const ph: AnalysisBilingual = { en: '—', zh: '—' };
  return {
    summary: (summary.en || summary.zh) ? summary : ph,
    narrativeDetail: (narrativeDetail.en || narrativeDetail.zh) ? narrativeDetail : ph,
    themes: themes.length ? themes : [ph],
    pros: pros.length ? pros : [ph],
    cons: cons.length ? cons : [ph],
    plotSynopsis: (plotSynopsis.en || plotSynopsis.zh) ? plotSynopsis : undefined,
    characters: characters.length > 0 ? characters : undefined,
  };
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

interface HistoryItem {
  id: string;
  username?: string;
  /** 服务端根据 Clerk 解析后的展示名（username / 邮箱 / 姓名） */
  ownerDisplayName?: string;
  sourceLang?: SourceLang;
  targetLang?: TargetLang;
  title: { zh: string; en: string };
  author: { zh: string; en: string };
  content: ParagraphPair[];
  analysis: ArticleAnalysis | null;
  annotations?: Annotations;
  createdAt: number;
}

const HISTORY_KEY = "bilingual-editorial-history";
const MAX_HISTORY = 50;
const MAX_HISTORY_ADMIN = 500;

function clerkAdminIdsFromEnv(): Set<string> {
  const raw = import.meta.env.VITE_CLERK_ADMIN_USER_IDS?.trim() || "";
  if (!raw) return new Set();
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}
const STORAGE_MODE_KEY = "bilingual-editorial-storage-mode";
type StorageMode = "local" | "cloud";

const DEMO_TITLE = { en: "To\nStéphane", zh: "致\n斯蒂芬" };
const DEMO_AUTHOR = { en: "Eileen Myles", zh: "艾琳·迈尔斯" };
const DEMO_CONTENT: ParagraphPair[] = [
  {
    en: `Dear Stéphane,\nIt's your birthday. You'd be 61, born in '61. I'm thinking of you as the stars fan out in the sky tonight as I walk my dog. It strikes me that the extreme head racket that occupies so much of your work is stellar: "Oy Suzy" there goes one, yet my feeling about the text written alongside one image or the flowers popped in around the jabber is that it is never very much about "one" speaking at all.`,
    zh: `亲爱的斯蒂芬，\n今天是你的生日。你会61岁，出生于1961年。我在遛狗的时候，抬头看着天上星星点点，想着你。你的作品中充满了那种喧嚣的头脑轰鸣，让我想起星辰的闪烁。\u201C喂，苏西，\u201D一颗星滑落，但我感觉那些伴随图像而写的文字，或插入在喋喋不休中的花朵，从来都不是关于某个\u201C人\u201D在发声。`,
  },
  {
    en: "The words just constellate, burst into symbols whether pictograph men with guns or a multiple territory of women with their names and each with a little sac attached like aphids then a quick sketch of a nightclub recurs, a dirty mouth, a piggy truck, an old banana, a smile a piece of fruit and often it feels like a contagious memory map of one long strewn night. A life.",
    zh: `那些词语只是像星座一样聚集，爆发成符号\u2014\u2014无论是带枪的象形文字般的小人，还是一片属于许多女人的领地，这些女人每个都有个像蚜虫一样的小袋子，接着又突然出现夜总会的速写、污秽的嘴巴、一辆破卡车、一根发霉的香蕉、一张笑脸或一个水果，常常像是一张漫长的记忆地图，一个人生。`,
  },
];
const DEMO_ANALYSIS: ArticleAnalysis = {
  summary: {
    en: "A personal letter exploring how memory, life, and artistic expression intertwine through stargazing and fragments of consciousness.",
    zh: "这是一封写给斯蒂芬的私人信件，通过对星空与艺术作品的观察，探讨了记忆、生命与表达的本质。",
  },
  narrativeDetail: {
    en: "The narrative employs non-linear stream of consciousness. Starting with the immediate scene of walking a dog, it transitions through the image of stars to an evaluation of Stephane's work. The focus is not on events but on the accumulation of imagery from the extreme head racket to constellation-like words, to visceral visual symbols (armed stick figures, nightclubs, rotting bananas). This mirrors the fragmentary nature of memory, presenting a life as a memory map of a long, scattered night.",
    zh: `叙事采用了非线性的意识流手法。作者从当下的遛狗场景切入，通过\u201C星星\u201D这一意象自然过渡到对斯蒂芬艺术作品的评价。叙事重心不在于具体的事件，而在于意象的堆叠\u2014\u2014从\u201C喧嚣的头脑\u201D到\u201C星座般的词语\u201D，再到一系列具体的、具有冲击力的视觉符号。这种叙事方式模拟了记忆的碎片化特征，将一个人的生命呈现为一张\u201C漫长且散乱的夜晚\u201D所构成的记忆地图。`,
  },
  themes: [
    { en: "Fragmentation and reconstruction of memory", zh: "记忆的碎片化与重构" },
    { en: "Depersonalization of artistic expression", zh: "艺术表达的非人格化" },
    { en: "Life as a spatiotemporal map metaphor", zh: "生命作为时空地图的隐喻" },
  ],
  pros: [
    { en: "Imagery is highly condensed with strong visual resonance", zh: "意象高度浓缩且具有强烈的视觉感" },
    { en: "Successfully captures the delicate texture of flowing consciousness", zh: "成功捕捉了意识流动的细腻质感" },
    { en: "Profoundly explores the distance between art and its creator", zh: "深刻探讨了艺术与创作者之间的距离" },
  ],
  cons: [
    { en: "Imagery shifts so rapidly that initial reading may feel disconnected", zh: "意象跳跃极快，初读可能产生断裂感" },
    { en: "Demands a reader comfortable with abstract metaphor", zh: "对读者理解抽象隐喻的能力要求较高" },
    { en: "Loose structure lacks conventional narrative tension", zh: "叙事结构松散，缺乏传统意义上的情节起伏" },
  ],
  plotSynopsis: {
    en: "The narrator writes a birthday letter to Stéphane, who would turn 61. While walking the dog under a starlit sky, she reflects on his artistic work — a chaotic, explosive collage of symbols, images, and fragments. She observes that his art is never about a single voice speaking, but rather a constellation of bursting pictographs: armed stick figures, clusters of women with names and tiny sacs like aphids, recurring nightclub sketches, dirty mouths, piggy trucks, old bananas, smiles, and pieces of fruit. Together these fragments form what she describes as a contagious memory map — one long, scattered night that constitutes an entire life. The letter is both an intimate tribute and a critical meditation on how art captures the texture of lived experience through accumulation rather than narrative.",
    zh: "叙述者在斯蒂芬61岁生日之际写了一封信。她在星空下遛狗时，思绪飘向他的艺术作品——那是一场由符号、图像和碎片组成的混沌而充满爆发力的拼贴。她观察到他的艺术从不关于某个单一的声音在发声，而是一群爆裂的象形文字的聚合：带枪的火柴人、成群结队的女人们（每人都有名字和像蚜虫般附着的小囊）、反复出现的夜总会速写、污秽的嘴巴、小猪卡车、发霉的香蕉、微笑和水果。这些碎片共同构成了她所描述的一张\"传染性的记忆地图\"——一个漫长而散乱的夜晚，构成了一整个人生。这封信既是一份私密的致敬，也是对艺术如何通过积累而非叙事来捕捉生活经验质感的深刻思考。",
  },
  characters: [
    {
      name: { en: "The Narrator (Eileen Myles)", zh: "叙述者（艾琳·迈尔斯）" },
      description: { en: "A poet and writer composing a birthday letter while walking her dog at night. She serves as both an intimate friend and a perceptive critic of Stéphane's art.", zh: "一位诗人兼作家，在夜间遛狗时写下这封生日信。她既是斯蒂芬的亲密朋友，也是他艺术作品的敏锐评论者。" },
    },
    {
      name: { en: "Stéphane", zh: "斯蒂芬" },
      description: { en: "The letter's recipient, turning 61. An artist whose work is characterized by chaotic, explosive collages of symbols and fragmented imagery — described as producing 'extreme head racket' that constellates into memory maps.", zh: "信件的收信人，即将61岁。一位艺术家，其作品以混沌而具有爆发力的符号拼贴和碎片化意象为特征——被描述为产生\"极端的头脑喧嚣\"，最终汇聚成记忆的星图。" },
    },
  ],
};

export default function App() {
  const auth = useAppAuth();
  const [loginInput, setLoginInput] = useState("");
  const [sourceLang, setSourceLang] = useState<SourceLang>(() => readStoredSourceLang());
  const [targetLang, setTargetLang] = useState<TargetLang>(() => readStoredTargetLang());
  /** 当前正文里 en/zh 两列的语义所对应的「译成」方向；仅在新翻译完成或打开历史时更新。勿用顶栏 targetLang 直接映射已存在的段落，否则仅切换下拉会错列。 */
  const [contentPairTargetLang, setContentPairTargetLang] = useState<TargetLang>(() => readStoredTargetLang());
  /** 与 contentPairTargetLang 对应，段落对在 storage 中「左栏 / 右栏」各用哪个键（用于搜索高亮 field） */
  const pairLayoutOriginalField: "en" | "zh" = contentPairTargetLang === "en" ? "zh" : "en";
  const pairLayoutTranslatedField: "en" | "zh" = contentPairTargetLang === "en" ? "en" : "zh";

  const isLoggedIn = auth.isLoaded && !!auth.userId;
  const localUserBoot = readLocalUsernameBoot();

  /** 当前正文左栏实际语种（与本次 en/zh 数据一致）；栏目标题用此值，避免仅依赖 localStorage 的 sourceLang 与正文错位（如 Demo 英文左栏却显示「繁體中文」） */
  const [contentPairSourceLang, setContentPairSourceLang] = useState<SourceLang | null>(() =>
    readLocalUsernameBoot() ? null : "en"
  );
  /** 左栏为 AKI 密文、右栏为解码中文（与「译成 AKI」时左原文右密文区分） */
  const akiDecodeLayout = contentPairSourceLang === "aki" && contentPairTargetLang === "zh";

  /** 默认空文档，便于首页中央粘贴区展示；示例书信由「载入示例」触发，避免永远占满正文 */
  const [content, setContent] = useState<ParagraphPair[]>(() => []);
  const [analysis, setAnalysis] = useState<ArticleAnalysis | null>(null);
  const [title, setTitle] = useState(() => ({ zh: "", en: "" }));
  const [author, setAuthor] = useState(() => ({ zh: "", en: "" }));
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; step: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      // localStorage 一般支持 5–10MB，2MB 足够保存约 50 条翻译记录
      if (raw.length > 2_000_000) {
        try { localStorage.removeItem(HISTORY_KEY); } catch {}
        return [];
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        try { parsed = JSON5.parse(raw); } catch {
          try { localStorage.removeItem(HISTORY_KEY); } catch {}
          return [];
        }
      }
      if (!Array.isArray(parsed)) {
        try { localStorage.removeItem(HISTORY_KEY); } catch {}
        return [];
      }
      const valid = parsed.filter((it: unknown) => it && typeof it === 'object' && Array.isArray((it as HistoryItem).content));
      if (valid.length !== parsed.length) {
        try { localStorage.removeItem(HISTORY_KEY); } catch {}
        return [];
      }
      return valid.slice(0, MAX_HISTORY) as HistoryItem[];
    } catch {
      try { localStorage.removeItem(HISTORY_KEY); } catch {}
      return [];
    }
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [annotations, setAnnotations] = useState<Annotations>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [pendingSelection, setPendingSelection] = useState<{ paraIndex: number; startOffset: number; endOffset: number; selectedText: string } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [originalDocx, setOriginalDocx] = useState<ArrayBuffer | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<StorageMode>(() =>
    (localStorage.getItem(STORAGE_MODE_KEY) as StorageMode) || "local"
  );
  /** 与 CLERK_ADMIN_USER_IDS 对齐；避免仅 Vercel 构建缺 VITE_CLERK_ADMIN_USER_IDS 时误把管理员数据滤掉 */
  const [serverHistoryAdmin, setServerHistoryAdmin] = useState(false);

  const toggleStorageMode = () => {
    const next: StorageMode = storageMode === "local" ? "cloud" : "local";
    setStorageMode(next);
    localStorage.setItem(STORAGE_MODE_KEY, next);
  };

  const authUserPrevRef = useRef<string | null | undefined>(undefined);
  /** 本会话内是否已用过 HKU 静态彩蛋；再次输入 hku/香港大学则走 LLM 动态梗（与同批后续段落一致） */
  const hkuStaticEggConsumedRef = useRef(false);
  /** 本会话内是否已用过明治大学静态彩蛋；再次输入「明治大学」则走 LLM 动态梗 */
  const meijiStaticEggConsumedRef = useRef(false);
  /** 本会话内是否已用过中央戏剧学院静态彩蛋；再次输入「中央戏剧学院」则走 LLM 动态梗 */
  const zhongXiStaticEggConsumedRef = useRef(false);

  /** 从未选过目标语时：游客保持默认 AKI；已登录用户回落为简体中文（与历史产品习惯一致） */
  useLayoutEffect(() => {
    if (!auth.isLoaded) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(TARGET_LANG_KEY);
    } catch {
      return;
    }
    if (stored !== null) return;
    if (auth.userId) {
      setTargetLang("zh");
      setContentPairTargetLang("zh");
      try {
        localStorage.setItem(TARGET_LANG_KEY, "zh");
      } catch {
        /* ignore */
      }
    } else {
      try {
        localStorage.setItem(TARGET_LANG_KEY, "aki");
      } catch {
        /* ignore */
      }
    }
  }, [auth.isLoaded, auth.userId]);

  useLayoutEffect(() => {
    if (!auth.isLoaded) return;
    const prev = authUserPrevRef.current;
    const cur = auth.userId;
    if (prev === cur) return;
    authUserPrevRef.current = cur;

    if (cur) {
      setContent([]);
      setAnalysis(null);
      setTitle({ zh: "", en: "" });
      setAuthor({ zh: "", en: "" });
      setAnnotations([]);
      setContentPairTargetLang(targetLang);
      setContentPairSourceLang(null);
      setHistory((h) => h.map((item) => (item.username ? item : { ...item, username: cur })));
    } else {
      setContent([]);
      setAnalysis(null);
      setTitle({ zh: "", en: "" });
      setAuthor({ zh: "", en: "" });
      setAnnotations([]);
      setContentPairTargetLang(readStoredTargetLang());
      setContentPairSourceLang("en");
    }
  }, [auth.isLoaded, auth.userId]);

  useEffect(() => {
    if (!auth.userId) setServerHistoryAdmin(false);
  }, [auth.userId]);

  // ─── Search logic ───
  interface SearchMatch {
    paraIndex: number;
    field: "en" | "zh";
    startOffset: number;
    endOffset: number;
  }

  const searchMatches = useMemo<SearchMatch[]>(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const matches: SearchMatch[] = [];
    content.forEach((pair, paraIndex) => {
      for (const field of ["en", "zh"] as const) {
        const text = pair[field].toLowerCase();
        let idx = 0;
        while ((idx = text.indexOf(q, idx)) !== -1) {
          matches.push({ paraIndex, field, startOffset: idx, endOffset: idx + q.length });
          idx += q.length;
        }
      }
    });
    return matches;
  }, [searchQuery, content]);

  // Reset match index when matches change
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchMatches.length, searchQuery]);

  // Scroll to current match
  useEffect(() => {
    if (searchMatches.length === 0) return;
    const match = searchMatches[currentMatchIndex];
    if (!match) return;
    const el = document.querySelector(`[data-search-match="${currentMatchIndex}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentMatchIndex, searchMatches]);

  const goToNextMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % searchMatches.length);
  }, [searchMatches.length]);

  const goToPrevMatch = useCallback(() => {
    if (searchMatches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev - 1 + searchMatches.length) % searchMatches.length);
  }, [searchMatches.length]);

  const openSearch = useCallback(() => {
    if (content.length === 0) return;
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [content.length]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setCurrentMatchIndex(0);
  }, []);

  /** AKI 译文栏复制：在选中文本后附加本站地址，便于接收方打开解码 */
  const handleAkiTranslatedCopy = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (contentPairTargetLang !== "aki") return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const node = sel.anchorNode ?? sel.focusNode;
      if (!node) return;
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
      if (!el || !el.closest("[data-aki-translated]")) return;
      const text = sel.toString();
      if (!text.trim()) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", `${text.trim()}\n${AKI_SITE_URL}`);
    },
    [contentPairTargetLang]
  );

  /** 列头「复制」：各段 AKI 密文（不含彩蛋说明行）+ 换行 + 本站地址，与划选复制一致 */
  const copyFullAkiColumn = useCallback(async () => {
    if (contentPairTargetLang !== "aki" || content.length === 0) return;
    const text = content
      .map((p) => extractAkiCipherFromTranslatedParagraph(getTranslatedColumnText(p, contentPairTargetLang)))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (!text) return;
    const out = `${text}\n${AKI_SITE_URL}`;
    try {
      await navigator.clipboard.writeText(out);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = out;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        /* ignore */
      }
    }
  }, [content, contentPairTargetLang]);

  // Keyboard shortcut: Cmd/Ctrl+F
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f" && content.length > 0) {
        e.preventDefault();
        openSearch();
      }
      if (e.key === "Escape" && searchOpen) {
        closeSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [content.length, searchOpen, openSearch, closeSearch]);

  // Helper: render text with search highlights
  // textOffset: when rendering a substring of the full paragraph text, pass the starting offset
  const renderSearchHighlightedText = (text: string, paraIndex: number, field: "en" | "zh", textOffset: number = 0): React.ReactNode => {
    if (!searchQuery.trim()) return text;
    const rangeStart = textOffset;
    const rangeEnd = textOffset + text.length;
    const fieldMatches = searchMatches.filter(
      (m) => m.paraIndex === paraIndex && m.field === field && m.startOffset < rangeEnd && m.endOffset > rangeStart
    );
    if (fieldMatches.length === 0) return text;

    const segments: React.ReactNode[] = [];
    let cursor = 0; // cursor within `text`

    fieldMatches.forEach((match) => {
      // Clamp match offsets to the text range
      const mStart = Math.max(match.startOffset - textOffset, 0);
      const mEnd = Math.min(match.endOffset - textOffset, text.length);
      if (mStart > cursor) {
        segments.push(<span key={`s-${cursor}`}>{text.slice(cursor, mStart)}</span>);
      }
      const globalIdx = searchMatches.indexOf(match);
      const isActive = globalIdx === currentMatchIndex;
      segments.push(
        <mark
          key={`m-${mStart}`}
          data-search-match={globalIdx}
          className={`rounded-sm transition-colors ${
            isActive
              ? "bg-yellow-300/80 ring-2 ring-vibrant-1/50"
              : "bg-yellow-200/60"
          }`}
        >
          {text.slice(mStart, mEnd)}
        </mark>
      );
      cursor = mEnd;
    });

    if (cursor < text.length) {
      segments.push(<span key={`s-${cursor}`}>{text.slice(cursor)}</span>);
    }
    return <>{segments}</>;
  };

  const changeSourceLang = (lang: SourceLang) => {
    setSourceLang(lang);
    try {
      localStorage.setItem(SOURCE_LANG_KEY, lang);
    } catch {
      /* ignore */
    }
  };

  const isHistoryAdmin =
    (Boolean(auth.userId) && auth.mode === "clerk" && clerkAdminIdsFromEnv().has(auth.userId!)) ||
    serverHistoryAdmin;
  const historyCap = isHistoryAdmin ? MAX_HISTORY_ADMIN : MAX_HISTORY;

  // 普通用户只看自己的；管理员（环境变量或服务端 X-History-Admin）看全部
  const userHistory = !auth.userId
    ? []
    : isHistoryAdmin
      ? history
      : history.filter((h) => !h.username || h.username === auth.userId);

  // 从云端拉取历史（多设备同步），仅云端模式；Clerk 模式下附带会话 Token
  useEffect(() => {
    if (storageMode !== "cloud") return;
    if (!auth.isLoaded) return;
    let cancelled = false;
    (async () => {
      const headers: Record<string, string> = {};
      const t = await auth.getApiToken();
      if (t) headers.Authorization = `Bearer ${t}`;
      try {
        const res = await fetch("/api/history", { headers });
        const fromServerAdmin = res.headers.get("X-History-Admin") === "1";
        if (!cancelled) setServerHistoryAdmin(fromServerAdmin);
        const text = await res.text();
        if (!res.ok || cancelled) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = JSON5.parse(text);
        }
        const items = parsed as HistoryItem[];
        const envAdm =
          Boolean(auth.userId) && auth.mode === "clerk" && clerkAdminIdsFromEnv().has(auth.userId!);
        const cap = envAdm || fromServerAdmin ? MAX_HISTORY_ADMIN : MAX_HISTORY;
        if (Array.isArray(items) && items.length > 0) {
          const sliced = items.slice(0, cap);
          setHistory(sliced);
          try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(sliced));
          } catch {}
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageMode, auth.isLoaded, auth.userId, auth.getApiToken, auth.mode]);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // quota exceeded, ignore
    }
  }, [history]);

  const saveToHistory = (
    item: Omit<HistoryItem, "id" | "createdAt" | "username" | "sourceLang" | "targetLang">,
    langForRecord?: { sourceLang: SourceLang; targetLang: TargetLang }
  ) => {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const sl = langForRecord?.sourceLang ?? sourceLang;
    const tl = langForRecord?.targetLang ?? targetLang;
    const entry: HistoryItem = { ...item, id, createdAt, username: auth.userId || undefined, sourceLang: sl, targetLang: tl };
    setHistory((prev) => [entry, ...prev.slice(0, historyCap - 1)]);

    if (storageMode === "cloud") {
      (async () => {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const t = await auth.getApiToken();
        if (t) headers.Authorization = `Bearer ${t}`;
        fetch("/api/history", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...item, id, createdAt, username: auth.userId || undefined, sourceLang: sl, targetLang: tl }),
        }).catch(() => {});
      })();
    }
  };

  const loadFromHistory = (item: HistoryItem) => {
    setContent(item.content);
    setAnalysis(normalizeAnalysis(item.analysis) ?? item.analysis ?? null);
    setTitle(item.title);
    setAuthor(item.author);
    const isAkiDecodeRecord = item.title?.en === "AKI码 解码";
    if (isAkiDecodeRecord) {
      setSourceLang("en");
      setTargetLang("zh");
      setContentPairTargetLang("zh");
      setContentPairSourceLang("aki");
    } else {
      if (item.sourceLang && ALL_SOURCE_LANGS.includes(item.sourceLang)) setSourceLang(item.sourceLang);
      const t = item.targetLang && ALL_TARGET_LANGS.includes(item.targetLang) ? item.targetLang : "zh";
      setTargetLang(t);
      setContentPairTargetLang(t);
      setContentPairSourceLang(
        item.sourceLang && ALL_SOURCE_LANGS.includes(item.sourceLang) ? item.sourceLang : "en"
      );
    }
    setAnnotations(item.annotations ?? []);
    setCurrentHistoryId(item.id);
    setActiveAnnotationId(null);
    setAnnotationDraft("");
    setPendingSelection(null);
    setHistoryOpen(false);
  };

  const removeFromHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory((prev) => prev.filter((h) => h.id !== id));

    if (storageMode === "cloud") {
      (async () => {
        const headers: Record<string, string> = {};
        const t = await auth.getApiToken();
        if (t) headers.Authorization = `Bearer ${t}`;
        fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: "DELETE", headers }).catch(() => {});
      })();
    }
  };

  const syncAnnotationsToHistory = (updated: Annotations) => {
    if (currentHistoryId) {
      setHistory((h) =>
        h.map((item) => (item.id === currentHistoryId ? { ...item, annotations: updated } : item))
      );
    }
  };

  const addAnnotation = (text: string) => {
    if (!pendingSelection) return;
    const now = Date.now();
    const ann: Annotation = {
      id: crypto.randomUUID(),
      text,
      selectedText: pendingSelection.selectedText,
      paraIndex: pendingSelection.paraIndex,
      startOffset: pendingSelection.startOffset,
      endOffset: pendingSelection.endOffset,
      createdAt: now,
      updatedAt: now,
    };
    setAnnotations((prev) => {
      const updated = [...prev, ann];
      syncAnnotationsToHistory(updated);
      return updated;
    });
    setPendingSelection(null);
    setAnnotationDraft("");
  };

  const updateAnnotation = (id: string, text: string) => {
    setAnnotations((prev) => {
      const updated = prev.map((a) => (a.id === id ? { ...a, text, updatedAt: Date.now() } : a));
      syncAnnotationsToHistory(updated);
      return updated;
    });
    setActiveAnnotationId(null);
    setAnnotationDraft("");
  };

  const deleteAnnotation = (id: string) => {
    setAnnotations((prev) => {
      const updated = prev.filter((a) => a.id !== id);
      syncAnnotationsToHistory(updated);
      return updated;
    });
    setActiveAnnotationId(null);
    setAnnotationDraft("");
  };

  const getParaAnnotations = (paraIndex: number): Annotation[] => {
    return annotations.filter((a) => a.paraIndex === paraIndex).sort((a, b) => a.startOffset - b.startOffset);
  };

  // Handle text selection within a paragraph
  const handleTextSelect = (paraIndex: number) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    const selectedText = sel.toString().trim();
    if (!selectedText) return;

    // Find the paragraph container element
    const paraEl = document.querySelector(`[data-para-original="${paraIndex}"]`);
    if (!paraEl || !paraEl.contains(range.startContainer)) return;

    // Calculate character offsets within the paragraph text
    const fullText = getOriginalColumnText(content[paraIndex] ?? { en: "", zh: "" }, contentPairTargetLang);
    const preRange = document.createRange();
    preRange.selectNodeContents(paraEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const endOffset = startOffset + sel.toString().length;

    if (startOffset >= endOffset || endOffset > fullText.length) return;

    setPendingSelection({ paraIndex, startOffset, endOffset, selectedText });
    setAnnotationDraft("");
    setActiveAnnotationId(null);
  };

  // Render paragraph text with annotation highlights
  const renderAnnotatedText = (text: string, paraIndex: number) => {
    const paraAnns = getParaAnnotations(paraIndex);
    if (paraAnns.length === 0) {
      return <span>{renderSearchHighlightedText(text, paraIndex, pairLayoutOriginalField)}</span>;
    }

    const segments: React.ReactNode[] = [];
    let lastEnd = 0;

    paraAnns.forEach((ann) => {
      // Add plain text before this annotation (with search highlight)
      if (ann.startOffset > lastEnd) {
        segments.push(<span key={`t-${lastEnd}`}>{renderSearchHighlightedText(text.slice(lastEnd, ann.startOffset), paraIndex, pairLayoutOriginalField, lastEnd)}</span>);
      }
      // Add highlighted annotation span
      const isActive = activeAnnotationId === ann.id;
      segments.push(
        <span
          key={ann.id}
          className={`bg-vibrant-1/15 border-b-2 border-vibrant-1/40 cursor-pointer transition-colors rounded-sm ${
            isActive ? "bg-vibrant-1/30 ring-1 ring-vibrant-1/40" : "hover:bg-vibrant-1/25"
          }`}
          title={ann.text}
          onClick={(e) => {
            e.stopPropagation();
            if (isActive) {
              setActiveAnnotationId(null);
              setAnnotationDraft("");
            } else {
              setActiveAnnotationId(ann.id);
              setAnnotationDraft(ann.text);
              setPendingSelection(null);
            }
          }}
        >
          {text.slice(ann.startOffset, ann.endOffset)}
        </span>
      );
      lastEnd = ann.endOffset;
    });

    // Add remaining text (with search highlight)
    if (lastEnd < text.length) {
      segments.push(<span key={`t-${lastEnd}`}>{renderSearchHighlightedText(text.slice(lastEnd), paraIndex, pairLayoutOriginalField, lastEnd)}</span>);
    }

    return <>{segments}</>;
  };

  const handleExportDocx = async () => {
    const { exportToDocx } = await import("./exportDocx");
    await exportToDocx({ title, author, content, annotations, analysis, originalDocx, targetLang: contentPairTargetLang });
  };

  type TranslateResult = { translation: ParagraphPair[]; analysis: ArticleAnalysis; title?: { en: string; zh: string }; author?: { en: string; zh: string } };

  const translateAndAnalyzeStream = async (
    paragraphs: string[],
    onProgress: (p: { percent: number; step: string }) => void,
    srcLang: string = "en",
    tgtLang: TargetLang = "zh",
    onChunkDone?: (partial: { pairs: ParagraphPair[]; chunkIndex: number; title?: { en: string; zh: string }; author?: { en: string; zh: string }; analysis?: ArticleAnalysis | null }) => void
  ): Promise<TranslateResult> => {
    const res = await fetch("/api/translate-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paragraphs, sourceLang: srcLang, sourceLangFull: srcLang, targetLang: tgtLang }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      let msg = `流式接口不可用 (${res.status})`;
      try {
        const j = errText ? JSON.parse(errText) : {};
        if (j && typeof j.error === "string" && j.error) msg = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: { type: string; percent?: number; step?: string; result?: TranslateResult; message?: string; chunkIndex?: number; pairs?: ParagraphPair[]; title?: { en: string; zh: string }; author?: { en: string; zh: string }; analysis?: ArticleAnalysis | null };
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (msg.type === "progress") {
          onProgress({ percent: msg.percent ?? 0, step: msg.step ?? "" });
        } else if (msg.type === "chunk_done" && onChunkDone && msg.pairs) {
          onChunkDone({
            pairs: msg.pairs,
            chunkIndex: msg.chunkIndex ?? 0,
            title: msg.title,
            author: msg.author,
            analysis: msg.analysis ?? null,
          });
        } else if (msg.type === "done") {
          if (msg.result) return msg.result;
          throw new Error("模型返回格式异常，请重试");
        } else if (msg.type === "error") {
          throw new Error(msg.message ?? "翻译失败");
        }
      }
    }
    throw new Error("模型返回格式异常，请重试");
  };

  const translateAndAnalyze = async (paragraphs: string[], srcLang: string = "en", tgtLang: TargetLang = "zh"): Promise<TranslateResult> => {
    let res: Response;
    try {
      res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paragraphs, sourceLang: srcLang, sourceLangFull: srcLang, targetLang: tgtLang }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/fetch|network|failed/i.test(msg) || msg === "Load failed") {
        const h = typeof window !== "undefined" ? window.location?.hostname ?? "" : "";
        const isLocal = /^localhost$|^127\.0\.0\.1$/i.test(h) && !/vercel|netlify|cloudflarepages/i.test(h);
        throw new Error(isLocal
          ? "无法连接翻译服务。请先在另一终端运行：npm run server"
          : "无法连接翻译服务，请检查网络或稍后重试。若为 Vercel 部署，请在项目设置中配置 DEEPSEEK_API_KEY 并重新部署。");
      }
      throw err;
    }

    if (!res.ok) {
      const text = await res.text();
      let data: { error?: string; detail?: string } = {};
      try { data = text ? JSON.parse(text) : {}; } catch {}
      const serverMsg = data.error || data.detail;
      const h = typeof window !== "undefined" ? window.location?.hostname ?? "" : "";
      const isLocal = /^localhost$|^127\.0\.0\.1$/i.test(h) && !/vercel|netlify|cloudflarepages/i.test(h);
      // 504 = Vercel 函数超时，多发生在长文档
      if (res.status === 504) {
        throw new Error("翻译超时（文档过长）。请尝试上传较短文档（建议单次约 3000 字以内）或分批翻译。");
      }
      if (res.status === 502 || (res.status === 500 && !serverMsg)) {
        throw new Error(isLocal
          ? "翻译服务未启动。请先在另一终端运行：npm run server"
          : serverMsg || "翻译服务暂时不可用，请稍后重试。");
      }
      throw new Error(serverMsg || `翻译服务调用失败 (${res.status})`);
    }

    const text = await res.text();
    let result: { translation: ParagraphPair[]; analysis: ArticleAnalysis; title?: { en: string; zh: string }; author?: { en: string; zh: string } };
    try { result = JSON.parse(text); } catch {
      try { result = JSON5.parse(text); } catch {
        throw new Error('模型返回格式异常，请重试');
      }
    }
    return result;
  };

  /** 对已分段的原文调用翻译（不自动识别语言；用于重新翻译或粘贴流程的后半段） */
  const runTranslationCore = async (paragraphs: string[], apiSourceLang: SourceLang, usedTargetLang: TargetLang) => {
    if (paragraphs.length === 0) {
      throw new Error("文档内容为空");
    }

    setContent([]);

    // AKI码 快捷路径：任何语言→AKI 直接前端编码，不走翻译 API（动态梗走 /api/aki-meme 或 VITE_AKI_MEME_API）
    if (usedTargetLang === "aki") {
      setProgress({ percent: 40, step: "正在翻译..." });
      const memeUrl = getAkiMemeApiUrl();
      const memeErrState: AkiMemeErrorState = { reported: false };
      const fetchMeme = (t: string) => fetchAkiMemeApi(memeUrl, t, setError, memeErrState);
      const sessionHkuConsumed = hkuStaticEggConsumedRef.current;
      const sessionMeijiConsumed = meijiStaticEggConsumedRef.current;
      const sessionZhongXiConsumed = zhongXiStaticEggConsumedRef.current;
      const translation = await Promise.all(
        paragraphs.map((p, idx) => {
          const priorHkuInDoc = paragraphs.slice(0, idx).filter((pr) => isLegacyHkuInput(pr)).length;
          const skipLegacyHku =
            isLegacyHkuInput(p) && (priorHkuInDoc > 0 || sessionHkuConsumed);
          const priorMeijiInDoc = paragraphs.slice(0, idx).filter((pr) => isLegacyMeijiInput(pr)).length;
          const skipLegacyMeiji =
            isLegacyMeijiInput(p) && (priorMeijiInDoc > 0 || sessionMeijiConsumed);
          const priorZhongXiInDoc = paragraphs.slice(0, idx).filter((pr) => isLegacyZhongXiInput(pr)).length;
          const skipLegacyZhongXi =
            isLegacyZhongXiInput(p) && (priorZhongXiInDoc > 0 || sessionZhongXiConsumed);
          return buildAkiTranslatedColumnAsync(p, idx, fetchMeme, {
            skipLegacyHku,
            skipLegacyMeiji,
            skipLegacyZhongXi,
          }).then((zh) => ({
            en: p,
            zh,
          }));
        })
      );
      const showedStaticHkuThisJob = paragraphs.some((p, idx) => {
        const priorHkuInDoc = paragraphs.slice(0, idx).filter((pr) => isLegacyHkuInput(pr)).length;
        const skip = isLegacyHkuInput(p) && (priorHkuInDoc > 0 || sessionHkuConsumed);
        return isLegacyHkuInput(p) && !skip;
      });
      if (showedStaticHkuThisJob) {
        hkuStaticEggConsumedRef.current = true;
      }
      const showedStaticMeijiThisJob = paragraphs.some((p, idx) => {
        const priorMeijiInDoc = paragraphs.slice(0, idx).filter((pr) => isLegacyMeijiInput(pr)).length;
        const skip = isLegacyMeijiInput(p) && (priorMeijiInDoc > 0 || sessionMeijiConsumed);
        return isLegacyMeijiInput(p) && !skip;
      });
      if (showedStaticMeijiThisJob) {
        meijiStaticEggConsumedRef.current = true;
      }
      const showedStaticZhongXiThisJob = paragraphs.some((p, idx) => {
        const priorZhongXiInDoc = paragraphs.slice(0, idx).filter((pr) => isLegacyZhongXiInput(pr)).length;
        const skip = isLegacyZhongXiInput(p) && (priorZhongXiInDoc > 0 || sessionZhongXiConsumed);
        return isLegacyZhongXiInput(p) && !skip;
      });
      if (showedStaticZhongXiThisJob) {
        zhongXiStaticEggConsumedRef.current = true;
      }
      const result: TranslateResult = {
        title: { en: "—", zh: "—" },
        author: { en: "—", zh: "—" },
        translation,
        analysis: null,
      };
      setProgress({ percent: 95, step: "正在保存..." });
      const newTitle = { zh: "—", en: "—" };
      const newAuthor = { zh: "—", en: "—" };
      setContent(result.translation);
      setAnalysis(null);
      setTitle(newTitle);
      setAuthor(newAuthor);
      setAnnotations([]);
      setActiveAnnotationId(null);
      setPendingSelection(null);
      saveToHistory(
        { title: newTitle, author: newAuthor, content: result.translation, analysis: null, annotations: [] },
        { sourceLang: apiSourceLang, targetLang: usedTargetLang }
      );
      setContentPairSourceLang(apiSourceLang);
      setContentPairTargetLang(usedTargetLang);
      setProgress({ percent: 100, step: "完成" });
      return;
    }

    let result: TranslateResult;
    try {
      result = await translateAndAnalyzeStream(
        paragraphs,
        (p) => setProgress(p),
        apiSourceLang,
        usedTargetLang,
        (partial) => {
          if (partial.chunkIndex === 1) {
            setContent(partial.pairs);
            if (partial.title) setTitle({ zh: partial.title.zh || "—", en: partial.title.en || "—" });
            if (partial.author) setAuthor({ zh: partial.author.zh || "—", en: partial.author.en || "—" });
            if (partial.analysis) setAnalysis(normalizeAnalysis(partial.analysis) ?? partial.analysis);
          } else {
            setContent((prev) => [...prev, ...partial.pairs]);
          }
        }
      );
    } catch (streamErr: unknown) {
      let fallbackPercent = 20;
      const fallbackTimer = setInterval(() => {
        fallbackPercent = Math.min(fallbackPercent + 8, 85);
        setProgress({ percent: fallbackPercent, step: "翻译中..." });
      }, 1500);
      try {
        result = await translateAndAnalyze(paragraphs, apiSourceLang, usedTargetLang);
      } finally {
        clearInterval(fallbackTimer);
      }
    }

    setProgress({ percent: 95, step: "正在保存..." });
    const newTitle = { zh: (result.title?.zh || "").trim() || "—", en: (result.title?.en || "").trim() || "—" };
    const newAuthor = { zh: (result.author?.zh || "").trim() || "—", en: (result.author?.en || "").trim() || "—" };
    setContent(result.translation);
    setAnalysis(normalizeAnalysis(result.analysis) ?? result.analysis ?? null);
    setTitle(newTitle);
    setAuthor(newAuthor);
    setAnnotations([]);
    setActiveAnnotationId(null);
    setPendingSelection(null);
    saveToHistory(
      { title: newTitle, author: newAuthor, content: result.translation, analysis: result.analysis, annotations: [] },
      { sourceLang: apiSourceLang, targetLang: usedTargetLang }
    );
    setContentPairSourceLang(apiSourceLang);
    setContentPairTargetLang(usedTargetLang);
    setProgress({ percent: 100, step: "完成" });
  };

  /** 顶栏切换译文语言时：用左栏原文 + 新选语言整篇重译（沿用 Import 中的原文语言） */
  const retranslateToTarget = async (nextTarget: TargetLang) => {
    if (content.length === 0 || nextTarget === contentPairTargetLang) return;

    const fromAkiDecode = contentPairSourceLang === "aki" && contentPairTargetLang === "zh";
    const apiSourceLang: SourceLang = fromAkiDecode ? "zh" : sourceLang;

    const paragraphs = content
      .map((p) =>
        fromAkiDecode ? getTranslatedColumnText(p, "zh") : getOriginalColumnText(p, contentPairTargetLang)
      )
      .map((s) => s.trim());
    if (paragraphs.every((p) => !p)) {
      setError("无法从当前正文提取原文，请重新导入或粘贴后再试。");
      setTargetLang(contentPairTargetLang);
      try {
        localStorage.setItem(TARGET_LANG_KEY, contentPairTargetLang);
      } catch {
        /* ignore */
      }
      return;
    }

    const loggedInRt = Boolean(auth.userId);
    if (isGuestTranslationQuotaExceeded(loggedInRt)) {
      setError(GUEST_TRANSLATION_LIMIT_MESSAGE);
      if (auth.mode === "clerk") auth.login();
      setTargetLang(contentPairTargetLang);
      try {
        localStorage.setItem(TARGET_LANG_KEY, contentPairTargetLang);
      } catch {
        /* ignore */
      }
      return;
    }

    setIsTranslating(true);
    setError(null);
    setAnalysis(null);
    setProgress({ percent: 10, step: "正在按新译文语言重新翻译..." });

    try {
      if (fromAkiDecode) {
        setSourceLang("zh");
      }
      await runTranslationCore(paragraphs, apiSourceLang, nextTarget);
      incrementGuestTranslationSuccessIfVisitor(loggedInRt);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "重新翻译失败");
      setTargetLang(contentPairTargetLang);
      try {
        localStorage.setItem(TARGET_LANG_KEY, contentPairTargetLang);
      } catch {
        /* ignore */
      }
    } finally {
      setIsTranslating(false);
      setProgress(null);
    }
  };

  const changeTargetLang = (lang: TargetLang) => {
    setTargetLang(lang);
    try {
      localStorage.setItem(TARGET_LANG_KEY, lang);
    } catch {
      /* ignore */
    }
    if (isTranslating) return;
    if (content.length > 0 && lang !== contentPairTargetLang) {
      void retranslateToTarget(lang);
    }
  };

  // Shared: parse text into paragraphs and run translation（新稿：自动识别原文语言）
  const runTranslation = async (text: string) => {
    const textForJob = stripUrlsForTranslation(text);
    if (!textForJob.trim()) {
      throw new Error("文档内容为空");
    }

    const loggedIn = Boolean(auth.userId);
    if (isGuestTranslationQuotaExceeded(loggedIn)) {
      setError(GUEST_TRANSLATION_LIMIT_MESSAGE);
      if (auth.mode === "clerk") auth.login();
      throw new Error(GUEST_TRANSLATION_LIMIT_MESSAGE);
    }

    const usedTargetLang = targetLang;
    setProgress({ percent: 15, step: "正在提取段落..." });

    // AKI码 解码快捷路径：检测到 AKI码 输入时，直接前端解码，不走 API
    if (isProbablyAkiCipher(textForJob)) {
      const akiImport = prepareAkiImportText(textForJob);
      let paragraphs = akiImport.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
      if (paragraphs.length <= 1) {
        const byLines = akiImport.split(/\n/).map(p => p.trim()).filter(p => p.length > 0);
        if (byLines.length > paragraphs.length) paragraphs = byLines;
      }
      if (paragraphs.length === 0) throw new Error("文档内容为空");

      setProgress({ percent: 50, step: "加载中…" });
      const eggTails: string[] = [];
      const roughMains = paragraphs.map((p) => {
        const { cipherBlock, eggTail } = splitAkiPasteIntoCipherAndEgg(p);
        eggTails.push(eggTail);
        return decodeAki(cipherBlock) || "—";
      });
      let refinedMains = roughMains;
      if (roughMains.some(shouldRefineDecodedAkiText)) {
        setProgress({ percent: 62, step: "加载中…" });
        try {
          const res = await fetch("/api/refine-zh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paragraphs: roughMains }),
          });
          if (res.ok) {
            const data = (await res.json()) as { paragraphs?: unknown };
            if (Array.isArray(data.paragraphs)) {
              refinedMains = mergeRefinedParagraphs(roughMains, data.paragraphs);
            }
          }
        } catch {
          /* 离线或未配置 API：保留本地拼音还原结果 */
        }
      }

      /** 解码后右栏：明文 + 与「译成 AKI」相同的静态/动态梗（粘贴里已带彩蛋尾则不再生成） */
      setProgress({ percent: 68, step: "加载中…" });
      const memeUrl = getAkiMemeApiUrl();
      const decodeMemeErrState: AkiMemeErrorState = { reported: false };
      const fetchMemeForDecode = (t: string) => fetchAkiMemeApi(memeUrl, t, setError, decodeMemeErrState);
      const sessionHkuDec = hkuStaticEggConsumedRef.current;
      const sessionMeijiDec = meijiStaticEggConsumedRef.current;
      const sessionZhongXiDec = zhongXiStaticEggConsumedRef.current;

      const zhList = await Promise.all(
        refinedMains.map(async (_main, idx) => {
          const mainText = (refinedMains[idx] ?? roughMains[idx] ?? "—").trim() || "—";
          const pastedTail = eggTails[idx]?.trim();
          if (pastedTail) {
            return [mainText, pastedTail].join("\n\n");
          }
          const priorHkuInDoc = refinedMains.slice(0, idx).filter((pr) => isLegacyHkuInput(pr)).length;
          const skipLegacyHku =
            isLegacyHkuInput(mainText) && (priorHkuInDoc > 0 || sessionHkuDec);
          const priorMeijiInDoc = refinedMains.slice(0, idx).filter((pr) => isLegacyMeijiInput(pr)).length;
          const skipLegacyMeiji =
            isLegacyMeijiInput(mainText) && (priorMeijiInDoc > 0 || sessionMeijiDec);
          const priorZhongXiInDoc = refinedMains.slice(0, idx).filter((pr) => isLegacyZhongXiInput(pr)).length;
          const skipLegacyZhongXi =
            isLegacyZhongXiInput(mainText) && (priorZhongXiInDoc > 0 || sessionZhongXiDec);

          const fullAkiColumn = await buildAkiTranslatedColumnAsync(mainText, idx, fetchMemeForDecode, {
            skipLegacyHku,
            skipLegacyMeiji,
            skipLegacyZhongXi,
          });
          const eggFromBuild = splitAkiPasteIntoCipherAndEgg(fullAkiColumn).eggTail.trim();
          if (!eggFromBuild) return mainText;
          return [mainText, eggFromBuild].join("\n\n");
        })
      );

      const showedStaticHkuDecode = refinedMains.some((p, idx) => {
        const priorHkuInDoc = refinedMains.slice(0, idx).filter((pr) => isLegacyHkuInput(pr)).length;
        const skip = isLegacyHkuInput(p) && (priorHkuInDoc > 0 || sessionHkuDec);
        return isLegacyHkuInput(p) && !skip;
      });
      if (showedStaticHkuDecode) hkuStaticEggConsumedRef.current = true;
      const showedStaticMeijiDecode = refinedMains.some((p, idx) => {
        const priorMeijiInDoc = refinedMains.slice(0, idx).filter((pr) => isLegacyMeijiInput(pr)).length;
        const skip = isLegacyMeijiInput(p) && (priorMeijiInDoc > 0 || sessionMeijiDec);
        return isLegacyMeijiInput(p) && !skip;
      });
      if (showedStaticMeijiDecode) meijiStaticEggConsumedRef.current = true;
      const showedStaticZhongXiDecode = refinedMains.some((p, idx) => {
        const priorZxInDoc = refinedMains.slice(0, idx).filter((pr) => isLegacyZhongXiInput(pr)).length;
        const skip = isLegacyZhongXiInput(p) && (priorZxInDoc > 0 || sessionZhongXiDec);
        return isLegacyZhongXiInput(p) && !skip;
      });
      if (showedStaticZhongXiDecode) zhongXiStaticEggConsumedRef.current = true;

      const translation = paragraphs.map((p, i) => ({
        en: p,
        zh: zhList[i] ?? "—",
      }));
      const newTitle = { zh: "—", en: "AKI码 解码" };
      const newAuthor = { zh: "—", en: "—" };
      setContent(translation);
      setAnalysis(null);
      setTitle(newTitle);
      setAuthor(newAuthor);
      setAnnotations([]);
      setActiveAnnotationId(null);
      setPendingSelection(null);
      setContentPairSourceLang("aki");
      setContentPairTargetLang("zh");
      setSourceLang("zh");
      setTargetLang("zh");
      try {
        localStorage.setItem(TARGET_LANG_KEY, "zh");
      } catch {
        /* ignore */
      }
      saveToHistory(
        { title: newTitle, author: newAuthor, content: translation, analysis: null, annotations: [] },
        { sourceLang: "aki", targetLang: "zh" }
      );
      setProgress({ percent: 100, step: "完成" });
      incrementGuestTranslationSuccessIfVisitor(loggedIn);
      return;
    }

    let paragraphs = textForJob.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
    if (paragraphs.length <= 1 || paragraphs.some(p => p.length > 5000)) {
      const byLines = textForJob.split(/\n/).map(p => p.trim()).filter(p => p.length > 0);
      if (byLines.length > paragraphs.length) paragraphs = byLines;
    }

    if (paragraphs.length === 0) {
      throw new Error("文档内容为空");
    }

    const detected = detectSourceLang(textForJob);
    changeSourceLang(detected);
    const apiSourceLang = detected;

    setProgress({ percent: 18, step: "正在翻译..." });
    await runTranslationCore(paragraphs, apiSourceLang, usedTargetLang);
    incrementGuestTranslationSuccessIfVisitor(loggedIn);
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();

    if (!["docx", "doc", "pdf"].includes(ext ?? "")) {
      setError("请上传 .pdf、.docx 或 .doc 文件");
      return;
    }

    setIsTranslating(true);
    setError(null);
    setAnalysis(null);

    try {
      setProgress({ percent: 5, step: "正在解析文档..." });

      setOriginalDocx(null); // reset
      let text = "";
      if (ext === "pdf") {
        const arrayBuffer = await file.arrayBuffer();
        text = await extractPdfText(arrayBuffer);
      } else if (ext === "docx") {
        const arrayBuffer = await file.arrayBuffer();
        setOriginalDocx(arrayBuffer.slice(0)); // keep a copy
        const result = await mammoth.extractRawText({ arrayBuffer });
        text = result.value;
      } else {
        const formData = new FormData();
        formData.append("file", file);
        const resp = await fetch("/api/extract-text", { method: "POST", body: formData });
        if (!resp.ok) throw new Error("旧版 .doc 文件解析失败，建议另存为 .docx 后重试");
        const data = await resp.json();
        text = data.text;
      }

      await runTranslation(text);
    } catch (err: any) {
      setError(err.message || "文件处理出错");
    } finally {
      setIsTranslating(false);
      setProgress(null);
    }
  };

  const handleTextSubmit = async () => {
    const text = textInput.trim();
    if (!text) return;

    setIsTranslating(true);
    setError(null);
    setAnalysis(null);
    setOriginalDocx(null); // text input has no original docx

    try {
      setProgress({ percent: 10, step: "正在准备翻译..." });
      await runTranslation(text);
      setTextInput("");
    } catch (err: any) {
      setError(err.message || "翻译出错");
    } finally {
      setIsTranslating(false);
      setProgress(null);
    }
  };

  const loadDemoDocument = useCallback(() => {
    setError(null);
    setOriginalDocx(null);
    setContent(DEMO_CONTENT);
    setAnalysis(DEMO_ANALYSIS);
    setTitle(DEMO_TITLE);
    setAuthor(DEMO_AUTHOR);
    setAnnotations([]);
    setActiveAnnotationId(null);
    setPendingSelection(null);
    setContentPairSourceLang("en");
    setContentPairTargetLang(readStoredTargetLang());
    setSourceLang("en");
  }, []);

  if (auth.mode === "clerk" && !auth.isLoaded) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center font-sans text-sm text-ink/40">
        加载中…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper selection:bg-vibrant-1/10 relative">
      <div className="vibrant-bg" />
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 glass-nav px-3 sm:px-6 py-3 sm:py-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="max-w-6xl mx-auto flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center sm:gap-4">
          <div className="flex items-center gap-3 sm:gap-6 min-w-0 shrink-0">
            <button
              onClick={() => setHistoryOpen(true)}
              className="p-2 -m-2 rounded-full hover:bg-ink/5 transition-colors touch-manipulation"
              aria-label="历史记录"
            >
              <Menu className="w-5 h-5 hover:text-vibrant-1 transition-colors" />
            </button>
            <button
              onClick={() => setImportOpen(!importOpen)}
              className="group flex items-center gap-2 text-[10px] sm:text-xs uppercase tracking-widest font-sans font-bold hover:text-vibrant-1 transition-all disabled:opacity-30 touch-manipulation"
              disabled={isTranslating}
            >
              <div className="p-2 bg-ink text-paper rounded-full group-hover:bg-vibrant-1 transition-colors">
                <Upload className="w-3 h-3" />
              </div>
              <span className="hidden min-[400px]:inline">{isTranslating ? "Processing..." : "Import"}</span>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => { handleFileUpload(e); setImportOpen(false); }}
              accept=".docx,.doc,.pdf"
              className="hidden"
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-2 sm:gap-3 min-w-0 flex-1 sm:flex-initial">
            {/* Search button */}
            {content.length > 0 && (
              <button
                onClick={openSearch}
                className="p-2 -m-2 rounded-full hover:bg-ink/5 transition-colors touch-manipulation"
                title="搜索 (⌘F)"
                aria-label="搜索"
              >
                <Search className="w-4.5 h-4.5 text-ink/40 hover:text-vibrant-1 transition-colors" />
              </button>
            )}
            {/* 仅「译成」可选：简体 / 繁体 / English；原文语种由正文自动识别（见正文区标签） */}
            <span className="text-[10px] font-sans text-ink/40 shrink-0 hidden sm:inline" title="你要翻译成哪种语言">
              译成
            </span>
            <div className="relative min-w-0 max-w-[min(52vw,11rem)] sm:max-w-none">
              <select
                value={targetLang}
                onChange={(e) => changeTargetLang(e.target.value as TargetLang)}
                disabled={isTranslating}
                title={`译文语言：${TARGET_LANG_LABELS[targetLang]}。新导入/粘贴的翻译使用该语言；若已有正文，切换语言后将按左栏原文自动重新翻译。`}
                aria-label={`译文 ${TARGET_LANG_LABELS[targetLang]}`}
                className="appearance-none bg-transparent pl-7 pr-6 py-1.5 text-[11px] sm:text-xs font-sans font-medium text-ink/60 hover:text-ink cursor-pointer outline-none border border-ink/10 rounded-full hover:border-ink/20 transition-colors disabled:opacity-40 disabled:pointer-events-none max-w-full min-w-0"
              >
                {(Object.entries(TARGET_LANG_LABELS) as [TargetLang, string][]).map(([k, v]) => (
                  <option key={k} value={k} title={v}>
                    {v}
                  </option>
                ))}
              </select>
              <Globe className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink/40 pointer-events-none" />
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-ink/30 pointer-events-none" />
            </div>
            <button
              onClick={handleExportDocx}
              className="p-2 -m-2 rounded-full hover:bg-ink/5 transition-colors disabled:opacity-30 touch-manipulation"
              disabled={content.length === 0}
              title="导出为 Word 文档"
              aria-label="导出为 Word 文档"
            >
              <FileDown className="w-5 h-5 hover:text-vibrant-1 transition-colors" />
            </button>
            {/* User & logout / login：Clerk 模式走弹窗登录（含密码）；本地模式仅用户名 */}
            {auth.userId ? (
              <>
                <span className="text-xs font-sans text-ink/40 hidden sm:inline max-w-[120px] truncate" title={auth.displayName ?? undefined}>
                  {auth.displayName}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    auth.logout();
                    setLoginInput("");
                  }}
                  className="p-2 -m-2 rounded-full hover:bg-ink/5 transition-colors touch-manipulation"
                  title="退出登录"
                  aria-label="退出登录"
                >
                  <LogOut className="w-4 h-4 text-ink/40 hover:text-vibrant-1 transition-colors" />
                </button>
              </>
            ) : auth.mode === "clerk" ? (
              <button
                type="button"
                onClick={() => auth.login()}
                className="px-3 py-1.5 bg-ink text-paper text-[10px] font-sans font-bold uppercase tracking-wider rounded-full hover:bg-vibrant-1 transition-colors touch-manipulation shrink-0"
              >
                登录
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = loginInput.trim();
                  if (!t) return;
                  auth.login(t);
                  setLoginInput("");
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  value={loginInput}
                  onChange={(e) => setLoginInput(e.target.value)}
                  placeholder="用户名"
                  autoComplete="username"
                  className="w-24 sm:w-28 px-2.5 py-1.5 bg-white/60 border border-ink/10 rounded-full text-xs font-sans text-ink/70 placeholder:text-ink/30 outline-none focus:border-vibrant-1/30 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!loginInput.trim()}
                  className="px-3 py-1.5 bg-ink text-paper text-[10px] font-sans font-bold uppercase tracking-wider rounded-full hover:bg-vibrant-1 transition-colors disabled:opacity-30"
                >
                  登录
                </button>
              </form>
            )}
            <button
              onClick={() => setHelpOpen(true)}
              className="p-2 -m-2 rounded-full hover:bg-ink/5 transition-colors touch-manipulation"
              title="说明"
              aria-label="说明"
            >
              <HelpCircle className="w-4.5 h-4.5 text-ink/30 hover:text-vibrant-1 transition-colors" />
            </button>
          </div>
        </div>
      </nav>

      {/* Search Bar */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="sticky top-[5.5rem] sm:top-[4.5rem] z-50 mx-auto max-w-lg px-3 sm:px-6 pt-2"
          >
            <div className="flex flex-wrap items-center gap-2 bg-white/80 backdrop-blur-2xl border border-ink/10 rounded-2xl shadow-lg px-3 sm:px-4 py-2.5">
              <Search className="w-4 h-4 text-ink/30 shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.shiftKey ? goToPrevMatch() : goToNextMatch();
                  }
                }}
                placeholder="搜索文章内容..."
                className="flex-1 bg-transparent outline-none font-sans text-sm text-ink/80 placeholder:text-ink/30"
                autoFocus
              />
              <span className="text-xs font-sans text-ink/40 shrink-0 tabular-nums min-w-[3rem] text-center">
                {searchQuery.trim()
                  ? searchMatches.length > 0
                    ? `${currentMatchIndex + 1}/${searchMatches.length}`
                    : "0/0"
                  : ""}
              </span>
              <button
                onClick={goToPrevMatch}
                disabled={searchMatches.length === 0}
                className="p-1.5 rounded-lg hover:bg-ink/5 transition-colors disabled:opacity-20"
                aria-label="上一个"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                onClick={goToNextMatch}
                disabled={searchMatches.length === 0}
                className="p-1.5 rounded-lg hover:bg-ink/5 transition-colors disabled:opacity-20"
                aria-label="下一个"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
              <button
                onClick={closeSearch}
                className="p-1.5 rounded-lg hover:bg-ink/5 transition-colors"
                aria-label="关闭搜索"
              >
                <X className="w-4 h-4 text-ink/40" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import Panel — dropdown under nav */}
      <AnimatePresence>
        {importOpen && !isTranslating && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setImportOpen(false)}
              className="fixed inset-0 z-40"
            />
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="sticky top-[5.5rem] sm:top-[4.5rem] z-50 mx-auto max-w-2xl px-3 sm:px-6"
            >
              <div className="bg-white/80 backdrop-blur-2xl border border-ink/10 rounded-3xl shadow-2xl shadow-ink/10 p-4 sm:p-6">
                <textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="粘贴或输入需要翻译的文本..."
                  className="w-full min-h-[160px] bg-transparent resize-y outline-none font-serif text-sm leading-relaxed text-ink/80 placeholder:text-ink/20"
                  autoFocus
                />
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-ink/5">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-sans font-medium text-ink/40 hover:text-ink/70 hover:bg-ink/5 rounded-xl transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>上传 Word / PDF</span>
                  </button>
                  <button
                    onClick={() => { handleTextSubmit(); setImportOpen(false); }}
                    disabled={!textInput.trim()}
                    className="px-6 py-2.5 bg-ink text-paper text-xs font-sans font-bold uppercase tracking-widest rounded-2xl hover:bg-vibrant-1 transition-colors disabled:opacity-20"
                  >
                    翻译
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Help Modal */}
      <AnimatePresence>
        {helpOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setHelpOpen(false)}
              className="fixed inset-0 bg-ink/20 backdrop-blur-sm z-[80]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6 pointer-events-none"
            >
              <div className="pointer-events-auto w-full max-w-lg max-h-[min(85dvh,32rem)] sm:max-h-[80vh] overflow-y-auto bg-white/95 backdrop-blur-2xl border border-ink/10 rounded-3xl sm:rounded-[2.5rem] shadow-2xl p-6 sm:p-10">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h2 className="font-serif text-2xl font-bold text-ink">Aki 的翻译器</h2>
                    <p className="font-sans text-xs text-ink/50 mt-1 tracking-wide">Aki&apos;s Translator</p>
                    <p className="font-sans text-[11px] text-ink/35 mt-2 uppercase tracking-[0.2em]">AKI 动物密文</p>
                  </div>
                  <button onClick={() => setHelpOpen(false)} className="p-2 -m-2 rounded-full hover:bg-ink/5">
                    <X className="w-5 h-5 text-ink/40" />
                  </button>
                </div>

                <div className="space-y-6 text-sm font-sans text-ink/70 leading-relaxed">
                  <div>
                    <h3 className="font-bold text-ink/90 text-xs uppercase tracking-widest mb-2">用途</h3>
                    <p className="text-ink/85 font-medium mb-2">试试彩蛋吧！</p>
                    <p>
                      面向文学文本的<strong>双语翻译与结构化分析</strong>：上传或粘贴文档，在顶栏「译成」选择目标语言（未选过时游客默认为 <strong>AKI 码</strong>；登录用户默认为简体中文），生成双语对照与文学分析，包括剧情梗概、人物介绍、写作优缺点等。
                      另可将正文译为<strong>本站专属的 AKI 动物密文</strong>（字母与拼音对应小动物 emoji），或<strong>直接粘贴密文</strong>，由站内规则一键解码回中文。
                    </p>
                  </div>

                  <div>
                    <h3 className="font-bold text-ink/90 text-xs uppercase tracking-widest mb-2">支持语言</h3>
                    <p>
                      源语言由正文自动识别，无需手选。常见源文：英文、法文、德文、阿拉伯文、日文、繁体中文等。
                      目标语可选：简体中文、繁体中文、English、日本語、法语、德语、阿拉伯语；亦可译为<strong>摩斯密码</strong>或<strong> AKI 码</strong>。
                    </p>
                  </div>

                  <div>
                    <h3 className="font-bold text-ink/90 text-xs uppercase tracking-widest mb-2">核心功能</h3>
                    <ul className="space-y-2">
                      <li className="flex gap-2"><span className="text-vibrant-1 font-bold shrink-0">·</span>翻译 — 顶栏「译成」选择目标语言；原文语种由正文自动识别</li>
                      <li className="flex gap-2"><span className="text-vibrant-1 font-bold shrink-0">·</span>文学分析 — 目标为自然语言时，自动生成双语摘要、叙事分析、核心主题、剧情梗概、人物介绍、写作优缺点</li>
                      <li className="flex gap-2"><span className="text-vibrant-1 font-bold shrink-0">·</span>批注 — 选中原文段落中的任意文本，添加批注（类似 Word 批注）</li>
                      <li className="flex gap-2"><span className="text-vibrant-1 font-bold shrink-0">·</span>导出 — 一键导出为 Word（.docx），批注保留为 Word 原生批注</li>
                      <li className="flex gap-2"><span className="text-vibrant-1 font-bold shrink-0">·</span>历史记录 — 自动保存，支持本地或云端同步</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="font-bold text-ink/90 text-xs uppercase tracking-widest mb-2">使用方式</h3>
                    <ol className="space-y-1.5 list-decimal list-inside">
                      <li>点击左上角 <strong>Import</strong>，粘贴文本或上传 .pdf / .docx / .doc</li>
                      <li>顶栏「译成」选择目标语言；需要密文时选 <strong>AKI 码</strong> 或 <strong>摩斯密码</strong></li>
                      <li>若剪贴板里是 AKI 密文，直接粘贴并翻译，将走<strong>解码为中文</strong>（自动忽略文末网址等干扰行）</li>
                      <li>系统自动识别源语言并处理；自然语言目标下生成双语对照与文学分析</li>
                      <li>在原文中选中文字即可添加批注</li>
                      <li>点击右上角下载图标导出为 Word</li>
                      <li>登录后可管理个人历史（配置 Clerk 时账号登录；未配置时可用本地用户名）</li>
                    </ol>
                  </div>

                  <div className="pt-4 border-t border-ink/5 space-y-3">
                    <p className="text-[11px] leading-relaxed text-ink/45 text-center font-sans">
                      本站展示内容（含翻译、分析与 AKI 梗等）由人工智能生成；仅供参考，不代表本站立场。
                    </p>
                    <p className="text-[10px] uppercase tracking-widest font-bold text-ink/20 text-center">
                      React + TypeScript + Vite · Tailwind CSS · DeepSeek AI · docx.js
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* History Sidebar */}
      <AnimatePresence>
        {historyOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setHistoryOpen(false)}
              className="fixed inset-0 bg-ink/20 backdrop-blur-sm z-[60]"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "tween", duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="fixed left-0 top-0 bottom-0 w-full max-w-md bg-white/95 backdrop-blur-xl border-r border-ink/10 shadow-2xl z-[70] overflow-hidden flex flex-col"
            >
              <div className="flex justify-between items-center px-6 py-5 border-b border-ink/10">
                <div>
                  <h2 className="font-sans text-sm uppercase tracking-widest font-bold text-ink">历史翻译</h2>
                  {isHistoryAdmin && (
                    <p className="text-[10px] text-vibrant-1 font-sans font-medium mt-1">管理员 · 全部用户记录</p>
                  )}
                </div>
                <button onClick={() => setHistoryOpen(false)} className="p-2 -m-2 rounded-full hover:bg-ink/5">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-6 py-3 border-b border-ink/10 flex items-center justify-between">
                <span className="font-sans text-xs text-ink/60">
                  {storageMode === "local" ? "仅本地" : "云端同步"}
                </span>
                <button
                  onClick={toggleStorageMode}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-sans font-medium transition-colors hover:bg-ink/5"
                  title={storageMode === "local" ? "切换到云端同步" : "切换到仅本地"}
                >
                  {storageMode === "local" ? (
                    <Monitor className="w-3.5 h-3.5 text-ink/50" />
                  ) : (
                    <Database className="w-3.5 h-3.5 text-vibrant-1" />
                  )}
                  <span className="text-ink/70">{storageMode === "local" ? "本地" : "云端"}</span>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {userHistory.length === 0 ? (
                  <p className="text-sm text-ink/40 font-sans py-12 text-center">暂无历史记录</p>
                ) : (
                  <ul className="space-y-2">
                    {userHistory.map((item) => (
                      <li
                        key={item.id}
                        onClick={() => loadFromHistory(item)}
                        className="group flex items-start gap-3 p-4 rounded-2xl hover:bg-ink/5 cursor-pointer transition-colors border border-transparent hover:border-ink/5"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-serif-zh font-medium text-ink truncate">{item.title.zh || item.title.en || "无标题"}</p>
                          <p className="text-xs text-ink/50 mt-0.5 font-sans">
                            {item.author.zh || item.author.en || "—"} · {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                            {isHistoryAdmin && item.username && (
                              <span
                                className="block text-[10px] text-ink/35 truncate mt-0.5"
                                title={item.username}
                              >
                                用户 {item.ownerDisplayName || item.username}
                              </span>
                            )}
                          </p>
                        </div>
                        <button
                          onClick={(e) => removeFromHistory(item.id, e)}
                          className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 rounded-full text-red-500/60 hover:text-red-500 transition-all"
                          aria-label="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 md:py-32 relative z-10 pb-[max(4rem,env(safe-area-inset-bottom))]">
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mb-8 p-4 bg-white/60 backdrop-blur-md border border-red-200 text-red-800 rounded-2xl flex items-center gap-3 font-sans text-sm shadow-xl shadow-red-500/5"
            >
              <AlertCircle className="w-4 h-4 text-red-500" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header Section - 仅当标题或作者非占位符时显示，避免显示四条 — */}
        {[title.zh, title.en, author.zh, author.en].some(t => t?.trim() && !/^[—\-]+$/.test(t.trim())) ? (
          <header className="mb-16 md:mb-32">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
              className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-24"
            >
              <div className="space-y-6">
                <h2 className={`${contentPairTargetLang === "en" ? "book-title-zh" : "book-title-en"} whitespace-pre-line`}>{contentPairTargetLang === "en" ? title.zh : title.en}</h2>
                <p className={`text-xl opacity-60 ${contentPairTargetLang === "en" ? "font-serif-zh tracking-widest" : "font-serif italic"}`}>{contentPairTargetLang === "en" ? author.zh : author.en}</p>
              </div>
              <div
                className="space-y-6"
                data-aki-translated={contentPairTargetLang === "aki" ? "1" : undefined}
                onCopy={handleAkiTranslatedCopy}
              >
                <h2 className={`${contentPairTargetLang === "en" ? "book-title-en" : "book-title-zh"} whitespace-pre-line`}>{contentPairTargetLang === "en" ? title.en : title.zh}</h2>
                <p className={`text-xl opacity-60 ${contentPairTargetLang === "en" ? "font-serif italic" : "font-serif-zh tracking-widest"}`}>{contentPairTargetLang === "en" ? author.en : author.zh}</p>
              </div>
            </motion.div>
          </header>
        ) : null}

        {/* Full Loading State - 尚未收到任何段落时 */}
        {isTranslating && content.length === 0 && (
          <div className="flex flex-col items-center justify-center py-32 space-y-8 max-w-xl mx-auto">
            <div className="relative w-full">
              <Loader2 className="w-16 h-16 animate-spin text-ink/40 relative z-10 mx-auto mb-8 block" />
              <div className="relative z-10 h-2 bg-ink/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-ink/30 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress?.percent ?? 0}%` }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                />
              </div>
              <p className="mt-4 font-sans text-sm text-ink/60 text-center">
                {progress?.step ?? "处理中..."}
              </p>
              {!progress?.step?.includes("加载中") ? (
                <p className="mt-1 font-sans text-xs text-ink/40 text-center">
                  {progress?.percent ?? 0}%
                </p>
              ) : null}
            </div>
          </div>
        )}

        {/* Compact Progress - 已有段落显示时，顶部紧凑进度条 */}
        {isTranslating && content.length > 0 && (
          <div className="sticky top-[5.25rem] sm:top-20 z-40 py-3 sm:py-4 px-4 sm:px-6 mb-6 sm:mb-8 rounded-2xl bg-white/60 backdrop-blur-md border border-ink/10 shadow-lg max-w-2xl mx-auto">
            <div className="h-1.5 bg-ink/10 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-ink/40 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress?.percent ?? 0}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>
            <p className="mt-2 font-sans text-xs text-ink/50 text-center">
              {progress?.step?.includes("加载中")
                ? progress?.step ?? "加载中…"
                : `${progress?.step ?? "翻译中..."} ${progress?.percent ?? 0}%`}
            </p>
          </div>
        )}

        {/* Content Section - 有内容或翻译完成时展示 */}
        {(content.length > 0 || !isTranslating) && (
          <>
            {content.length > 0 && (
            <>
            <div className="w-full py-12 border-y border-ink/5 mb-10" aria-label="广告位">
              <h2 className="font-serif text-sm md:text-base font-light tracking-tight text-ink/80 break-words">
                广告位招租，自定义你的专属彩蛋。akicodehk@gmail.com
              </h2>
            </div>

            <article className="space-y-10 md:space-y-16">
              {/* Column labels */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-12 md:gap-24 mb-2">
                <div>
                  <span className="font-sans text-[10px] uppercase tracking-[0.4em] font-bold opacity-30">
                    {akiDecodeLayout ? "AKI码" : SOURCE_LANG_LABELS[contentPairSourceLang ?? sourceLang] || "Source"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 min-h-[1.25rem]">
                  <span className="font-sans text-[10px] uppercase tracking-[0.4em] font-bold opacity-30 shrink-0">
                    {akiDecodeLayout ? "简体中文" : TARGET_LANG_LABELS[contentPairTargetLang]}
                  </span>
                  {contentPairTargetLang === "aki" && content.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => void copyFullAkiColumn()}
                      className="shrink-0 px-3 py-1.5 bg-ink text-paper text-[10px] font-sans font-bold uppercase tracking-wider rounded-full hover:bg-vibrant-1 transition-colors"
                      title="复制 AKI 密文与本站链接（不含彩蛋说明文字）"
                      aria-label="复制 AKI 密文与网站链接"
                    >
                      复制
                    </button>
                  ) : null}
                </div>
              </div>
              {content.map((pair, paraIndex) => {
                const paraAnns = getParaAnnotations(paraIndex);
                const activeAnn = activeAnnotationId ? annotations.find((a) => a.id === activeAnnotationId && a.paraIndex === paraIndex) : null;
                const hasPending = pendingSelection?.paraIndex === paraIndex;

                return (
                <motion.div
                  key={paraIndex}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="relative grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-12 md:gap-24 items-start">
                    {/* 原文 — 选字批注 */}
                    <div
                      className={`content-text whitespace-pre-wrap text-ink/80 ${akiDecodeLayout ? "font-mono text-sm tracking-tight" : ""}`}
                      data-para-original={paraIndex}
                      onMouseUp={() => handleTextSelect(paraIndex)}
                    >
                      {renderAnnotatedText(
                        getOriginalColumnText(pair, contentPairTargetLang),
                        paraIndex
                      )}
                    </div>

                    {/* 译文 */}
                    <div
                      className={`content-text whitespace-pre-wrap ${
                        akiDecodeLayout
                          ? "content-text-zh"
                          : contentPairTargetLang === "morse" || contentPairTargetLang === "aki"
                            ? "font-mono text-sm tracking-tight"
                            : "content-text-zh"
                      }`}
                      dir={contentPairTargetLang === "ar" ? "rtl" : undefined}
                      data-aki-translated={contentPairTargetLang === "aki" ? "1" : undefined}
                      onCopy={handleAkiTranslatedCopy}
                    >
                      {renderSearchHighlightedText(
                        getTranslatedColumnText(pair, contentPairTargetLang),
                        paraIndex,
                        pairLayoutTranslatedField
                      )}
                    </div>
                  </div>

                  {/* New annotation panel — after selecting text */}
                  <AnimatePresence>
                    {hasPending && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 p-5 bg-white/60 backdrop-blur-md border border-ink/10 rounded-2xl shadow-lg">
                          <div className="mb-3 text-xs font-sans text-ink/40">
                            选中文本: <span className="font-medium text-vibrant-1">"{pendingSelection!.selectedText}"</span>
                          </div>
                          <textarea
                            value={annotationDraft}
                            onChange={(e) => setAnnotationDraft(e.target.value)}
                            placeholder="输入批注内容..."
                            className="w-full min-h-[60px] bg-transparent resize-y outline-none font-sans text-sm text-ink/80 placeholder:text-ink/30"
                            autoFocus
                          />
                          <div className="flex justify-end gap-2 mt-3">
                            <button
                              onClick={() => { setPendingSelection(null); setAnnotationDraft(""); }}
                              className="px-3 py-1.5 text-xs font-sans font-medium text-ink/50 hover:bg-ink/5 rounded-lg transition-colors"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => { if (annotationDraft.trim()) addAnnotation(annotationDraft.trim()); }}
                              disabled={!annotationDraft.trim()}
                              className="px-4 py-1.5 text-xs font-sans font-bold text-white bg-vibrant-1 hover:bg-vibrant-1/90 rounded-lg transition-colors disabled:opacity-30"
                            >
                              添加批注
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Edit existing annotation panel */}
                  <AnimatePresence>
                    {activeAnn && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 p-5 bg-white/60 backdrop-blur-md border border-ink/10 rounded-2xl shadow-lg">
                          <div className="mb-3 text-xs font-sans text-ink/40">
                            批注: <span className="font-medium text-vibrant-1">"{activeAnn.selectedText}"</span>
                          </div>
                          <textarea
                            value={annotationDraft}
                            onChange={(e) => setAnnotationDraft(e.target.value)}
                            placeholder="修改批注内容..."
                            className="w-full min-h-[60px] bg-transparent resize-y outline-none font-sans text-sm text-ink/80 placeholder:text-ink/30"
                            autoFocus
                          />
                          <div className="flex justify-end gap-2 mt-3">
                            <button
                              onClick={() => deleteAnnotation(activeAnn.id)}
                              className="px-3 py-1.5 text-xs font-sans font-medium text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
                            >
                              删除
                            </button>
                            <button
                              onClick={() => { setActiveAnnotationId(null); setAnnotationDraft(""); }}
                              className="px-3 py-1.5 text-xs font-sans font-medium text-ink/50 hover:bg-ink/5 rounded-lg transition-colors"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => { if (annotationDraft.trim()) updateAnnotation(activeAnn.id, annotationDraft.trim()); }}
                              disabled={!annotationDraft.trim()}
                              className="px-4 py-1.5 text-xs font-sans font-bold text-white bg-vibrant-1 hover:bg-vibrant-1/90 rounded-lg transition-colors disabled:opacity-30"
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Annotations list for this paragraph */}
                  {paraAnns.length > 0 && !activeAnn && !hasPending && (
                    <div className="mt-3 space-y-1.5">
                      {paraAnns.map((ann) => (
                        <button
                          key={ann.id}
                          onClick={() => { setActiveAnnotationId(ann.id); setAnnotationDraft(ann.text); setPendingSelection(null); }}
                          className="flex items-start gap-2 w-full text-left px-3 py-2 text-xs font-sans bg-vibrant-1/[0.03] hover:bg-vibrant-1/[0.08] rounded-xl transition-colors group"
                        >
                          <MessageSquare className="w-3 h-3 mt-0.5 text-vibrant-1/40 shrink-0" />
                          <span className="text-vibrant-1/60 font-medium shrink-0 max-w-[150px] truncate">"{ann.selectedText}"</span>
                          <span className="text-ink/40 truncate">{ann.text}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
                );
              })}
            </article>
            </>
            )}

          </>
        )}

        {/* Empty State：中央直接粘贴，等价于 Import */}
        {!isTranslating && content.length === 0 && (
          <div className="max-w-3xl mx-auto py-10 sm:py-16 md:py-24">
            <div className="border border-ink/10 rounded-3xl sm:rounded-[2.5rem] bg-white/50 backdrop-blur-md p-5 sm:p-8 md:p-12 shadow-sm">
              <label htmlFor="empty-state-import" className="sr-only">
                粘贴或输入要翻译的文本
              </label>
              <textarea
                id="empty-state-import"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (textInput.trim()) void handleTextSubmit();
                  }
                }}
                placeholder="在此粘贴或输入要翻译的文本…"
                className="w-full min-h-[220px] md:min-h-[260px] bg-transparent resize-y outline-none font-serif text-base leading-relaxed text-ink/85 placeholder:text-ink/25 focus:ring-0"
                aria-label="粘贴或输入要翻译的文本"
              />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-8 pt-8 border-t border-ink/10">
                <p className="text-[11px] font-sans text-ink/40 order-2 sm:order-1 leading-relaxed">
                  与左上角 <span className="font-semibold text-ink/55">Import</span> 共用输入；也可{" "}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-vibrant-1 hover:underline underline-offset-2 font-medium"
                  >
                    上传 Word / PDF
                  </button>
                </p>
                <button
                  type="button"
                  onClick={() => void handleTextSubmit()}
                  disabled={!textInput.trim()}
                  className="order-1 sm:order-2 px-8 py-3.5 bg-ink text-paper text-xs font-sans font-bold uppercase tracking-widest rounded-2xl hover:bg-vibrant-1 transition-colors disabled:opacity-20 shrink-0"
                >
                  翻译
                </button>
              </div>
              <p className="mt-4 text-[10px] font-sans text-ink/30 text-center sm:text-left">
                快捷键：⌘ / Ctrl + Enter 开始翻译
              </p>
              <button
                type="button"
                onClick={loadDemoDocument}
                className="mt-5 w-full text-center text-[11px] font-sans text-ink/45 hover:text-vibrant-1 transition-colors underline-offset-4 hover:underline"
              >
                载入示例书信（艾琳·迈尔斯）
              </button>
            </div>
          </div>
        )}

        {/* Footer spacer */}
        <div className="mt-24 sm:mt-40 md:mt-48" />
      </main>

      <FloatingTextFollowup
        hasContent={content.length > 0}
        content={content}
        analysis={analysis}
        title={title}
        author={author}
      />
    </div>
  );
}
