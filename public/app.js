const audioFileInput = document.querySelector("#audio-file-input");
const uploadDropzone = document.querySelector("#upload-dropzone");
const analyzeFileButton = document.querySelector("#analyze-file");
const clearAllButton = document.querySelector("#clear-all");
const thresholdRange = document.querySelector("#threshold-range");
const thresholdValue = document.querySelector("#threshold-value");
const dbRange = document.querySelector("#db-range");
const dbValue = document.querySelector("#db-value");
const windowRange = document.querySelector("#window-range");
const windowValue = document.querySelector("#window-value");
const maxResultsInput = document.querySelector("#max-results");
const analysisSummary = document.querySelector("#analysis-summary");
const fileMeta = document.querySelector("#file-meta");
const recordingCount = document.querySelector("#recording-count");
const recordingList = document.querySelector("#recording-list");
const recordingEmptyState = document.querySelector("#recording-empty-state");
const playToggleButton = document.querySelector("#play-toggle");
const restartPlaybackButton = document.querySelector("#restart-playback");
const stopPlaybackButton = document.querySelector("#stop-playback");
const seekRange = document.querySelector("#seek-range");
const seekValue = document.querySelector("#seek-value");
const volumeRange = document.querySelector("#volume-range");
const volumeValue = document.querySelector("#volume-value");
const playbackStatus = document.querySelector("#playback-status");
const currentTimeLabel = document.querySelector("#current-time-label");
const chartCurrentTimeLabel = document.querySelector("#chart-current-time-label");
const playerModeLabel = document.querySelector("#player-mode-label");
const waveformCanvas = document.querySelector("#waveform-canvas");
const peakList = document.querySelector("#peak-list");
const peakEmptyState = document.querySelector("#peak-empty-state");
const jumpLoudestButton = document.querySelector("#jump-loudest");
const analysisRaw = document.querySelector("#analysis-raw");
const toast = document.querySelector("#toast");
const ALL_RECORDINGS_ID = "__all_recordings__";

const state = {
  recordings: [],
  activeRecordingId: null,
  thresholdRatio: 0.72,
  dbThreshold: -24,
  windowMs: 600,
  maxResults: 12,
  currentTime: 0,
  isPlaying: false,
  volume: 1,
  analysisJobId: 0
};

let audioContext = null;
let gainNode = null;
let currentSource = null;
let analyzeTimer = 0;
let lastRenderedPeakKey = "";
let playbackAnchorOffset = 0;
let playbackAnchorStamp = 0;
let playbackFrame = 0;

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.background = isError ? "rgba(143, 42, 32, 0.94)" : "rgba(16, 34, 57, 0.94)";

  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.add("hidden");
  }, 2600);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const restSeconds = seconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(restSeconds).padStart(2, "0")}`;
}

function formatDurationPrecise(totalSeconds) {
  const safeValue = Math.max(0, Number(totalSeconds) || 0);
  const seconds = Math.floor(safeValue);
  const tenths = Math.floor((safeValue - seconds) * 10);
  return `${formatDuration(seconds)}.${tenths}`;
}

function formatFileSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Number(bytes) || 0;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function toDb(rms) {
  const safeValue = Math.max(Number(rms) || 0, 0.00001);
  return 20 * Math.log10(safeValue);
}

function prettyJson(value) {
  return JSON.stringify(value, null, 2);
}

function setButtonState(button, text, loading) {
  if (!button) {
    return;
  }

  if (loading) {
    button.dataset.originalText = button.textContent;
    button.textContent = text;
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }

  button.disabled = loading;
}

function updateControlLabels() {
  thresholdValue.textContent = `${Math.round(state.thresholdRatio * 100)}%`;
  dbValue.textContent = `${state.dbThreshold} dB`;
  windowValue.textContent = `${(state.windowMs / 1000).toFixed(1)} 秒`;
}

function updateVolumeLabel() {
  volumeValue.textContent = `${Math.round(state.volume * 100)}%`;
}

function createRecordingId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `recording-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isAudioFile(file) {
  if (!file) {
    return false;
  }

  if (file.type?.startsWith("audio/")) {
    return true;
  }

  return /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm)$/i.test(file.name || "");
}

function createRecording(file) {
  return {
    id: createRecordingId(),
    file,
    audioBuffer: null,
    segments: [],
    peaks: [],
    duration: 0,
    loudestPeak: null,
    playhead: 0,
    status: "loading",
    errorMessage: ""
  };
}

function isAllRecordingsView() {
  return state.activeRecordingId === ALL_RECORDINGS_ID;
}

function getActiveRecording() {
  if (isAllRecordingsView()) {
    return null;
  }

  return state.recordings.find((recording) => recording.id === state.activeRecordingId) || null;
}

function getReadyRecordings() {
  return state.recordings.filter((recording) => recording.status === "ready" && recording.audioBuffer);
}

function getAggregateViewModel() {
  const readyRecordings = getReadyRecordings();
  if (!readyRecordings.length) {
    return null;
  }

  let offset = 0;
  const recordings = [];
  const segments = [];
  let globalMaxRms = 0;

  for (const recording of readyRecordings) {
    recordings.push({
      id: recording.id,
      name: recording.file.name,
      startOffset: offset,
      endOffset: offset + recording.duration,
      duration: recording.duration
    });

    for (const segment of recording.segments) {
      segments.push({
        ...segment,
        globalStartTime: offset + segment.startTime,
        globalEndTime: offset + segment.endTime,
        globalCenterTime: offset + segment.centerTime,
        recordingId: recording.id,
        recordingName: recording.file.name,
        localTime: segment.centerTime
      });

      globalMaxRms = Math.max(globalMaxRms, segment.rms);
    }

    offset += recording.duration;
  }

  const combinedSegments = segments.map((segment) => ({
    ...segment,
    startTime: segment.globalStartTime,
    endTime: segment.globalEndTime,
    centerTime: segment.globalCenterTime,
    normalized: globalMaxRms ? segment.rms / globalMaxRms : 0
  }));

  const allPeaks = collectPeaks(combinedSegments, state.thresholdRatio, state.dbThreshold, Infinity);
  const visiblePeaks = allPeaks
    .slice()
    .sort((left, right) => left.time - right.time);

  const loudestPeak = allPeaks.reduce((current, peak) => {
    if (!current || peak.score > current.score) {
      return peak;
    }

    return current;
  }, null);

  return {
    duration: offset,
    recordings,
    segments: combinedSegments,
    peaks: visiblePeaks,
    loudestPeak,
    totalPeakCount: allPeaks.length
  };
}

function updateAnalyzeButtonState() {
  analyzeFileButton.disabled = getReadyRecordings().length === 0;
  clearAllButton.disabled = state.recordings.length === 0;
}

