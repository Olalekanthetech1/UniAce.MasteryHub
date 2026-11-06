import React, { useState, useEffect, useRef, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import toast from 'react-hot-toast';
import { renderElementToCanvasSafe } from '../../utils/html2canvasSafe';
import {
  Sparkles,
  Download,
  FileText,
  RefreshCw,
  Upload,
  Check,
  Copy,
  Globe,
  Phone,
  Layers,
  Sliders,
  Eye,
  Share2,
  BookOpen,
  MessageSquare,
  FileQuestion,
  Brain,
  Zap,
  Clock,
  FolderOpen,
  Calendar,
  Sigma,
  Mic,
  Trophy,
  GraduationCap,
  ChevronRight,
  Headphones,
  Wifi,
  BatteryCharging,
  Signal,
  Home,
  Library,
  User,
} from 'lucide-react';
import { useMarketingSnapshot } from '../../hooks/useMarketingSnapshot';
import { toMarketingCourseMap } from '../../services/marketingSnapshot';
import {
  DynamicCapabilityItem,
  DynamicFlyerConfig,
  MarketingTargetScope,
  PlatformMarketingContext,
  buildDynamicFlyerConfig,
  synthesizeFlyerWithAI,
} from '../../services/demoReelService';
import { generateQrMatrix } from '../../utils/qrCodeSvg';

const THEME_PALETTES = {
  emerald_gold: {
    name: 'UniAce Emerald & Gold',
    topBg: '#f6faf7',
    accentText: '#0d7a3e',
    darkHeadline: '#0b2919',
    deckGradient: 'linear-gradient(160deg, #0b6b37 0%, #064e28 55%, #04351b 100%)',
    footerStripBg: '#032613',
    ctaBg: '#f4b928',
    ctaText: '#062814',
    scriptColor: '#0d6835',
  },
  royal_indigo: {
    name: 'Royal Academic Indigo',
    topBg: '#f6f8fc',
    accentText: '#3730a3',
    darkHeadline: '#0f172a',
    deckGradient: 'linear-gradient(160deg, #1e1b4b 0%, #1e3a8a 55%, #0f172a 100%)',
    footerStripBg: '#090d16',
    ctaBg: '#f59e0b',
    ctaText: '#0f172a',
    scriptColor: '#3730a3',
  },
  cyber_slate: {
    name: 'Prestige Slate & Teal',
    topBg: '#f4f7f8',
    accentText: '#0f766e',
    darkHeadline: '#091518',
    deckGradient: 'linear-gradient(160deg, #0f524d 0%, #0b3b3c 55%, #072227 100%)',
    footerStripBg: '#041518',
    ctaBg: '#fbbf24',
    ctaText: '#041518',
    scriptColor: '#0f766e',
  },
};


type FlyerExportFormat = 'square' | 'vertical' | 'landscape';

const FLYER_EXPORT_SIZES: Record<FlyerExportFormat, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: '1:1 Square · 1080 × 1080' },
  vertical: { width: 1080, height: 1920, label: '9:16 Vertical · 1080 × 1920' },
  landscape: { width: 1920, height: 1080, label: '16:9 Landscape · 1920 × 1080' },
};

function drawWrappedCanvasText(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return y;
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length > 0) {
    let last = visible[visible.length - 1];
    while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    visible[visible.length - 1] = `${last.trimEnd()}…`;
  }

  visible.forEach((text, index) => ctx.fillText(text, x, y + index * lineHeight, maxWidth));
  return y + visible.length * lineHeight;
}

function drawCanvasQr(
  ctx: CanvasRenderingContext2D,
  matrix: boolean[][],
  x: number,
  y: number,
  size: number
): void {
  if (!matrix.length || matrix.some((row) => row.length !== matrix.length)) {
    throw new Error('A verified QR matrix is required for this export.');
  }
  const quietZone = 4;
  const moduleCount = matrix.length + quietZone * 2;
  const moduleSize = size / moduleCount;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = '#061b12';
  matrix.forEach((row, rowIndex) => {
    row.forEach((dark, columnIndex) => {
      if (dark) {
        ctx.fillRect(
          x + (columnIndex + quietZone) * moduleSize,
          y + (rowIndex + quietZone) * moduleSize,
          Math.ceil(moduleSize),
          Math.ceil(moduleSize)
        );
      }
    });
  });
}

