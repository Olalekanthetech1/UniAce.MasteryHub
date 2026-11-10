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
  Save,
  History,
  BarChart3,
  LayoutGrid,
  Search,
  Bell,
  ArrowUp,
  ArrowDown,
  Smartphone,
  Pencil,
  Users,
} from 'lucide-react';
import { useMarketingSnapshot } from '../../hooks/useMarketingSnapshot';
import { toMarketingCourseMap } from '../../services/marketingSnapshot';
import {
  ALL_FLYER_LAYOUTS,
  ALL_FLYER_THEMES,
  ALL_FLYER_WAVES,
  DynamicCapabilityItem,
  DynamicFlyerConfig,
  FlyerHeroVisualMode,
  FlyerLayoutVariant,
  FlyerPhoneScreenMode,
  FlyerThemeId,
  FlyerWaveStyle,
  MarketingTargetScope,
  PlatformMarketingContext,
  buildDynamicFlyerConfig,
  canonicalizeAcademicLevel,
  canonicalizeAcademicSemester,
  formatAcademicLevelBadge,
  formatAcademicSemesterBadge,
  formatCourseScopeBadge,
  getCandidateCohortDepartments,
  getCandidateCohortLevels,
  getCandidateCohortSemesters,
  getEligibleCoursesForCohort,
  resolveActivePhoneHubCohort,
  resolveDynamicDesignTokens,
  resolvePhoneHubCourses,
  synthesizeFlyerWithAI,
} from '../../services/demoReelService';
import { generateQrMatrix } from '../../utils/qrCodeSvg';
import {
  getMarketingCampaignAnalytics,
  MarketingCampaignAnalytics,
} from '../../services/marketingCampaignTracking';
import {
  getMarketingAssetVersion,
  listMarketingAssetVersions,
  MarketingAssetVersion,
  saveMarketingAssetVersion,
} from '../../services/marketingAssetHistory';

export interface FlyerThemePalette {
  name: string;
  shortLabel: string;
  topBg: string;
  bokehGradient: string;
  accentText: string;
  accentLight: string;
  accentMuted: string;
  accentSoftBg: string;
  accentBorder: string;
  darkHeadline: string;
  deckWaveFill: string;
  deckGradient: string;
  footerStripBg: string;
  ctaBg: string;
  ctaText: string;
  scriptColor: string;
  hoodiePrimary: string;
  hoodieSecondary: string;
  hoodieDark: string;
}

const THEME_PALETTES: Record<FlyerThemeId, FlyerThemePalette> = {
  emerald_gold: {
    name: 'UniAce Emerald & Gold',
    shortLabel: 'Emerald',
    topBg: '#f6faf7',
    bokehGradient:
      'radial-gradient(circle at 28% 58%, rgba(254, 243, 199, 0.55) 0%, rgba(209, 250, 229, 0.35) 38%, rgba(246, 250, 247, 0.95) 78%)',
    accentText: '#0d7a3e',
    accentLight: '#6ee7b7',
    accentMuted: '#d1fae5',
    accentSoftBg: '#ecfdf5',
    accentBorder: '#a7f3d0',
    darkHeadline: '#0b2919',
    deckWaveFill: '#085c2f',
    deckGradient: 'linear-gradient(160deg, #0b6b37 0%, #064e28 55%, #04351b 100%)',
    footerStripBg: '#032613',
    ctaBg: '#f4b928',
    ctaText: '#062814',
    scriptColor: '#0d6835',
    hoodiePrimary: '#0b6b37',
    hoodieSecondary: '#064e28',
    hoodieDark: '#033018',
  },
  royal_indigo: {
    name: 'Royal Academic Indigo',
    shortLabel: 'Indigo',
    topBg: '#f6f8fc',
    bokehGradient:
      'radial-gradient(circle at 28% 58%, rgba(224, 231, 255, 0.65) 0%, rgba(199, 210, 254, 0.38) 38%, rgba(246, 248, 252, 0.95) 78%)',
    accentText: '#3730a3',
    accentLight: '#a5b4fc',
    accentMuted: '#e0e7ff',
    accentSoftBg: '#eef2ff',
    accentBorder: '#c7d2fe',
    darkHeadline: '#0f172a',
    deckWaveFill: '#1e1b4b',
    deckGradient: 'linear-gradient(160deg, #1e1b4b 0%, #1e3a8a 55%, #0f172a 100%)',
    footerStripBg: '#090d16',
    ctaBg: '#f59e0b',
    ctaText: '#0f172a',
    scriptColor: '#3730a3',
    hoodiePrimary: '#312e81',
    hoodieSecondary: '#1e3a8a',
    hoodieDark: '#0f172a',
  },
  cyber_slate: {
    name: 'Prestige Slate & Teal',
    shortLabel: 'Teal',
    topBg: '#f4f7f8',
    bokehGradient:
      'radial-gradient(circle at 28% 58%, rgba(204, 251, 241, 0.6) 0%, rgba(224, 242, 254, 0.38) 38%, rgba(244, 247, 248, 0.95) 78%)',
    accentText: '#0f766e',
    accentLight: '#5eead4',
    accentMuted: '#ccfbf1',
    accentSoftBg: '#f0fdfa',
    accentBorder: '#99f6e4',
    darkHeadline: '#091518',
    deckWaveFill: '#0f524d',
    deckGradient: 'linear-gradient(160deg, #0f524d 0%, #0b3b3c 55%, #072227 100%)',
    footerStripBg: '#041518',
    ctaBg: '#fbbf24',
    ctaText: '#041518',
    scriptColor: '#0f766e',
    hoodiePrimary: '#0f766e',
    hoodieSecondary: '#115e59',
    hoodieDark: '#042f2e',
  },
  crimson_scholar: {
    name: 'Crimson Clinical & Sciences',
    shortLabel: 'Crimson',
    topBg: '#fcf7f8',
    bokehGradient:
      'radial-gradient(circle at 28% 58%, rgba(254, 226, 226, 0.58) 0%, rgba(254, 243, 199, 0.35) 38%, rgba(252, 247, 248, 0.95) 78%)',
    accentText: '#9f1239',
    accentLight: '#fda4af',
    accentMuted: '#ffe4e6',
    accentSoftBg: '#fff1f2',
    accentBorder: '#fecdd3',
    darkHeadline: '#2a0813',
    deckWaveFill: '#881337',
    deckGradient: 'linear-gradient(160deg, #881337 0%, #650d28 55%, #3b0616 100%)',
    footerStripBg: '#26040e',
    ctaBg: '#fbbf24',
    ctaText: '#2a0813',
    scriptColor: '#9f1239',
    hoodiePrimary: '#9f1239',
    hoodieSecondary: '#881337',
    hoodieDark: '#4c0519',
  },
  obsidian_amber: {
    name: 'Obsidian & Honours Gold',
    shortLabel: 'Obsidian',
    topBg: '#f8fafc',
    bokehGradient:
      'radial-gradient(circle at 28% 58%, rgba(254, 243, 199, 0.65) 0%, rgba(226, 232, 240, 0.45) 38%, rgba(248, 250, 252, 0.95) 78%)',
    accentText: '#b45309',
    accentLight: '#fcd34d',
    accentMuted: '#fef3c7',
    accentSoftBg: '#fffbeb',
    accentBorder: '#fde68a',
    darkHeadline: '#0f172a',
    deckWaveFill: '#1e293b',
    deckGradient: 'linear-gradient(160deg, #1e293b 0%, #0f172a 55%, #020617 100%)',
    footerStripBg: '#020617',
    ctaBg: '#f59e0b',
    ctaText: '#0f172a',
    scriptColor: '#b45309',
    hoodiePrimary: '#334155',
    hoodieSecondary: '#1e293b',
    hoodieDark: '#0f172a',
  },
  violet_cosmos: {
    name: 'Imperial Violet & Gold',
    shortLabel: 'Violet',
    topBg: '#faf7fc',
    bokehGradient:
      'radial-gradient(circle at 28% 58%, rgba(243, 232, 255, 0.65) 0%, rgba(224, 231, 255, 0.38) 38%, rgba(250, 247, 252, 0.95) 78%)',
    accentText: '#6d28d9',
    accentLight: '#c4b5fd',
    accentMuted: '#ede9fe',
    accentSoftBg: '#f5f3ff',
    accentBorder: '#ddd6fe',
    darkHeadline: '#1e1035',
    deckWaveFill: '#4c1d95',
    deckGradient: 'linear-gradient(160deg, #5b21b6 0%, #3b0764 55%, #240442 100%)',
    footerStripBg: '#17022b',
    ctaBg: '#fbbf24',
    ctaText: '#1e1035',
    scriptColor: '#6d28d9',
    hoodiePrimary: '#6d28d9',
    hoodieSecondary: '#4c1d95',
    hoodieDark: '#2e1065',
  },
};

const LAYOUT_VARIANT_LABELS: Record<FlyerLayoutVariant, { label: string; badge: string }> = {
  classic_campus_split: { label: 'Editorial Split', badge: 'Left Copy • Right Phone' },
  modern_bento_showcase: { label: 'Bento Mirrored', badge: 'Left Phone • Right Bento' },
  executive_spotlight: { label: 'Executive Ribbon', badge: 'Scope Ribbon • Framed Copy' },
  academic_crest_editorial: { label: 'University Crest', badge: 'Crest Header • Metric Deck' },
};

const WAVE_STYLE_LABELS: Record<FlyerWaveStyle, string> = {
  curved: 'Curved Sweep',
  diagonal: 'Angular Slash',
  stepped: 'Architectural Step',
  architectural_arch: 'Symmetric Arch',
};

