"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Select from "@/shared/components/Select";
import Modal, { ConfirmModal } from "@/shared/components/Modal";
import ProviderIcon from "@/shared/components/ProviderIcon";

const EMPTY_FORM = {
  name: "",
  apiKeyId: "",
  status: "active",
  unlimitedToken: "no",
  quotaTokens: "",
  resetPeriod: "none",
  expiredAt: "",
  providerLogos: [],
  showQuota: "yes",
};

function formatNumber(value) {
  if (value === null || value === undefined) return "Unlimited";
  return new Intl.NumberFormat("id-ID").format(value);
}

function parseQuota(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? Number(digits) : 0;
}

function formatQuotaInput(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? new Intl.NumberFormat("id-ID").format(Number(digits)) : "";
}

function formFromLimit(limit) {
  return {
    name: limit.name,
    apiKeyId: limit.apiKeyId,
    status: limit.status,
    unlimitedToken: limit.unlimitedToken ? "yes" : "no",
    quotaTokens: limit.unlimitedToken ? "" : formatQuotaInput(limit.quotaTokens),
    resetPeriod: limit.resetPeriod || "none",
    expiredAt: limit.expiredAt || "",
    providerLogos: limit.providerLogos || (limit.providerLogo ? [limit.providerLogo] : []),
    showQuota: limit.showQuota === false ? "no" : "yes",
  };
}

