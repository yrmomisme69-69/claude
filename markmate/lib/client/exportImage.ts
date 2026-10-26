"use client";

import type { PageImage } from "./files";

/** Draws the page photo plus the pen marks into one PNG and downloads it. */
export async function downloadMarkedPage(image: PageImage, svg: SVGSVGElement, filename: string) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d")!;

  const photo = await loadImage(image.dataUrl);
  ctx.drawImage(photo, 0, 0, image.width, image.height);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(image.width));
  clone.setAttribute("height", String(image.height));
  // Finished state for any draw-in animation, and pen text styling inline.
  clone.querySelectorAll(".draw-in").forEach((el) => {
    (el as SVGElement).style.strokeDasharray = "none";
    (el as SVGElement).style.animation = "none";
  });
  clone.querySelectorAll(".pen-text").forEach((el) => {
    const s = (el as SVGElement).style;
    s.fontFamily = "Caveat, 'Comic Sans MS', cursive";
    s.fontWeight = "700";
    s.paintOrder = "stroke";
    s.stroke = "#ffffff";
  });
  const markup = new XMLSerializer().serializeToString(clone);
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const marks = await loadImage(svgUrl);
    ctx.drawImage(marks, 0, 0, image.width, image.height);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/png"),
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}
