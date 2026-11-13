/* Employee mapping: machine user IDs ↔ ERPNext employees (attendance_device_id). */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../lib/api";
import { fmtNum, fmtRelative } from "../lib/format";
import { useStore } from "../lib/store";
import { BusyButton, EmptyState, Icon, Loading, Modal, promptDialog, Stat, toast, toastError } from "../lib/ui";

const ISSUE: Record<string, [string, string]> = {
  not_in_erpnext: ["danger", "No employee has this ID"],
  inactive: ["warning", "Employee is not Active"],
  duplicate_id: ["warning", "Several employees share this ID"],
};

export default function Employees() {
  const { boot, tick } = useStore();
  const [data, setData] = useState<any>(null);
  const [filter, setFilter] = useState<"issues" | "all" | "ok">("issues");
  const [q, setQ] = useState("");
  const [link, setLink] = useState<any>(null);
  const load = useCallback(async () => { try { setData(await get("mapping")); } catch (e) { toastError(e); } }, []);
  useEffect(() => { load(); }, [load, tick]);

  const doLink = async (employee: string, uid: string) => {
    try {
      const r = await post("link_employee", { employee, user_id: uid });
      toast(`Saved. ${r.requeued} waiting punch(es) of ID ${uid} are being matched again.`, "success", "Employee linked", 8000);
      load();
    } catch (e) { toastError(e, "Could not update the employee"); }
  };

  if (!data) return <Loading />;
  const rows: any[] = data.rows;
  const n = (k: string) => rows.filter((r) => r.issue === k).length;
  const ql = q.toLowerCase();
  const shown = rows.filter((r) => (filter === "all" || (filter === "issues" ? r.issue : !r.issue)) &&
    (!ql || [r.user_id, r.device_user_name, r.employee, r.employee_name, r.department].join(" ").toLowerCase().includes(ql)));
  const ul: any[] = data.unlinked_employees;

  return (
    <div className="stack">
      <div className="row">
        <div className="muted" style={{ flex: 1, minWidth: 260 }}>Each punch carries the machine's <b>User ID</b>. The check-in is created for the employee whose <b>Attendance Device ID</b> equals that ID. This page shows which IDs match and which don't.</div>
        {boot.can_write && <BusyButton className="btn" busyText="Reading machines…" onClick={async () => {
          try {
            const r: any[] = await post("read_device_users");
            const bad = r.filter((x) => !x.ok);
            toast(r.filter((x) => x.ok).map((x) => `${x.device}: ${x.count}`).join(", ") || "No machine could be read.", bad.length ? "warning" : "success", bad.length ? `${bad.length} machine(s) not reachable` : "Users read");
            load();
          } catch (e) { toastError(e); }
        }}><Icon name="fingerprint" /> Read users from machines</BusyButton>}
        <button className="btn btn-primary" onClick={load}><Icon name="refresh" /> Refresh</button>
      </div>
      <div className="grid grid-4">
        <Stat icon="fingerprint" label="IDs on machines / in punches" value={fmtNum(rows.length)} meta={data.users_fetched_at ? `machine users read ${fmtRelative(data.users_fetched_at)}` : "machine users not read yet"} />
        <Stat icon="link" tone="success" label="Matched" value={fmtNum(rows.filter((r) => !r.issue).length)} meta={`${fmtNum(data.employee_count)} employees in ERPNext`} />
        <Stat icon="users" tone={n("not_in_erpnext") ? "danger" : "success"} label="Not found in ERPNext" value={fmtNum(n("not_in_erpnext"))} meta="their punches get no check-in" />
        <Stat icon="alert" tone={n("inactive") + n("duplicate_id") ? "warning" : "success"} label="Inactive / duplicate ID"
          value={<>{fmtNum(n("inactive"))} <span className="muted" style={{ fontSize: 16 }}>/ {fmtNum(n("duplicate_id"))}</span></>} meta={`${fmtNum(ul.length)} active employee(s) without an ID`} />
      </div>
      <div className="card">
        <div className="filters">
          <div className="segmented">{([["issues", "Problems"], ["all", "All IDs"], ["ok", "Matched"]] as const).map(([k, l]) => (
            <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>{k === "issues" && <Icon name="alert" />} {l}</button>))}</div>
          <div className="input-group" style={{ flex: 1, minWidth: 200, maxWidth: 360 }}><input className="input" placeholder="Search ID, name, department…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <span className="spacer" /><span className="muted small">{shown.length} shown</span>
        </div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Machine user ID</th><th>Name on machine</th><th>Machines</th><th>ERPNext employee</th><th>Status</th><th>Punches</th><th>Problem</th><th /></tr></thead><tbody>
          {shown.length ? shown.map((r) => (
            <tr key={r.user_id} className={r.issue ? `issue-row${r.issue === "not_in_erpnext" ? " bad" : ""}` : ""}>
              <td className="mono strong">{r.user_id}</td><td className="small">{r.device_user_name}</td><td className="small muted">{r.devices || "—"}</td>
              <td className="small">{r.employee ? <><div className="strong">{r.employee_name}</div><div className="tiny muted">{r.employee}{r.department ? ` · ${r.department}` : ""}</div></> : <span className="muted">—</span>}</td>
              <td>{r.employee_status && <span className={`badge ${r.employee_status === "Active" ? "success" : "warning"}`}>{r.employee_status}</span>}</td>
              <td className="small">{fmtNum(r.punches)}{r.last_punch && <div className="tiny muted">last {fmtRelative(r.last_punch)}</div>}
                {(r.pending || r.failed) ? <div className="tiny">{r.pending ? <span className="st-running">{r.pending} pending </span> : null}{r.failed ? <span className="st-failed">{r.failed} failed</span> : null}</div> : null}</td>
              <td className="small">{r.issue ? <span className={`badge ${ISSUE[r.issue][0]}`}>{ISSUE[r.issue][1]}</span> : <span className="badge success"><Icon name="check" /> OK</span>}</td>
              <td className="actions"><div className="btn-group">
                {r.issue === "not_in_erpnext" && boot.can_write && <button className="btn btn-sm" onClick={() => setLink(r)}><Icon name="link" /> Link…</button>}
                {r.punches > 0 && <Link className="btn btn-sm btn-ghost" to={`/punches/user/${encodeURIComponent(r.user_id)}`} title="View punches"><Icon name="list" /></Link>}
                {r.failed > 0 && boot.can_write && <button className="btn btn-sm btn-ghost" title="Retry failed punches" onClick={async () => {
                  try { const x = await post("reprocess", { user_id: r.user_id, status: "failed" }); toast(`${x.count} punch(es) queued.`, "success"); load(); } catch (e) { toastError(e); }
                }}><Icon name="refresh" /></button>}
              </div></td>
            </tr>)) : <tr><td colSpan={8}><EmptyState icon={filter === "issues" ? "checkCircle" : "users"} title={filter === "issues" ? "No problems found" : "Nothing to show"}
              text={filter === "issues" ? "Every machine user ID matches an active employee." : "Read the users from the machines."} /></td></tr>}
        </tbody></table></div>
      </div>
      <div className="card">
        <div className="card-head"><h3><Icon name="users" /> Active employees without an attendance device ID ({ul.length})</h3></div>
        <div className="card-body tight table-wrap">{ul.length ? <>
          <table className="table"><thead><tr><th>Employee</th><th>Name</th><th>Department</th><th>Company</th><th /></tr></thead><tbody>
            {ul.slice(0, 300).map((e) => (
              <tr key={e.name}><td className="mono small">{e.name}</td><td className="strong">{e.employee_name}</td><td className="small">{e.department}</td><td className="small muted">{e.company}</td>
                <td className="actions">{boot.can_write && <button className="btn btn-sm" onClick={async () => {
                  const v = await promptDialog({ title: "Set attendance device ID", label: `Machine user ID for ${e.employee_name || e.name}`, hint: "The user ID this employee uses on the biometric machines. It is saved on the Employee.", confirm: "Save" });
                  if (v && v.trim()) doLink(e.name, v.trim());
                }}><Icon name="link" /> Set ID…</button>}</td></tr>))}
          </tbody></table>{ul.length > 300 && <div className="hint" style={{ padding: "10px 20px" }}>Showing the first 300.</div>}</>
          : <div className="empty small"><Icon name="checkCircle" /><div>Every active employee has an ID.</div></div>}</div>
      </div>
      {link && <LinkDialog row={link} list={ul} onClose={() => setLink(null)} onPick={(emp) => { setLink(null); doLink(emp, link.user_id); }} />}
    </div>
  );
}

