import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { io } from "socket.io-client";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Command,
  CreditCard,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Filter,
  Gavel,
  History,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Eye,
  EyeOff,
  Phone,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  UploadCloud,
  UserRound,
  Users,
  WalletCards,
  X,
  Zap,
  Trophy,
  Medal,
  Crown
} from "lucide-react";
import type {
  Claim,
  ClaimStatus,
  DashboardPayload,
  Dispute,
  LeaderboardEntry,
  PaymentAccount,
  PaymentScheduleEntry,
  ScheduleImportPreview,
  Ticket,
  TicketPriority,
  TicketStatus,
  User
} from "@asasu/shared";
import { apiRequest, downloadFile, uploadFile } from "./lib/api";
import { currency, dateTime, number, titleCase } from "./lib/format";
import { useSession } from "./hooks/useSession";

type ViewId = "overview" | "claim" | "claims" | "schedules" | "disputes" | "payments" | "support" | "leaderboard" | "people" | "audit";

type LocalSchedulePreview = {
  fileName: string;
  headerRowIndex: number;
  detectedFields: {
    branch?: string;
    paymentDate?: string;
    clientName?: string;
    accountNumber?: string;
    rsaAmount?: string;
  };
  detectedColumns: string[];
  warnings: string[];
  sampleRows: Array<Record<string, string>>;
};

// demo accounts removed to enforce real server authentication

const staffRoles = new Set(["SUPER_ADMIN", "ADMIN", "FINANCE", "OPERATIONS", "AUDITOR", "SUPPORT", "BRANCH_ADMIN"]);
const pendingStatuses: ClaimStatus[] = ["PENDING_VERIFICATION", "NEEDS_REVIEW", "INFO_REQUESTED", "PARTIALLY_APPROVED"];

function isStaff(user: User) {
  return staffRoles.has(user.role);
}

