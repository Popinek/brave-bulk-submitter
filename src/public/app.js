const elements = {
  input: document.querySelector("#url-input"),
  fileInput: document.querySelector("#file-input"),
  loadButton: document.querySelector("#load-button"),
  loadError: document.querySelector("#load-error"),
  parseHint: document.querySelector("#parse-hint"),
  confirm: document.querySelector("#confirm-send"),
  runButton: document.querySelector("#run-button"),
  retryButton: document.querySelector("#retry-button"),
  stopButton: document.querySelector("#stop-button"),
  runMessage: document.querySelector("#run-message"),
  runBadge: document.querySelector("#run-badge"),
  queueBody: document.querySelector("#queue-body"),
  selectAll: document.querySelector("#select-all-button"),
  clearSelection: document.querySelector("#clear-selection-button"),
  activityLog: document.querySelector("#activity-log"),
  metricTotal: document.querySelector("#metric-total"),
  metricReady: document.querySelector("#metric-ready"),
  metricSuccess: document.querySelector("#metric-success"),
  metricState: document.querySelector("#metric-state"),
  metricProgress: document.querySelector("#metric-progress")
};

let currentState = { sites: [], run: { status: "idle" }, events: [] };
let selectedIds = new Set();

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function formatTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function setMessage(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle("error", isError);
}

function statusLabel(status) {
  return { ready: "Ready", submitting: "Submitting", success: "Accepted", failed: "Failed" }[status] || status;
}

function renderMetrics() {
  const sites = currentState.sites;
  const run = currentState.run;
  const ready = sites.filter((site) => site.status === "ready").length;
  const success = sites.filter((site) => site.status === "success").length;
  elements.metricTotal.textContent = sites.length;
  elements.metricReady.textContent = ready;
  elements.metricSuccess.textContent = success;
  elements.metricState.textContent = (run.status || "idle").replace(/^./, (char) => char.toUpperCase());
  elements.metricProgress.textContent = run.status === "running"
    ? `${run.completed || 0} / ${run.total || 0} processed`
    : run.status === "complete" || run.status === "stopped"
      ? `${run.completed || 0} accepted, ${run.failed || 0} failed`
      : "No active run";
  elements.runBadge.textContent = (run.status || "idle").toUpperCase();
  elements.runBadge.className = `run-badge ${run.status || "idle"}`;
  elements.stopButton.disabled = run.status !== "running";
  elements.runButton.disabled = run.status === "running";
  elements.retryButton.disabled = run.status === "running" || !sites.some((site) => site.status === "failed");
}

function renderQueue() {
  if (!currentState.sites.length) {
    elements.queueBody.innerHTML = '<tr><td colspan="5" class="empty-row">No URLs loaded. Paste a list above to create a queue.</td></tr>';
    return;
  }

  elements.queueBody.innerHTML = currentState.sites.map((site) => {
    const checked = selectedIds.has(site.id) ? " checked" : "";
    const error = site.lastError ? `<span class="error-cell">${escapeHtml(site.lastError)}</span>` : "";
    return `<tr>
      <td class="check-column"><input class="row-check" type="checkbox" data-site-id="${escapeHtml(site.id)}"${checked} aria-label="Select ${escapeHtml(site.url)}" /></td>
      <td class="url-cell">${escapeHtml(site.url)}${error}</td>
      <td><span class="status status-${escapeHtml(site.status)}">${escapeHtml(statusLabel(site.status))}</span></td>
      <td class="attempts-cell">${site.attempts}</td>
      <td class="time-cell">${formatTime(site.submittedAt)}</td>
    </tr>`;
  }).join("");

  elements.queueBody.querySelectorAll(".row-check").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedIds.add(checkbox.dataset.siteId);
      else selectedIds.delete(checkbox.dataset.siteId);
    });
  });
}

