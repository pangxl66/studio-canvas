import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type SyntheticEvent,
} from 'react';
import { useStudioStore } from '@/store/useStudioStore';
import type { StudioNodeData } from '@/types/studio';
import { extractVideoContactSheet, formatVideoDuration } from '@/utils/videoFrames';

type VideoRF = Node<StudioNodeData, 'videoNode'>;

export const VIDEO_NODE_OUTPUT_HANDLE_ID = 'out';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('视频读取失败'));
    reader.readAsDataURL(file);
  });
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name);
}

function VideoNodeInner({ id, data, selected }: NodeProps<VideoRF>) {
  const patchNodeData = useStudioStore((state) => state.patchNodeData);
  const pushMessage = useStudioStore((state) => state.pushMessage);
  const inputRef = useRef<HTMLInputElement>(null);
  const extractingKeyRef = useRef<string | null>(null);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const [extracting, setExtracting] = useState(false);

  const pickVideo = useCallback(() => {
    inputRef.current?.click();
  }, []);

  useEffect(() => {
    if (!data.videoDataUrl || data.videoFrameDataUrl) return;
    if (extractingKeyRef.current === data.videoDataUrl) return;
    let cancelled = false;
    extractingKeyRef.current = data.videoDataUrl;
    setExtracting(true);
    extractVideoContactSheet(data.videoDataUrl, {
      fileName: data.videoFileName,
      mimeType: data.videoMimeType,
    })
      .then((sheet) => {
        if (cancelled) return;
        patchNodeData(
          id,
          {
            videoFrameDataUrl: sheet.frameDataUrl,
            videoDurationSec: sheet.durationSec ?? data.videoDurationSec,
            videoWidth: sheet.width ?? data.videoWidth,
            videoHeight: sheet.height ?? data.videoHeight,
            generation_error: undefined,
          },
          true,
        );
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error && error.message.trim() ? error.message.trim() : '视频抽帧失败';
        patchNodeData(id, { generation_error: `视频抽帧失败：${message}` }, true);
      })
      .finally(() => {
        if (!cancelled) setExtracting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.videoDataUrl, data.videoDurationSec, data.videoFrameDataUrl, data.videoHeight, data.videoWidth, id, patchNodeData]);

  const onVideoPicked = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!isVideoFile(file)) {
        pushMessage({ role: 'system', text: '请选择视频文件。', nodeId: id });
        return;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        patchNodeData(
          id,
          {
            videoDataUrl: dataUrl,
            videoMimeType: file.type,
            videoFileName: file.name,
            videoFrameDataUrl: undefined,
            videoDurationSec: undefined,
            videoWidth: undefined,
            videoHeight: undefined,
            videoAnalysisSummary: undefined,
            generation_error: undefined,
            output: null,
            label: data.label?.trim() || file.name.replace(/\.[^.]+$/u, '') || '视频节点',
          },
          true,
        );
        setVideoSize(null);
        pushMessage({
          role: 'system',
          text: `已载入视频“${file.name}”。连接到文本卡片后，可分析构图、元素和运镜。`,
          nodeId: id,
        });
      } catch (error) {
        const message = error instanceof Error && error.message.trim() ? error.message.trim() : '视频读取失败。';
        pushMessage({ role: 'system', text: message, nodeId: id });
      }
    },
    [data.label, id, patchNodeData, pushMessage],
  );

  const onPreviewLoaded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = event.currentTarget;
    if (videoWidth > 0 && videoHeight > 0) {
      setVideoSize({ width: videoWidth, height: videoHeight });
    }
  }, []);

  const title = data.videoFileName?.trim() || data.label?.trim() || '视频节点';
  const width = videoSize?.width ?? data.videoWidth;
  const height = videoSize?.height ?? data.videoHeight;
  const dimensionParts = [
    width && height ? `${width} x ${height}` : data.videoDataUrl ? 'Video' : '未上传',
    formatVideoDuration(data.videoDurationSec),
  ].filter(Boolean);
  const dimensionLabel = dimensionParts.join(' · ');

  return (
    <div className={`image-table-node video-node ${data.videoDataUrl ? 'image-table-node--loaded' : ''} ${selected ? 'image-table-node--selected' : ''}`}>
      <header className="image-table-node__head">
        <span className="image-table-node__title">
          <span className="image-table-node__title-icon video-node__title-icon" aria-hidden />
          <span className="image-table-node__title-text">{title}</span>
        </span>
        <span className="image-table-node__dimension">{dimensionLabel}</span>
      </header>
      <div className="image-table-node__media video-node__media">
        {data.videoDataUrl ? (
          <>
            <video
              className="image-table-node__preview video-node__preview"
              src={data.videoDataUrl}
              controls
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={onPreviewLoaded}
            />
            {extracting ? <span className="video-node__badge">抽帧中</span> : null}
          </>
        ) : (
          <button type="button" className="image-table-node__empty" onClick={pickVideo}>
            <span className="image-table-node__empty-title">添加视频参考</span>
            <span className="image-table-node__empty-copy">上传视频后，连接到文本卡片，提交即可分析构图、元素、景别与运镜。</span>
          </button>
        )}
      </div>
      <div className="image-table-node__body">
        {data.videoAnalysisSummary?.trim() ? (
          <div className="image-table-node__summary">{data.videoAnalysisSummary.trim()}</div>
        ) : data.videoFrameDataUrl ? (
          <div className="image-table-node__summary">已生成起始 / 中段 / 结尾抽帧，可连接文本卡片进行 LLM 视频分析。</div>
        ) : null}
        <input
          ref={inputRef}
          className="image-table-node__input"
          type="file"
          accept="video/*,.mov,.m4v,.mp4,.webm,.avi,.mkv"
          onChange={onVideoPicked}
        />
        {data.generation_error?.trim() ? (
          <div className="image-table-node__error">{data.generation_error.trim()}</div>
        ) : null}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id={VIDEO_NODE_OUTPUT_HANDLE_ID}
        className="image-table-node__handle"
        title="Output：连接到文本卡片后，提交会结合视频抽帧分析画面。"
      />
    </div>
  );
}

export const VideoNode = memo(VideoNodeInner);
