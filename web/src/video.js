// video.js — Encode an already-composed frame canvas into a short MP4 (a still
// image held for `seconds`, e.g. a 9:16 reel built by buildReelCanvas in main.js).
// Uses the browser WebCodecs API + mp4-muxer. Falls back with a clear message
// where unsupported.
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export function mp4Supported() {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

// H.264 codec strings to try, best first. High → Main → Baseline, all level 4.0
// (covers 1080x1920 @ 30fps). iOS hardware encoders accept High; we still fall
// back so older/odd devices that only do Baseline keep working.
const CODECS = ["avc1.640028", "avc1.4d0028", "avc1.420028"];

// Encode `frameCanvas` (any size; coerced to even dimensions for H.264) as a
// still video of `seconds` at `fps`. Returns a Blob (video/mp4).
export async function encodeMp4(frameCanvas, { seconds = 10, fps = 30, bitrate = 6_000_000 } = {}) {
  if (!mp4Supported()) {
    throw new Error("MP4 export needs a browser with WebCodecs (Chrome, Edge, or Safari 17+). Try PNG or JPG.");
  }

  // H.264 requires even width/height. Redraw onto an even-sized canvas if needed.
  const W = even(frameCanvas.width);
  const H = even(frameCanvas.height);
  let frame = frameCanvas;
  if (W !== frameCanvas.width || H !== frameCanvas.height) {
    frame = document.createElement("canvas");
    frame.width = W;
    frame.height = H;
    const fx = frame.getContext("2d");
    fx.fillStyle = "#ffffff";
    fx.fillRect(0, 0, W, H);
    fx.drawImage(frameCanvas, 0, 0);
  }

  // Pick a codec this device can actually encode. Some devices (notably mobile
  // Safari) expose VideoEncoder but only support a subset of H.264 configs.
  // NOTE: `avc: { format: "avc" }` forces AVCC (length-prefixed) output — mp4-muxer
  // needs that. Without it Safari emits Annex B and produces a corrupt/empty file
  // that "downloads" but won't play. This is the key fix for MP4 on iPhone.
  const base = { width: W, height: H, bitrate, framerate: fps, avc: { format: "avc" } };
  let config = null;
  if (typeof VideoEncoder.isConfigSupported === "function") {
    for (const codec of CODECS) {
      const cfg = { ...base, codec };
      const support = await VideoEncoder.isConfigSupported(cfg).catch(() => null);
      if (support && support.supported) { config = support.config || cfg; break; }
    }
    if (!config) {
      throw new Error("This device can't encode MP4 video. Try downloading PNG or JPG instead.");
    }
  } else {
    config = { ...base, codec: CODECS[0] };
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
  });
  // Capture an async encoder error so it rejects this call rather than silently
  // yielding an empty/corrupt buffer (which then "downloads" as a broken file).
  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encoderError = e; console.error("[mp4 encoder]", e); },
  });
  encoder.configure(config);

  const total = Math.max(1, Math.round(seconds * fps));
  for (let i = 0; i < total; i++) {
    if (encoderError) break;
    const vf = new VideoFrame(frame, { timestamp: (i * 1e6) / fps, duration: 1e6 / fps });
    encoder.encode(vf, { keyFrame: i % fps === 0 });
    vf.close();
  }
  await encoder.flush();
  if (encoderError) {
    throw new Error("MP4 encoding failed on this device. Try downloading PNG or JPG instead.");
  }
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

const even = (n) => (n % 2 === 0 ? n : n - 1);
