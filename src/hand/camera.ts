// The webcam and MediaPipe's hand landmarker, feeding a HandTracker. Works offline: the model ships in
// public/models and the build copies MediaPipe's WebAssembly next to the page (vite.config.ts).
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { HandLandmarkerOptions, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { HAND_CONFIG, HandTracker, palmCentre } from './gesture.ts';

export interface HandCamera {
  readonly tracker: HandTracker;
  /** once per animation frame; size: the screen the cursor maps to, in CSS pixels */
  update(now: number, size: { width: number; height: number }): void;
}

/** null when there is no camera (or it was refused): the page carries on with the mouse. The preview canvas lies
 *  over the video; both are shown, mirrored, only while previewShown() says so. */
export async function startHandCamera(video: HTMLVideoElement, preview: HTMLCanvasElement, status: (text: string) => void,
  previewShown: () => boolean): Promise<HandCamera | null> {
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false,
    });
    await video.play();
  } catch (err) {
    console.warn('camera unavailable:', err);
    status('カメラが使えません。マウスで操作できます / No camera: use the mouse');
    return null;
  }

  status('手の認識を準備中… / Loading hand tracking...');
  // from the site root: each page lives in its own folder, where a relative path would point
  const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
  const options = (delegate: 'GPU' | 'CPU'): HandLandmarkerOptions => ({
    baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/hand_landmarker.task`, delegate },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.5,
  });
  let landmarker: HandLandmarker;
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('GPU delegate failed, using the CPU:', err);
    landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
  }
  status('');

  preview.width = video.videoWidth || 640;
  preview.height = video.videoHeight || 480;
  const tracker = new HandTracker();
  let lastVideoTime = -1;

  return {
    tracker,
    update(now, size) {
      if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      const landmarks = result.landmarks[0], world = result.worldLandmarks[0];
      tracker.update(landmarks && world ? { landmarks, world } : null, now, size);
      if (previewShown()) drawPreview(preview, landmarks, tracker.closed);
    },
  };
}

// over the camera image: the region that maps to the screen, the hand, and its open / closed state
function drawPreview(canvas: HTMLCanvasElement, hand: NormalizedLandmark[] | undefined, closed: boolean) {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width, H = canvas.height, r = HAND_CONFIG.region;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x0 * W, r.y0 * H, (r.x1 - r.x0) * W, (r.y1 - r.y0) * H);
  ctx.setLineDash([]);
  if (!hand) return;
  ctx.strokeStyle = 'rgba(143,211,255,0.9)';
  ctx.lineWidth = 3;
  for (const c of HandLandmarker.HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(hand[c.start].x * W, hand[c.start].y * H);
    ctx.lineTo(hand[c.end].x * W, hand[c.end].y * H);
    ctx.stroke();
  }
  const p = palmCentre(hand);
  ctx.fillStyle = closed ? '#7dff9a' : '#5ff2ff';
  ctx.beginPath();
  ctx.arc(p.x * W, p.y * H, closed ? 14 : 9, 0, Math.PI * 2);
  ctx.fill();
}
