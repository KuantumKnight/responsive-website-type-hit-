"use client";

import {
  Volume2, VolumeX, Mic, MicOff, Languages,
  BookOpen, ArrowLeft, CheckCircle2,
  Globe, Sparkles, Eye, EyeOff, Type, Minus, Plus,
  ChevronUp, ChevronDown, Loader2
} from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

type Mode = 'original' | 'simplified' | 'translated' | 'dyslexia';

interface SummaryData {
  bullets: string[];
  readingTime: string;
}

function ToolBtn({
  onClick, active, activeClass, title, children,
}: {
  onClick: () => void; active?: boolean; activeClass?: string;
  title: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} title={title}
      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border font-bold text-sm transition-all select-none
        ${active ? (activeClass || 'bg-blue-100 border-blue-300 text-blue-700')
          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>
      {children}
    </button>
  );
}

export default function Home() {
  const [rawUrl, setRawUrl] = useState('');
  const [submittedUrl, setSubmittedUrl] = useState('');
  const [activeTab, setActiveTab] = useState<Mode>('simplified');
  const [isListening, setIsListening] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [focusMode, setFocusMode] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const recognitionRef = useRef<any>(null);
  // Track pending focus state to apply after iframe loads
  const pendingFocusRef = useRef<boolean>(false);

  const normalizeUrl = (input: string) => {
    const t = input.trim();
    if (!t) return '';
    return t.startsWith('http://') || t.startsWith('https://') ? t : 'https://' + t;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = normalizeUrl(rawUrl);
    if (!cleanUrl) return;
    try { new URL(cleanUrl); } catch {
      setLoadError("That doesn't look like a valid URL. Try: en.wikipedia.org/wiki/..."); return;
    }
    setLoadError('');
    setSubmittedUrl(cleanUrl);
    setIsLoading(true);
    setSummary(null);
    setSummaryOpen(false);
    setSummaryLoading(true);
    setIframeKey(prev => prev + 1);
    setActiveTab('simplified');
    setFocusMode(false);
    setZoomLevel(100);
    // FIX: correct API route path
    fetchSummary(cleanUrl);
  };

  const fetchSummary = async (targetUrl: string) => {
    try {
      // FIX: was /api/summary — corrected to match actual file at /api/proxy/summary-route
      const res = await fetch(`/api/proxy/summary-route?url=${encodeURIComponent(targetUrl)}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
        setSummaryOpen(true); // auto-open when summary is ready
      }
    } catch { /* silent */ }
    finally { setSummaryLoading(false); }
  };

  const handleReset = () => {
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
    setSubmittedUrl(''); setRawUrl('');
    setSummary(null); setSummaryOpen(false); setSummaryLoading(false);
    setIsLoading(false); setLoadError('');
    setFocusMode(false); setZoomLevel(100);
  };

  const changeMode = (mode: Mode) => {
    if (mode === activeTab) return;
    setActiveTab(mode);
    setIsLoading(true);
    setIframeKey(prev => prev + 1);
    window.speechSynthesis?.cancel();
    setIsPlaying(false);
  };

  // ── Voice input ──────────────────────────────────────────────────────────
  const toggleListenUrl = () => {
    if (isListening) { recognitionRef.current?.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Voice input not supported. Try Chrome or Edge.'); return; }
    const r = new SR();
    r.continuous = false; r.interimResults = false; r.lang = 'en-US';
    r.onstart = () => setIsListening(true);
    r.onresult = (e: any) => {
      const t = e.results[0][0].transcript;
      setRawUrl(t.toLowerCase().replace(/\s+dot\s+/g, '.').replace(/\s+slash\s+/g, '/').replace(/\s+/g, ''));
      setIsListening(false);
    };
    r.onerror = r.onend = () => setIsListening(false);
    recognitionRef.current = r;
    r.start();
  };

  // ── TTS ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      if (ev.data?.type === 'READABLE_TEXT') readTextAloud(ev.data.text);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [activeTab]);

  const toggleReadAloud = () => {
    if (isPlaying) { window.speechSynthesis.cancel(); setIsPlaying(false); return; }
    iframeRef.current?.contentWindow?.postMessage('REQUEST_READABLE_TEXT', '*');
  };

  const readTextAloud = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text.substring(0, 12000));
    if (activeTab === 'translated') {
      const v = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('ta'));
      if (v) utt.voice = v;
      utt.lang = 'ta-IN';
    } else { utt.lang = 'en-US'; utt.rate = 0.9; }
    utt.onend = utt.onerror = () => setIsPlaying(false);
    window.speechSynthesis.speak(utt);
    setIsPlaying(true);
  }, [activeTab]);

  // ── Focus mode ────────────────────────────────────────────────────────────
  // FIX: Store pending focus state so it can be applied once the iframe loads.
  // Previously postMessage fired on iframeKey change before the iframe had loaded,
  // so the injected script wasn't ready yet and the message was lost.
  useEffect(() => {
    pendingFocusRef.current = focusMode;
    // If iframe is already loaded (e.g. toggling focus without reloading), send immediately
    if (!isLoading && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        focusMode ? 'EQUINET_FOCUS_ON' : 'EQUINET_FOCUS_OFF', '*'
      );
    }
  }, [focusMode, isLoading]);

  // ── Send focus state after iframe finishes loading ────────────────────────
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    // Apply any pending focus mode now that the iframe script is ready
    if (pendingFocusRef.current && iframeRef.current?.contentWindow) {
      // Small delay to ensure the injected script has registered its message listener
      setTimeout(() => {
        iframeRef.current?.contentWindow?.postMessage('EQUINET_FOCUS_ON', '*');
      }, 100);
    }
  }, []);

  const proxyUrl = submittedUrl
    ? `/api/proxy?url=${encodeURIComponent(submittedUrl)}&mode=${activeTab}`
    : '';

  const MODES: { id: Mode; label: string; icon: React.ReactNode; color: string; desc: string }[] = [
    { id: 'original', label: 'Original', icon: <Globe className="w-3.5 h-3.5" />, color: 'bg-slate-700 text-white', desc: 'Full site' },
    { id: 'simplified', label: 'Simplified', icon: <BookOpen className="w-3.5 h-3.5" />, color: 'bg-blue-600 text-white', desc: 'Plain English' },
    { id: 'translated', label: 'Tamil', icon: <Languages className="w-3.5 h-3.5" />, color: 'bg-purple-600 text-white', desc: 'தமிழ்' },
    { id: 'dyslexia', label: 'Dyslexia', icon: <Type className="w-3.5 h-3.5" />, color: 'bg-orange-500 text-white', desc: 'OpenDyslexic font' },
  ];

  // ═══════════════════════════════════════════════════════════════════════════
  // PORTAL VIEW
  // ═══════════════════════════════════════════════════════════════════════════
  if (submittedUrl) {
    return (
      <div className="flex flex-col h-screen w-full bg-black overflow-hidden selection:bg-blue-500/30">

        {/* Loading bar */}
        {isLoading && (
          <div className="absolute top-0 left-0 right-0 z-[200] pointer-events-none">
            <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 animate-pulse w-full" />
          </div>
        )}

        {/* Focus mode vignette */}
        {focusMode && (
          <div className="absolute inset-0 z-10 pointer-events-none"
            style={{ boxShadow: 'inset 0 0 160px 80px rgba(0,0,0,0.8)' }} />
        )}

        {/* Iframe */}
        <div className="flex-1 w-full overflow-auto bg-white">
          <div style={{
            transform: `scale(${zoomLevel / 100})`,
            transformOrigin: 'top left',
            width: `${(100 * 100) / zoomLevel}%`,
            height: `${(100 * 100) / zoomLevel}%`,
          }}>
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={proxyUrl}
              className="w-full h-full border-none block"
              title="EquiNet Portal"
              onLoad={handleIframeLoad}
            />
          </div>
        </div>

        {/* ── SUMMARY PANEL ───────────────────────────────────────────────── */}
        <div
          className="absolute left-1/2 -translate-x-1/2 z-40 transition-all duration-300 ease-in-out"
          style={{ bottom: summaryOpen ? '5.5rem' : '4.5rem', width: 'min(94vw, 720px)' }}
        >
          <div className={`glass rounded-2xl overflow-hidden transition-all duration-300 shadow-2xl
            ${summaryOpen ? 'border-blue-500/30 shadow-blue-500/10' : 'border-white/5 shadow-black/50'}`}>

            {/* Summary header */}
            <button
              onClick={() => setSummaryOpen(p => !p)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors group"
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors
                  ${summaryOpen ? 'bg-blue-500/20' : 'bg-white/10 group-hover:bg-white/20'}`}>
                  <Sparkles className={`w-3.5 h-3.5 ${summaryOpen ? 'text-blue-400' : 'text-slate-400'}`} />
                </div>
                <div className="flex flex-col items-start translate-y-[-1px]">
                  <span className="font-bold text-[13px] text-white tracking-tight">AI Insights</span>
                  {summary?.readingTime && !summaryLoading && (
                    <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{summary.readingTime} read</span>
                  )}
                </div>
                {summaryLoading && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin ml-1" />}
              </div>
              <div className="flex items-center gap-3">
                {summary && !summaryLoading && (
                  <span className="text-[10px] bg-blue-500/10 text-blue-400 font-bold px-2 py-0.5 rounded-full border border-blue-500/20 uppercase tracking-widest hidden sm:block">
                    {summary.bullets.length} points
                  </span>
                )}
                {summaryOpen
                  ? <ChevronDown className="w-4 h-4 text-slate-500" />
                  : <ChevronUp className="w-4 h-4 text-slate-500" />}
              </div>
            </button>

            {/* Summary body */}
            {summaryOpen && (
              <div className="border-t border-white/5 px-4 pb-5 pt-4 bg-black/20">
                {summaryLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                      <span className="text-xs text-slate-400 font-medium animate-pulse">Synthesizing information...</span>
                    </div>
                  </div>
                ) : summary?.bullets?.length ? (
                  <ul className="space-y-3.5">
                    {summary.bullets.map((b, i) => (
                      <li key={i} className="flex gap-4 text-[13.5px] text-slate-300 leading-relaxed group/item">
                        <span className="w-5 h-5 rounded-md bg-white/5 text-blue-400 font-bold text-[10px] flex items-center justify-center flex-shrink-0 mt-0.5 border border-white/5 group-hover/item:border-blue-500/30 transition-colors">
                          {i + 1}
                        </span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500 py-2 text-center italic">Unable to generate insights for this page.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── FLOATING TOOLBAR ────────────────────────────────────────────── */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex justify-center"
          style={{ width: 'min(96vw, 1000px)' }}>
          <div className="glass rounded-2xl p-1.5 flex items-center gap-1.5 w-full shadow-2xl border-white/10">

            {/* Back */}
            <button onClick={handleReset} title="Exit Gateway"
              className="h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all active:scale-95 border border-white/5">
              <ArrowLeft className="w-4 h-4" />
            </button>

            {/* Mode tabs */}
            <div className="flex bg-black/40 p-1 rounded-xl gap-1 flex-1 overflow-x-auto no-scrollbar shadow-inner min-w-0 border border-white/5">
              {MODES.map(({ id, label, icon, color }) => (
                <button key={id} onClick={() => changeMode(id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg font-bold text-xs transition-all whitespace-nowrap active:scale-[0.98]
                    ${activeTab === id
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}>
                  <span className="flex-shrink-0">{icon}</span>
                  <span className={activeTab === id ? 'block' : 'hidden md:block'}>{label}</span>
                </button>
              ))}
            </div>

            {/* Extra Controls - Grouped for mobile */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Focus mode - simplified for mobile */}
              <button
                onClick={() => setFocusMode(p => !p)}
                className={`h-10 w-10 flex items-center justify-center rounded-xl transition-all border
                  ${focusMode ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-400' : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'}`}
                title="Focus Mode"
              >
                {focusMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>

              {/* TTS - simplified for mobile */}
              <button
                onClick={toggleReadAloud}
                className={`h-10 w-10 flex items-center justify-center rounded-xl transition-all border
                  ${isPlaying ? 'bg-green-600/20 border-green-500/40 text-green-400 animate-glow' : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'}`}
                title="Listen"
              >
                {isPlaying ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              {/* Zoom Controls - Hidden on very small screens, or compact */}
              <div className="hidden sm:flex items-center gap-1 bg-black/40 border border-white/5 rounded-xl px-2 py-1 h-10">
                <button onClick={() => setZoomLevel(p => Math.max(p - 10, 50))} className="p-1 text-slate-500 hover:text-white"><Minus className="w-3.5 h-3.5" /></button>
                <div className="w-8 text-center text-[10px] font-bold text-slate-400">{zoomLevel}%</div>
                <button onClick={() => setZoomLevel(p => Math.min(p + 10, 200))} className="p-1 text-slate-500 hover:text-white"><Plus className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          </div>
        </div>

      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HOMEPAGE
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background blobs for depth */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/10 blur-[120px] rounded-full" />

      <div className="max-w-3xl w-full text-center space-y-10 relative z-10 py-12">

        <div className="space-y-6">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-700 text-white rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-blue-500/20 border border-white/10 animate-float">
            <Globe className="w-10 h-10" />
          </div>

          <div className="space-y-3">
            <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter">
              EquiNet <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">Gateway</span>
            </h1>
            <p className="text-lg md:text-xl text-slate-400 max-w-lg mx-auto leading-relaxed font-medium">
              Experience the web your way. Deep focus, simple language, and instant narration.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-2">
          <div className="group relative flex items-center transition-all duration-500 ease-out">
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-[24px] blur opacity-20 group-focus-within:opacity-40 transition-opacity" />
            <div className="relative flex w-full">
              <input
                type="text"
                className="block w-full pl-6 pr-40 md:pr-48 py-5 md:py-6 text-lg md:text-xl rounded-2xl border border-white/10 bg-white/5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 backdrop-blur-xl transition-all"
                placeholder="Enter any URL..."
                value={rawUrl}
                onChange={e => setRawUrl(e.target.value)}
                required spellCheck={false} autoComplete="url"
              />
              <div className="absolute inset-y-2 right-2 flex items-center gap-1.5">
                <button type="button" onClick={toggleListenUrl}
                  className={`p-3 rounded-xl transition-all ${isListening ? 'bg-red-500/20 text-red-500 animate-pulse' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                  {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                <button type="submit"
                  className="px-6 md:px-8 h-full bg-blue-600 hover:bg-blue-500 text-white font-black text-base rounded-xl transition-all shadow-xl shadow-blue-600/20 active:scale-95 flex items-center gap-2">
                  <span>Go</span>
                  <span className="hidden md:inline">→</span>
                </button>
              </div>
            </div>
          </div>
          {loadError && <p className="mt-4 text-sm text-red-400 font-medium text-left pl-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> {loadError}
          </p>}
        </form>

        <div className="flex flex-wrap justify-center gap-2 max-w-xl mx-auto">
          <p className="w-full text-[10px] text-slate-500 uppercase tracking-[0.2em] font-bold mb-1">Quick Start</p>
          {['wikipedia.org', 'bbc.com/news', 'nhsinform.scot'].map(d => (
            <button key={d} onClick={() => setRawUrl(d)}
              className="text-xs px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all border border-white/5 hover:border-white/10 font-medium">
              {d}
            </button>
          ))}
        </div>

        <div className="pt-12 grid grid-cols-2 md:grid-cols-3 gap-y-6 gap-x-4 max-w-2xl mx-auto opacity-60">
          {[
            { icon: <BookOpen className="w-4 h-4 text-blue-400" />, text: 'AI Simplifier' },
            { icon: <Type className="w-4 h-4 text-indigo-400" />, text: 'Dyslexia Mode' },
            { icon: <Languages className="w-4 h-4 text-purple-400" />, text: 'Smart Tamil' },
            { icon: <Volume2 className="w-4 h-4 text-emerald-400" />, text: 'Neural Voice' },
            { icon: <Eye className="w-4 h-4 text-amber-400" />, text: 'Calm Mode' },
            { icon: <CheckCircle2 className="w-4 h-4 text-blue-400" />, text: 'Edge Powered' },
          ].map(({ icon, text }) => (
            <div key={text} className="flex items-center gap-2.5 justify-center md:justify-start">
              <div className="p-1.5 rounded-lg bg-white/5 border border-white/5">{icon}</div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