function composeFlyerExport(
  source: HTMLCanvasElement,
  format: FlyerExportFormat,
  config: DynamicFlyerConfig,
  qrMatrix: boolean[][],
  palette: {
    topBg: string;
    accentText: string;
    darkHeadline: string;
    footerStripBg: string;
    ctaBg: string;
    ctaText: string;
  }
): HTMLCanvasElement {
  const size = FLYER_EXPORT_SIZES[format];
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable in this browser.');

  ctx.fillStyle = palette.topBg;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.textBaseline = 'top';

  if (format === 'vertical') {
    ctx.fillStyle = palette.footerStripBg;
    ctx.fillRect(0, 0, size.width, 156);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px Arial, sans-serif';
    ctx.fillText('UniAce Mastery Hub', 58, 38, 960);
    ctx.fillStyle = '#d1fae5';
    ctx.font = '600 20px Arial, sans-serif';
    ctx.fillText(config.brandSubline.filter(Boolean).join('  •  '), 60, 98, 960);

    const marginX = 54;
    const top = 176;
    const bottom = 1748;
    const scale = Math.min((size.width - marginX * 2) / source.width, (bottom - top) / source.height);
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    ctx.drawImage(source, (size.width - drawWidth) / 2, top + (bottom - top - drawHeight) / 2, drawWidth, drawHeight);

    ctx.fillStyle = palette.footerStripBg;
    ctx.fillRect(0, 1770, size.width, 150);
    ctx.fillStyle = palette.ctaBg;
    ctx.fillRect(54, 1800, 310, 64);
    ctx.fillStyle = palette.ctaText;
    ctx.font = '900 25px Arial, sans-serif';
    ctx.fillText(config.ctaText, 76, 1818, 270);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 23px Arial, sans-serif';
    ctx.fillText(config.websiteDisplayUrl, 396, 1817, 625);
    return canvas;
  }

  if (format === 'square') {
    const margin = 34;
    const drawHeight = 1012;
    const scale = drawHeight / source.height;
    const drawWidth = source.width * scale;
    ctx.drawImage(source, margin, (size.height - drawHeight) / 2, drawWidth, drawHeight);

    const rightX = margin + drawWidth + 28;
    const rightWidth = size.width - rightX - margin;
    ctx.fillStyle = palette.footerStripBg;
    ctx.fillRect(rightX - 12, 28, rightWidth + 22, 1024);

    ctx.fillStyle = '#d1fae5';
    ctx.font = '800 17px Arial, sans-serif';
    ctx.fillText('UNIACE MASTERY HUB', rightX + 8, 66, rightWidth - 16);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 29px Arial, sans-serif';
    let y = drawWrappedCanvasText(ctx, config.headlineLine1, rightX + 8, 126, rightWidth - 18, 36, 3);
    ctx.fillStyle = '#6ee7b7';
    y = drawWrappedCanvasText(ctx, config.headlineLine2, rightX + 8, y + 4, rightWidth - 18, 36, 4);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 16px Arial, sans-serif';
    y = drawWrappedCanvasText(ctx, config.leadBoldParagraph, rightX + 8, y + 18, rightWidth - 18, 23, 5);

    const qrSize = Math.min(224, rightWidth - 22);
    const qrX = rightX + (rightWidth - qrSize) / 2;
    drawCanvasQr(ctx, qrMatrix, qrX, 706, qrSize);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 14px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SCAN TO EXPLORE', rightX + rightWidth / 2, 948, rightWidth - 12);
    ctx.font = '600 13px Arial, sans-serif';
    ctx.fillText(config.websiteDisplayUrl, rightX + rightWidth / 2, 975, rightWidth - 12);
    ctx.textAlign = 'left';
    return canvas;
  }

  // Landscape: preserve the designed portrait artwork and use the wide canvas
  // for legible campaign messaging, a large QR code and the verified contact.
  const margin = 34;
  const drawHeight = 1012;
  const scale = drawHeight / source.height;
  const drawWidth = source.width * scale;
  ctx.drawImage(source, margin, (size.height - drawHeight) / 2, drawWidth, drawHeight);

  const contentX = margin + drawWidth + 54;
  const qrSize = 274;
  const qrX = size.width - margin - qrSize;
  const contentWidth = qrX - contentX - 42;

  ctx.fillStyle = palette.footerStripBg;
  ctx.fillRect(contentX - 28, 34, size.width - contentX + 28, size.height - 68);
  ctx.fillStyle = '#a7f3d0';
  ctx.font = '900 20px Arial, sans-serif';
  ctx.fillText('UNIACE MASTERY HUB', contentX, 86, contentWidth);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 64px Arial, sans-serif';
  let y = drawWrappedCanvasText(ctx, config.headlineLine1, contentX, 160, contentWidth, 74, 3);
  ctx.fillStyle = '#6ee7b7';
  y = drawWrappedCanvasText(ctx, config.headlineLine2, contentX, y + 4, contentWidth, 74, 3);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 27px Arial, sans-serif';
  y = drawWrappedCanvasText(ctx, config.leadBoldParagraph, contentX, y + 28, contentWidth, 38, 4);
  ctx.fillStyle = '#d1d5db';
  ctx.font = '500 21px Arial, sans-serif';
  y = drawWrappedCanvasText(ctx, config.subParagraph, contentX, y + 20, contentWidth, 30, 4);

  ctx.fillStyle = palette.ctaBg;
  ctx.fillRect(contentX, 870, Math.min(360, contentWidth), 74);
  ctx.fillStyle = palette.ctaText;
  ctx.font = '900 28px Arial, sans-serif';
  ctx.fillText(config.ctaText, contentX + 22, 892, Math.min(320, contentWidth - 30));

  drawCanvasQr(ctx, qrMatrix, qrX, 650, qrSize);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '900 16px Arial, sans-serif';
  ctx.fillText('SCAN TO EXPLORE', qrX + qrSize / 2, 940, qrSize);
  ctx.font = '600 14px Arial, sans-serif';
  ctx.fillText(config.websiteDisplayUrl, qrX + qrSize / 2, 970, qrSize);
  ctx.textAlign = 'left';

  if (config.supportContact) {
    ctx.fillStyle = '#d1fae5';
    ctx.font = '600 16px Arial, sans-serif';
    ctx.fillText(config.supportContact, contentX, 974, Math.max(0, contentWidth));
  }
  return canvas;
}



function renderCapabilityIcon(iconKey: DynamicCapabilityItem['iconKey'], size = 18) {
  switch (iconKey) {
    case 'ai-tutor':
      return <MessageSquare size={size} className="text-white" />;
    case 'notes-chat':
      return <BookOpen size={size} className="text-white" />;
    case 'quiz-gen':
      return <FileQuestion size={size} className="text-white" />;
    case 'theory-eval':
      return <Brain size={size} className="text-white" />;
    case 'flashcards':
      return <Zap size={size} className="text-white" />;
    case 'exam-mode':
      return <Clock size={size} className="text-white" />;
    case 'notebook':
      return <FolderOpen size={size} className="text-white" />;
    case 'study-planner':
      return <Calendar size={size} className="text-white" />;
    case 'formulas':
      return <Sigma size={size} className="text-white" />;
    case 'voice-tutor':
      return <Mic size={size} className="text-white" />;
    case 'arena':
      return <Trophy size={size} className="text-white" />;
    case 'course-hub':
    default:
      return <GraduationCap size={size} className="text-white" />;
  }
}

