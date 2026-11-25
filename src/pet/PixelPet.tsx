import { useEffect, useRef } from "react";

const pixels = [
  "..................",
  "...oo........oo...",
  "..opho......ohpo..",
  "..oppho....ohppo..",
  "..opppoooooopppo..",
  "..oppppppppppppo..",
  "..oppppppppppppo..",
  ".oppppppppppppppo.",
  ".oppppppppppppppo.",
  ".oppppppppppppppo.",
  ".opphpppppphppppo.",
  ".oppppppppppppppo.",
  "..oppppppppppppo..",
  "...ossssssssso....",
  "...ossssssssso....",
  "..osssoossossso...",
  "..oooo..oo.oooo...",
  "..................",
];
const colors: Record<string, string> = { o: "#302342", p: "#c3a6ef", h: "#f8a9b4", s: "#9975cf" };
const grid = pixels.length;

export type PetMood = "idle" | "working" | "needs-input" | "ready" | "blocked" | "listening" | "dragging";

export function isSpritePixel(x: number, y: number) {
  const pixel = pixels[Math.floor(y * grid)]?.[Math.floor(x * grid)];
  return pixel !== undefined && pixel !== ".";
}

export function PixelPet({ mood, size }: { mood: PetMood; size: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer = 0;

    function draw(frame: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, grid, grid);
      pixels.forEach((row, y) => [...row].forEach((pixel, x) => {
        if (pixel === ".") return;
        ctx.fillStyle = colors[pixel];
        ctx.fillRect(x, y, 1, 1);
      }));

      const blink = frame % 18 === 16;
      const look = mood === "working" && frame % 6 < 3 ? 1 : 0;
      ctx.fillStyle = colors.o;
      for (const x of [5 + look, 11 + look]) {
        if (mood === "ready") {
          ctx.fillRect(x, 8, 2, 1);
          ctx.fillRect(x - 1, 9, 1, 1);
          ctx.fillRect(x + 2, 9, 1, 1);
        } else {
          ctx.fillRect(x, blink ? 9 : 8, 2, blink ? 1 : 2);
        }
      }
      ctx.fillStyle = mood === "blocked" ? "#913b60" : colors.o;
      ctx.fillRect(8, 11, 2, mood === "dragging" || mood === "needs-input" || mood === "listening" ? 2 : 1);
      const glowing = (mood === "working" || mood === "ready") && frame % 6 >= 3;
      ctx.fillStyle = glowing ? "#ffe0a6" : "#fff2fa";
      ctx.fillRect(8, 5, 2, 1);
      ctx.fillRect(9, 4, 1, 3);
    }

    function configure() {
      window.clearInterval(timer);
      draw(0);
      if (motion.matches) return;
      let frame = 0;
      timer = window.setInterval(() => draw(++frame), 180);
    }

    configure();
    motion.addEventListener("change", configure);
    return () => {
      window.clearInterval(timer);
      motion.removeEventListener("change", configure);
    };
  }, [mood]);

  return <canvas data-pet-sprite className="pixel-pet" ref={canvas} width={grid} height={grid} style={{ width: size, height: size }} aria-hidden="true" />;
}
