import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Settings,
  MessageSquare,
  Megaphone,
  CheckCircle2,
  XCircle,
  Terminal,
  Film,
  Sparkles,
  Send,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  Layers,
  Check,
  Clock,
  Sliders,
  FileText,
  Copy,
  Archive,
} from 'lucide-react';

interface HealthStatus {
  status: string;
  botActive: boolean;
  botStatus?: 'idle' | 'running' | 'standby' | 'error';
}

interface BotConfig {
  batchCaptionEnabled: boolean;
  batchTimeWindowMs: number;
  captionPrefix: string;
  captionSuffix: string;
  dumpChannelId?: string;
  dumpChannelEnabled?: boolean;
}

interface BatchSimResult {
  index: number;
  name: string;
  originalCaption: string;
  hadOriginalCode: boolean;
  appliedCaption: string | null;
  status: string;
}

export default function App() {
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [reclaiming, setReclaiming] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // Config state
  const [config, setConfig] = useState<BotConfig>({
    batchCaptionEnabled: true,
    batchTimeWindowMs: 2500,
    captionPrefix: '',
    captionSuffix: '',
    dumpChannelId: '',
    dumpChannelEnabled: false,
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSavedToast, setConfigSavedToast] = useState(false);

  // Dump channel state
  const [dumpChannelInput, setDumpChannelInput] = useState('');
  const [testingDump, setTestingDump] = useState(false);
  const [dumpFeedback, setDumpFeedback] = useState<{ success: boolean; message: string } | null>(null);

  // Single code tester state
  const [testInput, setTestInput] = useState('【FHD 1080p】Actress Name HMN-863 Uncensored.mp4');
  const [testResult, setTestResult] = useState<{ detected: boolean; code: string | null } | null>(null);
  const [testing, setTesting] = useState(false);

  // Batch simulator state (10 files where 1 has caption and 9 don't)
  const defaultBatchFiles = [
    { name: 'video_part01.mp4', caption: '【新作 1080p】HMN-863 Full Movie' },
    { name: 'video_part02.mp4', caption: '' },
    { name: 'video_part03.mp4', caption: '' },
    { name: 'video_part04.mp4', caption: '' },
    { name: 'video_part05.mp4', caption: '' },
    { name: 'video_part06.mp4', caption: '' },
    { name: 'video_part07.mp4', caption: '' },
    { name: 'video_part08.mp4', caption: '' },
    { name: 'video_part09.mp4', caption: '' },
    { name: 'video_part10.mp4', caption: '' },
  ];
  const [batchFiles, setBatchFiles] = useState(defaultBatchFiles);
  const [batchSimLoading, setBatchSimLoading] = useState(false);
  const [batchSimResponse, setBatchSimResponse] = useState<{
    detectedCode: string | null;
    finalCaption: string | null;
    results: BatchSimResult[];
  } | null>(null);

  const fetchHealth = () => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to fetch status', err);
        setLoading(false);
      });
  };

  const fetchConfig = () => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        setConfig(data);
        if (data.dumpChannelId !== undefined) {
          setDumpChannelInput(data.dumpChannelId);
        }
      })
      .catch((err) => console.error('Failed to fetch config', err));
  };

  const handleTestDumpChannel = async () => {
    if (!dumpChannelInput.trim()) return;
    setTestingDump(true);
    setDumpFeedback(null);
    try {
      const res = await fetch('/api/test-dump', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: dumpChannelInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDumpFeedback({ success: true, message: data.message });
      } else {
        setDumpFeedback({ success: false, message: data.error || 'Failed to send message to channel' });
      }
    } catch (err: any) {
      setDumpFeedback({ success: false, message: err.message || 'Network error' });
    } finally {
      setTestingDump(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    fetchConfig();
    runCodeTest('【FHD 1080p】Actress Name HMN-863 Uncensored.mp4');
    runBatchSimulation(defaultBatchFiles);

    // Poll status and logs every 2.5 seconds
    const interval = setInterval(() => {
      fetchHealth();
      fetch('/api/logs')
        .then((res) => res.json())
        .then((data) => setLogs(data))
        .catch(() => {});
    }, 2500);

    fetch('/api/logs')
      .then((res) => res.json())
      .then((data) => setLogs(data))
      .catch(() => {});

    return () => clearInterval(interval);
  }, []);

  const handleReclaimBot = async () => {
    setReclaiming(true);
    try {
      await fetch('/api/reclaim-bot', { method: 'POST' });
      fetchHealth();
    } catch (err) {
      console.error('Reclaim error:', err);
    } finally {
      setTimeout(() => setReclaiming(false), 2000);
    }
  };

  const handleUpdateConfig = async (newConfig: Partial<BotConfig>) => {
    const updated = { ...config, ...newConfig };
    setConfig(updated);
    setSavingConfig(true);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
      }
      setConfigSavedToast(true);
      setTimeout(() => setConfigSavedToast(false), 2500);
    } catch (err) {
      console.error('Failed to update config', err);
    } finally {
      setSavingConfig(false);
    }
  };

  const runCodeTest = async (text: string) => {
    setTesting(true);
    try {
      const res = await fetch('/api/test-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult(null);
    } finally {
      setTesting(false);
    }
  };

  const handleTestSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (testInput.trim()) {
      runCodeTest(testInput.trim());
    }
  };

  const runBatchSimulation = async (filesToSimulate = batchFiles) => {
    setBatchSimLoading(true);
    try {
      const res = await fetch('/api/test-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesToSimulate }),
      });
      const data = await res.json();
      setBatchSimResponse(data);
    } catch (err) {
      console.error('Batch test failed', err);
    } finally {
      setBatchSimLoading(false);
    }
  };

  const updateFileCaption = (index: number, newCaption: string) => {
    const updated = [...batchFiles];
    updated[index] = { ...updated[index], caption: newCaption };
    setBatchFiles(updated);
  };

  const samplePresets = [
    'HMN-863',
    '【新作】hmn-863 1080p',
    'FC2-PPV-2849184 uncensored',
    'Actress Title - IPX-534.mp4',
    '010121-001 1pondo',
    'SSNI-999 (Full HD)',
  ];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-800/80 backdrop-blur border border-slate-700/80 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center space-x-4">
            <div className="p-3 bg-gradient-to-tr from-amber-600 to-orange-500 rounded-xl shadow-md">
              <Film className="w-8 h-8 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-white">JAV Video Code Bot</h1>
                <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Batch Forward Ready
                </span>
              </div>
              <p className="text-slate-400 text-sm mt-0.5">
                Detects video codes (e.g. <span className="text-amber-400 font-mono font-medium">HMN-863</span>) and forwards media with clean code captions
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 text-sm">
                <div className="w-4 h-4 border-2 border-slate-400 border-t-amber-500 rounded-full animate-spin" />
                <span>Checking bot...</span>
              </div>
            ) : status?.botStatus === 'standby' ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Standby</span>
                </div>
                <button
                  onClick={handleReclaimBot}
                  disabled={reclaiming}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition shadow-sm"
                  title="Claim active connection for this instance"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${reclaiming ? 'animate-spin' : ''}`} />
                  <span>Take Over Polling</span>
                </button>
              </div>
            ) : status?.botActive ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Bot Online</span>
                </div>
                <button
                  onClick={handleReclaimBot}
                  disabled={reclaiming}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 hover:text-white transition"
                  title="Reconnect Bot Polling"
                >
                  <RefreshCw className={`w-4 h-4 ${reclaiming ? 'animate-spin' : ''}`} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-medium">
                <XCircle className="w-4 h-4" />
                <span>Missing Bot Token</span>
              </div>
            )}
          </div>
        </header>

        {/* Feature: Batch Forward Caption Options */}
        <section className="bg-gradient-to-br from-slate-800/90 to-slate-800/60 border border-amber-500/30 rounded-2xl p-6 shadow-xl space-y-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-700/80 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white">Batch Forward Captioning</h2>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                    config.batchCaptionEnabled
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-700 text-slate-400 border border-slate-600'
                  }`}>
                    {config.batchCaptionEnabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Forward up to 10 files at once where only 1 has a caption &mdash; the bot applies that caption to all files!
                </p>
              </div>
            </div>

            {/* Quick Toggle Switch */}
            <div className="flex items-center gap-3 self-start sm:self-center">
              <span className="text-xs font-medium text-slate-300">
                {config.batchCaptionEnabled ? 'Active' : 'Disabled'}
              </span>
              <button
                type="button"
                onClick={() => handleUpdateConfig({ batchCaptionEnabled: !config.batchCaptionEnabled })}
                disabled={savingConfig}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  config.batchCaptionEnabled ? 'bg-amber-500' : 'bg-slate-700'
                }`}
                role="switch"
                aria-checked={config.batchCaptionEnabled}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    config.batchCaptionEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Config Controls */}
          <div className="bg-slate-900/70 border border-slate-700/70 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>Batch Forward Collection Window</span>
              </div>
              <span className="text-xs font-mono font-bold text-amber-400">
                {config.batchTimeWindowMs / 1000}s
              </span>
            </div>
            <p className="text-xs text-slate-400">
              When 10 files are forwarded together at one time, the bot collects the burst within this window, extracts the code from whichever file has it, and applies that caption to all files in the batch.
            </p>
            <div className="flex gap-2 pt-1 max-w-md">
              {[1500, 2500, 4000].map((ms) => (
                <button
                  key={ms}
                  type="button"
                  onClick={() => handleUpdateConfig({ batchTimeWindowMs: ms })}
                  className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition ${
                    config.batchTimeWindowMs === ms
                      ? 'bg-amber-500 text-slate-950 font-bold'
                      : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
                  }`}
                >
                  {ms / 1000}s {ms === 2500 ? '(Recommended)' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Toast feedback */}
          {configSavedToast && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-lg w-fit">
              <Check className="w-3.5 h-3.5" />
              <span>Settings saved &amp; synchronized with Telegram Bot!</span>
            </div>
          )}
        </section>

        {/* Dump Channel Archive Card */}
        <section className="bg-gradient-to-br from-slate-800/90 to-slate-800/60 border border-sky-500/30 rounded-2xl p-6 shadow-xl space-y-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-sky-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-700/80 pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-sky-500/20 text-sky-400 rounded-xl border border-sky-500/30">
                <Archive className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-white">Dump / Backup Channel</h2>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded ${
                    config.dumpChannelEnabled && config.dumpChannelId
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-slate-700 text-slate-400 border border-slate-600'
                  }`}>
                    {config.dumpChannelEnabled && config.dumpChannelId ? 'ACTIVE' : 'DISABLED'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Automatically forward every successfully captioned file sent to the bot into your private or public archive channel.
                </p>
              </div>
            </div>

            {/* Toggle Switch */}
            <div className="flex items-center gap-3 self-start sm:self-center">
              <span className="text-xs font-medium text-slate-300">
                {config.dumpChannelEnabled ? 'Dumping Active' : 'Off'}
              </span>
              <button
                type="button"
                onClick={() => handleUpdateConfig({ dumpChannelEnabled: !config.dumpChannelEnabled })}
                disabled={savingConfig}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  config.dumpChannelEnabled ? 'bg-sky-500' : 'bg-slate-700'
                }`}
                role="switch"
                aria-checked={config.dumpChannelEnabled}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    config.dumpChannelEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-700/80 rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-slate-300 block">
                  Dump Channel Username or Telegram ID
                </label>
                <input
                  type="text"
                  value={dumpChannelInput}
                  onChange={(e) => setDumpChannelInput(e.target.value)}
                  placeholder="e.g. @my_dump_channel or -1001234567890"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
              </div>

              <div className="flex items-end gap-2 pt-1 sm:pt-5">
                <button
                  type="button"
                  onClick={() => handleUpdateConfig({ dumpChannelId: dumpChannelInput.trim(), dumpChannelEnabled: !!dumpChannelInput.trim() })}
                  disabled={savingConfig}
                  className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-xl transition flex items-center gap-1.5 text-xs shadow-md"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Channel</span>
                </button>

                <button
                  type="button"
                  onClick={handleTestDumpChannel}
                  disabled={testingDump || !dumpChannelInput.trim()}
                  className="bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-40 text-slate-200 font-medium px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 text-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingDump ? 'animate-spin' : ''}`} />
                  <span>Test &amp; Ping</span>
                </button>
              </div>
            </div>

            {dumpFeedback && (
              <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                dumpFeedback.success
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
              }`}>
                {dumpFeedback.success ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
                <span>{dumpFeedback.message}</span>
              </div>
            )}

            <div className="flex items-start gap-2 pt-1 text-slate-400 text-xs">
              <span className="text-sky-400 font-bold">ℹ️ Note:</span>
              <span>
                Make sure you add <strong>@translatefaroffbot</strong> to your dump channel as an <strong>Administrator</strong> with the <strong>"Post Messages"</strong> permission enabled.
              </span>
            </div>
          </div>
        </section>

        {/* Interactive 10-File Batch Forward Simulator */}
        <section className="bg-slate-800/90 border border-slate-700 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-700/70 pb-3">
            <div className="flex items-center gap-2.5">
              <Layers className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-semibold text-white">10-File Batch Forward Simulator</h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>Tests scenario: 10 files forwarded, only 1 has caption</span>
            </div>
          </div>

          <p className="text-sm text-slate-300">
            Below is a simulated forward of <strong>10 files</strong>. Only <span className="text-amber-400 font-semibold">File 1</span> has a caption with the video code <code className="bg-slate-900 px-1.5 py-0.5 rounded text-amber-300 font-mono text-xs">HMN-863</code>, while <span className="text-slate-400">Files 2 to 10</span> have no captions. Click <strong>Run Batch Forward</strong> to verify how the bot propagates the code to all 10 files!
          </p>

          {/* Files List Preview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
            {batchFiles.map((file, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                  file.caption
                    ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
                    : 'bg-slate-900/60 border-slate-700/60 text-slate-400'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className={`w-4 h-4 flex-shrink-0 ${file.caption ? 'text-amber-400' : 'text-slate-500'}`} />
                  <div className="truncate">
                    <span className="font-mono font-medium text-slate-300">{file.name}</span>
                    {file.caption ? (
                      <div className="text-[11px] text-amber-300 font-medium truncate">
                        Caption: "{file.caption}"
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 italic">No caption</div>
                    )}
                  </div>
                </div>

                <div className="flex-shrink-0">
                  {file.caption ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Has Code
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-500">
                      Uncaptioned
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-medium text-slate-300">Editable Caption for File 1:</span>
              <input
                type="text"
                value={batchFiles[0].caption}
                onChange={(e) => updateFileCaption(0, e.target.value)}
                placeholder="Type code or caption for File 1..."
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-amber-300 font-mono focus:outline-none focus:ring-1 focus:ring-amber-500 w-64"
              />
            </div>

            <button
              type="button"
              onClick={() => runBatchSimulation()}
              disabled={batchSimLoading}
              className="bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-xl transition flex items-center gap-2 text-xs shadow-md"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${batchSimLoading ? 'animate-spin' : ''}`} />
              <span>Run 10-File Batch Forward</span>
            </button>
          </div>

          {/* Simulation Output Display */}
          {batchSimResponse && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-bold text-white">Batch Result: All 10 Files Processed!</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">
                    Detected Code:{' '}
                    <strong className="text-amber-400 font-mono text-sm">{batchSimResponse.detectedCode || 'None'}</strong>
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                    10/10 Captioned
                  </span>
                </div>
              </div>

              {/* Result Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {batchSimResponse.results.map((res) => (
                  <div
                    key={res.index}
                    className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-slate-300 truncate">
                        #{res.index} {res.name}
                      </div>
                      <div className="text-[11px] text-amber-300 font-medium">
                        Resent with caption: <strong className="font-mono font-bold">{res.appliedCaption}</strong>
                      </div>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                      res.hadOriginalCode
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/20 text-emerald-400'
                    }`}>
                      {res.hadOriginalCode ? 'Source Code' : 'Inherited Caption'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Quick Individual Code Tester */}
        <section className="bg-slate-800/90 border border-slate-700 rounded-2xl p-6 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-700/70 pb-3">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-semibold text-white">Quick Code Detector Tester</h2>
            </div>
            <span className="text-xs text-slate-400">Tests regex extraction</span>
          </div>

          <form onSubmit={handleTestSubmit} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Type or paste sample caption / filename (e.g. [1080p] HMN-863 Full Movie)..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              />
              <button
                type="submit"
                disabled={testing}
                className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium px-5 py-2.5 rounded-xl transition flex items-center justify-center gap-2 text-sm shadow-md"
              >
                <Send className="w-4 h-4" />
                <span>Test Caption</span>
              </button>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-xs text-slate-400 mr-1">Quick Presets:</span>
              {samplePresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setTestInput(preset);
                    runCodeTest(preset);
                  }}
                  className="text-xs font-mono bg-slate-900/90 hover:bg-slate-700 border border-slate-700 text-slate-300 px-2.5 py-1 rounded-lg transition"
                >
                  {preset}
                </button>
              ))}
            </div>
          </form>

          {/* Test Result Display */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="w-full sm:w-auto">
              <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">
                Input Caption
              </div>
              <div className="text-sm font-mono text-slate-300 break-all bg-slate-900/60 p-2 rounded-lg border border-slate-800">
                "{testInput}"
              </div>
            </div>

            <ArrowRight className="hidden sm:block w-5 h-5 text-slate-500 flex-shrink-0" />

            <div className="w-full sm:w-auto">
              <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-1">
                Resent Caption
              </div>
              {testResult?.detected ? (
                <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 px-3.5 py-2 rounded-lg">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                  <div>
                    <span className="text-xs text-amber-300 font-medium block">Resends media with caption:</span>
                    <span className="text-base font-mono font-bold text-amber-300 tracking-wide">
                      {testResult.code}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-lg text-slate-400 text-sm">
                  <XCircle className="w-4 h-4 text-slate-500" />
                  <span>No code found in caption</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Live Logs */}
        <section className="bg-slate-950 rounded-2xl shadow-xl border border-slate-800 p-6 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-3 text-slate-300">
              <Terminal className="w-5 h-5 text-amber-400" />
              <h2 className="text-base font-semibold">Live Activity &amp; Batch Forward Logs</h2>
            </div>
            <span className="text-xs font-mono text-slate-500">Auto-refreshing</span>
          </div>
          <div className="font-mono text-xs space-y-1.5 h-52 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 p-2">
            {logs.length === 0 ? (
              <p className="text-slate-500 italic py-4 text-center">Waiting for bot activity (forward files to your bot)...</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="py-1 px-2 rounded hover:bg-slate-900 border-b border-slate-900 text-slate-300 break-words">
                  {log}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Setup & Telegram Commands Guide */}
        <section className="bg-slate-800/80 rounded-2xl shadow-sm border border-slate-700/80 p-6 space-y-6">
          <div className="flex items-center space-x-3 border-b border-slate-700/80 pb-4">
            <Settings className="w-5 h-5 text-slate-400" />
            <h2 className="text-lg font-semibold text-white">How to Use &amp; Bot Commands</h2>
          </div>

          <ol className="space-y-5">
            <Step
              number={1}
              title="Batch Forwarding 10 Files at Once"
              icon={<Layers className="w-4 h-4 text-amber-400" />}
              description="Select multiple files in any Telegram channel or chat and forward them together. As long as at least 1 file has the video code (e.g. HMN-863) in its caption, the bot automatically applies that caption to all 10 files!"
            />
            <Step
              number={2}
              title="Control with Telegram Commands (Single-Tap)"
              icon={<MessageSquare className="w-4 h-4 text-amber-400" />}
              description="Telegram commands don't allow spaces: tap /batch to see status, /batch_on or /batch-on to enable, /batch_off or /batch-off to disable batch captioning."
            />
            <Step
              number={3}
              title="Channels & Groups"
              icon={<Megaphone className="w-4 h-4 text-orange-400" />}
              description="Add the bot to your channel as an Administrator with 'Edit Messages' permission. When posts are forwarded or published, the bot cleans and unifies all post captions."
            />
            <Step
              number={4}
              title="Dump / Backup Channel"
              icon={<Archive className="w-4 h-4 text-sky-400" />}
              description="Add the bot as an Administrator in your private or public channel with 'Post Messages' permission. Enter your channel ID or @username in the dashboard or send /setdump @your_channel. Every successfully captioned file will automatically be forwarded to your dump channel."
            />
          </ol>
        </section>

      </div>
    </div>
  );
}

function Step({
  number,
  title,
  description,
  icon,
}: {
  number: number;
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <li className="flex space-x-4">
      <div className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/20 text-amber-400 font-bold text-xs border border-amber-500/30">
        {number}
      </div>
      <div>
        <h4 className="font-medium text-white flex items-center space-x-2 text-sm">
          <span>{title}</span>
          {icon && <span>{icon}</span>}
        </h4>
        <p className="text-slate-400 mt-1 text-xs leading-relaxed">{description}</p>
      </div>
    </li>
  );
}