function dateOnly(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NG", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function shortCurrency(value = 0) {
  if (value >= 1_000_000_000) return `₦${(value / 1_000_000_000).toFixed(1)}b`;
  if (value >= 1_000_000) return `₦${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `₦${(value / 1_000).toFixed(0)}k`;
  return currency(value);
}

function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return <span className={`brand-mark ${inverse ? "brand-mark-inverse" : ""}`}><img src="/asasu-realty-official-logo.jpeg" alt="" /></span>;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findHeaderColumn(headerRow: string[], targets: string[]) {
  const learned = headerRow.map(normalizeHeader);
  const exactMatch = targets.map(normalizeHeader);
  for (const target of exactMatch) {
    const index = learned.findIndex((cell) => cell === target);
    if (index >= 0) return index;
  }
  for (const target of exactMatch) {
    const index = learned.findIndex((cell) => cell.includes(target) || (cell.length >= 3 && target.includes(cell)));
    if (index >= 0) return index;
  }
  return -1;
}

function findHeaderRowIndex(rows: string[][]) {
  const targetKeywords = [
    "acct no",
    "acct number",
    "account no",
    "account number",
    "account",
    "acct name",
    "client name",
    "client",
    "customer name",
    "customer",
    "applicant",
    "beneficiary",
    "rsa amount",
    "rsa amt",
    "rsa",
    "amount",
    "principal",
    "paid",
    "value",
    "net",
    "1% serv",
    "2% serv",
    "3% serv"
  ].map(normalizeHeader);

  const scores = rows.map((row) => {
    const normalized = row.map(normalizeHeader);
    return normalized.reduce((count, cell) => count + targetKeywords.filter((keyword) => cell.includes(keyword) || (cell.length >= 3 && keyword.includes(cell))).length, 0);
  });

  const bestIndex = scores.reduce((best, score, index) => {
    if (score > best.score) return { index, score };
    return best;
  }, { index: -1, score: 0 });

  if (bestIndex.score >= 1) return bestIndex.index;
  return rows.length > 0 ? 0 : -1;
}

let xlsxLoader: Promise<any> | null = null;

async function loadXlsx(): Promise<any> {
  if (typeof window === "undefined") {
    throw new Error("Excel parsing is only supported in the browser.");
  }
  if ((window as any).XLSX) {
    return (window as any).XLSX;
  }
  if (xlsxLoader) {
    return xlsxLoader;
  }

  const urls = [
    "https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js",
    "https://unpkg.com/xlsx/dist/xlsx.full.min.js"
  ];
  const existing = document.querySelector<HTMLScriptElement>("script[data-xlsx-loader]");
  if (existing && !(window as any).XLSX) {
    existing.remove();
  }

  xlsxLoader = new Promise((resolve, reject) => {
    const attemptLoad = (index: number) => {
      if (index >= urls.length) {
        reject(new Error("Unable to load Excel parser library."));
        return;
      }

      const script = document.createElement("script");
      script.src = urls[index] as string;
      script.async = true;
      script.dataset.xlsxLoader = "true";
      script.onload = () => {
        if ((window as any).XLSX) {
          resolve((window as any).XLSX);
        } else {
          if (index + 1 < urls.length) {
            script.remove();
            attemptLoad(index + 1);
          } else {
            reject(new Error("Failed to initialize XLSX library."));
          }
        }
      };
      script.onerror = () => {
        script.remove();
        attemptLoad(index + 1);
      };
      document.head.appendChild(script);
    };

    attemptLoad(0);
  });

  return xlsxLoader;
}

async function parseWorkbook(file: File): Promise<LocalSchedulePreview> {
  const XLSX: any = await loadXlsx();
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: true, dateNF: "yyyy-mm-dd" });
  if (!workbook.SheetNames?.length) {
    throw new Error("Spreadsheet does not contain any sheets.");
  }
  const sheet = workbook.Sheets?.[workbook.SheetNames[0]];
  if (!sheet) {
    throw new Error("Unable to read the first worksheet.");
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as any[][];
  if (!rows.length) {
    throw new Error("Spreadsheet is empty.");
  }

  const normalized = rows.map((row: any[] = []) => Array.isArray(row) ? row.map((cell: any) => String(cell ?? "").trim()) : []);
  const headerRowIndex = findHeaderRowIndex(normalized);
  if (headerRowIndex < 0) {
    throw new Error("No header row found in the spreadsheet.");
  }

  const headerRow = normalized[headerRowIndex] ?? [];
  const detectedColumns = headerRow.filter(Boolean).map((cell: string) => String(cell).trim());
  const branchCol = findHeaderColumn(headerRow, ["branch", "office", "location", "region"]);
  const dateCol = findHeaderColumn(headerRow, ["payment date", "paymentdate", "date", "due date", "settlement date", "pay date"]);
  const clientNameCol = findHeaderColumn(headerRow, ["client name", "customer name", "name", "borrower"]);
  const accountNumberCol = findHeaderColumn(headerRow, ["account number", "account no", "acct number", "acct no", "account"]);
  const rsaAmountCol = findHeaderColumn(headerRow, ["rsa amount", "rsa", "amount", "rsa value", "value", "committed amount"]);

  const sampleRows: Array<Record<string, string>> = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < Math.min(normalized.length, headerRowIndex + 7); rowIndex += 1) {
    const row = normalized[rowIndex] ?? [];
    if (!Array.isArray(row) || row.every((cell) => !cell)) continue;
    sampleRows.push({
      Branch: branchCol >= 0 ? String(row[branchCol] ?? "") : "",
      Date: dateCol >= 0 ? String(row[dateCol] ?? "") : "",
      "Client name": clientNameCol >= 0 ? String(row[clientNameCol] ?? "") : "",
      "Account number": accountNumberCol >= 0 ? String(row[accountNumberCol] ?? "") : "",
      "RSA amount": rsaAmountCol >= 0 ? String(row[rsaAmountCol] ?? "") : "",
    });
  }

  const warnings: string[] = [];
  if (branchCol < 0) warnings.push("Could not detect a branch column.");
  if (dateCol < 0) warnings.push("Could not detect a payment date column.");
  if (clientNameCol < 0) warnings.push("Could not detect a client name column.");
  if (accountNumberCol < 0) warnings.push("Could not detect an account number column.");
  if (rsaAmountCol < 0) warnings.push("Could not detect an RSA amount column.");
  if (!sampleRows.length) warnings.push("No data rows were found after the header row.");

  return {
    fileName: file.name,
    headerRowIndex,
    detectedFields: {
      branch: branchCol >= 0 ? headerRow[branchCol] : undefined,
      paymentDate: dateCol >= 0 ? headerRow[dateCol] : undefined,
      clientName: clientNameCol >= 0 ? headerRow[clientNameCol] : undefined,
      accountNumber: accountNumberCol >= 0 ? headerRow[accountNumberCol] : undefined,
      rsaAmount: rsaAmountCol >= 0 ? headerRow[rsaAmountCol] : undefined,
    },
    detectedColumns,
    warnings,
    sampleRows,
  };
}

export default function App() {
  const { user, hydrated, restore } = useSession();
  useEffect(() => restore(), [restore]);

  if (!hydrated) {
    return (
      <div className="boot-screen">
        <BrandMark />
        <span className="boot-pulse" />
      </div>
    );
  }
  return user ? <Portal /> : <LoginScreen />;
}

function LoginScreen() {
  const login = useSession((state) => state.login);
  const register = useSession((state) => state.register);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [agency, setAgency] = useState("");
  const [branch, setBranch] = useState("");
  const [accountRole, setAccountRole] = useState<"AGENT" | "SUB_DEVELOPER">("AGENT");
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    try {
      await login(trimmedEmail, trimmedPassword);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }

  async function submitRegister(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    const trimmedName = name.trim();
    const trimmedAgency = agency.trim();
    const trimmedBranch = branch.trim();
    try {
      await register(trimmedName, trimmedEmail, trimmedPassword, trimmedAgency, trimmedBranch, accountRole);
      setSuccess("Account created successfully. You are now signed in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create account");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="aurora aurora-one" />
        <div className="aurora aurora-two" />
        <header className="login-wordmark">
          <BrandMark inverse />
          <div><strong>ASASU</strong><small>Commission OS</small></div>
        </header>
        <div className="login-copy">
          <span className="hero-pill"><Sparkles size={13} /> The operating system for commission</span>
          <h1>From paid client<br />to paid partner.</h1>
          <p>One trusted workflow for schedules, claims, verification, disputes, and payouts—built for the pace of modern real estate.</p>
        </div>
        <div className="login-product-preview">
          <div className="preview-topline">
            <span><i /> Live operations</span>
            <small>20 Jul 2026</small>
          </div>
          <div className="preview-kpis">
            <div><small>Claims verified</small><strong>—</strong><span>Real data after login</span></div>
            <div><small>Commission cleared</small><strong>—</strong><span>Real data after login</span></div>
          </div>
          <div className="preview-flow">
            <span className="flow-step done"><Check size={13} /> Schedule</span><i />
            <span className="flow-step done"><Check size={13} /> Match</span><i />
            <span className="flow-step active"><Zap size={13} /> Verify</span><i />
            <span className="flow-step"><Banknote size={13} /> Pay</span>
          </div>
        </div>
        <footer className="login-trust"><ShieldCheck size={15} /> Role-based controls · Immutable audit trail · Duplicate protection</footer>
      </section>

      <section className="login-access">
        <div className="login-card">
          <div className="mobile-wordmark login-wordmark">
            <BrandMark />
            <div><strong>ASASU</strong><small>Commission OS</small></div>
          </div>
          <div className="login-card-heading">
            <span className="eyebrow">Secure workspace</span>
            <h2>{mode === "login" ? "Welcome back" : "Create your account"}</h2>
            <p>{mode === "login" ? "Use your ASASU partner or operations account." : "Create an agent or sub-developer account to start submitting claims."}</p>
          </div>
          <div className="login-mode-switch">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); setSuccess(""); }}>Sign in</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); setSuccess(""); }}>Create account</button>
          </div>
          {mode === "login" ? (
            <form onSubmit={submit}>
              <label className="field-label">
                <span>Work email</span>
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
              <label className="field-label">
                <span>Password</span>
                <span className="input-with-action">
                  <input type={visible ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
                  <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible((value) => !value)}>{visible ? <Moon size={17} /> : <Sun size={17} />}</button>
                </span>
              </label>
              <div className="login-options"><label><input type="checkbox" defaultChecked /> Keep me signed in</label><button type="button">Forgot password?</button></div>
              {error ? <div className="form-error"><CircleAlert size={15} /> {error}</div> : null}
              {success ? <div className="form-success"><CheckCircle2 size={15} /> {success}</div> : null}
              <button className="button button-primary login-button" type="submit" disabled={loading}>
                {loading ? <Loader2 className="spin" size={17} /> : <LockKeyhole size={17} />}
                {loading ? "Verifying…" : "Enter workspace"}
              </button>
            </form>
          ) : (
            <form onSubmit={submitRegister}>
              <label className="field-label">
                <span>Full name</span>
                <input type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
              <label className="field-label">
                <span>Work email</span>
                <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </label>
              <label className="field-label">
                <span>Password</span>
                <span className="input-with-action">
                  <input type={visible ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
                  <button type="button" aria-label={visible ? "Hide password" : "Show password"} onClick={() => setVisible((value) => !value)}>{visible ? <Moon size={17} /> : <Sun size={17} />}</button>
                </span>
              </label>
              <label className="field-label">
                <span>Agency</span>
                <input type="text" autoComplete="organization" value={agency} onChange={(event) => setAgency(event.target.value)} required />
              </label>
              <label className="field-label">
                <span>Branch <em>(optional)</em></span>
                <input type="text" value={branch} onChange={(event) => setBranch(event.target.value)} />
              </label>
              <label className="field-label">
                <span>Account type</span>
                <div className="role-option-grid">
                  <button type="button" className={`role-option ${accountRole === "AGENT" ? "active" : ""}`} onClick={() => setAccountRole("AGENT")}>
                    <UserRound size={15} />
                    <span>Agent</span>
                  </button>
                  <button type="button" className={`role-option ${accountRole === "SUB_DEVELOPER" ? "active" : ""}`} onClick={() => setAccountRole("SUB_DEVELOPER")}>
                    <Building2 size={15} />
                    <span>Sub-developer</span>
                  </button>
                </div>
              </label>
              {error ? <div className="form-error"><CircleAlert size={15} /> {error}</div> : null}
              {success ? <div className="form-success"><CheckCircle2 size={15} /> {success}</div> : null}
              <button className="button button-primary login-button" type="submit" disabled={loading}>
                {loading ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
                {loading ? "Creating account…" : "Create account"}
              </button>
            </form>
          )}
          <p className="login-security"><ShieldCheck size={13} /> Protected by encrypted, role-based access</p>
        </div>
      </section>
    </main>
  );
}

function Portal() {
  const { user, token, logout } = useSession();
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [dark, setDark] = useState(localStorage.getItem("asasu-theme") === "dark");
  const [error, setError] = useState("");

  async function refresh() {
    if (!token) return;
    try {
      const data = await apiRequest<DashboardPayload>(token, "/dashboard");
      if (Array.isArray(data.claims)) data.claims.forEach((c) => { c.items = c.items || []; });
      if (Array.isArray(data.tickets)) data.tickets.forEach((t) => { t.replies = t.replies || []; });
      setPayload(data);
      setError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to load the workspace";
      const lower = msg.toLowerCase();
      if (lower.includes('access denied') || lower.includes('invalid token') || lower.includes('no token') || lower.includes('unauthorized')) {
        // token is invalid or session expired — force logout to show login screen
        logout();
        return;
      }
      setError(msg);
    }
  }

  useEffect(() => void refresh(), [token]);
  useEffect(() => {
    if (!user) return;
    const socket = io("/", { auth: { userId: user.id }, path: "/socket.io" });
    socket.on("notification", refresh);
    return () => {
      socket.disconnect();
    };
  }, [user?.id, token]);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("asasu-theme", dark ? "dark" : "light");
  }, [dark]);

  if (!user || !token) return null;
  const staff = isStaff(user);
  const navigation: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard; badge?: number }> = staff
    ? [
      { id: "overview", label: "Command center", icon: LayoutDashboard },
      { id: "claims", label: "Claim queue", icon: FileCheck2, badge: payload?.metrics.totalClaimsPending },
      { id: "schedules", label: "Schedules", icon: FileSpreadsheet },
      { id: "disputes", label: "Disputes", icon: Gavel, badge: payload?.metrics.openDisputes },
      { id: "payments", label: "Payments", icon: CreditCard },
      { id: "support", label: "Support tickets", icon: LifeBuoy, badge: payload?.tickets.filter((ticket) => ticket.status !== "RESOLVED").length },
      { id: "people", label: "People", icon: Users },
      { id: "audit", label: "Audit trail", icon: History },
      { id: "leaderboard", label: "Leaderboard", icon: Trophy }
    ]
    : [
      { id: "overview", label: "Home", icon: LayoutDashboard },
      { id: "claim", label: "Quick claim", icon: Zap, badge: payload?.metrics.availableClients },
      { id: "claims", label: "My claims", icon: ReceiptText },
      { id: "schedules", label: "Schedules", icon: FileSpreadsheet },
      { id: "disputes", label: "Disputes", icon: Gavel },
      { id: "payments", label: "Payment history", icon: WalletCards },
      { id: "support", label: "Support center", icon: LifeBuoy, badge: payload?.tickets.filter((ticket) => ticket.status !== "RESOLVED").length },
      { id: "leaderboard", label: "Leaderboard", icon: Trophy }
    ];

  const unread = payload?.notifications.filter((item) => !item.read).length ?? 0;
  function navigate(view: ViewId) {
    setActiveView(view);
    setSidebarOpen(false);
  }

  async function markNotification(id: string) {
    await apiRequest<void>(token, `/notifications/${id}/read`, { method: "PATCH" });
    await refresh();
  }

  return (
    <div className="app-shell">
      {sidebarOpen ? <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <BrandMark inverse />
          <div><strong>ASASU</strong><small>Commission OS</small></div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace-switcher">
          <span className="workspace-avatar">AR</span>
          <div><strong>ASASU Realty Ltd</strong><small>{user.branch ?? user.agency}</small></div>
          <ChevronDown size={15} />
        </div>
        <span className="nav-label">Workspace</span>
        <nav className="primary-nav">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => navigate(item.id)}>
                <Icon size={17} /><span>{item.label}</span>{item.badge ? <em>{item.badge}</em> : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-insight">
          <span><Sparkles size={14} /> Smart control</span>
          <strong>{staff ? "Risk scan is active" : "Duplicate lock is on"}</strong>
          <p>{staff ? "Every submitted row is matched to its source schedule." : "A client can only belong to one active claim."}</p>
        </div>
        <div className="sidebar-user">
          <span className="user-avatar">{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
          <div><strong>{user.name}</strong><small>{titleCase(user.role)}</small></div>
          <button onClick={() => logout()} title="Sign out"><LogOut size={17} /></button>
        </div>
      </aside>

      <main className="main-workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
            <div><span className="topbar-kicker">{staff ? "Operations workspace" : "Partner workspace"}</span><h1>{viewTitle(activeView, staff)}</h1></div>
          </div>
          <div className="topbar-actions">
            <button className="command-search"><Search size={15} /><span>Search anything</span><kbd>⌘ K</kbd></button>
            <button className="icon-button" aria-label="Toggle color theme" onClick={() => setDark((value) => !value)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <div className="notification-wrap">
              <button className="icon-button" aria-label="Notifications" onClick={() => setNotificationsOpen((value) => !value)}><Bell size={17} />{unread ? <i>{unread}</i> : null}</button>
              {notificationsOpen ? (
                <div className="notification-popover">
                  <div className="popover-heading"><div><strong>Notifications</strong><small>{unread} unread</small></div><button onClick={() => setNotificationsOpen(false)}><X size={16} /></button></div>
                  <div className="notification-list">
                    {payload?.notifications.slice(0, 8).map((item) => (
                      <button key={item.id} className={item.read ? "" : "unread"} onClick={() => void markNotification(item.id)}>
                        <span><Bell size={14} /></span><div><strong>{item.title}</strong><p>{item.body}</p><small>{dateTime(item.createdAt)}</small></div>
                      </button>
                    ))}
                    {!payload?.notifications.length ? <div className="mini-empty">You’re all caught up.</div> : null}
                  </div>
                </div>
              ) : null}
            </div>
            <span className="topbar-avatar">{user.name?.charAt(0) ?? "?"}</span>
          </div>
        </header>

        <div className="workspace-content">
          {error ? <div className="global-alert"><CircleAlert size={16} />{error}<button onClick={refresh}><RefreshCw size={14} /> Retry</button></div> : null}
          {!payload ? (
            <LoadingWorkspace />
          ) : (
            <ViewRouter activeView={activeView} payload={payload} token={token} refresh={refresh} navigate={navigate} />
          )}
        </div>
      </main>

      <nav className="mobile-tabs">
        {navigation.slice(0, 5).map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={activeView === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={19} /><span>{item.label.split(" ")[0]}</span></button>;
        })}
      </nav>
    </div>
  );
}

function viewTitle(view: ViewId, staff: boolean) {
  const titles: Record<ViewId, string> = {
    overview: staff ? "Command center" : "Good morning",
    claim: "Quick claim",
    claims: staff ? "Claim queue" : "My claims",
    schedules: "Payment schedules",
    disputes: "Dispute center",
    payments: staff ? "Payment operations" : "Payment history",
    support: staff ? "Support tickets" : "Support center",
    leaderboard: "Quarterly leaderboard",
    people: "People & access",
    audit: "Audit trail"
  };
  return titles[view];
}

function ViewRouter({ activeView, payload, token, refresh, navigate }: { activeView: ViewId; payload: DashboardPayload; token: string; refresh: () => Promise<void>; navigate: (view: ViewId) => void }) {
  const staff = isStaff(payload.user);
  if (activeView === "overview") return staff ? <AdminOverview payload={payload} navigate={navigate} /> : <AgentOverview payload={payload} navigate={navigate} />;
  if (activeView === "claim") return <ClaimWorkspace payload={payload} token={token} refresh={refresh} />;
  if (activeView === "claims") return <ClaimsPanel payload={payload} token={token} refresh={refresh} />;
  if (activeView === "schedules") return <SchedulesPanel payload={payload} token={token} refresh={refresh} navigate={navigate} />;
  if (activeView === "disputes") return <DisputesPanel payload={payload} token={token} refresh={refresh} />;
  if (activeView === "payments") return <PaymentsPanel payload={payload} token={token} refresh={refresh} />;
  if (activeView === "support") return <SupportPanel payload={payload} token={token} refresh={refresh} />;
  if (activeView === "leaderboard") return <LeaderboardPanel payload={payload} />;
  if (activeView === "people") return <PeoplePanel payload={payload} />;
  if (activeView === "audit") return <AuditPanel payload={payload} />;
  return null;
}

function LoadingWorkspace() {
  return <div className="loading-workspace"><div className="skeleton skeleton-hero" /><div className="skeleton-grid">{[1, 2, 3, 4].map((item) => <div className="skeleton" key={item} />)}</div><div className="skeleton skeleton-table" /></div>;
}

function LeaderboardPanel({ payload }: { payload: DashboardPayload }) {
  const leaderboards = payload.leaderboards ?? [];
  const [group, setGroup] = useState<"AGENT" | "SUB_DEVELOPER">(payload.user.role === "SUB_DEVELOPER" ? "SUB_DEVELOPER" : "AGENT");
  const [periodKey, setPeriodKey] = useState(leaderboards[0]?.key ?? "");
  const period = leaderboards.find((item) => item.key === periodKey) ?? leaderboards[0];
  const entries = period ? (group === "AGENT" ? period.agents : period.subDevelopers) : [];
  const leader = entries[0];
  const currentPartner = entries.find((entry) => entry.userId === payload.user.id);
  const activePartners = entries.filter((entry) => entry.approvedClients > 0).length;
  const totalVerified = entries.reduce((sum, entry) => sum + entry.verifiedSalesVolume, 0);
  const groupLabel = group === "AGENT" ? "Agents" : "Sub-developers";

  return (
    <div className="page-stack leaderboard-page">
      <section className="leaderboard-hero">
        <div className="leaderboard-hero-copy">
          <span className="hero-pill hero-pill-light"><Trophy size={13} /> Quarterly recognition</span>
          <h2>Performance worth celebrating.</h2>
          <p>Track verified results throughout the quarter and recognize the partners creating the strongest impact for ASASU Realty.</p>
          <div className="leaderboard-rule"><Medal size={15} /><span>Ranked by verified sales volume, then approved clients and paid commission.</span></div>
        </div>
        <div className="leaderboard-hero-side">
          <label>
            <span>Award period</span>
            <select value={period?.key ?? ""} onChange={(event) => setPeriodKey(event.target.value)}>
              {leaderboards.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <div className="leaderboard-leading">
            <span>{groupLabel} leader · {period?.label}</span>
            {leader ? (
              <div>
                <span className="leader-avatar">{initials(leader.name)}<Crown size={15} /></span>
                <div><strong>{leader.name}</strong><small>{leader.branch ?? leader.agency}</small></div>
                <strong>{shortCurrency(leader.verifiedSalesVolume)}</strong>
              </div>
            ) : <p>Rankings will appear as verified claims are completed.</p>}
          </div>
        </div>
      </section>

      <div className="leaderboard-category-switch" role="tablist" aria-label="Leaderboard category">
        <button role="tab" aria-selected={group === "AGENT"} className={group === "AGENT" ? "active" : ""} onClick={() => setGroup("AGENT")}>
          <UserRound size={18} /><span><strong>Agent leaderboard</strong><small>{period?.agents.length ?? 0} registered agents</small></span>
        </button>
        <button role="tab" aria-selected={group === "SUB_DEVELOPER"} className={group === "SUB_DEVELOPER" ? "active" : ""} onClick={() => setGroup("SUB_DEVELOPER")}>
          <Building2 size={18} /><span><strong>Sub-developer leaderboard</strong><small>{period?.subDevelopers.length ?? 0} registered sub-developers</small></span>
        </button>
      </div>

      <section className="leaderboard-stats">
        <div><span className="leaderboard-stat-icon violet"><Trophy size={18} /></span><div><small>Verified sales</small><strong>{shortCurrency(totalVerified)}</strong><span>{period?.label} total</span></div></div>
        <div><span className="leaderboard-stat-icon green"><BadgeCheck size={18} /></span><div><small>Active contenders</small><strong>{number(activePartners)}</strong><span>With verified clients</span></div></div>
        <div><span className="leaderboard-stat-icon amber"><Crown size={18} /></span><div><small>{isStaff(payload.user) ? "Recognition view" : "Your standing"}</small><strong>{isStaff(payload.user) ? "Admin" : currentPartner ? `#${currentPartner.rank}` : "—"}</strong><span>{isStaff(payload.user) ? "All partner performance is visible" : currentPartner ? `${currentPartner.approvedClients} verified clients` : `Switch to your ${payload.user.role === "SUB_DEVELOPER" ? "sub-developer" : "agent"} category`}</span></div></div>
      </section>

      <section className="panel leaderboard-panel">
        <PanelHeading
          eyebrow={`${period?.label ?? "Current quarter"} awards`}
          title={`${groupLabel} rankings`}
          aside={<span className="soft-chip"><Trophy size={13} /> Top performers</span>}
        />
        {entries.length ? (
          <>
            <div className={`leaderboard-podium podium-count-${Math.min(entries.length, 3)}`}>
              {entries.slice(0, 3).map((entry) => <PodiumCard key={entry.userId} entry={entry} currentUserId={payload.user.id} />)}
            </div>
            <div className="leaderboard-table-wrap">
              <table className="leaderboard-table">
                <thead><tr><th>Rank</th><th>Partner</th><th className="numeric">Verified sales</th><th className="numeric">Clients</th><th className="numeric">Claims</th><th className="numeric">Commission earned</th><th className="numeric">Paid</th></tr></thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.userId} className={entry.userId === payload.user.id ? "current-partner" : ""}>
                      <td><span className={`rank-chip rank-${entry.rank}`}>{entry.rank <= 3 ? <Medal size={14} /> : null}#{entry.rank}</span></td>
                      <td><div className="leaderboard-person"><span>{initials(entry.name)}</span><div><strong>{entry.name}{entry.userId === payload.user.id ? <em>You</em> : null}</strong><small>{entry.branch ?? entry.agency}</small></div></div></td>
                      <td className="numeric"><strong>{currency(entry.verifiedSalesVolume)}</strong></td>
                      <td className="numeric">{number(entry.approvedClients)}</td>
                      <td className="numeric">{number(entry.approvedClaims)}</td>
                      <td className="numeric">{currency(entry.commissionEarned)}</td>
                      <td className="numeric"><span className={entry.commissionPaid ? "paid-value" : ""}>{currency(entry.commissionPaid)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <EmptyState icon={Trophy} title={`No ${groupLabel.toLowerCase()} yet`} copy="The leaderboard will populate automatically when partners join this category." />}
      </section>
    </div>
  );
}

