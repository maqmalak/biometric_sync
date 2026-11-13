/* Open app-level dialogs from any page. */
import type { SyncPreset } from "../components/SyncDialog";

export const openSync = (preset: SyncPreset = {}) => window.dispatchEvent(new CustomEvent("bs-sync", { detail: preset }));
export const openRun = (id: string) => window.dispatchEvent(new CustomEvent("bs-run", { detail: id }));
export const openDeviceEditor = (device: any = null, prefill: any = {}) =>
  window.dispatchEvent(new CustomEvent("bs-device", { detail: { device, prefill } }));