function updatePeakEmptyState(message) {
  const activeRecording = getActiveRecording();
  const aggregateView = isAllRecordingsView() ? getAggregateViewModel() : null;
  const hasPeaks = isAllRecordingsView()
    ? Boolean(aggregateView?.peaks.length)
    : Boolean(activeRecording?.status === "ready" && activeRecording.peaks.length);

  peakList.hidden = !hasPeaks;
  peakEmptyState.hidden = hasPeaks;

  if (!hasPeaks && message) {
    peakEmptyState.textContent = message;
  }
}

function updateCurrentTimeLabel() {
  const activeRecording = getActiveRecording();
  const aggregateView = isAllRecordingsView() ? getAggregateViewModel() : null;
  const duration = aggregateView?.duration || activeRecording?.duration || 0;
  const safeTime = clamp(state.currentTime, 0, duration);
  const text = `${formatDuration(safeTime)} / ${formatDuration(duration)}`;

  currentTimeLabel.textContent = text;
  chartCurrentTimeLabel.textContent = text;
  seekRange.max = String(duration);
  seekRange.value = String(safeTime);
  seekValue.textContent = formatDurationPrecise(safeTime);

  if (activeRecording) {
    activeRecording.playhead = safeTime;
  }
}

function setSummary(lines, loading = false) {
  analysisSummary.classList.toggle("loading", loading);
  analysisSummary.textContent = lines.join("\n");
}

function setPlaybackMessage(message) {
  playbackStatus.textContent = message;
}

async function ensureAudioContext() {
  if (!audioContext) {
    const Context = window.AudioContext || window.webkitAudioContext;

    if (!Context) {
      throw new Error("当前浏览器不支持音频解码，请换用较新的 Chrome、Edge 或 Safari");
    }

    audioContext = new Context();
    gainNode = audioContext.createGain();
    gainNode.gain.value = state.volume;
    gainNode.connect(audioContext.destination);
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function stopPlaybackLoop() {
  if (playbackFrame) {
    window.cancelAnimationFrame(playbackFrame);
    playbackFrame = 0;
  }
}

function destroySource() {
  if (!currentSource) {
    return;
  }

  const source = currentSource;
  currentSource = null;
  source.onended = null;

  try {
    source.stop();
  } catch (error) {
    // Ignore double-stop errors while switching tracks or seeking quickly.
  }

  source.disconnect();
}

function pausePlayback() {
  if (!state.isPlaying) {
    return;
  }

  syncPlaybackClock();
  state.isPlaying = false;
  destroySource();
  stopPlaybackLoop();
  updatePlaybackControls();
  updateCurrentTimeLabel();
  updateActivePeak();
  renderWaveform();
}

function updatePlaybackControls() {
  const activeRecording = getActiveRecording();
  const aggregateView = isAllRecordingsView() ? getAggregateViewModel() : null;
  const ready = Boolean(activeRecording?.status === "ready" && activeRecording.audioBuffer);

  playToggleButton.disabled = !ready;
  restartPlaybackButton.disabled = !ready;
  stopPlaybackButton.disabled = !state.isPlaying;
  seekRange.disabled = !ready;
  jumpLoudestButton.disabled = isAllRecordingsView()
    ? !aggregateView?.loudestPeak
    : !(ready && activeRecording?.loudestPeak);
  seekRange.max = String(activeRecording?.duration || aggregateView?.duration || 0);
  playToggleButton.textContent = state.isPlaying ? "暂停" : "播放";

  if (isAllRecordingsView()) {
    playerModeLabel.textContent = "总览模式";
    return;
  }

  if (!activeRecording) {
    playerModeLabel.textContent = "等待选择当前录音";
    return;
  }

  if (activeRecording.status === "loading" || activeRecording.status === "analyzing") {
    playerModeLabel.textContent = "分析中";
    return;
  }

  if (activeRecording.status === "error") {
    playerModeLabel.textContent = "解析失败";
    return;
  }

  playerModeLabel.textContent = state.isPlaying ? "正在播放" : "已暂停";
}

function recordingStatusLabel(status) {
  if (status === "loading" || status === "analyzing") {
    return "分析中";
  }

  if (status === "error") {
    return "失败";
  }

  return "已完成";
}

function renderRecordingList() {
  recordingList.replaceChildren();

  if (!state.recordings.length) {
    recordingList.hidden = true;
    recordingEmptyState.hidden = false;
    recordingCount.textContent = "0 段录音";
    return;
  }

  const fragment = document.createDocumentFragment();
  const aggregateView = getAggregateViewModel();

  if (aggregateView) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const topRow = document.createElement("span");
    const name = document.createElement("span");
    const status = document.createElement("span");
    const meta = document.createElement("span");

    button.type = "button";
    button.className = "recording-item recording-item-all";
    button.dataset.id = ALL_RECORDINGS_ID;
    button.classList.toggle("active", isAllRecordingsView());

    topRow.className = "recording-item-top";
    name.className = "recording-item-name";
    name.textContent = "全部录音";

    status.className = "recording-status ready";
    status.textContent = "总览";

    meta.className = "recording-item-meta";
    meta.textContent = `${aggregateView.recordings.length} 段已完成 · ${formatDuration(aggregateView.duration)} · ${aggregateView.totalPeakCount} 个时间点`;

    topRow.append(name, status);
    button.append(topRow, meta);
    item.appendChild(button);
    fragment.appendChild(item);
  }

  for (const recording of state.recordings) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const topRow = document.createElement("span");
    const name = document.createElement("span");
    const status = document.createElement("span");
    const meta = document.createElement("span");

    button.type = "button";
    button.className = "recording-item";
    button.dataset.id = recording.id;
    button.classList.toggle("active", recording.id === state.activeRecordingId);

    topRow.className = "recording-item-top";
    name.className = "recording-item-name";
    name.textContent = recording.file.name;

    status.className = `recording-status ${recording.status}`;
    status.textContent = recordingStatusLabel(recording.status);

    meta.className = "recording-item-meta";
    if (recording.status === "error") {
      meta.textContent = recording.errorMessage || "当前录音无法解析";
    } else if (recording.status === "ready") {
      meta.textContent = `${formatFileSize(recording.file.size)} · ${formatDuration(recording.duration)} · ${recording.peaks.length} 个时间点`;
    } else {
      meta.textContent = `${formatFileSize(recording.file.size)} · 正在解码与分析`;
    }

    topRow.append(name, status);
    button.append(topRow, meta);
    item.appendChild(button);
    fragment.appendChild(item);
  }

  recordingList.appendChild(fragment);
  recordingList.hidden = false;
  recordingEmptyState.hidden = true;
  recordingCount.textContent = `${state.recordings.length} 段录音`;
}

