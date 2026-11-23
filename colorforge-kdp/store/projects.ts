"use client";

import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";
import {
  createDesign,
  createProject,
  newId,
  type ContentItem,
  type NewProjectInput,
  type Project,
  type ProjectSummary,
  type PuzzleItem,
  type PuzzleSettings,
  type Shape,
} from "@/lib/model";
import { makePuzzleItem, regeneratePuzzle } from "@/lib/puzzles/themes";
import { generateNumberEntries } from "@/lib/puzzles/search-grid";
import * as storage from "@/lib/storage";

type SaveState = "saved" | "pending" | "saving" | "error";

interface ProjectsState {
  summaries: ProjectSummary[];
  listLoaded: boolean;
  current: Project | null;
  loadState: "idle" | "loading" | "ready" | "missing" | "error";
  saveState: SaveState;
  error: string | null;

  refreshList(): Promise<void>;
  createBook(input: NewProjectInput): Promise<string>;
  deleteBook(id: string): Promise<void>;
  duplicateBook(id: string): Promise<string | null>;
  open(id: string): Promise<void>;
  flush(): Promise<void>;

  updateMeta(patch: Partial<Pick<Project, "title" | "subtitle" | "author" | "trimSize" | "hasBleed" | "paperType" | "includeFrontMatter">>): void;
  updatePuzzleSettings(patch: Partial<PuzzleSettings>): void;
  reorderItems(fromId: string, toId: string): void;
  addDesign(): string | null;
  addPuzzle(): string | null;
  duplicateItem(id: string): void;
  removeItem(id: string): void;
  toggleBacking(id: string): void;
  setAllBacking(on: boolean): void;
  renameItem(id: string, name: string): void;
  setDesignShapes(id: string, shapes: Shape[]): void;
  updatePuzzle(id: string, patch: Partial<Pick<PuzzleItem, "title" | "entries" | "seed">>): void;
}

const SAVE_DELAY_MS = 400;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const puzzleType = (p: Project): "word-search" | "number-search" => (p.type === "number-search" ? "number-search" : "word-search");

