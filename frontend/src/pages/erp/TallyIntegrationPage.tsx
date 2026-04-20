import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { erpService, ErpConnectionRow } from "../../services/erp.service";

export default function TallyIntegrationPage() {
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState(9000);
  const [testResult, setTestResult] = useState<{
    connected?: boolean;
    companies?: string[];
    tally_version?: string;
    error?: string;
  } | null>(null);
  const [connectionName, setConnectionName] = useState("My Tally");
  const [companyName, setCompanyName] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [connections, setConnections] = useState<ErpConnectionRow[]>([]);
  const [logs, setLogs] = useState<Record<string, unknown>[]>([]);
  const [periodFrom, setPeriodFrom] = useState("2025-04-01");
  const [periodTo, setPeriodTo] = useState("2026-03-31");
  const [selectedConnId, setSelectedConnId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshConnections = async () => {
    try {
      const { connections: c } = await erpService.getConnections();
      setConnections(c);
      if (c.length && selectedConnId == null) setSelectedConnId(c[0].id);
    } catch {
      setConnections([]);
    }
  };

  const refreshLogs = async () => {
    try {
      const { logs: l } = await erpService.getSyncLogs(30);
      setLogs(l);
    } catch {
      setLogs([]);
    }
  };

  useEffect(() => {
    void refreshConnections();
    void refreshLogs();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50 to-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">ERP integration — Tally</h1>
            <p className="text-sm text-slate-600">Connect Tally Prime / ERP 9 and import trial balance into IFRS.</p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/ifrs-statement"
              className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200"
            >
              IFRS statements
            </Link>
            <Link to="/dashboard" className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
              Dashboard
            </Link>
          </div>
        </div>

        <div className="rounded-xl border bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-200">
          <p className="font-semibold">Before connecting</p>
          <ol className="mt-2 list-decimal pl-5 space-y-1">
            <li>Open Tally Prime or Tally ERP 9 and load your company.</li>
            <li>Enable the XML / ODBC gateway (often port 9000 — check Tally network configuration).</li>
          </ol>
        </div>

        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">1. Test connection</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="text-sm">
              Host
              <input
                className="ml-2 rounded border px-2 py-1"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Port
              <input
                type="number"
                className="ml-2 w-24 rounded border px-2 py-1"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </label>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await erpService.testTallyConnection(host, port);
                  setTestResult(r);
                  if (r.connected && r.companies?.length) setCompanyName(r.companies[0]);
                  toast.success(r.connected ? "Tally reachable" : "Could not connect");
                } catch (e: unknown) {
                  toast.error("Test failed");
                  setTestResult({ connected: false, error: String(e) });
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Test connection
            </button>
          </div>
          {testResult && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
              {testResult.connected ? (
                <>
                  <p className="font-medium text-emerald-700">Connected — {testResult.tally_version}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {(testResult.companies || []).map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-red-700">{testResult.error || "Not connected"}</p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">2. Save connection</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Connection name
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Tally company name (exact)
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Default currency
              <input
                className="mt-1 w-full rounded border px-2 py-1"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </label>
          </div>
          <button
            disabled={busy || !companyName.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await erpService.saveTallyConnection({
                  connection_name: connectionName,
                  tally_host: host,
                  tally_port: port,
                  tally_company_name: companyName,
                  default_currency: currency,
                });
                toast.success("Connection saved");
                await refreshConnections();
              } catch (e: unknown) {
                toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Save failed");
              } finally {
                setBusy(false);
              }
            }}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save connection
          </button>
        </section>

        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">3. Import trial balance</h2>
          <div className="mt-3 flex flex-wrap gap-3">
            <select
              className="rounded border px-2 py-1 text-sm"
              value={selectedConnId ?? ""}
              onChange={(e) => setSelectedConnId(Number(e.target.value) || null)}
            >
              <option value="">Select saved connection</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.connection_name} — {c.tally_company_name}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="rounded border px-2 py-1 text-sm"
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
            />
            <input
              type="date"
              className="rounded border px-2 py-1 text-sm"
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
            />
            <button
              disabled={busy || !selectedConnId}
              onClick={async () => {
                if (!selectedConnId) return;
                setBusy(true);
                try {
                  const r = await erpService.importFromTally(selectedConnId, periodFrom, periodTo);
                  toast.success(`Imported ${r.lines_count} lines — TB #${r.trial_balance_id}`);
                  await refreshLogs();
                } catch (e: unknown) {
                  toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Import failed");
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Import from Tally
            </button>
          </div>
        </section>

        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Quick import (no saved connection)</h2>
          <p className="mt-1 text-xs text-slate-500">Uses host/port and company below; creates a trial balance immediately.</p>
          <button
            disabled={busy || !companyName.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await erpService.quickImport({
                  host,
                  port,
                  company_name: companyName,
                  period_from: periodFrom,
                  period_to: periodTo,
                  currency,
                });
                toast.success(`Quick import OK — TB #${r.trial_balance_id} (${r.lines_count} lines)`);
              } catch (e: unknown) {
                toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Quick import failed");
              } finally {
                setBusy(false);
              }
            }}
            className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Quick import
          </button>
        </section>

        <section className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Sync history</h2>
          <div className="mt-3 overflow-x-auto text-sm">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="py-2 pr-2">Started</th>
                  <th className="py-2 pr-2">Company</th>
                  <th className="py-2 pr-2">Rows</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">TB ID</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((lg) => (
                  <tr key={String(lg.id)} className="border-b border-slate-100">
                    <td className="py-2 pr-2">{String(lg.started_at ?? "")}</td>
                    <td className="py-2 pr-2">{String(lg.company_name ?? "")}</td>
                    <td className="py-2 pr-2">{String(lg.rows_imported ?? "")}</td>
                    <td className="py-2 pr-2">{String(lg.status ?? "")}</td>
                    <td className="py-2 pr-2">
                      {lg.trial_balance_id ? (
                        <Link className="text-indigo-600 underline" to="/ifrs-statement">
                          #{String(lg.trial_balance_id)}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
          <span className="font-semibold text-slate-800">QuickBooks · Zoho Books</span> — same pattern later; endpoints not wired yet.
        </section>
      </div>
    </div>
  );
}