function buildPeak(entry) {
  const peak = {
    time: entry.loudest.centerTime,
    startTime: entry.startSegment.startTime,
    endTime: entry.endSegment.endTime,
    score: entry.loudest.normalized,
    rms: entry.loudest.rms,
    db: entry.loudest.db,
    peakAmplitude: entry.loudest.peak
  };

  if (entry.loudest.recordingId) {
    peak.recordingId = entry.loudest.recordingId;
    peak.recordingName = entry.loudest.recordingName;
  }

  if (entry.loudest.localTime !== undefined) {
    peak.localTime = entry.loudest.localTime;
  }

  return peak;
}

function segmentBuffer(buffer, windowMs) {
  const sampleRate = buffer.sampleRate;
  const windowSize = Math.max(256, Math.round((windowMs / 1000) * sampleRate));
  const channelData = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const segments = [];
  let maxRms = 0;

  for (let start = 0, index = 0; start < buffer.length; start += windowSize, index += 1) {
    const end = Math.min(start + windowSize, buffer.length);
    let sumSquares = 0;
    let peak = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      let amplitude = 0;

      for (let channelIndex = 0; channelIndex < channelData.length; channelIndex += 1) {
        amplitude += Math.abs(channelData[channelIndex][sampleIndex] || 0);
      }

      amplitude /= channelData.length;
      sumSquares += amplitude * amplitude;

      if (amplitude > peak) {
        peak = amplitude;
      }
    }

    const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
    maxRms = Math.max(maxRms, rms);
    segments.push({
      index,
      startTime: start / sampleRate,
      endTime: end / sampleRate,
      centerTime: (start + end) / 2 / sampleRate,
      rms,
      db: toDb(rms),
      peak
    });
  }

  for (const segment of segments) {
    segment.normalized = maxRms ? segment.rms / maxRms : 0;
  }

  return segments;
}

function collectPeaks(segments, thresholdRatio, dbThreshold, maxResults = Infinity) {
  if (!segments.length) {
    return [];
  }

  const groups = [];
  let currentGroup = null;

  for (const segment of segments) {
    if (segment.normalized >= thresholdRatio && segment.db >= dbThreshold) {
      if (!currentGroup) {
        currentGroup = {
          startSegment: segment,
          endSegment: segment,
          loudest: segment
        };
      } else {
        currentGroup.endSegment = segment;
        if (segment.normalized > currentGroup.loudest.normalized) {
          currentGroup.loudest = segment;
        }
      }
      continue;
    }

    if (currentGroup) {
      groups.push(buildPeak(currentGroup));
      currentGroup = null;
    }
  }

  if (currentGroup) {
    groups.push(buildPeak(currentGroup));
  }

  if (!groups.length) {
    return segments
      .filter((segment, index) => {
        const previous = segments[index - 1]?.normalized ?? 0;
        const next = segments[index + 1]?.normalized ?? 0;
        return segment.normalized >= previous && segment.normalized >= next && segment.db >= dbThreshold;
      })
      .sort((left, right) => right.normalized - left.normalized)
      .slice(0, maxResults)
      .map((segment) => ({
        time: segment.centerTime,
        startTime: segment.startTime,
        endTime: segment.endTime,
        score: segment.normalized,
        rms: segment.rms,
        db: segment.db,
        recordingId: segment.recordingId,
        recordingName: segment.recordingName,
        localTime: segment.localTime,
        peakAmplitude: segment.peak
      }))
      .sort((left, right) => left.time - right.time);
  }

  return groups
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults)
    .sort((left, right) => left.time - right.time);
}

function updateRecordingAnalysis(recording, recomputeSegments = true) {
  if (!recording.audioBuffer) {
    throw new Error("录音还没有解码完成");
  }

  if (recomputeSegments || !recording.segments.length) {
    recording.segments = segmentBuffer(recording.audioBuffer, state.windowMs);
  }

  recording.duration = recording.audioBuffer.duration;
  recording.peaks = collectPeaks(recording.segments, state.thresholdRatio, state.dbThreshold, state.maxResults);
  recording.loudestPeak = recording.peaks.reduce((current, peak) => {
    if (!current || peak.score > current.score) {
      return peak;
    }

    return current;
  }, null);
  recording.playhead = clamp(recording.playhead || 0, 0, recording.duration);
}

function renderSummary() {
  if (!state.recordings.length) {
    setSummary(["请选择一段或多段录音开始分析。"], false);
    return;
  }

  const activeRecording = getActiveRecording();
  const aggregateView = isAllRecordingsView() ? getAggregateViewModel() : null;
  const readyCount = state.recordings.filter((recording) => recording.status === "ready").length;
  const errorCount = state.recordings.filter((recording) => recording.status === "error").length;
  const loadingCount = state.recordings.length - readyCount - errorCount;
  const lines = [
    `已上传：${state.recordings.length} 段录音`,
    `分析完成：${readyCount} 段`,
    `分析中：${loadingCount} 段`,
    `失败：${errorCount} 段`
  ];

  if (isAllRecordingsView()) {
    lines.push("当前查看：全部录音");
    if (!aggregateView) {
      lines.push("当前状态：正在等待至少一段录音完成分析");
      setSummary(lines, true);
      return;
    }

    const loudestText = aggregateView.loudestPeak
      ? `${aggregateView.loudestPeak.recordingName} · ${formatDurationPrecise(aggregateView.loudestPeak.localTime)} (${Math.round(aggregateView.loudestPeak.score * 100)}%)`
      : "暂未识别";

    lines.push(`总时长：${formatDuration(aggregateView.duration)}`);
    lines.push(`筛选下限：${state.dbThreshold} dB`);
    lines.push(`汇总结果：${aggregateView.totalPeakCount} 个时间点`);
    lines.push(`当前展示：全部 ${aggregateView.peaks.length} 个高音量时间点`);
    lines.push(`最大声音位置：${loudestText}`);
    setSummary(lines, false);
    return;
  }

  if (!activeRecording) {
    lines.push("当前查看：未选择");
    setSummary(lines, false);
    return;
  }

  lines.push(`当前查看：${activeRecording.file.name}`);

  if (activeRecording.status === "ready") {
    const loudestText = activeRecording.loudestPeak
      ? `${formatDurationPrecise(activeRecording.loudestPeak.time)} (${Math.round(activeRecording.loudestPeak.score * 100)}%)`
      : "暂未识别";

    lines.push(`时长：${formatDuration(activeRecording.duration)}`);
    lines.push(`声道：${activeRecording.audioBuffer.numberOfChannels} 声道`);
    lines.push(`采样率：${activeRecording.audioBuffer.sampleRate} Hz`);
    lines.push(`筛选下限：${state.dbThreshold} dB`);
    lines.push(`识别结果：${activeRecording.peaks.length} 个时间点`);
    lines.push(`最大声音位置：${loudestText}`);
    setSummary(lines, false);
    return;
  }

  if (activeRecording.status === "error") {
    lines.push(`当前状态：解析失败`);
    lines.push(`失败原因：${activeRecording.errorMessage || "未知错误"}`);
    setSummary(lines, false);
    return;
  }

  lines.push("当前状态：正在解码与分析");
  setSummary(lines, true);
}