export const useProjects = create<ProjectsState>((set, get) => {
  /** Apply an edit to the open project and schedule a save. */
  const mutate = (fn: (p: Project) => Project) => {
    const current = get().current;
    if (!current) return;
    set({ current: { ...fn(current), updatedAt: Date.now() }, saveState: "pending" });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().flush(), SAVE_DELAY_MS);
  };

  const mapItems = (fn: (items: ContentItem[]) => ContentItem[]) => mutate((p) => ({ ...p, items: fn(p.items) }));

  return {
    summaries: [],
    listLoaded: false,
    current: null,
    loadState: "idle",
    saveState: "saved",
    error: null,

    async refreshList() {
      try {
        set({ summaries: await storage.listProjects(), listLoaded: true, error: null });
      } catch (e) {
        set({ listLoaded: true, error: (e as Error).message });
      }
    },

    async createBook(input) {
      const project = createProject(input);
      await storage.saveProject(project);
      void storage.requestPersistentStorage();
      await get().refreshList();
      return project.id;
    },

    async deleteBook(id) {
      await storage.deleteProject(id);
      if (get().current?.id === id) set({ current: null, loadState: "idle" });
      await get().refreshList();
    },

    async duplicateBook(id) {
      const source = await storage.loadProject(id);
      if (!source) return null;
      const now = Date.now();
      const copy: Project = { ...structuredClone(source), id: newId("book"), title: `${source.title} (copy)`, createdAt: now, updatedAt: now };
      await storage.saveProject(copy);
      await get().refreshList();
      return copy.id;
    },

    async open(id) {
      if (get().current?.id === id && get().loadState === "ready") return;
      await get().flush();
      set({ loadState: "loading", current: null });
      try {
        const project = await storage.loadProject(id);
        set(project ? { current: project, loadState: "ready", saveState: "saved" } : { loadState: "missing" });
      } catch (e) {
        set({ loadState: "error", error: (e as Error).message });
      }
    },

    async flush() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const { current, saveState } = get();
      if (!current || saveState === "saved") return;
      set({ saveState: "saving" });
      try {
        await storage.saveProject(current);
        // Another edit may have landed while saving; keep it pending if so.
        if (get().current === current) set({ saveState: "saved" });
        else set({ saveState: "pending" });
      } catch (e) {
        set({ saveState: "error", error: (e as Error).message });
      }
    },

    updateMeta(patch) {
      mutate((p) => ({ ...p, ...patch }));
    },

    updatePuzzleSettings(patch) {
      mutate((p) => {
        if (!p.puzzleSettings) return p;
        const settings = { ...p.puzzleSettings, ...patch };
        const type = puzzleType(p);
        let items = p.items;
        if (patch.entriesPerPuzzle !== undefined && type === "number-search") {
          items = items.map((it) => (it.kind === "puzzle" ? { ...it, entries: generateNumberEntries(settings.entriesPerPuzzle, it.seed) } : it));
        }
        items = items.map((it) => (it.kind === "puzzle" ? regeneratePuzzle(it, type, settings) : it));
        return { ...p, puzzleSettings: settings, items };
      });
    },

    reorderItems(fromId, toId) {
      mapItems((items) => {
        const from = items.findIndex((i) => i.id === fromId);
        const to = items.findIndex((i) => i.id === toId);
        return from < 0 || to < 0 ? items : arrayMove(items, from, to);
      });
    },

    addDesign() {
      const p = get().current;
      if (!p || p.type !== "coloring") return null;
      const design = createDesign(`Design ${p.items.length + 1}`);
      mapItems((items) => [...items, design]);
      return design.id;
    },

    addPuzzle() {
      const p = get().current;
      if (!p?.puzzleSettings || p.type === "coloring") return null;
      const seed = `${p.seed}/extra-${newId("p")}`;
      const n = p.items.length + 1;
      const entries = p.type === "number-search" ? generateNumberEntries(p.puzzleSettings.entriesPerPuzzle, seed) : [];
      const item = makePuzzleItem(`Puzzle ${n}`, entries, seed, p.type, p.puzzleSettings);
      mapItems((items) => [...items, item]);
      return item.id;
    },

    duplicateItem(id) {
      mapItems((items) => {
        const i = items.findIndex((it) => it.id === id);
        if (i < 0) return items;
        const src = items[i]!;
        const copy: ContentItem =
          src.kind === "design"
            ? { ...structuredClone(src), id: newId("design"), name: `${src.name} copy` }
            : { ...structuredClone(src), id: newId("puzzle"), title: `${src.title} copy` };
        return [...items.slice(0, i + 1), copy, ...items.slice(i + 1)];
      });
    },

    removeItem(id) {
      mapItems((items) => items.filter((it) => it.id !== id));
    },

    toggleBacking(id) {
      mapItems((items) => items.map((it) => (it.id === id && it.kind === "design" ? { ...it, addBackingPage: !it.addBackingPage } : it)));
    },

    setAllBacking(on) {
      mapItems((items) => items.map((it) => (it.kind === "design" ? { ...it, addBackingPage: on } : it)));
    },

    renameItem(id, name) {
      mapItems((items) =>
        items.map((it) => (it.id !== id ? it : it.kind === "design" ? { ...it, name } : { ...it, title: name })),
      );
    },

    setDesignShapes(id, shapes) {
      mapItems((items) => items.map((it) => (it.id === id && it.kind === "design" ? { ...it, shapes } : it)));
    },

    updatePuzzle(id, patch) {
      mutate((p) => {
        if (!p.puzzleSettings) return p;
        const settings = p.puzzleSettings;
        const type = puzzleType(p);
        return {
          ...p,
          items: p.items.map((it) => {
            if (it.id !== id || it.kind !== "puzzle") return it;
            const next = { ...it, ...patch };
            const needsGrid = patch.entries !== undefined || patch.seed !== undefined;
            return needsGrid ? regeneratePuzzle(next, type, settings) : next;
          }),
        };
      });
    },
  };
});

// Save pending edits before the tab goes away.
if (typeof window !== "undefined") {
  const flush = () => void useProjects.getState().flush();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}