function PodiumCard({ entry, currentUserId }: { entry: LeaderboardEntry; currentUserId: string }) {
  return (
    <article className={`podium-card podium-place-${entry.rank}${entry.userId === currentUserId ? " is-you" : ""}`}>
      <span className="podium-rank">{entry.rank === 1 ? <Crown size={18} /> : <Medal size={18} />}#{entry.rank}</span>
      <span className="podium-avatar">{initials(entry.name)}</span>
      <div><h3>{entry.name}</h3><p>{entry.branch ?? entry.agency}</p></div>
      <strong>{shortCurrency(entry.verifiedSalesVolume)}</strong>
      <small>verified sales</small>
      <div className="podium-metrics"><span><strong>{number(entry.approvedClients)}</strong> clients</span><span><strong>{shortCurrency(entry.commissionEarned)}</strong> earned</span></div>
    </article>
  );
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function AgentOverview({ payload, navigate }: { payload: DashboardPayload; navigate: (view: ViewId) => void }) {
  const schedule = payload.schedule;
  const firstName = payload.user.name.split(" ")[0];
  return (
    <div className="page-stack">
      <section className="welcome-panel agent-welcome">
        <div className="welcome-copy">
          <span className="hero-pill hero-pill-light"><Zap size={13} /> New schedule ready</span>
          <h2>Good morning, {firstName}.</h2>
          <p>{schedule ? `${schedule.branch} · ${dateOnly(schedule.paymentDate)} is live with ${number(payload.metrics.availableClients)} available clients.` : "We’ll let you know as soon as a new payment schedule is published."}</p>
          <div className="hero-actions"><button className="button button-light" onClick={() => navigate("claim")}>Find my clients <ArrowRight size={16} /></button><button className="button button-ghost-light" onClick={() => navigate("schedules")}>View schedule</button></div>
        </div>
        <div className="claim-speed-card">
          <span>Fast-track claim</span>
          <strong>&lt; 30 sec</strong>
          <div className="speed-steps"><i className="done" /><i className="done" /><i /></div>
          <small>Search · Select · Submit</small>
        </div>
      </section>

      <section className="metric-grid metric-grid-four">
        <MetricCard label="Total earned" value={shortCurrency(payload.metrics.totalCommissionEarned)} icon={WalletCards} tone="violet" trend="All-time commission" />
        <MetricCard label="Awaiting review" value={number(payload.metrics.pendingClaims)} icon={Clock3} tone="amber" trend="Claims in progress" />
        <MetricCard label="Approved claims" value={number(payload.metrics.approvedClaims)} icon={BadgeCheck} tone="green" trend="Verified by operations" />
        <MetricCard label="Total paid" value={shortCurrency(payload.metrics.totalPaid)} icon={Banknote} tone="blue" trend="Settled to date" />
      </section>

      <section className="dashboard-grid dashboard-grid-wide">
        <div className="panel chart-panel">
          <PanelHeading eyebrow="Performance" title="Commission trend" aside={<span className="soft-chip">Last 6 months</span>} />
          <TrendChart payload={payload} />
        </div>
        <div className="panel activity-panel">
          <PanelHeading eyebrow="Updates" title="Recent activity" aside={<button className="text-button">View all</button>} />
          <ActivityFeed payload={payload} />
        </div>
      </section>

      <section className="panel latest-schedule-panel">
        <PanelHeading eyebrow="Ready to claim" title="Latest payment schedule" aside={<button className="button button-secondary button-small" onClick={() => navigate("claim")}>Open schedule <ArrowRight size={14} /></button>} />
        {schedule ? <ScheduleSummary schedule={schedule} /> : <EmptyState icon={FileSpreadsheet} title="No published schedule" copy="Published schedules will appear here automatically." />}
      </section>
    </div>
  );
}

function AdminOverview({ payload, navigate }: { payload: DashboardPayload; navigate: (view: ViewId) => void }) {
  const pending = payload.claims.filter((claim) => pendingStatuses.includes(claim.status));
  return (
    <div className="page-stack">
      <section className="operations-ribbon">
        <div><span className="status-live"><i /> Operations live</span><h2>Financial control, without the spreadsheet drag.</h2><p>Monitor every schedule row from publication to payout.</p></div>
        <div className="ribbon-actions"><button className="button button-secondary" onClick={() => navigate("schedules")}><UploadCloud size={16} /> Upload schedule</button><button className="button button-primary" onClick={() => navigate("claims")}>Review queue <ArrowRight size={16} /></button></div>
      </section>
      <section className="metric-grid metric-grid-admin">
        <MetricCard label="Pending claims" value={number(payload.metrics.totalClaimsPending)} icon={Clock3} tone="amber" trend="Needs operations" />
        <MetricCard label="Paid today" value={shortCurrency(payload.metrics.paidToday)} icon={Banknote} tone="green" trend="Settled today" />
        <MetricCard label="Open disputes" value={number(payload.metrics.openDisputes)} icon={Gavel} tone="red" trend="Ownership review" />
        <MetricCard label="Total commission" value={shortCurrency(payload.metrics.totalCommissionEarned)} icon={WalletCards} tone="violet" trend="All submitted" />
        <MetricCard label="Schedules" value={number(payload.metrics.schedulesUploaded)} icon={FileSpreadsheet} tone="blue" trend="Published & archived" />
        <MetricCard label="Approval time" value={`${payload.metrics.averageApprovalHours ?? 0}h`} icon={Zap} tone="slate" trend="Average turnaround" />
      </section>
      <section className="dashboard-grid dashboard-grid-balanced">
        <div className="panel chart-panel"><PanelHeading eyebrow="Portfolio" title="Commission velocity" aside={<span className="soft-chip">6-month view</span>} /><TrendChart payload={payload} /></div>
        <div className="panel intelligence-card">
          <PanelHeading eyebrow="Control signals" title="Smart review" aside={<Sparkles size={18} />} />
          <div className="signal-list">
            <Signal tone="green" title="Duplicate lock healthy" copy="No schedule row can enter two active claims." value="100%" />
            <Signal tone="amber" title="Verification queue" copy={`${pending.length} claims are waiting for a decision.`} value={String(pending.length)} />
            <Signal tone="violet" title="Import quality" copy="Latest schedule mapped without blocking errors." value="Ready" />
          </div>
        </div>
      </section>
      <section className="panel queue-preview">
        <PanelHeading eyebrow="Priority work" title="Claims awaiting attention" aside={<button className="text-button" onClick={() => navigate("claims")}>Open full queue <ArrowRight size={14} /></button>} />
        <ClaimRows claims={pending.slice(0, 5)} empty="The verification queue is clear." />
      </section>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, tone, trend }: { label: string; value: string; icon: typeof WalletCards; tone: string; trend: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18} /></div><span>{label}</span><strong>{value}</strong><small>{trend}</small></article>;
}

function PanelHeading({ eyebrow, title, aside }: { eyebrow?: string; title: string; aside?: React.ReactNode }) {
  return <div className="panel-heading"><div>{eyebrow ? <span>{eyebrow}</span> : null}<h3>{title}</h3></div>{aside}</div>;
}

function TrendChart({ payload }: { payload: DashboardPayload }) {
  return (
    <div className="trend-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={payload.trends} margin={{ top: 14, right: 10, left: -20, bottom: 0 }}>
          <defs><linearGradient id="commissionFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6f5cf6" stopOpacity={0.28} /><stop offset="100%" stopColor="#6f5cf6" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="month" tickFormatter={(value) => new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(`${value}-01`))} axisLine={false} tickLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 11 }} />
          <YAxis tickFormatter={(value) => `₦${Math.round(value / 1000)}k`} axisLine={false} tickLine={false} tick={{ fill: "var(--text-tertiary)", fontSize: 11 }} />
          <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg)" }} formatter={(value) => currency(Number(value ?? 0))} />
          <Area type="monotone" dataKey="commission" stroke="#6f5cf6" strokeWidth={2.5} fill="url(#commissionFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ActivityFeed({ payload }: { payload: DashboardPayload }) {
  const items = payload.notifications.slice(0, 5);
  if (!items.length) return <EmptyState compact icon={Activity} title="No recent activity" copy="New schedule and claim updates will appear here." />;
  return <div className="activity-feed">{items.map((item, index) => <div className="activity-item" key={item.id}><span className={index === 0 ? "active" : ""}><Bell size={14} /></span><div><strong>{item.title}</strong><p>{item.body}</p><small>{dateTime(item.createdAt)}</small></div></div>)}</div>;
}

