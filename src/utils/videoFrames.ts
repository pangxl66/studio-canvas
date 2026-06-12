export type VideoContactSheet = {
  frameDataUrl: string;
  durationSec?: number;
  width?: number;
  height?: number;
};

type ServerVideoContactSheetResponse = {
  ok?: boolean;
  frameDataUrls?: string[];
  times?: number[];
  durationSec?: number;
  width?: number;
  height?: number;
  error?: {
    message?: string;
  };
};

const FRAME_LABELS = ['START', 'MID', 'END'];
const FRAME_WIDTH = 360;
const LABEL_HEIGHT = 30;

function waitForMediaEvent(target: HTMLMediaElement, eventName: string, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Video ${eventName} timed out`));
    }, timeoutMs);

    const cleanup = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timeout);
      target.removeEventListener(eventName, onResolve);
      target.removeEventListener('error', onReject);
    };

    const onResolve = () => {
      cleanup();
      resolve();
    };

    const onReject = () => {
      cleanup();
      reject(new Error('Video load failed'));
    };

    target.addEventListener(eventName, onResolve, { once: true });
    target.addEventListener('error', onReject, { once: true });
  });
}

async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const safeTime = Number.isFinite(time) && time > 0 ? time : 0;
  if (safeTime <= 0.02) {
    video.currentTime = 0;
    if (video.readyState >= 2) return;
    await waitForMediaEvent(video, 'loadeddata', 7000);
    return;
  }
  if (Math.abs(video.currentTime - safeTime) < 0.02 && video.readyState >= 2) return;
  const pending = waitForMediaEvent(video, 'seeked', 7000);
  video.currentTime = safeTime;
  await pending;
}

function resolveFrameTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0.2) return [0, 0, 0];
  const start = Math.min(0.3, duration * 0.08);
  const mid = duration * 0.5;
  const end = Math.max(start, duration - Math.min(0.35, duration * 0.08));
  return [start, mid, end];
}

function drawContainedVideoFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceWidth = video.videoWidth || width;
  const sourceHeight = video.videoHeight || height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.fillStyle = '#05070b';
  ctx.fillRect(x, y, width, height);
  ctx.drawImage(video, drawX, drawY, drawWidth, drawHeight);
}

function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceWidth = image.naturalWidth || width;
  const sourceHeight = image.naturalHeight || height;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  ctx.fillStyle = '#05070b';
  ctx.fillRect(x, y, width, height);
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('服务器已抽帧，但浏览器无法读取返回的帧图。'));
    image.src = dataUrl;
  });
}

async function composeContactSheetFromFrames(
  frameDataUrls: string[],
  opts: { times?: number[]; durationSec?: number; width?: number; height?: number },
): Promise<VideoContactSheet> {
  const images = await Promise.all(frameDataUrls.slice(0, FRAME_LABELS.length).map((src) => loadImage(src)));
  if (!images.length) throw new Error('服务器没有返回可用的视频帧。');

  const width = opts.width ?? images[0]?.naturalWidth;
  const height = opts.height ?? images[0]?.naturalHeight;
  const aspect = width && height ? width / height : 16 / 9;
  const frameHeight = Math.max(180, Math.round(FRAME_WIDTH / aspect));
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_WIDTH * FRAME_LABELS.length;
  canvas.height = frameHeight + LABEL_HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '700 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';

  for (let index = 0; index < FRAME_LABELS.length; index += 1) {
    const image = images[index] ?? images[images.length - 1];
    const frameX = index * FRAME_WIDTH;
    drawContainedImage(ctx, image, frameX, LABEL_HEIGHT, FRAME_WIDTH, frameHeight);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(frameX, 0, FRAME_WIDTH, LABEL_HEIGHT);
    ctx.fillStyle = 'rgba(229, 231, 235, 0.92)';
    const time = opts.times?.[index] ?? 0;
    ctx.fillText(`${FRAME_LABELS[index]}  ${time.toFixed(1)}s`, frameX + 12, LABEL_HEIGHT / 2);
  }

  return {
    frameDataUrl: canvas.toDataURL('image/jpeg', 0.88),
    durationSec: opts.durationSec,
    width,
    height,
  };
}

async function extractVideoContactSheetInBrowser(videoSrc: string): Promise<VideoContactSheet> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.src = videoSrc;

  await waitForMediaEvent(video, 'loadedmetadata', 10000);

  const durationSec = Number.isFinite(video.duration) ? video.duration : undefined;
  const width = video.videoWidth || undefined;
  const height = video.videoHeight || undefined;
  const aspect = width && height ? width / height : 16 / 9;
  const frameHeight = Math.max(180, Math.round(FRAME_WIDTH / aspect));
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_WIDTH * FRAME_LABELS.length;
  canvas.height = frameHeight + LABEL_HEIGHT;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  ctx.fillStyle = '#05070b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '700 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';

  const times = resolveFrameTimes(durationSec ?? 0);
  for (let index = 0; index < FRAME_LABELS.length; index += 1) {
    try {
      await seekVideo(video, times[index] ?? 0);
    } catch {
      if (video.readyState < 2) {
        await waitForMediaEvent(video, 'loadeddata', 7000);
      }
    }
    const frameX = index * FRAME_WIDTH;
    drawContainedVideoFrame(ctx, video, frameX, LABEL_HEIGHT, FRAME_WIDTH, frameHeight);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.fillRect(frameX, 0, FRAME_WIDTH, LABEL_HEIGHT);
    ctx.fillStyle = 'rgba(229, 231, 235, 0.92)';
    const time = times[index] ?? 0;
    const label = `${FRAME_LABELS[index]}  ${time.toFixed(1)}s`;
    ctx.fillText(label, frameX + 12, LABEL_HEIGHT / 2);
  }

  video.removeAttribute('src');
  video.load();

  return {
    frameDataUrl: canvas.toDataURL('image/jpeg', 0.88),
    durationSec,
    width,
    height,
  };
}

function isDataUrl(value: string): boolean {
  return /^data:/i.test(value.trim());
}

function readableVideoLoadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (/load failed|loadedmetadata timed out|loadeddata timed out|seeked timed out/i.test(raw)) {
    return '当前浏览器无法解码这个视频，常见于 MOV / HEVC / H.265 / ProRes 编码。';
  }
  return raw.trim() || '视频抽帧失败。';
}

async function extractVideoContactSheetOnServer(
  videoDataUrl: string,
  fileName?: string,
  mimeType?: string,
): Promise<VideoContactSheet> {
  const response = await fetch('/api/video/contact-sheet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoDataUrl, fileName, mimeType }),
  });
  const text = await response.text();
  let payload: ServerVideoContactSheetResponse = {};
  try {
    payload = text.trim() ? (JSON.parse(text) as ServerVideoContactSheetResponse) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.error?.message?.trim() || `服务器抽帧接口不可用（HTTP ${response.status}）。`);
  }
  if (!Array.isArray(payload.frameDataUrls) || payload.frameDataUrls.length === 0) {
    throw new Error('服务器没有返回可用的视频帧。');
  }
  return composeContactSheetFromFrames(payload.frameDataUrls, {
    times: payload.times,
    durationSec: payload.durationSec,
    width: payload.width,
    height: payload.height,
  });
}

export async function extractVideoContactSheet(
  videoSrc: string,
  opts: { fileName?: string; mimeType?: string } = {},
): Promise<VideoContactSheet> {
  try {
    return await extractVideoContactSheetInBrowser(videoSrc);
  } catch (browserError) {
    if (isDataUrl(videoSrc)) {
      try {
        return await extractVideoContactSheetOnServer(videoSrc, opts.fileName, opts.mimeType);
      } catch (serverError) {
        const browserMessage = readableVideoLoadError(browserError);
        const serverMessage = serverError instanceof Error ? serverError.message : String(serverError || '');
        throw new Error(`${browserMessage} 服务器端兜底抽帧也失败：${serverMessage || '未知错误'}`);
      }
    }
    throw new Error(readableVideoLoadError(browserError));
  }
}

export function formatVideoDuration(seconds?: number): string {
  if (!Number.isFinite(seconds) || seconds == null || seconds < 0) return '';
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes <= 0) return `${rest}s`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