function renderPeakList() {
  peakList.replaceChildren();

  const activeRecording = getActiveRecording();
  const aggregateView = isAllRecordingsView() ? getAggregateViewModel() : null;

  if (isAllRecordingsView() && aggregateView?.peaks.length) {
    const fragment = document.createDocumentFragment();

    aggregateView.peaks.forEach((peak, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const title = document.createElement("span");
      const description = document.createElement("span");
      const badge = document.createElement("span");

      button.type = "button";
      button.className = "peak-item";
      button.dataset.time = String(peak.time);
      button.dataset.recordingId = peak.recordingId;
      button.dataset.localTime = String(peak.localTime);

      title.className = "peak-title";
      title.textContent = `汇总时间点 ${index + 1} · ${peak.recordingName}`;

      description.className = "peak-description";
      description.textContent = `总览 ${formatDurationPrecise(peak.time)} · 原始 ${formatDurationPrecise(peak.localTime)} · ${Math.round(peak.db)} dB · 强度 ${Math.round(peak.score * 100)}%`;

      badge.className = "peak-badge";
      badge.textContent = peak === aggregateView.loudestPeak ? "全局最大" : "切换查看";

      button.append(title, description, badge);
      item.appendChild(button);
      fragment.appendChild(item);
    });

    peakList.appendChild(fragment);
    updatePeakEmptyState();
    return;
  }

  if (!activeRecording || activeRecording.status !== "ready" || !activeRecording.peaks.length) {
    const message = !activeRecording
      ? isAllRecordingsView()
        ? "还没有可用于汇总展示的录音。"
        : "先选择一段录音，再查看高音量时间点。"
      : activeRecording.status === "error"
        ? "当前录音解析失败，无法展示高音量时间点。"
        : activeRecording.status !== "ready"
          ? "当前录音还在分析中，请稍候。"
          : "当前阈值下没有识别到明显的大音量时间点。";

    updatePeakEmptyState(message);
    return;
  }

  const fragment = document.createDocumentFragment();

  activeRecording.peaks.forEach((peak, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const title = document.createElement("span");
    const description = document.createElement("span");
    const badge = document.createElement("span");

    button.type = "button";
    button.className = "peak-item";
    button.dataset.time = String(peak.time);
    button.dataset.start = String(peak.startTime);
    button.dataset.end = String(peak.endTime);

    title.className = "peak-title";
    title.textContent = `时间点 ${index + 1} · ${formatDurationPrecise(peak.time)}`;

    description.className = "peak-description";
    description.textContent = `区间 ${formatDurationPrecise(peak.startTime)} - ${formatDurationPrecise(peak.endTime)} · ${Math.round(peak.db)} dB · 强度 ${Math.round(peak.score * 100)}%`;

    badge.className = "peak-badge";
    badge.textContent = peak === activeRecording.loudestPeak ? "最大声" : "跳转播放";

    button.append(title, description, badge);
    item.appendChild(button);
    fragment.appendChild(item);
  });

  peakList.appendChild(fragment);
  updatePeakEmptyState();
}

function updateActivePeak() {
  const activeRecording = getActiveRecording();
  const peaks = activeRecording?.status === "ready" ? activeRecording.peaks : [];
  const nextKey = peaks.find((peak) => state.currentTime >= peak.startTime && state.currentTime <= peak.endTime)
    ? `${Math.floor(state.currentTime * 10)}`
    : "";

  if (nextKey === lastRenderedPeakKey) {
    return;
  }

  lastRenderedPeakKey = nextKey;
  const buttons = peakList.querySelectorAll(".peak-item");

  buttons.forEach((button) => {
    const start = Number(button.dataset.start || 0);
    const end = Number(button.dataset.end || 0);
    button.classList.toggle("active", state.currentTime >= start && state.currentTime <= end);
  });
}

function buildRawOutput() {
  const activeRecording = getActiveRecording();
  const aggregateView = isAllRecordingsView() ? getAggregateViewModel() : null;

  if (isAllRecordingsView()) {
    if (!aggregateView) {
      analysisRaw.textContent = "暂无数据";
      return;
    }

    analysisRaw.textContent = prettyJson({
      scope: "all-recordings",
      durationSeconds: Number(aggregateView.duration.toFixed(3)),
      thresholdPercent: Math.round(state.thresholdRatio * 100),
      dbThreshold: state.dbThreshold,
      windowMs: state.windowMs,
      recordingCount: aggregateView.recordings.length,
      totalPeakCount: aggregateView.totalPeakCount,
      displayedPeaks: aggregateView.peaks.map((peak) => ({
        recordingName: peak.recordingName,
        globalTime: Number(peak.time.toFixed(3)),
        localTime: Number(peak.localTime.toFixed(3)),
        db: Number(peak.db.toFixed(2)),
        score: Number(peak.score.toFixed(4))
      }))
    });
    return;
  }

  if (!activeRecording || activeRecording.status !== "ready") {
    analysisRaw.textContent = activeRecording?.errorMessage || "暂无数据";
    return;
  }

  const payload = {
    file: {
      name: activeRecording.file.name,
      size: activeRecording.file.size,
      type: activeRecording.file.type || "unknown"
    },
    durationSeconds: Number(activeRecording.duration.toFixed(3)),
    thresholdPercent: Math.round(state.thresholdRatio * 100),
    dbThreshold: state.dbThreshold,
    windowMs: state.windowMs,
    peakCount: activeRecording.peaks.length,
    peaks: activeRecording.peaks.map((peak) => ({
      time: Number(peak.time.toFixed(3)),
      startTime: Number(peak.startTime.toFixed(3)),
      endTime: Number(peak.endTime.toFixed(3)),
      score: Number(peak.score.toFixed(4)),
      rms: Number(peak.rms.toFixed(6)),
      db: Number(peak.db.toFixed(2)),
      peakAmplitude: Number(peak.peakAmplitude.toFixed(6))
    }))
  };

  analysisRaw.textContent = prettyJson(payload);
}

function resizeCanvasToDisplaySize() {
  const rect = waveformCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width * dpr));
  const height = Math.max(200, Math.round(rect.height * dpr));

  if (waveformCanvas.width !== width || waveformCanvas.height !== height) {
    waveformCanvas.width = width;
    waveformCanvas.height = height;
  }

  return { width, height, dpr };
}

