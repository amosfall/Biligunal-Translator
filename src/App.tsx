/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, ChangeEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { BookOpen, Share2, Bookmark, Menu, Upload, Loader2, FileText, AlertCircle, X, Trash2 } from "lucide-react";
import mammoth from "mammoth";
import JSON5 from "json5";

interface ParagraphPair {
  en: string;
  zh: string;
}

interface ArticleAnalysis {
  summary: string;
  narrativeDetail: string;
  themes: string[];
  pros: string[];
  cons: string[];
}

interface HistoryItem {
  id: string;
  title: { zh: string; en: string };
  author: { zh: string; en: string };
  content: ParagraphPair[];
  analysis: ArticleAnalysis | null;
  createdAt: number;
}

const HISTORY_KEY = "bilingual-editorial-history";
const MAX_HISTORY = 50;

const INITIAL_CONTENT: ParagraphPair[] = [
  {
    en: "Dear Stéphane,\nIt's your birthday. You'd be 61born in 61. I'm thinking of you as the stars fan out in the sky tonight as I walk my dog. It strikes me that the extreme head racket that occupies so much of your work is stellar: \"Oy Suzy\" there goes one, yet my feeling about the text written alongside one image or the flowers popped in around the jabber is that it is never very much about \"one\" speaking at all.",
    zh: "亲爱的斯蒂芬，\n今天是你的生日。你会61岁，出生于1961年。我在遛狗的时候，抬头看着天上星星点点，想着你。你的作品中充满了那种喧嚣的头脑轰鸣，让我想起星辰的闪烁。“喂，苏西，”一颗星滑落，但我感觉那些伴随图像而写的文字，或插入在喋喋不休中的花朵，从来都不是关于某个“人”在发声。"
  },
  {
    en: "The words just constellate, burst into symbols whether pictograph men with guns or a multiple territory of women with their names and each with a little sac attached like aphids then a quick sketch of a nightclub recurs, a dirty mouth, a piggy truck, an old banana, a smile a piece of fruit and often it feels like a contagious memory map of one long strewn night. A life.",
    zh: "那些词语只是像星座一样聚集，爆发成符号——无论是带枪的象形文字般的小人，还是一片属于许多女人的领地，这些女人每个都有个像蚜虫一样的小袋子，接着又突然出现夜总会的速写、污秽的嘴巴、一辆破卡车、一根发霉的香蕉、一张笑脸或一个水果，常常像是一张漫长的记忆地图，一个人生。"
  }
];

const INITIAL_ANALYSIS: ArticleAnalysis = {
  summary: "这是一封写给斯蒂芬的私人信件，通过对星空与艺术作品的观察，探讨了记忆、生命与表达的本质。",
  narrativeDetail: "叙事采用了非线性的意识流手法。作者从当下的遛狗场景切入，通过“星星”这一意象自然过渡到对斯蒂芬艺术作品的评价。叙事重心不在于具体的事件，而在于意象的堆叠——从“喧嚣的头脑”到“星座般的词语”，再到一系列具体的、具有冲击力的视觉符号（带枪的小人、夜总会、发霉的香蕉）。这种叙事方式模拟了记忆的碎片化特征，将一个人的生命（A life）呈现为一张“漫长且散乱的夜晚”所构成的记忆地图。",
  themes: ["记忆的碎片化与重构", "艺术表达的非人格化", "生命作为时空地图的隐喻"],
  pros: ["意象高度浓缩且具有强烈的视觉感", "成功捕捉了意识流动的细腻质感", "深刻探讨了艺术与创作者之间的距离"],
  cons: ["意象跳跃极快，初读可能产生断裂感", "对读者理解抽象隐喻的能力要求较高", "叙事结构松散，缺乏传统意义上的情节起伏"]
};