type FlyerExportFormat = 'square' | 'vertical' | 'landscape';

const FLYER_EXPORT_SIZES: Record<FlyerExportFormat, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: '1:1 Square · 1080 × 1080' },
  vertical: { width: 1080, height: 1920, label: '9:16 Vertical · 1080 × 1920' },
  landscape: { width: 1920, height: 1080, label: '16:9 Landscape · 1920 × 1080' },
};

function buildFlyerCampaignId(
  scope: MarketingTargetScope,
  courseId: string,
  faculty: string,
  department: string
): string {
  const target = scope === 'course'
    ? courseId
    : scope === 'faculty'
      ? faculty
      : scope === 'department'
        ? department
        : 'all';
  const slug = String(target || 'unselected')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'unselected';
  return `flyer:${scope}:${slug}`;
}

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
  palette: FlyerThemePalette
): HTMLCanvasElement {
  const size = FLYER_EXPORT_SIZES[format];
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable in this browser.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = palette.topBg;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.textBaseline = 'top';

  if (format === 'vertical') {
    // Export the complete, edge-to-edge Ultra-HD flyer directly without any duplicate
    // top header bar, outer white border, or duplicate bottom "Explore UniAce" strip.
    return source;
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

    ctx.fillStyle = palette.accentMuted;
    ctx.font = '800 17px Arial, sans-serif';
    ctx.fillText(config.brandName.toUpperCase(), rightX + 8, 66, rightWidth - 16);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 29px Arial, sans-serif';
    let y = drawWrappedCanvasText(ctx, config.headlineLine1, rightX + 8, 126, rightWidth - 18, 36, 3);
    ctx.fillStyle = palette.accentLight;
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
  ctx.fillStyle = palette.accentLight;
  ctx.font = '900 20px Arial, sans-serif';
  ctx.fillText(config.brandName.toUpperCase(), contentX, 86, contentWidth);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 64px Arial, sans-serif';
  let y = drawWrappedCanvasText(ctx, config.headlineLine1, contentX, 160, contentWidth, 74, 3);
  ctx.fillStyle = palette.accentLight;
  y = drawWrappedCanvasText(ctx, config.headlineLine2, contentX, y + 4, contentWidth, 74, 3);
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 27px Arial, sans-serif';
  y = drawWrappedCanvasText(ctx, config.leadBoldParagraph, contentX, y + 28, contentWidth, 38, 4);
  ctx.fillStyle = '#d1d5db';
  ctx.font = '500 21px Arial, sans-serif';
  y = drawWrappedCanvasText(ctx, config.subParagraph, contentX, y + 20, contentWidth, 30, 4);

  drawCanvasQr(ctx, qrMatrix, qrX, 650, qrSize);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '900 16px Arial, sans-serif';
  ctx.fillText('SCAN TO EXPLORE', qrX + qrSize / 2, 940, qrSize);
  ctx.font = '600 14px Arial, sans-serif';
  ctx.fillText(config.websiteDisplayUrl, qrX + qrSize / 2, 970, qrSize);
  ctx.textAlign = 'left';

  if (config.supportContact) {
    ctx.fillStyle = palette.accentMuted;
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
  const [isSavingVersion, setIsSavingVersion] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [assetHistory, setAssetHistory] = useState<MarketingAssetVersion[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [campaignAnalytics, setCampaignAnalytics] = useState<MarketingCampaignAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [activeCaptionTab, setActiveCaptionTab] = useState<'whatsapp' | 'twitter' | 'linkedin' | 'tiktok'>('whatsapp');
  const [copiedCaption, setCopiedCaption] = useState<string | null>(null);

  const posterRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const phoneScreenFileInputRef = useRef<HTMLInputElement>(null);

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
      quizCountsVerified: snapshot?.totals.quizzesVerified === true,
      pastPaperCountsVerified: snapshot?.totals.pastPapersVerified === true,
      totalPastPapers: snapshot?.totals.pastPapers ?? null,
      aiRuntimeVerified: snapshot?.totals.aiRuntimeVerified === true,
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
  const [designSeedOffset, setDesignSeedOffset] = useState<number>(0);

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
            studentPortraitMode: prev.studentPortraitMode,
            customPhotoDataUrl: prev.customPhotoDataUrl,
            phoneScreenMode:
              prev.phoneScreenMode === 'capabilities_list'
                ? 'capabilities_list'
                : next.phoneScreenMode,
            customPhoneScreenDataUrl: prev.customPhoneScreenDataUrl,
          }
        : next;
    });
  }, [marketingContext, snapshot]);

  const enabledCapabilities = useMemo(
    () => (flyerConfig?.capabilities || []).filter((c) => c.enabled).slice(0, 8),
    [flyerConfig?.capabilities]
  );

  const candidateCohortDepartments = useMemo(
    () => getCandidateCohortDepartments(marketingContext),
    [marketingContext]
  );

  const candidateCohortLevels = useMemo(
    () => getCandidateCohortLevels(marketingContext),
    [marketingContext]
  );

  const candidateCohortSemesters = useMemo(
    () => getCandidateCohortSemesters(marketingContext),
    [marketingContext]
  );

  const activePhoneCohort = useMemo(
    () =>
      resolveActivePhoneHubCohort(marketingContext, {
        department: flyerConfig?.phoneProgramLabel,
        level: flyerConfig?.phoneLevelLabel,
        semester: flyerConfig?.phoneSemesterLabel,
      }),
    [
      marketingContext,
      flyerConfig?.phoneProgramLabel,
      flyerConfig?.phoneLevelLabel,
      flyerConfig?.phoneSemesterLabel,
    ]
  );

  const handleShuffleDynamicDesign = () => {
    const nextSeed = designSeedOffset + 1;
    setDesignSeedOffset(nextSeed);
    const selectedCourse = courses[selectedCourseId] || courseList[0];
    const tokens = resolveDynamicDesignTokens(
      marketingContext,
      activePhoneCohort,
      selectedCourse,
      nextSeed
    );
    setFlyerConfig((prev) => {
      if (!prev) return prev;
      const nextHeroMode: FlyerHeroVisualMode =
        prev.studentPortraitMode === 'custom_photo' && prev.customPhotoDataUrl
          ? 'custom_photo'
          : nextSeed % 3 === 1
            ? 'academic_cohort_card'
            : 'campus_scholar_svg';
      return {
        ...prev,
        themeId: tokens.themeId,
        layoutVariant: tokens.layoutVariant,
        waveStyle: tokens.waveStyle,
        phoneTiltDeg: tokens.phoneTiltDeg,
        studentPortraitMode: nextHeroMode,
      };
    });
    toast.success(
      `Applied dynamic design: ${THEME_PALETTES[tokens.themeId].name} · ${LAYOUT_VARIANT_LABELS[tokens.layoutVariant].label}`
    );
  };

  const phoneHubCourses = useMemo(
    () =>
      resolvePhoneHubCourses(marketingContext, flyerConfig?.phonePinnedCourseIds, 8, {
        department: flyerConfig?.phoneProgramLabel,
        level: flyerConfig?.phoneLevelLabel,
        semester: flyerConfig?.phoneSemesterLabel,
      }),
    [
      marketingContext,
      flyerConfig?.phonePinnedCourseIds,
      flyerConfig?.phoneProgramLabel,
      flyerConfig?.phoneLevelLabel,
      flyerConfig?.phoneSemesterLabel,
    ]
  );

  const currentAssetKey = buildFlyerCampaignId(
    targetScope,
    selectedCourseId,
    selectedFaculty,
    selectedDepartment
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
      destination.searchParams.set('utm_campaign', currentAssetKey);
      destination.searchParams.set('utm_source', 'uniace_flyer');
      destination.searchParams.set('utm_medium', 'qr');
      return { matrix: generateQrMatrix(destination.toString()), error: null as string | null };
    } catch (error: any) {
      return {
        matrix: [] as boolean[][],
        error: error?.message || 'QR destination could not be encoded.'
      };
    }
  }, [flyerConfig?.qrTargetUrl, currentAssetKey]);
  const qrMatrix = qrResult.matrix;

  const palette = THEME_PALETTES[flyerConfig?.themeId || 'emerald_gold'] || THEME_PALETTES.emerald_gold;

  useEffect(() => {
    let active = true;
    setIsLoadingHistory(true);
    setHistoryError(null);
    listMarketingAssetVersions(currentAssetKey)
      .then((versions) => {
        if (active) setAssetHistory(versions);
      })
      .catch((error: any) => {
        if (active) {
          setAssetHistory([]);
          setHistoryError(error?.message || 'Saved marketing versions could not be loaded.');
        }
      })
      .finally(() => {
        if (active) setIsLoadingHistory(false);
      });
    return () => { active = false; };
  }, [currentAssetKey]);

  useEffect(() => {
    let active = true;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    getMarketingCampaignAnalytics(currentAssetKey)
      .then((metrics) => {
        if (active) setCampaignAnalytics(metrics);
      })
      .catch((error: any) => {
        if (active) {
          setCampaignAnalytics(null);
          setAnalyticsError(error?.message || 'Campaign metrics could not be verified.');
        }
      })
      .finally(() => {
        if (active) setAnalyticsLoading(false);
      });
    return () => { active = false; };
  }, [currentAssetKey]);

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

  const handleSaveAssetVersion = async () => {
    if (!flyerConfig || isSavingVersion) return;
    setIsSavingVersion(true);
    setHistoryError(null);
    try {
      const version = await saveMarketingAssetVersion({
        assetKey: currentAssetKey,
        assetName: `UniAce flyer — ${flyerConfig.headlineLine2 || targetScope}`.slice(0, 160),
        snapshot: {
          targetScope,
          selectedFaculty,
          selectedDepartment,
          selectedCourseId,
          copyReviewRequired,
          config: flyerConfig,
        },
      });
      setAssetHistory((previous) => [version, ...previous.filter((item) => item.id !== version.id)].slice(0, 25));
      toast.success(`Saved design version v${version.version} to Neon history.`);
    } catch (error: any) {
      setHistoryError(error?.message || 'The marketing design version could not be saved.');
      toast.error(error?.message || 'The marketing design version could not be saved.');
    } finally {
      setIsSavingVersion(false);
    }
  };

  const handleRestoreAssetVersion = async (id: string) => {
    if (restoringVersionId) return;
    setRestoringVersionId(id);
    try {
      const version = await getMarketingAssetVersion(id);
      const saved = version.snapshot;
      if (!saved || saved.targetScope !== targetScope || !saved.config ||
          typeof saved.config.headlineLine1 !== 'string' ||
          typeof saved.config.headlineLine2 !== 'string' ||
          !Array.isArray(saved.config.capabilities)) {
        throw new Error('This saved version does not match the current campaign target or flyer data contract.');
      }
      setSelectedFaculty(saved.selectedFaculty || selectedFaculty);
      setSelectedDepartment(saved.selectedDepartment || selectedDepartment);
      setSelectedCourseId(saved.selectedCourseId || selectedCourseId);
      setFlyerConfig(saved.config);
      setCopyReviewRequired(saved.copyReviewRequired === true);
      toast.success(`Restored design version v${version.version}. It remains a draft until any required copy review is complete.`);
    } catch (error: any) {
      toast.error(error?.message || 'The selected design version could not be restored.');
    } finally {
      setRestoringVersionId(null);
    }
  };

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
      if (typeof reader.result !== 'string') return;
      const image = new Image();
      image.onerror = () => toast.error('The selected photo could not be decoded.');
      image.onload = () => {
        const maxDimension = 1200;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          toast.error('Image compression is unavailable in this browser.');
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let compressed = canvas.toDataURL('image/webp', 0.82);
        if (!compressed.startsWith('data:image/webp;')) {
          compressed = canvas.toDataURL('image/jpeg', 0.82);
        }
        if (compressed.length > 600000) {
          toast.error('This portrait is still too large after compression. Choose a smaller image.');
          return;
        }
        setFlyerConfig((prev) => prev ? ({
          ...prev,
          studentPortraitMode: 'custom_photo',
          customPhotoDataUrl: compressed,
        }) : prev);
        toast.success('Custom portrait compressed and applied.');
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const handlePhoneScreenUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('Please select a PNG, JPG or WebP screenshot.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Please use an image smaller than 8 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error('The selected screen image could not be read.');
    reader.onload = () => {
      if (typeof reader.result !== 'string') return;
      const image = new Image();
      image.onerror = () => toast.error('The selected screen image could not be decoded.');
      image.onload = () => {
        const maxDimension = 2400;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) {
          toast.error('Image processing is unavailable in this browser.');
          return;
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const losslessPng = canvas.toDataURL('image/png');
        setFlyerConfig((prev) =>
          prev
            ? {
                ...prev,
                phoneScreenMode: 'custom_screen_upload',
                customPhoneScreenDataUrl: losslessPng,
              }
            : prev
        );
        toast.success('High-resolution screen capture applied to 3D phone mockup.');
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const handleSelectPhoneCohort = (nextOverride: {
    department?: string;
    level?: string;
    semester?: string;
  }) => {
    setFlyerConfig((prev) => {
      if (!prev) return prev;
      const merged = {
        department: nextOverride.department ?? prev.phoneProgramLabel,
        level: nextOverride.level ?? prev.phoneLevelLabel,
        semester: nextOverride.semester ?? prev.phoneSemesterLabel,
      };
      const resolvedCohort = resolveActivePhoneHubCohort(marketingContext, merged);
      return {
        ...prev,
        phoneProgramLabel: resolvedCohort.department,
        phoneLevelLabel: resolvedCohort.levelLabel,
        phoneSemesterLabel: resolvedCohort.semesterLabel,
        phonePinnedCourseIds: resolvedCohort.courses.slice(0, 8).map((c) => c.id),
      };
    });
  };

  const handleTogglePinnedPhoneCourse = (courseId: string) => {
    setFlyerConfig((prev) => {
      if (!prev) return prev;
      const currentIds =
        Array.isArray(prev.phonePinnedCourseIds) && prev.phonePinnedCourseIds.length > 0
          ? [...prev.phonePinnedCourseIds]
          : phoneHubCourses.map((c) => c.id);
      const exists = currentIds.includes(courseId);
      if (exists) {
        if (currentIds.length <= 1) {
          toast.error('At least 1 live course must remain displayed in the Course Hub phone screen.');
          return prev;
        }
        return {
          ...prev,
          phonePinnedCourseIds: currentIds.filter((id) => id !== courseId),
        };
      }
      if (currentIds.length >= 8) {
        toast.error('Maximum 8 courses fit in the 4×2 phone screen grid. Unpin one first.');
        return prev;
      }
      return {
        ...prev,
        phonePinnedCourseIds: [...currentIds, courseId],
      };
    });
  };

  const handleMovePinnedPhoneCourse = (courseId: string, direction: 'up' | 'down') => {
    setFlyerConfig((prev) => {
      if (!prev) return prev;
      const currentIds =
        Array.isArray(prev.phonePinnedCourseIds) && prev.phonePinnedCourseIds.length > 0
          ? [...prev.phonePinnedCourseIds]
          : phoneHubCourses.map((c) => c.id);
      const index = currentIds.indexOf(courseId);
      if (index === -1) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= currentIds.length) return prev;
      const swapped = [...currentIds];
      [swapped[index], swapped[targetIndex]] = [swapped[targetIndex], swapped[index]];
      return {
        ...prev,
        phonePinnedCourseIds: swapped,
      };
    });
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
        scale: 3.5,
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
      toast.success(`Ultra-HD PNG exported at ${canvas.width} × ${canvas.height}px.`);
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

          {/* Dynamic Visual Architecture, Palette, Wave & Hero Mode */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-700/60 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase block">
                  Dynamic Visual Architecture & Palette
                </label>
                <p className="text-[10px] text-slate-500">
                  Auto-adapts to scope & discipline, or shuffle/select any combination.
                </p>
              </div>
              <button
                type="button"
                onClick={handleShuffleDynamicDesign}
                className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[11px] font-black flex items-center gap-1.5 shadow-xs hover:opacity-90 active:scale-95 transition-all shrink-0"
              >
                <RefreshCw size={12} />
                <span>Shuffle Design</span>
              </button>
            </div>

            {/* 6 Dynamic Academic Color Palettes */}
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">
                Color Theme ({THEME_PALETTES[flyerConfig.themeId]?.name})
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {ALL_FLYER_THEMES.map((tId) => {
                  const p = THEME_PALETTES[tId];
                  const isSelected = flyerConfig.themeId === tId;
                  return (
                    <button
                      key={tId}
                      type="button"
                      onClick={() => setFlyerConfig({ ...flyerConfig, themeId: tId })}
                      className={`py-1.5 px-2 rounded-xl text-[10.5px] font-bold border transition-all flex items-center justify-center gap-1.5 ${
                        isSelected
                          ? 'border-slate-900 dark:border-white bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                      }`}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/50"
                        style={{ backgroundColor: p.accentText }}
                      />
                      <span className="truncate">{p.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4 Dynamic Structural Layout Variants */}
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">
                Poster Layout Architecture
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_FLYER_LAYOUTS.map((lId) => {
                  const meta = LAYOUT_VARIANT_LABELS[lId];
                  const activeLayout = flyerConfig.layoutVariant || 'classic_campus_split';
                  return (
                    <button
                      key={lId}
                      type="button"
                      onClick={() => setFlyerConfig({ ...flyerConfig, layoutVariant: lId })}
                      className={`p-2 rounded-xl text-left border transition-all ${
                        activeLayout === lId
                          ? 'border-emerald-600 bg-emerald-50/80 dark:bg-emerald-950/40 text-slate-900 dark:text-white'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <div className="text-[11px] font-extrabold leading-tight">{meta.label}</div>
                      <div className="text-[9.5px] text-slate-500 dark:text-slate-400 mt-0.5">{meta.badge}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Wave Geometry + Hero Visual Mode */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">
                  Deck Wave Geometry
                </label>
                <select
                  value={flyerConfig.waveStyle || 'curved'}
                  onChange={(e) =>
                    setFlyerConfig({
                      ...flyerConfig,
                      waveStyle: e.target.value as FlyerWaveStyle,
                    })
                  }
                  className="w-full px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white"
                >
                  {ALL_FLYER_WAVES.map((wId) => (
                    <option key={wId} value={wId}>
                      {WAVE_STYLE_LABELS[wId]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1.5">
                  Hero Visual Showcase
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setFlyerConfig({
                        ...flyerConfig,
                        studentPortraitMode:
                          flyerConfig.studentPortraitMode === 'campus_scholar_svg'
                            ? 'academic_cohort_card'
                            : 'campus_scholar_svg',
                      })
                    }
                    className="flex-1 py-2 px-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-[11px] font-bold transition-colors truncate"
                  >
                    {flyerConfig.studentPortraitMode === 'academic_cohort_card'
                      ? 'Mode: Cohort Card'
                      : 'Mode: Scholar Vector'}
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="py-2 px-2.5 rounded-xl bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-colors shrink-0"
                    title="Upload custom scholar photo"
                  >
                    <Upload size={12} />
                    <span>Photo</span>
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
                      className="py-2 px-2 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 text-[10px] font-bold"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Mock Phone Screen Display Mode & Live Course Hub Pinning */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700/60 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                <Smartphone size={13} className="text-emerald-600" />
                3D Phone Screen Display Mode
              </label>
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                100% Vector HD Export
              </span>
            </div>

            <input
              ref={phoneScreenFileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhoneScreenUpload}
              className="hidden"
            />

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'course_hub_ui', label: 'Course Hub UI' },
                  { id: 'capabilities_list', label: '8-Feature List' },
                  { id: 'custom_screen_upload', label: 'Upload Screen' },
                ] as { id: FlyerPhoneScreenMode; label: string }[]
              ).map((modeOpt) => {
                const activeMode = flyerConfig.phoneScreenMode || 'course_hub_ui';
                return (
                  <button
                    key={modeOpt.id}
                    type="button"
                    onClick={() => {
                      if (modeOpt.id === 'custom_screen_upload' && !flyerConfig.customPhoneScreenDataUrl) {
                        phoneScreenFileInputRef.current?.click();
                        return;
                      }
                      setFlyerConfig({ ...flyerConfig, phoneScreenMode: modeOpt.id });
                    }}
                    className={`py-2 px-2.5 rounded-xl text-[11px] font-bold border transition-all ${
                      activeMode === modeOpt.id
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 hover:border-emerald-400'
                    }`}
                  >
                    {modeOpt.label}
                  </button>
                );
              })}
            </div>

            {(flyerConfig.phoneScreenMode || 'course_hub_ui') === 'custom_screen_upload' && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-900 p-2.5 border border-slate-200 dark:border-slate-700">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate">
                  {flyerConfig.customPhoneScreenDataUrl
                    ? 'Custom mobile screen image active'
                    : 'No custom screen uploaded yet'}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => phoneScreenFileInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-bold"
                  >
                    Change Image
                  </button>
                  {flyerConfig.customPhoneScreenDataUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        setFlyerConfig({
                          ...flyerConfig,
                          phoneScreenMode: 'course_hub_ui',
                          customPhoneScreenDataUrl: undefined,
                        })
                      }
                      className="px-2 py-1 rounded-lg bg-rose-50 text-rose-600 text-[10px] font-bold"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            )}

            {(flyerConfig.phoneScreenMode || 'course_hub_ui') === 'course_hub_ui' && (
              <div className="space-y-3 rounded-2xl bg-slate-50/80 dark:bg-slate-900/50 p-3 border border-slate-200/80 dark:border-slate-700">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      Phone Greeting Header
                    </label>
                    <input
                      type="text"
                      value={flyerConfig.phoneGreeting}
                      onChange={(e) => setFlyerConfig({ ...flyerConfig, phoneGreeting: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      Simulated Student Program (Department)
                    </label>
                    <select
                      value={activePhoneCohort.department}
                      onChange={(e) => handleSelectPhoneCohort({ department: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white"
                    >
                      {candidateCohortDepartments.map((dept) => {
                        const count = getEligibleCoursesForCohort(
                          marketingContext,
                          dept,
                          activePhoneCohort.level,
                          activePhoneCohort.semester
                        ).length;
                        return (
                          <option key={dept} value={dept}>
                            {dept} ({count} live in {activePhoneCohort.level}L {activePhoneCohort.semester === '1st Semester' ? 'Sem 1' : 'Sem 2'})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      Academic Level Cohort
                    </label>
                    <select
                      value={canonicalizeAcademicLevel(activePhoneCohort.level)}
                      onChange={(e) => handleSelectPhoneCohort({ level: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white"
                    >
                      {candidateCohortLevels.map((lvl) => {
                        const count = getEligibleCoursesForCohort(
                          marketingContext,
                          activePhoneCohort.department,
                          lvl,
                          activePhoneCohort.semester
                        ).length;
                        return (
                          <option key={lvl} value={lvl}>
                            {lvl} Level ({count} courses)
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase">
                      Semester Cohort
                    </label>
                    <select
                      value={canonicalizeAcademicSemester(activePhoneCohort.semester)}
                      onChange={(e) => handleSelectPhoneCohort({ semester: e.target.value })}
                      className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white"
                    >
                      {candidateCohortSemesters.map((sem) => {
                        const count = getEligibleCoursesForCohort(
                          marketingContext,
                          activePhoneCohort.department,
                          activePhoneCohort.level,
                          sem
                        ).length;
                        return (
                          <option key={sem} value={sem}>
                            {sem} ({count} courses)
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSynthesizeWithAI}
                  disabled={isSynthesizingAI}
                  className="w-full py-2 px-3 rounded-xl bg-emerald-600/10 hover:bg-emerald-600/20 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 text-[11px] font-extrabold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                >
                  {isSynthesizingAI ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      <span>AI Synthesizing Dynamic Copy & Design...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} />
                      <span>AI-Generate Dynamic Flyer Copy, Captions & Design</span>
                    </>
                  )}
                </button>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">
                      Cohort Eligible Courses ({phoneHubCourses.length}/8 in Phone 4×2 Grid)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleSelectPhoneCohort({
                          department: activePhoneCohort.department,
                          level: activePhoneCohort.level,
                          semester: activePhoneCohort.semester,
                        })
                      }
                      className="text-[9.5px] font-bold text-emerald-600 hover:underline"
                    >
                      Reset cohort order
                    </button>
                  </div>
                  <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                    {activePhoneCohort.courses.map((course) => {
                      const pinnedIdx = phoneHubCourses.findIndex((c) => c.id === course.id);
                      const isPinned = pinnedIdx !== -1;
                      return (
                        <div
                          key={course.id}
                          className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border text-xs transition-all ${
                            isPinned
                              ? 'bg-white dark:bg-slate-800 border-emerald-500/60 text-slate-900 dark:text-white shadow-2xs'
                              : 'bg-slate-100/60 dark:bg-slate-900/30 border-slate-200/70 dark:border-slate-800 text-slate-500'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleTogglePinnedPhoneCourse(course.id)}
                            className="flex items-center gap-2 min-w-0 flex-1 text-left"
                          >
                            <span
                              className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold shrink-0 ${
                                isPinned
                                  ? 'bg-emerald-600 text-white'
                                  : 'border border-slate-300 dark:border-slate-600'
                              }`}
                            >
                              {isPinned ? pinnedIdx + 1 : ''}
                            </span>
                            <span className="font-extrabold shrink-0">{course.id}</span>
                            <span className="truncate text-[11px] font-medium">{course.title}</span>
                          </button>

                          {isPinned && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleMovePinnedPhoneCourse(course.id, 'up')}
                                disabled={pinnedIdx === 0}
                                title="Move earlier in phone grid"
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"
                              >
                                <ArrowUp size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMovePinnedPhoneCourse(course.id, 'down')}
                                disabled={pinnedIdx === phoneHubCourses.length - 1}
                                title="Move later in phone grid"
                                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30"
                              >
                                <ArrowDown size={11} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
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
            <button
              type="button"
              onClick={handleSaveAssetVersion}
              disabled={isSavingVersion}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2.5 text-xs font-black text-indigo-800 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-200"
            >
              <Save size={15} />
              {isSavingVersion ? 'Saving version…' : 'Save version'}
            </button>
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
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
                <BarChart3 size={17} className="text-emerald-600" />
                Recorded campaign performance
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Metrics are read from persisted campaign events for <code>{currentAssetKey}</code>; no estimated or preview activity is included.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setAnalyticsLoading(true);
                setAnalyticsError(null);
                getMarketingCampaignAnalytics(currentAssetKey)
                  .then(setCampaignAnalytics)
                  .catch((error: any) => {
                    setCampaignAnalytics(null);
                    setAnalyticsError(error?.message || 'Campaign metrics could not be verified.');
                  })
                  .finally(() => setAnalyticsLoading(false));
              }}
              disabled={analyticsLoading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {analyticsLoading ? 'Refreshing…' : 'Refresh metrics'}
            </button>
          </div>
          {analyticsError && (
            <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              {analyticsError}
            </p>
          )}
          {!analyticsError && analyticsLoading && !campaignAnalytics && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Loading recorded campaign events…</p>
          )}
          {campaignAnalytics && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
                {[
                  ['QR-attributed landings', campaignAnalytics.metrics.qrLandings],
                  ['Landing visits', campaignAnalytics.metrics.landingVisits],
                  ['Completed registrations', campaignAnalytics.metrics.registrations],
                  ['Paid conversions', campaignAnalytics.metrics.paidConversions],
                  ['Unique sessions', campaignAnalytics.metrics.uniqueVisitors],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
                    <div className="text-xl font-black tabular-nums text-slate-900 dark:text-white">
                      {Number(value).toLocaleString()}
                    </div>
                    <div className="mt-1 text-[10px] font-semibold leading-4 text-slate-500 dark:text-slate-400">{label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-[10px] leading-4 text-slate-500 dark:text-slate-400">
                QR-attributed landings count opens of the QR-tagged URL that reach an instrumented UniAce page; they do not measure physical camera scans. Unique sessions are browser sessions, not verified people. {campaignAnalytics.metrics.lastEventAt ? `Last recorded event: ${new Date(campaignAnalytics.metrics.lastEventAt).toLocaleString()}.` : 'No campaign events have been recorded yet.'}
              </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
                <History size={17} className="text-indigo-500" />
                Saved design versions
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Immutable snapshots for this campaign target, stored in Neon PostgreSQL. Restoring a version does not publish or export it.
              </p>
            </div>
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              {isLoadingHistory ? 'Loading history…' : `${assetHistory.length} saved version(s)`}
            </span>
          </div>
          {historyError && (
            <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              {historyError}
            </p>
          )}
          {!isLoadingHistory && !historyError && assetHistory.length === 0 && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              No saved versions exist for this target yet. Save the current design to create version 1.
            </p>
          )}
          {assetHistory.length > 0 && (
            <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-700">
              {assetHistory.map((version) => (
                <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-slate-800 dark:text-slate-100">
                      v{version.version} · {version.assetName}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                      {version.createdAt ? new Date(version.createdAt).toLocaleString() : 'Timestamp not reported'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRestoreAssetVersion(version.id)}
                    disabled={Boolean(restoringVersionId)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    {restoringVersionId === version.id ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

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
          {(() => {
            const activeLayout: FlyerLayoutVariant =
              flyerConfig.layoutVariant || 'classic_campus_split';
            const activeWave: FlyerWaveStyle = flyerConfig.waveStyle || 'curved';
            const isMirroredBento = activeLayout === 'modern_bento_showcase';
            const isFramedEditorial =
              activeLayout === 'modern_bento_showcase' ||
              activeLayout === 'executive_spotlight';
            const showScopeRibbon =
              activeLayout === 'executive_spotlight' ||
              activeLayout === 'academic_crest_editorial';
            const rawTilt =
              typeof flyerConfig.phoneTiltDeg === 'number' ? flyerConfig.phoneTiltDeg : 2;
            const effectivePhoneTilt = isMirroredBento && rawTilt > 0 ? -rawTilt : rawTilt;
            const totalCohortModules = activePhoneCohort.courses.reduce(
              (sum, c) => sum + (c.syllabus?.length || 0),
              0
            );
            const wavePathByStyle: Record<FlyerWaveStyle, string> = {
              curved: 'M 0 50 L 0 20 Q 260 48, 520 11 L 760 0 L 760 50 Z',
              diagonal: 'M 0 50 L 0 36 L 760 0 L 760 50 Z',
              stepped: 'M 0 50 L 0 32 L 260 32 L 310 16 L 540 16 L 590 2 L 760 2 L 760 50 Z',
              architectural_arch: 'M 0 50 L 0 34 Q 380 -10, 760 34 L 760 50 Z',
            };

            return (
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
                {/* Dynamic Palette Bokeh Backdrop */}
                <div
                  className="absolute inset-x-0 top-0 h-[690px] pointer-events-none"
                  style={{
                    background: palette.bokehGradient,
                  }}
                />

                {/* Dynamic Geometric Backdrop Accents Adapting to Layout Variant & Palette */}
                <svg
                  viewBox="0 0 760 720"
                  className="absolute inset-x-0 top-0 w-full h-[720px] pointer-events-none"
                  preserveAspectRatio="none"
                >
                  {isMirroredBento ? (
                    <>
                      <path
                        d="M 0 110 C 140 175, 240 250, 390 210 L 430 700 L 0 700 Z"
                        fill={palette.accentText}
                        fillOpacity="0.14"
                      />
                      <path
                        d="M 0 300 C 180 340, 310 270, 490 330 L 520 720 L 0 720 Z"
                        fill={palette.accentText}
                        fillOpacity="0.2"
                      />
                    </>
                  ) : activeLayout === 'academic_crest_editorial' ? (
                    <>
                      <circle
                        cx="610"
                        cy="260"
                        r="230"
                        fill={palette.accentText}
                        fillOpacity="0.11"
                      />
                      <path
                        d="M 380 240 L 760 120 L 760 720 L 240 720 Z"
                        fill={palette.accentText}
                        fillOpacity="0.18"
                      />
                    </>
                  ) : (
                    <>
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
                    </>
                  )}
                </svg>

                {/* ================= TOP & MIDDLE CONTENT AREA ================= */}
                <div className="relative z-10 px-10 pt-8 flex-1 flex flex-col">
                  {/* Top Header Row: Dynamic Brand Emblem + Dynamic Script Callout / Scope Badge */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      {/* Dynamic Brand Icon Box */}
                      <div
                        className="w-[70px] h-[70px] rounded-[20px] flex items-center justify-center shadow-lg relative overflow-hidden shrink-0"
                        style={{ background: palette.deckGradient }}
                      >
                        <svg viewBox="0 0 64 64" className="w-11 h-11">
                          <path
                            d="M10 18 C18 15, 26 17, 32 22 C38 17, 46 15, 54 18 L54 48 C46 45, 38 47, 32 52 C26 47, 18 45, 10 48 Z"
                            fill="#ffffff"
                          />
                          <path
                            d="M32 22 L32 51"
                            stroke={palette.accentLight}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />
                          <path
                            d="M48 8 L50.5 14.5 L57 17 L50.5 19.5 L48 26 L45.5 19.5 L39 17 L45.5 14.5 Z"
                            fill={palette.ctaBg}
                          />
                        </svg>
                      </div>

                      <div>
                        <div className="flex items-baseline gap-2">
                          <span
                            className="text-[35px] font-black tracking-tight leading-none"
                            style={{ color: palette.darkHeadline }}
                          >
                            UniAce
                          </span>
                          <span
                            className="text-[35px] font-black tracking-tight leading-none"
                            style={{ color: palette.accentText }}
                          >
                            Mastery AI
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 text-[13.5px] font-semibold tracking-[0.16em] text-slate-700 uppercase">
                          <span>{flyerConfig.brandSubline[0] || 'Learn'}</span>
                          <span style={{ color: palette.accentText }}>•</span>
                          <span>{flyerConfig.brandSubline[1] || 'Practise'}</span>
                          <span style={{ color: palette.accentText }}>•</span>
                          <span>{flyerConfig.brandSubline[2] || 'Revise'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Top Right Dynamic Callout */}
                    <div className="text-right -rotate-[6deg] pr-1 pt-0.5">
                      <div
                        style={{
                          fontFamily: "'Caveat', 'Comic Sans MS', 'Bradley Hand', cursive",
                          color: palette.scriptColor,
                        }}
                        className="text-[27px] font-bold leading-tight"
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

                  {/* Dynamic Scope & Cohort Ribbon for Executive / Crest Layouts */}
                  {showScopeRibbon && (
                    <div
                      style={{
                        backgroundColor: palette.accentSoftBg,
                        borderColor: palette.accentBorder,
                        color: palette.darkHeadline,
                      }}
                      className="mt-3 px-3.5 py-1.5 rounded-xl border flex items-center justify-between text-[11px] font-extrabold shadow-2xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          style={{ backgroundColor: palette.accentText }}
                          className="px-2 py-0.5 rounded-md text-white text-[9.5px] font-black uppercase tracking-wider"
                        >
                          {targetScope.replace('_', ' ')}
                        </span>
                        <span className="truncate">
                          {activePhoneCohort.department} • {activePhoneCohort.levelLabel} •{' '}
                          {activePhoneCohort.semesterLabel}
                        </span>
                      </div>
                      <span
                        style={{ color: palette.accentText }}
                        className="font-black shrink-0 ml-2"
                      >
                        {activePhoneCohort.courses.length} Live Courses • {totalCohortModules}{' '}
                        Modules
                      </span>
                    </div>
                  )}

                  {/* Main Dynamic Split Grid (Adapts Column Order & Card Framing by Layout Variant) */}
                  <div
                    className={`grid grid-cols-12 gap-4 ${
                      showScopeRibbon ? 'mt-4' : 'mt-6'
                    } flex-1 relative`}
                  >
                    {/* EDITORIAL + HERO COLUMN (7 Cols) */}
                    <div
                      className={`col-span-7 flex flex-col justify-between z-10 ${
                        isMirroredBento ? 'order-2 pl-2' : 'order-1 pr-2'
                      }`}
                    >
                      <div
                        style={
                          isFramedEditorial
                            ? {
                                backgroundColor: 'rgba(255, 255, 255, 0.84)',
                                borderColor: palette.accentBorder,
                              }
                            : undefined
                        }
                        className={
                          isFramedEditorial
                            ? 'space-y-3.5 p-4 rounded-2xl border shadow-sm'
                            : 'space-y-4'
                        }
                      >
                        <h1
                          className={`${
                            isFramedEditorial ? 'text-[46px]' : 'text-[50px]'
                          } font-black leading-[1.04] tracking-tight`}
                        >
                          <span className="block" style={{ color: palette.darkHeadline }}>
                            {flyerConfig.headlineLine1}
                          </span>
                          <span className="block" style={{ color: palette.accentText }}>
                            {flyerConfig.headlineLine2}
                          </span>
                        </h1>

                        <p
                          className="text-[18px] font-extrabold leading-[1.34] max-w-[400px]"
                          style={{ color: palette.darkHeadline }}
                        >
                          {flyerConfig.leadBoldParagraph}
                        </p>

                        <p className="text-[15px] font-medium text-slate-700 leading-[1.42] max-w-[395px]">
                          {flyerConfig.subParagraph}
                        </p>
                      </div>

                      {/* Dynamic Hero Visual Section (Scholar Vector OR Live Cohort Curriculum Card OR Custom Photo) */}
                      <div className="relative mt-2 h-[325px] flex items-end">
                        {/* Dynamic Handwritten Callout */}
                        <div
                          className={`absolute ${
                            flyerConfig.studentPortraitMode === 'academic_cohort_card'
                              ? 'right-3 -top-3'
                              : 'right-2 top-8'
                          } -rotate-[7deg] z-20 text-center`}
                        >
                          <div
                            style={{
                              fontFamily: "'Caveat', 'Comic Sans MS', 'Bradley Hand', cursive",
                              color: palette.darkHeadline,
                            }}
                            className="text-[22px] font-bold leading-none"
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

                        {/* Hero Visual Container */}
                        <div className="relative w-full h-[315px] flex items-end justify-start">
                          {flyerConfig.studentPortraitMode === 'custom_photo' &&
                          flyerConfig.customPhotoDataUrl ? (
                            <div
                              style={{ backgroundColor: palette.footerStripBg }}
                              className="w-[290px] h-[300px] rounded-t-[36px] rounded-b-[18px] overflow-hidden shadow-2xl border-4 border-white relative"
                            >
                              <img
                                src={flyerConfig.customPhotoDataUrl}
                                alt="University Scholar"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : flyerConfig.studentPortraitMode === 'academic_cohort_card' ? (
                            /* 100% Data-Driven Live Cohort & Curriculum Showcase Card (Zero Static Character Illustration) */
                            <div
                              style={{
                                borderColor: palette.accentBorder,
                                background: 'rgba(255, 255, 255, 0.94)',
                              }}
                              className="w-[385px] rounded-2xl border-2 p-4 shadow-xl space-y-3 mb-3"
                            >
                              <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                                <div>
                                  <div
                                    style={{ color: palette.accentText }}
                                    className="text-[10px] font-black uppercase tracking-wider"
                                  >
                                    LIVE COHORT CURRICULUM SNAPSHOT
                                  </div>
                                  <div
                                    style={{ color: palette.darkHeadline }}
                                    className="text-[15px] font-black leading-tight mt-0.5"
                                  >
                                    {activePhoneCohort.department}
                                  </div>
                                </div>
                                <span
                                  style={{
                                    backgroundColor: palette.accentSoftBg,
                                    color: palette.accentText,
                                    borderColor: palette.accentBorder,
                                  }}
                                  className="px-2.5 py-1 rounded-lg border text-[10px] font-black shrink-0"
                                >
                                  {activePhoneCohort.levelLabel} • {activePhoneCohort.semesterLabel}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-1.5">
                                {phoneHubCourses.slice(0, 6).map((course) => (
                                  <div
                                    key={course.id}
                                    className="px-2.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200/90 flex items-center justify-between gap-1.5"
                                  >
                                    <div className="min-w-0">
                                      <div
                                        style={{ color: palette.darkHeadline }}
                                        className="text-[10.5px] font-black leading-tight truncate"
                                      >
                                        {course.id}
                                      </div>
                                      <div className="text-[8.5px] font-semibold text-slate-600 truncate">
                                        {course.title}
                                      </div>
                                    </div>
                                    <span
                                      style={{
                                        backgroundColor: palette.accentSoftBg,
                                        color: palette.accentText,
                                      }}
                                      className="px-1.5 py-0.5 rounded text-[7.5px] font-black shrink-0"
                                    >
                                      {course.syllabus?.length || 0}M
                                    </span>
                                  </div>
                                ))}
                              </div>

                              <div className="pt-1 flex items-center justify-between text-[10px] font-bold text-slate-600">
                                <span>
                                  Verified Offerings: {activePhoneCohort.courses.length} Courses
                                </span>
                                <span style={{ color: palette.accentText }} className="font-black">
                                  {totalCohortModules} Published Modules
                                </span>
                              </div>
                            </div>
                          ) : (
                            /* Theme-Adaptive Vector University Scholar (Zero Hardcoded Greens) */
                            <svg viewBox="0 0 360 340" className="w-[330px] h-full drop-shadow-xl">
                              <defs>
                                <linearGradient id="hoodieGrad" x1="0" y1="0" x2="1" y2="1">
                                  <stop offset="0%" stopColor={palette.hoodiePrimary} />
                                  <stop offset="60%" stopColor={palette.hoodieSecondary} />
                                  <stop offset="100%" stopColor={palette.hoodieDark} />
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

                              {/* Dynamic Palette Campus Glow Circles in Background */}
                              <circle
                                cx="75"
                                cy="120"
                                r="55"
                                fill={palette.accentText}
                                fillOpacity="0.16"
                              />
                              <circle
                                cx="255"
                                cy="145"
                                r="45"
                                fill={palette.hoodiePrimary}
                                fillOpacity="0.14"
                              />

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

                              {/* Dynamic Hood Collar & White Drawstrings */}
                              <path
                                d="M112 156 Q150 185 188 156"
                                fill={palette.hoodieSecondary}
                                stroke={palette.hoodieDark}
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
                              <ellipse
                                cx="116"
                                cy="168"
                                rx="14"
                                ry="18"
                                transform="rotate(-20 116 168)"
                                fill="#0f172a"
                                stroke="#334155"
                                strokeWidth="2"
                              />
                              <ellipse
                                cx="184"
                                cy="168"
                                rx="14"
                                ry="18"
                                transform="rotate(20 184 168)"
                                fill="#0f172a"
                                stroke="#334155"
                                strokeWidth="2"
                              />

                              {/* Neck & Head */}
                              <rect
                                x="133"
                                y="124"
                                width="34"
                                height="38"
                                rx="12"
                                fill="url(#skinGrad)"
                              />
                              <circle cx="112" cy="96" r="10" fill="#6b3e17" />
                              <circle cx="192" cy="94" r="10" fill="#6b3e17" />
                              <path
                                d="M114 74 C114 44, 188 44, 190 74 C192 114, 178 142, 152 144 C126 142, 112 114, 114 74 Z"
                                fill="url(#skinGrad)"
                              />

                              {/* Textured Hair */}
                              <path
                                d="M113 76 C110 42, 134 26, 154 27 C178 27, 195 44, 191 75 C184 62, 168 56, 152 56 C134 56, 120 62, 113 76 Z"
                                fill="#111827"
                              />

                              {/* Eyes & Confident Smile */}
                              <path
                                d="M128 82 Q137 78 145 81"
                                stroke="#111827"
                                strokeWidth="3"
                                strokeLinecap="round"
                                fill="none"
                              />
                              <path
                                d="M161 81 Q170 78 178 82"
                                stroke="#111827"
                                strokeWidth="3"
                                strokeLinecap="round"
                                fill="none"
                              />
                              <path
                                d="M130 92 Q137 96 144 92"
                                stroke="#111827"
                                strokeWidth="2.8"
                                strokeLinecap="round"
                                fill="none"
                              />
                              <path
                                d="M162 92 Q169 96 176 92"
                                stroke="#111827"
                                strokeWidth="2.8"
                                strokeLinecap="round"
                                fill="none"
                              />
                              <path
                                d="M153 92 L150 107 L158 109"
                                stroke="#4a290d"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                fill="none"
                              />
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
                              <ellipse cx="176" cy="256" rx="18" ry="12" fill="url(#skinGrad)" />
                              <ellipse cx="212" cy="252" rx="16" ry="11" fill="url(#skinGrad)" />

                              {/* Study Desk, Stacked Textbooks & Open Notebook */}
                              <rect
                                x="4"
                                y="294"
                                width="320"
                                height="22"
                                rx="4"
                                fill="url(#tableGrad)"
                              />
                              <rect
                                x="8"
                                y="262"
                                width="88"
                                height="16"
                                rx="3"
                                fill={palette.ctaBg}
                                stroke="#78350f"
                                strokeWidth="1.5"
                              />
                              <rect x="14" y="265" width="78" height="10" rx="1" fill="#fef3c7" />
                              <rect
                                x="4"
                                y="278"
                                width="96"
                                height="16"
                                rx="3"
                                fill={palette.accentText}
                                stroke={palette.hoodieDark}
                                strokeWidth="1.5"
                              />
                              <rect x="10" y="281" width="86" height="10" rx="1" fill="#f8fafc" />
                              <path
                                d="M118 286 L256 286 L268 296 L108 296 Z"
                                fill="#ffffff"
                                stroke="#cbd5e1"
                                strokeWidth="2"
                              />
                              <line
                                x1="188"
                                y1="286"
                                x2="188"
                                y2="296"
                                stroke="#94a3b8"
                                strokeWidth="2"
                              />
                            </svg>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 3D SMARTPHONE COLUMN (5 Cols): Crisp High-Clarity 3D Smartphone Showcasing Live UniAce Course Hub */}
                    <div
                      className={`col-span-5 relative flex items-start ${
                        isMirroredBento ? 'order-1 justify-start pl-0' : 'order-2 justify-end pr-0'
                      } pt-0.5 z-20`}
                    >
                      <div
                        className="w-[330px] rounded-[40px] p-[8px] shadow-[0_28px_60px_rgba(0,0,0,0.45)] relative antialiased"
                        style={{
                          transform: `rotate(${effectivePhoneTilt}deg)`,
                          background:
                            'linear-gradient(145deg, #334155 0%, #0f172a 50%, #020617 100%)',
                          border: '2px solid #64748b',
                        }}
                      >
                        {/* Inner Phone Screen */}
                        <div className="bg-[#f8fafc] rounded-[32px] overflow-hidden flex flex-col justify-between h-[632px] border border-slate-200">
                          {/* Phone Top Status Bar + Dynamic Island */}
                          <div className="px-5 pt-2 pb-1 flex items-center justify-between text-[11px] font-black text-slate-900 bg-white shrink-0">
                            <span>9:41</span>
                            <div className="w-18 h-3.5 bg-black rounded-full" />
                            <div className="flex items-center gap-1 text-slate-900">
                              <Signal size={10.5} />
                              <Wifi size={10.5} />
                              <BatteryCharging size={11.5} />
                            </div>
                          </div>

                          {(flyerConfig.phoneScreenMode || 'course_hub_ui') ===
                            'custom_screen_upload' && flyerConfig.customPhoneScreenDataUrl ? (
                            <div className="flex-1 w-full overflow-hidden bg-white relative">
                              <img
                                src={flyerConfig.customPhoneScreenDataUrl}
                                alt="UniAce App Interface"
                                className="w-full h-full object-cover object-top"
                              />
                            </div>
                          ) : (flyerConfig.phoneScreenMode || 'course_hub_ui') ===
                              'course_hub_ui' && phoneHubCourses.length > 0 ? (
                            <>
                              {/* LIVE COURSE HUB INTERFACE (High-Contrast Vector 8-Card 4x2 Mobile Hub Layout) */}
                              <div className="px-2.5 pt-1 pb-1 bg-[#f8fafc] flex-1 min-h-0 flex flex-col justify-between overflow-hidden relative">
                                {/* Top Greeting + Current Program Banner + Your Courses + Search Toolbar */}
                                <div className="space-y-1 shrink-0">
                                  <div
                                    data-flyer-unclip="true"
                                    className="text-[13px] font-black text-[#0f172a] tracking-tight leading-[1.18] px-0.5"
                                  >
                                    {flyerConfig.phoneGreeting || 'Hello, Scholar 👋'}
                                  </div>

                                  {/* Current Program Card */}
                                  <div className="bg-white rounded-xl border border-slate-300/90 px-2.5 py-1.5 shadow-2xs flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div
                                        data-flyer-unclip="true"
                                        className="text-[6.2px] font-extrabold uppercase tracking-[0.08em] text-slate-500 leading-[1.15]"
                                      >
                                        CURRENT PROGRAM
                                      </div>
                                      <div
                                        data-flyer-unclip="true"
                                        className="text-[10.5px] font-black text-[#0f172a] leading-[1.2] mt-0.5 truncate"
                                      >
                                        {activePhoneCohort.department}
                                      </div>
                                      <div className="flex items-center gap-1.5 mt-1">
                                        <span
                                          data-flyer-unclip="true"
                                          className="inline-flex items-center gap-1 px-1.5 py-[1.5px] rounded-md bg-indigo-50 text-indigo-800 border border-indigo-200 text-[6.8px] font-extrabold leading-[1.15]"
                                        >
                                          <GraduationCap size={8} />
                                          <span>{activePhoneCohort.levelLabel}</span>
                                        </span>
                                        <span
                                          data-flyer-unclip="true"
                                          style={{
                                            backgroundColor: palette.accentSoftBg,
                                            color: palette.accentText,
                                            borderColor: palette.accentBorder,
                                          }}
                                          className="inline-flex items-center gap-1 px-1.5 py-[1.5px] rounded-md border text-[6.8px] font-extrabold leading-[1.15]"
                                        >
                                          <Calendar size={8} />
                                          <span>{activePhoneCohort.semesterLabel}</span>
                                        </span>
                                      </div>
                                    </div>
                                    <div className="w-5 h-5 rounded-full bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-600 shrink-0 mt-0.5">
                                      <Pencil size={8} />
                                    </div>
                                  </div>

                                  {/* Standalone "Your Courses" Dark Pill Row */}
                                  <div className="pt-0.5">
                                    <div
                                      style={{ backgroundColor: palette.darkHeadline }}
                                      className="text-white rounded-lg px-2.5 py-1 inline-flex items-center gap-1 shadow-2xs"
                                    >
                                      <Sparkles size={8} style={{ color: palette.ctaBg }} />
                                      <span
                                        data-flyer-unclip="true"
                                        className="text-[7.4px] font-black leading-[1.15]"
                                      >
                                        Your Courses
                                      </span>
                                    </div>
                                  </div>

                                  {/* Search Bar + Explore All + Dynamic Cohort Course Count Bell + Avatar Row */}
                                  <div className="flex items-center justify-between gap-1.5">
                                    <div className="flex-1 bg-white rounded-lg border border-slate-300/90 px-2 py-1 flex items-center gap-1 text-slate-500 min-w-0 shadow-2xs">
                                      <Search size={8} className="shrink-0 text-slate-500" />
                                      <span
                                        data-flyer-unclip="true"
                                        className="text-[7px] font-semibold truncate leading-[1.15]"
                                      >
                                        Search courses...
                                      </span>
                                    </div>

                                    <div className="inline-flex items-center gap-0.5 text-slate-700 shrink-0">
                                      <Globe size={8} />
                                      <span
                                        data-flyer-unclip="true"
                                        className="text-[6.8px] font-extrabold leading-[1.15]"
                                      >
                                        Explore All
                                      </span>
                                    </div>

                                    <div className="relative text-slate-700 shrink-0">
                                      <Bell size={9} />
                                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-rose-600 text-white text-[5.2px] font-black flex items-center justify-center">
                                        {activePhoneCohort.courses.length}
                                      </span>
                                    </div>

                                    <div
                                      style={{ backgroundColor: palette.darkHeadline }}
                                      className="w-5 h-5 rounded-full text-white text-[7px] font-black flex items-center justify-center border border-slate-300 shrink-0"
                                    >
                                      🎓
                                    </div>
                                  </div>
                                </div>

                                {/* 2-Column × 4-Row (8 Cards) Full-Height High-Clarity Course Grid */}
                                <div className="grid grid-cols-2 grid-rows-4 gap-1.5 mt-1.5 flex-1 min-h-0">
                                  {phoneHubCourses.slice(0, 8).map((course, idx) => {
                                    const levelCompact = formatAcademicLevelBadge(course.level).compact;
                                    const semCompact = formatAcademicSemesterBadge(course.semester).compact;
                                    const scopeBadge = formatCourseScopeBadge(course);
                                    const cleanCode = course.id.replace(/\s+/g, '').toUpperCase();
                                    const hasCodeInTitle =
                                      course.title
                                        .toUpperCase()
                                        .replace(/\s+/g, '')
                                        .startsWith(cleanCode.slice(0, 6)) ||
                                      /^[A-Z]{2,4}\s*\d{3}/i.test(course.title.trim());
                                    const displayTitle = hasCodeInTitle
                                      ? course.title
                                      : `${course.id}: ${course.title}`;
                                    const rawDesc =
                                      course.description?.trim() ||
                                      `Comprehensive ${levelCompact} university course covering ${course.syllabus?.length || 4} structured academic modules.`;
                                    const shortDesc =
                                      rawDesc.length > 94
                                        ? `${rawDesc.slice(0, 92).trimEnd()}…`
                                        : rawDesc;
                                    const isContinue =
                                      idx < 2 ||
                                      (targetScope === 'course' && course.id === selectedCourseId);

                                    return (
                                      <div
                                        key={course.id}
                                        className="bg-white rounded-xl border border-slate-300/90 p-2 shadow-2xs flex flex-col justify-between min-w-0 h-full"
                                      >
                                        <div>
                                          {/* Scope Badge + Course Code Pill */}
                                          <div className="flex items-center justify-between gap-1">
                                            <span
                                              data-flyer-unclip="true"
                                              className="text-[5.6px] font-black uppercase tracking-wider text-slate-600 truncate leading-[1.15]"
                                            >
                                              {scopeBadge}
                                            </span>
                                            <span
                                              data-flyer-unclip="true"
                                              className="px-1.5 py-[1px] rounded bg-slate-100 border border-slate-200 text-[#0f172a] text-[6px] font-black shrink-0 leading-[1.15]"
                                            >
                                              {course.id}
                                            </span>
                                          </div>

                                          {/* Course Title */}
                                          <div
                                            data-flyer-unclip="true"
                                            className="text-[8.1px] font-black text-[#0f172a] leading-[1.18] mt-0.5 line-clamp-2"
                                          >
                                            {displayTitle.length > 48
                                              ? `${displayTitle.slice(0, 46).trimEnd()}…`
                                              : displayTitle}
                                          </div>

                                          {/* Course Description Snippet */}
                                          <div
                                            data-flyer-unclip="true"
                                            className="text-[6.2px] text-[#334155] font-semibold leading-[1.2] mt-0.5 line-clamp-3"
                                          >
                                            {shortDesc}
                                          </div>
                                        </div>

                                        {/* Card Footer: L 100 • Sem 1 + Continue/Start Learning CTA */}
                                        <div className="pt-1 border-t border-slate-200/80 flex items-center justify-between gap-1 shrink-0">
                                          <div className="flex items-center gap-0.5 text-[5.8px] font-extrabold text-slate-600 whitespace-nowrap leading-[1.15]">
                                            <Users size={6.5} className="shrink-0 text-slate-500" />
                                            <span data-flyer-unclip="true">{levelCompact}</span>
                                            <Calendar
                                              size={6.2}
                                              className="shrink-0 ml-0.5 text-slate-500"
                                            />
                                            <span data-flyer-unclip="true">{semCompact}</span>
                                          </div>
                                          <div
                                            data-flyer-unclip="true"
                                            style={{
                                              backgroundColor: isContinue
                                                ? palette.accentText
                                                : '#0f172a',
                                            }}
                                            className="text-white rounded-md px-1.5 py-[2.5px] text-[5.8px] font-black whitespace-nowrap leading-[1.1] shrink-0"
                                          >
                                            {isContinue ? 'Continue Learning' : 'Start Learning'}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Authentic UniAce Bottom Navigation Bar with Dynamic Palette AI Chat Button */}
                              <div className="px-4 py-1.5 bg-white/95 backdrop-blur-xs border-t border-slate-200 flex items-center justify-between text-[7.5px] font-bold text-slate-400 leading-[1.2] shrink-0 relative z-10">
                                <div
                                  className="flex flex-col items-center gap-0.5"
                                  style={{ color: palette.accentText }}
                                >
                                  <LayoutGrid size={11} />
                                  <span data-flyer-unclip="true">Hub</span>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                  <Home size={11} />
                                  <span data-flyer-unclip="true">Home</span>
                                </div>
                                <div className="flex flex-col items-center -mt-3.5">
                                  <div
                                    style={{ backgroundColor: palette.accentText }}
                                    className="w-7 h-7 rounded-full text-white shadow-md border-2 border-white flex items-center justify-center"
                                  >
                                    <MessageSquare size={12} />
                                  </div>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                  <Trophy size={11} />
                                  <span data-flyer-unclip="true">Arena</span>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                  <User size={11} />
                                  <span data-flyer-unclip="true">Profile</span>
                                </div>
                              </div>
                            </>
                          ) : (
                            <>
                              {/* 8-CAPABILITY LIST PHONE SCREEN MODE */}
                              <div className="px-4 pt-1 pb-1.5 bg-white border-b border-slate-100 shrink-0">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[11px] font-black shrink-0"
                                    style={{ backgroundColor: palette.accentText }}
                                  >
                                    🎓
                                  </div>
                                  <span
                                    data-flyer-unclip="true"
                                    className="text-[12.5px] font-black text-slate-900 leading-[1.3]"
                                  >
                                    UniAce{' '}
                                    <span style={{ color: palette.accentText }}>Mastery AI</span>
                                  </span>
                                </div>
                                <div className="mt-1">
                                  <div
                                    data-flyer-unclip="true"
                                    className="text-[13px] font-black text-slate-900 leading-[1.3]"
                                  >
                                    {flyerConfig.phoneGreeting}
                                  </div>
                                  <div
                                    data-flyer-unclip="true"
                                    className="text-[10px] text-slate-500 font-medium leading-[1.3]"
                                  >
                                    {flyerConfig.phonePrompt}
                                  </div>
                                </div>
                              </div>

                              <div className="px-2.5 py-1.5 space-y-1 flex-1 flex flex-col justify-center bg-[#f1f5f9]">
                                {enabledCapabilities.map((cap) => (
                                  <div
                                    key={cap.id}
                                    className="bg-white rounded-xl px-2.5 py-1 border border-slate-200/80 shadow-2xs flex items-center justify-between gap-2"
                                  >
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <div
                                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 shadow-2xs"
                                        style={{ backgroundColor: cap.accentHex }}
                                      >
                                        {renderCapabilityIcon(cap.iconKey, 14)}
                                      </div>
                                      <div className="min-w-0 flex-1 overflow-visible">
                                        <div
                                          data-flyer-unclip="true"
                                          className="text-[10.5px] font-extrabold text-slate-900 leading-[1.32] pb-[1px] whitespace-nowrap"
                                        >
                                          {cap.title}
                                        </div>
                                        <div
                                          data-flyer-unclip="true"
                                          className="text-[8.5px] text-slate-500 font-medium leading-[1.32] pb-[1px] whitespace-nowrap"
                                        >
                                          {cap.phoneDescription.length > 42
                                            ? `${cap.phoneDescription.slice(0, 40).trimEnd()}…`
                                            : cap.phoneDescription}
                                        </div>
                                      </div>
                                    </div>
                                    <ChevronRight size={11} className="text-slate-400 shrink-0" />
                                  </div>
                                ))}
                              </div>

                              <div className="px-5 py-1.5 bg-white border-t border-slate-200 flex items-center justify-between text-[8.5px] font-bold text-slate-400 leading-[1.3] shrink-0">
                                <div
                                  className="flex flex-col items-center gap-0.5"
                                  style={{ color: palette.accentText }}
                                >
                                  <Home size={12} />
                                  <span data-flyer-unclip="true">Home</span>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                  <Library size={12} />
                                  <span data-flyer-unclip="true">Library</span>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                  <Calendar size={12} />
                                  <span data-flyer-unclip="true">Planner</span>
                                </div>
                                <div className="flex flex-col items-center gap-0.5">
                                  <User size={12} />
                                  <span data-flyer-unclip="true">Profile</span>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ================= LOWER DYNAMIC WAVE & FEATURE DECK ================= */}
                <div className="relative z-30 -mt-12">
                  {/* Dynamic Wave Geometry */}
                  <svg
                    viewBox="0 0 760 50"
                    className="w-full h-[50px] block -mb-1"
                    preserveAspectRatio="none"
                  >
                    <path d={wavePathByStyle[activeWave]} fill={palette.deckWaveFill} />
                  </svg>

                  <div
                    style={{ background: palette.deckGradient }}
                    className="px-9 pt-3.5 pb-4 text-white space-y-4"
                  >
                    {/* 8-Feature Grid (2 Rows x 4 Columns) */}
                    <div className="grid grid-cols-4 gap-x-4 gap-y-3.5">
                      {enabledCapabilities.map((cap, idx) => (
                        <div
                          key={cap.id}
                          className={`flex items-start gap-2.5 pr-2 ${
                            idx % 4 !== 3 ? 'border-r border-white/15' : ''
                          }`}
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 border-2 border-white shadow-md"
                            style={{ backgroundColor: cap.badgeBgHex }}
                          >
                            {renderCapabilityIcon(cap.iconKey, 16)}
                          </div>
                          <div className="min-w-0">
                            <div
                              data-flyer-unclip="true"
                              className="text-[12.5px] font-extrabold text-white leading-[1.3]"
                            >
                              {cap.title}
                            </div>
                            <div
                              data-flyer-unclip="true"
                              style={{ color: palette.accentMuted }}
                              className="text-[10px] font-medium leading-[1.32] mt-0.5 opacity-95"
                            >
                              {cap.gridDescription}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* CTA Bar: Visit Now Button + Live Domain + Scannable Vector QR Code + Support Line */}
                    <div className="pt-2 flex items-center justify-between gap-3 border-t border-white/15">
                      {/* Left: Visit Now CTA + Website URL */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          style={{ backgroundColor: palette.ctaBg, color: palette.ctaText }}
                          className="px-5 py-2.5 rounded-full font-black text-[17px] leading-[1.25] shadow-lg flex items-center justify-center gap-1.5 shrink-0"
                        >
                          <span data-flyer-unclip="true" className="pb-[1px]">
                            {flyerConfig.ctaText}
                          </span>
                          <ChevronRight size={19} strokeWidth={3} />
                        </div>
                        <span
                          data-flyer-unclip="true"
                          style={{
                            fontSize:
                              flyerConfig.websiteDisplayUrl.length > 32
                                ? '13.5px'
                                : flyerConfig.websiteDisplayUrl.length > 26
                                  ? '15px'
                                  : flyerConfig.websiteDisplayUrl.length > 20
                                    ? '17px'
                                    : '19.5px',
                          }}
                          className="font-extrabold tracking-tight text-white leading-[1.35] pb-[2px] whitespace-nowrap overflow-visible"
                        >
                          {flyerConfig.websiteDisplayUrl}
                        </span>
                      </div>

                      {/* Right: Real Vector SVG QR Code + Support Contact */}
                      <div className="flex items-center gap-3.5 shrink-0">
                        <div className="bg-white p-1.5 rounded-xl shadow-lg w-[64px] h-[64px] flex items-center justify-center">
                          {qrMatrix.length > 0 ? (
                            <svg
                              viewBox={`0 0 ${qrMatrix.length} ${qrMatrix.length}`}
                              className="w-full h-full"
                              shapeRendering="crispEdges"
                            >
                              <rect
                                width={qrMatrix.length}
                                height={qrMatrix.length}
                                fill="#ffffff"
                              />
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
                            <span className="text-[8px] text-center font-bold text-rose-600">
                              QR unavailable
                            </span>
                          )}
                        </div>

                        {flyerConfig.supportContact && (
                          <div className="flex items-center gap-2">
                            <div className="w-9 h-9 rounded-full bg-white/10 border border-white/25 flex items-center justify-center text-white shrink-0">
                              <Headphones size={18} />
                            </div>
                            <div>
                              <div
                                data-flyer-unclip="true"
                                style={{ color: palette.accentLight }}
                                className="text-[10.5px] font-semibold leading-[1.3]"
                              >
                                {flyerConfig.supportLabel}
                              </div>
                              <div
                                data-flyer-unclip="true"
                                className="text-[14.5px] font-black text-white leading-[1.3] tracking-tight"
                              >
                                {flyerConfig.supportContact}
                              </div>
                              <div
                                data-flyer-unclip="true"
                                style={{ color: palette.accentMuted }}
                                className="text-[10px] font-medium leading-[1.3] opacity-85"
                              >
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
                    style={{
                      backgroundColor: palette.footerStripBg,
                      color: palette.accentMuted,
                    }}
                    className="py-2.5 px-8 text-center text-[10.5px] font-bold tracking-[0.18em] uppercase flex items-center justify-center gap-4 leading-[1.35]"
                  >
                    <span data-flyer-unclip="true">{flyerConfig.footerPillars[0]}</span>
                    <span style={{ color: palette.accentLight }}>|</span>
                    <span data-flyer-unclip="true">{flyerConfig.footerPillars[1]}</span>
                    <span style={{ color: palette.accentLight }}>|</span>
                    <span data-flyer-unclip="true">{flyerConfig.footerPillars[2]}</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
