const SUPABASE_URL = "https://bvlkkbjgwacfzllcgjyx.supabase.co";
const SUPABASE_KEY = "sb_publishable_EW0C1nW88WbOHHkj8h2d8w_Nri8dcrK";
const SESSION_KEY = "viatchau_admin_session";

const state = {
  session: readJson(SESSION_KEY),
  requests: [],
  accesses: [],
  events: [],
  confirmAction: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

function saveJson(key, value) {
  if (value) localStorage.setItem(key, JSON.stringify(value));
  else localStorage.removeItem(key);
}

function setStatus(selector, message, kind = "") {
  const element = $(selector);
  element.textContent = message || "";
  element.className = `status ${kind}`.trim();
}

function headers(authenticated = false) {
  const result = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  result.Authorization = `Bearer ${authenticated && state.session?.access_token ? state.session.access_token : SUPABASE_KEY}`;
  return result;
}

async function api(path, options = {}, authenticated = false) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { ...headers(authenticated), ...(options.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    if (response.status === 401 && authenticated && state.session?.refresh_token) {
      await refreshSession();
      return api(path, options, authenticated);
    }
    throw new Error(body?.error_description || body?.message || body?.error || `Falha HTTP ${response.status}`);
  }
  return body;
}

async function rpc(name, params = {}, authenticated = false) {
  return api(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(params) }, authenticated);
}

