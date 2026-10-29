import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, 
  Upload, 
  X, 
  Sparkles, 
  FileText, 
  Brain, 
  CheckCircle2, 
  Loader2, 
  ArrowRight,
  Image as ImageIcon,
  Zap,
  ChevronRight,
  BookOpen
} from 'lucide-react';
import { AIService } from '../services/ai';
import MarkdownRenderer from './MarkdownRenderer';

interface VisionToQuizProps {
  onClose: () => void;
  onQuizGenerated: (quiz: any) => void;
}

export const VisionToQuiz: React.FC<VisionToQuizProps> = ({ onClose, onQuizGenerated }) => {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = async () => {
    if (!image) return;
    setLoading(true);
    try {
      const base64Data = image.split(',')[1];
      const mimeType = image.split(';')[0].split(':')[1];
      const data = await AIService.visionToQuiz(base64Data, mimeType);
      setResult(data);
    } catch (error) {
      console.error('Failed to process image:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white w-full max-w-2xl max-h-[90vh] rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
              <Camera size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Vision-to-Mastery</h2>
              <p className="text-slate-500 text-sm">Snap notes, get instant quizzes</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-400"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <AnimatePresence mode="wait">
            {!result ? (
              <motion.div 
                key="upload"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-8"
              >
                {!image ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="group cursor-pointer border-2 border-dashed border-slate-200 rounded-[2.5rem] p-12 text-center hover:border-emerald-500 hover:bg-emerald-50/30 transition-all"
                  >
                    <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                      <Upload className="text-slate-400 group-hover:text-emerald-500" size={32} />
                    </div>
                    <h3 className="text-xl font-bold text-slate-900 mb-2">Upload Lecture Notes</h3>
                    <p className="text-slate-500 text-sm max-w-xs mx-auto">
                      Snap a photo of your whiteboard, textbook, or handwritten notes.
                    </p>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept="image/*"
                      className="hidden"
                    />
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="relative rounded-[2rem] overflow-hidden border border-slate-200 aspect-video bg-slate-100">
                      <img src={image} alt="Preview" className="w-full h-full object-contain" />
                      <button 
                        onClick={() => setImage(null)}
                        className="absolute top-4 right-4 p-2 bg-white/90 backdrop-blur-sm rounded-xl shadow-lg hover:bg-white transition-colors text-red-500"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <button 
                      onClick={processImage}
                      disabled={loading}
                      className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="animate-spin" size={20} />
                          Analyzing your notes...
                        </>
                      ) : (
                        <>
                          <Sparkles size={20} />
                          Generate Mastery Pack
                        </>
                      )}
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  {[
                    { icon: <FileText size={18} />, label: 'Summary' },
                    { icon: <Brain size={18} />, label: '5 Quizzes' },
                    { icon: <Zap size={18} />, label: '3 Flashcards' }
                  ].map((item, idx) => (
                    <div key={idx} className="p-4 bg-slate-50 rounded-2xl text-center">
                      <div className="text-slate-400 mb-2 flex justify-center">{item.icon}</div>
                      <span className="text-xs font-bold text-slate-600">{item.label}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="result"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
              >
                <div className="bg-emerald-50 p-6 rounded-[2rem] border border-emerald-100">
                  <div className="flex items-center gap-2 mb-3 text-emerald-600">
                    <CheckCircle2 size={20} />
                    <span className="font-bold text-sm uppercase tracking-wider">Analysis Complete</span>
                  </div>
                  <div className="text-slate-700 text-sm leading-relaxed">
                    <MarkdownRenderer content={result.summary} />
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <Brain className="text-purple-500" size={20} />
                    Generated Quizzes
                  </h3>
                  <div className="space-y-3">
                    {result.quizzes.map((q: any, idx: number) => (
                      <div key={idx} className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm flex items-center justify-between group hover:border-emerald-200 transition-all">
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <div className="w-8 h-8 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400 font-bold text-xs shrink-0">
                            {idx + 1}
                          </div>
                          <div className="text-sm font-medium text-slate-700 line-clamp-1">
                            <MarkdownRenderer content={q.question} inline />
                          </div>
                        </div>
                        <ChevronRight size={18} className="text-slate-300 group-hover:text-emerald-500 transition-colors shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => onQuizGenerated(result.quizzes)}
                    className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all"
                  >
                    Start Quiz Now <ArrowRight size={18} />
                  </button>
                  <button 
                    onClick={() => setResult(null)}
                    className="px-6 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all"
                  >
                    Reset
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};
