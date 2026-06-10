// tour.js — Reusable first-run walkthrough engine. A dimmed overlay with a
// "spotlight" cutout over each control plus a popover that explains it. Vanilla,
// no dependencies, and "explain only": it never changes the page's inputs.
//
// Usage:
//   import { createTour } from "./tour.js";
//   const tour = createTour(STEPS, "my_page_tour_v1");
//   tourBtn.addEventListener("click", tour.start);   // manual replay
//   tour.maybeAutoStart();                           // once per browser
//
// A step is { title, body, targets, before? }:
//   targets: array of CSS selectors to spotlight (union of their boxes), or null
//            for a centered card with no spotlight (intro / outro). Selectors that
//            match nothing or a hidden (zero-size) element are skipped — if none
//            resolve, the step falls back to a centered card. This makes a step
//            safely adaptive (e.g. a panel that only appears after interaction).
//   before:  optional fn run just before the step shows (e.g. open a <details>).
//
// onEnd: optional fn run once when the tour exits by any path (Done, Skip, Esc).
//        Use it to undo side effects from `before` hooks (e.g. re-collapse a panel).
import "./tour.css";

const PAD = 6;   // spotlight padding around the target, px
const GAP = 14;  // gap between target and popover, px

export function createTour(steps, seenKey, onEnd) {
  let idx = 0;
  let nodes = null;   // { blocker, spotlight, pop, dots, title, body, back, next }
  let rafId = 0;

  // ---- DOM helpers --------------------------------------------------------

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function buildDOM() {
    const blocker = el("div", "tour-blocker");
    const spotlight = el("div", "tour-spotlight");
    const pop = el("div", "tour-popover");
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-modal", "true");

    const dots = el("div", "tour-dots");
    const title = el("h3", "tour-title");
    const body = el("p", "tour-body");
    const footer = el("div", "tour-footer");
    const skip = el("button", "tour-skip", "Skip tour");
    const back = el("button", "tour-btn-prev", "Back");
    const next = el("button", "tour-btn-next", "Next →");
    footer.append(skip, el("div", "tour-spacer"), back, next);
    pop.append(dots, title, body, footer);
    document.body.append(blocker, spotlight, pop);

    skip.addEventListener("click", () => end());
    back.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    // Swallow clicks on the dimmed area so the page can't change mid-tour.
    blocker.addEventListener("click", (e) => e.stopPropagation());

    return { blocker, spotlight, pop, dots, title, body, back, next };
  }

  // ---- geometry / positioning ---------------------------------------------

  function unionRect(selectors) {
    let r = null;
    for (const sel of selectors) {
      const e = document.querySelector(sel);
      if (!e) continue;
      const b = e.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      r = r
        ? { left: Math.min(r.left, b.left), top: Math.min(r.top, b.top),
            right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) }
        : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    }
    return r;
  }

  function positionCentered() {
    const vw = window.innerWidth, vh = window.innerHeight;
    Object.assign(nodes.spotlight.style, {
      left: vw / 2 + "px", top: vh / 2 + "px", width: "0px", height: "0px",
    });
    const pr = nodes.pop.getBoundingClientRect();
    nodes.pop.style.left = Math.max(8, (vw - pr.width) / 2) + "px";
    nodes.pop.style.top = Math.max(8, (vh - pr.height) / 2) + "px";
  }

  function positionAt(r) {
    const sp = nodes.spotlight.style;
    sp.left = r.left - PAD + "px";
    sp.top = r.top - PAD + "px";
    sp.width = r.right - r.left + PAD * 2 + "px";
    sp.height = r.bottom - r.top + PAD * 2 + "px";

    const vw = window.innerWidth, vh = window.innerHeight;
    const pr = nodes.pop.getBoundingClientRect();
    const pw = pr.width, ph = pr.height;
    let top;
    if (vh - r.bottom >= ph + GAP + 8) top = r.bottom + GAP;   // below
    else if (r.top >= ph + GAP + 8) top = r.top - GAP - ph;    // above
    else top = (vh - ph) / 2;                                  // beside/centered
    let left = (r.left + r.right) / 2 - pw / 2;                // centered on target
    left = Math.max(8, Math.min(vw - pw - 8, left));
    top = Math.max(8, Math.min(vh - ph - 8, top));
    nodes.pop.style.left = left + "px";
    nodes.pop.style.top = top + "px";
  }

  // Measure + position the current step (no scrolling). rAF-throttled so it's
  // cheap to call from resize/scroll listeners.
  function place() {
    if (!nodes) return;
    const sel = steps[idx].targets;
    if (!sel || !sel.length) { positionCentered(); return; }
    const r = unionRect(sel);
    if (r) positionAt(r); else positionCentered();
  }

  function reposition() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; place(); });
  }

  // ---- step flow ----------------------------------------------------------

  function renderDots() {
    nodes.dots.textContent = "";
    for (let i = 0; i < steps.length; i++) {
      nodes.dots.append(el("span", i === idx ? "on" : null));
    }
  }

  function showStep() {
    const step = steps[idx];
    if (step.before) { try { step.before(); } catch (e) { /* non-fatal */ } }
    nodes.title.textContent = step.title;
    nodes.body.textContent = step.body;
    renderDots();
    nodes.back.style.visibility = idx === 0 ? "hidden" : "visible";
    nodes.next.textContent = idx === steps.length - 1 ? "Done" : "Next →";

    const sel = step.targets;
    if (sel && sel.length) {
      const first = document.querySelector(sel[0]);
      if (first && first.scrollIntoView) first.scrollIntoView({ block: "center", inline: "nearest" });
    }
    reposition();
  }

  function go(dir) {
    const n = idx + dir;
    if (n < 0) return;
    if (n >= steps.length) { end(); return; }
    idx = n;
    showStep();
  }

  function onKey(e) {
    if (e.key === "Escape") end();
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  }

  function end() {
    if (!nodes) return;
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
    document.removeEventListener("keydown", onKey);
    nodes.blocker.remove();
    nodes.spotlight.remove();
    nodes.pop.remove();
    nodes = null;
    try { localStorage.setItem(seenKey, "1"); } catch (e) { /* private mode */ }
    if (onEnd) { try { onEnd(); } catch (e) { /* non-fatal */ } }
  }

  // ---- public API ---------------------------------------------------------

  function start() {
    if (nodes) return;
    idx = 0;
    nodes = buildDOM();
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true); // capture: also catch panel scroll
    showStep();
  }

  function maybeAutoStart() {
    let seen = false;
    try { seen = !!localStorage.getItem(seenKey); } catch (e) { /* private mode */ }
    if (!seen) start();
  }

  return { start, maybeAutoStart };
}