export default function ApiKeyLimitsPage() {
  const [data, setData] = useState({ limits: [], apiKeys: [], providerLogos: [] });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/api-key-limits", { cache: "no-store" });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Gagal memuat limit");
      setData(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/api-key-limits", { cache: "no-store" })
      .then(async (response) => {
        const next = await response.json();
        if (!response.ok) throw new Error(next.error || "Gagal memuat limit");
        if (!cancelled) setData(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const apiKeyOptions = useMemo(() => data.apiKeys.filter((key) => key.isActive).map((key) => ({
    value: key.id,
    label: `${key.name || "Unnamed"} (${key.key})`,
  })), [data.apiKeys]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, apiKeyId: apiKeyOptions[0]?.value || "" });
    setError("");
    setShowForm(true);
  };

  const openEdit = (limit) => {
    setEditing(limit);
    setForm(formFromLimit(limit));
    setError("");
    setShowForm(true);
  };

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleLogo = (logo) => setForm((current) => ({
    ...current,
    providerLogos: current.providerLogos.includes(logo)
      ? current.providerLogos.filter((item) => item !== logo)
      : [...current.providerLogos, logo],
  }));

  const submit = async (event) => {
    event?.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      ...form,
      unlimitedToken: form.unlimitedToken === "yes",
      quotaTokens: form.unlimitedToken === "yes" ? 0 : parseQuota(form.quotaTokens),
      resetPeriod: form.unlimitedToken === "yes" ? "none" : form.resetPeriod,
      expiredAt: form.expiredAt || null,
      providerLogos: form.providerLogos,
      showQuota: form.showQuota === "yes",
    };
    try {
      const response = await fetch(editing ? `/api/api-key-limits/${editing.id}` : "/api/api-key-limits", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Gagal menyimpan limit");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetQuota = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/api-key-limits/${resetting.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-quota" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Gagal mereset quota");
      setResetting(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/api-key-limits/${deleting.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Gagal menghapus limit");
      setDeleting(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async (limit) => {
    await navigator.clipboard.writeText(`${origin}/p/${limit.slug}`);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-text-muted">Access control</p>
          <h1 className="mt-2 text-3xl font-bold text-text-main">API Key Limit</h1>
          <p className="mt-2 text-sm text-text-muted">Atur quota token publik tanpa mengubah API key asli.</p>
        </div>
        <Button icon="add" onClick={openCreate}>Tambah</Button>
      </div>

      {error ? <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</div> : null}
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">
        {loading ? <div className="p-10 text-center text-sm text-text-muted">Memuat...</div> : data.limits.length === 0 ? <div className="p-10 text-center text-sm text-text-muted">Belum ada API Key Limit.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-border-subtle bg-surface-2 text-xs uppercase tracking-wide text-text-muted">
                <tr><th className="px-5 py-4">Limit</th><th className="px-5 py-4">API Key</th><th className="px-5 py-4">Usage</th><th className="px-5 py-4">Sisa quota</th><th className="px-5 py-4">Status</th><th className="px-5 py-4 text-right">Aksi</th></tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data.limits.map((limit) => {
                  const percentage = Math.round(limit.percentage);
                  const color = percentage <= 30 ? "#ef4444" : percentage <= 60 ? "#eab308" : "#16a34a";
                  return <tr key={limit.id}>
                    <td className="px-5 py-5"><div className="flex items-center gap-3">{(limit.providerLogos || (limit.providerLogo ? [limit.providerLogo] : [])).map((logo) => <ProviderIcon key={logo} providerId={logo} size={32} alt="" />)}<div><div className="font-semibold text-text-main">{limit.name}</div><div className="text-xs text-text-muted">/{limit.slug}</div></div></div></td>
                    <td className="px-5 py-5 text-text-muted">{data.apiKeys.find((key) => key.id === limit.apiKeyId)?.key || "Tidak tersedia"}</td>
                    <td className="px-5 py-5"><div className="min-w-[150px]"><div className="mb-2 flex justify-between text-xs"><span>{formatNumber(limit.usedTokens)}</span><span>{limit.unlimitedToken ? "∞" : `${percentage}%`}</span></div><div className="h-2 rounded-full bg-surface-3"><div className="h-2 rounded-full" style={{ width: `${percentage}%`, background: color }} /></div></div></td>
                    <td className="px-5 py-5 font-semibold text-text-main">{formatNumber(limit.remainingTokens)}</td>
                    <td className="px-5 py-5"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${limit.status === "active" && !limit.isExpired ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>{limit.isExpired ? "Expired" : limit.status === "active" ? "Active" : "Disabled"}</span></td>
                    <td className="px-5 py-5"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" icon="content_copy" aria-label="Salin URL" onClick={() => copyUrl(limit)} /><Button size="sm" variant="ghost" icon="restart_alt" aria-label="Reset quota" title="Reset quota" onClick={() => setResetting(limit)} /><Button size="sm" variant="ghost" icon="edit" aria-label="Edit" onClick={() => openEdit(limit)} /><Button size="sm" variant="ghost" icon="delete" aria-label="Delete" onClick={() => setDeleting(limit)} /></div></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title={editing ? "Edit API Key Limit" : "Tambah API Key Limit"} size="lg" footer={<><Button variant="ghost" onClick={() => setShowForm(false)}>Batal</Button><Button onClick={submit} loading={saving}>{editing ? "Simpan" : "Submit"}</Button></>}>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <Input label="Nama" required value={form.name} onChange={(event) => updateForm("name", event.target.value)} placeholder="Customer Premium" />
          <Select label="API Key" required value={form.apiKeyId} onChange={(event) => updateForm("apiKeyId", event.target.value)} options={apiKeyOptions} placeholder="Pilih API Key" />
          <Select label="Status" value={form.status} onChange={(event) => updateForm("status", event.target.value)} options={[{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} />
          <Select label="Unlimited Token" value={form.unlimitedToken} onChange={(event) => updateForm("unlimitedToken", event.target.value)} options={[{ value: "yes", label: "Ya" }, { value: "no", label: "Tidak" }]} />
          {form.unlimitedToken === "no" ? <Input label="Quota Token" required value={form.quotaTokens} onChange={(event) => updateForm("quotaTokens", formatQuotaInput(event.target.value))} placeholder="100.000" inputMode="numeric" /> : <div />}
          {form.unlimitedToken === "no" ? <Select label="Reset Token" value={form.resetPeriod} onChange={(event) => updateForm("resetPeriod", event.target.value)} options={[{ value: "none", label: "Tidak" }, { value: "daily", label: "Harian" }, { value: "weekly", label: "Mingguan" }, { value: "monthly", label: "Bulanan" }]} /> : <div />}
          {form.unlimitedToken === "no" ? <Select label="Tampilkan Nilai Quota" value={form.showQuota} onChange={(event) => updateForm("showQuota", event.target.value)} options={[{ value: "yes", label: "Ya" }, { value: "no", label: "Tidak" }]} /> : <div />}
          <Input label="Tanggal Expired (opsional)" type="date" value={form.expiredAt} onChange={(event) => updateForm("expiredAt", event.target.value)} />
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium text-text-main">Logo Provider (opsional)</p>
            <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-[10px] bg-surface-2 p-3 sm:grid-cols-3">
              {data.providerLogos.map((logo) => {
                const selected = form.providerLogos.includes(logo);
                return <button type="button" key={logo} onClick={() => toggleLogo(logo)} className={`flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition-colors ${selected ? "border-brand-500 bg-brand-500/10" : "border-transparent hover:bg-surface-3"}`}>
                  <ProviderIcon providerId={logo} size={28} alt="" />
                  <span className="truncate text-text-main">{logo}</span>
                </button>;
              })}
            </div>
          </div>
        </form>
      </Modal>
      <ConfirmModal isOpen={!!resetting} onClose={() => setResetting(null)} onConfirm={resetQuota} loading={saving} title="Reset Quota" message={`Reset quota untuk “${resetting?.name || ""}”? Nilai token terpakai akan kembali menjadi 0.`} confirmText="Reset Quota" variant="primary" />
      <ConfirmModal isOpen={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} loading={saving} title="Hapus API Key Limit" message={`Hapus limit “${deleting?.name || ""}”? Aksi ini tidak dapat dibatalkan.`} confirmText="Hapus" />
    </div>
  );
}
