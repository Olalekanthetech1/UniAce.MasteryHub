import React, { createContext, useContext, useState, useRef, useEffect, useCallback, ReactNode } from 'react';
import { View } from '../types';
import { DemoScenario, DemoStep } from '../services/demoReelService';
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
  isModalOpen: boolean;
  selectedScenarioId: string;
  screenCaptureSupported: boolean;
  activeSimulatedQuery: string | null;
  setSelectedScenarioId: (id: string) => void;
  startDemoReel: (scenario: DemoScenario, navigateCallback?: (view: View) => void, onSimulateChat?: (prompt: string) => void) => Promise<boolean>;
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
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const [activeSimulatedQuery, setActiveSimulatedQuery] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const stepTimeoutRef = useRef<any>(null);
  const navigateFnRef = useRef<((view: View) => void) | null>(null);
  const simulateChatFnRef = useRef<((prompt: string) => void) | null>(null);
  const startTimeRef = useRef<number>(0);

  const screenCaptureSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  const currentStep = currentScenario && currentScenario.steps[currentStepIndex] ? currentScenario.steps[currentStepIndex] : null;

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

    // 1. Programmatically navigate to target view
    if (navigateFnRef.current) {
      navigateFnRef.current(step.view);
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('navigate', { detail: step.view }));
    }

    // 2. If step includes simulated chat query, trigger simulation
    if (step.demoPrompt) {
      setActiveSimulatedQuery(step.demoPrompt);
      if (simulateChatFnRef.current) {
        setTimeout(() => {
          simulateChatFnRef.current?.(step.demoPrompt!);
        }, 1200);
      } else if (typeof window !== 'undefined') {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('uniace:demo-query', {
              detail: { prompt: step.demoPrompt, courseId: step.courseId },
            })
          );
        }, 1200);
      }
    } else {
      setActiveSimulatedQuery(null);
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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
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
    setCurrentStepIndex(0);
    setElapsedSeconds(0);
    setActiveSimulatedQuery(null);
    toast('Demo reel cancelled', { icon: '🛑' });
  }, []);

  const stopAndSaveReel = useCallback(async () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    if (stepTimeoutRef.current) clearTimeout(stepTimeoutRef.current);
    const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
    setRecordedDuration(duration);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    setIsRecording(false);
    setIsPaused(false);
    setActiveSimulatedQuery(null);
    toast.success('🎬 Demo Reel recorded successfully! Ready to export & download.');
  }, []);

  const startDemoReel = useCallback(async (
    scenario: DemoScenario,
    navigateCallback?: (view: View) => void,
    onSimulateChat?: (prompt: string) => void
  ): Promise<boolean> => {
    if (!scenario || !Array.isArray(scenario.steps) || scenario.steps.length === 0) {
      toast.error('A verified Demo Studio scenario is required before recording.');
      return false;
    }
    if (scenario.requiresReview) {
      toast.error('This AI-generated demo script requires administrator review before recording.');
      return false;
    }
    setSelectedScenarioId(scenario.id);
    setCurrentScenario(scenario);
    if (navigateCallback) navigateFnRef.current = navigateCallback;
    if (onSimulateChat) simulateChatFnRef.current = onSimulateChat;

    chunksRef.current = [];
    setRecordedBlob(null);
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

      // Detect if user stops screen sharing via browser native floating button
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (isRecording) {
            stopAndSaveReel();
          }
        };
      }

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
        const fullBlob = new Blob(chunksRef.current, { type: selectedMime });
        setRecordedBlob(fullBlob);
        const url = URL.createObjectURL(fullBlob);
        setRecordedVideoUrl(url);
        setIsModalOpen(true);
      };

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
    const defaultName = `uniace-${currentScenario?.id || 'demo'}-reel-${new Date().toISOString().slice(0, 10)}.webm`;
    const finalName = filename || defaultName;
    const downloadUrl = recordedVideoUrl || URL.createObjectURL(recordedBlob);
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`📥 Downloaded ${finalName}!`);
  }, [recordedBlob, recordedVideoUrl, currentScenario]);

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
        isModalOpen,
        selectedScenarioId,
        screenCaptureSupported,
        activeSimulatedQuery,
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