function LinkDialog({ row, list, onClose, onPick }: { row: any; list: any[]; onClose: () => void; onPick: (employee: string) => void }) {
  const [q, setQ] = useState(row.device_user_name || "");
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = list.filter((e) => !words.length || words.some((w: string) => [e.name, e.employee_name, e.department].join(" ").toLowerCase().includes(w))).slice(0, 100);
  return (
    <Modal title={`Link user ID ${row.user_id}`} icon="link" size="wide" onClose={onClose} foot={<button className="btn" onClick={onClose}>Cancel</button>}>
      <p className="muted mt-0">Choose the employee who uses ID <b className="mono">{row.user_id}</b>{row.device_user_name ? <> (“{row.device_user_name}” on the machine)</> : null}. The ID is saved as their <b>Attendance Device ID</b> and the waiting punches are matched again.</p>
      <input className="input mb-2" placeholder="Search employees without an ID…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="scan-list">{hits.length ? hits.map((e) => (
        <div key={e.name} className="row"><span className="strong">{e.employee_name}</span><span className="mono tiny muted">{e.name}</span><span className="small muted">{e.department}</span><span className="spacer" />
          <button className="btn btn-sm btn-primary" onClick={() => onPick(e.name)}><Icon name="link" /> Link</button></div>)) : <div className="empty small">No matching employees</div>}</div>
      <div className="hint mt-2">Only active employees without an ID are listed.</div>
    </Modal>
  );
}
