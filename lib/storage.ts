/**
 * IndexedDB persistence. Projects are stored whole (one record per book) so
 * a save is atomic. A separate summaries store keeps the dashboard fast
 * without loading every design's vector data.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { migrateProject, summarize, type Project, type ProjectSummary } from "@/lib/model";

interface ColorForgeDB extends DBSchema {
  projects: { key: string; value: Project };
  summaries: { key: string; value: ProjectSummary; indexes: { "by-updated": number } };
}

const DB_NAME = "colorforge-kdp";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ColorForgeDB>> | null = null;

function db(): Promise<IDBPDatabase<ColorForgeDB>> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser does not support IndexedDB, so projects cannot be saved."));
  }
  dbPromise ??= openDB<ColorForgeDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore("projects", { keyPath: "id" });
      const summaries = database.createObjectStore("summaries", { keyPath: "id" });
      summaries.createIndex("by-updated", "updatedAt");
    },
  });
  return dbPromise;
}

export async function saveProject(project: Project): Promise<void> {
  const d = await db();
  const tx = d.transaction(["projects", "summaries"], "readwrite");
  await Promise.all([tx.objectStore("projects").put(project), tx.objectStore("summaries").put(summarize(project)), tx.done]);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const raw = await (await db()).get("projects", id);
  return raw ? migrateProject(raw) : undefined;
}

/** Most recently edited first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await (await db()).getAllFromIndex("summaries", "by-updated");
  return all.reverse();
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["projects", "summaries"], "readwrite");
  await Promise.all([tx.objectStore("projects").delete(id), tx.objectStore("summaries").delete(id), tx.done]);
}

/** Ask the browser not to evict saved books under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** For tests only. */
export function resetStorageForTests(): void {
  dbPromise = null;
}
