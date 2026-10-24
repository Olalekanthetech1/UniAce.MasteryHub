import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Mic, Loader2, Volume2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AIPersonality } from '../types';

const stripThinkTags = (text: string) => {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
};

interface VoiceTutorProps {
  isOpen: boolean;
  onClose: () => void;
  pdfContent?: string;
  systemInstruction?: string;
  personality?: AIPersonality;
}

export default function VoiceTutor({ isOpen, onClose, pdfContent, systemInstruction, personality }: VoiceTutorProps) {
  const { user } = useAuth();
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [statusText, setStatusText] = useState('Tap microphone to speak');
  const [defaultPersonality, setDefaultPersonality] = useState<AIPersonality>('encouraging');

  useEffect(() => {
    const fetchDefaultPersonality = async () => {
      try {
        const res = await fetch('/api/system/config/routing');
        if (res.ok) {
          const json = await res.json();
          if (json.data && json.data.default_personality) {
            setDefaultPersonality(json.data.default_personality as AIPersonality);
          }
        }
      } catch (e) {
        console.warn("Failed to fetch default personality in VoiceTutor from Neon:", e);
      }
    };
    fetchDefaultPersonality();
  }, []);
  
  const recognitionRef = useRef<any>(null);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    // Initialize Web Speech APIs
    if (typeof window !== 'undefined') {
      synthesisRef.current = window.speechSynthesis;

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          setIsListening(true);
          setStatusText('Listening...');
        };

        recognition.onresult = async (event: any) => {
          setIsListening(false);
          const transcript = event.results[0][0].transcript;
          setStatusText(`You: "${transcript}"`);
          await processVoiceInput(transcript);
        };

        recognition.onerror = (event: any) => {
          setIsListening(false);
          if (event.error !== 'aborted') {
            setStatusText(`Error: ${event.error}. Tap mic to try again.`);
          }
        };

        recognition.onend = () => {
          setIsListening(false);
        };

        recognitionRef.current = recognition;
      } else {
        setStatusText('Speech recognition is not supported in this browser.');
      }
    }
  }, [user, pdfContent, systemInstruction]);

  const processVoiceInput = async (transcript: string) => {
    if (!user) {
      setStatusText('Please log in to use the tutor.');
      return;
    }

    setIsProcessing(true);
    setStatusText('Thinking...');

    try {
      const token = await user.getIdToken();
      let contextStr = systemInstruction || 'You are a helpful, encouraging voice tutor. Keep your responses short, conversational, and easy to understand out loud (no markdown, bolding, or lists).';
      if (pdfContent) {
         contextStr += `\n\nStudy Context:\n${pdfContent.substring(0, 1500)}`;
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: transcript,
          history: [], // We could track history here if needed
          context: contextStr,
          complexity: 'standard',
          personality: personality || defaultPersonality || 'encouraging',
          taskType: 'voice_tutor'
        })
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Voice tutor server error (${response.status}): ${response.statusText || 'Request failed'}`);
      }
      let aiText = '';
      
      try {
        // The endpoint returns Server-Sent Events (SSE) by default for streaming
        // Let's just strip out the SSE "data: " wrappers to get the raw text
        const lines = responseText.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const data = JSON.parse(dataStr);
              if (data.reply) aiText += data.reply;
              if (data.chunk) aiText += data.chunk;
            } catch (e) {
              // Sometimes it might not be JSON if it's raw text chunk
            }
          }
        }
        
        // If it wasn't SSE, maybe it was just a plain JSON response
        if (!aiText) {
           const data = JSON.parse(responseText);
           aiText = data.reply || data.text || "I'm not sure what to say.";
        }
      } catch (e) {
         // Fallback if parsing fails
         aiText = "Sorry, I had trouble processing that.";
      }

      const cleanAiText = stripThinkTags(aiText);
      setStatusText(`Tutor: "${cleanAiText}"`);
      speakText(cleanAiText);

    } catch (error) {
      console.error('Error processing voice:', error);
      setStatusText('Failed to reach the AI. Try again.');
      setIsProcessing(false);
    }
  };

  const speakText = (text: string) => {
    if (!synthesisRef.current) return;
    
    const cleanText = stripThinkTags(text);
    
    // Stop any ongoing speech
    synthesisRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Try to find a good English voice
    const voices = synthesisRef.current.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Samantha') || v.lang === 'en-US');
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }
    
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      setIsProcessing(false);
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setStatusText('Tap microphone to speak');
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsProcessing(false);
      setStatusText('Failed to play audio.');
    };

    synthesisRef.current.speak(utterance);
  };

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      // If the tutor is speaking, stop it so we can listen
      if (synthesisRef.current && isSpeaking) {
        synthesisRef.current.cancel();
      }
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Could not start recognition", e);
      }
    }
  };

  const handleClose = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    if (synthesisRef.current) synthesisRef.current.cancel();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col relative"
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-zinc-800/50">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                  Voice Tutor
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold tracking-wide border border-emerald-300/50 dark:border-emerald-800/50">
                  NVIDIA Nemotron
                </span>
              </div>
              <button
                onClick={handleClose}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-zinc-800 dark:hover:text-slate-300 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-8 flex flex-col items-center justify-center min-h-[350px] relative">
              <div className="absolute top-6 left-0 right-0 text-center px-4">
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {isListening ? 'Listening...' : isProcessing ? 'Thinking...' : isSpeaking ? 'Speaking...' : 'Ready'}
                </p>
              </div>

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={toggleListening}
                disabled={isProcessing}
                className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
                  isProcessing
                    ? 'bg-amber-500 shadow-[0_0_40px_rgba(245,158,11,0.4)]'
                    : isSpeaking
                    ? 'bg-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.4)]'
                    : isListening
                    ? 'bg-rose-500 shadow-[0_0_40px_rgba(244,63,94,0.4)]'
                    : 'bg-emerald-500 shadow-[0_0_40px_rgba(16,185,129,0.4)]'
                }`}
              >
                {(isListening || isSpeaking) && (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                      className="absolute inset-0 rounded-full border-2 border-white/30"
                    />
                    <motion.div
                      animate={{ scale: [1, 1.8, 1], opacity: [0.3, 0, 0.3] }}
                      transition={{ repeat: Infinity, duration: 2, delay: 0.5, ease: "easeInOut" }}
                      className="absolute inset-0 rounded-full border-2 border-white/20"
                    />
                  </>
                )}
                
                {isProcessing ? (
                  <Loader2 className="w-12 h-12 text-white animate-spin" />
                ) : isSpeaking ? (
                  <Volume2 className="w-12 h-12 text-white" />
                ) : (
                  <Mic className="w-12 h-12 text-white" />
                )}
              </motion.button>

              <div className="mt-10 w-full text-center h-24 flex items-center justify-center px-4 overflow-y-auto">
                <AnimatePresence mode="wait">
                  <motion.p 
                    key={statusText}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="text-slate-600 dark:text-slate-400 text-sm md:text-base leading-relaxed"
                  >
                    {statusText}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
