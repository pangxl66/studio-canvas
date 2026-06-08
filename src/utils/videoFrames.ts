export type VideoContactSheet = {
  frameDataUrl: string;
  durationSec?: number;
  width?: number;
  height?: number;
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

export async function extractVideoContactSheet(videoSrc: string): Promise<VideoContactSheet> {
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

export function formatVideoDuration(seconds?: number): string {
  if (!Number.isFinite(seconds) || seconds == null || seconds < 0) return '';
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes <= 0) return `${rest}s`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