function ScheduleSummary({ schedule }: { schedule: NonNullable<DashboardPayload["schedule"]> }) {
  return (
    <div className="schedule-summary">
      <div className="schedule-file-icon"><FileSpreadsheet size={23} /></div>
      <div className="schedule-primary"><strong>{schedule.title}</strong><span>{schedule.scheduleNumber}</span></div>
      <div><small>Branch</small><strong>{schedule.branch}</strong></div>
      <div><small>Payment date</small><strong>{dateOnly(schedule.paymentDate)}</strong></div>
      <div><small>Paid clients</small><strong>{number(schedule.entryCount)}</strong></div>
      <div><small>RSA value</small><strong>{shortCurrency(schedule.totalRsaAmount)}</strong></div>
      {schedule.sourceFileUrl ? (
        <div className="schedule-source-link"><small>Source file</small><a href={schedule.sourceFileUrl} target="_blank" rel="noreferrer">Download workbook</a></div>
      ) : null}
      <StatusBadge value={schedule.status} />
    </div>
  );
}

function Signal({ tone, title, copy, value }: { tone: string; title: string; copy: string; value: string }) {
  return <div className="signal"><span className={tone}><ShieldCheck size={16} /></span><div><strong>{title}</strong><p>{copy}</p></div><em>{value}</em></div>;
}

