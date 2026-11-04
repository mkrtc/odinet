import { DEFAULT_BRIDGE_PORT, TOKEN_PATTERN } from "../mcp/protocol";
import { PanelBridgeClient, type ConnectionState } from "../mcp/panel-client";
import type { NetworkReader } from "../mcp/reader";
import { element } from "./dom";
import { t } from "./i18n";

export class McpControls {
  private readonly client: PanelBridgeClient;
  private readonly menu = element("details", "mcp-menu");
  private readonly toggle = element("summary", "columns-toggle", "MCP");
  private readonly form = element("form", "mcp-options");
  private readonly port = element("input");
  private readonly token = element("input");
  private readonly action = element("button", "json-button");
  private readonly status = element("span", "mcp-status");
  private active = false;
  private readonly abort = new AbortController();

  constructor(toolbar: HTMLElement, tabId: number, reader: NetworkReader) {
    this.menu.id = "mcp-menu";
    this.toggle.title = t("mcpTitle"); this.toggle.setAttribute("aria-label", t("mcpTitle"));
    this.form.setAttribute("aria-label", t("mcpTitle"));
    this.port.id = "mcp-port"; this.port.type = "number"; this.port.min = "1024"; this.port.max = "65535";
    this.port.value = String(DEFAULT_BRIDGE_PORT); this.port.required = true;
    this.token.id = "mcp-token"; this.token.type = "password"; this.token.autocomplete = "off";
    this.token.required = true; this.token.pattern = TOKEN_PATTERN.source; this.token.maxLength = 64; this.token.spellcheck = false;
    for (const [input, message] of [[this.port, "mcpPort"], [this.token, "mcpToken"]] as const) {
      const label = element("label", "mcp-field", t(message)); label.htmlFor = input.id; label.append(input); this.form.append(label);
    }
    this.action.type = "submit";
    this.status.role = "status";
    this.form.append(element("p", "mcp-note", t("mcpScope")), this.status, this.action);
    this.menu.append(this.toggle, this.form); toolbar.append(this.menu);
    this.client = new PanelBridgeClient(tabId, reader, (state) => this.setState(state)); this.setState("disconnected");
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.active) { this.client.disconnect(); this.token.value = ""; return; }
      try { this.client.connect(Number(this.port.value), this.token.value.trim()); }
      catch { this.setState("failed"); }
    });
    document.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Node && !this.menu.contains(event.target)) this.menu.open = false;
    }, { signal: this.abort.signal });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.menu.open) { event.preventDefault(); event.stopImmediatePropagation(); this.menu.open = false; this.toggle.focus(); }
    }, { capture: true, signal: this.abort.signal });
  }

  private setState(state: ConnectionState): void {
    this.active = ["connecting", "connected", "retrying"].includes(state);
    this.port.disabled = this.active; this.token.disabled = this.active;
    this.action.textContent = t(this.active ? "mcpDisconnect" : "mcpConnect");
    this.toggle.dataset.state = state;
    this.toggle.title = `${t("mcpTitle")}: ${t(`mcpState_${state}`)}`;
    this.status.textContent = t(`mcpState_${state}`);
  }

  dispose(): void { this.client.disconnect(); this.token.value = ""; this.abort.abort(); this.menu.remove(); }
}
