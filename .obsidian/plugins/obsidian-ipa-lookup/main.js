const { Plugin, Modal, Notice, requestUrl } = require("obsidian");

const DICTIONARY_API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";

class IpaResultModal extends Modal {
  constructor(app, payload) {
    super(app);
    this.payload = payload;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ipa-lookup-modal");

    const title = contentEl.createEl("h2", { text: this.payload.word });
    title.addClass("ipa-title");

    const ipaLine = contentEl.createEl("p");
    ipaLine.addClass("ipa-phonetic");
    ipaLine.setText(this.payload.ipa || "IPA not found");

    if (this.payload.audioUrl) {
      const audioWrap = contentEl.createDiv({ cls: "ipa-audio-wrap" });
      const playBtn = audioWrap.createEl("button", { text: "Play pronunciation" });
      playBtn.addClass("mod-cta");
      playBtn.addEventListener("click", () => {
        const audio = new Audio(this.payload.audioUrl);
        audio.play().catch(() => {
          new Notice("Unable to play pronunciation audio.");
        });
      });
    }

    if (!this.payload.definitions.length) {
      contentEl.createEl("p", { text: "No English definitions found." });
      return;
    }

    const list = contentEl.createEl("ol");
    this.payload.definitions.forEach((line) => {
      list.createEl("li", { text: line });
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = class IpaLookupPlugin extends Plugin {
  async onload() {
    this.addCommand({
      id: "show-ipa-and-definition-for-selection",
      name: "Show IPA & Definition for Selection",
      editorCallback: async (editor) => {
        const rawSelection = editor.getSelection();
        const word = this.normalizeSelection(rawSelection);

        if (!word) {
          new Notice("Select an English word first.");
          return;
        }

        await this.lookupAndShow(word);
      },
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        const word = this.normalizeSelection(editor.getSelection());
        if (!word) return;

        menu.addItem((item) => {
          item
            .setTitle("Show IPA")
            .setIcon("languages")
            .setSection("a-ipa-lookup")
            .onClick(async () => {
              await this.lookupAndShow(word);
            });
        });
      })
    );
  }

  normalizeSelection(text) {
    if (!text) return "";

    const trimmed = text.trim();
    if (!trimmed) return "";

    const singleWord = trimmed
      .replace(/^[^a-zA-Z']+|[^a-zA-Z']+$/g, "")
      .toLowerCase();

    if (!singleWord || /\s/.test(singleWord)) return "";
    return singleWord;
  }

  async lookupAndShow(word) {
    try {
      const res = await requestUrl({
        url: `${DICTIONARY_API_BASE}${encodeURIComponent(word)}`,
        method: "GET",
      });

      if (res.status !== 200 || !Array.isArray(res.json) || !res.json.length) {
        new Notice(`No dictionary result for: ${word}`);
        return;
      }

      const parsed = this.parseDictionaryResponse(word, res.json);
      new IpaResultModal(this.app, parsed).open();
    } catch (err) {
      console.error("IPA Lookup error", err);
      new Notice("Lookup failed. Check network connection and try again.");
    }
  }

  parseDictionaryResponse(word, entries) {
    const first = entries[0] || {};
    const phonetics = Array.isArray(first.phonetics) ? first.phonetics : [];

    let ipa = "";
    let audioUrl = "";

    for (const p of phonetics) {
      if (!ipa && p && typeof p.text === "string" && p.text.trim()) {
        ipa = p.text.trim();
      }
      if (!audioUrl && p && typeof p.audio === "string" && p.audio.trim()) {
        audioUrl = p.audio.trim();
      }
      if (ipa && audioUrl) break;
    }

    const definitions = [];
    const meanings = Array.isArray(first.meanings) ? first.meanings : [];

    for (const meaning of meanings) {
      const partOfSpeech = meaning.partOfSpeech ? `[${meaning.partOfSpeech}] ` : "";
      const defs = Array.isArray(meaning.definitions) ? meaning.definitions : [];

      for (const def of defs.slice(0, 2)) {
        if (def && def.definition) {
          definitions.push(`${partOfSpeech}${def.definition}`);
        }
      }

      if (definitions.length >= 8) break;
    }

    return {
      word,
      ipa,
      audioUrl,
      definitions,
    };
  }
};