function ClaimWorkspace({ payload, token, refresh }: { payload: DashboardPayload; token: string; refresh: () => Promise<void> }) {
  const schedule = payload.schedule;
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rate, setRate] = useState(payload.user.role === "SUB_DEVELOPER" ? 0.02 : 0.01);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [disputeEntry, setDisputeEntry] = useState<PaymentScheduleEntry | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (schedule?.entries ?? []).filter((entry) => {
      const matchesQuery = !needle || [entry.clientName, entry.accountNo, entry.applicationNumber, entry.serialNumber, schedule?.branch].some((value) => value?.toLowerCase().includes(needle));
      return matchesQuery && (stateFilter === "ALL" || entry.claimState === stateFilter);
    });
  }, [query, schedule, stateFilter]);

  const selectedRows = (schedule?.entries ?? []).filter((entry) => selected.has(entry.id));
  const commissionTotal = selectedRows.reduce((sum, entry) => sum + entry.rsaAmount * rate, 0);

  function toggle(entry: PaymentScheduleEntry) {
    if (entry.claimState !== "AVAILABLE") return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
      return next;
    });
  }

  async function submit() {
    if (!schedule || !selected.size) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const claim = await apiRequest<Claim>(token, "/claims", {
        method: "POST",
        body: JSON.stringify({ scheduleId: schedule.id, scheduleEntryIds: [...selected], commissionRate: rate })
      });
      setMessage({ tone: "success", text: `${claim.reference} submitted. ${claim.items.length} client${claim.items.length === 1 ? " is" : "s are"} now locked to your claim.` });
      setSelected(new Set());
      await refresh();
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "Unable to submit this claim" });
      await refresh();
    } finally {
      setSubmitting(false);
    }
  }

  if (!schedule) return <div className="panel"><EmptyState icon={FileSpreadsheet} title="No published schedule" copy="Operations has not published a payment schedule yet." /></div>;

  return (
    <div className="claim-workspace">
      <section className="claim-main">
        <div className="schedule-context">
          <div className="schedule-context-icon"><FileSpreadsheet size={22} /></div>
          <div><span>Now claiming from</span><h2>{schedule.title}</h2><p>{schedule.scheduleNumber} · {schedule.branch} · {dateOnly(schedule.paymentDate)}</p></div>
          <div className="context-stats"><span><strong>{number(schedule.entryCount)}</strong> clients</span><span><strong>{number(payload.metrics.availableClients)}</strong> available</span></div>
        </div>
        {message ? <div className={`inline-message ${message.tone}`}>{message.tone === "success" ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}{message.text}<button onClick={() => setMessage(null)}><X size={14} /></button></div> : null}
        <div className="claim-toolbar">
          <label className="table-search"><Search size={16} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client, application no. or serial…" /><kbd>/</kbd></label>
          <label className="select-control"><Filter size={15} /><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="ALL">All clients</option><option value="AVAILABLE">Available</option><option value="CLAIMED_BY_YOU">Claimed by me</option><option value="CLAIMED_BY_ANOTHER">Claimed by another</option></select></label>
          <span className="result-count">{number(filtered.length)} results</span>
        </div>
        <div className="claim-table-wrap">
          <table className="claim-table">
            <thead><tr><th className="checkbox-column" /><th>Client</th><th>Application no.</th><th className="numeric">RSA amount</th><th>Payment date</th><th>Status</th><th className="numeric">Your commission</th><th /></tr></thead>
            <tbody>
              {filtered.map((entry) => {
                const available = entry.claimState === "AVAILABLE";
                const checked = selected.has(entry.id);
                return (
                  <tr key={entry.id} className={`${checked ? "selected" : ""} ${available ? "" : "locked"}`}>
                    <td><button className={`row-check ${checked ? "checked" : ""}`} onClick={() => toggle(entry)} disabled={!available} aria-label={`Select ${entry.clientName}`}>{checked ? <Check size={13} /> : null}</button></td>
                    <td><div className="client-cell"><span>{entry.clientName.split(/[ ,]/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</span><div><strong>{entry.clientName}</strong><small>SN {entry.serialNumber ?? entry.rowNumber}</small></div></div></td>
                    <td><code>{entry.applicationNumber ?? entry.accountNo ?? "—"}</code></td>
                    <td className="numeric"><strong>{currency(entry.rsaAmount)}</strong></td>
                    <td>{dateOnly(entry.paymentDate ?? schedule.paymentDate)}</td>
                    <td><EntryStatus state={entry.claimState ?? "AVAILABLE"} /></td>
                    <td className="numeric"><strong className="commission-value">{currency(entry.rsaAmount * rate)}</strong><small className="rate-label">{rate * 100}%</small></td>
                    <td>{entry.claimState === "CLAIMED_BY_ANOTHER" ? <button className="dispute-link" onClick={() => setDisputeEntry(entry)}>File dispute</button> : null}</td>
                  </tr>
                );
              })}
              {!filtered.length ? <tr><td colSpan={8}><EmptyState compact icon={Search} title="No clients found" copy="Try another name, application number, or filter." /></td></tr> : null}
            </tbody>
          </table>
          <div className="mobile-client-list">
            {filtered.map((entry) => {
              const available = entry.claimState === "AVAILABLE";
              const checked = selected.has(entry.id);
              return (
                <article className={`${checked ? "selected" : ""} ${available ? "" : "locked"}`} key={`mobile-${entry.id}`}>
                  <button className={`row-check ${checked ? "checked" : ""}`} onClick={() => toggle(entry)} disabled={!available} aria-label={`Mobile select ${entry.clientName}`}>{checked ? <Check size={13} /> : null}</button>
                  <div className="mobile-client-primary"><strong>{entry.clientName}</strong><small>{entry.applicationNumber ?? entry.accountNo ?? "No application number"} · SN {entry.serialNumber ?? entry.rowNumber}</small></div>
                  <EntryStatus state={entry.claimState ?? "AVAILABLE"} />
                  <div className="mobile-client-money"><span>RSA amount<strong>{currency(entry.rsaAmount)}</strong></span><span>Your commission<strong>{currency(entry.rsaAmount * rate)}</strong></span></div>
                  {entry.claimState === "CLAIMED_BY_ANOTHER" ? <button className="dispute-link" onClick={() => setDisputeEntry(entry)}>File dispute <ArrowRight size={12} /></button> : null}
                </article>
              );
            })}
            {!filtered.length ? <EmptyState compact icon={Search} title="No clients found" copy="Try another name, application number, or filter." /> : null}
          </div>
        </div>
      </section>

      <aside className="claim-basket">
        <div className="basket-heading"><div><span>Claim basket</span><h3>{selectedRows.length ? `${selectedRows.length} selected` : "Ready when you are"}</h3></div><span className="basket-count">{selectedRows.length}</span></div>
        {payload.user.role === "SUB_DEVELOPER" ? (
          <div className="rate-picker"><div><span>Commission tier</span><small>Applied to every selected client</small></div><div><button className={rate === 0.015 ? "active" : ""} onClick={() => setRate(0.015)}>1.5%</button><button className={rate === 0.02 ? "active" : ""} onClick={() => setRate(0.02)}>2%</button></div></div>
        ) : <div className="fixed-rate"><span><ShieldCheck size={15} /> Agent rate</span><strong>1%</strong></div>}
        <div className="basket-items">
          {selectedRows.map((entry) => <div className="basket-item" key={entry.id}><span>{entry.clientName.charAt(0)}</span><div><strong>{entry.clientName}</strong><small>{currency(entry.rsaAmount)} · {rate * 100}%</small></div><em>{currency(entry.rsaAmount * rate)}</em><button onClick={() => toggle(entry)}><X size={13} /></button></div>)}
          {!selectedRows.length ? <div className="basket-empty"><span><Check size={19} /></span><strong>Select your clients</strong><p>Tick any available row. Your commission appears here instantly.</p></div> : null}
        </div>
        <div className="basket-summary"><div><span>Clients</span><strong>{selectedRows.length}</strong></div><div><span>Eligible amount</span><strong>{currency(selectedRows.reduce((sum, entry) => sum + entry.rsaAmount, 0))}</strong></div><div className="basket-total"><span>Estimated commission</span><strong>{currency(commissionTotal)}</strong></div></div>
        <button className="button button-primary basket-submit" disabled={!selectedRows.length || submitting} onClick={submit}>{submitting ? <Loader2 className="spin" size={17} /> : <LockKeyhole size={17} />}{submitting ? "Locking claim…" : "Submit claim"}<ArrowRight size={16} /></button>
        <p className="basket-protection"><ShieldCheck size={13} /> Submission locks these schedule rows and prevents duplicate claims.</p>
      </aside>
      {disputeEntry ? <DisputeModal entry={disputeEntry} token={token} onClose={() => setDisputeEntry(null)} onDone={async () => { setDisputeEntry(null); await refresh(); }} /> : null}
    </div>
  );
}

function EntryStatus({ state }: { state: NonNullable<PaymentScheduleEntry["claimState"]> }) {
  if (state === "AVAILABLE") return <span className="entry-status available"><i /> Available</span>;
  if (state === "CLAIMED_BY_YOU") return <span className="entry-status yours"><Check size={12} /> Claimed by you</span>;
  return <span className="entry-status locked"><LockKeyhole size={12} /> Claimed</span>;
}

function DisputeModal({ entry, token, onClose, onDone }: { entry: PaymentScheduleEntry; token: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("scheduleEntryId", entry.id);
      form.append("reason", reason);
      if (evidence) form.append("evidenceNote", evidence);
      if (evidenceFile) form.append("evidence", evidenceFile);
      await apiRequest<Dispute>(token, "/disputes", { method: "POST", body: form });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to file dispute");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal-card dispute-modal" onSubmit={submit}>
        <div className="modal-heading"><span className="modal-icon red"><Gavel size={19} /></span><div><span>Ownership review</span><h3>File a client dispute</h3></div><button type="button" onClick={onClose}><X size={18} /></button></div>
        <div className="disputed-client"><span>{entry.clientName.charAt(0)}</span><div><strong>{entry.clientName}</strong><small>{entry.applicationNumber ?? entry.accountNo} · {currency(entry.rsaAmount)}</small></div></div>
        <label className="field-label"><span>Why does this client belong to you?</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain the client relationship and referral history…" minLength={10} required /></label>
        <label className="field-label"><span>Supporting note <em>Optional</em></span><textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Add dates, phone numbers, or other evidence operations can verify." /></label>
        <label className="evidence-upload"><UploadCloud size={20} /><div><strong>{evidenceFile?.name || "Attach screenshot or evidence"}</strong><small>PNG, JPG, WEBP or PDF · up to 10 MB</small></div><input type="file" accept="image/png,image/jpeg,image/webp,.pdf" onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)} /></label>
        {error ? <div className="form-error"><CircleAlert size={14} />{error}</div> : null}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading || reason.length < 10}>{loading ? <Loader2 className="spin" size={16} /> : <Gavel size={16} />} Submit dispute</button></div>
      </form>
    </div>
  );
}

