const CAMERA_HEADING = '【摄影机 / 镜头】';

const LABELED_CAMERA_RE = /(?:^|\n)\s*(?:摄影机(?:型号)?|摄像机(?:型号)?|camera(?:\s+body)?)\s*[:：]\s*([^\n]+)/i;
const KNOWN_CAMERA_MODEL_RE = /(?:ARRI\s+(?:ALEXA\s+(?:35|LF|Mini\s+LF|65)|AMIRA)|Sony\s+VENICE\s*2|RED\s+(?:V-RAPTOR(?:\s*XL)?|KOMODO(?:-X)?)|Vision\s+Research\s+Phantom\s+(?:Flex4K|VEO(?:\s*4K)?)|Canon\s+(?:EOS\s+)?C(?:70|300|500)(?:\s+Mark\s+II)?|Blackmagic\s+URSA\s+Mini\s+Pro\s+12K|索尼\s*VENICE\s*2|索尼威尼斯(?:二代|2))/i;
const GENERIC_CAMERA_VALUE_RE = /^(?:自动|默认|未指定|待定|数字电影摄影机|电影摄影机|全画幅摄影机|摄影机|摄像机)(?:[，,、｜|；;。\s]|$)/i;
const CAMERA_PARAMETER_ONLY_RE = /^(?:\d+(?:\.\d+)?\s*(?:mm|毫米|fps|帧|k|p)|[tf]\s*\/?\s*\d+(?:\.\d+)?|(?:近景|中景|远景|特写|全景|平视|俯拍|仰拍|手持|跟拍|固定))(?:\s|$)/i;
const PLAUSIBLE_MODEL_RE = /(?:[A-Za-z]{2,}[\w .+/-]*\d|\d[\w .+/-]*[A-Za-z]{2,}|[\p{Script=Han}]{1,12}\s*[A-Za-z]*\s*\d+)/u;

function getSectionBounds(card: string): { bodyStart: number; bodyEnd: number; body: string } | null {
  const headingStart = card.indexOf(CAMERA_HEADING);
  if (headingStart < 0) return null;
  const bodyStart = headingStart + CAMERA_HEADING.length;
  const nextHeading = card.indexOf('\n【', bodyStart);
  const bodyEnd = nextHeading < 0 ? card.length : nextHeading;
  return { bodyStart, bodyEnd, body: card.slice(bodyStart, bodyEnd) };
}

function cleanCameraModel(value: string): string {
  return value
    .split(/[+｜|，,；;]/, 1)[0]
    .replace(/[。；;，,]+$/g, '')
    .trim();
}

/** Returns a concrete camera body/model from the camera section, never from examples elsewhere. */
export function extractSeedance25CameraModel(card: string): string | null {
  const section = getSectionBounds(card);
  if (!section) return null;
  const body = section.body.trim();

  const labeled = cleanCameraModel(body.match(LABELED_CAMERA_RE)?.[1] ?? '');
  if (
    labeled
    && labeled.length <= 80
    && !GENERIC_CAMERA_VALUE_RE.test(labeled)
    && !CAMERA_PARAMETER_ONLY_RE.test(labeled)
    && (KNOWN_CAMERA_MODEL_RE.test(labeled) || PLAUSIBLE_MODEL_RE.test(labeled))
  ) {
    return labeled;
  }

  return cleanCameraModel(body.match(KNOWN_CAMERA_MODEL_RE)?.[0] ?? '') || null;
}

/** Deterministic fallback used only when neither the current shot nor its scene has a camera body. */
export function selectSeedance25CameraModel(card: string): string {
  const normalized = card.toLowerCase();
  if (/高速摄影|超高速|高速慢镜|phantom|每秒\s*\d{3,}\s*帧/.test(normalized)) {
    return 'Vision Research Phantom Flex4K';
  }
  if (/探针|probe|极小空间|狭小机位|管道内部|机械缝隙|微型摄影机位/.test(normalized)) {
    return 'ARRI ALEXA Mini LF';
  }
  if (/夜景|暗夜|低照度|极低照度|烛光|月光|地下|船坞|洞穴/.test(normalized)) {
    return 'Sony VENICE 2';
  }
  return 'ARRI ALEXA 35';
}

export type Seedance25CameraCompletion = {
  card: string;
  cameraModel: string;
  added: boolean;
};

/**
 * Adds only a missing camera model line. Existing camera text and every other
 * section remain unchanged. A scene-level preferred model wins over fallback selection.
 */
export function ensureSeedance25CameraModel(
  card: string,
  preferredCameraModel?: string | null,
): Seedance25CameraCompletion {
  const existing = extractSeedance25CameraModel(card);
  if (existing) return { card, cameraModel: existing, added: false };

  const section = getSectionBounds(card);
  if (!section) {
    return {
      card,
      cameraModel: preferredCameraModel?.trim() || selectSeedance25CameraModel(card),
      added: false,
    };
  }

  const cameraModel = preferredCameraModel?.trim() || selectSeedance25CameraModel(card);
  const originalBody = section.body.trim();
  const replacement = `\n摄影机：${cameraModel}${originalBody ? `\n${originalBody}` : ''}\n`;
  return {
    card: `${card.slice(0, section.bodyStart)}${replacement}${card.slice(section.bodyEnd)}`,
    cameraModel,
    added: true,
  };
}
