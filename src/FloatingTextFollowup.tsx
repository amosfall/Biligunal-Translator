/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { MessageSquarePlus, X, Send, Bot, AlertCircle, Minimize2 } from 'lucide-react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content?: string;
  zh?: string;
  en?: string;
}

export interface FloatingTextFollowupProps {
  hasContent: boolean;
  content: { en: string; zh: string }[];
  analysis: unknown;
  title: { en: string; zh: string };
  author: { en: string; zh: string };
}

export const FloatingTextFollowup: React.FC<FloatingTextFollowupProps> = ({
  hasContent,
  content,
  analysis,
  title,
  author,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      zh: '你好！我是你的文学编辑助手。你可以基于当前的文章内容和分析，向我提出任何进一步的问题。',
      en: 'Hello! I am your literary editorial assistant. You can ask me any further questions based on the current article content and analysis.',
    },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading || !hasContent) return;

    const userText = inputValue.trim();
    setInputValue('');

    const newUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: userText,
    };
    setMessages((prev) => [...prev, newUserMsg]);
    setIsLoading(true);

    try {
      const priorHistory = messages
        .filter((m) => m.id !== 'welcome')
        .map((m) =>
          m.role === 'user'
            ? { role: 'user' as const, content: m.content || '' }
            : { role: 'assistant' as const, zh: m.zh, en: m.en }
        )
        .slice(-16);
      const res = await fetch('/api/text-followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userText,
          content,
          title,
          author,
          analysis,
          history: priorHistory,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { reply?: { zh: string; en: string }; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `请求失败 (${res.status})`);
      }
      const zh = data.reply?.zh?.trim() || '';
      const en = data.reply?.en?.trim() || '';
      if (!zh && !en) throw new Error('未收到有效回复');

      const assistantReply: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        zh: zh || en,
        en: en || zh,
      };
      setMessages((prev) => [...prev, assistantReply]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '请求失败';
      const errMsg: Message = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        zh: `抱歉，请求未成功：${msg}`,
        en: `Sorry, the request failed: ${msg}`,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[65] flex flex-col items-end pointer-events-none">
      <div className="pointer-events-auto relative flex flex-col items-end">
        <div
          className={`
          mb-4 w-[22rem] sm:w-96 rounded-2xl shadow-2xl border border-ink/10
          bg-paper/90 backdrop-blur-xl overflow-hidden flex flex-col
          transition-all duration-300 ease-out origin-bottom-right
          ${isOpen ? 'scale-100 opacity-100 h-[32rem]' : 'scale-50 opacity-0 h-0 pointer-events-none'}
        `}
        >
          <div className="px-4 py-3 border-b border-ink/10 flex items-center justify-between bg-white/50">
            <div className="flex items-center space-x-2">
              <div className="p-1.5 bg-vibrant-1/10 text-vibrant-1 rounded-lg">
                <Bot size={18} aria-hidden />
              </div>
              <div>
                <h3 className="text-sm font-sans font-semibold text-ink">深度追问 / Follow-up</h3>
                <p className="text-[10px] text-ink/45 font-sans">基于当前文本与分析对话</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1.5 text-ink/40 hover:text-ink hover:bg-ink/5 rounded-full transition-colors"
              aria-label="收起面板"
            >
              <Minimize2 size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth min-h-0">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-vibrant-1/10 text-vibrant-1 flex items-center justify-center shrink-0 mr-2 mt-1">
                    <Bot size={14} aria-hidden />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm text-sm
                  ${
                    msg.role === 'user'
                      ? 'bg-vibrant-1 text-paper rounded-tr-sm font-sans'
                      : 'bg-white/80 border border-ink/8 text-ink rounded-tl-sm'
                  }
                `}
                >
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="leading-relaxed font-serif-zh font-medium">{msg.zh}</p>
                      {msg.en && (
                        <div className="pt-2 border-t border-ink/10">
                          <p className="leading-relaxed font-serif italic text-ink/55 text-[13px]">{msg.en}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex w-full justify-start">
                <div className="w-6 h-6 rounded-full bg-vibrant-1/10 text-vibrant-1 flex items-center justify-center shrink-0 mr-2 mt-1">
                  <Bot size={14} aria-hidden />
                </div>
                <div className="bg-white/80 border border-ink/8 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center space-x-1.5">
                  <div className="w-1.5 h-1.5 bg-vibrant-1/60 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-1.5 h-1.5 bg-vibrant-1/60 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1.5 h-1.5 bg-vibrant-1/60 rounded-full animate-bounce" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 bg-paper/80 border-t border-ink/10 shrink-0">
            <div className="relative flex items-end bg-ink/[0.04] rounded-xl overflow-hidden border border-transparent focus-within:border-vibrant-1/40 focus-within:ring-2 focus-within:ring-vibrant-1/10 transition-all">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="继续探讨这篇文本..."
                disabled={!hasContent || isLoading}
                className="w-full max-h-32 min-h-[44px] bg-transparent resize-none outline-none text-sm p-3 pr-10 text-ink placeholder:text-ink/35 font-sans"
                rows={1}
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!inputValue.trim() || isLoading || !hasContent}
                className={`absolute right-2 bottom-2 p-1.5 rounded-lg transition-colors
                ${
                  inputValue.trim() && !isLoading && hasContent
                    ? 'bg-vibrant-1 text-paper hover:opacity-90'
                    : 'bg-ink/10 text-ink/35 cursor-not-allowed'
                }
              `}
                aria-label="发送"
              >
                <Send size={16} />
              </button>
            </div>
            <div className="mt-2 text-center">
              <span className="text-[10px] text-ink/35 font-sans flex items-center justify-center">
                内容由 AI 生成，请注意甄别
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={!hasContent}
          title={!hasContent ? '请先导入文章以开启追问' : '点击追问'}
          aria-expanded={isOpen}
          aria-label={!hasContent ? '请先导入文章以开启追问' : isOpen ? '关闭追问面板' : '打开深度追问'}
          className={`
          pointer-events-auto flex items-center justify-center w-11 h-11 rounded-full shadow-lg transition-all duration-300
          ${
            hasContent
              ? 'bg-vibrant-1 hover:shadow-vibrant-1/25 hover:-translate-y-0.5 text-paper cursor-pointer'
              : 'bg-ink/15 text-ink/35 cursor-not-allowed opacity-80'
          }
          ${isOpen && hasContent ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'}
        `}
        >
          {!hasContent ? <AlertCircle size={18} aria-hidden /> : <MessageSquarePlus size={18} aria-hidden />}
        </button>

        {isOpen && hasContent && (
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="pointer-events-auto absolute bottom-0 right-0 flex items-center justify-center w-11 h-11 rounded-full bg-ink text-paper shadow-lg hover:bg-ink/90 hover:rotate-90 transition-all duration-300 z-10"
            aria-label="关闭追问"
          >
            <X size={18} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
};

export default FloatingTextFollowup;
