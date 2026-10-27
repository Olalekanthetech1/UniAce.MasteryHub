import React, { useState, useEffect } from 'react';
import { Upload, FileText, Plus, CheckCircle, Loader2, AlertCircle, Save, Trash2, Edit2, Search, List, FileUp, Bot, Shield, Zap, Star, Cpu, Download } from 'lucide-react';
import { auth } from '../firebase';
import { jsonrepair } from 'jsonrepair';
import Papa from 'papaparse';
import { exportJsonToExcel } from '../utils/exportUtils';

type TabType = 'view' | 'add' | 'bulk';

export default function AdminQuestionBank() {
  const [activeTab, setActiveTab] = useState<TabType>('view');
  
  // Shared state
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // View Tab State
  const [papers, setPapers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingQuestion, setEditingQuestion] = useState<any | null>(null);

  // Add/Bulk Tab State
  const [courseCode, setCourseCode] = useState('');
  const [year, setYear] = useState('');
  const [semester, setSemester] = useState('');
  const [title, setTitle] = useState('');
  
  // Bulk Tab State
  const [extractedQuestions, setExtractedQuestions] = useState<any[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<'gemini_direct' | 'openrouter_free' | 'mistral_direct' | 'groq' | 'cohere' | 'huggingface' | 'nvidia'>('gemini_direct');

  // Single Add State
  const [singleQuestion, setSingleQuestion] = useState({
    question: '',
    options: ['', '', '', ''],
    correctAnswer: '',
    explanation: '',
    hint: ''
  });

  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    if (activeTab === 'view') {
      fetchPapers();
    }
  }, [activeTab]);

  useEffect(() => {
    const fetchRoutingConfig = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch('/api/admin/routing-config', {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const json = await res.json();
          const config = json?.config || {};
          if (config.past_questions) {
            const provider = config.past_questions;
            if (provider === 'gemini') setSelectedProvider('gemini_direct');
            else if (provider === 'mistral') setSelectedProvider('mistral_direct');
            else setSelectedProvider(provider as any);
          }
        }
      } catch (err) {
        console.error("Error fetching routing config:", err);
      }
    };
    fetchRoutingConfig();
  }, []);

  const fetchPapers = async () => {
    setIsLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/admin/past-papers', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Failed to fetch past papers');
      const data = await res.json();
      setPapers(Array.isArray(data.papers) ? data.papers : []);
    } catch (err: any) {
      setError('Failed to fetch questions: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveQuestions = async (questionsToSave: any[]) => {
    if (!courseCode || !year || !semester || !title) {
      setError('Please fill in Course Code, Year, Semester, and Title.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/questions/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          courseCode,
          year,
          semester,
          title,
          questions: questionsToSave
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save questions');
      }

      setSuccess(`Successfully saved ${questionsToSave.length} questions and generated embeddings!`);
      setExtractedQuestions([]);
      setSingleQuestion({ question: '', options: ['', '', '', ''], correctAnswer: '', explanation: '', hint: '' });
      
      // Reset form if it was a single add
      if (activeTab === 'add') {
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to save to database.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportAllQuestionsToExcel = () => {
    const flatData: any[] = [];
    papers.forEach(paper => {
      (paper.questions || []).forEach((q: any, qIdx: number) => {
        flatData.push({
          'Course Code': paper.courseCode,
          'Title': paper.title,
          'Semester': paper.semester,
          'Academic Year': paper.year,
          'Question #': qIdx + 1,
          'Question': q.question,
          'Option A': q.options?.[0] || '',
          'Option B': q.options?.[1] || '',
          'Option C': q.options?.[2] || '',
          'Option D': q.options?.[3] || '',
          'Correct Answer': q.correctAnswer,
          'Explanation': q.explanation || '',
          'Hint': q.hint || ''
        });
      });
    });

    exportJsonToExcel(flatData, 'Question Bank', `uniace-question-bank-${Date.now()}.xlsx`);
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!courseCode || !year || !semester || !title) {
      setError('Please fill in Course Code, Year, Semester, and Title before uploading.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          const mimeType = file.type;

          const token = await auth.currentUser?.getIdToken();
          const response = await fetch('/api/admin/extract-questions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              pdfData: base64Data,
              mimeType,
              courseCode,
              year,
              semester,
              provider: selectedProvider
            })
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to extract questions');
          }

          const data = await response.json();
          const repairedJson = jsonrepair(data.text);
          const parsed = JSON.parse(repairedJson);
          
          if (parsed.questions && Array.isArray(parsed.questions)) {
            setExtractedQuestions(parsed.questions);
            setSuccess(`Successfully extracted ${parsed.questions.length} questions! Review them below.`);
          } else {
            throw new Error('Invalid format returned from AI');
          }
        } catch (err: any) {
          console.error(err);
          setError(err.message || 'An error occurred during extraction.');
        } finally {
          setIsLoading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred during file reading.');
      setIsLoading(false);
    }
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!courseCode || !year || !semester || !title) {
      setError('Please fill in Course Code, Year, Semester, and Title before uploading.');
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsedQuestions = results.data.map((row: any) => {
            if (!row.Question || !row.OptionA || !row.OptionB || !row.OptionC || !row.OptionD || !row.CorrectAnswer) {
              throw new Error("CSV must have columns: Question, OptionA, OptionB, OptionC, OptionD, CorrectAnswer, Explanation, Hint");
            }
            return {
              question: row.Question,
              options: [row.OptionA, row.OptionB, row.OptionC, row.OptionD],
              correctAnswer: row[`Option${row.CorrectAnswer}`] || row.CorrectAnswer,
              explanation: row.Explanation || '',
              hint: row.Hint || ''
            };
          });
          setExtractedQuestions(parsedQuestions);
          setSuccess(`Successfully parsed ${parsedQuestions.length} questions from CSV! Review them below.`);
        } catch (err: any) {
          setError(err.message);
        }
      },
      error: (error) => {
        setError(`CSV Parsing Error: ${error.message}`);
      }
    });
  };

  const handleDeleteQuestion = (paperId: string, questionId: string) => {
    setConfirmModal({
      title: "Delete Question",
      message: "Are you sure you want to delete this question? This will also remove its AI embedding.",
      onConfirm: async () => {
        setConfirmModal(null);
        setIsLoading(true);
        try {
          const token = await auth.currentUser?.getIdToken();
          const response = await fetch('/api/admin/questions/delete', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ paperId, questionId })
          });

          if (!response.ok) throw new Error('Failed to delete question');
          
          setSuccess('Question deleted successfully.');
          fetchPapers();
        } catch (err: any) {
          setError(err.message);
        } finally {
          setIsLoading(false);
        }
      }
    });
  };

  const handleUpdateQuestion = async () => {
    if (!editingQuestion) return;
    
    setIsLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/admin/questions/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          paperId: editingQuestion.paperId, 
          question: editingQuestion 
        })
      });

      if (!response.ok) throw new Error('Failed to update question');
      
      setSuccess('Question updated successfully.');
      setEditingQuestion(null);
      fetchPapers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMetadataForm = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8 bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700">
      <div>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Course Code</label>
        <input 
          type="text" 
          value={courseCode}
          onChange={(e) => setCourseCode(e.target.value)}
          placeholder="e.g. MAT 103"
          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Paper Title</label>
        <input 
          type="text" 
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Summer Semester Examinations"
          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Academic Year</label>
        <input 
          type="text" 
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="e.g. 2023/2024"
          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Semester</label>
        <select 
          value={semester}
          onChange={(e) => setSemester(e.target.value)}
          className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">Select Semester</option>
          <option value="First">First Semester</option>
          <option value="Second">Second Semester</option>
          <option value="Summer">Summer Semester</option>
        </select>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Question Bank</h2>
          <p className="text-slate-500 dark:text-slate-400">Manage past questions and AI knowledge base embeddings.</p>
        </div>
        
        <div className="flex items-center gap-3">
          {activeTab === 'view' && papers.length > 0 && (
            <button
              onClick={handleExportAllQuestionsToExcel}
              className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-sm transition-colors"
              title="Export all questions to Excel (.xlsx)"
            >
              <Download size={15} />
              Export Excel
            </button>
          )}

          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('view')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'view' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              <List size={16} /> View All
            </button>
            <button
              onClick={() => setActiveTab('add')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'add' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              <Plus size={16} /> Add Single
            </button>
            <button
              onClick={() => setActiveTab('bulk')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === 'bulk' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              <FileUp size={16} /> Bulk Upload
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 p-4 rounded-2xl flex items-center gap-3">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-2xl flex items-center gap-3">
          <CheckCircle size={20} />
          <p>{success}</p>
        </div>
      )}

      {/* VIEW TAB */}
      {activeTab === 'view' && (
        <div className="space-y-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="text"
              placeholder="Search questions by course code, year, or content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl pl-12 pr-4 py-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>

          {isLoading ? (
            <div className="flex justify-center p-12">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
          ) : (
            <div className="space-y-8">
              {papers.filter(p => p.courseCode.toLowerCase().includes(searchQuery.toLowerCase()) || p.title.toLowerCase().includes(searchQuery.toLowerCase())).map(paper => (
                <div key={paper.id} className="bg-white dark:bg-slate-800 rounded-3xl overflow-hidden shadow-sm border border-slate-200 dark:border-slate-700">
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-6 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">{paper.courseCode} - {paper.title}</h3>
                    <p className="text-slate-500 dark:text-slate-400">{paper.semester} Semester, {paper.year} • {paper.questions?.length || 0} Questions</p>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-700">
                    {paper.questions?.map((q: any, idx: number) => (
                      <div key={q.id} className="p-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        {editingQuestion?.id === q.id ? (
                          <div className="space-y-4">
                            <textarea 
                              value={editingQuestion.question}
                              onChange={e => setEditingQuestion({...editingQuestion, question: e.target.value})}
                              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white"
                              rows={3}
                            />
                            <div className="grid grid-cols-2 gap-4">
                              {(editingQuestion?.options || []).map((opt: string, oIdx: number) => (
                                <input 
                                  key={oIdx}
                                  value={opt}
                                  onChange={e => {
                                    const newOpts = [...(editingQuestion?.options || [])];
                                    newOpts[oIdx] = e.target.value;
                                    setEditingQuestion({...editingQuestion, options: newOpts});
                                  }}
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white"
                                />
                              ))}
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Correct Answer</label>
                                <input 
                                  value={editingQuestion.correctAnswer}
                                  onChange={e => setEditingQuestion({...editingQuestion, correctAnswer: e.target.value})}
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">Explanation</label>
                                <input 
                                  value={editingQuestion.explanation}
                                  onChange={e => setEditingQuestion({...editingQuestion, explanation: e.target.value})}
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-3 mt-4">
                              <button onClick={() => setEditingQuestion(null)} className="px-4 py-2 text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl">Cancel</button>
                              <button onClick={handleUpdateQuestion} disabled={isLoading} className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700">Save Changes</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex justify-between items-start mb-4">
                              <h4 className="font-bold text-slate-900 dark:text-white text-lg">
                                <span className="text-indigo-500 mr-2">Q{idx + 1}.</span>
                                {q.question}
                              </h4>
                              <div className="flex gap-2">
                                <button onClick={() => setEditingQuestion({...q, paperId: paper.id})} className="text-slate-400 hover:text-indigo-500 transition-colors p-2">
                                  <Edit2 size={18} />
                                </button>
                                <button onClick={() => handleDeleteQuestion(paper.id, q.id)} className="text-slate-400 hover:text-rose-500 transition-colors p-2">
                                  <Trash2 size={18} />
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 pl-8">
                              {q.options?.map((opt: string, oIdx: number) => (
                                <div key={oIdx} className={`p-3 rounded-xl border ${opt === q.correctAnswer ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-medium' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}>
                                  <span className="font-bold mr-2">{String.fromCharCode(65 + oIdx)}.</span> {opt}
                                </div>
                              ))}
                            </div>
                            <div className="pl-8 text-sm text-slate-500 dark:text-slate-400">
                              <strong>Explanation:</strong> {q.explanation}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    {(!paper.questions || paper.questions.length === 0) && (
                      <div className="p-6 text-center text-slate-500 dark:text-slate-400">No questions in this paper.</div>
                    )}
                  </div>
                </div>
              ))}
              {papers.length === 0 && (
                <div className="text-center py-12 text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700">
                  No past papers found. Add some questions!
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ADD SINGLE TAB */}
      {activeTab === 'add' && (
        <div className="space-y-6">
          {renderMetadataForm()}
          
          <div className="bg-white dark:bg-slate-800 p-8 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Question Details</h3>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Question Text</label>
                <textarea 
                  value={singleQuestion.question}
                  onChange={e => setSingleQuestion({...singleQuestion, question: e.target.value})}
                  className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  rows={3}
                  placeholder="Enter the question here..."
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(singleQuestion?.options || []).map((opt, idx) => (
                  <div key={idx}>
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Option {String.fromCharCode(65 + idx)}</label>
                    <input 
                      type="text"
                      value={opt}
                      onChange={e => {
                        const newOpts = [...(singleQuestion?.options || [])];
                        newOpts[idx] = e.target.value;
                        setSingleQuestion({...singleQuestion, options: newOpts});
                      }}
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder={`Option ${String.fromCharCode(65 + idx)} text`}
                    />
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Correct Answer (Exact Text)</label>
                  <select 
                    value={singleQuestion.correctAnswer}
                    onChange={e => setSingleQuestion({...singleQuestion, correctAnswer: e.target.value})}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select Correct Option</option>
                    {(singleQuestion?.options || []).map((opt, idx) => opt && (
                      <option key={idx} value={opt}>Option {String.fromCharCode(65 + idx)}: {opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Explanation</label>
                  <input 
                    type="text"
                    value={singleQuestion.explanation}
                    onChange={e => setSingleQuestion({...singleQuestion, explanation: e.target.value})}
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Why is this the correct answer?"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button 
                  onClick={() => handleSaveQuestions([singleQuestion])}
                  disabled={isLoading || !singleQuestion.question || !singleQuestion.correctAnswer}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                  Save Question
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'bulk' && (
        <div className="space-y-6">
          {renderMetadataForm()}

          {/* AI Provider Selection */}
          <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <Bot size={18} className="text-indigo-500" />
              Select AI Extraction Provider
            </h3>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setSelectedProvider('gemini_direct')}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                  selectedProvider === 'gemini_direct'
                    ? 'bg-blue-100 text-blue-700 border-2 border-blue-500 dark:bg-blue-900/30 dark:text-blue-400'
                    : 'bg-slate-50 text-slate-600 border-2 border-slate-100 hover:border-blue-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700 dark:hover:border-blue-700'
                }`}
              >
                <Shield size={16} />
                Gemini
              </button>
              <button
                onClick={() => setSelectedProvider('groq')}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                  selectedProvider === 'groq'
                    ? 'bg-orange-100 text-orange-700 border-2 border-orange-500 dark:bg-orange-900/30 dark:text-orange-400'
                    : 'bg-slate-50 text-slate-600 border-2 border-slate-100 hover:border-orange-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700 dark:hover:border-orange-700'
                }`}
              >
                <Zap size={16} />
                Groq (Turbo)
              </button>
              <button
                onClick={() => setSelectedProvider('mistral_direct')}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                  selectedProvider === 'mistral_direct'
                    ? 'bg-purple-100 text-purple-700 border-2 border-purple-500 dark:bg-purple-900/30 dark:text-purple-400'
                    : 'bg-slate-50 text-slate-600 border-2 border-slate-100 hover:border-purple-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700 dark:hover:border-purple-700'
                }`}
              >
                <Star size={16} />
                Mistral
              </button>
              <button
                onClick={() => setSelectedProvider('openrouter_free')}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                  selectedProvider === 'openrouter_free'
                    ? 'bg-indigo-100 text-indigo-700 border-2 border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-400'
                    : 'bg-slate-50 text-slate-600 border-2 border-slate-100 hover:border-indigo-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700 dark:hover:border-indigo-700'
                }`}
              >
                <Zap size={16} />
                OpenRouter
              </button>
              <button
                onClick={() => setSelectedProvider('cohere')}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                  selectedProvider === 'cohere'
                    ? 'bg-emerald-100 text-emerald-700 border-2 border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-slate-50 text-slate-600 border-2 border-slate-100 hover:border-emerald-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700 dark:hover:border-emerald-700'
                }`}
              >
                <Bot size={16} />
                Cohere
              </button>
              <button
                onClick={() => setSelectedProvider('huggingface')}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                  selectedProvider === 'huggingface'
                    ? 'bg-yellow-100 text-yellow-700 border-2 border-yellow-500 dark:bg-yellow-900/30 dark:text-yellow-400'
                    : 'bg-slate-50 text-slate-600 border-2 border-slate-100 hover:border-yellow-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700 dark:hover:border-yellow-700'
                }`}
              >
                <Bot size={16} />
                Hugging Face
              </button>
              <button
                onClick={() => setSelectedProvider('nvidia')}
                className={`px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                  selectedProvider === 'nvidia'
                    ? 'bg-emerald-100 text-emerald-700 border-2 border-emerald-500 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-slate-50 text-slate-600 border-2 border-slate-100 hover:border-emerald-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700 dark:hover:border-emerald-700'
                }`}
              >
                <Cpu size={16} />
                NVIDIA NIM
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-3 italic">
              * This choice overrides the system default routing for this specific upload.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-3xl p-12 text-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors relative bg-white dark:bg-slate-800">
              <input 
                type="file" 
                accept="application/pdf,image/*" 
                onChange={handlePdfUpload}
                disabled={isLoading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
              <div className="flex flex-col items-center justify-center pointer-events-none">
                {isLoading ? (
                  <>
                    <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Analyzing Document...</h3>
                    <p className="text-slate-500 dark:text-slate-400 mt-2">The AI is extracting questions.</p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center justify-center mb-4">
                      <Upload size={32} />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Upload PDF (AI Magic)</h3>
                    <p className="text-slate-500 dark:text-slate-400 mt-2">Let AI extract questions from a PDF.</p>
                  </>
                )}
              </div>
            </div>

            <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-3xl p-12 text-center hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors relative bg-white dark:bg-slate-800">
              <input 
                type="file" 
                accept=".csv" 
                onChange={handleCsvUpload}
                disabled={isLoading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
              <div className="flex flex-col items-center justify-center pointer-events-none">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mb-4">
                  <FileText size={32} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Upload CSV</h3>
                <p className="text-slate-500 dark:text-slate-400 mt-2">Upload a formatted CSV file.</p>
              </div>
            </div>
          </div>

          {extractedQuestions.length > 0 && (
            <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden mt-8">
              <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <FileText className="text-indigo-500" />
                  Preview Extracted Questions ({extractedQuestions.length})
                </h3>
                <button 
                  onClick={() => handleSaveQuestions(extractedQuestions)}
                  disabled={isLoading}
                  className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  Save All to Database
                </button>
              </div>
              
              <div className="divide-y divide-slate-200 dark:divide-slate-700 max-h-[600px] overflow-y-auto">
                {extractedQuestions.map((q, idx) => (
                  <div key={idx} className="p-6 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="flex justify-between items-start mb-4">
                      <h4 className="font-bold text-slate-900 dark:text-white text-lg">
                        <span className="text-indigo-500 mr-2">Q{idx + 1}.</span>
                        {q.question}
                      </h4>
                      <button 
                        onClick={() => setExtractedQuestions(prev => prev.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-rose-500 transition-colors p-2"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 pl-8">
                      {(q?.options || []).map((opt: string, oIdx: number) => (
                        <div 
                          key={oIdx} 
                          className={`p-3 rounded-xl border ${opt === q.correctAnswer ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-medium' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'}`}
                        >
                          <span className="font-bold mr-2">{String.fromCharCode(65 + oIdx)}.</span> {opt}
                        </div>
                      ))}
                    </div>
                    
                    <div className="pl-8 space-y-2">
                      <div className="bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 p-3 rounded-xl text-sm">
                        <strong>Explanation:</strong> {q.explanation}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{confirmModal.title}</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button 
                onClick={confirmModal.onConfirm}
                className="px-6 py-2 rounded-xl font-bold bg-red-600 hover:bg-red-700 text-white"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{confirmModal.title}</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 rounded-xl font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button 
                onClick={confirmModal.onConfirm}
                className="px-6 py-2 rounded-xl font-bold bg-red-600 hover:bg-red-700 text-white"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
