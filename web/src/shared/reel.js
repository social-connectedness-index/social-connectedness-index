// reel.js — Shared 9:16 "Instagram Reel" MP4 composition + delivery for the SCI
// web tools (the Map Maker and the Clustering app), so both produce the exact
// same portrait video format. Builds a 1080x1920 frame from render.js options,
// encodes it with video.js (WebCodecs + mp4-muxer), and hands it to the user —
// share sheet / direct download on desktop & Android, an inline "press-and-hold
// to Save to Photos" overlay on iOS (where <a download> and post-encode share
// both fail). See video.js for the encoder details.
import { renderMap, naturalHeight } from "./render.js";
import { encodeMp4, encodeMp4Provider, mp4Supported } from "./video.js";
import "./reel.css";

export { mp4Supported };

const REEL_W = 1080, REEL_H = 1920;

// iPadOS reports itself as "MacIntel" but has a touch screen — catch it too.
export const isIOS = () =>
  /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Compose a 1080x1920 (9:16) portrait frame for the MP4 from render.js options.
// We re-render the scene at reel width (supersampled 2x for crisp text/borders
// after downscale — but 1x on iOS, where a 2160x3840 canvas blows the per-tab
// memory budget) and size the canvas to the map's NATURAL height, so there's no
// internal letterbox: tall maps fill the frame, wide maps fill the width and are
// centered with only the unavoidable geometric top/bottom margin.
export function buildReelCanvas(renderOpts) {
  const SS = isIOS() ? 1 : 2; // supersample factor — render big, downscale for clean edges
  const w = REEL_W * SS;
  const h = Math.min(REEL_H * SS, naturalHeight({ ...renderOpts, width: w }));
  const src = renderMap({ ...renderOpts, width: w, height: h });

  const frame = document.createElement("canvas");
  frame.width = REEL_W;
  frame.height = REEL_H;
  const ctx = frame.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, REEL_W, REEL_H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const s = Math.min(REEL_W / src.width, REEL_H / src.height);
  const dw = src.width * s, dh = src.height * s;
  ctx.drawImage(src, (REEL_W - dw) / 2, (REEL_H - dh) / 2, dw, dh);
  return frame;
}

// Encode `renderOpts` as a short 9:16 MP4 and deliver it. `setStatus(msg)` is an
// optional progress reporter (each tool wires its own status line). Throws with a
// clear message where MP4 isn't supported.
export async function downloadReel(renderOpts, filename, { setStatus = () => {}, seconds = 20, fps = 30 } = {}) {
  if (!mp4Supported()) throw new Error("MP4 needs Chrome, Edge, or Safari 17+. Try PNG or SVG.");
  setStatus("Encoding MP4… this can take a few seconds.");
  const blob = await encodeMp4(buildReelCanvas(renderOpts), { seconds, fps });
  await deliverVideo(blob, filename, { setStatus });
  return blob;
}

// Encode an ANIMATED 9:16 reel from a list of frames. `frames` is an array of
// `{ renderOpts, seconds }`; each is rendered to a 1080x1920 portrait frame
// (built lazily, one at a time to bound memory) and held for `seconds`. Same
// format + delivery as a still reel. Throws where MP4 isn't supported.
export async function downloadReelAnimation(frames, filename, { setStatus = () => {}, fps = 30 } = {}) {
  if (!mp4Supported()) throw new Error("MP4 needs Chrome, Edge, or Safari 17+. Try PNG or SVG.");
  if (!frames.length) throw new Error("Nothing to animate.");
  const n = frames.length;
  setStatus(`Rendering animation… 0/${n}`);
  const blob = await encodeMp4Provider(
    n,
    (i) => buildReelCanvas(frames[i].renderOpts),
    (i) => frames[i].seconds,
    { fps, onSegment: (i) => setStatus(`Rendering animation… ${i + 1}/${n}`) },
  );
  await deliverVideo(blob, filename, { setStatus });
  return blob;
}

// Hand the encoded video to the user. iOS Safari ignores <a download> for blob
// URLs and the multi-second encode expires the tap activation navigator.share
// needs, so on iOS we show the video INLINE (press-and-hold → Save to Photos, or
// a fresh-gesture Share button). Desktop/Android use the share sheet or download.
export async function deliverVideo(blob, filename, { setStatus = () => {} } = {}) {
  const file = new File([blob], filename, { type: "video/mp4" });
  if (isIOS()) {
    showVideoResult(file, blob);
    setStatus("");
    return;
  }
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      setStatus("");
      return;
    } catch (e) {
      if (e.name === "AbortError") { setStatus(""); return; }
      // otherwise fall through to a direct download
    }
  }
  downloadBlob(blob, filename);
  setStatus("");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Revoke late so the browser has time to read the blob (mobile Safari).
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60000);
}

// Inline video result overlay (used on iOS). Plays the encoded MP4 in a real
// <video>; press-and-hold offers "Save to Photos" with no API and no live
// gesture needed, and the Share button is itself a fresh gesture for
// navigator.share. Also doubles as visible confirmation the encode succeeded.
function showVideoResult(file, blob) {
  const url = URL.createObjectURL(blob);

  const overlay = document.createElement("div");
  overlay.className = "video-result";
  const cleanup = () => { overlay.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(); });

  const video = document.createElement("video");
  video.src = url;
  video.controls = true;
  video.loop = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute("playsinline", ""); // play in place rather than forcing fullscreen
  video.playsInline = true;

  const hint = document.createElement("p");
  hint.textContent = "Press and hold the video, then “Save to Photos.” Or tap Share below.";

  const row = document.createElement("div");
  row.className = "video-result-actions";
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    const share = document.createElement("button");
    share.className = "video-result-btn";
    share.textContent = "Share";
    share.addEventListener("click", async () => {
      try { await navigator.share({ files: [file] }); }
      catch (e) { /* dismissed or unsupported — the press-and-hold path still works */ }
    });
    row.appendChild(share);
  }
  const done = document.createElement("button");
  done.className = "video-result-btn";
  done.textContent = "Done";
  done.addEventListener("click", cleanup);
  row.appendChild(done);

  overlay.append(video, hint, row);
  document.body.appendChild(overlay);
}
