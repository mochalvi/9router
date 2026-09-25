import Image from "next/image";
import { getApiKeyLimitBySlug, getApiKeyLimitPublicData } from "@/lib/apiKeyLimits/index.js";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const limit = await getApiKeyLimitBySlug(slug);
  return {
    title: `Token Access - ${limit?.name || "Limit"}`,
    icons: null,
  };
}

function formatTokens(value) {
  if (value === null) return "Unlimited";
  return new Intl.NumberFormat("id-ID").format(value);
}

export default async function PublicLimitPage({ params }) {
  const { slug } = await params;
  const limit = getApiKeyLimitPublicData(await getApiKeyLimitBySlug(slug));
  if (!limit) {
    return (
      <main style={styles.page}>
        <section style={styles.card}>
          <h1 style={styles.title}>Limit tidak ditemukan</h1>
          <p style={styles.muted}>URL ini mungkin sudah tidak tersedia.</p>
        </section>
      </main>
    );
  }

  const percentage = Math.round(limit.percentage);
  const progressColor = percentage <= 30 ? "#ef4444" : percentage <= 60 ? "#eab308" : "#16a34a";
  const blocked = !limit.allowed;

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.header}>
          {(limit.providerLogos || (limit.providerLogo ? [limit.providerLogo] : [])).map((logo) => (
            <Image key={logo} src={`/providers/${logo}.png`} alt="Provider" width={48} height={48} style={styles.logo} />
          ))}
          <div>
            <p style={styles.eyebrow}>TOKEN ACCESS</p>
            <h1 style={styles.title}>{limit.name}</h1>
          </div>
        </div>
        <div style={styles.percentRow}>
          <span style={{ ...styles.percent, color: progressColor }}>{percentage}%</span>
          <span style={styles.remaining}>sisa token</span>
        </div>
        <div style={styles.track} aria-label="Status token">

          <div style={{ ...styles.bar, width: `${percentage}%`, background: progressColor }} />
        </div>
        {limit.models?.length > 1 ? <div style={styles.models}>
          <span style={styles.label}>Models</span>
          <div style={styles.modelList}>{limit.models.map((model) => <code key={model} style={styles.model}>{model}</code>)}</div>
        </div> : null}
        {limit.showQuota ? <div style={styles.stats}>
          <div><span style={styles.label}>Sisa</span><strong>{formatTokens(limit.remainingTokens)}</strong></div>
          <div><span style={styles.label}>Terpakai</span><strong>{formatTokens(limit.usedTokens)}</strong></div>
          <div><span style={styles.label}>Quota</span><strong>{formatTokens(limit.quotaTokens)}</strong></div>
        </div> : null}
        {limit.resetCountdown ? <p style={styles.muted}>Token direset dalam {limit.resetCountdown}</p> : null}
        {blocked ? <p style={styles.warning}>Layanan sedang tidak tersedia.</p> : null}
        {limit.expiredAt ? <p style={styles.muted}>Berlaku sampai {limit.formattedExpiredAt || limit.expiredAt}</p> : null}
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "#eef2f6",
    color: "#172033",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  },
  card: {
    width: "min(100%, 480px)",
    padding: "36px 34px",
    borderRadius: 24,
    background: "#ffffff",
    boxShadow: "0 24px 70px rgba(31, 51, 73, .14)",
  },
  header: { display: "flex", alignItems: "center", gap: 16, marginBottom: 36 },
  logo: { width: 48, height: 48, objectFit: "contain", borderRadius: 12 },
  eyebrow: { margin: 0, color: "#718096", fontSize: 11, letterSpacing: ".16em", fontWeight: 700 },
  title: { margin: "6px 0 0", fontSize: 25, lineHeight: 1.15, fontWeight: 750 },
  percentRow: { display: "flex", alignItems: "baseline", gap: 10 },
  percent: { fontSize: 72, lineHeight: 1, letterSpacing: "-.06em", fontWeight: 800 },
  remaining: { color: "#718096", fontSize: 15 },
  track: { height: 12, marginTop: 22, borderRadius: 999, background: "#e5eaf0", overflow: "hidden" },
  bar: { height: "100%", borderRadius: 999, transition: "width .3s ease" },
  models: { marginTop: 26 },
  modelList: { display: "flex", flexWrap: "wrap", gap: 6 },
  model: { padding: "5px 8px", borderRadius: 8, background: "#eef2f6", color: "#536174", fontSize: 11 },
  stats: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 30 },
  label: { display: "block", marginBottom: 5, color: "#8a96a8", fontSize: 12 },
  warning: { margin: "24px 0 0", padding: "11px 13px", borderRadius: 10, background: "#fff1f2", color: "#be123c", fontSize: 13, fontWeight: 650 },
  muted: { margin: "24px 0 0", color: "#718096", fontSize: 13 },
};
