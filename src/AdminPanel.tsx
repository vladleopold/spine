import { useState, useEffect, useCallback, useRef } from "react";

type AdminSettings = {
  disableHighQuality?: boolean;
  disableMediumQuality?: boolean;
  disableLowQuality?: boolean;
  disableProgressiveLoading?: boolean;
  maintenanceMode?: boolean;
  customMessage?: string;
};

type IndexEntry = {
  id: string;
  title?: string;
  ownerEmail?: string;
  ownerName?: string;
  hiddenFromPublicLibrary?: boolean;
  uploadedAt?: string;
  animations?: number;
  pageMode?: string;
};

type UserEntry = {
  email: string;
  name: string;
  anonId: string;
  entries: number;
  totalViews: number;
};

type ExclusionRule = {
  enabled: boolean;
  type: string;
  field: string;
  pattern: string;
  flags: string;
};

type AdminPanelProps = {
  googleUser: { email: string; name?: string; picture?: string } | null;
  onSignOut: () => void;
};

function AdminPanel({ googleUser, onSignOut }: AdminPanelProps) {
  const [settings, setSettings] = useState<AdminSettings>({});
  const [entries, setEntries] = useState<IndexEntry[]>([]);
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [exclusions, setExclusions] = useState<{ rules: ExclusionRule[] }>({ rules: [] });
  const [activeBlock, setActiveBlock] = useState<number>(0);
  const [loading, setLoading] = useState<string>("");
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [workflowStatus, setWorkflowStatus] = useState<string>("");
  const [workflowFilterId, setWorkflowFilterId] = useState("");
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [newRule, setNewRule] = useState<ExclusionRule>({ enabled: true, type: "contains", field: "all", pattern: "", flags: "i" });

  const apiCall = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      const res = await fetch("/api/github-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.status === 429) { showMsg("err", "Rate limit exceeded. Wait and try again."); return { ok: false }; }
      return res.json();
    },
    []
  );

  const showMsg = (type: "ok" | "err", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const loadSettings = useCallback(async () => {
    setLoading("settings");
    try {
      const data = await apiCall("admin-get-settings");
      if (data.ok) setSettings(data.settings || {});
    } catch { showMsg("err", "Failed to load settings"); }
    setLoading("");
  }, [apiCall]);

  const loadIndex = useCallback(async () => {
    setLoading("index");
    try {
      const data = await apiCall("admin-get-index");
      if (data.ok) setEntries(data.entries || []);
    } catch { showMsg("err", "Failed to load index"); }
    setLoading("");
  }, [apiCall]);

  const loadUsers = useCallback(async () => {
    setLoading("users");
    try {
      const data = await apiCall("admin-get-users");
      if (data.ok) setUsers(data.users || []);
    } catch { showMsg("err", "Failed to load users"); }
    setLoading("");
  }, [apiCall]);

  const loadExclusions = useCallback(async () => {
    setLoading("exclusions");
    try {
      const data = await apiCall("admin-get-exclusions");
      if (data.ok) setExclusions(data.exclusions || { rules: [] });
    } catch { showMsg("err", "Failed to load exclusions"); }
    setLoading("");
  }, [apiCall]);

  useEffect(() => {
    if (activeBlock === 0) loadSettings();
    if (activeBlock === 1) setWorkflowStatus("");
    if (activeBlock === 2) { loadIndex(); loadExclusions(); }
    if (activeBlock === 3) loadUsers();
  }, [activeBlock, loadSettings, loadIndex, loadUsers, loadExclusions]);

  const saveSettings = async () => {
    setLoading("save-settings");
    try {
      const data = await apiCall("admin-save-settings", { settings });
      showMsg(data.ok ? "ok" : "err", data.ok ? "Settings saved" : "Failed to save");
    } catch { showMsg("err", "Failed to save settings"); }
    setLoading("");
  };

  const triggerWorkflow = async (workflow: string) => {
    setLoading("workflow");
    setWorkflowStatus(`Dispatching ${workflow}...`);
    try {
      const data = await apiCall("admin-trigger-workflow", { workflow, filter_id: workflowFilterId });
      showMsg(data.ok ? "ok" : "err", data.ok ? `${workflow} dispatched` : "Dispatch failed");
      setWorkflowStatus(data.ok ? `${workflow} dispatched successfully` : "Dispatch failed");
    } catch { showMsg("err", "Dispatch failed"); setWorkflowStatus("Dispatch failed"); }
    setLoading("");
  };

  const deleteEntry = async (id: string) => {
    if (!confirm(`Delete ${id}?`)) return;
    setLoading("delete-" + id);
    try {
      const data = await apiCall("admin-delete-entry", { entryId: id });
      if (data.ok) { setEntries(prev => prev.filter(e => e.id !== id)); showMsg("ok", "Deleted"); }
      else showMsg("err", data.error || "Failed");
    } catch { showMsg("err", "Delete failed"); }
    setLoading("");
  };

  const toggleVisibility = async (id: string) => {
    setLoading("vis-" + id);
    try {
      const data = await apiCall("admin-toggle-visibility", { entryId: id });
      if (data.ok) setEntries(prev => prev.map(e => e.id === id ? { ...e, hiddenFromPublicLibrary: !e.hiddenFromPublicLibrary } : e));
      showMsg("ok", "Toggled");
    } catch { showMsg("err", "Failed"); }
    setLoading("");
  };

  const saveExclusions = async () => {
    setLoading("save-excl");
    try {
      const data = await apiCall("admin-save-exclusions", { exclusions });
      showMsg(data.ok ? "ok" : "err", data.ok ? "Exclusions saved" : "Failed");
    } catch { showMsg("err", "Failed"); }
    setLoading("");
  };

  const addRule = () => {
    if (!newRule.pattern) return;
    setExclusions(prev => ({ ...prev, rules: [...prev.rules, { ...newRule }] }));
    setNewRule({ enabled: true, type: "contains", field: "all", pattern: "", flags: "i" });
  };

  const removeRule = (idx: number) => {
    setExclusions(prev => ({ ...prev, rules: prev.rules.filter((_, i) => i !== idx) }));
  };

  const toggleRule = (idx: number) => {
    setExclusions(prev => ({
      ...prev,
      rules: prev.rules.map((r, i) => i === idx ? { ...r, enabled: !r.enabled } : r),
    }));
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selectedEntries.size} selected entries?`)) return;
    for (const id of selectedEntries) {
      await apiCall("admin-delete-entry", { entryId: id });
    }
    setEntries(prev => prev.filter(e => !selectedEntries.has(e.id)));
    setSelectedEntries(new Set());
    showMsg("ok", `Deleted ${selectedEntries.size} entries`);
  };

  const bulkToggleVisibility = async () => {
    for (const id of selectedEntries) {
      await apiCall("admin-toggle-visibility", { entryId: id });
    }
    setEntries(prev => prev.map(e => selectedEntries.has(e.id) ? { ...e, hiddenFromPublicLibrary: !e.hiddenFromPublicLibrary } : e));
    setSelectedEntries(new Set());
    showMsg("ok", `Toggled visibility for ${selectedEntries.size} entries`);
  };

  const filteredEntries = entries.filter(e => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (e.id || "").toLowerCase().includes(q) || (e.title || "").toLowerCase().includes(q) || (e.ownerEmail || "").toLowerCase().includes(q) || (e.ownerName || "").toLowerCase().includes(q);
  });

  const totalViews = entries.length;
  const hiddenCount = entries.filter(e => e.hiddenFromPublicLibrary).length;
  const googleUsers = users.filter(u => u.email);
  const anonUsers = users.filter(u => !u.email && u.anonId);

  const blocks = [
    { icon: "⚙️", label: "Site Settings" },
    { icon: "🎬", label: "Video Pipeline" },
    { icon: "🛡️", label: "Content Moderation" },
    { icon: "👥", label: "User Management" },
    { icon: "📊", label: "Analytics" },
    { icon: "🔧", label: "System" },
  ];

  return (
    <div className="admin-panel">
      <header className="admin-header">
        <div className="admin-header-left">
          <h1>Administrator</h1>
          <span className="admin-badge">ADMIN</span>
        </div>
        <div className="admin-header-right">
          <span className="admin-user">{googleUser?.name || googleUser?.email}</span>
          <button className="admin-btn admin-btn-ghost" onClick={onSignOut}>Sign out</button>
          <a className="admin-btn admin-btn-ghost" href="/">Home</a>
        </div>
      </header>

      {message && (
        <div className={`admin-message admin-message-${message.type}`}>{message.text}</div>
      )}

      <nav className="admin-nav">
        {blocks.map((b, i) => (
          <button
            key={i}
            className={`admin-nav-item ${activeBlock === i ? "active" : ""}`}
            onClick={() => setActiveBlock(i)}
          >
            <span className="admin-nav-icon">{b.icon}</span>
            <span className="admin-nav-label">{b.label}</span>
          </button>
        ))}
      </nav>

      <main className="admin-content">
        {activeBlock === 0 && (
          <section className="admin-block">
            <h2>Site Settings</h2>
            <p className="admin-desc">Global toggles that affect all visitors. Changes are saved to GitHub and applied immediately.</p>

            <div className="admin-setting-group">
              <h3>Video Preview Quality</h3>
              <label className="admin-toggle">
                <input type="checkbox" checked={!settings.disableHighQuality} onChange={e => setSettings(s => ({ ...s, disableHighQuality: !e.target.checked }))} />
                <span className="admin-toggle-slider" />
                <span>High quality video preview (1920px)</span>
              </label>
              <label className="admin-toggle">
                <input type="checkbox" checked={!settings.disableMediumQuality} onChange={e => setSettings(s => ({ ...s, disableMediumQuality: !e.target.checked }))} />
                <span className="admin-toggle-slider" />
                <span>Medium quality video preview (960px)</span>
              </label>
              <label className="admin-toggle">
                <input type="checkbox" checked={!settings.disableLowQuality} onChange={e => setSettings(s => ({ ...s, disableLowQuality: !e.target.checked }))} />
                <span className="admin-toggle-slider" />
                <span>Low quality video preview (480px)</span>
              </label>
            </div>

            <div className="admin-setting-group">
              <h3>Progressive Loading</h3>
              <label className="admin-toggle">
                <input type="checkbox" checked={!settings.disableProgressiveLoading} onChange={e => setSettings(s => ({ ...s, disableProgressiveLoading: !e.target.checked }))} />
                <span className="admin-toggle-slider" />
                <span>Enable progressive loading (WebP → video)</span>
              </label>
            </div>

            <div className="admin-setting-group">
              <h3>Maintenance</h3>
              <label className="admin-toggle">
                <input type="checkbox" checked={!!settings.maintenanceMode} onChange={e => setSettings(s => ({ ...s, maintenanceMode: e.target.checked }))} />
                <span className="admin-toggle-slider" />
                <span>Maintenance mode (blocks all uploads)</span>
              </label>
              <div className="admin-field">
                <label>Custom message shown to visitors</label>
                <input
                  type="text"
                  value={settings.customMessage || ""}
                  onChange={e => setSettings(s => ({ ...s, customMessage: e.target.value }))}
                  placeholder="Site is under maintenance..."
                />
              </div>
            </div>

            <button className="admin-btn admin-btn-primary" onClick={saveSettings} disabled={loading === "save-settings"}>
              {loading === "save-settings" ? "Saving..." : "Save Settings"}
            </button>
          </section>
        )}

        {activeBlock === 1 && (
          <section className="admin-block">
            <h2>Video Pipeline</h2>
            <p className="admin-desc">Trigger GitHub Actions workflows for video/WebM/WebP export.</p>

            <div className="admin-pipeline-grid">
              <div className="admin-pipeline-card">
                <h3>Re-export All</h3>
                <p>Run full matrix export for all 175+ animations. Generates WebM, WebP, and MP4 at all quality levels.</p>
                <div className="admin-field">
                  <label>Optional filter ID (leave blank for all)</label>
                  <input
                    type="text"
                    value={workflowFilterId}
                    onChange={e => setWorkflowFilterId(e.target.value)}
                    placeholder="Entry ID..."
                  />
                </div>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={() => triggerWorkflow("spine-export-all.yml")}
                  disabled={loading === "workflow"}
                >
                  {loading === "workflow" ? "Dispatching..." : "🚀 Trigger Full Export"}
                </button>
              </div>

              <div className="admin-pipeline-card">
                <h3>Re-export Single Entry</h3>
                <p>Export WebM preview for a specific upload ID. Use the entry ID from the library.</p>
                <div className="admin-field">
                  <label>Upload ID</label>
                  <input
                    type="text"
                    value={workflowFilterId}
                    onChange={e => setWorkflowFilterId(e.target.value)}
                    placeholder="Entry ID to export..."
                  />
                </div>
                <button
                  className="admin-btn admin-btn-primary"
                  onClick={() => triggerWorkflow("spine-export-webm.yml")}
                  disabled={loading === "workflow" || !workflowFilterId}
                >
                  {loading === "workflow" ? "Dispatching..." : "📹 Trigger Single Export"}
                </button>
              </div>

              <div className="admin-pipeline-card">
                <h3>Pipeline Status</h3>
                {workflowStatus ? (
                  <div className={`admin-status ${workflowStatus.includes("success") ? "admin-status-ok" : workflowStatus.includes("fail") ? "admin-status-err" : ""}`}>
                    {workflowStatus}
                  </div>
                ) : (
                  <p className="admin-muted">No workflows triggered yet this session.</p>
                )}
                <p className="admin-muted">Check GitHub Actions for real-time status.</p>
                <a
                  className="admin-btn admin-btn-outline"
                  href="https://github.com/vladleopold/spine/actions"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open GitHub Actions →
                </a>
              </div>
            </div>
          </section>
        )}

        {activeBlock === 2 && (
          <section className="admin-block">
            <h2>Content Moderation</h2>
            <p className="admin-desc">Manage archive entries, visibility, and exclusion rules.</p>

            <div className="admin-toolbar">
              <input
                type="text"
                className="admin-search"
                placeholder="Search entries by ID, title, owner..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <span className="admin-count">{filteredEntries.length} / {entries.length} entries</span>
              {selectedEntries.size > 0 && (
                <div className="admin-bulk-actions">
                  <span>{selectedEntries.size} selected</span>
                  <button className="admin-btn admin-btn-sm" onClick={bulkToggleVisibility}>Toggle Visibility</button>
                  <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={bulkDelete}>Delete Selected</button>
                  <button className="admin-btn admin-btn-sm admin-btn-ghost" onClick={() => setSelectedEntries(new Set())}>Clear</button>
                </div>
              )}
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th><input type="checkbox" onChange={e => {
                      if (e.target.checked) setSelectedEntries(new Set(filteredEntries.map(en => en.id)));
                      else setSelectedEntries(new Set());
                    }} checked={selectedEntries.size === filteredEntries.length && filteredEntries.length > 0} /></th>
                    <th>Title</th>
                    <th>Owner</th>
                    <th>Anims</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.slice(0, 100).map(e => (
                    <tr key={e.id} className={e.hiddenFromPublicLibrary ? "admin-row-hidden" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedEntries.has(e.id)}
                          onChange={() => {
                            setSelectedEntries(prev => {
                              const next = new Set(prev);
                              if (next.has(e.id)) next.delete(e.id);
                              else next.add(e.id);
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td className="admin-td-id" title={e.id}>{e.title || e.id?.slice(0, 30)}</td>
                      <td>{e.ownerName || e.ownerEmail || "—"}</td>
                      <td>{e.animations || 0}</td>
                      <td>{e.pageMode || "—"}</td>
                      <td>{e.hiddenFromPublicLibrary ? <span className="admin-badge admin-badge-hidden">Hidden</span> : <span className="admin-badge admin-badge-visible">Visible</span>}</td>
                      <td className="admin-actions">
                        <button className="admin-btn admin-btn-sm admin-btn-ghost" onClick={() => toggleVisibility(e.id)} disabled={loading === "vis-" + e.id}>
                          {e.hiddenFromPublicLibrary ? "Show" : "Hide"}
                        </button>
                        <a className="admin-btn admin-btn-sm admin-btn-ghost" href={`/p/${encodeURIComponent(e.id)}`} target="_blank">View</a>
                        <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => deleteEntry(e.id)} disabled={loading === "delete-" + e.id}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="admin-exclusions">
              <h3>Archive Exclusion Rules</h3>
              <p className="admin-desc">Entries matching these rules are hidden from the public archive feed.</p>

              <div className="admin-rules-list">
                {exclusions.rules.map((rule, idx) => (
                  <div key={idx} className="admin-rule">
                    <label className="admin-toggle admin-toggle-sm">
                      <input type="checkbox" checked={rule.enabled} onChange={() => toggleRule(idx)} />
                      <span className="admin-toggle-slider" />
                    </label>
                    <span className="admin-rule-field">{rule.field}</span>
                    <span className="admin-rule-type">{rule.type}</span>
                    <code className="admin-rule-pattern">{rule.pattern}</code>
                    <button className="admin-btn admin-btn-sm admin-btn-danger" onClick={() => removeRule(idx)}>×</button>
                  </div>
                ))}
              </div>

              <div className="admin-add-rule">
                <select value={newRule.field} onChange={e => setNewRule(r => ({ ...r, field: e.target.value }))}>
                  <option value="all">all</option>
                  <option value="id">id</option>
                  <option value="title">title</option>
                  <option value="ownerEmail">ownerEmail</option>
                  <option value="ownerName">ownerName</option>
                  <option value="note">note</option>
                  <option value="files">files</option>
                  <option value="animations">animations</option>
                </select>
                <select value={newRule.type} onChange={e => setNewRule(r => ({ ...r, type: e.target.value }))}>
                  <option value="contains">contains</option>
                  <option value="regex">regex</option>
                </select>
                <input
                  type="text"
                  placeholder="pattern..."
                  value={newRule.pattern}
                  onChange={e => setNewRule(r => ({ ...r, pattern: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter") addRule(); }}
                />
                <button className="admin-btn admin-btn-sm admin-btn-primary" onClick={addRule}>Add Rule</button>
              </div>

              <button className="admin-btn admin-btn-primary" onClick={saveExclusions} disabled={loading === "save-excl"}>
                {loading === "save-excl" ? "Saving..." : "Save Exclusion Rules"}
              </button>
            </div>
          </section>
        )}

        {activeBlock === 3 && (
          <section className="admin-block">
            <h2>User Management</h2>
            <p className="admin-desc">Overview of all registered users (Google and anonymous).</p>

            <div className="admin-stats-row">
              <div className="admin-stat-card">
                <div className="admin-stat-num">{users.length}</div>
                <div className="admin-stat-label">Total Users</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-num">{googleUsers.length}</div>
                <div className="admin-stat-label">Google Users</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-num">{anonUsers.length}</div>
                <div className="admin-stat-label">Anonymous Users</div>
              </div>
            </div>

            <h3>Google Users</h3>
            <table className="admin-table">
              <thead>
                <tr><th>Email</th><th>Name</th><th>Entries</th></tr>
              </thead>
              <tbody>
                {googleUsers.map(u => (
                  <tr key={u.email}>
                    <td>{u.email}</td>
                    <td>{u.name || "—"}</td>
                    <td>{u.entries}</td>
                  </tr>
                ))}
                {googleUsers.length === 0 && <tr><td colSpan={3} className="admin-muted">No Google users found.</td></tr>}
              </tbody>
            </table>

            <h3>Anonymous Users</h3>
            <table className="admin-table">
              <thead>
                <tr><th>Anon ID</th><th>Entries</th></tr>
              </thead>
              <tbody>
                {anonUsers.slice(0, 50).map(u => (
                  <tr key={u.anonId}>
                    <td className="admin-td-id">{u.anonId}</td>
                    <td>{u.entries}</td>
                  </tr>
                ))}
                {anonUsers.length === 0 && <tr><td colSpan={2} className="admin-muted">No anonymous users found.</td></tr>}
              </tbody>
            </table>
          </section>
        )}

        {activeBlock === 4 && (
          <section className="admin-block">
            <h2>Analytics</h2>
            <p className="admin-desc">Library statistics and metrics overview.</p>

            <div className="admin-stats-row">
              <div className="admin-stat-card">
                <div className="admin-stat-num">{entries.length}</div>
                <div className="admin-stat-label">Total Entries</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-num">{entries.filter(e => !e.hiddenFromPublicLibrary).length}</div>
                <div className="admin-stat-label">Visible</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-num">{hiddenCount}</div>
                <div className="admin-stat-label">Hidden</div>
              </div>
              <div className="admin-stat-card">
                <div className="admin-stat-num">{entries.reduce((s, e) => s + (e.animations || 0), 0)}</div>
                <div className="admin-stat-label">Total Animations</div>
              </div>
            </div>

            <h3>Top Entries by Animation Count</h3>
            <table className="admin-table">
              <thead>
                <tr><th>Title</th><th>Owner</th><th>Animations</th><th>Mode</th></tr>
              </thead>
              <tbody>
                {[...entries].sort((a, b) => (b.animations || 0) - (a.animations || 0)).slice(0, 20).map(e => (
                  <tr key={e.id}>
                    <td>{e.title || e.id}</td>
                    <td>{e.ownerName || e.ownerEmail || "—"}</td>
                    <td>{e.animations || 0}</td>
                    <td>{e.pageMode || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeBlock === 5 && (
          <section className="admin-block">
            <h2>System Maintenance</h2>
            <p className="admin-desc">Cache management, rebuild operations, and system utilities.</p>

            <div className="admin-pipeline-grid">
              <div className="admin-pipeline-card">
                <h3>Content Cache</h3>
                <p>Force rebuild of the in-memory GitHub content cache on all Vercel instances.</p>
                <button className="admin-btn admin-btn-primary" onClick={async () => {
                  setLoading("rebuild");
                  try { await apiCall("admin-rebuild-cache"); showMsg("ok", "Cache rebuild triggered"); }
                  catch { showMsg("err", "Failed"); }
                  setLoading("");
                }}>
                  {loading === "rebuild" ? "Rebuilding..." : "🔄 Rebuild Cache"}
                </button>
              </div>

              <div className="admin-pipeline-card">
                <h3>CDN Cache</h3>
                <p>Redeploy the site to force CDN cache invalidation on Vercel.</p>
                <button className="admin-btn admin-btn-primary" onClick={async () => {
                  setLoading("cdn");
                  try {
                    const res = await fetch("/api/github-upload", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "same-origin",
                      body: JSON.stringify({ action: "admin-rebuild-cache" }),
                    });
                    showMsg("ok", "Redeploy to invalidate CDN: run `npx vercel --prod`");
                  } catch { showMsg("err", "Failed"); }
                  setLoading("");
                }}>
                  {loading === "cdn" ? "Processing..." : "🌐 Invalidation Info"}
                </button>
              </div>

              <div className="admin-pipeline-card">
                <h3>Re-export All Videos</h3>
                <p>Dispatch the full matrix export to regenerate all WebM/WebP/MP4 files.</p>
                <button className="admin-btn admin-btn-primary" onClick={() => { setActiveBlock(1); }}>
                  Go to Video Pipeline →
                </button>
              </div>
            </div>

            <div className="admin-system-info">
              <h3>System Info</h3>
              <dl className="admin-dl">
                <dt>Repository</dt><dd>vladleopold/spine</dd>
                <dt>Branch</dt><dd>main</dd>
                <dt>Total entries</dt><dd>{entries.length || "—"}</dd>
                <dt>Admin email</dt><dd>{googleUser?.email}</dd>
              </dl>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default AdminPanel;