function ClaimsPanel({ payload, token, refresh }: { payload: DashboardPayload; token: string; refresh: () => Promise<void> }) {
  const staff = isStaff(payload.user);
  const canMakePayment = ["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(payload.user.role);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [approvedItems, setApprovedItems] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const claims = useMemo(() => payload.claims.filter((claim) => {
    const needle = query.trim().toLowerCase();
    const matches = !needle || [claim.reference, claim.submitterName, claim.branch, claim.scheduleTitle, ...claim.items.map((item) => item.clientName)].some((value) => value.toLowerCase().includes(needle));
    return matches && (status === "ALL" || claim.status === status);
  }), [payload.claims, query, status]);
  const selectedRecipient = selectedClaim ? payload.users?.find((user) => user.id === selectedClaim.userId) : undefined;
  const selectedPaymentAccount = selectedRecipient?.paymentAccount;

  function openClaim(claim: Claim) {
    setSelectedClaim(claim);
    setApprovedItems(new Set(claim.items.filter((item) => item.status !== "REJECTED").map((item) => item.id)));
    setNote("");
    setError("");
  }

  async function action(type: "approve" | "partial_approve" | "reject" | "request_info" | "paid") {
    if (!selectedClaim) return;
    setActionLoading(type);
    setError("");
    try {
      await apiRequest(token, `/claims/${selectedClaim.id}/status`, { method: "PATCH", body: JSON.stringify({ action: type, approvedItemIds: [...approvedItems], note: note || undefined }) });
      setSelectedClaim(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update claim");
    } finally {
      setActionLoading("");
    }
  }

  return (
    <div className="page-stack">
      <section className="page-heading-row"><div><span className="eyebrow">{staff ? "Verification workflow" : "Your commission activity"}</span><h2>{staff ? "Review every claim with source context." : "Track claims from submission to payment."}</h2><p>{staff ? "The queue is ordered by recency, with locked schedule rows and auditable decisions." : "Every status change and payment appears here in real time."}</p></div>{staff ? <div className="queue-sla"><Zap size={17} /><span>Target SLA<strong>&lt; 4 hours</strong></span></div> : null}</section>
      <section className="panel table-panel">
        <div className="table-topbar"><label className="table-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search claim, agent, client or branch…" /></label><label className="select-control"><Filter size={15} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All statuses</option>{["PENDING_VERIFICATION", "NEEDS_REVIEW", "INFO_REQUESTED", "PARTIALLY_APPROVED", "APPROVED", "REJECTED", "PAID"].map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label><span className="result-count">{claims.length} claims</span></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Claim</th>{staff ? <th>Partner</th> : null}<th>Schedule</th><th>Clients</th><th className="numeric">Commission</th><th>Submitted</th><th>Status</th><th /></tr></thead><tbody>{claims.map((claim) => <tr key={claim.id}><td><strong>{claim.reference}</strong><small>{claim.submitterRole === "SUB_DEVELOPER" ? `${claim.commissionRate * 100}% tier` : "Standard 1%"}</small></td>{staff ? <td><div className="person-cell"><span>{claim.submitterName?.charAt(0) ?? "?"}</span><div><strong>{claim.submitterName}</strong><small>{titleCase(claim.submitterRole)}</small></div></div></td> : null}<td><strong>{claim.branch}</strong><small>{claim.scheduleTitle}</small></td><td><strong>{claim.items.length}</strong><small>{shortCurrency(claim.totalRsaAmount)} eligible</small></td><td className="numeric"><strong>{currency(claim.totalPayable)}</strong></td><td>{dateTime(claim.createdAt)}</td><td><StatusBadge value={claim.status} /></td><td><button className="table-action" onClick={() => openClaim(claim)}>Review <ArrowRight size={14} /></button></td></tr>)}</tbody></table>{!claims.length ? <EmptyState icon={ReceiptText} title="No claims found" copy="Try changing your search or status filter." /> : null}</div>
      </section>

      {selectedClaim ? (
        <div className="modal-backdrop drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedClaim(null)}>
          <aside className="claim-drawer">
            <div className="drawer-heading"><div><span>{selectedClaim.reference}</span><h3>{selectedClaim.submitterName}</h3><p>{selectedClaim.scheduleTitle}</p></div><button onClick={() => setSelectedClaim(null)}><X size={19} /></button></div>
            <div className="drawer-status"><StatusBadge value={selectedClaim.status} /><span>{dateTime(selectedClaim.createdAt)}</span></div>
            <div className="claim-total-card"><div><span>Total commission</span><strong>{currency(selectedClaim.totalPayable)}</strong></div><div><small>{selectedClaim.items.length} client{selectedClaim.items.length === 1 ? "" : "s"}</small><small>{selectedClaim.commissionRate * 100}% rate</small><small>{shortCurrency(selectedClaim.totalRsaAmount)} RSA</small></div></div>
            <div className="drawer-section"><div className="drawer-section-heading"><h4>Claimed clients</h4>{staff && selectedClaim.items.length > 1 ? <small>Select rows for partial approval</small> : null}</div><div className="drawer-items">{selectedClaim.items.map((item) => <label className={item.status === "REJECTED" ? "rejected" : ""} key={item.id}>{staff ? <input type="checkbox" checked={approvedItems.has(item.id)} onChange={() => setApprovedItems((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /> : null}<span>{item.clientName?.charAt(0) ?? "?"}</span><div><strong>{item.clientName}</strong><small>{item.applicationNumber} · {currency(item.rsaAmount)}</small></div><em>{currency(item.commissionAmount)}</em></label>)}</div></div>
            {canMakePayment && ["APPROVED", "PARTIALLY_APPROVED"].includes(selectedClaim.status) ? <div className="drawer-section payout-review-section"><div className="drawer-section-heading"><h4>Payment details</h4><small>Verify before settlement</small></div>{selectedPaymentAccount && selectedRecipient?.phone ? <PaymentAccountSummary account={selectedPaymentAccount} phone={selectedRecipient.phone} /> : <div className="payment-account-missing"><CircleAlert size={16} /><div><strong>Payment details incomplete</strong><p>Ask the partner to add their bank account and phone number from Payment history.</p></div></div>}</div> : null}
            {staff ? <div className="drawer-section"><label className="field-label"><span>Decision note <em>Optional</em></span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context for the partner and audit trail…" /></label>{error ? <div className="form-error"><CircleAlert size={14} />{error}</div> : null}<div className="drawer-actions">{["PENDING_VERIFICATION", "NEEDS_REVIEW", "INFO_REQUESTED"].includes(selectedClaim.status) ? <><button className="button button-success" onClick={() => action(approvedItems.size === selectedClaim.items.length ? "approve" : "partial_approve")} disabled={Boolean(actionLoading)}>{actionLoading ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />} {approvedItems.size === selectedClaim.items.length ? "Approve claim" : `Approve ${approvedItems.size} selected`}</button><button className="button button-secondary" onClick={() => action("request_info")} disabled={Boolean(actionLoading)}><MessageSquare size={15} /> Request info</button><button className="button button-danger" onClick={() => action("reject")} disabled={Boolean(actionLoading)}>Reject</button></> : null}{canMakePayment && ["APPROVED", "PARTIALLY_APPROVED"].includes(selectedClaim.status) ? <button className="button button-primary" onClick={() => action("paid")} disabled={Boolean(actionLoading) || !selectedPaymentAccount || !selectedRecipient?.phone} title={selectedPaymentAccount && selectedRecipient?.phone ? "Mark this claim as paid" : "The partner must add a payment account and phone number first"}><Banknote size={16} /> Mark as paid</button> : null}</div></div> : null}
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function ClaimRows({ claims, empty }: { claims: Claim[]; empty: string }) {
  if (!claims.length) return <EmptyState compact icon={CheckCircle2} title="Queue clear" copy={empty} />;
  return <div className="claim-row-list">{claims.map((claim) => <div className="claim-row" key={claim.id}><div className="person-cell"><span>{claim.submitterName?.charAt(0) ?? "?"}</span><div><strong>{claim.submitterName}</strong><small>{claim.reference}</small></div></div><div><small>Clients</small><strong>{claim.items.length}</strong></div><div><small>Commission</small><strong>{currency(claim.totalPayable)}</strong></div><div><small>Match</small><strong>{claim.matchScore}%</strong></div><StatusBadge value={claim.status} /><span className="row-time">{dateTime(claim.createdAt)}</span></div>)}</div>;
}

function SchedulesPanel({ payload, token, refresh, navigate }: { payload: DashboardPayload; token: string; refresh: () => Promise<void>; navigate: (view: ViewId) => void }) {
  const staff = isStaff(payload.user);
  const schedules = payload.schedules ?? [];
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<LocalSchedulePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleFile(fileToParse: File | null) {
    setFile(fileToParse);
    setFilePreview(null);
    setMessage("");
    if (!fileToParse) return;

    setLoading(true);
    try {
      const preview = await parseWorkbook(fileToParse);
      setFilePreview(preview);
    } catch (err) {
      console.warn("Client-side workbook parsing failed, trying backend preview...", err);
      try {
        const response = await uploadFile<{
          schedule: any;
          detectedColumns: string[];
          warnings: string[];
        }>(token, "/payment-schedules/preview", fileToParse, { title: fileToParse.name });

        setFilePreview({
          fileName: fileToParse.name,
          headerRowIndex: 0,
          detectedFields: {
            branch: response.schedule?.branch,
            paymentDate: response.schedule?.paymentDate,
            clientName: "Client name",
            accountNumber: "Account number",
            rsaAmount: "RSA amount"
          },
          detectedColumns: response.detectedColumns || ["Account number", "Client name", "RSA amount"],
          warnings: response.warnings || [],
          sampleRows: (response.schedule?.entries || []).slice(0, 5).map((e: any) => ({
            "Client name": e.clientName,
            "Account number": e.accountNo || e.applicationNumber || "",
            "RSA amount": e.rsaAmount ? `₦${e.rsaAmount.toLocaleString()}` : ""
          }))
        });
      } catch (backendErr) {
        setMessage(backendErr instanceof Error ? backendErr.message : (err instanceof Error ? err.message : "Unable to inspect workbook"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (!file) return;
    setLoading(true); setMessage("");
    try {
      const title = filePreview?.fileName ? `Published schedule · ${filePreview.fileName}` : undefined;
      const metadata = filePreview ? {
        branch: filePreview.detectedFields.branch,
        paymentDate: filePreview.detectedFields.paymentDate,
        detectedFields: filePreview.detectedFields,
        detectedColumns: filePreview.detectedColumns,
        warnings: filePreview.warnings
      } : undefined;
      await uploadFile(token, "/payment-schedules/upload", file, {
        title: title ?? "Published schedule",
        metadata: metadata ? JSON.stringify(metadata) : ""
      });
      setFile(null); setFilePreview(null); setMessage("Schedule published. Every active agent has been notified.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to publish schedule");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack">
      {staff ? (
        <section className="schedule-upload-layout">
          <div className="panel upload-card">
            <PanelHeading eyebrow="Smart importer" title="Publish a payment schedule" aside={<span className="ai-badge"><Sparkles size={13} /> Auto-map</span>} />
            <label className={`drop-zone ${file ? "has-file" : ""}`}><input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { handleFile(event.target.files?.[0] ?? null); }} />{file ? <><span className="file-orb"><FileSpreadsheet size={23} /></span><div><strong>{file.name}</strong><small>{(file.size / 1024).toFixed(0)} KB · Ready to inspect</small></div><button type="button" onClick={(event) => { event.preventDefault(); handleFile(null); }}><X size={16} /></button></> : <><span className="upload-orb"><UploadCloud size={25} /></span><div><strong>Drop your Excel schedule here</strong><small>Headers may start on any row. Leading zeroes and formulas are preserved.</small></div><span className="button button-secondary button-small">Choose file</span></>}</label>
            <button className="button button-primary inspect-button" disabled={!file || loading} onClick={() => file && handleFile(file)}>{loading ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />} Inspect workbook</button>
            {message ? <div className={`inline-message ${message.startsWith("Schedule") ? "success" : "error"}`}>{message.startsWith("Schedule") ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}{message}</div> : null}
          </div>
          <div className="panel import-preview-card">
            <PanelHeading eyebrow="Import preview" title={filePreview ? "Mapping complete" : "Waiting for a workbook"} aside={filePreview ? <span className="success-chip"><Check size={13} /> Ready</span> : null} />
            {filePreview ? <>
              <div className="import-meta">
                <div><small>Header row</small><strong>Row {filePreview.headerRowIndex + 1}</strong></div>
                <div><small>Detected branch</small><strong>{filePreview.detectedFields.branch ?? "Missing"}</strong></div>
                <div><small>Detected date</small><strong>{filePreview.detectedFields.paymentDate ?? "Missing"}</strong></div>
                <div><small>Detected client name</small><strong>{filePreview.detectedFields.clientName ?? "Missing"}</strong></div>
                <div><small>Detected account number</small><strong>{filePreview.detectedFields.accountNumber ?? "Missing"}</strong></div>
                <div><small>Detected RSA amount</small><strong>{filePreview.detectedFields.rsaAmount ?? "Missing"}</strong></div>
              </div>
              <div className="mapped-columns">
                <span>Detected columns</span>
                <div>{filePreview.detectedColumns.map((column) => <em key={column}><Check size={11} />{column}</em>)}</div>
              </div>
              {filePreview.warnings.length ? (
                <div className="import-warnings">
                  <CircleAlert size={15} />
                  <div>
                    <strong>{filePreview.warnings.length} review note{filePreview.warnings.length === 1 ? "" : "s"}</strong>
                    {filePreview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                </div>
              ) : (
                <div className="import-clean">
                  <ShieldCheck size={16} />
                  <div>
                    <strong>No blocking issues</strong>
                    <p>The workbook has the key header fields required for schedule import.</p>
                  </div>
                </div>
              )}
              <div className="sample-preview">
                <span>Sample rows</span>
                <div className="sample-table">
                  <div className="sample-row sample-row-header"><strong>Branch</strong><strong>Date</strong><strong>Client name</strong><strong>Account number</strong><strong>RSA amount</strong></div>
                  {filePreview.sampleRows.map((row, index) => (
                    <div className="sample-row" key={index}>
                      <span>{row.Branch || "—"}</span>
                      <span>{row.Date || "—"}</span>
                      <span>{row["Client name"] || "—"}</span>
                      <span>{row["Account number"] || "—"}</span>
                      <span>{row["RSA amount"] || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="publish-row">
                <div><span>Detected workbook</span><strong>{filePreview.fileName}</strong></div>
                <button className="button button-primary" onClick={publish} disabled={loading || !file}>{loading ? <Loader2 className="spin" size={16} /> : <Zap size={16} />} Publish & notify agents</button>
              </div>
            </> : (
              <div className="preview-placeholder">
                <span><FileSpreadsheet size={27} /></span>
                <strong>Automatic column intelligence</strong>
                <p>We’ll detect the header row, branch, date, client name, account number, RSA amount, and commission columns.</p>
                <div><em>Duplicate accounts</em><em>Missing amounts</em><em>Formula values</em></div>
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section className="panel table-panel">
        <PanelHeading eyebrow={staff ? "Schedule management" : "Published schedules"} title={staff ? "Schedule library" : "Your payment schedules"} aside={!staff && payload.schedule ? <button className="button button-primary button-small" onClick={() => navigate("claim")}>Quick claim <ArrowRight size={14} /></button> : null} />
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Schedule</th><th>Branch</th><th>Payment date</th><th>Clients</th><th className="numeric">RSA value</th><th>Status</th><th>Published</th><th /></tr></thead><tbody>{schedules.map((schedule) => <tr key={schedule.id}><td><div className="file-cell"><span><FileSpreadsheet size={18} /></span><div><strong>{schedule.title}</strong><small>{schedule.scheduleNumber}</small></div></div></td><td>{schedule.branch}</td><td>{dateOnly(schedule.paymentDate)}</td><td>{number(schedule.entryCount)}</td><td className="numeric"><strong>{shortCurrency(schedule.totalRsaAmount)}</strong></td><td><StatusBadge value={schedule.status} /></td><td>{dateTime(schedule.publishedAt ?? schedule.uploadedAt)}</td><td>{schedule.status === "PUBLISHED" && !staff ? <button className="table-action" onClick={() => navigate("claim")}>View <ArrowRight size={13} /></button> : <button className="icon-button tiny"><Command size={14} /></button>}</td></tr>)}</tbody></table>{!schedules.length ? <EmptyState icon={FileSpreadsheet} title="No schedules yet" copy="Your first uploaded payment schedule will appear here." /> : null}</div>
      </section>
    </div>
  );
}

function DisputesPanel({ payload, token, refresh }: { payload: DashboardPayload; token: string; refresh: () => Promise<void> }) {
  const staff = isStaff(payload.user);
  const disputes = payload.disputes ?? [];
  const [selected, setSelected] = useState<Dispute | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  async function action(type: "review" | "reject" | "resolve" | "transfer") {
    if (!selected) return;
    setLoading(type); setError("");
    try { await apiRequest(token, `/disputes/${selected.id}`, { method: "PATCH", body: JSON.stringify({ action: type, note: note || undefined }) }); setSelected(null); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to update dispute"); }
    finally { setLoading(""); }
  }
  return (
    <div className="page-stack">
      <section className="page-heading-row"><div><span className="eyebrow">Ownership control</span><h2>{staff ? "Resolve client ownership with a complete trail." : "A fair process when ownership is unclear."}</h2><p>{staff ? "Review evidence, notify both parties, and transfer the schedule lock when required." : "File from the claimed client row and follow every decision here."}</p></div><div className="dispute-stat"><Gavel size={18} /><span>Open cases<strong>{disputes.filter((item) => ["OPEN", "UNDER_REVIEW"].includes(item.status)).length}</strong></span></div></section>
      <section className="panel table-panel"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Dispute</th><th>Client</th>{staff ? <><th>Raised by</th><th>Against</th></> : null}<th>Reason</th><th>Status</th><th>Created</th><th /></tr></thead><tbody>{disputes.map((dispute) => <tr key={dispute.id}><td><strong>{dispute.reference}</strong><small>{dispute.evidenceFileName ? "Evidence attached" : "Text evidence"}</small></td><td><strong>{dispute.clientName}</strong></td>{staff ? <><td>{dispute.raisedByName}</td><td>{dispute.againstUserName}</td></> : null}<td><span className="truncate-copy">{dispute.reason}</span></td><td><StatusBadge value={dispute.status} /></td><td>{dateTime(dispute.createdAt)}</td><td><button className="table-action" onClick={() => { setSelected(dispute); setNote(dispute.resolution ?? ""); }}>Open <ArrowRight size={13} /></button></td></tr>)}</tbody></table>{!disputes.length ? <EmptyState icon={Gavel} title="No disputes" copy={staff ? "New ownership cases will appear here immediately." : "You have no active ownership disputes."} /> : null}</div></section>
      {selected ? <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><div className="modal-card case-modal"><div className="modal-heading"><span className="modal-icon violet"><Gavel size={19} /></span><div><span>{selected.reference}</span><h3>{selected.clientName}</h3></div><button onClick={() => setSelected(null)}><X size={18} /></button></div><div className="case-parties"><div><small>Raised by</small><strong>{selected.raisedByName}</strong></div><ArrowRight size={16} /><div><small>Current claimant</small><strong>{selected.againstUserName}</strong></div></div><div className="case-reason"><span>Claimant statement</span><p>{selected.reason}</p>{selected.evidenceNote ? <><span>Evidence note</span><p>{selected.evidenceNote}</p></> : null}</div>{staff ? <><label className="field-label"><span>Resolution note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explain the decision for both parties…" /></label>{error ? <div className="form-error"><CircleAlert size={14} />{error}</div> : null}<div className="modal-actions wrap"><button className="button button-secondary" onClick={() => action("review")} disabled={Boolean(loading)}>Under review</button><button className="button button-danger" onClick={() => action("reject")} disabled={Boolean(loading)}>Reject dispute</button><button className="button button-primary" onClick={() => action("transfer")} disabled={Boolean(loading)}>{loading === "transfer" ? <Loader2 className="spin" size={15} /> : <ArrowRight size={15} />} Transfer claim</button></div></> : <div className="case-resolution"><StatusBadge value={selected.status} />{selected.resolution ? <p>{selected.resolution}</p> : <p>Operations will notify both parties when a decision is made.</p>}</div>}</div></div> : null}
    </div>
  );
}

function PaymentAccountSummary({ account, phone }: { account: PaymentAccount; phone: string }) {
  return <div className="payment-account-summary"><span><Landmark size={18} /></span><div><strong>{account.bankName}</strong><small>{account.accountName}</small><small className="payment-phone"><Phone size={11} />{phone}</small></div><code>{account.accountNumber}</code></div>;
}

function SupportPanel({ payload, token, refresh }: { payload: DashboardPayload; token: string; refresh: () => Promise<void> }) {
  const staff = isStaff(payload.user);
  const tickets = payload.tickets;
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("MEDIUM");
  const [reply, setReply] = useState("");
  const [replyStatus, setReplyStatus] = useState<TicketStatus>("WAITING");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const activeTickets = tickets.filter((ticket) => ticket.status !== "RESOLVED").length;
  const urgentTickets = tickets.filter((ticket) => ticket.priority === "URGENT" && ticket.status !== "RESOLVED").length;
  const resolvedTickets = tickets.filter((ticket) => ticket.status === "RESOLVED").length;

  function openTicket(ticket: Ticket) {
    setSelected(ticket);
    setReply("");
    setReplyStatus(ticket.status === "RESOLVED" ? "RESOLVED" : "WAITING");
    setError("");
  }

  async function createTicket(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setError("");
    try {
      const created = await apiRequest<Ticket>(token, "/tickets", { method: "POST", body: JSON.stringify({ subject, description, priority }) });
      setSubject("");
      setDescription("");
      setPriority("MEDIUM");
      setMessage("Ticket raised successfully. The support team has been notified.");
      setSelected(created);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to raise the ticket");
    } finally {
      setLoading(false);
    }
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const updated = await apiRequest<Ticket>(token, `/tickets/${selected.id}/replies`, { method: "POST", body: JSON.stringify({ body: reply, status: staff ? replyStatus : undefined }) });
      setSelected(updated);
      setReply("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send the reply");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="support-hero">
        <div><span className="support-hero-kicker"><LifeBuoy size={14} /> ASASU partner care</span><h2>{staff ? "Resolve every request with context." : "Help is now one conversation away."}</h2><p>{staff ? "A focused queue for account, claim, schedule, dispute, and payment questions." : "Raise a ticket, keep every reply together, and follow progress without leaving your commission workspace."}</p></div>
        <div className="support-hero-stats"><div><small>Active</small><strong>{activeTickets}</strong></div><div><small>Urgent</small><strong>{urgentTickets}</strong></div><div><small>Resolved</small><strong>{resolvedTickets}</strong></div></div>
      </section>

      <section className={`support-layout ${staff ? "support-layout-staff" : ""}`}>
        {!staff ? <form className="panel support-compose" onSubmit={createTicket}><PanelHeading eyebrow="New request" title="Raise a support ticket" aside={<span className="support-compose-icon"><Plus size={15} /></span>} /><p>Tell the team what happened and how urgently you need help.</p><label className="field-label"><span>Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What do you need help with?" minLength={3} maxLength={120} required /></label><label className="field-label"><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)}>{(["LOW", "MEDIUM", "HIGH", "URGENT"] as TicketPriority[]).map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label><label className="field-label"><span>Describe the issue</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Include the claim reference, client, schedule, or payment details that will help us investigate…" minLength={5} maxLength={2000} required /></label>{error ? <div className="form-error"><CircleAlert size={14} />{error}</div> : null}{message ? <div className="form-success"><CheckCircle2 size={15} />{message}</div> : null}<button className="button button-primary support-submit" disabled={loading}>{loading ? <Loader2 className="spin" size={16} /> : <Send size={16} />} {loading ? "Submitting…" : "Submit ticket"}</button></form> : null}

        <section className="panel support-queue"><PanelHeading eyebrow={staff ? "Service desk" : "Your requests"} title={staff ? "Ticket queue" : "Ticket history"} aside={<span className="soft-chip">{tickets.length} ticket{tickets.length === 1 ? "" : "s"}</span>} /><div className="ticket-list">{tickets.map((ticket) => <article className="ticket-card" key={ticket.id}><span className="ticket-symbol"><MessageSquare size={16} /></span><div className="ticket-card-copy"><div><strong>{ticket.subject}</strong><span className={`priority-badge priority-${ticket.priority.toLowerCase()}`}>{titleCase(ticket.priority)}</span></div><p>{ticket.description}</p><small>{staff ? `${ticket.submitterName} · ` : ""}{dateTime(ticket.updatedAt)} · {ticket.replies.length} repl{ticket.replies.length === 1 ? "y" : "ies"}</small></div><div className="ticket-card-action"><StatusBadge value={ticket.status} /><button className="table-action" onClick={() => openTicket(ticket)}>Open <ArrowRight size={13} /></button></div></article>)}{!tickets.length ? <EmptyState icon={LifeBuoy} title="No support tickets" copy={staff ? "New partner requests will appear here." : "Raise your first ticket when you need help."} /> : null}</div></section>
      </section>

      {selected ? <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><div className="modal-card ticket-modal"><div className="modal-heading"><span className="modal-icon violet"><LifeBuoy size={19} /></span><div><span>{titleCase(selected.priority)} priority · {selected.submitterName}</span><h3>{selected.subject}</h3></div><button onClick={() => setSelected(null)}><X size={18} /></button></div><div className="ticket-conversation"><div className="ticket-message ticket-message-origin"><div><strong>{selected.submitterName}</strong><small>{dateTime(selected.createdAt)}</small></div><p>{selected.description}</p></div>{selected.replies.map((item) => <div className={`ticket-message ${item.authorId === payload.user.id ? "ticket-message-mine" : ""}`} key={item.id}><div><strong>{item.authorName}</strong><small>{dateTime(item.createdAt)}</small></div><p>{item.body}</p></div>)}</div><form className="ticket-reply" onSubmit={sendReply}>{staff ? <label className="field-label"><span>Set status</span><select value={replyStatus} onChange={(event) => setReplyStatus(event.target.value as TicketStatus)}>{(["OPEN", "WAITING", "RESOLVED"] as TicketStatus[]).map((item) => <option key={item} value={item}>{titleCase(item)}</option>)}</select></label> : null}<label className="field-label"><span>{staff ? "Reply to partner" : "Add a reply"}</span><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a clear update…" minLength={2} maxLength={2000} required /></label>{error ? <div className="form-error"><CircleAlert size={14} />{error}</div> : null}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setSelected(null)}>Close</button><button className="button button-primary" disabled={loading || reply.trim().length < 2}>{loading ? <Loader2 className="spin" size={15} /> : <Send size={15} />} Send reply</button></div></form></div></div> : null}
    </div>
  );
}

function PaymentsPanel({ payload, token, refresh }: { payload: DashboardPayload; token: string; refresh: () => Promise<void> }) {
  const staff = isStaff(payload.user);
  const payments = payload.payments ?? [];
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const [bankName, setBankName] = useState(payload.user.paymentAccount?.bankName ?? "");
  const [accountName, setAccountName] = useState(payload.user.paymentAccount?.accountName ?? payload.user.name);
  const [accountNumber, setAccountNumber] = useState(payload.user.paymentAccount?.accountNumber ?? "");
  const [phone, setPhone] = useState(payload.user.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function savePaymentAccount(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await apiRequest(token, "/me/payment-account", { method: "PATCH", body: JSON.stringify({ bankName, accountName, accountNumber, phone }) });
      setMessage("Payment account and phone number saved. Administrators can now use them when settling your commission.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save payment account");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="payment-hero"><div><span className="eyebrow">Settlement ledger</span><h2>{currency(total)}</h2><p>{staff ? "Total commission payments recorded in this workspace." : "Total commission paid to your account."}</p></div>{staff ? <button className="button button-secondary" onClick={async () => { try { await downloadFile(token, "/payments/export.csv", "asasu-payment-log.csv"); } catch (err) { console.error(err); } }}><Download size={16} /> Export payment log</button> : <span className="payment-protected"><ShieldCheck size={16} /> Reconciled ledger</span>}</section>
      {!staff ? <section className="panel payout-account-panel"><PanelHeading eyebrow="Payment destination" title="Bank account & phone" aside={payload.user.paymentAccount && payload.user.phone ? <span className="success-chip"><Check size={12} /> Details on file</span> : <span className="soft-chip">Required for payout</span>} /><p className="payout-account-copy">Add the account and phone number ASASU should use for approved commission payments. Administrators see these details only when preparing your settlement.</p><form className="payout-account-form" onSubmit={savePaymentAccount}><div className="payout-account-fields"><label className="field-label"><span>Bank name</span><input value={bankName} onChange={(event) => setBankName(event.target.value)} placeholder="e.g. Access Bank" minLength={2} maxLength={80} required /></label><label className="field-label"><span>Account name</span><input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Name shown by your bank" minLength={2} maxLength={100} required /></label><label className="field-label"><span>Account number</span><input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="10-digit account number" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} required /></label><label className="field-label"><span>Phone number</span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="e.g. +234 800 000 0000" minLength={7} maxLength={24} required /></label></div>{error ? <div className="form-error"><CircleAlert size={14} />{error}</div> : null}{message ? <div className="form-success"><CheckCircle2 size={15} />{message}</div> : null}<div className="payout-form-actions"><span><ShieldCheck size={14} /> Stored for commission settlement</span><button className="button button-primary" disabled={saving || accountNumber.length !== 10 || phone.trim().length < 7}>{saving ? <Loader2 className="spin" size={16} /> : <Landmark size={16} />} {saving ? "Saving…" : "Save payment details"}</button></div></form></section> : null}
      <section className="panel table-panel"><PanelHeading eyebrow="Transactions" title="Payment history" aside={<span className="soft-chip">{payments.length} records</span>} /><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Reference</th><th>Recipient</th>{staff ? <th>Payout details</th> : null}<th>Claim</th><th className="numeric">Amount</th><th>Paid at</th><th>Status</th></tr></thead><tbody>{payments.map((payment) => { const recipient = payload.users?.find((user) => user.id === payment.userId); const account = payment.paymentAccount ?? recipient?.paymentAccount; const recipientPhone = payment.recipientPhone ?? recipient?.phone; return <tr key={payment.id}><td><code>{payment.reference}</code></td><td><strong>{payment.recipientName}</strong></td>{staff ? <td>{account ? <div className="payment-account-cell"><strong>{account.bankName}</strong><small>{account.accountNumber} · {account.accountName}</small>{recipientPhone ? <small className="payment-phone"><Phone size={10} />{recipientPhone}</small> : null}</div> : "—"}</td> : null}<td>{payment.claimId}</td><td className="numeric"><strong>{currency(payment.amount)}</strong></td><td>{dateTime(payment.paidAt)}</td><td><span className="entry-status available"><Check size={12} /> Settled</span></td></tr>; })}</tbody></table>{!payments.length ? <EmptyState icon={Banknote} title="No payments yet" copy="Settled commission payments will appear here." /> : null}</div></section>
    </div>
  );
}

function PeoplePanel({ payload }: { payload: DashboardPayload }) {
  const users = payload.users ?? [];
  return <div className="page-stack"><section className="page-heading-row"><div><span className="eyebrow">Identity & access</span><h2>People, roles, and partner status.</h2><p>Keep every user attached to the right workspace, branch, and permission level.</p></div><button className="button button-primary"><UserRound size={16} /> Invite partner</button></section><section className="metric-grid metric-grid-four"><MetricCard label="Active users" value={number(users.filter((user) => user.active).length)} icon={Users} tone="green" trend="Can access workspace" /><MetricCard label="Agents" value={number(users.filter((user) => user.role === "AGENT").length)} icon={UserRound} tone="violet" trend="Standard 1% tier" /><MetricCard label="Sub-developers" value={number(users.filter((user) => user.role === "SUB_DEVELOPER").length)} icon={Building2} tone="blue" trend="1.5% or 2% tier" /><MetricCard label="Staff" value={number(users.filter(isStaff).length)} icon={ShieldCheck} tone="amber" trend="Controlled access" /></section><section className="panel table-panel"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Role</th><th>Agency</th><th>Branch</th><th>Phone</th><th>Status</th><th>Joined</th><th /></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><div className="person-cell"><span>{user.name.charAt(0)}</span><div><strong>{user.name}</strong><small>{user.email}</small></div></div></td><td><span className="role-badge">{titleCase(user.role)}</span></td><td>{user.agency}</td><td>{user.branch ?? "—"}</td><td>{user.phone ?? "—"}</td><td><span className={`entry-status ${user.active ? "available" : "locked"}`}><i />{user.active ? "Active" : "Disabled"}</span></td><td>{dateOnly(user.createdAt.slice(0, 10))}</td><td><button className="icon-button tiny"><Command size={14} /></button></td></tr>)}</tbody></table></div></section></div>;
}

function AuditPanel({ payload }: { payload: DashboardPayload }) {
  const logs = payload.auditLog ?? [];
  return <div className="page-stack"><section className="page-heading-row"><div><span className="eyebrow">Immutable history</span><h2>Every material action, accounted for.</h2><p>Actor, decision, entity, device context, and time—ready for audit and dispute review.</p></div><span className="audit-shield"><ShieldCheck size={18} /> Tamper-evident</span></section><section className="panel audit-panel"><div className="audit-timeline">{logs.map((log) => <div className="audit-event" key={log.id}><span className="audit-dot"><Activity size={14} /></span><div><div><strong>{log.actorName}</strong><span>{titleCase(log.action)}</span></div><p>{log.detail}</p><small>{dateTime(log.createdAt)} · {log.entityType} · {log.entityId}{log.ipAddress ? ` · ${log.ipAddress}` : ""}</small></div></div>)}{!logs.length ? <EmptyState icon={History} title="No audit events" copy="Material actions will appear here." /> : null}</div></section></div>;
}

function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase();
  const tone = normalized.includes("paid") || normalized.includes("approved") || normalized.includes("published") || normalized.includes("resolved") ? "success" : normalized.includes("reject") || normalized.includes("archived") ? "danger" : normalized.includes("review") || normalized.includes("pending") || normalized.includes("open") || normalized.includes("info") ? "warning" : "neutral";
  return <span className={`status-badge ${tone}`}><i />{titleCase(value)}</span>;
}

function EmptyState({ icon: Icon, title, copy, compact = false }: { icon: typeof Search; title: string; copy: string; compact?: boolean }) {
  return <div className={`empty-state ${compact ? "compact" : ""}`}><span><Icon size={compact ? 18 : 22} /></span><strong>{title}</strong><p>{copy}</p></div>;
}
