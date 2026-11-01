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
  ChevronUp
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
  status: 'idle' | 'queued' | 'translating' | 'paused' | 'completed' | 'error';
  totalCues: number;
  translatedCues: number;
  currentBatchIndex: number;
  totalBatches: number;
  errorMessage?: string;
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
  activeProjectId: string | null;
  activeProjectName: string | null;
  folderId: string | null;
  progressPercent: number;
  translatedCues: number;
  totalCues: number;
  currentKeyIndex: number;
  totalKeys: number;
  lastMessage: string;
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

  const [isKeysModalOpen, setIsKeysModalOpen] = useState(false);
  const [serverKeysText, setServerKeysText] = useState('');
  const [serverKeysCount, setServerKeysCount] = useState(0);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadTone, setUploadTone] = useState<ToneOption>('cinematic');
  const [autoQueueOnUpload, setAutoQueueOnUpload] = useState(true);
  const [isZippingFolder, setIsZippingFolder] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Fetch server keys
  const fetchServerKeys = async () => {
    try {
      const res = await fetch('/api/server/keys');
      const data = await res.json();
      if (data.success) {
        setServerKeysCount(data.count || 0);
      }
    } catch {}
  };

  // Initial load
  useEffect(() => {
    fetchFolders();
    fetchWorkerStatus();
    fetchServerKeys();
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
        // Silently refresh project list without full loading spinner
        fetch(`/api/folders/${selectedFolderId}/projects`)
          .then((res) => res.json())
          .then((data) => {
            if (data.success && Array.isArray(data.projects)) {
              setProjects(data.projects);
            }
          })
          .catch(() => {});
      }
      // Refresh folder counts
      fetch('/api/folders')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && Array.isArray(data.folders)) {
            setFolders(data.folders);
          }
        })
        .catch(() => {});
    }, 3000);

    return () => clearInterval(interval);
  }, [selectedFolderId]);

  // Create Folder Handler
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFolderName, description: newFolderDesc }),
      });
      const data = await res.json();
      if (data.success && data.folder) {
        onShowToast(`پوشه "${data.folder.name}" ایجاد شد.`, 'success');
        setNewFolderName('');
        setNewFolderDesc('');
        setIsNewFolderOpen(false);
        await fetchFolders();
        setSelectedFolderId(data.folder.id);
      } else {
        onShowToast(data.error || 'خطا در ایجاد پوشه', 'error');
      }
    } catch (err: any) {
      onShowToast('خطا در برقراری ارتباط با سرور', 'error');
    }
  };

  // Edit Folder Handler
  const handleUpdateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editFolderName.trim() || !selectedFolderId) return;

    try {
      const res = await fetch(`/api/folders/${selectedFolderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editFolderName, description: editFolderDesc }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast('اطلاعات پوشه به‌روزرسانی شد.', 'success');
        setIsEditFolderOpen(false);
        fetchFolders();
      } else {
        onShowToast(data.error || 'خطا در ویرایش پوشه', 'error');
      }
    } catch {
      onShowToast('خطا در ویرایش پوشه', 'error');
    }
  };

  // Delete Folder Handler
  const handleDeleteFolder = async (folderId: string, folderName: string) => {
    if (!window.confirm(`آیا از حذف پوشه "${folderName}" و تمام زیرنویس‌های آن اطمینان دارید؟`)) {
      return;
    }

    try {
      const res = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`پوشه "${folderName}" حذف شد.`, 'info');
        if (selectedFolderId === folderId) {
          setSelectedFolderId('');
        }
        fetchFolders();
      }
    } catch {
      onShowToast('خطا در حذف پوشه', 'error');
    }
  };

  // Multi-File Upload Handler
  const handleFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedFolderId) return;

    setIsUploading(true);
    const parsedPayload: Array<{ name: string; items: SubtitleItem[]; format: string; rawHeader?: string }> = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const text = await file.text();
        const parsed = parseSubtitleFile(text, file.name);
        if (parsed.items.length > 0) {
          parsedPayload.push({
            name: file.name,
            items: parsed.items,
            format: parsed.format,
            rawHeader: parsed.rawHeader,
          });
        }
      }

      if (parsedPayload.length === 0) {
        onShowToast('هیچ زیرنویس معتبری در فایل‌های انتخاب‌شده یافت نشد.', 'error');
        return;
      }

      const res = await fetch(`/api/folders/${selectedFolderId}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: parsedPayload,
          targetLanguage: 'fa',
          tone: uploadTone,
          autoQueue: autoQueueOnUpload,
        }),
      });

      const data = await res.json();
      if (data.success) {
        onShowToast(`تعداد ${data.count} فایل زیرنویس در دیتابیس سرور ذخیره شد.`, 'success');
        fetchProjects(selectedFolderId);
        fetchFolders();
      } else {
        onShowToast(data.error || 'خطا در ذخیره فایل‌ها', 'error');
      }
    } catch (err: any) {
      onShowToast('خطا در آپلود فایل‌ها به سرور', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Start folder translation
  const handleStartFolder = async () => {
    if (!selectedFolderId) return;
    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'فایل‌های پوشه در صف ترجمه پس‌زمینه قرار گرفتند.', 'success');
        fetchProjects(selectedFolderId);
        fetchWorkerStatus();
      }
    } catch {
      onShowToast('خطا در شروع ترجمه پوشه', 'error');
    }
  };

  // Pause folder translation
  const handlePauseFolder = async () => {
    if (!selectedFolderId) return;
    try {
      const res = await fetch(`/api/folders/${selectedFolderId}/pause`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'ترجمه پس‌زمینه پوشه متوقف شد.', 'info');
        fetchProjects(selectedFolderId);
        fetchWorkerStatus();
      }
    } catch {
      onShowToast('خطا در توقف ترجمه پوشه', 'error');
    }
  };

  // Start single project
  const handleStartProject = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`فایل "${name}" در صف ترجمه پس‌زمینه قرار گرفت.`, 'success');
        fetchProjects(selectedFolderId);
        fetchWorkerStatus();
      }
    } catch {
      onShowToast('خطا در افزودن به صف', 'error');
    }
  };

  // Pause single project
  const handlePauseProject = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/projects/${id}/pause`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`ترجمه فایل "${name}" متوقف شد.`, 'info');
        fetchProjects(selectedFolderId);
        fetchWorkerStatus();
      }
    } catch {
      onShowToast('خطا در توقف فایل', 'error');
    }
  };

  // Delete single project
  const handleDeleteProject = async (id: string, name: string) => {
    if (!window.confirm(`آیا از حذف فایل "${name}" مطمئن هستید؟`)) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        onShowToast(`فایل "${name}" حذف شد.`, 'info');
        fetchProjects(selectedFolderId);
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
    // Direct browser navigation to download the ZIP stream
    const link = document.createElement('a');
    link.href = `/api/folders/${selectedFolderId}/export/vtt`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => setIsZippingFolder(false), 2000);
    onShowToast('دانلود خروجی گروهی VTT شروع شد...', 'info');
  };

  // Save server keys handler
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
        body: JSON.stringify({ keys: lines, mode: 'append' }),
      });
      const data = await res.json();
      if (data.success) {
        onShowToast(data.message || 'کلیدها با موفقیت در سرور ثبت شدند.', 'success');
        setServerKeysText('');
        setIsKeysModalOpen(false);
        fetchServerKeys();
      }
    } catch {
      onShowToast('خطا در ذخیره کلیدهای سرور', 'error');
    }
  };

  const selectedFolder = folders.find((f) => f.id === selectedFolderId);

  return (
    <div className="w-full flex flex-col gap-6 animate-fade-in">
      
      {/* Autonomous Background Banner */}
      <div className="w-full bg-gradient-to-r from-indigo-950/80 via-slate-900 to-indigo-950/80 border border-indigo-500/30 rounded-2xl p-4 lg:p-5 shadow-xl shadow-indigo-950/20 backdrop-blur-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/30 shrink-0">
            <Server className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>موتور دیتابیس و ترجمه پس‌زمینه سرور</span>
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  مدل اختصاصی: Gemini 3.1 Flash Lite
                </span>
              </h2>
            </div>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">
              ترجمه کاملاً مستقل در پس‌زمینه سرور با چرخش خودکار کلیدها و حفظ دقیق تایم‌بندی انجام می‌شود.
              <span className="text-amber-300 font-semibold mx-1">می‌توانید مرورگر را ببندید</span>؛ همه چیز ذخیره و ادامه می‌یابد.
            </p>
          </div>
        </div>

        {/* Status indicator & Key Pool Button */}
        <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto justify-end">
          <button
            type="button"
            onClick={() => setIsKeysModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 border border-indigo-500/30 transition-colors shadow-xs"
            title="افزودن و مدیریت استخر کلیدهای API جهت چرخش خودکار هنگام اتمام توکن"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>استخر کلیدها ({serverKeysCount} کلید فعال)</span>
          </button>
        </div>
      </div>

      {/* Live Worker Activity Bar if translating */}
      {workerStatus?.activeProjectName && (
        <div className="w-full bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-200 animate-pulse">
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
            <div>
              <span className="font-bold text-amber-300">در حال ترجمه در سرور: </span>
              <span className="font-semibold text-white">{workerStatus.activeProjectName}</span>
              <span className="text-amber-400 font-mono mx-2">({workerStatus.progressPercent}% - {workerStatus.translatedCues} از {workerStatus.totalCues} سطر)</span>
            </div>
          </div>
          <div className="text-[11px] text-slate-300 font-mono bg-slate-900/80 px-2.5 py-1 rounded-md border border-slate-700">
            {workerStatus.lastMessage}
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
              <div className="py-8 flex items-center justify-center text-slate-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin ml-2" />
                در حال بارگذاری پوشه‌ها...
              </div>
            ) : folders.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl p-4">
                هنوز پوشه‌ای ساخته نشده است. برای شروع، روی "پوشه جدید" کلیک کنید.
              </div>
            ) : (
              folders.map((folder) => {
                const isSelected = folder.id === selectedFolderId;
                const progressPct = folder.projectCount > 0
                  ? Math.round((folder.completedCount / folder.projectCount) * 100)
                  : 0;

                return (
                  <div
                    key={folder.id}
                    onClick={() => setSelectedFolderId(folder.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                      isSelected
                        ? 'bg-indigo-950/60 border-indigo-500/50 shadow-md shadow-indigo-950/40 text-white'
                        : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <Folder className={`w-4 h-4 shrink-0 ${isSelected ? 'text-indigo-400' : 'text-slate-400'}`} />
                        <span className="font-bold text-xs truncate">{folder.name}</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300">
                          {folder.completedCount}/{folder.projectCount} فایل
                        </span>
                      </div>
                    </div>

                    {folder.description && (
                      <p className="text-[11px] text-slate-400 line-clamp-1">{folder.description}</p>
                    )}

                    {/* Mini progress bar */}
                    {folder.projectCount > 0 && (
                      <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden mt-1">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Files Inside Selected Folder & Actions (8 cols) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          {selectedFolder ? (
            <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-4 lg:p-5 flex flex-col gap-4 shadow-xl">
              
              {/* Folder Header */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Folder className="w-5 h-5 text-indigo-400" />
                      <span>{selectedFolder.name}</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => {
                        setEditFolderName(selectedFolder.name);
                        setEditFolderDesc(selectedFolder.description || '');
                        setIsEditFolderOpen(true);
                      }}
                      className="p-1 text-slate-400 hover:text-indigo-400 transition-colors"
                      title="ویرایش نام پوشه"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteFolder(selectedFolder.id, selectedFolder.name)}
                      className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                      title="حذف پوشه"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {selectedFolder.description && (
                    <p className="text-xs text-slate-400 mt-1">{selectedFolder.description}</p>
                  )}
                </div>

                {/* Folder Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto justify-end">
                  {/* Start Folder Background Translation */}
                  <button
                    type="button"
                    onClick={handleStartFolder}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/30 transition-all"
                    title="شروع ترجمه خودکار تمام فایل‌های این پوشه در پس‌زمینه سرور"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>شروع ترجمه پوشه</span>
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
                  <div className="flex flex-col gap-2.5 max-h-[450px] overflow-y-auto pr-1">
                    {projects.map((proj) => {
                      const isComplete = proj.status === 'completed' || (proj.totalCues > 0 && proj.translatedCues >= proj.totalCues);
                      const isTranslating = proj.status === 'translating';
                      const isQueued = proj.status === 'queued';
                      const pct = proj.totalCues > 0 ? Math.round((proj.translatedCues / proj.totalCues) * 100) : 0;

                      return (
                        <div
                          key={proj.id}
                          className="bg-slate-950/60 rounded-xl border border-slate-800/80 hover:border-slate-700 p-3.5 flex flex-col gap-2 transition-all"
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
                                  <span>{proj.translatedCues} / {proj.totalCues} سطر</span>
                                  {proj.tokenUsage?.totalTokens > 0 && (
                                    <>
                                      <span>•</span>
                                      <span>{proj.tokenUsage.totalTokens.toLocaleString()} توکن</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Status and Action Buttons */}
                            <div className="flex items-center gap-2 shrink-0">
                              {/* Status Badge */}
                              {isComplete ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span>تکمیل (۱۰۰٪)</span>
                                </span>
                              ) : isTranslating ? (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                                  <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                                  <span>در حال ترجمه ({pct}%)</span>
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

                              {/* Start/Pause Single */}
                              {!isTranslating ? (
                                <button
                                  type="button"
                                  onClick={() => handleStartProject(proj.id, proj.name)}
                                  disabled={isComplete}
                                  className="p-1.5 text-slate-300 hover:text-indigo-400 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-30"
                                  title="شروع ترجمه در پس‌زمینه"
                                >
                                  <Play className="w-3.5 h-3.5 fill-current" />
                                </button>
                              ) : (
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

                              {/* Open in Full Editor */}
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
                                title="باز کردن در ادیتور پیشرفته و پخش ویدیویی"
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

                          {/* Progress bar */}
                          <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isComplete ? 'bg-emerald-500' : 'bg-indigo-500'
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
                  نام پوشه (مثال: افشای کیهانی فصل اول)
                </label>
                <input
                  type="text"
                  required
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="مثال: افشای کیهانی فصل اول"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  توضیحات اختیاری
                </label>
                <input
                  type="text"
                  value={newFolderDesc}
                  onChange={(e) => setNewFolderDesc(e.target.value)}
                  placeholder="توضیحات یا فصل..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsNewFolderOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md"
                >
                  ایجاد پوشه
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
              <span>ویرایش نام پوشه</span>
            </h3>

            <form onSubmit={handleUpdateFolder} className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">نام پوشه</label>
                <input
                  type="text"
                  required
                  value={editFolderName}
                  onChange={(e) => setEditFolderName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">توضیحات</label>
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
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md"
                >
                  ذخیره تغییرات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Server Keys Pool (Multi-Key BYOK) */}
      {isKeysModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 w-full max-w-lg shadow-2xl flex flex-col gap-4 animate-scale-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                <span>استخر کلیدهای Gemini API برای ترجمه خودکار سرور</span>
              </h3>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                مدل: Gemini 3.1 Flash Lite
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              برای جلوگیری از توقف ترجمه، می‌توانید چندین کلید API رایگان جمینای (هر کدام در یک خط) وارد کنید.
              سرور هنگام اتمام توکن یا برخورد به محدودیت سهمیه (Quota / Rate Limit)، <span className="text-amber-300 font-bold">بلافاصله به کلید بعدی سوییچ کرده و هرگز متوقف نمی‌شود</span>.
            </p>

            <form onSubmit={handleSaveServerKeys} className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-slate-300 font-semibold block mb-1">
                  کلیدهای API جمینای (هر کلید در یک خط جدید):
                </label>
                <textarea
                  rows={4}
                  value={serverKeysText}
                  onChange={(e) => setServerKeysText(e.target.value)}
                  placeholder={"AIzaSy...\nAIzaSy...\nAIzaSy..."}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-amber-200 font-mono focus:outline-none focus:border-indigo-500 direction-ltr"
                />
              </div>

              <div className="flex items-center justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setIsKeysModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
                >
                  بستن
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md"
                >
                  افزودن به استخر کلیدها
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
