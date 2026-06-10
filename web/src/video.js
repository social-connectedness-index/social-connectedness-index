// video.js — Encode a static map image into a short MP4 (like the R tool's
// mp4 export: the image padded onto a portrait 1080x1920 frame). Uses the browser
// WebCodecs API + mp4-muxer. Falls back with a clear message where unsupported.
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export function mp4Supported() {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

// Returns a Blob (video/mp4). `seconds` of the still image at `fps`.
export async function encodeMp4(sourceCanvas, { seconds = 10, fps = 30, portrait = true } = {}) {
  if (!mp4Supported()) {
    throw new Error("MP4 export needs a browser with WebCodecs (Chrome, Edge, or Safari 17+). Try PNG or JPG.");
  }

  const W = portrait ? 1080 : even(sourceCanvas.width);
  const H = portrait ? 1920 : even(sourceCanvas.height);

  const frame = document.createElement("canvas");
  frame.width = W;
  frame.height = H;
  const ctx = frame.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const s = Math.min(W / sourceCanvas.width, H / sourceCanvas.height);
  const dw = sourceCanvas.width * s;
  const dh = sourceCanvas.height * s;
  ctx.drawImage(sourceCanvas, (W - dw) / 2, (H - dh) / 2, dw, dh);

  const config = {
    codec: "avc1.420028", // H.264 Baseline, level 4.0 (covers 1080x1920)
    width: W,
    height: H,
    bitrate: 5_000_000,
    framerate: fps,
  };
  // Some devices (notably mobile Safari) expose VideoEncoder but can't encode
  // this H.264 config — surface that clearly instead of producing a broken file.
  if (typeof VideoEncoder.isConfigSupported === "function") {
    const support = await VideoEncoder.isConfigSupported(config).catch(() => null);
    if (!support || !support.supported) {
      throw new Error("This device can't encode MP4 video. Try downloading PNG or JPG instead.");
    }
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
