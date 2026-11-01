import React, { useState, useEffect, useRef } from 'react';
import { 
  Folder, 
  FolderPlus, 
  Upload, 
  Download, 
  Play, 
  Pause, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Trash2, 
  Edit3, 
  Archive, 
  Loader2, 
  Eye, 
  FileText, 
  Key, 
  ShieldCheck, 
  Sparkles, 
  Server, 
  RefreshCw, 
  ChevronRight,
  Info,
  Layers,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Database,
  UploadCloud,
  RotateCcw,
  Check,
  XCircle,
  Activity,
  ShieldAlert,
  Settings,
  Globe,
  Sliders,
  Copy,
  Plus
} from 'lucide-react';
import { SubtitleItem, SubtitleFormat, ToneOption } from '../types';
import { parseSubtitleFile } from '../lib/subtitleParser';
import { UILanguage } from '../lib/i18n';

export interface ServerFolderItem {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  projectCount: number;
  completedCount: number;
}

export interface ServerProjectItem {
  id: string;
  folderId: string;
  name: string;
  format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'sub';
  rawHeader?: string;
  sourceLanguage: string;
  targetLanguage: string;
  tone: string;
  customPrompt?: string;
  status: 'idle' | 'queued' | 'translating' | 'paused' | 'waiting_for_keys' | 'has_incomplete' | 'completed' | 'error';
  totalCues: number;
  translatedCues: number;
  currentBatchIndex: number;
  totalBatches: number;
  errorMessage?: string;
  lastError?: string;
  failedCueIds?: number[];
  workerKeyUsed?: string;
  items: SubtitleItem[];
  tokenUsage: {
    promptTokens: number;
    candidatesTokens: number;
    totalTokens: number;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkerStatusData {
  isRunning: boolean;
  activeProjectCount: number;
  maxConcurrentProjects: number;
  activeProjects: Array<{
    id: string;
    name: string;
    folderId: string;
    progressPercent: number;
    translatedCues: number;
    totalCues: number;
    keyMasked: string;
  }>;
  activeProjectId: string | null;
  activeProjectName: string | null;
  folderId: string | null;
  progressPercent: number;
  translatedCues: number;
  totalCues: number;
  currentKeyIndex: number;
  totalKeys: number;
  activeKeys: number;
  exhaustedKeys: number;
  lastMessage: string;
}

export interface ServerConfigData {
  allowedOrigin: string;
  geminiBaseUrl: string;
  maxConcurrentProjects: number;
}

export interface KeyDetailItem {
  index: number;
  rawKey: string;
  maskedKey: string;
  isExhausted: boolean;
  cooldownRemainingSec: number;
}

interface FolderProjectManagerProps {
  uiLang: UILanguage;
  onOpenProjectInEditor: (project: {
    id: string;
    name: string;
    items: SubtitleItem[];
    format: SubtitleFormat;
    rawHeader?: string;
  }) => void;
  onShowToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const FolderProjectManager: React.FC<FolderProjectManagerProps> = ({
  uiLang,
  onOpenProjectInEditor,
  onShowToast,
}) => {
  const [folders, setFolders] = useState<ServerFolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [projects, setProjects] = useState<ServerProjectItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState<boolean>(true);
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  
  // Background Worker status
  const [workerStatus, setWorkerStatus] = useState<WorkerStatusData | null>(null);

  // Modals & Panels
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDesc, setNewFolderDesc] = useState('');

  const [isEditFolderOpen, setIsEditFolderOpen] = useState(false);
  const [editFolderName, setEditFolderName] = useState('');
  const [editFolderDesc, setEditFolderDesc] = useState('');

  // Keys Management Modal
  const [isKeysModalOpen, setIsKeysModalOpen] = useState(false);
  const [serverKeysText, setServerKeysText] = useState('');
  const [serverKeysCount, setServerKeysCount] = useState(0);
  const [keysDetails, setKeysDetails] = useState<KeyDetailItem[]>([]);
  const [editingKeyIndex, setEditingKeyIndex] = useState<number | null>(null);
  const [editingKeyVal, setEditingKeyVal] = useState('');

  // Server & Network Configuration Modal
  const [isServerConfigOpen, setIsServerConfigOpen] = useState(false);
  const [serverConfig, setServerConfig] = useState<ServerConfigData>({
    allowedOrigin: '*',
    geminiBaseUrl: 'https://generativelanguage.googleapis.com',
    maxConcurrentProjects: 2,
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  // Server Info & Storage Location State
  const [serverInfo, setServerInfo] = useState<{
    databasePath: string;
    model: string;
    modelId: string;
    vpsReady: boolean;
    port: number;
    description: string;
  } | null>(null);

  // Restore Modal State
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [restoreJsonText, setRestoreJsonText] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);
  const restoreFileInputRef = useRef<HTMLInputElement>(null);

  // Key Testing State
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latencyMs?: number;
    message?: string;
    modelUsed?: string;
    keyTested?: string;
  } | null>(null);
  const [keySaveMode, setKeySaveMode] = useState<'append' | 'replace'>('append');

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadTone, setUploadTone] = useState<ToneOption>('cinematic');
  const [autoQueueOnUpload, setAutoQueueOnUpload] = useState(true);
  const [isZippingFolder, setIsZippingFolder] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Server Info & DB storage path
  const fetchServerInfo = async () => {
    try {
      const res = await fetch('/api/server/info');
      const data = await res.json();
      if (data.success) {
        setServerInfo(data);
      }
    } catch {}
  };

  // Fetch Server Config
  const fetchServerConfig = async () => {
    try {
      const res = await fetch('/api/server/config');
      const data = await res.json();
      if (data.success && data.config) {
        setServerConfig(data.config);
      }
    } catch {}
  };

  // Fetch Keys Details
  const fetchServerKeys = async () => {
    try {
      const res = await fetch('/api/server/keys');
      const data = await res.json();
      if (data.success) {
        setServerKeysCount(data.count || 0);
        if (Array.isArray(data.details)) {
          setKeysDetails(data.details);
        }
      }
    } catch {}
  };

  // Fetch folders list
  const fetchFolders = async () => {
    try {
      const res = await fetch('/api/folders');
      const data = await res.json();
      if (data.success && Array.isArray(data.folders)) {
        setFolders(data.folders);
        if (data.folders.length > 0 && !selectedFolderId) {
          setSelectedFolderId(data.folders[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch folders:', err);
    } finally {
      setLoadingFolders(false);
    }
  };

  // Fetch projects in selected folder
  const fetchProjects = async (folderId: string) => {
    if (!folderId) return;
    setLoadingProjects(true);
    try {
      const res = await fetch(`/api/folders/${folderId}/projects`);
      const data = await res.json();
      if (data.success && Array.isArray(data.projects)) {
        setProjects(data.projects);
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    } finally {
      setLoadingProjects(false);
    }
  };

  // Fetch worker status
  const fetchWorkerStatus = async () => {
    try {
      const res = await fetch('/api/background/status');
      const data = await res.json();
      if (data.success && data.status) {
        setWorkerStatus(data.status);
      }
    } catch {}
  };

  // Initial load
  useEffect(() => {
    fetchFolders();
    fetchWorkerStatus();
    fetchServerKeys();
    fetchServerInfo();
    fetchServerConfig();
  }, []);

  // When selected folder changes
  useEffect(() => {
    if (selectedFolderId) {
      fetchProjects(selectedFolderId);
    } else {
      setProjects([]);
    }
  }, [selectedFolderId]);

  // Polling for live translation updates
  useEffect(() => {
    const interval = setInterval(() => {
      fetchWorkerStatus();
      if (selectedFolderId) {
        fetch(`/api/folders/${selectedFolderId}/projects`)
          .then((res) => res.json())
          .then((data) => {
            if (data.success && Array.isArray(data.projects)) {
              setProjects(data.projects);
            }
          })
          .catch(() => {});
      }
      fetch('/api/folders')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.folders)) {
            setFolders(data.folders);
          }
        })
        .catch(() => {});
    }, 2500);

    return () => clearInterval(interval);
  }, [selectedFolderId]);

  // Create Folder Handler
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) {
      onShowToast('لطفاً نام پوشه را وارد کنید.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName, description: newFolderDesc }),
      });
      const data = await res.json();
      if (data.success && data.folder) {
        setFolders((prev) => [...prev, { ...data.folder, projectCount: 0, completedCount: 0 }]);
        setSelectedFolderId(data.folder.id);
        setNewFolderName('');
        setNewFolderDesc('');
        setIsNewFolderOpen(false);
        onShowToast(`پوشه "${data.folder.name}" ساخته شد.`, 'success');
      }
    } catch {
      onShowToast('خطا در ایجاد پوشه', 'error');
    }
  };

  // Edit Folder Handler
  const handleEditFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFolderId || !editFolderName.trim()) return;

    try {
      const res = await fetch(`/api/folders/${selectedFolderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editFolderName, description: editFolderDesc }),
      });
      const data = await res.json();
      if (data.success && data.folder) {
        setFolders((prev) =>
          prev.map((f) => (f.id === selectedFolderId ? { ...f, name: data.folder.name, description: data.folder.description } : f))
        );
        setIsEditFolderOpen(false);
        onShowToast('اطلاعات پوشه به‌روزرسانی شد.', 'success');
      }
    } catch {
      onShowToast('خطا در ویرایش پوشه', 'error');
    }
  };

  // Delete Folder Handler
  const handleDeleteFolder = async (folderId: string, folderName: string) => {
    if (!window.confirm(`آیا مطمئن هستید که می‌خواهید پوشه "${folderName}" و تمام زیرنویس‌های داخل آن را حذف کنید؟`)) {
      return;
    }

    try {
      const res = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setFolders((prev) => prev.filter((f) => f.id !== folderId));
        if (selectedFolderId === folderId) {
          const remaining = folders.filter((f) => f.id !== folderId);
          setSelectedFolderId(remaining.length > 0 ? remaining[0].id : '');
        }
        onShowToast(`پوشه "${folderName}" حذف شد.`, 'info');
      }
    } catch {
      onShowToast('خطا در حذف پوشه', 'error');
    }
  };

  // Handle Multi-file Upload into Folder
  const handleFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedFolderId) return;

    setIsUploading(true);
    const parsedFilesData: Array<{
      name: string;
      format: string;
      rawHeader?: string;
      items: SubtitleItem[];
      sourceLanguage: string;
    }> = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const content = await file.text();
        const parsed = parseSubtitleFile(content, file.name);
        if (parsed.items && parsed.items.length > 0) {
          parsedFilesData.push({
            name: file.name,
            format: parsed.format,
            rawHeader: parsed.rawHeader,
            items: parsed.items,
            sourceLanguage: 'auto',
          });
        }
      }

      if (parsedFilesData.length === 0) {
        onShowToast('فایل‌های انتخاب شده حاوی سطرهای زیرنویس معتبر نبودند.', 'error');
        setIsUploading(false);
        return;
      }

      const res = await fetch(`/api/folders/${selectedFolderId}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: parsedFilesData,
          targetLanguage: 'fa',
          tone: uploadTone,
          autoQueue: autoQueueOnUpload,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onShowToast(`تعداد ${data.count} فایل زیرنویس با موفقیت به پوشه اضافه شد.`, 'success');
        await fetchProjects(selectedFolderId);
        await fetchFolders();
      } else {
        onShowToast(data.error || 'خطا در آپلود فایل‌ها به سرور', 'error');
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      onShowToast('خطا در خواندن یا آپلود فایل‌ها به سرور', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Start all files in folder
  const handleStartFolder = async () => {
    if (!selectedFolderId) return;
    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'ترجمه پس‌زمینه برای این پوشه آغاز شد.', 'success');
        fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در شروع ترجمه پوشه', 'error');
    }
  };

  // Pause all files in folder
  const handlePauseFolder = async () => {
    if (!selectedFolderId) return;
    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/pause`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'ترجمه پوشه موقتاً متوقف شد.', 'info');
        fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در متوقف کردن ترجمه پوشه', 'error');
    }
  };

  // Resume all incomplete projects in folder
  const handleResumeFolder = async () => {
    if (!selectedFolderId) return;
    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/resume`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'پروژه‌های ناقص مجدداً در صف ترجمه قرار گرفتند.', 'success');
        fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در ادامه ترجمه پوشه', 'error');
    }
  };

  // Single Project Action Handlers
  const handleStartProject = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`فایل "${name}" به صف ترجمه پس‌زمینه سرور اضافه شد.`, 'success');
        if (selectedFolderId) fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در شروع ترجمه فایل', 'error');
    }
  };

  const handlePauseProject = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/pause`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`ترجمه فایل "${name}" متوقف شد.`, 'info');
        if (selectedFolderId) fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در توقف ترجمه فایل', 'error');
    }
  };

  const handleResumeProject = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/resume`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`ادامه ترجمه "${name}" از آخرین سطر باقی‌مانده آغاز شد.`, 'success');
        if (selectedFolderId) fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در ازسرگیری ترجمه', 'error');
    }
  };

  const handleRestartProject = async (id: string, name: string, onlyIncomplete: boolean) => {
    const confirmMsg = onlyIncomplete
      ? `سطرهای ترجمه‌نشده یا دارای خطا در فایل "${name}" مجدداً ترجمه خواهند شد (سطرهای ترجمه شده حفظ می‌شوند). ادامه می‌دهید؟`
      : `تمام سطرهای فایل "${name}" پاک شده و از سطر اول مجدداً ترجمه خواهد شد. آیا مطمئنید؟`;

    if (!window.confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/projects/${id}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyIncomplete }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'درخواست ترجمه مجدد ثبت شد.', 'success');
        if (selectedFolderId) fetchProjects(selectedFolderId);
      }
    } catch {
      onShowToast('خطا در ترجمه مجدد فایل', 'error');
    }
  };

  const handleDeleteProject = async (id: string, name: string) => {
    if (!window.confirm(`آیا از حذف فایل "${name}" مطمئن هستید؟`)) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setProjects((prev) => prev.filter((p) => p.id !== id));
        onShowToast(`فایل "${name}" حذف شد.`, 'info');
        fetchFolders();
      }
    } catch {
      onShowToast('خطا در حذف فایل', 'error');
    }
  };

  // Bulk VTT ZIP Download for folder
  const handleDownloadFolderVTTZip = () => {
    if (!selectedFolderId) return;
    setIsZippingFolder(true);
    const link = document.createElement('a');
    link.href = `/api/folders/${selectedFolderId}/export/vtt`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => setIsZippingFolder(false), 2000);
    onShowToast('دانلود خروجی گروهی VTT شروع شد...', 'info');
  };

  // Full Database Backup Download
  const handleDownloadBackup = () => {
    const link = document.createElement('a');
    link.href = '/api/backup';
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    onShowToast('دانلود نسخه پشتیبان کامل دیتابیس سرور آغاز شد...', 'info');
  };

  // Restore Database from Backup
  const handleRestoreSubmit = async (jsonString: string) => {
    if (!jsonString.trim()) {
      onShowToast('لطفاً محتوای فایل پشتیبان را وارد کنید.', 'error');
      return;
    }
    setIsRestoring(true);
    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupContent: jsonString }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'دیتابیس با موفقیت بازگردانی شد.', 'success');
        setIsRestoreModalOpen(false);
        setRestoreJsonText('');
        await fetchFolders();
        if (selectedFolderId) {
          await fetchProjects(selectedFolderId);
        }
      } else {
        onShowToast(data.error || 'خطا در بازیابی نسخه پشتیبان', 'error');
      }
    } catch {
      onShowToast('خطا در برقراری ارتباط با سرور برای بازیابی', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  // File upload for restore
  const handleRestoreFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setRestoreJsonText(content);
        handleRestoreSubmit(content);
      }
    };
    reader.readAsText(file);
    if (restoreFileInputRef.current) restoreFileInputRef.current.value = '';
  };

  // Direct Server-Side Key Ping Test
  const handleTestServerKey = async (specificKey?: string) => {
    setIsTestingKey(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/server/keys/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: specificKey || undefined }),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        onShowToast(`تست کلید موفق بود: تاخیر ${data.latencyMs}ms با مدل Gemini 3.5 Flash Lite`, 'success');
      } else {
        onShowToast(`نتیجه تست کلید: ${data.message || 'خطا'}`, 'error');
      }
      fetchServerKeys();
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'خطا در ارتباط با سرور هنگام تست کلید',
      });
      onShowToast('خطا در تست کلید از روی سرور', 'error');
    } finally {
      setIsTestingKey(false);
    }
  };

  // Save server keys (batch)
  const handleSaveServerKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = serverKeysText
      .split('\n')
      .map((k) => k.trim())
      .filter((k) => k.length > 5);

    if (lines.length === 0) {
      onShowToast('هیچ کلید معتبری وارد نشد.', 'error');
      return;
    }

    try {
      const res = await fetch('/api/server/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: lines, mode: keySaveMode }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'کلیدها با موفقیت در سرور ثبت شدند.', 'success');
        setServerKeysText('');
        fetchServerKeys();
      }
    } catch {
      onShowToast('خطا در ذخیره کلیدهای سرور', 'error');
    }
  };

  // Edit single key
  const handleUpdateSingleKey = async (index: number) => {
    if (!editingKeyVal.trim()) {
      onShowToast('کلید جدید نمی‌تواند خالی باشد.', 'error');
      return;
    }
    try {
      const res = await fetch(`/api/server/keys/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: editingKeyVal.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(`کلید #${index + 1} با موفقیت ویرایش شد.`, 'success');
        setEditingKeyIndex(null);
        setEditingKeyVal('');
        fetchServerKeys();
      } else {
        onShowToast(data.error || 'خطا در ویرایش کلید', 'error');
      }
    } catch {
      onShowToast('خطا در برقراری ارتباط با سرور', 'error');
    }
  };

  // Delete single key
  const handleDeleteSingleKey = async (index: number) => {
    if (!window.confirm(`آیا از حذف کلید شماره #${index + 1} از استخر سرور اطمینان دارید؟`)) return;
    try {
      const res = await fetch(`/api/server/keys/${index}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`کلید #${index + 1} حذف شد.`, 'info');
        fetchServerKeys();
      } else {
        onShowToast(data.error || 'خطا در حذف کلید', 'error');
      }
    } catch {
      onShowToast('خطا در ارتباط با سرور', 'error');
    }
  };

  // Save Server Configuration (ALLOWED_ORIGIN, GEMINI_BASE_URL, maxConcurrentProjects)
  const handleSaveServerConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    try {
      const res = await fetch('/api/server/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverConfig),
      });
      const data = await res.json();
      if (data.success) {
        setServerConfig(data.config);
        setIsServerConfigOpen(false);
        onShowToast('تنظیمات سرور و پراکسی با موفقیت ذخیره شد.', 'success');
      } else {
        onShowToast(data.error || 'خطا در ذخیره تنظیمات', 'error');
      }
    } catch {
      onShowToast('خطا در اتصال به سرور', 'error');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  return (
    <div className="w-full flex flex-col gap-6 animate-fade-in">
      
      {/* Autonomous Background Banner */}
      <div className="w-full bg-gradient-to-r from-indigo-950/80 via-slate-900 to-indigo-950/80 border border-indigo-500/30 rounded-2xl p-4 lg:p-5 shadow-xl shadow-indigo-950/20 backdrop-blur-md flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/30 shrink-0">
            <Server className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>موتور دیتابیس و ترجمه مستقل در پس‌زمینه سرور</span>
                <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                  مدل اختصاصی: Gemini 3.5 Flash Lite
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 flex items-center gap-1">
                  <Database className="w-3 h-3 text-cyan-400" />
                  <span>دیسک سرور: {serverInfo?.databasePath || 'data/subtitles_db.json'}</span>
                </span>
              </h2>
            </div>
            <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
              ترجمه کاملاً خودکار روی سرور مجازی (VPS) یا هاست اختصاصی اجرا می‌شود. با بسته شدن مرورگر روند ترجمه متوقف <span className="text-emerald-400 font-bold">نمی‌شود</span>.
              ترجمه موازی با تخصیص کلیدهای مجزا، کنترل دقیق نرخ درخواست‌ها (RPM) و نگهداری ۱۰۰٪ سطرهای قبلی پیاده‌سازی شده است.
            </p>
          </div>
        </div>

        {/* Action Controls: Server Config, Backup, Restore, Key Management */}
        <div className="flex items-center gap-2 shrink-0 w-full xl:w-auto justify-end flex-wrap">
          {/* Server Settings Button */}
          <button
            type="button"
            onClick={() => {
              fetchServerConfig();
              setIsServerConfigOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/80 text-violet-300 hover:bg-slate-800 border border-violet-500/30 transition-colors shadow-xs"
            title="تنظیمات دامنه مجاز (ALLOWED_ORIGIN)، پراکسی جمینای (GEMINI_BASE_URL) و تعداد ترجمه همزمان"
          >
            <Settings className="w-3.5 h-3.5 text-violet-400" />
            <span>تنظیمات سرور و پراکسی</span>
          </button>

          {/* Backup Button */}
          <button
            type="button"
            onClick={handleDownloadBackup}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/80 text-cyan-300 hover:bg-slate-800 border border-cyan-500/30 transition-colors shadow-xs"
            title="دانلود فایل پشتیبان کامل دیتابیس سرور شامل تمام پروژه‌ها و زیرنویس‌ها"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>پشتیبان‌گیری (Backup)</span>
          </button>

          {/* Restore Button */}
          <button
            type="button"
            onClick={() => setIsRestoreModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800/80 text-amber-300 hover:bg-slate-800 border border-amber-500/30 transition-colors shadow-xs"
            title="بازیابی کل دیتابیس از فایل JSON پشتیبان"
          >
            <UploadCloud className="w-3.5 h-3.5 text-amber-400" />
            <span>بازیابی (Restore)</span>
          </button>

          {/* Key Pool & Test Button */}
          <button
            type="button"
            onClick={() => {
              fetchServerKeys();
              setIsKeysModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30 transition-colors shadow-xs"
            title="مدیریت، چرخش خودکار و تست کلیدهای API از روی سرور"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>استخر کلیدها ({serverKeysCount} فعال)</span>
          </button>
        </div>
      </div>

      {/* Live Worker Parallel Activity Bar if translating */}
      {workerStatus?.activeProjects && workerStatus.activeProjects.length > 0 && (
        <div className="w-full bg-gradient-to-r from-amber-500/15 via-indigo-950/40 to-amber-500/15 border border-amber-500/30 rounded-xl p-3.5 flex flex-col gap-2.5 text-xs text-amber-200 shadow-md">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
              <span className="font-bold text-amber-300">
                در حال ترجمه موازی در سرور ({workerStatus.activeProjects.length} از حداکثر {workerStatus.maxConcurrentProjects} پردازش همزمان فعال):
              </span>
            </div>
            <div className="text-[11px] text-slate-300 font-mono bg-slate-900/80 px-2.5 py-1 rounded-md border border-slate-700">
              {workerStatus.lastMessage}
            </div>
          </div>

          {/* Active Parallel Jobs Chips */}
          <div className="flex items-center gap-2 flex-wrap">
            {workerStatus.activeProjects.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 bg-slate-900/90 border border-indigo-500/30 rounded-lg px-2.5 py-1.5 text-[11px]"
              >
                <FileText className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-bold text-white max-w-[200px] truncate">{p.name}</span>
                <span className="text-amber-400 font-mono">({p.progressPercent}% - {p.translatedCues}/{p.totalCues})</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {p.keyMasked}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Grid: Folders Sidebar & Subtitles Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Folders List (4 cols) */}
        <div className="lg:col-span-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Folder className="w-4 h-4 text-indigo-400" />
              <span>پوشه‌بندی زیرنویس‌ها</span>
              <span className="text-xs text-slate-400 font-mono">({folders.length})</span>
            </h3>

            <button
              type="button"
              onClick={() => setIsNewFolderOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-xs"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>پوشه جدید</span>
            </button>
          </div>

          {/* Folders List Container */}
          <div className="flex flex-col gap-2 max-h-[500px] overflow-y-auto pr-1">
            {loadingFolders ? (
              <div className="py-12 flex items-center justify-center text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin ml-2" />
                در حال بارگذاری پوشه‌ها...
              </div>
            ) : folders.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs bg-slate-900/40 rounded-xl border border-slate-800 p-4">
                هنوز هیچ پوشه‌ای ایجاد نشده است.
              </div>
            ) : (
              folders.map((folder) => {
                const isSelected = folder.id === selectedFolderId;
                return (
                  <div
                    key={folder.id}
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 ${
                      isSelected
                        ? 'bg-indigo-600/15 border-indigo-500/50 shadow-md shadow-indigo-950/30'
                        : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Folder className={`w-4 h-4 ${isSelected ? 'text-indigo-400' : 'text-slate-400'}`} />
                        <span className={`text-xs font-bold truncate max-w-[180px] ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                          {folder.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                          {folder.completedCount || 0} / {folder.projectCount || 0}
                        </span>

                        {isSelected && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditFolderName(folder.name);
                                setEditFolderDesc(folder.description || '');
                                setIsEditFolderOpen(true);
                              }}
                              className="p-1 hover:text-indigo-400 text-slate-400 transition-colors"
                              title="ویرایش نام پوشه"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteFolder(folder.id, folder.name);
                              }}
                              className="p-1 hover:text-rose-400 text-slate-400 transition-colors"
                              title="حذف پوشه"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {folder.description && (
                      <p className="text-[11px] text-slate-400 line-clamp-1">{folder.description}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Projects & Subtitle Files in Selected Folder (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {selectedFolder ? (
            <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-4 lg:p-5 flex flex-col gap-5">
              
              {/* Folder Header Actions */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Folder className="w-4 h-4 text-indigo-400" />
                    <span>{selectedFolder.name}</span>
                    <span className="text-xs text-slate-400 font-mono">({projects.length} زیرنویس)</span>
                  </h3>
                  {selectedFolder.description && (
                    <p className="text-xs text-slate-400 mt-1">{selectedFolder.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {/* Start Folder Background Translation */}
                  <button
                    type="button"
                    onClick={handleStartFolder}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-all"
                    title="شروع ترجمه خودکار تمام فایل‌های این پوشه در پس‌زمینه سرور"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>شروع ترجمه</span>
                  </button>

                  {/* Resume Incomplete in Folder */}
                  <button
                    type="button"
                    onClick={handleResumeFolder}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 transition-colors"
                    title="ادامه ترجمه سطرهای باقی‌مانده تمام فایل‌های ناقص پوشه"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>ادامه فایل‌های ناقص</span>
                  </button>

                  {/* Pause Folder Translation */}
                  <button
                    type="button"
                    onClick={handlePauseFolder}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition-colors"
                    title="توقف موقت ترجمه این پوشه"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>توقف موقت</span>
                  </button>

                  {/* One-click Bulk VTT Download (ZIP) */}
                  <button
                    type="button"
                    onClick={handleDownloadFolderVTTZip}
                    disabled={isZippingFolder || projects.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 shadow-md shadow-emerald-600/30 transition-all"
                    title="دانلود یک‌جای تمام زیرنویس‌های این پوشه با فرمت WebVTT (.vtt) در قالب فایل ZIP"
                  >
                    {isZippingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                    <span>خروجی گروهی VTT (ZIP)</span>
                  </button>
                </div>
              </div>

              {/* Upload to Folder Box */}
              <div className="bg-slate-950/70 rounded-xl border border-dashed border-indigo-500/40 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center shrink-0">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">آپلود گروهی زیرنویس‌ها به این پوشه</h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">پشتیبانی از فرمت‌های SRT, VTT, ASS, SSA, SUB (انتخاب چندتایی همزمان)</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoQueueOnUpload}
                      onChange={(e) => setAutoQueueOnUpload(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                    />
                    <span>شروع خودکار پس از آپلود</span>
                  </label>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".srt,.vtt,.ass,.ssa,.sub"
                    onChange={handleFilesUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    <span>انتخاب فایل‌ها</span>
                  </button>
                </div>
              </div>

              {/* Subtitle Files List in Folder */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>فایل‌های زیرنویس ({projects.length})</span>
                  <span>تایم‌بندی اصلی ۱۰۰٪ محفوظ می‌ماند</span>
                </div>

                {loadingProjects ? (
                  <div className="py-12 flex items-center justify-center text-slate-400 text-xs">
                    <Loader2 className="w-4 h-4 animate-spin ml-2" />
                    در حال بارگذاری فایل‌ها...
                  </div>
                ) : projects.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
                    این پوشه خالی است. زیرنویس‌های خود (نظیر قسمت‌های سریال) را در باکس بالا آپلود کنید.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 max-h-[480px] overflow-y-auto pr-1">
                    {projects.map((proj) => {
                      const isComplete = proj.status === 'completed' || (proj.totalCues > 0 && proj.translatedCues >= proj.totalCues);
                      const isTranslating = proj.status === 'translating';
                      const isQueued = proj.status === 'queued';
                      const isWaitingKeys = proj.status === 'waiting_for_keys';
                      const isIncomplete = proj.status === 'has_incomplete';
                      const isError = proj.status === 'error';
                      const pct = proj.totalCues > 0 ? Math.round((proj.translatedCues / proj.totalCues) * 100) : 0;

                      return (
                        <div
                          key={proj.id}
                          className="bg-slate-950/70 rounded-xl border border-slate-800/90 hover:border-slate-700 p-3.5 flex flex-col gap-2.5 transition-all shadow-xs"
                        >
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2.5 overflow-hidden">
                              <FileText className="w-4 h-4 text-indigo-400 shrink-0" />
                              <div className="flex flex-col">
                                <span className="font-bold text-xs text-white truncate max-w-[280px] sm:max-w-[360px]">
                                  {proj.name}
                                </span>
                                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                                  <span>{proj.format.toUpperCase()}</span>
                                  <span>•</span>
                                  <span className={isIncomplete ? 'text-amber-400 font-bold' : ''}>
                                    {proj.translatedCues} / {proj.totalCues} سطر
                                  </span>
                                  {proj.tokenUsage?.totalTokens > 0 && (
                                    <>
                                      <span>•</span>
                                      <span>{proj.tokenUsage.totalTokens.toLocaleString()} توکن</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Status Badges & Action Buttons */}
                            <div className="flex items-center gap-2 shrink-0 flex-wrap">
                              {/* Status Badge */}
                              {isComplete ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span>تکمیل (۱۰۰٪)</span>
                                </span>
                              ) : isTranslating ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 animate-pulse">
                                  <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                                  <span>در حال ترجمه ({pct}%)</span>
                                </span>
                              ) : isWaitingKeys ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-purple-400" />
                                  <span>در انتظار کلید/سهمیه ({pct}%)</span>
                                </span>
                              ) : isIncomplete ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3 text-amber-400" />
                                  <span>ترجمه ناقص ({pct}%)</span>
                                </span>
                              ) : isQueued ? (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  <span>در صف سرور</span>
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                                  متوقف
                                </span>
                              )}

                              {/* Resume Button (for incomplete or waiting) */}
                              {(isIncomplete || isWaitingKeys || proj.status === 'paused') && !isTranslating && (
                                <button
                                  type="button"
                                  onClick={() => handleResumeProject(proj.id, proj.name)}
                                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg transition-colors"
                                  title="ادامه ترجمه از سطر باقی‌مانده (بدون اتلاف سطرهای قبلی)"
                                >
                                  <Play className="w-3 h-3 fill-current" />
                                  <span>ادامه ترجمه</span>
                                </button>
                              )}

                              {/* Retranslate Incomplete Only */}
                              {isIncomplete && !isTranslating && (
                                <button
                                  type="button"
                                  onClick={() => handleRestartProject(proj.id, proj.name, true)}
                                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-lg transition-colors"
                                  title="ترجمه مجدد سطرهای ناقص و ترجمه‌نشده با حفظ سطرهای سالم"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>تکمیل سطرهای باقی‌مانده</span>
                                </button>
                              )}

                              {/* Retranslate All From Scratch */}
                              {isComplete && !isTranslating && (
                                <button
                                  type="button"
                                  onClick={() => handleRestartProject(proj.id, proj.name, false)}
                                  className="p-1.5 text-slate-400 hover:text-amber-300 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-[11px]"
                                  title="ترجمه مجدد کل زیرنویس از ابتدا"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Start/Pause Single */}
                              {!isTranslating && !isIncomplete && !isWaitingKeys && (
                                <button
                                  type="button"
                                  onClick={() => handleStartProject(proj.id, proj.name)}
                                  disabled={isComplete}
                                  className="p-1.5 text-slate-300 hover:text-indigo-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30"
                                  title="شروع ترجمه در پس‌زمینه"
                                >
                                  <Play className="w-3.5 h-3.5 fill-current" />
                                </button>
                              )}

                              {isTranslating && (
                                <button
                                  type="button"
                                  onClick={() => handlePauseProject(proj.id, proj.name)}
                                  className="p-1.5 text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 rounded-lg transition-colors"
                                  title="توقف موقت ترجمه"
                                >
                                  <Pause className="w-3.5 h-3.5" />
                                </button>
                              )}

                              {/* Single VTT Download */}
                              <a
                                href={`/api/projects/${proj.id}/export/vtt`}
                                download
                                className="p-1.5 text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-colors flex items-center gap-1 text-[11px] font-semibold"
                                title="دانلود فایل با فرمت WebVTT (.vtt)"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>VTT</span>
                              </a>

                              {/* Open in Full Virtualized Editor */}
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenProjectInEditor({
                                    id: proj.id,
                                    name: proj.name,
                                    items: proj.items,
                                    format: proj.format as SubtitleFormat,
                                    rawHeader: proj.rawHeader,
                                  })
                                }
                                className="p-1.5 text-slate-300 hover:text-indigo-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
                                title="مشاهده و ویرایش در ادیتور مجازی سریع"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {/* Delete Project */}
                              <button
                                type="button"
                                onClick={() => handleDeleteProject(proj.id, proj.name)}
                                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                                title="حذف این زیرنویس"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Diagnostic Info Box if lastError occurred */}
                          {proj.lastError && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 text-[11px] text-amber-200 flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                              <div className="flex flex-col gap-0.5">
                                <span className="font-bold text-amber-300">گزارش وضعیت و خطا:</span>
                                <span>{proj.lastError}</span>
                                <span className="text-emerald-400 font-semibold text-[10px] mt-0.5">
                                  ✓ سطرهای ترجمه شده تا به اینجا ({proj.translatedCues} سطر) در دیتابیس سرور کاملاً محفوظ است.
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Progress bar */}
                          <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isComplete
                                  ? 'bg-emerald-500'
                                  : isIncomplete
                                  ? 'bg-amber-500'
                                  : isWaitingKeys
                                  ? 'bg-purple-500'
                                  : 'bg-indigo-500'
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/60 rounded-2xl border border-slate-800 p-12 text-center text-slate-400 text-xs">
              یک پوشه از لیست سمت راست انتخاب کنید یا پوشه جدید بسازید.
            </div>
          )}
        </div>
      </div>

      {/* Modal: New Folder */}
      {isNewFolderOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl flex flex-col gap-4 animate-scale-up">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-indigo-400" />
              <span>ایجاد پوشه جدید</span>
            </h3>

            <form onSubmit={handleCreateFolder} className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  نام پوشه (مثلاً: افشای کیهانی فصل اول):
                </label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="افشای کیهانی فصل اول"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  توضیحات (اختیاری):
                </label>
                <input
                  type="text"
                  value={newFolderDesc}
                  onChange={(e) => setNewFolderDesc(e.target.value)}
                  placeholder="مستند علمی و تحقیقاتی کیهانی"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsNewFolderOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition-colors"
                >
                  ساخت پوشه
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Folder */}
      {isEditFolderOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-md shadow-2xl flex flex-col gap-4 animate-scale-up">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-indigo-400" />
              <span>ویرایش پوشه</span>
            </h3>

            <form onSubmit={handleEditFolder} className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">نام پوشه:</label>
                <input
                  type="text"
                  value={editFolderName}
                  onChange={(e) => setEditFolderName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">توضیحات:</label>
                <input
                  type="text"
                  value={editFolderDesc}
                  onChange={(e) => setEditFolderDesc(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsEditFolderOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition-colors"
                >
                  ذخیره تغییرات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Server & Network Configuration (ALLOWED_ORIGIN & GEMINI_BASE_URL) */}
      {isServerConfigOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 lg:p-6 w-full max-w-xl shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-violet-400" />
                <span>تنظیمات سرور، پراکسی و ترجمه موازی</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsServerConfigOpen(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveServerConfig} className="flex flex-col gap-4">
              {/* ALLOWED_ORIGIN */}
              <div>
                <label className="text-xs text-slate-300 font-semibold flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
                    <span>مجوز دسترسی دامنه (ALLOWED_ORIGIN):</span>
                  </span>
                  <span className="text-[11px] font-mono text-cyan-400">پیش‌فرض: * (دسترسی آزاد از همه هاست‌ها)</span>
                </label>
                <input
                  type="text"
                  value={serverConfig.allowedOrigin}
                  onChange={(e) => setServerConfig({ ...serverConfig, allowedOrigin: e.target.value })}
                  placeholder="*"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-cyan-200 font-mono focus:outline-none focus:border-indigo-500 direction-ltr"
                />
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  مقدار <code className="text-cyan-300 font-mono">*</code> به این معنی است که سرور از روی هر VPS، دامنه یا IP به راحتی در دسترس خواهد بود. برای محدودسازی به یک دامنه خاص، نشانی مانند <code className="text-cyan-300 font-mono">https://my-domain.com</code> وارد کنید.
                </p>
              </div>

              {/* GEMINI_BASE_URL */}
              <div>
                <label className="text-xs text-slate-300 font-semibold flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-emerald-400" />
                    <span>آدرس پایه سرویس جمینای (GEMINI_BASE_URL):</span>
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400">Google Official / Custom Proxy</span>
                </label>
                <input
                  type="text"
                  value={serverConfig.geminiBaseUrl}
                  onChange={(e) => setServerConfig({ ...serverConfig, geminiBaseUrl: e.target.value })}
                  placeholder="https://generativelanguage.googleapis.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-emerald-200 font-mono focus:outline-none focus:border-indigo-500 direction-ltr"
                />
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  پیش‌فرض روی سرور اصلی گوگل است. اگر سرور مجازی شما در منطقه‌ای با فیلترینگ یا محدودیت قرار دارد، می‌توانید یک آدرس Reverse Proxy یا آدرس Cloudflare Worker اختصاصی خود را در این فیلد قرار دهید.
                </p>
              </div>

              {/* Concurrency: maxConcurrentProjects */}
              <div>
                <label className="text-xs text-slate-300 font-semibold flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-amber-400" />
                    <span>تعداد ترجمه همزمان پروژه‌ها (Parallel Workers):</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-amber-400 px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                    {serverConfig.maxConcurrentProjects} فایل همزمان
                  </span>
                </label>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min={1}
                    max={6}
                    step={1}
                    value={serverConfig.maxConcurrentProjects}
                    onChange={(e) => setServerConfig({ ...serverConfig, maxConcurrentProjects: Number(e.target.value) })}
                    className="w-full accent-amber-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-xs font-mono text-slate-300 shrink-0">۱ تا ۶</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  موتور ترجمه پس‌زمینه به تعداد این عدد، فایل‌ها را با <span className="text-amber-300 font-bold">کلیدهای مجزا</span> به طور موازی ترجمه می‌کند تا حداکثر سرعت و بهره‌وری بدون برخورد به سهمیه کسب شود.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsServerConfigOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isSavingConfig}
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSavingConfig ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>ذخیره تنظیمات</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Server Keys Management with Inline Edit & Delete */}
      {isKeysModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 lg:p-6 w-full max-w-xl shadow-2xl flex flex-col gap-4 animate-scale-up max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                <span>مدیریت و استخر کلیدهای Gemini 3.5 Flash Lite</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsKeysModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            {/* Explanatory banner */}
            <div className="bg-indigo-950/40 border border-indigo-500/20 rounded-xl p-3 text-xs text-slate-300 space-y-1.5 leading-relaxed">
              <p>
                <span className="text-emerald-300 font-bold">✓ ترجمه موازی با کلیدهای مجزا:</span> هر فایل در حال ترجمه یک کلید فعال اختصاصی را رزرو می‌کند تا نرخ درخواست‌ها مجزا و بدون تداخل با سایر فایل‌ها مدیریت شود.
              </p>
              <p>
                <span className="text-amber-300 font-bold">✓ محافظت در برابر اتمام توکن:</span> با اتمام توکن یک کلید، آن کلید موقتاً استراحت می‌کند و پروژه فوراً به کلید بعدی منتقل شده و ترجمه هرگز ناقص رها نمی‌شود.
              </p>
            </div>

            {/* Registered Keys List with Individual Edit & Delete */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-indigo-400" />
                  <span>لیست کلیدهای ذخیره شده روی سرور ({keysDetails.length} کلید)</span>
                </span>
                <button
                  type="button"
                  onClick={fetchServerKeys}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>بروزرسانی</span>
                </button>
              </div>

              {keysDetails.length === 0 ? (
                <div className="text-xs text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                  هنوز هیچ کلیدی در سرور ذخیره نشده است. می‌توانید کلیدهای خود را در کادر زیر وارد کنید.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                  {keysDetails.map((k) => (
                    <div
                      key={k.index}
                      className={`flex flex-col p-2.5 rounded-xl border text-xs ${
                        k.isExhausted
                          ? 'bg-rose-500/10 border-rose-500/30'
                          : 'bg-slate-950 border-slate-800'
                      }`}
                    >
                      {editingKeyIndex === k.index ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editingKeyVal}
                            onChange={(e) => setEditingKeyVal(e.target.value)}
                            className="w-full bg-slate-900 border border-indigo-500 rounded-lg px-2.5 py-1 text-xs text-white font-mono direction-ltr"
                            placeholder="AIzaSy..."
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleUpdateSingleKey(k.index)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shrink-0"
                          >
                            ذخیره
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingKeyIndex(null);
                              setEditingKeyVal('');
                            }}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs shrink-0"
                          >
                            انصراف
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="w-5 h-5 rounded-md bg-slate-800 flex items-center justify-center text-[11px] font-mono text-slate-400 shrink-0">
                              #{k.index + 1}
                            </span>
                            <span className="font-mono text-slate-200 tracking-wider truncate">
                              {k.maskedKey}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {k.isExhausted ? (
                              <span className="flex items-center gap-1 text-[10px] text-rose-400">
                                <ShieldAlert className="w-3 h-3" />
                                <span>استراحت ({k.cooldownRemainingSec}s)</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>فعال</span>
                              </span>
                            )}

                            {/* Test key button */}
                            <button
                              type="button"
                              onClick={() => handleTestServerKey(k.rawKey)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] font-semibold transition-colors"
                              title="تست آنلاین این کلید از روی سرور"
                            >
                              تست
                            </button>

                            {/* Edit key button */}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingKeyIndex(k.index);
                                setEditingKeyVal(k.rawKey);
                              }}
                              className="p-1 text-slate-400 hover:text-indigo-400 transition-colors"
                              title="ویرایش این کلید"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete key button */}
                            <button
                              type="button"
                              onClick={() => handleDeleteSingleKey(k.index)}
                              className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                              title="حذف این کلید"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Server-Side Key Ping Test Box */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>تست آنلاین ارتباط و سرعت از روی سرور (Server Ping)</span>
                </span>
                <button
                  type="button"
                  disabled={isTestingKey}
                  onClick={() => handleTestServerKey()}
                  className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {isTestingKey ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                      <span>در حال تست از سرور...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      <span>تست کلید اصلی</span>
                    </>
                  )}
                </button>
              </div>

              {testResult && (
                <div
                  className={`p-2.5 rounded-lg text-xs leading-relaxed border ${
                    testResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold mb-1">
                    <span>{testResult.success ? '✓ کلید با موفقیت تایید شد' : '✗ خطا در اعتبارسنجی کلید'}</span>
                    {testResult.latencyMs && (
                      <span className="font-mono text-[11px] bg-slate-900 px-2 py-0.5 rounded">
                        زمان پاسخ: {testResult.latencyMs}ms
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] opacity-90">{testResult.message}</p>
                </div>
              )}
            </div>

            {/* Batch Add Keys Form */}
            <form onSubmit={handleSaveServerKeys} className="flex flex-col gap-3 pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-300 font-semibold block">
                  افزودن کلیدهای API جدید (هر کلید در یک خط):
                </label>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="keyMode"
                      value="append"
                      checked={keySaveMode === 'append'}
                      onChange={() => setKeySaveMode('append')}
                      className="accent-indigo-500"
                    />
                    <span>افزودن به استخر</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="keyMode"
                      value="replace"
                      checked={keySaveMode === 'replace'}
                      onChange={() => setKeySaveMode('replace')}
                      className="accent-indigo-500"
                    />
                    <span>جایگزینی کل استخر</span>
                  </label>
                </div>
              </div>

              <textarea
                rows={3}
                value={serverKeysText}
                onChange={(e) => setServerKeysText(e.target.value)}
                placeholder={"AIzaSy...\nAIzaSy..."}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-amber-200 font-mono focus:outline-none focus:border-indigo-500 direction-ltr"
              />

              <div className="flex items-center justify-end gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setIsKeysModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
                >
                  بستن
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>ثبت کلیدها</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Restore Database Backup */}
      {isRestoreModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 lg:p-6 w-full max-w-lg shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-amber-400" />
                <span>بازیابی اطلاعات دیتابیس (Restore Backup)</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsRestoreModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 leading-relaxed">
              با بارگذاری فایل پشتیبان، تمام پوشه‌ها و پروژه‌های زیرنویس به فایل دیتابیس روی سرور (<code className="font-mono bg-slate-950 px-1.5 py-0.5 rounded text-white">data/subtitles_db.json</code>) بازگردانده می‌شوند.
            </div>

            {/* File upload trigger */}
            <div className="flex flex-col gap-2">
              <label className="text-xs text-slate-300 font-semibold">
                انتخاب فایل JSON نسخه پشتیبان:
              </label>
              <input
                ref={restoreFileInputRef}
                type="file"
                accept=".json"
                onChange={handleRestoreFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => restoreFileInputRef.current?.click()}
                className="w-full py-3 px-4 border-2 border-dashed border-slate-700 hover:border-amber-500/50 rounded-xl bg-slate-950/60 hover:bg-slate-950 text-xs text-slate-300 flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <UploadCloud className="w-4 h-4 text-amber-400" />
                <span>برای انتخاب فایل SubGameLab_Backup_*.json کلیک کنید</span>
              </button>
            </div>

            {/* Direct JSON paste option */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-300 font-semibold">
                یا متن JSON پشتیبان را اینجا الصاق کنید:
              </label>
              <textarea
                rows={4}
                value={restoreJsonText}
                onChange={(e) => setRestoreJsonText(e.target.value)}
                placeholder='{"version": 1, "folders": [...], "projects": [...]}'
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-slate-300 font-mono focus:outline-none focus:border-indigo-500 direction-ltr"
              />
            </div>

            <div className="flex items-center justify-end gap-2 mt-1">
              <button
                type="button"
                onClick={() => setIsRestoreModalOpen(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={isRestoring || !restoreJsonText.trim()}
                onClick={() => handleRestoreSubmit(restoreJsonText)}
                className="px-4 py-1.5 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {isRestoring ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>در حال بازیابی دیتابیس...</span>
                  </>
                ) : (
                  <span>بازیابی دیتابیس</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