function drawEmptyCanvas(ctx, width, height, dpr, message) {
  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(255, 248, 238, 1)");
  gradient.addColorStop(1, "rgba(232, 245, 255, 1)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(19, 38, 63, 0.54)";
  ctx.textAlign = "center";
  ctx.font = `${14 * dpr}px "Avenir Next", "PingFang SC", sans-serif`;
  ctx.fillText(message, width / 2, height / 2);
}

function renderWaveform() {
  const ctx = waveformCanvas.getContext("2d");
  const { width, height, dpr } = resizeCanvasToDisplaySize();
  const activeRecording = getActiveRecording();
  const aggregateView = isAllRecordingsView() ? getAggregateViewModel() : null;

  if (!ctx) {
    return;
  }

  if (isAllRecordingsView() && aggregateView) {
    const { segments, peaks, duration, loudestPeak, recordings } = aggregateView;
    const paddingX = 22 * dpr;
    const paddingTop = 24 * dpr;
    const paddingBottom = 32 * dpr;
    const chartWidth = width - paddingX * 2;
    const chartHeight = height - paddingTop - paddingBottom;
    const bucketCount = Math.max(32, Math.floor(chartWidth / Math.max(2, 3 * dpr)));
    const bucketWidth = chartWidth / bucketCount;
    const segmentsPerBucket = segments.length / bucketCount;

    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "rgba(255, 251, 245, 1)");
    background.addColorStop(1, "rgba(233, 247, 255, 1)");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(19, 38, 63, 0.08)";
    ctx.lineWidth = 1;

    for (let grid = 0; grid <= 4; grid += 1) {
      const x = paddingX + (chartWidth * grid) / 4;
      ctx.beginPath();
      ctx.moveTo(x, paddingTop);
      ctx.lineTo(x, paddingTop + chartHeight);
      ctx.stroke();

      const time = (duration * grid) / 4;
      ctx.fillStyle = "rgba(19, 38, 63, 0.56)";
      ctx.textAlign = grid === 4 ? "right" : grid === 0 ? "left" : "center";
      ctx.font = `${11 * dpr}px "Avenir Next", "PingFang SC", sans-serif`;
      ctx.fillText(formatDuration(time), x, height - 10 * dpr);
    }

    for (let bucket = 0; bucket < bucketCount; bucket += 1) {
      const startIndex = Math.floor(bucket * segmentsPerBucket);
      if (startIndex >= segments.length) {
        continue;
      }

      const endIndex = Math.min(
        segments.length,
        Math.max(startIndex + 1, Math.floor((bucket + 1) * segmentsPerBucket))
      );

      let maxValue = 0;
      let aboveThreshold = false;

      for (let index = startIndex; index < endIndex; index += 1) {
        const segment = segments[index];
        if (!segment) {
          continue;
        }

        maxValue = Math.max(maxValue, segment.normalized);
        aboveThreshold = aboveThreshold || segment.normalized >= state.thresholdRatio;
      }

      const barHeight = Math.max(2 * dpr, maxValue * chartHeight);
      const x = paddingX + bucket * bucketWidth;
      const y = paddingTop + chartHeight - barHeight;

      ctx.fillStyle = aboveThreshold ? "rgba(238, 108, 77, 0.88)" : "rgba(15, 123, 108, 0.76)";
      ctx.fillRect(x, y, Math.max(1.5 * dpr, bucketWidth - 1 * dpr), barHeight);
    }

    const thresholdY = paddingTop + chartHeight - state.thresholdRatio * chartHeight;
    ctx.strokeStyle = "rgba(238, 108, 77, 0.5)";
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.beginPath();
    ctx.moveTo(paddingX, thresholdY);
    ctx.lineTo(paddingX + chartWidth, thresholdY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = `${11 * dpr}px "Avenir Next", "PingFang SC", sans-serif`;
    ctx.textBaseline = "top";

    ctx.lineWidth = 1.5 * dpr;
    for (const [index, recording] of recordings.entries()) {
      const startX = paddingX + (recording.startOffset / duration) * chartWidth;
      const endX = paddingX + (recording.endOffset / duration) * chartWidth;
      const centerX = (startX + endX) / 2;
      const availableWidth = endX - startX;

      if (availableWidth > 60 * dpr) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(startX + 4 * dpr, paddingTop + 4 * dpr, Math.max(0, availableWidth - 8 * dpr), 18 * dpr);
        ctx.clip();
        ctx.fillStyle = "rgba(19, 38, 63, 0.68)";
        ctx.textAlign = "center";
        ctx.fillText(recording.name, centerX, paddingTop + (index % 2 === 0 ? 6 : 20) * dpr);
        ctx.restore();
      }

      if (index === recordings.length - 1) {
        continue;
      }

      const x = endX;
      ctx.strokeStyle = "rgba(19, 38, 63, 0.18)";
      ctx.beginPath();
      ctx.moveTo(x, paddingTop);
      ctx.lineTo(x, paddingTop + chartHeight);
      ctx.stroke();
    }

    peaks.forEach((peak) => {
      const x = paddingX + (peak.time / duration) * chartWidth;
      const y = paddingTop + chartHeight - peak.score * chartHeight;

      ctx.strokeStyle = "rgba(255, 153, 74, 0.62)";
      ctx.beginPath();
      ctx.moveTo(x, paddingTop);
      ctx.lineTo(x, paddingTop + chartHeight);
      ctx.stroke();

      ctx.fillStyle = peak === loudestPeak ? "rgba(255, 127, 50, 1)" : "rgba(255, 199, 91, 0.96)";
      ctx.beginPath();
      ctx.arc(x, y, 4.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
    });

    return;
  }

  if (!activeRecording) {
    drawEmptyCanvas(ctx, width, height, dpr, "上传并选择一段录音后，这里会显示音量时间轴");
    return;
  }

  if (activeRecording.status === "error") {
    drawEmptyCanvas(ctx, width, height, dpr, "当前录音解析失败，无法绘制音量时间轴");
    return;
  }

  if (activeRecording.status !== "ready" || !activeRecording.segments.length || !activeRecording.duration) {
    drawEmptyCanvas(ctx, width, height, dpr, "当前录音正在分析中，请稍候");
    return;
  }

  const { segments, peaks, duration, loudestPeak } = activeRecording;
  const paddingX = 22 * dpr;
  const paddingTop = 24 * dpr;
  const paddingBottom = 32 * dpr;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingTop - paddingBottom;
  const bucketCount = Math.max(32, Math.floor(chartWidth / Math.max(2, 3 * dpr)));
  const bucketWidth = chartWidth / bucketCount;
  const segmentsPerBucket = segments.length / bucketCount;

  ctx.clearRect(0, 0, width, height);

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, "rgba(255, 251, 245, 1)");
  background.addColorStop(1, "rgba(233, 247, 255, 1)");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(19, 38, 63, 0.08)";
  ctx.lineWidth = 1;

  for (let grid = 0; grid <= 4; grid += 1) {
    const x = paddingX + (chartWidth * grid) / 4;
    ctx.beginPath();
    ctx.moveTo(x, paddingTop);
    ctx.lineTo(x, paddingTop + chartHeight);
    ctx.stroke();

    const time = (duration * grid) / 4;
    ctx.fillStyle = "rgba(19, 38, 63, 0.56)";
    ctx.textAlign = grid === 4 ? "right" : grid === 0 ? "left" : "center";
    ctx.font = `${11 * dpr}px "Avenir Next", "PingFang SC", sans-serif`;
    ctx.fillText(formatDuration(time), x, height - 10 * dpr);
  }

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const startIndex = Math.floor(bucket * segmentsPerBucket);
    if (startIndex >= segments.length) {
      continue;
    }

    const endIndex = Math.min(
      segments.length,
      Math.max(startIndex + 1, Math.floor((bucket + 1) * segmentsPerBucket))
    );

    let maxValue = 0;
    let aboveThreshold = false;

    for (let index = startIndex; index < endIndex; index += 1) {
      const segment = segments[index];
      if (!segment) {
        continue;
      }

      maxValue = Math.max(maxValue, segment.normalized);
      aboveThreshold = aboveThreshold || segment.normalized >= state.thresholdRatio;
    }

    const barHeight = Math.max(2 * dpr, maxValue * chartHeight);
    const x = paddingX + bucket * bucketWidth;
    const y = paddingTop + chartHeight - barHeight;

    ctx.fillStyle = aboveThreshold ? "rgba(238, 108, 77, 0.88)" : "rgba(15, 123, 108, 0.76)";
    ctx.fillRect(x, y, Math.max(1.5 * dpr, bucketWidth - 1 * dpr), barHeight);
  }

  const thresholdY = paddingTop + chartHeight - state.thresholdRatio * chartHeight;
  ctx.strokeStyle = "rgba(238, 108, 77, 0.5)";
  ctx.setLineDash([6 * dpr, 6 * dpr]);
  ctx.beginPath();
  ctx.moveTo(paddingX, thresholdY);
  ctx.lineTo(paddingX + chartWidth, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);

  peaks.forEach((peak) => {
    const x = paddingX + (peak.time / duration) * chartWidth;
    const y = paddingTop + chartHeight - peak.score * chartHeight;

    ctx.strokeStyle = "rgba(255, 153, 74, 0.62)";
    ctx.beginPath();
    ctx.moveTo(x, paddingTop);
    ctx.lineTo(x, paddingTop + chartHeight);
    ctx.stroke();

    ctx.fillStyle = peak === loudestPeak ? "rgba(255, 127, 50, 1)" : "rgba(255, 199, 91, 0.96)";
    ctx.beginPath();
    ctx.arc(x, y, 4.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  });

  const currentX = paddingX + (state.currentTime / Math.max(duration, 0.001)) * chartWidth;
  ctx.strokeStyle = "rgba(19, 38, 63, 0.92)";
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(currentX, paddingTop);
  ctx.lineTo(currentX, paddingTop + chartHeight);
  ctx.stroke();
}

