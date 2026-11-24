"use client";

import { create } from "zustand";
import type { BookFont, Shape } from "@/lib/model";

export type Tool = "pen" | "eraser" | "object-eraser" | "line" | "rect" | "ellipse" | "polygon" | "text";

const HISTORY_LIMIT = 200;

interface EditorState {
  tool: Tool;
  /** Inches. */
  strokeWidth: number;
  eraserWidth: number;
  polygonSides: number;
  font: BookFont;
  /** Inches. */
  fontSize: number;
  symmetrySegments: number;
  symmetryMirror: boolean;
  showOverlay: boolean;

  /** `${projectId}:${designId}`, since duplicated books share design ids. */
  designId: string | null;
  present: Shape[];
  past: Shape[][];
  future: Shape[][];

  setTool(tool: Tool): void;
  setOptions(patch: Partial<Pick<EditorState, "strokeWidth" | "eraserWidth" | "polygonSides" | "font" | "fontSize" | "symmetrySegments" | "symmetryMirror" | "showOverlay">>): void;
  /** Start editing a design; resets history if it is a different design. */
  load(designId: string, shapes: Shape[]): void;
  /** Record a finished action. Returns the new shapes. */
  commit(next: Shape[]): Shape[];
  /** Update the current state without a new history entry (continuous gestures). */
  replacePresent(next: Shape[]): void;
  /** Close a continuous gesture: one undo step back to `before`, if anything changed. */
  endGesture(before: Shape[]): void;
  undo(): Shape[] | null;
  redo(): Shape[] | null;
}

export const useEditor = create<EditorState>((set, get) => ({
  tool: "pen",
  strokeWidth: 0.025, // ≈ 1.8 pt: a bold, colorable line
  eraserWidth: 0.12,
  polygonSides: 6,
  font: "rounded",
  fontSize: 0.5,
  symmetrySegments: 1,
  symmetryMirror: false,
  showOverlay: true,

  designId: null,
  present: [],
  past: [],
  future: [],

  setTool: (tool) => set({ tool }),
  setOptions: (patch) => set(patch),

  load(designId, shapes) {
    if (get().designId === designId) return;
    set({ designId, present: shapes, past: [], future: [] });
  },

  commit(next) {
    const { present, past } = get();
    set({ present: next, past: [...past, present].slice(-HISTORY_LIMIT), future: [] });
    return next;
  },

  replacePresent(next) {
    set({ present: next });
  },

  endGesture(before) {
    const { present, past } = get();
    if (present !== before) set({ past: [...past, before].slice(-HISTORY_LIMIT), future: [] });
  },

  undo() {
    const { past, present, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return null;
    set({ present: prev, past: past.slice(0, -1), future: [present, ...future] });
    return prev;
  },

  redo() {
    const { past, present, future } = get();
    const next = future[0];
    if (!next) return null;
    set({ present: next, past: [...past, present], future: future.slice(1) });
    return next;
  },
}));
