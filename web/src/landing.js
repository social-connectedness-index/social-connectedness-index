const SCI_BIBTEX = `@article{johnston2026social,
  title = {The Social Connectedness Index: a large-scale dataset of social ties across geographic locations},
  author = {Drew Johnston and Theresa Kuchler and Manas Kulkarni and Johannes Stroebel},
  journal = {Data in Brief},
  volume = {67},
  pages = {112905},
  year = {2026},
  issn = {2352-3409},
  doi = {https://doi.org/10.1016/j.dib.2026.112905},
  url = {https://www.sciencedirect.com/science/article/pii/S2352340926004579}
}

@article{bailey2018social,
  title = {Social Connectedness: Measurement, Determinants, and Effects},
  author = {Bailey, Michael and Cao, Rachel and Kuchler, Theresa and Stroebel, Johannes and Wong, Arlene},
  journal = {Journal of Economic Perspectives},
  volume = {32},
  number = {3},
  pages = {259--280},
  year = {2018},
  doi = {https://doi.org/10.1257/jep.32.3.259},
  url = {https://www.aeaweb.org/articles?id=10.1257/jep.32.3.259}
}
`;

const CGFR_BIBTEX = `@article{bailey2025cgfr,
  title = {Cross-Gender Social Ties around the World},
  author = {Bailey, Michael and Johnston, Drew and Kuchler, Theresa and Kumar, Ayush and Stroebel, Johannes},
  journal = {AEA Papers and Proceedings},
  volume = {115},
  pages = {132--138},
  year = {2025},
  doi = {10.1257/pandp.20251032},
  url = {https://www.aeaweb.org/articles?id=10.1257/pandp.20251032}
}
`;

function setupReveal() {
  const items = Array.from(document.querySelectorAll(".reveal"));
  if (!items.length) return;

  if (!("IntersectionObserver" in window)) {
    items.forEach(item => item.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });

  items.forEach(item => observer.observe(item));
}

function fitHeadings() {
  const headings = Array.from(document.querySelectorAll(".fit-heading"));
  headings.forEach(heading => {
    heading.style.fontSize = "";

    const parent = heading.parentElement;
    const availableWidth = parent ? parent.clientWidth : heading.clientWidth;
    if (!availableWidth) return;

    let size = Number.parseFloat(window.getComputedStyle(heading).fontSize);
    const minSize = 30;

    while (heading.scrollWidth > availableWidth && size > minSize) {
      size -= 1;
      heading.style.fontSize = `${size}px`;
    }
  });
}

function setupFitHeadings() {
  let frame = 0;
  const scheduleFit = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(fitHeadings);
  };

  window.addEventListener("resize", scheduleFit, { passive: true });
  window.addEventListener("orientationchange", scheduleFit);
  scheduleFit();
}

function setupBibtexLinks() {
  const buttons = Array.from(document.querySelectorAll(".bibtex-btn"));
  if (!buttons.length) return;
  const isCgfrPage = document.body.classList.contains("cgfr-story");
  const bibtex = isCgfrPage ? CGFR_BIBTEX : SCI_BIBTEX;

  buttons.forEach(button => {
    button.addEventListener("click", () => {
      const blob = new Blob([bibtex], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, "_blank");
      if (opened) opened.opener = null;
      if (!opened) window.location.href = url;
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  });
}

setupReveal();
setupFitHeadings();
setupBibtexLinks();