function renderActiveRecordingViews() {
  const activeRecording = getActiveRecording();
  const aggregateView = isAllRecordingsView() ? getAggregateViewModel() : null;

  if (isAllRecordingsView()) {
    state.currentTime = 0;

    if (!aggregateView) {
      fileMeta.textContent = "全部录音 · 等待生成总览";
      analysisRaw.textContent = "当前还没有可汇总展示的录音";
      setPlaybackMessage("全部录音总览会在至少一段录音分析完成后出现。");
      updateCurrentTimeLabel();
      updatePlaybackControls();
      updatePeakEmptyState("全部录音总览还在准备中，请稍候。");
      renderWaveform();
      return;
    }

    fileMeta.textContent = `全部录音 · ${aggregateView.recordings.length} 段 · ${formatDuration(aggregateView.duration)}`;
    analysisRaw.textContent = "正在生成全部录音汇总";
    setPlaybackMessage("当前是全部录音总览模式。点击右侧汇总时间点或总览柱状图，可切换到对应录音。");
    updateCurrentTimeLabel();
    updatePlaybackControls();
    renderPeakList();
    buildRawOutput();
    renderWaveform();
    return;
  }

  if (!activeRecording) {
    state.currentTime = 0;
    fileMeta.textContent = "等待加载录音";
    analysisRaw.textContent = "暂无数据";
    updateCurrentTimeLabel();
    updatePlaybackControls();
    updatePeakEmptyState("先上传并选择一段录音，再查看高音量时间点。");
    renderWaveform();
    return;
  }

  state.currentTime = clamp(activeRecording.playhead || 0, 0, activeRecording.duration || 0);

  if (activeRecording.status === "error") {
    fileMeta.textContent = `${activeRecording.file.name} · 解析失败`;
    analysisRaw.textContent = activeRecording.errorMessage || "当前录音无法解析";
    setPlaybackMessage("当前录音解析失败，请尝试更换音频格式后重新上传。");
    updateCurrentTimeLabel();
    updatePlaybackControls();
    updatePeakEmptyState("当前录音解析失败，无法展示高音量时间点。");
    renderWaveform();
    return;
  }

  if (activeRecording.status !== "ready") {
    fileMeta.textContent = `${activeRecording.file.name} · 正在分析`;
    analysisRaw.textContent = "当前录音正在分析中";
    setPlaybackMessage("当前录音正在解码与分析，请稍候。");
    updateCurrentTimeLabel();
    updatePlaybackControls();
    updatePeakEmptyState("当前录音正在分析中，请稍候。");
    renderWaveform();
    return;
  }

  fileMeta.textContent = `${activeRecording.file.name} · ${formatFileSize(activeRecording.file.size)} · ${formatDuration(activeRecording.duration)}`;
  setPlaybackMessage(
    activeRecording.peaks.length
      ? `当前录音已识别 ${activeRecording.peaks.length} 个高音量时间点，点击任一结果即可跳转试听。`
      : "当前阈值下没有找到明显大音量片段，可以适当降低阈值后重试。"
  );
  updateCurrentTimeLabel();
  updatePlaybackControls();
  renderPeakList();
  updateActivePeak();
  buildRawOutput();
  renderWaveform();
}

function renderAllViews() {
  renderSummary();
  renderRecordingList();
  renderActiveRecordingViews();
}

function syncPlaybackClock() {
  const activeRecording = getActiveRecording();
  if (!state.isPlaying || !activeRecording) {
    return;
  }

  const elapsedSeconds = (performance.now() - playbackAnchorStamp) / 1000;
  state.currentTime = clamp(playbackAnchorOffset + elapsedSeconds, 0, activeRecording.duration);
  activeRecording.playhead = state.currentTime;
}

