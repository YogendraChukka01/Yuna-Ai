import { useRef, useState, type MutableRefObject, type PointerEvent, type RefObject } from "react";
import { openQuickChat } from "../lib/bridge";
import { useYuna, type YunaState } from "../lib/store";
import { PixelPet, type PetMood } from "./PixelPet";
import { petName, petSizes } from "./preferences";

export interface PetPress {
  x: number;
  y: number;
  dragging: boolean;
}

const badges = {
  working: ["…", "Working"],
  "needs-input": ["!", "Needs your input"],
  ready: ["✓", "Reply ready"],
  blocked: ["×", "Task failed"],
  listening: ["•", "Listening"],
} as const;

function taskMood(state: YunaState): Exclude<PetMood, "dragging"> {
  if (state.confirmation || state.task?.paused) return "needs-input";
  if (state.listening) return "listening";
  if (state.task) return "working";
  return state.petOutcome?.kind ?? "idle";
}

export function FloatingPet({ surface, press }: {
  surface: RefObject<HTMLButtonElement>;
  press: MutableRefObject<PetPress | null>;
}) {
  const state = useYuna();
  const [dragging, setDragging] = useState(false);
  const didDrag = useRef(false);
  const mood = taskMood(state);
  const name = petName(state.pet);
  const badge = mood === "idle" ? undefined : badges[mood];
  const label = [`Open Yuna chat with ${name}`, badge?.[1]].filter(Boolean).join(". ");

  function start(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    didDrag.current = false;
    press.current = { x: event.clientX, y: event.clientY, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = press.current;
    if (!current || !event.currentTarget.hasPointerCapture(event.pointerId) || current.dragging) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) return;
    current.dragging = true;
    didDrag.current = true;
    setDragging(true);
  }

  function end() {
    press.current = null;
    setDragging(false);
  }

  return (
    <button
      ref={surface}
      className="floating-pet"
      type="button"
      aria-label={label}
      title={state.petOutcome?.message || label}
      data-dragging={dragging}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onClick={(event) => {
        if (event.detail && didDrag.current) return;
        openQuickChat();
      }}
    >
      <PixelPet mood={dragging ? "dragging" : mood} size={petSizes[state.pet.size]} />
      {badge && <span className="pet-badge" data-pet-badge data-mood={mood} aria-hidden="true">{badge[0]}</span>}
    </button>
  );
}