export default function DynamicFlyerStudio() {
  const { snapshot, loading: snapshotLoading, error: snapshotError, refresh: refreshSnapshot } = useMarketingSnapshot();
  const courses = useMemo(() => snapshot ? toMarketingCourseMap(snapshot) : {}, [snapshot]);
  const faculties = snapshot?.institution.faculties || [];
  const departments = snapshot?.institution.departments || [];
  const departmentToFaculty = snapshot?.institution.departmentToFaculty || {};
  const featureSwitches = snapshot?.featureSwitches.status === 'configured'
    ? snapshot.featureSwitches.values
    : null;
  const supportConfig = useMemo(() => snapshot?.support.status === 'configured'
    ? {
        whatsappSupport: snapshot.support.whatsappSupport || undefined,
        contactEmail: snapshot.support.contactEmail || undefined
      }
    : null, [snapshot]);
  const [targetScope, setTargetScope] = useState<MarketingTargetScope>('full_ecosystem');
  const [selectedFaculty, setSelectedFaculty] = useState<string>('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [customCampaignAngle, setCustomCampaignAngle] = useState<string>('');

  const [isSynthesizingAI, setIsSynthesizingAI] = useState(false);
  const [copyReviewRequired, setCopyReviewRequired] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportFormat, setExportFormat] = useState<FlyerExportFormat>('vertical');
  const [activeCaptionTab, setActiveCaptionTab] = useState<'whatsapp' | 'twitter' | 'linkedin' | 'tiktok'>('whatsapp');
  const [copiedCaption, setCopiedCaption] = useState<string | null>(null);

  const posterRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const courseList = useMemo(() => Object.values(courses || {}), [courses]);

  // Ensure sensible initial selection when switching scope
  useEffect(() => {
    if (!selectedFaculty && faculties.length > 0) {
      setSelectedFaculty(faculties[0]);
    }
    if (!selectedDepartment && departments.length > 0) {
      setSelectedDepartment(departments[0]);
    }
    if (!selectedCourseId && courseList.length > 0) {
      setSelectedCourseId(courseList[0].id);
    }
  }, [faculties, departments, courseList, selectedFaculty, selectedDepartment, selectedCourseId]);

  const marketingContext: PlatformMarketingContext = useMemo(
    () => ({
      courses,
      faculties,
      departments,
      departmentToFaculty,
      featureSwitches,
      supportConfig,
      liveOrigin: typeof window !== 'undefined' ? window.location.origin : undefined,
      formulaCountsVerified: snapshot?.totals.formulasVerified === true,
      targetScope,
      selectedFaculty,
      selectedDepartment,
      selectedCourseId,
    }),
    [
      courses,
      faculties,
      departments,
      departmentToFaculty,
      featureSwitches,
      supportConfig,
      snapshot,
      targetScope,
      selectedFaculty,
      selectedDepartment,
      selectedCourseId,
    ]
  );

  const [flyerConfig, setFlyerConfig] = useState<DynamicFlyerConfig | null>(null);

  useEffect(() => {
    if (!snapshot) {
      setFlyerConfig(null);
      return;
    }
    setFlyerConfig((prev) => {
      const next = buildDynamicFlyerConfig(marketingContext);
      return prev
        ? {
            ...next,
            themeId: prev.themeId,
            studentPortraitMode: prev.studentPortraitMode,
            customPhotoDataUrl: prev.customPhotoDataUrl,
          }
        : next;
    });
  }, [marketingContext, snapshot]);

  const enabledCapabilities = useMemo(
    () => (flyerConfig?.capabilities || []).filter((c) => c.enabled).slice(0, 8),
    [flyerConfig?.capabilities]
  );

  const qrResult = useMemo(() => {
    if (!flyerConfig?.qrTargetUrl?.trim()) {
      return { matrix: [] as boolean[][], error: 'Enter a valid HTTP(S) destination for the QR code.' };
    }
    try {
      const destination = new URL(flyerConfig.qrTargetUrl);
      if (!['http:', 'https:'].includes(destination.protocol) || !destination.hostname) {
        throw new Error('QR destination must use HTTP or HTTPS.');
      }
      return { matrix: generateQrMatrix(destination.toString()), error: null as string | null };
    } catch (error: any) {
      return {
        matrix: [] as boolean[][],
        error: error?.message || 'QR destination could not be encoded.'
      };
    }
  }, [flyerConfig?.qrTargetUrl]);
  const qrMatrix = qrResult.matrix;

  const palette = THEME_PALETTES[flyerConfig?.themeId || 'emerald_gold'] || THEME_PALETTES.emerald_gold;

  if (snapshotLoading || !snapshot || !flyerConfig) {
    return (
      <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 space-y-4">
        <div className="flex items-center gap-3">
          <RefreshCw size={20} className={snapshotError ? 'text-amber-600' : 'text-emerald-600 animate-spin'} />
          <h3 className="text-base font-black text-slate-900 dark:text-white">
            {snapshotError ? 'Marketing evidence unavailable' : 'Verifying live marketing data'}
          </h3>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {snapshotError || 'Loading published course visibility, academic-level availability, feature switches and approved contact settings.'}
        </p>
        {snapshotError && (
          <button type="button" onClick={() => void refreshSnapshot()} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold">
            Retry verification
          </button>
        )}
      </div>
    );
  }

  const handleToggleCapability = (id: string) => {
    setFlyerConfig((prev) => {
      if (!prev) return prev;
      const target = prev.capabilities.find((c) => c.id === id);
      if (!target) return prev;
      if (!target.enabled && target.availability !== 'data_available') {
        toast.error('This capability is implemented in the app, but its live operation has not been verified for marketing.');
        return prev;
      }
      const currentEnabledCount = prev.capabilities.filter((c) => c.enabled).length;
      if (!target.enabled && currentEnabledCount >= 8) {
        toast.error('Maximum 8 capabilities can be displayed on the poster at once. Disable one first.');
        return prev;
      }
      return {
        ...prev,
        capabilities: prev.capabilities.map((c) =>
          c.id === id ? { ...c, enabled: !c.enabled } : c
        ),
      };
    });
  };

  const handleSynthesizeWithAI = async () => {
    setIsSynthesizingAI(true);
    try {
      const updated = await synthesizeFlyerWithAI(
        marketingContext,
        flyerConfig,
        customCampaignAngle
      );
      setFlyerConfig(updated);
      setCopyReviewRequired(true);
      toast.success('AI marketing draft created. Review every claim before exporting.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to synthesize campaign copy with AI.');
    } finally {
      setIsSynthesizingAI(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('Please select a PNG, JPG or WebP image.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Please use an image smaller than 8 MB to keep flyer rendering reliable.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error('The selected photo could not be read.');
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setFlyerConfig((prev) => ({
          ...prev,
          studentPortraitMode: 'custom_photo',
          customPhotoDataUrl: reader.result as string,
        }));
        toast.success('Custom campus student portrait applied!');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleExportPng = async () => {
    if (!flyerConfig.campaignReady) {
      toast.error(flyerConfig.blockingReasons.join(' '));
      return;
    }
    if (copyReviewRequired) {
      toast.error('Review and approve the AI-generated copy before exporting.');
      return;
    }
    if (qrResult.error || qrMatrix.length === 0) {
      toast.error(qrResult.error || 'A verified QR matrix is required for export.');
      return;
    }
    if (!posterRef.current) return;
    setIsExportingPng(true);
    try {
      const source = await renderElementToCanvasSafe(posterRef.current, {
        scale: 2.5,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: palette.topBg,
      });
      const canvas = composeFlyerExport(source, exportFormat, flyerConfig, qrMatrix, palette);
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      const link = document.createElement('a');
      const scopeSlug =
        targetScope === 'course' && selectedCourseId
          ? selectedCourseId
          : targetScope === 'department' && selectedDepartment
            ? selectedDepartment.toLowerCase().replace(/\s+/g, '-')
            : targetScope === 'faculty' && selectedFaculty
              ? selectedFaculty.toLowerCase().replace(/\s+/g, '-')
              : targetScope;
      link.download = `uniace-flyer-${scopeSlug}-${exportFormat}-${new Date().toISOString().slice(0, 10)}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`PNG exported at ${FLYER_EXPORT_SIZES[exportFormat].width} × ${FLYER_EXPORT_SIZES[exportFormat].height}px.`);
    } catch (err: any) {
      console.error('Flyer PNG export failed:', err);
      toast.error(err?.message || 'Could not export PNG flyer. Please try again.');
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleExportPdf = async () => {
    if (!flyerConfig.campaignReady) {
      toast.error(flyerConfig.blockingReasons.join(' '));
      return;
    }
    if (copyReviewRequired) {
      toast.error('Review and approve the AI-generated copy before exporting.');
      return;
    }
    if (qrResult.error) {
      toast.error(qrResult.error);
      return;
    }
    if (!posterRef.current) return;
    setIsExportingPdf(true);
    try {
      const canvas = await renderElementToCanvasSafe(posterRef.current, {
        scale: 3.25,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: palette.topBg,
      });
      const imgData = canvas.toDataURL('image/png', 1.0);
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imageRatio = canvas.width / canvas.height;
      const pageRatio = pdfWidth / pdfHeight;
      const drawWidth = imageRatio > pageRatio ? pdfWidth : pdfHeight * imageRatio;
      const drawHeight = imageRatio > pageRatio ? pdfWidth / imageRatio : pdfHeight;
      pdf.addImage(
        imgData,
        'PNG',
        (pdfWidth - drawWidth) / 2,
        (pdfHeight - drawHeight) / 2,
        drawWidth,
        drawHeight,
        undefined,
        'FAST'
      );
      const scopeSlug =
        targetScope === 'course' && selectedCourseId
          ? selectedCourseId
          : targetScope;
      pdf.save(`uniace-poster-${scopeSlug}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success('A4 PDF exported with preserved artwork proportions at approximately 300 DPI.');
    } catch (err: any) {
      console.error('Flyer PDF export failed:', err);
      toast.error('Could not export PDF poster. Please try again.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleCopyCaption = (tab: 'whatsapp' | 'twitter' | 'linkedin' | 'tiktok') => {
    if (qrResult.error) {
      toast.error(qrResult.error);
      return;
    }
    if (copyReviewRequired) {
      toast.error('Review and approve the AI-generated campaign copy before copying it.');
      return;
    }
    navigator.clipboard.writeText(flyerConfig.captions[tab]);
    setCopiedCaption(tab);
    toast.success(`Copied ${tab.toUpperCase()} campaign caption!`);
    setTimeout(() => setCopiedCaption(null), 2500);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
      {/* LEFT PANEL: Live Dynamic Controls & AI Campaign Builder */}
      <div className="xl:col-span-5 space-y-6">
        {/* 1. Dynamic Campaign Target Scope */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 space-y-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Layers size={18} className="text-emerald-600 dark:text-emerald-400" />
                1. Dynamic Campaign Scope
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Resolves live courses ({courseList.length}), departments ({departments.length}), and active switches automatically.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(
              [
                { id: 'full_ecosystem', label: 'Full Platform' },
                { id: 'department', label: 'Department' },
                { id: 'faculty', label: 'Faculty' },
                { id: 'course', label: 'Specific Course' },
                { id: 'exam_readiness', label: 'Exam Blitz' },
              ] as { id: MarketingTargetScope; label: string }[]
            ).map((scope) => (
              <button
                key={scope.id}
                onClick={() => setTargetScope(scope.id)}
                className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all border text-left ${
                  targetScope === scope.id
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-400'
                }`}
              >
                {scope.label}
              </button>
            ))}
          </div>

          {targetScope === 'faculty' && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Select Live Faculty ({faculties.length} configured)
              </label>
              <select
                value={selectedFaculty}
                onChange={(e) => setSelectedFaculty(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white"
              >
                {faculties.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetScope === 'department' && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Select Live Department ({departments.length} configured)
              </label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white"
              >
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetScope === 'course' && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Select live course offering ({courseList.length} in catalog)
              </label>
              <select
                value={selectedCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white"
              >
                {courseList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} — {c.title} ({c.department})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Live AI Campaign Synthesis */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-700/60 space-y-3">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
              Campaign Angle / Audience Prompt (Optional for AI Copywriter)
            </label>
            <input
              type="text"
              value={customCampaignAngle}
              onChange={(e) => setCustomCampaignAngle(e.target.value)}
              placeholder="e.g., First-Semester Exam Prep, Fresher Orientation, Engineering Society..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
            />
            <button
              onClick={handleSynthesizeWithAI}
              disabled={isSynthesizingAI}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs shadow-lg shadow-emerald-600/20 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSynthesizingAI ? (
                <>
                  <RefreshCw size={15} className="animate-spin" />
                  <span>Synthesizing Live Platform Copy with AI...</span>
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  <span>Synthesize Flyer Copy & Captions with Live AI</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 2. Active Platform Capabilities Picker */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Sliders size={18} className="text-indigo-500" />
                2. Active Platform Features ({enabledCapabilities.length}/8)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Only capabilities supported by the application are listed. Switch-gated and data-dependent items remain unavailable until verified.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
            {flyerConfig.capabilities.map((cap) => (
              <button
                key={cap.id}
                type="button"
                onClick={() => handleToggleCapability(cap.id)}
                className={`p-2.5 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
                  cap.enabled
                    ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-500/60 text-slate-900 dark:text-white'
                    : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-400'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: cap.accentHex }}
                  >
                    {renderCapabilityIcon(cap.iconKey, 13)}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-bold truncate">{cap.title}</span>
                    <span className="block text-[9px] font-semibold text-slate-400">
                      {cap.availability === 'implemented' ? 'Implemented view · runtime health not probed' :
                        cap.availability === 'switch_enabled' ? 'Feature switch enabled · runtime not probed' :
                        cap.availability === 'switch_disabled' ? 'Disabled by feature switch' :
                        cap.availability === 'data_available' ? 'Live supporting data verified' :
                        'Supporting data or configuration not verified'}
                    </span>
                  </span>
                </div>
                <span
                  className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    cap.enabled
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {cap.enabled ? '✓' : ''}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Fine-Tune Copy, URL, Theme & Student Portrait */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 space-y-4 shadow-sm">
          <h3 className="text-base font-black text-slate-900 dark:text-white">
            3. Customize Headlines, QR Link & Visual Theme
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">Headline Line 1</label>
              <input
                type="text"
                value={flyerConfig.headlineLine1}
                onChange={(e) => setFlyerConfig({ ...flyerConfig, headlineLine1: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase">Headline Line 2 (Accent)</label>
              <input
                type="text"
                value={flyerConfig.headlineLine2}
                onChange={(e) => setFlyerConfig({ ...flyerConfig, headlineLine2: e.target.value })}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-emerald-700 dark:text-emerald-400"
              />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase">Lead Value Proposition</label>
            <textarea
              rows={2}
              value={flyerConfig.leadBoldParagraph}
              onChange={(e) => setFlyerConfig({ ...flyerConfig, leadBoldParagraph: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-500 uppercase">Supporting Copy</label>
            <textarea
              rows={2}
              value={flyerConfig.subParagraph}
              onChange={(e) => setFlyerConfig({ ...flyerConfig, subParagraph: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
                <Globe size={12} /> Campaign Destination URL (admin override)
              </label>
              <input
                type="text"
                value={flyerConfig.websiteDisplayUrl}
                onChange={(e) => {
                  const val = e.target.value;
                  const candidate = val.trim();
                  let fullUrl = '';
                  try {
                    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
                    if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname) {
                      fullUrl = parsed.toString();
                    }
                  } catch {
                    fullUrl = '';
                  }
                  const oldUrl = flyerConfig.qrTargetUrl;
                  const updateCaptionUrl = (caption: string) =>
                    oldUrl ? caption.replaceAll(oldUrl, fullUrl) : caption;
                  setFlyerConfig({
                    ...flyerConfig,
                    websiteDisplayUrl: val,
                    qrTargetUrl: fullUrl,
                    captions: {
                      whatsapp: updateCaptionUrl(flyerConfig.captions.whatsapp),
                      twitter: updateCaptionUrl(flyerConfig.captions.twitter),
                      linkedin: updateCaptionUrl(flyerConfig.captions.linkedin),
                      tiktok: updateCaptionUrl(flyerConfig.captions.tiktok)
                    }
                  });
                }}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white"
              />
              <p className="mt-1 text-[10px] text-slate-500">
                Defaults to this deployed app origin. A manually entered destination is an administrator override; verify that it resolves to the official UniAce destination before sharing.
              </p>
              {qrResult.error && (
                <p className="mt-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400">{qrResult.error}</p>
              )}
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
                <Phone size={12} /> Support Line / Contact
              </label>
              <input
                type="text"
                value={flyerConfig.supportContact}
                readOnly
                aria-readonly="true"
                className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white"
              />
              <p className="mt-1 text-[10px] text-slate-500">Read-only: loaded from the saved Admin Support configuration. Update the official contact there.</p>
            </div>
          </div>

          {/* Theme Palette & Student Photo Upload */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1.5">
                Poster Color Palette
              </label>
              <div className="flex gap-2">
                {(['emerald_gold', 'royal_indigo', 'cyber_slate'] as const).map((tId) => (
                  <button
                    key={tId}
                    type="button"
                    onClick={() => setFlyerConfig({ ...flyerConfig, themeId: tId })}
                    className={`flex-1 py-2 px-2 rounded-xl text-[11px] font-bold border transition-all ${
                      flyerConfig.themeId === tId
                        ? 'border-slate-900 dark:border-white bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {tId === 'emerald_gold' ? 'Emerald' : tId === 'royal_indigo' ? 'Indigo' : 'Teal'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1.5">
                Campus Scholar Visual
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2 px-3 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Upload size={13} />
                  <span>Upload Photo</span>
                </button>
                {flyerConfig.customPhotoDataUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      setFlyerConfig({
                        ...flyerConfig,
                        studentPortraitMode: 'campus_scholar_svg',
                        customPhotoDataUrl: undefined,
                      })
                    }
                    className="py-2 px-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 text-xs font-bold"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 4. Social Media Captions Card */}
        <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 border border-slate-200 dark:border-slate-700 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Share2 size={16} className="text-emerald-600" />
              4. Dynamic Social Captions
            </h3>
            <span className="text-[11px] text-slate-400 font-semibold">Auto-synced with flyer</span>
          </div>

          <div className="flex rounded-xl bg-slate-100 dark:bg-slate-900 p-1 gap-1">
            {(['whatsapp', 'twitter', 'linkedin', 'tiktok'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveCaptionTab(tab)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                  activeCaptionTab === tab
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab === 'twitter' ? '𝕏 Post' : tab}
              </button>
            ))}
          </div>

          <textarea
            rows={5}
            value={flyerConfig.captions[activeCaptionTab]}
            onChange={(e) =>
              setFlyerConfig({
                ...flyerConfig,
                captions: { ...flyerConfig.captions, [activeCaptionTab]: e.target.value },
              })
            }
            className="w-full p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 leading-relaxed"
          />

          {copyReviewRequired && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 space-y-2">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                AI-generated copy is a draft. Verify every product, course, availability and pricing statement before approval.
              </p>
              <button
                type="button"
                onClick={() => setCopyReviewRequired(false)}
                className="px-3 py-2 rounded-lg bg-amber-700 text-white text-xs font-bold"
              >
                I have reviewed this campaign copy
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => handleCopyCaption(activeCaptionTab)}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            {copiedCaption === activeCaptionTab ? (
              <>
                <Check size={15} className="text-emerald-500" />
                <span>Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy size={15} />
                <span>Copy {activeCaptionTab.toUpperCase()} Caption</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* RIGHT PANEL: High-Resolution Live Poster Canvas & Export Bar */}
      <div className="xl:col-span-7 space-y-4">
        {/* Export Action Bar */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Eye size={18} className="text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">
              Live High-DPI Flyer Canvas
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600 dark:text-slate-300">
              PNG format
              <select
                value={exportFormat}
                onChange={(event) => setExportFormat(event.target.value as FlyerExportFormat)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-2 text-xs font-semibold text-slate-800 dark:text-white"
              >
                {Object.entries(FLYER_EXPORT_SIZES).map(([value, option]) => (
                  <option key={value} value={value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={handleExportPng}
              disabled={isExportingPng || isExportingPdf || !flyerConfig.campaignReady || copyReviewRequired || Boolean(qrResult.error)}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs shadow-md shadow-emerald-600/20 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              <Download size={15} />
              <span>{isExportingPng ? 'Rendering PNG...' : `Download ${exportFormat === 'square' ? 'Square' : exportFormat === 'vertical' ? 'Vertical' : 'Landscape'} PNG`}</span>
            </button>

            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isExportingPng || isExportingPdf || !flyerConfig.campaignReady || copyReviewRequired || Boolean(qrResult.error)}
              className="px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-white hover:bg-slate-800 text-white dark:text-slate-900 font-black text-xs shadow-md flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              <FileText size={15} />
              <span>{isExportingPdf ? 'Building PDF...' : 'Download Print PDF (A4 · 300 DPI)'}</span>
            </button>
          </div>
        </div>

        <p className="px-1 text-[11px] text-slate-500 dark:text-slate-400">
          Social PNG exports are composed at exact 1080 × 1080, 1080 × 1920 or 1920 × 1080 dimensions. The A4 PDF remains a separate portrait print layout.
        </p>
        {/* POSTER CANVAS WRAPPER */}
        {!flyerConfig.campaignReady && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-4">
            <p className="text-xs font-bold text-amber-900 dark:text-amber-200">Campaign export is blocked until the target data is verified.</p>
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-800 dark:text-amber-300">
              {flyerConfig.blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}

        {/* POSTER CANVAS WRAPPER */}
        <div className="w-full overflow-x-auto pb-4 flex justify-center">
          <div
            ref={posterRef}
            style={{
              width: '760px',
              minWidth: '760px',
              height: '1080px',
              backgroundColor: palette.topBg,
              fontFamily: "'Plus Jakarta Sans', 'DM Sans', sans-serif",
            }}
            className="relative overflow-hidden rounded-[24px] shadow-2xl border border-slate-200/80 select-none flex flex-col justify-between text-slate-900"
          >
            {/* Subtle warm sunlit campus bokeh background in upper section */}
            <div
              className="absolute inset-x-0 top-0 h-[690px] pointer-events-none"
              style={{
                background:
                  'radial-gradient(circle at 28% 58%, rgba(254, 243, 199, 0.55) 0%, rgba(209, 250, 229, 0.35) 38%, rgba(246, 250, 247, 0.95) 78%)',
              }}
            />

            {/* Soft green geometric wave accent on right side behind phone */}
            <svg
              viewBox="0 0 760 720"
              className="absolute inset-x-0 top-0 w-full h-[720px] pointer-events-none"
              preserveAspectRatio="none"
            >
              <path
                d="M 520 120 C 640 180, 720 260, 760 220 L 760 700 L 340 700 Z"
                fill={palette.accentText}
                fillOpacity="0.16"
              />
              <path
                d="M 440 310 C 570 340, 680 280, 760 330 L 760 720 L 240 720 Z"
                fill={palette.accentText}
                fillOpacity="0.22"
              />
            </svg>

            {/* ================= TOP & MIDDLE CONTENT AREA ================= */}
            <div className="relative z-10 px-10 pt-9 flex-1 flex flex-col">
              {/* Top Header Row: Brand Emblem + Handwritten Callout */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  {/* Brand Icon Box */}
                  <div
                    className="w-[74px] h-[74px] rounded-[20px] flex items-center justify-center shadow-lg relative overflow-hidden shrink-0"
                    style={{ background: palette.deckGradient }}
                  >
                    {/* Open Book + Golden Sparkle SVG matching reference aesthetic */}
                    <svg viewBox="0 0 64 64" className="w-12 h-12">
                      <path
                        d="M10 18 C18 15, 26 17, 32 22 C38 17, 46 15, 54 18 L54 48 C46 45, 38 47, 32 52 C26 47, 18 45, 10 48 Z"
                        fill="#ffffff"
                      />
                      <path
                        d="M32 22 L32 51"
                        stroke="#a7f3d0"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                      <path
                        d="M48 8 L50.5 14.5 L57 17 L50.5 19.5 L48 26 L45.5 19.5 L39 17 L45.5 14.5 Z"
                        fill="#fbbf24"
                      />
                    </svg>
                  </div>

                  <div>
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-[36px] font-black tracking-tight leading-none"
                        style={{ color: palette.darkHeadline }}
                      >
                        UniAce
                      </span>
                      <span
                        className="text-[36px] font-black tracking-tight leading-none"
                        style={{ color: palette.accentText }}
                      >
                        Mastery AI
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[14px] font-semibold tracking-[0.16em] text-slate-700 uppercase">
                      <span>{flyerConfig.brandSubline[0] || 'Learn'}</span>
                      <span style={{ color: palette.accentText }}>•</span>
                      <span>{flyerConfig.brandSubline[1] || 'Practise'}</span>
                      <span style={{ color: palette.accentText }}>•</span>
                      <span>{flyerConfig.brandSubline[2] || 'Excel'}</span>
                    </div>
                  </div>
                </div>

                {/* Top Right Handwritten Script Callout */}
                <div className="text-right -rotate-[7deg] pr-2 pt-1">
                  <div
                    style={{
                      fontFamily: "'Caveat', 'Comic Sans MS', 'Bradley Hand', cursive",
                      color: palette.scriptColor,
                    }}
                    className="text-[28px] font-bold leading-tight"
                  >
                    {flyerConfig.topScriptCallout}
                  </div>
                  <svg viewBox="0 0 180 18" className="w-36 h-4 ml-auto -mt-1">
                    <path
                      d="M 6 12 Q 90 2, 174 8"
                      fill="none"
                      stroke={palette.accentText}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>

              {/* Main Split Grid: Left Copy + Campus Student | Right 3D Tilted Phone */}
              <div className="grid grid-cols-12 gap-4 mt-7 flex-1 relative">
                {/* LEFT COLUMN (7 Cols) */}
                <div className="col-span-7 flex flex-col justify-between pr-2 z-10">
                  <div className="space-y-4">
                    <h1 className="text-[52px] font-black leading-[1.04] tracking-tight">
                      <span className="block" style={{ color: palette.darkHeadline }}>
                        {flyerConfig.headlineLine1}
                      </span>
                      <span className="block" style={{ color: palette.accentText }}>
                        {flyerConfig.headlineLine2}
                      </span>
                    </h1>

                    <p
                      className="text-[19px] font-extrabold leading-[1.35] max-w-[400px]"
                      style={{ color: palette.darkHeadline }}
                    >
                      {flyerConfig.leadBoldParagraph}
                    </p>

                    <p className="text-[15.5px] font-medium text-slate-700 leading-[1.45] max-w-[395px]">
                      {flyerConfig.subParagraph}
                    </p>
                  </div>

                  {/* Campus Student Studying on Phone + "Your goals are valid" Callout */}
                  <div className="relative mt-2 h-[335px] flex items-end">
                    {/* Handwritten Note next to Student */}
                    <div className="absolute right-2 top-10 -rotate-[8deg] z-20 text-center">
                      <div
                        style={{
                          fontFamily: "'Caveat', 'Comic Sans MS', 'Bradley Hand', cursive",
                          color: palette.darkHeadline,
                        }}
                        className="text-[23px] font-bold leading-none"
                      >
                        {flyerConfig.midScriptCallout}
                      </div>
                      <svg viewBox="0 0 120 16" className="w-24 h-3.5 mx-auto mt-0.5">
                        <path
                          d="M 8 7 Q 60 2, 112 6 M 18 13 Q 65 9, 104 12"
                          fill="none"
                          stroke={palette.accentText}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>

                    {/* Student Visual Container */}
                    <div className="relative w-[330px] h-[325px] flex items-end justify-start">
                      {flyerConfig.studentPortraitMode === 'custom_photo' &&
                      flyerConfig.customPhotoDataUrl ? (
                        <div className="w-[290px] h-[305px] rounded-t-[36px] rounded-b-[18px] overflow-hidden shadow-2xl border-4 border-white relative bg-emerald-950">
                          <img
                            src={flyerConfig.customPhotoDataUrl}
                            alt="University Scholar"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        /* High-Craft Illustrated Nigerian/African University Student with Hoodie, Headphones, Backpack, Books & Smartphone */
                        <svg viewBox="0 0 360 340" className="w-full h-full drop-shadow-xl">
                          <defs>
                            <linearGradient id="hoodieGrad" x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor="#0b6b37" />
                              <stop offset="60%" stopColor="#064e28" />
                              <stop offset="100%" stopColor="#033018" />
                            </linearGradient>
                            <linearGradient id="skinGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#8d5524" />
                              <stop offset="100%" stopColor="#6b3e17" />
                            </linearGradient>
                            <linearGradient id="tableGrad" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#d97706" />
                              <stop offset="100%" stopColor="#92400e" />
                            </linearGradient>
                          </defs>

                          {/* Soft Campus Trees & Building Silhouette in Background */}
                          <circle cx="75" cy="120" r="55" fill="#15803d" fillOpacity="0.18" />
                          <circle cx="255" cy="145" r="45" fill="#166534" fillOpacity="0.14" />

                          {/* Backpack Straps & Bag */}
                          <path
                            d="M62 155 C42 175, 38 235, 48 285 L88 285 Z"
                            fill="#1e293b"
                          />

                          {/* Hoodie Body & Shoulders */}
                          <path
                            d="M52 295 C52 210, 82 162, 148 162 C214 162, 246 210, 252 295 Z"
                            fill="url(#hoodieGrad)"
                          />

                          {/* Backpack Shoulder Straps over Hoodie */}
                          <path
                            d="M95 168 C86 205, 84 250, 90 290"
                            stroke="#0f172a"
                            strokeWidth="13"
                            strokeLinecap="round"
                            fill="none"
                          />
                          <path
                            d="M202 170 C212 205, 214 250, 208 290"
                            stroke="#0f172a"
                            strokeWidth="12"
                            strokeLinecap="round"
                            fill="none"
                          />

                          {/* Hood Collar & White Drawstrings */}
                          <path
                            d="M112 156 Q150 185 188 156"
                            fill="#064e28"
                            stroke="#04351b"
                            strokeWidth="4"
                          />
                          <path
                            d="M136 174 L134 224 M164 174 L166 220"
                            stroke="#f8fafc"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />

                          {/* Headphones Around Neck */}
                          <path
                            d="M108 156 C108 192, 192 192, 192 156"
                            stroke="#1e293b"
                            strokeWidth="9"
                            fill="none"
                          />
                          <ellipse cx="116" cy="168" rx="14" ry="18" transform="rotate(-20 116 168)" fill="#0f172a" stroke="#334155" strokeWidth="2" />
                          <ellipse cx="184" cy="168" rx="14" ry="18" transform="rotate(20 184 168)" fill="#0f172a" stroke="#334155" strokeWidth="2" />

                          {/* Neck & Head */}
                          <rect x="133" y="124" width="34" height="38" rx="12" fill="url(#skinGrad)" />
                          {/* Ears */}
                          <circle cx="112" cy="96" r="10" fill="#6b3e17" />
                          <circle cx="192" cy="94" r="10" fill="#6b3e17" />
                          {/* Head Shape (slightly tilted looking at phone) */}
                          <path
                            d="M114 74 C114 44, 188 44, 190 74 C192 114, 178 142, 152 144 C126 142, 112 114, 114 74 Z"
                            fill="url(#skinGrad)"
                          />

                          {/* Textured Short Taper Fade Hair */}
                          <path
                            d="M113 76 C110 42, 134 26, 154 27 C178 27, 195 44, 191 75 C184 62, 168 56, 152 56 C134 56, 120 62, 113 76 Z"
                            fill="#111827"
                          />

                          {/* Eyebrows, Focused Eyes Looking Down at Phone & Warm Smile */}
                          <path d="M128 82 Q137 78 145 81" stroke="#111827" strokeWidth="3" strokeLinecap="round" fill="none" />
                          <path d="M161 81 Q170 78 178 82" stroke="#111827" strokeWidth="3" strokeLinecap="round" fill="none" />
                          <path d="M130 92 Q137 96 144 92" stroke="#111827" strokeWidth="2.8" strokeLinecap="round" fill="none" />
                          <path d="M162 92 Q169 96 176 92" stroke="#111827" strokeWidth="2.8" strokeLinecap="round" fill="none" />
                          {/* Nose */}
                          <path d="M153 92 L150 107 L158 109" stroke="#4a290d" strokeWidth="2.5" strokeLinecap="round" fill="none" />
                          {/* Warm Confident Smile */}
                          <path
                            d="M137 117 Q153 130 169 116 Z"
                            fill="#ffffff"
                            stroke="#4a290d"
                            strokeWidth="2"
                          />

                          {/* Arms & Hands Holding Smartphone */}
                          <path
                            d="M74 225 C68 260, 95 288, 162 272"
                            stroke="url(#hoodieGrad)"
                            strokeWidth="36"
                            strokeLinecap="round"
                            fill="none"
                          />
                          {/* Smartphone in Student's Hands */}
                          <rect
                            x="184"
                            y="206"
                            width="42"
                            height="68"
                            rx="7"
                            transform="rotate(16 205 240)"
                            fill="#0f172a"
                            stroke="#475569"
                            strokeWidth="2"
                          />
                          {/* Student Hands Holding Phone */}
                          <ellipse cx="176" cy="256" rx="18" ry="12" fill="url(#skinGrad)" />
                          <ellipse cx="212" cy="252" rx="16" ry="11" fill="url(#skinGrad)" />

                          {/* Study Desk, Stacked Textbooks & Open Notebook at Bottom */}
                          <rect x="4" y="294" width="320" height="22" rx="4" fill="url(#tableGrad)" />
                          {/* Stacked Books on Left */}
                          <rect x="8" y="262" width="88" height="16" rx="3" fill="#f59e0b" stroke="#78350f" strokeWidth="1.5" />
                          <rect x="14" y="265" width="78" height="10" rx="1" fill="#fef3c7" />
                          <rect x="4" y="278" width="96" height="16" rx="3" fill="#0284c7" stroke="#0c4a6e" strokeWidth="1.5" />
                          <rect x="10" y="281" width="86" height="10" rx="1" fill="#f0f9ff" />
                          {/* Open Notebook & Pen */}
                          <path d="M118 286 L256 286 L268 296 L108 296 Z" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
                          <line x1="188" y1="286" x2="188" y2="296" stroke="#94a3b8" strokeWidth="2" />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN (5 Cols): Tilted 3D Smartphone Showcasing Live UniAce Features */}
                <div className="col-span-5 relative flex items-start justify-end pr-1 pt-1 z-20">
                  <div
                    className="w-[308px] rounded-[42px] p-[10px] shadow-[0_28px_60px_rgba(0,0,0,0.45)] relative"
                    style={{
                      transform: 'rotate(3.5deg)',
                      background: 'linear-gradient(145deg, #334155 0%, #0f172a 50%, #020617 100%)',
                      border: '2px solid #64748b',
                    }}
                  >
                    {/* Inner Phone Screen */}
                    <div className="bg-[#f8fafc] rounded-[33px] overflow-hidden flex flex-col justify-between h-[615px] border border-slate-200">
                      {/* Phone Top Status Bar + Dynamic Island */}
                      <div className="px-5 pt-2.5 pb-1.5 flex items-center justify-between text-[11px] font-bold text-slate-900 bg-white">
                        <span>9:41</span>
                        <div className="w-20 h-4 bg-black rounded-full" />
                        <div className="flex items-center gap-1 text-slate-800">
                          <Signal size={11} />
                          <Wifi size={11} />
                          <BatteryCharging size={12} />
                        </div>
                      </div>

                      {/* App Header & Greeting */}
                      <div className="px-4 pt-1.5 pb-2 bg-white border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-black"
                            style={{ backgroundColor: palette.accentText }}
                          >
                            🎓
                          </div>
                          <span className="text-[13px] font-black text-slate-900">
                            UniAce <span style={{ color: palette.accentText }}>Mastery AI</span>
                          </span>
                        </div>
                        <div className="mt-1.5">
                          <div className="text-[14px] font-black text-slate-900 leading-tight">
                            {flyerConfig.phoneGreeting}
                          </div>
                          <div className="text-[10.5px] text-slate-500 font-medium">
                            {flyerConfig.phonePrompt}
                          </div>
                        </div>
                      </div>

                      {/* 8 Dynamic Feature Cards inside Phone Screen */}
                      <div className="px-3 py-2 space-y-1.5 flex-1 overflow-hidden bg-[#f1f5f9]">
                        {enabledCapabilities.map((cap) => (
                          <div
                            key={cap.id}
                            className="bg-white rounded-xl px-2.5 py-1.5 border border-slate-200/80 shadow-2xs flex items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-2xs"
                                style={{ backgroundColor: cap.accentHex }}
                              >
                                {renderCapabilityIcon(cap.iconKey, 15)}
                              </div>
                              <div className="min-w-0">
                                <div className="text-[11px] font-extrabold text-slate-900 leading-tight truncate">
                                  {cap.title}
                                </div>
                                <div className="text-[9px] text-slate-500 font-medium leading-tight line-clamp-1 mt-0.5">
                                  {cap.phoneDescription}
                                </div>
                              </div>
                            </div>
                            <ChevronRight size={12} className="text-slate-400 shrink-0" />
                          </div>
                        ))}
                      </div>

                      {/* Phone Bottom Navigation Bar */}
                      <div className="px-5 py-2 bg-white border-t border-slate-200 flex items-center justify-between text-[9px] font-bold text-slate-400">
                        <div
                          className="flex flex-col items-center gap-0.5"
                          style={{ color: palette.accentText }}
                        >
                          <Home size={13} />
                          <span>Home</span>
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                          <Library size={13} />
                          <span>Library</span>
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                          <Calendar size={13} />
                          <span>Planner</span>
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                          <User size={13} />
                          <span>Profile</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ================= LOWER DIAGONAL / CURVED DEEP EMERALD FEATURE DECK ================= */}
            <div className="relative z-30 -mt-12">
              {/* Diagonal Sweep Header Wave */}
              <svg
                viewBox="0 0 760 54"
                className="w-full h-[54px] block -mb-1"
                preserveAspectRatio="none"
              >
                <path
                  d="M 0 54 L 0 22 Q 260 52, 520 12 L 760 0 L 760 54 Z"
                  fill={flyerConfig.themeId === 'emerald_gold' ? '#085c2f' : palette.accentText}
                />
              </svg>

              <div
                style={{ background: palette.deckGradient }}
                className="px-9 pt-4 pb-6 text-white space-y-6"
              >
                {/* 8-Feature Grid (2 Rows x 4 Columns) */}
                <div className="grid grid-cols-4 gap-x-4 gap-y-5">
                  {enabledCapabilities.map((cap, idx) => (
                    <div
                      key={cap.id}
                      className={`flex items-start gap-2.5 pr-2 ${
                        idx % 4 !== 3 ? 'border-r border-white/15' : ''
                      }`}
                    >
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 border-2 border-white shadow-md"
                        style={{ backgroundColor: cap.badgeBgHex }}
                      >
                        {renderCapabilityIcon(cap.iconKey, 17)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-extrabold text-white leading-tight">
                          {cap.title}
                        </div>
                        <div className="text-[10.5px] text-emerald-100/90 font-medium leading-[1.28] mt-1">
                          {cap.gridDescription}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* CTA Bar: Visit Now Button + Live Domain + Scannable Vector QR Code + Support Line */}
                <div className="pt-2 flex items-center justify-between gap-4 border-t border-white/15">
                  {/* Left: Visit Now CTA + Website URL */}
                  <div className="flex items-center gap-4">
                    <div
                      style={{ backgroundColor: palette.ctaBg, color: palette.ctaText }}
                      className="px-6 py-3 rounded-full font-black text-[18px] shadow-lg flex items-center gap-2 shrink-0"
                    >
                      <span>{flyerConfig.ctaText}</span>
                      <ChevronRight size={20} strokeWidth={3} />
                    </div>
                    <span className="text-[22px] font-extrabold tracking-tight text-white truncate max-w-[235px]">
                      {flyerConfig.websiteDisplayUrl}
                    </span>
                  </div>

                  {/* Right: Real Vector SVG QR Code + Support Contact */}
                  <div className="flex items-center gap-4 shrink-0">
                    {/* Scannable QR Code Box */}
                    <div className="bg-white p-1.5 rounded-xl shadow-lg w-[68px] h-[68px] flex items-center justify-center">
                      {qrMatrix.length > 0 ? (
                        <svg
                          viewBox={`0 0 ${qrMatrix.length} ${qrMatrix.length}`}
                          className="w-full h-full"
                          shapeRendering="crispEdges"
                        >
                          <rect width={qrMatrix.length} height={qrMatrix.length} fill="#ffffff" />
                          {qrMatrix.map((row, rIdx) =>
                            row.map((isDark, cIdx) =>
                              isDark ? (
                                <rect
                                  key={`${rIdx}-${cIdx}`}
                                  x={cIdx}
                                  y={rIdx}
                                  width={1}
                                  height={1}
                                  fill="#0f172a"
                                />
                              ) : null
                            )
                          )}
                        </svg>
                      ) : (
                        <span className="text-[8px] text-center font-bold text-rose-600">QR unavailable</span>
                      )}
                    </div>

                    {/* Support details appear only when an administrator has configured a real contact. */}
                    {flyerConfig.supportContact && (
                      <div className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-full bg-white/10 border border-white/25 flex items-center justify-center text-white">
                          <Headphones size={20} />
                        </div>
                        <div>
                          <div className="text-[11px] text-emerald-200 font-semibold leading-tight">
                            {flyerConfig.supportLabel}
                          </div>
                          <div className="text-[16px] font-black text-white leading-tight tracking-tight">
                            {flyerConfig.supportContact}
                          </div>
                          <div className="text-[10.5px] text-emerald-200/80 font-medium leading-tight">
                            {flyerConfig.supportSublabel}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Footer Strip */}
              <div
                style={{ backgroundColor: palette.footerStripBg }}
                className="py-3 px-8 text-center text-[11px] font-bold tracking-[0.2em] text-emerald-100/80 uppercase flex items-center justify-center gap-4"
              >
                <span>{flyerConfig.footerPillars[0]}</span>
                <span className="text-emerald-400">|</span>
                <span>{flyerConfig.footerPillars[1]}</span>
                <span className="text-emerald-400">|</span>
                <span>{flyerConfig.footerPillars[2]}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