function renderPlaybackFrame() {
  const activeRecording = getActiveRecording();

  syncPlaybackClock();
  updateCurrentTimeLabel();
  updateActivePeak();
  renderWaveform();

  if (!state.isPlaying || !activeRecording) {
    stopPlaybackLoop();
    return;
  }

  if (state.currentTime >= Math.max(0, activeRecording.duration - 0.02)) {
    state.isPlaying = false;
    state.currentTime = activeRecording.duration;
    activeRecording.playhead = activeRecording.duration;
    destroySource();
    stopPlaybackLoop();
    updatePlaybackControls();
    updateCurrentTimeLabel();
    renderWaveform();
    setPlaybackMessage("播放结束。可以继续点击其他高音量时间点查看。");
    return;
  }

  playbackFrame = window.requestAnimationFrame(renderPlaybackFrame);
}

async function playFrom(time = state.currentTime) {
  const activeRecording = getActiveRecording();
  if (!activeRecording || activeRecording.status !== "ready" || !activeRecording.audioBuffer) {
    return;
  }

  const context = await ensureAudioContext();
  const offset = clamp(Number(time) || 0, 0, Math.max(0, activeRecording.duration - 0.001));
  destroySource();

  const source = context.createBufferSource();
  source.buffer = activeRecording.audioBuffer;
  source.connect(gainNode);
  currentSource = source;

  source.onended = () => {
    const currentRecording = getActiveRecording();

    if (currentSource !== source || !state.isPlaying || !currentRecording) {
      return;
    }

    state.isPlaying = false;
    state.currentTime = currentRecording.duration;
    currentRecording.playhead = currentRecording.duration;
    currentSource = null;
    stopPlaybackLoop();
    updatePlaybackControls();
    updateCurrentTimeLabel();
    renderWaveform();
    setPlaybackMessage("播放结束。可以继续点击其他高音量时间点查看。");
  };

  playbackAnchorOffset = offset;
  playbackAnchorStamp = performance.now();
  state.currentTime = offset;
  activeRecording.playhead = offset;
  state.isPlaying = true;
  updatePlaybackControls();
  updateCurrentTimeLabel();
  updateActivePeak();
  renderWaveform();
  source.start(0, offset);
  stopPlaybackLoop();
  playbackFrame = window.requestAnimationFrame(renderPlaybackFrame);
}

function jumpToTime(time, shouldPlay = true) {
  const activeRecording = getActiveRecording();
  if (!activeRecording || activeRecording.status !== "ready") {
    return;
  }

  const nextTime = clamp(Number(time) || 0, 0, activeRecording.duration);
  state.currentTime = nextTime;
  activeRecording.playhead = nextTime;
  updateCurrentTimeLabel();
  updateActivePeak();
  renderWaveform();

  if (shouldPlay) {
    playFrom(nextTime).catch((error) => {
      showToast(error.message, true);
    });
  } else if (state.isPlaying) {
    pausePlayback();
  }
}

function setActiveRecording(id) {
  if (state.activeRecordingId === id) {
    return;
  }

  pausePlayback();
  state.activeRecordingId = id;
  const activeRecording = getActiveRecording();
  state.currentTime = activeRecording?.playhead || 0;
  lastRenderedPeakKey = "";
  renderAllViews();
}

async function decodeAndAnalyzeRecording(recording) {
  const context = await ensureAudioContext();
  const arrayBuffer = await recording.file.arrayBuffer();
  recording.audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
  recording.status = "ready";
  recording.errorMessage = "";
  updateRecordingAnalysis(recording, true);
}

async function loadAudioFiles(files) {
  const audioFiles = Array.from(files || []).filter(isAudioFile);
  if (!audioFiles.length) {
    showToast("请至少选择一段音频文件", true);
    return;
  }

  pausePlayback();
  state.analysisJobId += 1;
  const jobId = state.analysisJobId;
  const newRecordings = audioFiles.map(createRecording);
  state.recordings.push(...newRecordings);
  state.activeRecordingId = state.recordings.length > 1
    ? ALL_RECORDINGS_ID
    : newRecordings[0]?.id || state.activeRecordingId;
  setPlaybackMessage("正在读取并分析新上传的录音...");
  renderAllViews();
  updateAnalyzeButtonState();

  let successCount = 0;
  let failureCount = 0;

  for (const recording of newRecordings) {
    if (state.analysisJobId !== jobId) {
      return;
    }

    recording.status = "loading";
    renderAllViews();

    try {
      await decodeAndAnalyzeRecording(recording);
      successCount += 1;
    } catch (error) {
      recording.status = "error";
      recording.errorMessage = error.message || "当前录音无法解析";
      failureCount += 1;
    }

    renderAllViews();
    updateAnalyzeButtonState();
  }

  const activeRecording = getActiveRecording();
  if (!activeRecording || activeRecording.status !== "ready") {
    const fallbackReadyRecording = newRecordings.find((recording) => recording.status === "ready")
      || state.recordings.find((recording) => recording.status === "ready")
      || state.recordings[0]
      || null;

    state.activeRecordingId = fallbackReadyRecording?.id || null;
    state.currentTime = fallbackReadyRecording?.playhead || 0;
    renderAllViews();
  }

  if (successCount && failureCount) {
    showToast(`已分析 ${successCount} 段录音，另有 ${failureCount} 段失败`);
  } else if (successCount) {
    showToast(`已分析 ${successCount} 段录音`);
  } else {
    showToast("这些录音都没能成功解析", true);
  }
}

async function reanalyzeAllRecordings(recomputeSegments = true) {
  const readyRecordings = getReadyRecordings();
  if (!readyRecordings.length) {
    showToast("还没有可重新分析的录音", true);
    return;
  }

  state.analysisJobId += 1;
  const jobId = state.analysisJobId;
  setButtonState(analyzeFileButton, recomputeSegments ? "分析全部中..." : "刷新结果中...", true);

  try {
    for (const recording of readyRecordings) {
      if (state.analysisJobId !== jobId) {
        return;
      }

      recording.status = recomputeSegments ? "analyzing" : "ready";
      renderAllViews();
      updateRecordingAnalysis(recording, recomputeSegments);
      recording.status = "ready";
    }

    renderAllViews();
    showToast(recomputeSegments ? "全部录音已重新分析" : "全部录音结果已刷新");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setButtonState(analyzeFileButton, "", false);
    updateAnalyzeButtonState();
  }
}

function refreshAllPeaksOnly() {
  const readyRecordings = getReadyRecordings();
  if (!readyRecordings.length) {
    return;
  }

  for (const recording of readyRecordings) {
    updateRecordingAnalysis(recording, false);
  }

  renderAllViews();
}

function scheduleFullAnalysis() {
  window.clearTimeout(analyzeTimer);
  analyzeTimer = window.setTimeout(() => {
    reanalyzeAllRecordings(true);
  }, 180);
}

