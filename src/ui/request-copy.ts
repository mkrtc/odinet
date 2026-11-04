import { exportForAgent, exportRequest, RequestExportError, type RequestFormat } from "../network/export";
import type { NetworkEntry } from "../network/model";
import type { ResponseContent } from "../network/source";
import { ContextMenu } from "./context-menu";
import { element } from "./dom";
import { t } from "./i18n";

export class RequestCopyMenu {
  private readonly menu = new ContextMenu();
  private readonly feedback = element("div", "copy-feedback");
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor(private readonly readContent: (id: string) => Promise<ResponseContent>) {
    this.feedback.hidden = true; document.body.append(this.feedback);
  }

  open(entry: NetworkEntry, event: MouseEvent, trigger: HTMLElement): void {
    event.preventDefault(); event.stopPropagation();
    this.cancel();
    const action = (format: RequestFormat | "response" | "agent") => () => { void this.copy(entry, format); };
    const bounds = trigger.getBoundingClientRect();
    this.menu.open([{ label: t("copyMenu"), children: [
      { label: t("copyRequestMenu"), children: [
        { label: "cURL (bash)", action: action("curl") },
        { label: "Fetch", action: action("fetch") },
        { label: "Node.js (fetch)", action: action("node") },
        { label: "Python (requests)", action: action("python") },
      ] },
      { label: t("copyResponse"), disabled: entry.state !== "completed", action: action("response") },
      { label: t("copyForAgent"), disabled: entry.state === "pending", action: action("agent") },
    ] }], event.clientX || bounds.left + 12, event.clientY || bounds.bottom, trigger);
  }

  private show(message: string, manual?: string): void {
    clearTimeout(this.timer);
    this.feedback.replaceChildren(); this.feedback.hidden = false;
    const text = element("div", "copy-message", message); text.role = "status";
    const close = element("button", "json-button", "×"); close.type = "button"; close.setAttribute("aria-label", t("elementClose"));
    close.addEventListener("click", () => { this.feedback.hidden = true; this.feedback.replaceChildren(); });
    this.feedback.append(text, close);
    if (manual !== undefined) {
      const area = element("textarea", "copy-manual"); area.readOnly = true; area.value = manual;
      area.setAttribute("aria-label", t("jsonCopyManual")); this.feedback.append(area); area.focus(); area.select();
    } else this.timer = setTimeout(() => { this.feedback.hidden = true; this.feedback.replaceChildren(); }, 3000);
  }

  private async copy(entry: NetworkEntry, format: RequestFormat | "response" | "agent"): Promise<void> {
    const generation = ++this.generation;
    try {
      let text: string;
      let success = "jsonCopied";
      if (format === "response" || format === "agent") {
        this.show(t("copyReadingResponse"));
        let response: ResponseContent | null = null;
        try { response = await this.readContent(entry.id); }
        catch (error) { if (format === "response") throw error; }
        if (generation !== this.generation) return;
        if (format === "agent") text = exportForAgent(entry, response);
        else {
          if (!response) throw new RequestExportError("copyResponseUnavailable");
          if (response.truncated) throw new RequestExportError("copyResponseTooLarge");
          text = response.content;
          if (response.encoding) success = "copyEncodedDone";
        }
      } else text = exportRequest(entry, format);
      if (generation !== this.generation) return;
      try {
        await navigator.clipboard.writeText(text);
        if (generation === this.generation) this.show(t(success));
      } catch (error) {
        if (generation !== this.generation) return;
        console.error("Odinet: failed to write request export to clipboard", error);
        this.show(t("jsonCopyManual"), text);
      }
    } catch (error) {
      if (generation !== this.generation) return;
      console.error("Odinet: failed to copy network request", error);
      this.show(t(error instanceof RequestExportError ? error.messageKey : "copyFailed"));
    }
  }

  cancel = (): void => {
    this.generation++; clearTimeout(this.timer); this.menu.close(false);
    this.feedback.hidden = true; this.feedback.replaceChildren();
  };
  dispose(): void { this.cancel(); this.feedback.remove(); }
}