async function refreshSession() {
  const refreshToken = state.session?.refresh_token;
  if (!refreshToken) throw new Error("Sessao expirada.");
  const next = await api("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  state.session = next;
  saveJson(SESSION_KEY, next);
}

async function requestAdminCode(email) {
  await api("/functions/v1/viatchau-access", {
    method: "POST",
    body: JSON.stringify({ action: "admin-code", email }),
  });
}

async function verifyCode(email, code) {
  const session = await api("/auth/v1/verify", {
    method: "POST",
    body: JSON.stringify({ email, token: code, type: "magiclink" }),
  });
  state.session = session;
  saveJson(SESSION_KEY, session);
  await rpc("viatchau_admin_listar_solicitacoes", { p_status: "PENDENTE" }, true);
}

async function handleLogin(event) {
  event.preventDefault();
  const button = $("#login-button");
  const email = $("#email").value.trim().toLowerCase();
  const codeVisible = !$("#code-group").classList.contains("hidden");
  button.disabled = true;
  setStatus("#login-status", codeVisible ? "Validando codigo..." : "Enviando codigo...");
  try {
    if (!codeVisible) {
      await requestAdminCode(email);
      $("#code-group").classList.remove("hidden");
      $("#code").required = true;
      $("#login-button").textContent = "Entrar no painel";
      setStatus("#login-status", "Codigo enviado ao email administrativo.", "success");
      $("#code").focus();
    } else {
      const code = $("#code").value.replace(/\D/g, "");
      if (code.length !== 6) throw new Error("Digite os 6 numeros recebidos por email.");
      await verifyCode(email, code);
      await showAdmin();
    }
  } catch (error) {
    setStatus("#login-status", error.message || "Nao foi possivel entrar.", "error");
  } finally {
    button.disabled = false;
  }
}

async function loadData() {
  setStatus("#admin-status", "Atualizando dados...");
  const [requests, accesses, events] = await Promise.all([
    rpc("viatchau_admin_listar_solicitacoes", { p_status: null }, true),
    rpc("viatchau_admin_listar_acessos", {}, true),
    rpc("viatchau_admin_listar_eventos", {}, true),
  ]);
  state.requests = requests || [];
  state.accesses = accesses || [];
  state.events = events || [];
  renderAll();
  setStatus("#admin-status", `Atualizado em ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`, "success");
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function statusMarkup(status) {
  const good = ["APROVADO", "CODIGO_ENVIADO", "CONCLUIDO"].includes(status);
  const bad = ["RECUSADO", "EXPIRADO"].includes(status);
  return `<span class="state ${good ? "good" : bad ? "bad" : "pending"}">${escapeText(status)}</span>`;
}

function renderRequests() {
  const body = $("#requests-body");
  const filter = $("#request-filter").value;
  const requests = filter ? state.requests.filter((item) => item.status === filter) : state.requests;
  if (!requests.length) {
    body.innerHTML = '<tr><td class="empty" colspan="6">Nenhuma solicitacao nesta lista.</td></tr>';
    return;
  }
  body.innerHTML = requests.map((item) => {
    const actions = item.status === "PENDENTE"
      ? `<button class="button primary small" data-approve="${item.id}">Aprovar</button><button class="button ghost small" data-reject="${item.id}">Recusar</button>`
      : '<span class="muted">-</span>';
    return `<tr><td>${escapeText(item.email)}</td><td>${escapeText(item.machine_name || "-")}</td><td>${escapeText(item.app_version || "-")}</td><td>${formatDate(item.solicitado_em)}</td><td>${statusMarkup(item.status)}</td><td class="actions">${actions}</td></tr>`;
  }).join("");
}

function renderAccesses() {
  const body = $("#access-body");
  if (!state.accesses.length) {
    body.innerHTML = '<tr><td class="empty" colspan="6">Nenhum usuario cadastrado.</td></tr>';
    return;
  }
  body.innerHTML = state.accesses.map((item) => {
    const userActive = item.usuario_ativo;
    const deviceActive = item.dispositivo_id && item.dispositivo_ativo;
    const admin = item.administrador;
    const userButton = admin ? "" : `<button class="button ${userActive ? "ghost" : "primary"} small" data-user="${escapeText(item.email)}" data-block="${userActive}">${userActive ? "Bloquear" : "Liberar"}</button>`;
    const deviceButton = !admin && deviceActive ? `<button class="button ghost small" data-device="${item.dispositivo_id}">Revogar computador</button>` : "";
    return `<tr><td>${escapeText(item.email)}${admin ? ' <span class="state good">ADMIN</span>' : ""}</td><td>${statusMarkup(userActive ? "ATIVO" : "BLOQUEADO")}</td><td>${escapeText(item.machine_name || "Sem computador")}</td><td>${item.dispositivo_id ? statusMarkup(deviceActive ? "ATIVO" : "REVOGADO") : "-"}</td><td>${formatDate(item.ultimo_acesso_em)}</td><td class="actions">${deviceButton}${userButton}</td></tr>`;
  }).join("");
}

function renderEvents() {
  const body = $("#events-body");
  if (!state.events.length) {
    body.innerHTML = '<tr><td class="empty" colspan="6">Nenhum evento registrado.</td></tr>';
    return;
  }
  body.innerHTML = state.events.map((item) => `<tr><td>${formatDate(item.criado_em)}</td><td>${escapeText(item.email)}</td><td>${escapeText(item.machine_name || "-")}</td><td>${escapeText(item.tipo)}</td><td>${escapeText(item.banco_destino || item.cliente_alias || "-")}</td><td>${statusMarkup(item.sucesso === false ? "FALHOU" : "SUCESSO")}</td></tr>`).join("");
}

function renderAll() {
  renderRequests();
  renderAccesses();
  renderEvents();
  const pending = state.requests.filter((item) => item.status === "PENDENTE").length;
  const users = new Set(state.accesses.map((item) => item.email)).size;
  const devices = state.accesses.filter((item) => item.dispositivo_id && item.dispositivo_ativo).length;
  $("#pending-count").textContent = pending;
  $("#pending-badge").textContent = pending;
  $("#user-count").textContent = users;
  $("#device-count").textContent = devices;
}

async function decideRequest(requestId, approve) {
  await api("/functions/v1/viatchau-access", {
    method: "POST",
    body: JSON.stringify({ action: "decide", request_id: requestId, approve }),
  }, true);
  await loadData();
  setStatus("#admin-status", approve ? "Acesso aprovado e codigo enviado." : "Solicitacao recusada.", "success");
}

function confirmAction(title, message, action, danger = true) {
  state.confirmAction = action;
  $("#confirm-title").textContent = title;
  $("#confirm-message").textContent = message;
  $("#confirm-action").className = `button ${danger ? "danger" : "primary"}`;
  $("#confirm-dialog").showModal();
}

async function handleTableAction(event) {
  const approve = event.target.closest("[data-approve]");
  const reject = event.target.closest("[data-reject]");
  const user = event.target.closest("[data-user]");
  const device = event.target.closest("[data-device]");
  if (approve) {
    confirmAction("Aprovar acesso", "O codigo de 6 numeros sera enviado imediatamente ao usuario.", () => decideRequest(approve.dataset.approve, true), false);
  } else if (reject) {
    confirmAction("Recusar solicitacao", "O usuario nao recebera codigo de acesso.", () => decideRequest(reject.dataset.reject, false));
  } else if (user) {
    const block = user.dataset.block === "true";
    confirmAction(block ? "Bloquear usuario" : "Liberar usuario", block ? "O usuario e todos os seus computadores perderao o acesso." : "O usuario podera solicitar um novo computador.", async () => {
      await rpc("viatchau_admin_bloquear_usuario", { p_email: user.dataset.user, p_bloquear: block }, true);
      await loadData();
    }, block);
  } else if (device) {
    confirmAction("Revogar computador", "Somente este computador perdera o acesso.", async () => {
      await rpc("viatchau_admin_revogar_dispositivo", { p_dispositivo_id: device.dataset.device }, true);
      await loadData();
    });
  }
}

async function executeConfirmed() {
  if (!state.confirmAction) return;
  const action = state.confirmAction;
  state.confirmAction = null;
  setStatus("#admin-status", "Executando acao...");
  try { await action(); }
  catch (error) { setStatus("#admin-status", error.message || "A acao falhou.", "error"); }
}

function activateTab(name) {
  $$(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
  $$(".tab-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== `tab-${name}`));
}

async function showAdmin() {
  $("#login-view").classList.add("hidden");
  $("#admin-view").classList.remove("hidden");
  $("#refresh-button").classList.remove("hidden");
  $("#logout-button").classList.remove("hidden");
  $("#session-email").textContent = state.session?.user?.email || "Administrador";
  try { await loadData(); }
  catch (error) {
    logout();
    setStatus("#login-status", error.message || "Acesso administrativo negado.", "error");
  }
}

function logout() {
  state.session = null;
  saveJson(SESSION_KEY, null);
  $("#admin-view").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
  $("#refresh-button").classList.add("hidden");
  $("#logout-button").classList.add("hidden");
  $("#session-email").textContent = "";
}

$("#login-form").addEventListener("submit", handleLogin);
$("#refresh-button").addEventListener("click", () => loadData().catch((error) => setStatus("#admin-status", error.message, "error")));
$("#logout-button").addEventListener("click", logout);
$("#request-filter").addEventListener("change", () => loadData().catch((error) => setStatus("#admin-status", error.message, "error")));
$("#admin-view").addEventListener("click", handleTableAction);
$$(".tab").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
$("#confirm-dialog").addEventListener("close", () => {
  if ($("#confirm-dialog").returnValue === "confirm") executeConfirmed();
  else state.confirmAction = null;
});

if (state.session?.access_token) showAdmin();