function renderLog() {
  if (!currentState.events.length) {
    elements.activityLog.innerHTML = '<p class="empty-log">No activity yet. Load a queue to begin.</p>';
    return;
  }
  elements.activityLog.innerHTML = currentState.events.map((event) => `<div class="log-entry ${escapeHtml(event.type)}">
    <span class="log-time">${formatTime(event.time)}</span>
    <span class="log-type">${escapeHtml(event.type)}</span>
    <span>${escapeHtml(event.message)}</span>
  </div>`).join("");
}

function render() {
  renderMetrics();
  renderQueue();
  renderLog();
}

async function refresh() {
  currentState = await request("/api/state");
  const validIds = new Set(currentState.sites.map((site) => site.id));
  selectedIds = new Set([...selectedIds].filter((id) => validIds.has(id)));
  render();
}

async function loadQueue(input) {
  elements.loadError.hidden = true;
  try {
    const payload = await request("/api/sites", { method: "POST", body: JSON.stringify({ input }) });
    currentState = payload;
    selectedIds = new Set(currentState.sites.map((site) => site.id));
    elements.input.value = currentState.sites.map((site) => site.url).join("\n");
    const invalidCount = payload.errors?.length || 0;
    elements.parseHint.textContent = invalidCount
      ? `${currentState.sites.length} loaded. ${invalidCount} invalid item${invalidCount === 1 ? "" : "s"} skipped.`
      : `${currentState.sites.length} URL${currentState.sites.length === 1 ? "" : "s"} ready.`;
    render();
  } catch (error) {
    elements.loadError.hidden = false;
    setMessage(elements.loadError, error.message, true);
  }
}

async function startRun(siteIds) {
  if (!elements.confirm.checked) {
    setMessage(elements.runMessage, "Confirm that the selected URLs may be sent to Brave Search.", true);
    return;
  }
  try {
    await request("/api/run", { method: "POST", body: JSON.stringify({ siteIds }) });
    setMessage(elements.runMessage, "Run started. The visible browser will handle the submissions.");
    await refresh();
  } catch (error) {
    setMessage(elements.runMessage, error.message, true);
  }
}

elements.loadButton.addEventListener("click", () => loadQueue(elements.input.value));
elements.fileInput.addEventListener("change", async () => {
  const [file] = elements.fileInput.files;
  if (!file) return;
  elements.input.value = await file.text();
  elements.parseHint.textContent = `${file.name} loaded. Review the list, then replace the queue.`;
});
elements.runButton.addEventListener("click", () => {
  const ids = [...selectedIds];
  startRun(ids);
});
elements.retryButton.addEventListener("click", () => {
  const ids = currentState.sites.filter((site) => site.status === "failed").map((site) => site.id);
  selectedIds = new Set(ids);
  startRun(ids);
});
elements.stopButton.addEventListener("click", async () => {
  try {
    await request("/api/run/stop", { method: "POST", body: "{}" });
    setMessage(elements.runMessage, "Stop requested. The current URL will finish first.");
  } catch (error) {
    setMessage(elements.runMessage, error.message, true);
  }
});
elements.selectAll.addEventListener("click", () => {
  selectedIds = new Set(currentState.sites.filter((site) => site.status !== "success").map((site) => site.id));
  renderQueue();
});
elements.clearSelection.addEventListener("click", () => {
  selectedIds.clear();
  renderQueue();
});
elements.input.addEventListener("input", () => {
  const count = elements.input.value.split(/[\s,]+/).filter(Boolean).length;
  elements.parseHint.textContent = `${count} item${count === 1 ? "" : "s"} in editor. Duplicates and invalid URLs are checked on load.`;
});

const eventSource = new EventSource("/api/events");
eventSource.onmessage = (event) => {
  currentState = JSON.parse(event.data);
  render();
};
eventSource.onerror = () => setMessage(elements.runMessage, "Live updates paused. The queue will reconnect automatically.", true);

refresh().catch((error) => setMessage(elements.runMessage, error.message, true));
