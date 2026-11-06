import React, { createContext, useContext, useState, useRef, useEffect, useCallback, ReactNode } from 'react';
import { View } from '../types';
import {
  DemoScenario,
  DemoStep,
  IsolatedDemoTutorPreview,
  isDemoScenarioIsolated,
  isValidIsolatedDemoTutorPreview,
} from '../services/demoReelService';
import toast from 'react-hot-toast';

interface DemoReelContextType {
  isRecording: boolean;
  isPaused: boolean;
  currentScenario: DemoScenario | null;
  currentStepIndex: number;
  currentStep: DemoStep | null;
  elapsedSeconds: number;
  recordedBlob: Blob | null;
  recordedVideoUrl: string | null;
  recordedDuration: number;
  recordingSource: 'browser' | 'imported' | null;
  recordedFileName: string | null;
  recordedVideoDimensions: { width: number; height: number } | null;
  isImportingVideo: boolean;
  importVideoFile: (file: File) => Promise<boolean>;
  isModalOpen: boolean;
  selectedScenarioId: string;
  screenCaptureSupported: boolean;
  setSelectedScenarioId: (id: string) => void;
  startDemoReel: (scenario: DemoScenario, navigateCallback?: (view: View) => void) => Promise<boolean>;
  skipToNextStep: () => void;
  pauseDemoReel: () => void;
  resumeDemoReel: () => void;
  stopAndSaveReel: () => Promise<void>;
  cancelDemoReel: () => void;
  downloadReel: (filename?: string) => void;
  openPreviewModal: () => void;
  closePreviewModal: () => void;
}

const DemoReelContext = createContext<DemoReelContextType | null>(null);

