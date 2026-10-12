import React, { useRef, useEffect, useState } from 'react';
import { 
  Send, Plus, Mic, MicOff, Image as ImageIcon, 
  FileText, X, Sparkles, Sigma, HelpCircle, ArrowUp, Square 
} from 'lucide-react';
import { MathSymbolPalette } from './MathSymbolPalette';

interface ChatInputBarProps {
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  onSend: (overrideInput?: string) => void;
  isLoading: boolean;
  isProMode: boolean;
  setIsProMode: (value: boolean) => void;
  selectedImage: string | null;
  onClearImage: () => void;
  pdfText: string | null;
  pdfFileName: string | null;
  onClearPdf: () => void;
  isPdfLoading: boolean;
  onOpenToolkit: () => void;
  onOpenMathPalette: () => void;
  isMathPaletteOpen: boolean;
  onCloseMathPalette: () => void;
  onInsertSymbol: (symbol: string) => void;
  hintsRequestedCount: number;
  onRequestAdaptiveSolution?: () => void;
  activeTopicTitle?: string;
  onAbortStream?: () => void;
}

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  input,
  setInput,
  onSend,
  isLoading,
  isProMode,
  setIsProMode,
  selectedImage,
  onClearImage,
  pdfText,
  pdfFileName,
  onClearPdf,
  isPdfLoading,
  onOpenToolkit,
  onOpenMathPalette,
  isMathPaletteOpen,
  onCloseMathPalette,
  onInsertSymbol,
  hintsRequestedCount,
  onRequestAdaptiveSolution,
  activeTopicTitle,
  onAbortStream,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Auto-expand textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(scrollHeight, 140)}px`;
    }
  }, [input]);

  // Voice Speech Recognition with Math Conversion
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript;
          }
        }
        if (transcript) {
          // Normalize spoken math phrases to LaTeX
          let normalized = transcript
            .replace(/integral of (.*?) dx/gi, '\\int $1 \\, dx')
            .replace(/square root of (.*?)/gi, '\\sqrt{$1}')
            .replace(/to the power of (\d+)/gi, '^{$1}')
            .replace(/divided by/gi, '/')
            .replace(/plus or minus/gi, '\\pm')
            .replace(/theta/gi, '\\theta')
            .replace(/alpha/gi, '\\alpha')
            .replace(/beta/gi, '\\beta')
            .replace(/pi/gi, '\\pi');

          setInput((prev) => (prev ? `${prev} ${normalized}` : normalized));
        }
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    }
  }, [setInput]);

  const toggleVoice = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported on this browser.");
      return;
    }
    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If the keyboard is composing text (IME/autocorrect/predictive suggestion in progress), do nothing
    if (e.nativeEvent.isComposing) {
      return;
    }

    if (e.key === 'Enter') {
      // On mobile screens (width < 768px), Enter should always start a new line naturally
      if (window.innerWidth < 768) {
        return;
      }

      // On desktop, Enter sends the message, Shift+Enter starts a new line
      if (!e.shiftKey) {
        e.preventDefault();
        if (!isLoading && (input.trim() || selectedImage || pdfText)) {
          onSend();
        }
      }
    }
  };

  const quickPrompts = [
    { label: 'Explain Step-by-Step', text: 'Explain this concept step-by-step with clear derivations.' },
    { label: 'Worked Example', text: 'Show a fully worked university exam problem on this topic.' },
    { label: 'Key Formulas', text: 'List the essential formulas and definitions for this unit.' }
  ];

  return (
    <div className="p-2 sm:p-3 md:p-4 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border-t border-slate-200 dark:border-zinc-800 shrink-0">
      <div className="w-full max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto space-y-2 px-1 sm:px-2">
        {/* Math Palette if active */}
        <MathSymbolPalette
          isOpen={isMathPaletteOpen}
          onClose={onCloseMathPalette}
          onInsertSymbol={onInsertSymbol}
        />

        {/* Adaptive Hint / Struggle Helper Banner if 3+ hints used */}
        {hintsRequestedCount >= 3 && onRequestAdaptiveSolution && (
          <div className="p-2 px-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-medium">
              <HelpCircle size={15} />
              <span>Struggling with this concept?</span>
            </div>
            <button
              onClick={onRequestAdaptiveSolution}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg text-[11px] transition-colors"
            >
              Get Full Worked Breakdown
            </button>
          </div>
        )}

        {/* Previews of attached media */}
        <div className="flex flex-wrap gap-2">
          {selectedImage && (
            <div className="relative inline-flex items-center gap-2 p-1.5 pr-3 bg-slate-100 dark:bg-zinc-800 rounded-xl border border-slate-200 dark:border-zinc-700 text-xs">
              <img src={selectedImage} alt="Uploaded" className="w-8 h-8 rounded-lg object-cover" />
              <span className="font-semibold text-slate-700 dark:text-zinc-300">Problem Image Attached</span>
              <button onClick={onClearImage} className="p-1 hover:bg-slate-200 dark:hover:bg-zinc-700 rounded-md">
                <X size={13} className="text-slate-500" />
              </button>
            </div>
          )}

          {pdfText && (
            <div className="relative inline-flex items-center gap-2 p-2 px-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
              <FileText size={15} />
              <span className="font-semibold truncate max-w-xs">{pdfFileName || 'PDF Document Loaded'}</span>
              <button onClick={onClearPdf} className="p-1 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded-md">
                <X size={13} />
              </button>
            </div>
          )}

          {isPdfLoading && (
            <div className="inline-flex items-center gap-2 p-2 px-3 bg-slate-100 dark:bg-zinc-800 rounded-xl text-xs text-slate-500">
              <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <span>Extracting PDF context...</span>
            </div>
          )}
        </div>

        {/* Dynamic Quick Suggestion Chips */}
        {!input && !selectedImage && !pdfText && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
            <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider shrink-0">
              Suggestions:
            </span>
            {quickPrompts.map((p, idx) => (
              <button
                key={idx}
                onClick={() => setInput(p.text)}
                className="px-2.5 py-1 rounded-full text-xs bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 whitespace-nowrap transition-colors border border-slate-200/60 dark:border-zinc-700/60"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Main Input Control Bar */}
        <div className="relative flex items-end gap-1.5 p-1.5 bg-slate-100 dark:bg-zinc-800/90 rounded-2xl border border-slate-200/90 dark:border-zinc-700/80 focus-within:ring-2 focus-within:ring-emerald-500 focus-within:bg-white dark:focus-within:bg-zinc-900 transition-all shadow-xs">
          {/* Plus / Toolkit Button */}
          <button
            type="button"
            onClick={onOpenToolkit}
            className="p-2.5 text-slate-500 hover:text-emerald-600 dark:text-zinc-400 dark:hover:text-emerald-400 rounded-xl hover:bg-slate-200/70 dark:hover:bg-zinc-700 transition-colors shrink-0"
            title="Open Academic Toolkit (+)"
          >
            <Plus size={19} />
          </button>

          {/* Math Symbol Palette Toggle Button */}
          <button
            type="button"
            onClick={onOpenMathPalette}
            className={`p-2.5 rounded-xl transition-colors shrink-0 ${
              isMathPaletteOpen 
                ? 'bg-emerald-500 text-white shadow-xs' 
                : 'text-slate-500 hover:text-emerald-600 dark:text-zinc-400 dark:hover:text-emerald-400 hover:bg-slate-200/70 dark:hover:bg-zinc-700'
            }`}
            title="Toggle Math & LaTeX Palette"
          >
            <Sigma size={18} />
          </button>

          {/* Auto-expanding Textarea */}
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isListening 
                ? 'Listening to speech... Speak math or physics concepts.' 
                : `Ask about ${activeTopicTitle || 'any academic concept, proof, or problem'}...`
            }
            className="w-full py-2 px-2 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 text-sm focus:outline-none resize-none max-h-[140px] leading-relaxed min-h-[38px]"
          />

          {/* Pro Mode Toggle (Small Pill) */}
          <button
            type="button"
            onClick={() => setIsProMode(!isProMode)}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all shrink-0 mb-1 hidden sm:flex items-center gap-1 ${
              isProMode
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'bg-slate-200 dark:bg-zinc-700 text-slate-600 dark:text-zinc-400 hover:bg-slate-300'
            }`}
            title="Pro Deep Reasoner (Higher Spark Complexity)"
          >
            <Sparkles size={11} />
            <span>{isProMode ? 'Pro Mode' : 'Standard'}</span>
          </button>

          {/* Voice Input Button */}
          <button
            type="button"
            onClick={toggleVoice}
            className={`p-2.5 rounded-xl transition-all shrink-0 ${
              isListening
                ? 'bg-red-500 text-white animate-pulse'
                : 'text-slate-500 hover:text-emerald-600 dark:text-zinc-400 dark:hover:text-emerald-400 hover:bg-slate-200/70 dark:hover:bg-zinc-700'
            }`}
            title={isListening ? 'Stop Speech Dictation' : 'Start Voice Math Dictation'}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          {/* Send or Stop Stream Button */}
          {isLoading && onAbortStream ? (
            <button
              type="button"
              onClick={onAbortStream}
              className="p-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl transition-all shadow-md shadow-rose-500/20 active:scale-95 shrink-0"
              title="Stop Generation & Refund Unused Sparks"
            >
              <Square size={18} className="fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={isLoading || (!input.trim() && !selectedImage && !pdfText)}
              onClick={() => onSend()}
              className="p-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl disabled:opacity-40 disabled:hover:bg-emerald-500 transition-all shadow-md shadow-emerald-500/20 active:scale-95 shrink-0"
              title="Send Message (Enter)"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatInputBar;
