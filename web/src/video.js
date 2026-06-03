// video.js — Encode a static map image into a short MP4 (like the Shiny app's
// mp4 export: the image padded onto a portrait 1080x1920 frame). Uses the browser
// WebCodecs API + mp4-muxer. Falls back with a clear message where unsupported.
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export function mp4Supported() {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

// Returns a Blob (video/mp4). `seconds` of the still image at `fps`.
export async function encodeMp4(sourceCanvas, { seconds = 4, fps = 30, portrait = true } = {}) {
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

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("[mp4 encoder]", e),
  });
  encoder.configure({
    codec: "avc1.420028", // H.264 Baseline, level 4.0 (covers 1080x1920)
    width: W,
    height: H,
    bitrate: 5_000_000,
    framerate: fps,
  });

  const total = Math.max(1, Math.round(seconds * fps));
  for (let i = 0; i < total; i++) {
    const vf = new VideoFrame(frame, { timestamp: (i * 1e6) / fps, duration: 1e6 / fps });
    encoder.encode(vf, { keyFrame: i % fps === 0 });
    vf.close();
  }
  await encoder.flush();
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

const even = (n) => (n % 2 === 0 ? n : n - 1);