export function DemoReelProvider({ children }: { children: ReactNode }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentScenario, setCurrentScenario] = useState<DemoScenario | null>(null);
  const [activeTutorPreview, setActiveTutorPreview] = useState<IsolatedDemoTutorPreview | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [recordingSource, setRecordingSource] = useState<'browser' | 'imported' | null>(null);
  const [recordedFileName, setRecordedFileName] = useState<string | null>(null);
  const [recordedVideoDimensions, setRecordedVideoDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isImportingVideo, setIsImportingVideo] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const stepTimeoutRef = useRef<any>(null);
  const navigateFnRef = useRef<((view: View) => void) | null>(null);
  const startTimeRef = useRef<number>(0);
  const discardRecordingRef = useRef(false);

  const screenCaptureSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  const currentStep = currentScenario && currentScenario.steps[currentStepIndex] ? currentScenario.steps[currentStepIndex] : null;

  const importVideoFile = useCallback(async (file: File): Promise<boolean> => {
    if (isRecording) {
      toast.error('Stop the current browser recording before importing another video.');
      return false;
    }
    if (!file || file.size <= 0) {
      toast.error('Choose a non-empty video file.');
      return false;
    }

    const lowerName = file.name.toLowerCase();
    const hasVideoMime = file.type.toLowerCase().startsWith('video/');
    const hasSupportedExtension = /\.(mp4|m4v|webm|mov|ogv|3gp|3g2)$/i.test(lowerName);
    if (!hasVideoMime && !hasSupportedExtension) {
      toast.error('Choose a supported video file, such as MP4, WebM or MOV.');
      return false;
    }

    const objectUrl = URL.createObjectURL(file);
    setIsImportingVideo(true);

    try {
      const metadata = await new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
        const probe = document.createElement('video');
        let settled = false;

        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          probe.onloadedmetadata = null;
          probe.onerror = null;
          probe.removeAttribute('src');
          probe.load();
          callback();
        };

        const timeoutId = window.setTimeout(() => {
          finish(() => reject(new Error('Video validation timed out. Try a shorter or re-exported video.')));
        }, 15000);

        probe.preload = 'metadata';
        probe.muted = true;
        probe.onloadedmetadata = () => {
          const duration = probe.duration;
          const width = probe.videoWidth;
          const height = probe.videoHeight;
          if (!Number.isFinite(duration) || duration <= 0 || width <= 0 || height <= 0) {
            finish(() => reject(new Error('The selected file does not contain readable video metadata.')));
            return;
          }
          finish(() => resolve({ duration, width, height }));
        };
        probe.onerror = () => {
          finish(() => reject(new Error('Your browser cannot decode this video. Try exporting it as MP4 (H.264).')));
        };
        probe.src = objectUrl;
        probe.load();
      });

      setRecordedBlob(file);
      setRecordedFileName(file.name || 'uniace-imported-video');
      setRecordingSource('imported');
      setRecordedDuration(Math.max(1, Math.round(metadata.duration)));
      setRecordedVideoDimensions({ width: metadata.width, height: metadata.height });
      setCurrentScenario(null);
      setSelectedScenarioId('');
      setActiveTutorPreview(null);
      setRecordedVideoUrl(objectUrl);
      setIsModalOpen(true);
      toast.success('Video imported locally. Review it before exporting.');
      return true;
    } catch (error: any) {
      URL.revokeObjectURL(objectUrl);
      console.error('Unable to import Demo Studio video:', error);
      toast.error(error?.message || 'The selected video could not be imported.');
      return false;
    } finally {
      setIsImportingVideo(false);
    }
  }, [isRecording]);

  // Clean up timer and media streams on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (recordedVideoUrl) {
        URL.revokeObjectURL(recordedVideoUrl);
      }
    };
  }, [recordedVideoUrl]);

  // Execute step transitions
  const executeStep = useCallback((stepIdx: number, scenario: DemoScenario) => {
    if (stepIdx >= scenario.steps.length) {
      // Completed all steps
      stopAndSaveReel();
      return;
    }

    const step = scenario.steps[stepIdx];
    setCurrentStepIndex(stepIdx);

    const isolatedTutorStep = step.view === 'ai-tutor' &&
      isValidIsolatedDemoTutorPreview(step.isolatedTutorPreview);
    setActiveTutorPreview(isolatedTutorStep ? step.isolatedTutorPreview! : null);

    // Render this segment through the admin-only overlay. Do not navigate into
    // the student tutor view or trigger its profile/history reads.
    if (!isolatedTutorStep) {
      if (navigateFnRef.current) {
        navigateFnRef.current(step.view);
      } else if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('navigate', { detail: step.view }));
      }
    }

    // 3. Schedule next step
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    stepTimeoutRef.current = setTimeout(() => {
      executeStep(stepIdx + 1, scenario);
    }, step.durationMs);
  }, []);

  const skipToNextStep = useCallback(() => {
    if (!currentScenario || !isRecording) return;
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    const nextIdx = currentStepIndex + 1;
    if (nextIdx < currentScenario.steps.length) {
      executeStep(nextIdx, currentScenario);
    } else {
      stopAndSaveReel();
    }
  }, [currentScenario, isRecording, currentStepIndex, executeStep]);

  const pauseDemoReel = useCallback(() => {
    if (!isRecording || isPaused) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
    }
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    setIsPaused(true);
    toast('Demo recording paused', { icon: '⏸️' });
  }, [isRecording, isPaused]);

  const resumeDemoReel = useCallback(() => {
    if (!isRecording || !isPaused || !currentScenario) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
    }
    setIsPaused(false);
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    // Resume step execution
    const remainingStep = currentScenario.steps[currentStepIndex];
    if (remainingStep) {
      stepTimeoutRef.current = setTimeout(() => {
        executeStep(currentStepIndex + 1, currentScenario);
      }, remainingStep.durationMs / 2);
    }
    toast('Demo recording resumed', { icon: '▶️' });
  }, [isRecording, isPaused, currentScenario, currentStepIndex, executeStep]);

  const cancelDemoReel = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    discardRecordingRef.current = true;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (e) {
        console.warn('Error stopping media recorder on cancel:', e);
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    setIsPaused(false);
    setCurrentScenario(null);
    setActiveTutorPreview(null);
    setCurrentStepIndex(0);
    setElapsedSeconds(0);
    toast('Demo reel cancelled', { icon: '🛑' });
  }, []);

  const stopAndSaveReel = useCallback(async () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setIsRecording(false);
      setIsPaused(false);
      return;
    }

    const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    setRecordedDuration(duration);
    setIsRecording(false);
    setIsPaused(false);

    try {
      recorder.stop();
    } catch (error) {
      toast.error('The browser could not finalize this recording.');
      console.error('Failed to stop demo recorder:', error);
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startDemoReel = useCallback(async (
    scenario: DemoScenario,
    navigateCallback?: (view: View) => void
  ): Promise<boolean> => {
    if (!scenario || !Array.isArray(scenario.steps) || scenario.steps.length === 0) {
      toast.error('A verified Demo Studio scenario is required before recording.');
      return false;
    }
    if (!isDemoScenarioIsolated(scenario)) {
      toast.error('This scenario contains an AI Tutor or automated chat step. Chat execution is disabled in Demo Studio until an isolated demo path is available.');
      return false;
    }
    if (scenario.requiresReview) {
      toast.error('This AI-generated demo script requires administrator review before recording.');
      return false;
    }
    discardRecordingRef.current = false;
    setSelectedScenarioId(scenario.id);
    setCurrentScenario(scenario);
    setActiveTutorPreview(null);
    if (navigateCallback) navigateFnRef.current = navigateCallback;

    chunksRef.current = [];
    setRecordedBlob(null);
    setRecordedDuration(0);
    setRecordedFileName(null);
    setRecordingSource(null);
    setRecordedVideoDimensions(null);
    setIsModalOpen(false);
    if (recordedVideoUrl) {
      URL.revokeObjectURL(recordedVideoUrl);
      setRecordedVideoUrl(null);
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        toast.error('Screen capture is not supported in this browser environment.');
        return false;
      }

      // Prompt user to pick application window or tab for recording
      toast('Please select this tab or window to start recording...', { icon: '🎥', duration: 4000 });
      
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          frameRate: { ideal: 60, max: 60 }
        } as any,
        audio: false
      });

      streamRef.current = stream;

      // Pick best supported MIME type
      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264',
        'video/webm',
        'video/mp4'
      ];
      const selectedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'video/webm';

      const recorder = new MediaRecorder(stream, {
        mimeType: selectedMime,
        videoBitsPerSecond: 4000000 // 4 Mbps high definition
      });

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        mediaRecorderRef.current = null;
        setActiveTutorPreview(null);

        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          chunksRef.current = [];
          setRecordedBlob(null);
          setRecordedDuration(0);
          setIsModalOpen(false);
          return;
        }

        const fullBlob = new Blob(chunksRef.current, { type: recorder.mimeType || selectedMime });
        chunksRef.current = [];
        if (fullBlob.size <= 0) {
          setRecordedBlob(null);
          setIsModalOpen(false);
          toast.error('The browser stopped recording but produced no video data. Nothing was saved.');
          return;
        }

        setRecordedBlob(fullBlob);
        setRecordedFileName(null);
        setRecordingSource('browser');
        setRecordedVideoDimensions(null);
        const url = URL.createObjectURL(fullBlob);
        setRecordedVideoUrl(url);
        setIsModalOpen(true);
        toast.success('Demo recording is ready. Review the video before exporting.');
      };

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (recorder.state !== 'inactive') {
            void stopAndSaveReel();
          }
        };
      }

      mediaRecorderRef.current = recorder;
      recorder.start(1000); // chunk every 1 second

      startTimeRef.current = Date.now();
      setIsRecording(true);
      setIsPaused(false);
      setElapsedSeconds(0);

      // Start duration ticker
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);

      // Trigger first step
      executeStep(0, scenario);

      toast.success(`🎬 Recording started: ${scenario.name}`);
      return true;
    } catch (err: any) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      mediaRecorderRef.current = null;
      console.error('Failed to initialize demo reel recording:', err);
      if (err.name === 'NotAllowedError') {
        toast.error('Screen capture permission was denied.');
      } else {
        toast.error(`Could not start screen recording: ${err.message || 'Unknown error'}`);
      }
      setIsRecording(false);
      return false;
    }
  }, [selectedScenarioId, recordedVideoUrl, isRecording, executeStep, stopAndSaveReel]);

  const downloadReel = useCallback((filename?: string) => {
    if (!recordedBlob) {
      toast.error('No recorded video available to download.');
      return;
    }
    const mimeType = recordedBlob.type.toLowerCase();
    const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('quicktime') ? 'mov' : 'webm';
    const scenarioName = currentScenario?.id || 'recording';
    const defaultName = `uniace-${scenarioName}-reel-${new Date().toISOString().slice(0, 10)}.${extension}`;
    const finalName = filename || (recordingSource === 'imported' && recordedFileName ? recordedFileName : defaultName);
    const downloadUrl = recordedVideoUrl || URL.createObjectURL(recordedBlob);
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`📥 Downloaded ${finalName}!`);
  }, [recordedBlob, recordedVideoUrl, currentScenario, recordingSource, recordedFileName]);

  const openPreviewModal = useCallback(() => setIsModalOpen(true), []);
  const closePreviewModal = useCallback(() => setIsModalOpen(false), []);

  return (
    <DemoReelContext.Provider
      value={{
        isRecording,
        isPaused,
        currentScenario,
        currentStepIndex,
        currentStep,
        elapsedSeconds,
        recordedBlob,
        recordedVideoUrl,
        recordedDuration,
        recordingSource,
        recordedFileName,
        recordedVideoDimensions,
        isImportingVideo,
        importVideoFile,
        isModalOpen,
        selectedScenarioId,
        screenCaptureSupported,
        setSelectedScenarioId,
        startDemoReel,
        skipToNextStep,
        pauseDemoReel,
        resumeDemoReel,
        stopAndSaveReel,
        cancelDemoReel,
        downloadReel,
        openPreviewModal,
        closePreviewModal
      }}
    >
      {children}
      {activeTutorPreview && (
        <div
          aria-live="polite"
          className="fixed inset-0 z-[10000] pointer-events-none flex items-center justify-center bg-slate-950/85 p-4 sm:p-8"
        >
          <article className="w-full max-w-5xl max-h-[88vh] overflow-hidden rounded-[2rem] border border-emerald-300/40 bg-white text-slate-900 shadow-2xl">
            <header className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 px-6 py-4 text-white sm:px-8">
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-emerald-300">UniAce Mastery Hub</div>
                <div className="mt-1 text-xl font-black sm:text-2xl">AI Academic Tutor</div>
                <div className="mt-1 text-xs text-slate-300">Administrator-approved isolated demonstration response</div>
              </div>
              <div className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-3 py-1.5 text-[11px] font-bold text-emerald-200">
                {activeTutorPreview.providerUsed || 'Provider not reported'}
                {typeof activeTutorPreview.latencyMs === 'number' ? ` · ${Math.round(activeTutorPreview.latencyMs)} ms` : ''}
              </div>
            </header>
            <div className="space-y-5 p-6 sm:p-8">
              {activeTutorPreview.courseContext && (
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                  {activeTutorPreview.courseContext}
                </div>
              )}
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-5 py-4">
                <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700">Question</div>
                <p className="mt-2 text-base font-semibold leading-7 text-slate-900 sm:text-lg">{activeTutorPreview.prompt}</p>
              </div>
              <div className="max-h-[52vh] overflow-hidden whitespace-pre-wrap text-sm leading-7 text-slate-800 sm:text-base sm:leading-8">
                {activeTutorPreview.response}
              </div>
            </div>
            <footer className="border-t border-slate-200 bg-slate-50 px-6 py-3 text-center text-[10px] font-semibold text-slate-500 sm:px-8">
              Isolated admin preview · No student chat request · No student Sparks charged
            </footer>
          </article>
        </div>
      )}
    </DemoReelContext.Provider>
  );
}

export function useDemoReel() {
  const context = useContext(DemoReelContext);
  if (!context) {
    throw new Error('useDemoReel must be used within a DemoReelProvider');
  }
  return context;
}
