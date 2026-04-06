const { Plugin, PluginSettingTab, Setting, Modal, Notice, requestUrl } = require("obsidian");

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "qwen/qwen3.6-plus:free";
const OPENROUTER_REFERER = "https://obsidian.md";
const OPENROUTER_TITLE = "Obsidian IPA Lookup";
const MAX_RETRIES_ON_429 = 2;
const RETRY_BASE_DELAY_MS = 1200;
const STREAM_FIRST_CHUNK_TIMEOUT_MS = 8000;
const STREAM_TOTAL_TIMEOUT_MS = 45000;

const DEFAULT_SETTINGS = {
  openrouterApiKey: "",
};

class LlmResultModal extends Modal {
  constructor(app, titleText) {
    super(app);
    this.titleText = titleText;
    this.outputText = "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ipa-lookup-modal");

    const title = contentEl.createEl("h2", { text: this.titleText });
    title.addClass("ipa-title");

    this.statusEl = contentEl.createEl("p", { text: "Calling LLM..." });
    this.outputEl = contentEl.createEl("div");
    this.outputEl.setAttr("style", "white-space: pre-wrap; line-height: 1.6;");
    this.outputEl.setText(this.outputText);
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.setText(text);
  }

  setOutput(text) {
    this.outputText = text || "";
    if (this.outputEl) this.outputEl.setText(this.outputText);
  }

  appendOutput(text) {
    if (!text) return;
    this.outputText += text;
    if (this.outputEl) this.outputEl.setText(this.outputText);
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = class IpaLookupPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new IpaLookupSettingTab(this.app, this));

    this.addCommand({
      id: "show-ipa-and-definition-for-selection",
      name: "Show IPA & Definition for Selection",
      editorCallback: async (editor) => {
        const selection = editor.getSelection();
        if (!selection || !selection.trim()) {
          new Notice("Select English text first.");
          return;
        }
        await this.lookupAndShowSelection(selection);
      },
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const selection = editor.getSelection();
        if (!selection || !selection.trim()) return;

        menu.addItem((item) => {
          item
            .setTitle("Show IPA")
            .setIcon("languages")
            .setSection("0-ipa-lookup")
            .onClick(async () => {
              await this.lookupAndShowSelection(selection);
            });
        });
      })
    );
  }

  extractWords(text) {
    if (!text) return [];
    const matches = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)*/g) || [];
    return [...new Set(matches)].slice(0, 20);
  }

  async lookupAndShowSelection(text) {
    this.lastLookupError = "";

    const apiKey = this.getOpenRouterApiKey();
    if (!apiKey) {
      new Notice("Set OpenRouter API key in IPA Lookup plugin settings first.");
      return;
    }

    const words = this.extractWords(text);
    if (!words.length) {
      new Notice("No English words found in selection.");
      return;
    }

    const queryText = text.trim();
    const prompt = this.buildPrompt(queryText, words);

    const modal = new LlmResultModal(this.app, words.length === 1 ? words[0] : `${words.length} words`);
    modal.open();
    modal.setStatus("Streaming response...");

    const streamResult = await this.streamOpenRouter(apiKey, prompt, (delta) => {
      modal.appendOutput(delta);
    });

    if (streamResult.ok) {
      modal.setStatus("Done");
      return;
    }

    modal.setStatus("Streaming unavailable, using non-stream response...");

    const normalResult = await this.requestOpenRouterNonStream(apiKey, prompt);
    if (!normalResult.ok) {
      const message = this.lastLookupError || "No response from OpenRouter.";
      modal.setStatus(message);
      new Notice(message);
      return;
    }

    modal.setOutput(normalResult.text);
    modal.setStatus("Done");
  }

  buildPrompt(selection, words) {
    const wordList = words.join(", ");
    return [
      "你是一个英语学习助手。",
      "请严格按以下要求输出，直接输出可读内容（可以用 Markdown），不要输出与任务无关的解释：",
      "1) 必须展示每个单词的 IPA，不能遗漏；无论是 1 个词还是多个词都必须全部展示。",
      `2) 需要覆盖的单词清单：${wordList}`,
      "3) 解释关键单词的含义（中文解释），并简要说明为什么它是关键单词。",
      "4) 给出具体使用场景；每个场景给出英文句子和中文翻译。",
      "5) 如果原文是短语/句子，请结合原文语境解释。",
      "建议输出结构：",
      "### IPA by Word",
      "- word: /ipa/",
      "### Key Words and Meanings",
      "- word: 含义...",
      "### Usage Scenarios",
      "- 场景名",
      "  EN: ...",
      "  ZH: ...",
      "用户原文：",
      selection,
    ].join("\n");
  }

  async streamOpenRouter(apiKey, prompt, onDelta) {
    if (typeof fetch !== "function") {
      return { ok: false };
    }

    let attempt = 0;

    while (attempt <= MAX_RETRIES_ON_429) {
      let firstChunkTimer = null;
      let totalTimer = null;
      let firstChunkTimeout = false;
      let totalTimeout = false;
      try {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;

        let firstChunkReceived = false;

        if (controller) {
          firstChunkTimer = setTimeout(() => {
            if (!firstChunkReceived) {
              firstChunkTimeout = true;
              controller.abort();
            }
          }, STREAM_FIRST_CHUNK_TIMEOUT_MS);

          totalTimer = setTimeout(() => {
            totalTimeout = true;
            controller.abort();
          }, STREAM_TOTAL_TIMEOUT_MS);
        }

        const res = await fetch(OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": OPENROUTER_REFERER,
            "X-Title": OPENROUTER_TITLE,
          },
          signal: controller ? controller.signal : undefined,
          body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages: [
              {
                role: "system",
                content: "You are an English learning assistant.",
              },
              {
                role: "user",
                content: prompt,
              },
            ],
            stream: true,
            temperature: 0.2,
          }),
        });

        if (res.status === 429) {
          if (firstChunkTimer) clearTimeout(firstChunkTimer);
          if (totalTimer) clearTimeout(totalTimer);
          if (attempt === MAX_RETRIES_ON_429) {
            this.setLookupError("OpenRouter is rate-limiting this model (429). Wait and retry, or use another model.");
            return { ok: false };
          }
          await this.sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
          attempt += 1;
          continue;
        }

        if (!res.ok || !res.body) {
          if (firstChunkTimer) clearTimeout(firstChunkTimer);
          if (totalTimer) clearTimeout(totalTimer);
          const detail = await this.extractFetchError(res);
          this.setLookupError(detail);
          return { ok: false };
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");

        let buffer = "";
        let received = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (!firstChunkReceived) {
            firstChunkReceived = true;
            if (firstChunkTimer) clearTimeout(firstChunkTimer);
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith("data:")) continue;

            const data = line.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") continue;

            const parsed = this.tryParseJson(data);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              received += delta;
              onDelta(delta);
            }
          }
        }

        if (!received.trim()) {
          if (totalTimer) clearTimeout(totalTimer);
          return { ok: false };
        }

        if (totalTimer) clearTimeout(totalTimer);
        return { ok: true, text: received };
      } catch (err) {
        if (firstChunkTimer) clearTimeout(firstChunkTimer);
        if (totalTimer) clearTimeout(totalTimer);
        if (err && err.name === "AbortError") {
          if (firstChunkTimeout) {
            this.setLookupError("Streaming timeout: no response chunk received. Falling back to non-stream.");
          } else if (totalTimeout) {
            this.setLookupError("Streaming timeout: response took too long. Falling back to non-stream.");
          } else {
            this.setLookupError("Streaming request was aborted. Falling back to non-stream.");
          }
          return { ok: false };
        }
        this.setLookupError(`OpenRouter streaming failed: ${err?.message || "unknown error"}`);
        return { ok: false };
      }
    }

    return { ok: false };
  }

  async requestOpenRouterNonStream(apiKey, prompt) {
    let attempt = 0;

    while (attempt <= MAX_RETRIES_ON_429) {
      try {
        const res = await requestUrl({
          url: OPENROUTER_API_URL,
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": OPENROUTER_REFERER,
            "X-Title": OPENROUTER_TITLE,
          },
          body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages: [
              {
                role: "system",
                content: "You are an English learning assistant.",
              },
              {
                role: "user",
                content: prompt,
              },
            ],
            temperature: 0.2,
          }),
        });

        if (res.status === 429) {
          if (attempt === MAX_RETRIES_ON_429) {
            this.setLookupError("OpenRouter is rate-limiting this model (429). Wait and retry, or use another model.");
            return { ok: false, text: "" };
          }
          await this.sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
          attempt += 1;
          continue;
        }

        if (res.status !== 200 || !res.json) {
          this.setLookupError(this.extractApiError(res));
          return { ok: false, text: "" };
        }

        const content = res?.json?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
          this.setLookupError("OpenRouter returned empty content.");
          return { ok: false, text: "" };
        }

        return { ok: true, text: content };
      } catch (err) {
        this.setLookupError(`OpenRouter request failed: ${err?.message || "unknown error"}`);
        return { ok: false, text: "" };
      }
    }

    return { ok: false, text: "" };
  }

  getOpenRouterApiKey() {
    return (this.settings?.openrouterApiKey || "").trim();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  setLookupError(message) {
    if (!this.lastLookupError && message) {
      this.lastLookupError = message;
    }
  }

  extractApiError(res) {
    const status = res?.status || "unknown";
    const text = typeof res?.text === "string" ? res.text : "";
    const json = res?.json;
    if (status === 429) {
      return "OpenRouter is rate-limiting this model (429). Wait a bit, or switch to a paid/non-free model.";
    }
    const detail =
      (json && (json.error?.message || json.message || json.error)) ||
      (text && text.slice(0, 200)) ||
      "request rejected";
    return `OpenRouter error (${status}): ${String(detail)}`;
  }

  async extractFetchError(res) {
    const status = res?.status || "unknown";
    let text = "";
    try {
      text = await res.text();
    } catch (e) {
      text = "";
    }

    if (status === 429) {
      return "OpenRouter is rate-limiting this model (429). Wait a bit, or switch to a paid/non-free model.";
    }

    const parsed = this.tryParseJson(text || "");
    const detail =
      (parsed && (parsed.error?.message || parsed.message || parsed.error)) ||
      (text && text.slice(0, 200)) ||
      "request rejected";

    return `OpenRouter error (${status}): ${String(detail)}`;
  }

  tryParseJson(raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
};

class IpaLookupSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("OpenRouter API key")
      .setDesc("Used for IPA and definition lookup via OpenRouter.")
      .addText((text) => {
        text
          .setPlaceholder("sk-or-v1-...")
          .setValue(this.plugin.settings.openrouterApiKey || "")
          .onChange(async (value) => {
            this.plugin.settings.openrouterApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });
  }
}
