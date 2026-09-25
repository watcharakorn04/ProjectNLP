import React, { useRef, useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertTriangle, Eye, Trash2, Sparkles } from 'lucide-react';
import { UploadedConfigFile, VendorType } from '../types/network';
import { detectVendor } from '../utils/vendorDetector';
import { parseNetworkConfig } from '../utils/networkParser';
import { SAMPLE_CONFIGS, SampleConfig } from '../utils/sampleConfigs';

interface ConfigUploaderProps {
  uploadedFile: UploadedConfigFile | null;
  onFileLoaded: (file: UploadedConfigFile) => void;
  onRemoveFile: () => void;
  onOpenRawViewer: () => void;
  theme?: 'dark' | 'light';
  language?: 'EN' | 'TH';
}

export const ConfigUploader: React.FC<ConfigUploaderProps> = ({
  uploadedFile,
  onFileLoaded,
  onRemoveFile,
  onOpenRawViewer,
  theme = 'dark',
  language = 'EN'
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDark = theme === 'dark';
  const isTH = language === 'TH';

  const handleProcessText = (content: string, fileName: string, sizeBytes: number) => {
    const detection = detectVendor(content);
    const parsed = parseNetworkConfig(content);
    const fileSizeFormatted = sizeBytes > 1024 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${sizeBytes} B`;

    const newFile: UploadedConfigFile = {
      fileName,
      fileSize: fileSizeFormatted,
      rawContent: content,
      detectedVendor: detection.vendor,
      parsedData: parsed,
      uploadedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    onFileLoaded(newFile);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      readFile(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      readFile(file);
    }
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        handleProcessText(content, file.name, file.size);
      }
    };
    reader.readAsText(file);
  };

  const loadSample = (sample: SampleConfig) => {
    const sizeBytes = new Blob([sample.rawContent]).size;
    handleProcessText(sample.rawContent, sample.fileName, sizeBytes);
  };

  // Vendor Badge color
  const getVendorBadgeStyle = (vendor: VendorType) => {
    if (vendor === 'Cisco IOS') {
      return isDark
        ? 'bg-sky-500/20 text-sky-400 border-sky-500/40 ring-1 ring-sky-500/30'
        : 'bg-blue-100 text-blue-800 border-blue-300';
    }
    if (vendor === 'Huawei VRP') {
      return isDark
        ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 ring-1 ring-rose-500/30'
        : 'bg-rose-100 text-rose-800 border-rose-300';
    }
    return isDark
      ? 'bg-amber-500/20 text-amber-400 border-amber-500/40 ring-1 ring-amber-500/30'
      : 'bg-amber-100 text-amber-800 border-amber-300';
  };

  return (
    <div className="space-y-3">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.cfg,.conf,.log"
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* Upload Box or Badge */}
      {!uploadedFile ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`group relative flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-xl cursor-pointer text-center transition-all ${
            isDragging
              ? 'border-cyan-400 bg-cyan-500/10 scale-[0.99]'
              : isDark
              ? 'border-slate-700/80 bg-slate-900/50 hover:border-cyan-500/50 hover:bg-slate-800/60'
              : 'border-slate-300 bg-white/70 hover:border-blue-500/60 hover:bg-slate-50'
          }`}
        >
          <div
            className={`p-2.5 rounded-full mb-2 transition-transform group-hover:scale-110 ${
              isDark ? 'bg-slate-800 text-cyan-400' : 'bg-blue-50 text-blue-600'
            }`}
          >
            <Upload className="w-5 h-5" />
          </div>
          <p className={`text-xs font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
            {isTH ? 'ลากไฟล์ .txt วางที่นี่' : 'Drag & drop .txt config file'}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {isTH ? 'หรือคลิกเพื่อเลือกไฟล์ Cisco / Huawei' : 'or click to browse Cisco / Huawei'}
          </p>
        </div>
      ) : (
        /* Uploaded File Badge */
        <div
          className={`p-3 rounded-xl border transition-all ${
            isDark
              ? 'bg-slate-900/90 border-slate-700/80 shadow-md shadow-slate-950/40'
              : 'bg-white border-slate-200 shadow-sm'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`p-2 rounded-lg shrink-0 ${
                  isDark ? 'bg-cyan-500/10 text-cyan-400' : 'bg-blue-50 text-blue-600'
                }`}
              >
                <FileText className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className={`text-xs font-bold truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                  {uploadedFile.fileName}
                </p>
                <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 font-mono">
                  <span>{uploadedFile.fileSize}</span>
                  <span>•</span>
                  <span>{uploadedFile.parsedData?.rawLinesCount || 0} {isTH ? 'บรรทัด' : 'lines'}</span>
                </div>
              </div>
            </div>

            <button
              onClick={onRemoveFile}
              title={isTH ? 'นำไฟล์ออก' : 'Remove File'}
              className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Auto-detected Vendor Tag */}
          <div className="mt-2.5 pt-2.5 border-t border-slate-800/60 flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">
              {isTH ? 'ตรวจพบระบบ:' : 'Auto-detected:'}
            </span>
            <span
              className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${getVendorBadgeStyle(
                uploadedFile.detectedVendor
              )}`}
            >
              {uploadedFile.detectedVendor}
            </span>
          </div>

          {/* Actions on file */}
          <div className="mt-2 flex gap-1.5">
            <button
              onClick={onOpenRawViewer}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-colors cursor-pointer border ${
                isDark
                  ? 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
                  : 'border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-800'
              }`}
            >
              <Eye className="w-3 h-3 text-cyan-400" />
              <span>{isTH ? 'ดูไฟล์ดิบ' : 'View Raw'}</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className={`flex items-center justify-center gap-1 py-1.5 px-2.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer border ${
                isDark
                  ? 'border-slate-700 bg-slate-800/60 hover:bg-slate-700 text-slate-300'
                  : 'border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {isTH ? 'เปลี่ยน' : 'Change'}
            </button>
          </div>
        </div>
      )}

      {/* Preset Sample Config Picker */}
      <div className="pt-1">
        <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 mb-1.5">
          <Sparkles className="w-3 h-3 text-cyan-400" />
          <span>{isTH ? 'หรือเลือกตัวอย่าง Config:' : 'Or load sample config:'}</span>
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {SAMPLE_CONFIGS.map((sample) => {
            const isHuawei = sample.vendor === 'Huawei VRP';
            return (
              <button
                key={sample.id}
                onClick={() => loadSample(sample)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center justify-between group cursor-pointer ${
                  isDark
                    ? 'border-slate-800 bg-slate-900/60 hover:border-cyan-500/40 hover:bg-slate-800 text-slate-300'
                    : 'border-slate-200 bg-slate-50 hover:border-blue-400 hover:bg-white text-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isHuawei ? 'bg-rose-400' : 'bg-sky-400'
                    }`}
                  />
                  <span className="truncate text-[11px] font-medium">{sample.name}</span>
                </div>
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded font-mono uppercase ${
                    isHuawei
                      ? 'bg-rose-500/10 text-rose-400'
                      : 'bg-sky-500/10 text-sky-400'
                  }`}
                >
                  {isHuawei ? 'VRP' : 'IOS'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