function clearAllRecordings() {
  pausePlayback();
  window.clearTimeout(analyzeTimer);
  state.analysisJobId += 1;
  state.recordings = [];
  state.activeRecordingId = null;
  state.currentTime = 0;
  lastRenderedPeakKey = "";
  peakList.replaceChildren();
  peakList.hidden = true;
  peakEmptyState.hidden = false;
  peakEmptyState.textContent = "暂无分析结果。先选择一段录音，再查看高音量时间点。";
  analysisRaw.textContent = "暂无数据";
  renderAllViews();
  updateAnalyzeButtonState();
  setPlaybackMessage("已清空全部录音。你可以重新上传新的音频继续分析。");
  showToast("已清空全部录音");
}

function handleDropzoneKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  audioFileInput.click();
}

function handleDropzoneDrag(event) {
  event.preventDefault();
  uploadDropzone.classList.add("drag-active");
}

function clearDropzoneDrag() {
  uploadDropzone.classList.remove("drag-active");
}

function handleDropzoneDrop(event) {
  event.preventDefault();
  clearDropzoneDrag();
  loadAudioFiles(event.dataTransfer?.files || []);
}

function handleCanvasClick(event) {
  const activeRecording = getActiveRecording();
  const aggregateView = isAllRecordingsView() ? getAggregateViewModel() : null;

  if (isAllRecordingsView() && aggregateView) {
    const rect = waveformCanvas.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const globalTime = (x / Math.max(rect.width, 1)) * aggregateView.duration;
    const match = aggregateView.recordings.find((recording) => {
      return globalTime >= recording.startOffset && globalTime <= recording.endOffset;
    }) || aggregateView.recordings.at(-1);

    if (!match) {
      return;
    }

    const localTime = clamp(globalTime - match.startOffset, 0, match.duration);
    setActiveRecording(match.id);
    jumpToTime(localTime, true);
    return;
  }

  if (!activeRecording || activeRecording.status !== "ready" || !activeRecording.duration) {
    return;
  }

  const rect = waveformCanvas.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const nextTime = (x / Math.max(rect.width, 1)) * activeRecording.duration;
  jumpToTime(nextTime, true);
}

audioFileInput.addEventListener("change", (event) => {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  loadAudioFiles(input.files || []);
  input.value = "";
});

analyzeFileButton.addEventListener("click", () => {
  syncControlState();
  reanalyzeAllRecordings(true);
});

clearAllButton.addEventListener("click", clearAllRecordings);

playToggleButton.addEventListener("click", () => {
  const activeRecording = getActiveRecording();
  if (!activeRecording || activeRecording.status !== "ready") {
    return;
  }

  if (state.isPlaying) {
    pausePlayback();
    setPlaybackMessage("播放已暂停。你可以继续点图表或结果卡片来跳转试听。");
    return;
  }

  playFrom(state.currentTime).then(() => {
    setPlaybackMessage("正在播放。点击图表或时间点，可以快速切换到其他高音量位置。");
  }).catch((error) => {
    showToast(error.message, true);
  });
});

restartPlaybackButton.addEventListener("click", () => {
  jumpToTime(0, state.isPlaying);
  if (!state.isPlaying) {
    setPlaybackMessage("已回到开头，可以点击播放开始试听。");
  }
});

stopPlaybackButton.addEventListener("click", () => {
  pausePlayback();
  setPlaybackMessage("播放已停止。你可以继续拖动进度或点击时间点重新开始。");
});

seekRange.addEventListener("input", () => {
  const activeRecording = getActiveRecording();
  if (!activeRecording || activeRecording.status !== "ready") {
    return;
  }

  state.currentTime = Number(seekRange.value || 0);
  activeRecording.playhead = state.currentTime;
  updateCurrentTimeLabel();
  updateActivePeak();
  renderWaveform();
});

seekRange.addEventListener("change", () => {
  const activeRecording = getActiveRecording();
  if (!activeRecording || activeRecording.status !== "ready") {
    return;
  }

  jumpToTime(Number(seekRange.value || 0), state.isPlaying);
});

volumeRange.addEventListener("input", () => {
  state.volume = clamp(Number(volumeRange.value) / 100, 0, 1);
  updateVolumeLabel();

  if (gainNode) {
    gainNode.gain.value = state.volume;
  }

  if (state.volume === 0) {
    setPlaybackMessage("当前音量为 0%，请把播放音量往右拖。");
  }
});

thresholdRange.addEventListener("input", () => {
  syncControlState();
  refreshAllPeaksOnly();
});

dbRange.addEventListener("input", () => {
  syncControlState();
  refreshAllPeaksOnly();
});

windowRange.addEventListener("input", () => {
  syncControlState();
  scheduleFullAnalysis();
});

maxResultsInput.addEventListener("input", () => {
  syncControlState();
  refreshAllPeaksOnly();
});

uploadDropzone.addEventListener("keydown", handleDropzoneKeydown);
uploadDropzone.addEventListener("dragenter", handleDropzoneDrag);
uploadDropzone.addEventListener("dragover", handleDropzoneDrag);
uploadDropzone.addEventListener("dragleave", clearDropzoneDrag);
uploadDropzone.addEventListener("drop", handleDropzoneDrop);

recordingList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest(".recording-item") : null;

  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  setActiveRecording(target.dataset.id);
});

waveformCanvas.addEventListener("click", handleCanvasClick);

peakList.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest(".peak-item") : null;

  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const recordingId = target.dataset.recordingId;
  if (recordingId) {
    setActiveRecording(recordingId);
    jumpToTime(Number(target.dataset.localTime || 0), true);
    return;
  }

  jumpToTime(Number(target.dataset.time), true);
});

jumpLoudestButton.addEventListener("click", () => {
  const aggregateView = isAllRecordingsView() ? getAggregateViewModel() : null;
  if (aggregateView?.loudestPeak) {
    setActiveRecording(aggregateView.loudestPeak.recordingId);
    jumpToTime(aggregateView.loudestPeak.localTime, true);
    return;
  }

  const activeRecording = getActiveRecording();
  if (activeRecording?.loudestPeak) {
    jumpToTime(activeRecording.loudestPeak.time, true);
  }
});

window.addEventListener("resize", () => {
  renderWaveform();
});

function syncControlState() {
  state.thresholdRatio = Number(thresholdRange.value) / 100;
  state.dbThreshold = Number(dbRange.value);
  state.windowMs = Number(windowRange.value);
  state.maxResults = clamp(Number(maxResultsInput.value) || 12, 3, 30);
  maxResultsInput.value = String(state.maxResults);
  updateControlLabels();
}

syncControlState();
updateVolumeLabel();
updateAnalyzeButtonState();
renderAllViews();
setPlaybackMessage("加载完成后，你可以一次上传多段录音，并逐条切换查看高音量时间点。");
