export type Device = {
  id: string; name: string; device_id: string; protocol: string; ip: string | null; port: number | null; timeout: number | null;
  force_udp: boolean; enabled: boolean; auto_sync: boolean; sync_interval: number; status: string; last_success_at: string | null;
  last_sync_status: string | null; last_error: string | null; last_punch_time: string | null; company: string | null;
  log_type_mode: string; sync_from: string | null; time_offset_minutes: number; clear_after_sync: boolean; sync_device_time: boolean;
  latitude: number | null; longitude: number | null; has_password: boolean; skip_auto_attendance: boolean; employee_field: string;
  info: { serial?: string; firmware?: string; platform?: string; device_name?: string; mac?: string; users?: number; records?: number;
    fingers?: number; faces?: number; clock?: string; read_at?: string; response_ms?: number; drift_seconds?: number };
  stats: { total: number; pending: number; failed: number; synced: number; skipped: number; today: number; last_punch: string | null };
};

export const PROTOCOLS = ["ZKTeco (TCP/UDP)", "ZKTeco ADMS (Push)", "ZKBio Time / BioTime", "HTTP API (Pull)", "Webhook (Push)"];
export const PULL = ["ZKTeco (TCP/UDP)", "ZKBio Time / BioTime", "HTTP API (Pull)"];
