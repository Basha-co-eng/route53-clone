/* ===== Config ===== */
const API = "https://route53-clone-gbpz.onrender.com";
const PAGE_SIZE = 10;
const RECORD_TYPES = ["A","AAAA","CNAME","TXT","MX","NS","PTR","SRV","CAA","SOA"];
const HINTS = {
  A:"IPv4 address, e.g. 192.0.2.1", AAAA:"IPv6 address, e.g. 2001:db8::1",
  CNAME:"Domain name, e.g. www.example.com", TXT:"Text, e.g. \"v=spf1 -all\"",
  MX:"Priority and domain, e.g. 10 mail.example.com", NS:"Name server, one per line",
  PTR:"Domain name, e.g. host.example.com", SRV:"priority weight port target, e.g. 1 10 5269 xmpp.example.com",
  CAA:"flags tag value, e.g. 0 issue \"ca.example.net\"", SOA:"Managed by Route 53"
};

/* ===== Helpers ===== */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const token = () => localStorage.getItem("token");

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { localStorage.removeItem("token"); route(); throw new Error("Session expired"); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Request failed"); }
  return res.status === 204 ? null : res.json();
}

function toast(msg, error = false) {
  const t = document.createElement("div");
  t.className = "toast" + (error ? " error" : "");
  t.textContent = msg;
  $("#toast-root").appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function modal({ title, body, confirmText = "Save", danger = false, onConfirm }) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="overlay"><div class="modal"><h2>${esc(title)}</h2>
    <div class="body">${body}</div>
    <div class="foot"><button class="btn" id="m-cancel">Cancel</button>
    <button class="btn ${danger ? "danger" : "primary"}" id="m-ok">${esc(confirmText)}</button></div></div></div>`;
  const close = () => (root.innerHTML = "");
  $("#m-cancel").onclick = close;
  $("#m-ok").onclick = async () => {
    $("#m-ok").disabled = true;
    try { await onConfirm(root); close(); }
    catch (e) { toast(e.message, true); $("#m-ok").disabled = false; }
  };
}

/* ===== Auth ===== */
$("#login-form").onsubmit = async e => {
  e.preventDefault();
  try {
    const res = await fetch(API + "/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: $("#login-user").value, password: $("#login-pass").value }),
    });
    if (!res.ok) throw new Error("Incorrect username or password");
    localStorage.setItem("token", (await res.json()).token);
    $("#login-error").textContent = "";
    route();
  } catch (err) { $("#login-error").textContent = err.message; }
};
$("#logout-btn").onclick = async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  localStorage.removeItem("token"); location.hash = ""; route();
};

/* ===== Router ===== */
const SOON = { dashboard:"Dashboard", healthchecks:"Health checks", trafficpolicies:"Traffic policies", resolver:"Resolver", profiles:"Profiles" };

function route() {
  const loggedIn = !!token();
  $("#login-view").classList.toggle("hidden", loggedIn);
  $("#app-view").classList.toggle("hidden", !loggedIn);
  if (!loggedIn) return;
  const [, page, id] = (location.hash || "#/hostedzones").split("/");
  document.querySelectorAll(".sidebar a").forEach(a =>
    a.classList.toggle("active", a.getAttribute("href") === "#/" + (page === "zone" ? "hostedzones" : page)));
  if (page === "zone") return renderRecords(id);
  if (SOON[page]) return ($("#content").innerHTML = `<div class="box soon"><h2>${SOON[page]}</h2><p>Coming soon</p></div>`);
  renderZones();
}
window.addEventListener("hashchange", route);

/* ===== Hosted zones ===== */
const zs = { search: "", page: 1, selected: null };

async function renderZones() {
  const c = $("#content");
  if (!$("#zone-table")) {
    c.innerHTML = `<div class="crumbs">Route 53 &gt; Hosted zones</div>
      <div class="page-head"><h1>Hosted zones</h1></div>
      <div class="box"><div class="box-head"><h2>Hosted zones <span class="count" id="z-count"></span></h2><div class="spacer"></div>
        <button class="btn" id="z-view">View details</button><button class="btn" id="z-edit">Edit</button>
        <button class="btn" id="z-del">Delete</button><button class="btn primary" id="z-new">Create hosted zone</button></div>
      <div class="toolbar"><input type="text" id="z-search" placeholder="Filter hosted zones by property or value" value="${esc(zs.search)}">
        <div class="pager" id="z-pager"></div></div>
      <div id="zone-table"></div></div>`;
    let t; $("#z-search").oninput = e => { clearTimeout(t); t = setTimeout(() => { zs.search = e.target.value; zs.page = 1; loadZones(); }, 250); };
    $("#z-new").onclick = () => zoneForm();
    $("#z-view").onclick = () => zs.selected && (location.hash = "#/zone/" + zs.selected.id);
    $("#z-edit").onclick = () => zs.selected && zoneForm(zs.selected);
    $("#z-del").onclick = () => zs.selected && deleteZone(zs.selected);
  }
  loadZones();
}

async function loadZones() {
  try {
    const q = new URLSearchParams({ search: zs.search, page: zs.page, page_size: PAGE_SIZE });
    const { items, total } = await api("/zones?" + q);
    zs.selected = null; syncZoneButtons();
    $("#z-count").textContent = `(${total})`;
    $("#zone-table").innerHTML = items.length ? `<table><thead><tr><th></th><th>Hosted zone name</th><th>Type</th>
      <th>Created by</th><th>Record count</th><th>Description</th><th>Hosted zone ID</th></tr></thead><tbody>
      ${items.map(z => `<tr data-id="${z.id}"><td><input type="radio" name="zsel"></td>
        <td><a href="#/zone/${z.id}">${esc(z.name)}</a></td><td>${esc(z.type)} hosted zone</td><td>Route 53</td>
        <td>${z.record_count}</td><td>${esc(z.description) || "-"}</td><td>Z${String(z.id).padStart(10, "0")}</td></tr>`).join("")}
      </tbody></table>` : `<div class="empty">No hosted zones found.</div>`;
    document.querySelectorAll("#zone-table tbody tr").forEach((tr, i) => tr.onclick = () => {
      zs.selected = items[i]; tr.querySelector("input").checked = true;
      document.querySelectorAll("#zone-table tr").forEach(r => r.classList.remove("sel")); tr.classList.add("sel"); syncZoneButtons();
    });
    pager("#z-pager", zs, total, loadZones);
  } catch (e) { toast(e.message, true); }
}
const syncZoneButtons = () => ["z-view","z-edit","z-del"].forEach(id => { const b = $("#" + id); if (b) b.disabled = !zs.selected; });

function pager(sel, state, total, reload) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  $(sel).innerHTML = `<button ${state.page <= 1 ? "disabled" : ""} data-d="-1">&lsaquo;</button>${state.page} of ${pages}
    <button ${state.page >= pages ? "disabled" : ""} data-d="1">&rsaquo;</button>`;
  $(sel).querySelectorAll("button").forEach(b => b.onclick = () => { state.page += +b.dataset.d; reload(); });
}

function zoneForm(zone) {
  modal({
    title: zone ? "Edit hosted zone" : "Create hosted zone", confirmText: zone ? "Save changes" : "Create hosted zone",
    body: `<div class="field"><label>Domain name</label><input id="f-name" value="${esc(zone?.name)}" ${zone ? "disabled" : ""} placeholder="example.com">
      <small>The domain name of the website or application that you want to route traffic for.</small></div>
      <div class="field"><label>Description - optional</label><textarea id="f-desc" style="font-family:inherit">${esc(zone?.description)}</textarea></div>
      <div class="field"><label>Type</label><select id="f-type" ${zone ? "disabled" : ""}>
        <option ${zone?.type === "Public" ? "selected" : ""}>Public</option><option ${zone?.type === "Private" ? "selected" : ""}>Private</option></select></div>`,
    onConfirm: async () => {
      const body = { name: $("#f-name").value.trim(), description: $("#f-desc").value.trim(), type: $("#f-type").value };
      if (!zone && !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(body.name)) throw new Error("Invalid domain name");
      zone ? await api("/zones/" + zone.id, { method: "PUT", body }) : await api("/zones", { method: "POST", body });
      toast(zone ? "Hosted zone updated." : `Successfully created hosted zone ${body.name}`); loadZones();
    },
  });
}

function deleteZone(z) {
  modal({
    title: "Delete hosted zone", confirmText: "Delete", danger: true,
    body: `<p>Delete <b>${esc(z.name)}</b> and all of its records? This cannot be undone.</p>
      <div class="field"><label>Type "delete" to confirm</label><input id="f-confirm"></div>`,
    onConfirm: async () => {
      if ($("#f-confirm").value !== "delete") throw new Error('Type "delete" to confirm');
      await api("/zones/" + z.id, { method: "DELETE" }); toast(`Successfully deleted hosted zone ${z.name}`); loadZones();
    },
  });
}

/* ===== Records ===== */
const rs = { search: "", type: "", page: 1, selected: null, zone: null };

async function renderRecords(zoneId) {
  try { rs.zone = await api("/zones/" + zoneId); } catch (e) { toast(e.message, true); return (location.hash = "#/hostedzones"); }
  Object.assign(rs, { search: "", type: "", page: 1, selected: null });
  $("#content").innerHTML = `<div class="crumbs"><a href="#/hostedzones">Hosted zones</a> &gt; ${esc(rs.zone.name)}</div>
    <div class="page-head"><h1>${esc(rs.zone.name)}</h1></div>
    <div class="box"><div class="box-head"><h2>Records <span class="count" id="r-count"></span></h2><div class="spacer"></div>
      <button class="btn" id="r-edit">Edit record</button><button class="btn" id="r-del">Delete record</button>
      <button class="btn primary" id="r-new">Create record</button></div>
    <div class="toolbar"><input type="text" id="r-search" placeholder="Filter records by property or value">
      <select id="r-type"><option value="">Type: all</option>${RECORD_TYPES.map(t => `<option>${t}</option>`).join("")}</select>
      <div class="pager" id="r-pager"></div></div><div id="rec-table"></div></div>`;
  let t; $("#r-search").oninput = e => { clearTimeout(t); t = setTimeout(() => { rs.search = e.target.value; rs.page = 1; loadRecords(); }, 250); };
  $("#r-type").onchange = e => { rs.type = e.target.value; rs.page = 1; loadRecords(); };
  $("#r-new").onclick = () => recordForm();
  $("#r-edit").onclick = () => rs.selected && recordForm(rs.selected);
  $("#r-del").onclick = () => rs.selected && deleteRecord(rs.selected);
  loadRecords();
}

async function loadRecords() {
  try {
    const q = new URLSearchParams({ search: rs.search, type: rs.type, page: rs.page, page_size: PAGE_SIZE });
    const { items, total } = await api(`/zones/${rs.zone.id}/records?${q}`);
    rs.selected = null; syncRecButtons();
    $("#r-count").textContent = `(${total})`;
    $("#rec-table").innerHTML = items.length ? `<table><thead><tr><th></th><th>Record name</th><th>Type</th><th>Routing policy</th>
      <th>Value/Route traffic to</th><th>TTL (seconds)</th></tr></thead><tbody>
      ${items.map(r => `<tr><td><input type="radio" name="rsel"></td><td>${esc(r.name)}</td><td>${esc(r.type)}</td>
        <td>${esc(r.routing_policy || "Simple")}</td><td>${esc(r.value).replace(/\n/g, "<br>")}</td><td>${r.ttl}</td></tr>`).join("")}
      </tbody></table>` : `<div class="empty">No records found.</div>`;
    document.querySelectorAll("#rec-table tbody tr").forEach((tr, i) => tr.onclick = () => {
      rs.selected = items[i]; tr.querySelector("input").checked = true;
      document.querySelectorAll("#rec-table tr").forEach(r => r.classList.remove("sel")); tr.classList.add("sel"); syncRecButtons();
    });
    pager("#r-pager", rs, total, loadRecords);
  } catch (e) { toast(e.message, true); }
}
const syncRecButtons = () => {
  const locked = !rs.selected || ["SOA","NS"].includes(rs.selected.type) && rs.selected.name === rs.zone.name;
  ["r-edit","r-del"].forEach(id => $("#" + id).disabled = locked);
};

function validateRecord(type, value) {
  const v4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  const v6 = /^[0-9a-f:]+$/i;
  const lines = value.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return "Value is required";
  for (const l of lines) {
    if (type === "A" && !v4.test(l)) return "A record needs a valid IPv4 address";
    if (type === "AAAA" && !(v6.test(l) && l.includes(":"))) return "AAAA record needs a valid IPv6 address";
    if (type === "MX" && !/^\d+\s+\S+$/.test(l)) return "MX format: priority domain";
    if (type === "SRV" && !/^\d+\s+\d+\s+\d+\s+\S+$/.test(l)) return "SRV format: priority weight port target";
    if (type === "CAA" && !/^\d+\s+(issue|issuewild|iodef)\s+.+$/.test(l)) return "CAA format: flags tag value";
  }
  if (type === "CNAME" && lines.length > 1) return "CNAME allows only one value";
  return null;
}

function recordForm(rec) {
  modal({
    title: rec ? "Edit record" : "Create record", confirmText: rec ? "Save" : "Create records",
    body: `<div class="field"><label>Record name</label><div style="display:flex;gap:6px;align-items:center">
        <input id="f-rname" value="${esc(rec ? rec.name.replace(new RegExp("\\.?" + rs.zone.name.replace(/\./g, "\\.") + "$"), "") : "")}" placeholder="subdomain"><span>.${esc(rs.zone.name)}</span></div>
        <small>Leave blank to create a record for the root domain.</small></div>
      <div class="field"><label>Record type</label><select id="f-rtype">${RECORD_TYPES.filter(t => t !== "SOA").map(t => `<option ${rec?.type === t ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="field"><label>Value</label><textarea id="f-rval">${esc(rec?.value)}</textarea><small id="f-hint"></small></div>
      <div class="field"><label>TTL (seconds)</label><input id="f-ttl" type="number" min="0" value="${rec?.ttl ?? 300}"></div>`,
    onConfirm: async () => {
      const type = $("#f-rtype").value, value = $("#f-rval").value.trim(), ttl = +$("#f-ttl").value;
      const err = validateRecord(type, value); if (err) throw new Error(err);
      if (!(ttl >= 0 && ttl <= 2147483647)) throw new Error("TTL must be between 0 and 2147483647");
      const sub = $("#f-rname").value.trim().toLowerCase();
      const body = { name: sub ? `${sub}.${rs.zone.name}` : rs.zone.name, type, value, ttl, routing_policy: "Simple" };
      const url = `/zones/${rs.zone.id}/records` + (rec ? "/" + rec.id : "");
      await api(url, { method: rec ? "PUT" : "POST", body });
      toast(rec ? "Record updated." : "Record created."); loadRecords();
    },
  });
  const hint = () => $("#f-hint").textContent = HINTS[$("#f-rtype").value];
  $("#f-rtype").onchange = hint; hint();
}

function deleteRecord(r) {
  modal({
    title: "Delete record", confirmText: "Delete", danger: true,
    body: `<p>Delete the <b>${esc(r.type)}</b> record <b>${esc(r.name)}</b>?</p>`,
    onConfirm: async () => { await api(`/zones/${rs.zone.id}/records/${r.id}`, { method: "DELETE" }); toast("Record deleted."); loadRecords(); },
  });
}

route();
