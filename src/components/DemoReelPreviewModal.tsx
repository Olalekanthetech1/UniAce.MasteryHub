import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useDemoReel } from '../context/DemoReelContext';
import { Download, X, Copy, Check, Video, Share2, Sparkles, Play, Repeat, Clock, FileVideo, Globe, Send, MessageCircle, Camera } from 'lucide-react';
import toast from 'react-hot-toast';

export default function DemoReelPreviewModal() {
  const {
    isModalOpen,
    closePreviewModal,
    recordedVideoUrl,
    recordedBlob,
    recordedDuration,
    recordingSource,
    recordedFileName,
    recordedVideoDimensions,
    currentScenario,
    downloadReel,
    startDemoReel,
    selectedScenarioId
  } = useDemoReel();

  const [activeTab, setActiveTab] = useState<'twitter' | 'linkedin' | 'tiktok' | 'whatsapp'>('twitter');
  const [copiedTab, setCopiedTab] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [isCapturingFrame, setIsCapturingFrame] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  if (!isModalOpen || !recordedVideoUrl) return null;

  const fileSizeMB = recordedBlob ? (recordedBlob.size / (1024 * 1024)).toFixed(2) : null;
  const recordingFormat = recordedBlob?.type?.trim() || null;
  const captions = currentScenario?.captions || null;
  const activeCaption = recordingSource === 'imported' ? '' : captions?.[activeTab]?.trim() || '';

  const handleCopyCaption = async (platform: 'twitter' | 'linkedin' | 'tiktok' | 'whatsapp') => {
    const textToCopy = captions?.[platform]?.trim();
    if (!textToCopy) {
      toast.error('No scenario caption is available to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedTab(platform);
      toast.success(`Copied ${platform.toUpperCase()} caption to clipboard!`);
      setTimeout(() => setCopiedTab(null), 2500);
    } catch {
      toast.error('Clipboard access failed. Select and copy the caption manually.');
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  const handleCaptureCurrentFrame = () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth < 1 || video.videoHeight < 1) {
      toast.error('The recording frame is not ready yet. Play the video and try again.');
      return;
    }

    setIsCapturingFrame(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas capture is unavailable in this browser.');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          setIsCapturingFrame(false);
          toast.error('The current video frame could not be encoded as PNG.');
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `uniace-demo-frame-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setIsCapturingFrame(false);
        toast.success('Current demo frame exported as a PNG screenshot.');
      }, 'image/png');
    } catch (error: any) {
      setIsCapturingFrame(false);
      toast.error(error?.message || 'The current frame could not be captured.');
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] shadow-2xl max-w-5xl w-full overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-6 sm:px-8 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-rose-500/10 text-rose-500 rounded-2xl">
                <Video size={24} />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                  🎬 Demo Recording Preview
                  <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200 font-bold uppercase tracking-wider">
                    {recordingSource === 'imported' ? 'Imported local video' : 'Browser capture'}
                  </span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {recordingSource === 'imported' ? recordedFileName || 'Imported video' : currentScenario?.name || 'Scenario metadata unavailable'}
                </p>
              </div>
            </div>

            <button
              onClick={closePreviewModal}
              className="p-2.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 sm:p-8 overflow-y-auto space-y-8 flex-1">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Column: Video Player & Controls */}
              <div className="lg:col-span-7 space-y-4">
                <div className="relative rounded-3xl overflow-hidden bg-black border border-slate-800 shadow-xl aspect-video flex items-center justify-center group">
                  <video
                    ref={videoRef}
                    src={recordedVideoUrl}
                    controls
                    autoPlay
                    loop={isLooping}
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* Video Info Bar */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 text-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Duration</span>
                    <span className="text-sm font-black text-slate-800 dark:text-slate-200 font-mono">
                      {recordedDuration}s
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 text-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">File Size</span>
                    <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 font-mono">
                      {fileSizeMB ? `${fileSizeMB} MB` : 'Unavailable'}
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 text-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Format</span>
                    <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono">
                      {recordingFormat || 'Unavailable'}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 text-center">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Dimensions</span>
                    <span className="text-sm font-black text-slate-800 dark:text-slate-200 font-mono">
                      {recordedVideoDimensions ? `${recordedVideoDimensions.width} × ${recordedVideoDimensions.height}` : 'Unavailable'}
                    </span>
                  </div>
                </div>

                {/* Speed & Loop playback options */}
                <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/50 dark:border-slate-700/50 text-xs font-bold text-slate-600 dark:text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400 mr-1">Speed:</span>
                    {[0.75, 1, 1.25, 1.5, 2].map((s) => (
                      <button
                        key={s}
                        onClick={() => handleSpeedChange(s)}
                        className={`px-2 py-1 rounded-lg transition-all ${
                          playbackSpeed === s
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {s}x
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => setIsLooping(!isLooping)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg transition-all ${
                      isLooping
                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                        : 'bg-white dark:bg-slate-800 text-slate-400'
                    }`}
                  >
                    <Repeat size={13} />
                    <span>Loop {isLooping ? 'On' : 'Off'}</span>
                  </button>
                </div>

                {/* Primary Download Button */}
                <button
                  onClick={() => downloadReel()}
                  className="w-full py-4 px-6 rounded-2xl font-black text-sm bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white shadow-xl shadow-indigo-500/25 transition-all active:scale-95 flex items-center justify-center gap-3"
                >
                  <Download size={20} />
                  <span>Download Demo Reel ({recordedBlob?.type?.toLowerCase().includes('mp4') ? '.mp4' : '.webm'})</span>
                </button>
                <button
                  type="button"
                  onClick={handleCaptureCurrentFrame}
                  disabled={isCapturingFrame}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-3 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 flex items-center justify-center gap-2"
                >
                  <Camera size={16} />
                  {isCapturingFrame ? 'Capturing PNG frame…' : 'Capture current video frame (PNG)'}
                </button>
              </div>

              {/* Right Column: Pre-written Social Media Captions */}
              <div className="lg:col-span-5 space-y-6">
                <div className="bg-slate-50 dark:bg-slate-800/40 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-700/80 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                      <Share2 size={16} className="text-indigo-500" />
                      Scenario Captions
                    </h3>
                    <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                      Review before publishing
                    </span>
                  </div>

                  {/* Tabs */}
                  <div className="flex rounded-xl bg-slate-200/70 dark:bg-slate-800 p-1 gap-1">
                    {(['twitter', 'linkedin', 'tiktok', 'whatsapp'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                          activeTab === tab
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {tab === 'twitter' ? '𝕏 Post' : tab}
                      </button>
                    ))}
                  </div>

                  {/* Caption Content */}
                  <div className="relative bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 font-sans leading-relaxed whitespace-pre-wrap min-h-[160px] max-h-[220px] overflow-y-auto">
                    {recordingSource === 'imported' ? 'This is an imported video. Scenario captions are not attached automatically; review and write captions for this footage separately.' : activeCaption || 'No reviewed caption is available for this recording.'}
                  </div>

                  {/* Copy Button */}
                  <button
                    onClick={() => void handleCopyCaption(activeTab)}
                    disabled={!activeCaption}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs transition-all flex items-center justify-center gap-2 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {copiedTab === activeTab ? (
                      <>
                        <Check size={16} className="text-emerald-500" />
                        <span>Caption Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy size={16} />
                        <span>Copy {activeTab.toUpperCase()} Caption</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Pro Tips Card */}
                <div className="p-5 rounded-3xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/40 text-xs space-y-2">
                  <h4 className="font-bold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
                    <Sparkles size={15} className="text-indigo-500" />
                    Social Media Video Tips
                  </h4>
                  <ul className="text-indigo-800/80 dark:text-indigo-300/80 space-y-1.5 list-disc pl-4">
                    <li>Review every factual claim and audience restriction before publishing.</li>
                    <li>Keep the QR destination aligned with the verified campaign URL.</li>
                    <li>Use institution-approved logos, music and distribution channels.</li>
                  </ul>
                </div>

              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 sm:px-8 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
            <span>{recordingSource === 'imported' ? 'Imported locally in this browser · Not uploaded to UniAce' : 'Recorded in this browser using MediaRecorder'}</span>
            <button
              onClick={closePreviewModal}
              className="px-5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold transition-colors"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
