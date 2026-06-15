// video.js — Encode canvas frames into a short MP4 using the browser WebCodecs API
// + mp4-muxer. Two entry points share one encoder pipeline (so the iOS-critical
// codec/AVCC config lives in exactly one place):
//   encodeMp4(canvas, …)            — a single still held for `seconds` (reels).
//   encodeMp4Provider(count, …)     — an animated sequence: each segment's canvas
//                                     is built lazily and held for its duration.
// Falls back with a clear message where unsupported.
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export function mp4Supported() {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

// H.264 codec strings to try, best first. High → Main → Baseline, all level 4.0
// (covers 1080x1920 @ 30fps). iOS hardware encoders accept High; we still fall
// back so older/odd devices that only do Baseline keep working.
const CODECS = ["avc1.640028", "avc1.4d0028", "avc1.420028"];

const even = (n) => (n % 2 === 0 ? n : n - 1);

// Resolve an H.264 encoder config this device actually supports for WxH. Some
// devices (notably mobile Safari) expose VideoEncoder but only a subset of configs.
// NOTE: `avc: { format: "avc" }` forces AVCC (length-prefixed) output — mp4-muxer
// needs that. Without it Safari emits Annex B and produces a corrupt/empty file
// that "downloads" but won't play. This is the key fix for MP4 on iPhone.
async function resolveConfig(W, H, fps, bitrate) {
  const base = { width: W, height: H, bitrate, framerate: fps, avc: { format: "avc" } };
  if (typeof VideoEncoder.isConfigSupported === "function") {
    for (const codec of CODECS) {
      const cfg = { ...base, codec };
      const support = await VideoEncoder.isConfigSupported(cfg).catch(() => null);
      if (support && support.supported) return support.config || cfg;
    }
    throw new Error("This device can't encode MP4 video. Try downloading PNG or SVG instead.");
  }
  return { ...base, codec: CODECS[0] };
}

// Coerce a canvas to exactly WxH (even dims, white background) if it isn't already.
function toExactCanvas(canvas, W, H) {
  if (canvas.width === W && canvas.height === H) return canvas;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const fx = c.getContext("2d");
  fx.fillStyle = "#ffffff";
  fx.fillRect(0, 0, W, H);
  fx.drawImage(canvas, 0, 0);
  return c;
}

// Core pipeline. `produce(emit)` must call `await emit(canvas)` once per OUTPUT
// frame, in order. Returns a Blob (video/mp4).
async function encodeSequence(W0, H0, { fps, bitrate }, produce) {
  if (!mp4Supported()) {
    throw new Error("MP4 export needs a browser with WebCodecs (Chrome, Edge, or Safari 17+). Try PNG or SVG.");
  }
  const W = even(W0), H = even(H0);
  const config = await resolveConfig(W, H, fps, bitrate);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
  });
  // Capture an async encoder error so it rejects rather than silently yielding an
  // empty/corrupt buffer (which then "downloads" as a broken file).
  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encoderError = e; console.error("[mp4 encoder]", e); },
  });
  encoder.configure(config);

  let i = 0;
  const emit = async (canvas) => {
    if (encoderError) return;
    const src = toExactCanvas(canvas, W, H);
    const vf = new VideoFrame(src, { timestamp: (i * 1e6) / fps, duration: 1e6 / fps });
    encoder.encode(vf, { keyFrame: i % fps === 0 });
    vf.close();
    i++;
    // Backpressure: without this, frames queue in one tight loop and the encoder's
    // in-flight surfaces pile up. On iOS Safari that exceeds the per-tab memory
    // budget and the OS silently kills/reloads the page mid-encode. Drain first.
    while (encoder.encodeQueueSize > 4 && !encoderError) {
      await new Promise((r) => setTimeout(r, 8));
    }
  };

  await produce(emit);
  await encoder.flush();
  if (encoderError) {
    throw new Error("MP4 encoding failed on this device. Try downloading PNG or SVG instead.");
  }
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

// Encode `frameCanvas` as a still video of `seconds` at `fps`. Returns a Blob.
export async function encodeMp4(frameCanvas, { seconds = 10, fps = 30, bitrate = 6_000_000 } = {}) {
  const total = Math.max(1, Math.round(seconds * fps));
  return encodeSequence(frameCanvas.width, frameCanvas.height, { fps, bitrate }, async (emit) => {
    for (let f = 0; f < total; f++) await emit(frameCanvas);
  });
}

// Encode an animated sequence of `count` segments. `getCanvas(i)` returns (or
// promises) the canvas for segment i — built LAZILY right before its frames and
// not retained afterwards, so memory stays bounded (important on iOS). `getSeconds(i)`
// is how long to hold segment i. `onSegment(i)` (optional) reports progress. All
// segment canvases should share the first canvas's dimensions.
export async function encodeMp4Provider(count, getCanvas, getSeconds, { fps = 30, bitrate = 6_000_000, onSegment } = {}) {
  if (!count) throw new Error("Nothing to encode.");
  const first = await getCanvas(0);
  return encodeSequence(first.width, first.height, { fps, bitrate }, async (emit) => {
    for (let s = 0; s < count; s++) {
      const canvas = s === 0 ? first : await getCanvas(s);
      const frames = Math.max(1, Math.round((getSeconds(s) || 1 / fps) * fps));
      for (let f = 0; f < frames; f++) await emit(canvas);
      if (onSegment) onSegment(s);
    }
  });
}