export default function App() {
  const [content, setContent] = useState<ParagraphPair[]>(INITIAL_CONTENT);
  const [analysis, setAnalysis] = useState<ArticleAnalysis | null>(INITIAL_ANALYSIS);
  const [title, setTitle] = useState({ zh: "致\n斯蒂芬", en: "To\nStéphane" });
  const [author, setAuthor] = useState({ zh: "艾琳·迈尔斯", en: "Eileen Myles" });
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      if (raw.length > 25000) {
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

  // 从云端拉取历史（多设备同步），失败则继续用 localStorage
  useEffect(() => {
    fetch("/api/history")
      .then((res) => (res.ok ? res.text() : Promise.reject(res.status)))
      .then((text) => {
        try { return JSON.parse(text); } catch { return JSON5.parse(text); }
      })
      .then((items: HistoryItem[]) => {
        if (Array.isArray(items) && items.length > 0) {
          const sliced = items.slice(0, MAX_HISTORY);
          setHistory(sliced);
          try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(sliced));
          } catch {}
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // quota exceeded, ignore
    }
  }, [history]);

  const saveToHistory = (item: Omit<HistoryItem, "id" | "createdAt">) => {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const entry: HistoryItem = { ...item, id, createdAt };
    setHistory((prev) => [entry, ...prev.slice(0, MAX_HISTORY - 1)]);

    // 异步同步到云端
    fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, id, createdAt }),
    }).catch(() => {});
  };

  const loadFromHistory = (item: HistoryItem) => {
    setContent(item.content);
    setAnalysis(item.analysis);
    setTitle(item.title);
    setAuthor(item.author);
    setHistoryOpen(false);
  };

  const removeFromHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHistory((prev) => prev.filter((h) => h.id !== id));

    // 异步从云端删除
    fetch(`/api/history?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  };

  const translateAndAnalyze = async (paragraphs: string[]) => {
    let res: Response;
    try {
      res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paragraphs }),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/fetch|network|failed/i.test(msg) || msg === "Load failed") {
        throw new Error("无法连接翻译服务。请先在另一终端运行：npm run server");
      }
      throw err;
    }

    if (!res.ok) {
      const text = await res.text();
      let data: { error?: string; detail?: string } = {};
      try { data = text ? JSON.parse(text) : {}; } catch {}
      const serverMsg = data.error || data.detail;
      if (res.status === 502 || res.status === 504) {
        throw new Error("翻译服务未启动。请先在另一终端运行：npm run server");
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

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".docx")) {
      setError("Please upload a .docx file.");
      return;
    }

    setIsTranslating(true);
    setError(null);
    setAnalysis(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const mammothResult = await mammoth.extractRawText({ arrayBuffer });
      const text = mammothResult.value;
      
      const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
      
      if (paragraphs.length === 0) {
        throw new Error("The document appears to be empty.");
      }

      const MAX_CHARS = 30000;
      const limitedParagraphs: string[] = [];
      let total = 0;
      for (const p of paragraphs) {
        if (total + p.length > MAX_CHARS) break;
        limitedParagraphs.push(p);
        total += p.length;
      }
      const result = await translateAndAnalyze(limitedParagraphs);
      
      const newTitle = { zh: (result.title?.zh || "").trim() || "—", en: (result.title?.en || "").trim() || "—" };
      const newAuthor = { zh: (result.author?.zh || "").trim() || "—", en: (result.author?.en || "").trim() || "—" };
      setContent(result.translation);
      setAnalysis(result.analysis);
      setTitle(newTitle);
      setAuthor(newAuthor);
      saveToHistory({ title: newTitle, author: newAuthor, content: result.translation, analysis: result.analysis });
    } catch (err: any) {
      setError(err.message || "An error occurred while processing the file.");
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper selection:bg-vibrant-1/10 relative">
      <div className="vibrant-bg" />
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 glass-nav px-6 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setHistoryOpen(true)}
              className="p-2 -m-2 rounded-full hover:bg-ink/5 transition-colors"
              aria-label="历史记录"
            >
              <Menu className="w-5 h-5 hover:text-vibrant-1 transition-colors" />
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="group flex items-center gap-2 text-xs uppercase tracking-widest font-sans font-bold hover:text-vibrant-1 transition-all disabled:opacity-30"
              disabled={isTranslating}
            >
              <div className="p-2 bg-ink text-paper rounded-full group-hover:bg-vibrant-1 transition-colors">
                <Upload className="w-3 h-3" />
              </div>
              <span>{isTranslating ? "Processing..." : "Import Word"}</span>
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              accept=".docx" 
              className="hidden" 
            />
          </div>
          <div className="flex gap-4">
            <Share2 className="w-5 h-5 cursor-pointer hover:text-vibrant-1 transition-colors" />
            <Bookmark className="w-5 h-5 cursor-pointer hover:text-vibrant-1 transition-colors" />
          </div>
        </div>
      </nav>

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
                <h2 className="font-sans text-sm uppercase tracking-widest font-bold text-ink">历史翻译</h2>
                <button onClick={() => setHistoryOpen(false)} className="p-2 -m-2 rounded-full hover:bg-ink/5">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {history.length === 0 ? (
                  <p className="text-sm text-ink/40 font-sans py-12 text-center">暂无历史记录</p>
                ) : (
                  <ul className="space-y-2">
                    {history.map((item) => (
                      <li
                        key={item.id}
                        onClick={() => loadFromHistory(item)}
                        className="group flex items-start gap-3 p-4 rounded-2xl hover:bg-ink/5 cursor-pointer transition-colors border border-transparent hover:border-ink/5"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-serif-zh font-medium text-ink truncate">{item.title.zh || item.title.en || "无标题"}</p>
                          <p className="text-xs text-ink/50 mt-0.5 font-sans">
                            {item.author.zh || item.author.en || "—"} · {new Date(item.createdAt).toLocaleDateString("zh-CN")}
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

      <main className="max-w-6xl mx-auto px-6 py-16 md:py-32 relative z-10">
        {/* Error Message */}
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
          <header className="mb-32">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
              className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-24"
            >
              <div className="space-y-6">
                <h2 className="book-title-zh whitespace-pre-line">{title.zh}</h2>
                <p className="text-xl font-serif-zh opacity-60 tracking-widest">{author.zh}</p>
              </div>
              <div className="space-y-6">
                <h2 className="book-title-en whitespace-pre-line">{title.en}</h2>
                <p className="text-xl font-serif opacity-60 italic">{author.en}</p>
              </div>
            </motion.div>
          </header>
        ) : null}

        {/* Loading State */}
        {isTranslating && (
          <div className="flex flex-col items-center justify-center py-32 space-y-8">
            <div className="relative">
              <div className="absolute inset-0 bg-vibrant-1 blur-2xl opacity-10 animate-pulse" />
              <Loader2 className="w-16 h-16 animate-spin text-vibrant-1 relative z-10" />
            </div>
            <p className="font-sans text-xs uppercase tracking-[0.3em] font-bold text-ink/40">Analyzing and translating text...</p>
          </div>
        )}

        {/* Content Section - Bilingual Grid */}
        {!isTranslating && (
          <>
            <article className="space-y-16">
              {content.map((pair, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
                  className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-24 items-start"
                >
                  {/* Chinese Side */}
                  <div className="content-text content-text-zh whitespace-pre-wrap">
                    {pair.zh}
                  </div>

                  {/* English Side */}
                  <div className="content-text whitespace-pre-wrap text-ink/80">
                    {pair.en}
                  </div>
                </motion.div>
              ))}
            </article>

            {/* Analysis Section */}
            {analysis && (
              <motion.section 
                initial={{ opacity: 0, y: 60 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 1 }}
                className="mt-48 p-12 md:p-20 rounded-[4rem] bg-white/20 backdrop-blur-3xl border border-white/30 shadow-2xl shadow-vibrant-1/5 overflow-hidden relative"
              >
                <div className="absolute top-0 right-0 w-96 h-96 bg-vibrant-1/5 blur-[100px] rounded-full -mr-48 -mt-48" />
                
                <div className="space-y-20 relative z-10">
                  {/* Summary & Narrative Detail */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
                    <div className="lg:col-span-1">
                      <h3 className="font-sans text-[10px] uppercase tracking-[0.4em] mb-6 font-bold opacity-40">Overview / 概览</h3>
                      <p className="text-xl md:text-2xl font-serif-zh leading-relaxed italic text-ink/90">
                        “{analysis.summary}”
                      </p>
                      
                      <div className="mt-12">
                        <h3 className="font-sans text-[10px] uppercase tracking-[0.4em] mb-6 font-bold opacity-40">Key Themes / 核心主题</h3>
                        <div className="flex flex-wrap gap-2">
                          {analysis.themes.map((theme, i) => (
                            <span key={i} className="px-3 py-1 rounded-full bg-ink/5 text-[10px] font-sans font-bold uppercase tracking-wider opacity-60">
                              {theme}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-2">
                      <h3 className="font-sans text-[10px] uppercase tracking-[0.4em] mb-6 font-bold opacity-40">Narrative Analysis / 叙事深度解析</h3>
                      <div className="text-lg md:text-xl font-serif-zh leading-[1.8] text-ink/80 space-y-4">
                        {analysis.narrativeDetail.split('\n').map((para, i) => (
                          <p key={i}>{para}</p>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Pros & Cons */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-16 pt-16 border-t border-ink/5">
                    <div>
                      <h3 className="font-sans text-[10px] uppercase tracking-[0.4em] mb-8 font-bold text-vibrant-1">Strengths / 写作优点</h3>
                      <ul className="space-y-6 font-serif-zh">
                        {analysis.pros.map((pro, i) => (
                          <li key={i} className="flex items-start gap-4 group">
                            <span className="text-[10px] mt-2 font-sans font-bold text-vibrant-1/30 group-hover:text-vibrant-1 transition-colors">0{i+1}</span>
                            <span className="text-lg opacity-80">{pro}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h3 className="font-sans text-[10px] uppercase tracking-[0.4em] mb-8 font-bold text-vibrant-2">Critique / 写作缺点</h3>
                      <ul className="space-y-6 font-serif-zh">
                        {analysis.cons.map((con, i) => (
                          <li key={i} className="flex items-start gap-4 group">
                            <span className="text-[10px] mt-2 font-sans font-bold text-vibrant-2/30 group-hover:text-vibrant-2 transition-colors">0{i+1}</span>
                            <span className="text-lg opacity-80">{con}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </motion.section>
            )}
          </>
        )}

        {/* Empty State */}
        {!isTranslating && content.length === 0 && (
          <div className="text-center py-32 border border-ink/5 rounded-[4rem] bg-white/10 backdrop-blur-sm">
            <div className="w-24 h-24 mx-auto mb-8 rounded-full bg-ink/5 flex items-center justify-center">
              <FileText className="w-8 h-8 opacity-10" />
            </div>
            <p className="font-sans text-[10px] uppercase tracking-[0.4em] font-bold opacity-20">Upload a Word document to begin translation.</p>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-48 pt-16 border-t border-ink/5 text-center">
          <div className="flex justify-center mb-12">
            <div className="p-5 rounded-full bg-white/40 backdrop-blur-md shadow-xl border border-white/50">
              <BookOpen className="w-6 h-6 text-vibrant-1" />
            </div>
          </div>
          <p className="font-sans text-[10px] uppercase tracking-[0.6em] font-bold opacity-20">
            © 2026 The Bilingual Review • Crafted with DeepSeek AI
          </p>
        </footer>
      </main>
    </div>
  );
}
