"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Globe,
  Sparkles,
  ArrowUpRight,
  History,
  Loader2,
  Download,
  FileText,
  Send,
  BookOpen,
  Code2,
  Newspaper,
  Compass,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
const API_BASE_URL = "https://ai-agent-tutorial-2vub.onrender.com";
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

interface HistoryItem {
  topic: string;
  summary: string;
}

export default function DeepResearchDashboard() {
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<"web" | "arxiv" | "github" | "news">("web");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [currentTopic, setCurrentTopic] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [followUpInput, setFollowUpInput] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // 1. Mic logic (Speech-to-Text)
  const handleVoiceInput = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Voice recognition is not supported in this browser. Please use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;

    if (isListening) {
      recognition.stop();
      setIsListening(false);
      return;
    }

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setFollowUpInput(transcript);
      setQuery(transcript);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      if (event.error === "not-allowed") {
        alert("Microphone permission blocked. Please allow mic access in browser settings.");
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch (err) {
      setIsListening(false);
    }
  };

  // 2. Audio Listen logic (Text-to-Speech)
  const handleSpeak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert("Text-to-speech not supported in this browser.");
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const cleanText = text.replace(/[*#_`]/g, "");
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/history`);
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.error("Failed to load history", err);
    }
  };

  const executeStream = async (userQuery: string, isFollowUp: boolean = false) => {
    if (!userQuery.trim() || loading) return;

    setLoading(true);
    setStatus("Analyzing intent and sourcing data...");

    const newHistoryContext = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    if (!isFollowUp) {
      setCurrentTopic(userQuery);
      setMessages([{ role: "user", content: userQuery }]);
    } else {
      setMessages((prev) => [...prev, { role: "user", content: userQuery }]);
    }

    let assistantSources: string[] = [];
    let assistantResponseText = "";

    try {
      const response = await fetch(`${API_BASE_URL}/api/research/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userQuery,
          filter_type: filterType,
          history_context: newHistoryContext,
        }),
      });

      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", sources: [] },
      ]);

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data: ")) {
            try {
              const jsonStr = trimmed.slice(6);
              const data = JSON.parse(jsonStr);

              if (data.type === "status") {
                setStatus(data.content);
              } else if (data.type === "sources") {
                assistantSources = data.sources || [];
                setStatus("");
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                    updated[lastIdx].sources = assistantSources;
                  }
                  return updated;
                });
              } else if (data.type === "token") {
                setStatus("");
                assistantResponseText += (data.token || "");
                setMessages((prev) => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      content: assistantResponseText,
                    };
                  }
                  return updated;
                });
              } else if (data.type === "done") {
                fetchHistory();
              }
            } catch (e) {
              // Ignore incomplete SSE frames
            }
          }
        }
      }
    } catch (err) {
      console.error("Streaming error:", err);
    } finally {
      setLoading(false);
      setStatus("");
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    executeStream(query, false);
    setQuery("");
  };

  const handleFollowUp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpInput.trim()) return;
    executeStream(followUpInput, true);
    setFollowUpInput("");
  };

  const handleExport = async (format: string) => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant || !lastAssistant.content) return;

    try {
      const endpoint = `${API_BASE_URL}/api/export/${format}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: currentTopic || "Research_Report",
          summary: lastAssistant.content,
          sources: lastAssistant.sources || [],
        }),
      });

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      const extension = format === "pdf" ? ".pdf" : ".md";
      a.href = url;
      a.download = (currentTopic || "Research_Report").split(" ").join("_") + extension;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error("Export error:", err);
    }
  };

  const loadPastHistory = (item: HistoryItem) => {
    setCurrentTopic(item.topic);
    setMessages([
      { role: "user", content: item.topic },
      { role: "assistant", content: item.summary, sources: [] },
    ]);
  };

  return (
    <div className="flex h-screen bg-[#090a0f] text-slate-100 font-sans antialiased overflow-hidden">
      {/* Sidebar: Past History */}
      <aside className="w-80 border-r border-[#1e2330] bg-[#0d1017] flex flex-col p-5 hidden md:flex">
        <div className="flex items-center gap-2 mb-6">
          <History className="w-5 h-5 text-blue-400" />
          <h2 className="font-semibold text-slate-300 text-sm tracking-wide uppercase">Past Logs</h2>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {history.length === 0 ? (
            <p className="text-xs text-slate-500">No previous sessions found.</p>
          ) : (
            history.map((item, idx) => (
              <div
                key={idx}
                onClick={() => loadPastHistory(item)}
                className="p-3 rounded-xl bg-[#131722] hover:bg-[#1c2233] border border-[#21283b] transition-all cursor-pointer group"
              >
                <p className="text-sm font-medium text-slate-300 group-hover:text-blue-400 truncate">
                  {item.topic}
                </p>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main Research Canvas */}
      <main className="flex-1 flex flex-col items-center justify-between p-6 md:p-10 overflow-y-auto">
        <div className="w-full max-w-4xl flex-1 flex flex-col">
          {/* Header */}
          <div className="text-center my-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold mb-3">
              <Sparkles className="w-3.5 h-3.5" /> Next-Gen Autonomous Intelligence
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Deep Research Agent</h1>
            <p className="text-slate-400 text-sm">Synthesize verified real-time intelligence with multi-turn reasoning</p>
          </div>

          {/* Filter Scope Selector */}
          <div className="flex items-center justify-center gap-2 mb-4">
            {[
              { id: "web", label: "Web", icon: Compass },
              { id: "arxiv", label: "Papers (ArXiv)", icon: BookOpen },
              { id: "github", label: "GitHub & Code", icon: Code2 },
              { id: "news", label: "News / Recent", icon: Newspaper },
            ].map((f) => {
              const Icon = f.icon;
              const active = filterType === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilterType(f.id as any)}
                  className={"flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer " + (active ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20" : "bg-[#131722] border-[#22293a] text-slate-400 hover:text-slate-200 hover:bg-[#1a202e]")}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {f.label}
                </button>
              );
            })}
          </div>

          {/* Main Search Bar */}
          {messages.length === 0 && (
            <form onSubmit={handleSearch} className="relative w-full mb-8">
              <div className="relative flex items-center bg-[#131722] border border-[#22293a] focus-within:border-blue-500/60 rounded-2xl shadow-2xl transition-all">
                <Search className="w-5 h-5 text-slate-400 ml-4" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="What deep topic should the agent research today?"
                  className="w-full bg-transparent px-4 py-4 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="mr-3 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Synthesize"}
                </button>
              </div>
            </form>
          )}

          {/* Status Indicator */}
          {status && (
            <div className="flex items-center justify-center gap-2 text-xs text-blue-400 my-4 animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {status}
            </div>
          )}

          {/* Conversational & Research Feed */}
          {messages.length > 0 && (
            <div className="space-y-6 flex-1 mb-8">
              {messages.map((m, idx) => (
                <div key={idx} className="w-full">
                  {m.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-xl bg-blue-600/20 border border-blue-500/30 text-blue-100 rounded-2xl px-5 py-3 text-sm">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div className="w-full bg-[#131722] border border-[#22293a] rounded-2xl p-6 md:p-8 shadow-2xl space-y-4">
                      {/* Top Bar with Exports */}
                      <div className="flex items-center justify-between pb-3 border-b border-[#22293a]">
                        <div className="flex items-center gap-2 text-xs font-semibold text-blue-400 uppercase tracking-wider">
                          <Sparkles className="w-3.5 h-3.5" /> Synthesized Findings
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleExport("markdown")}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a202e] hover:bg-[#232b3d] text-slate-300 hover:text-white text-xs font-medium border border-[#263045] transition-all cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5" /> Markdown
                          </button>
                          <button
                            onClick={() => handleExport("pdf")}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 text-xs font-medium border border-blue-500/30 transition-all cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" /> PDF
                          </button>
                        
                        <button
                  type="button"
                  onClick={() => handleSpeak(m.content)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-colors border border-slate-700"
                >
                  {isSpeaking ? (
                    <>
                      <VolumeX className="w-3.5 h-3.5 text-red-400" />
                      <span>Stop</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>Listen</span>
                    </>
                  )}
                </button>
                      </div>
                    </div>  


                      {/* Source Chips */}
                      {m.sources && m.sources.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1 pb-2">
                          {m.sources.map((src, i) => (
                            <a
                              key={i}
                              href={"https://" + src}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1a202e] hover:bg-[#232b3d] text-blue-400 text-xs font-medium border border-[#263045] transition-all"
                            >
                              <Globe className="w-3 h-3" />
                              {src}
                              <ArrowUpRight className="w-3 h-3 opacity-60" />
                            </a>
                          ))}
                        </div>
                      )}

                      {/* Token-by-token Content */}
                      <div className="text-slate-300 text-sm leading-relaxed">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {m.content}
                        </ReactMarkdown>
                        {loading && idx === messages.length - 1 && (
                          <span className="inline-block w-2 h-4 bg-blue-400 ml-1 animate-pulse" />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottomRef} />

              {/* Follow-up Question Input Box */}
              <form onSubmit={handleFollowUp} className="sticky bottom-2 w-full pt-2">
                <div className="flex items-center bg-[#131722] border border-[#22293a] focus-within:border-blue-500/60 rounded-2xl shadow-2xl p-1.5">
                  <input
                    type="text"
                    value={followUpInput}
                    onChange={(e) => setFollowUpInput(e.target.value)}
                    placeholder="Ask a follow-up question on this research..."
                    className="w-full bg-transparent px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none"
                  />
                  <button
                  
                    type="button"
                    onClick={handleVoiceInput}
                    className={`p-2 rounded-lg mr-1 transition-all ${
                      isListening
                        ? "bg-red-500 text-white animate-pulse"
                        : "text-slate-400 hover:text-white"
                    }`}
                    title={isListening ? "Listening..." : "Voice Input"}
                  >
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                    </button>
                  <button
                    type="submit"
                    disabled={loading || !followUpInput.trim()}
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-40 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" /> Ask
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}