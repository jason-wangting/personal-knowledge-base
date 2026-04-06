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

    const title = contentEl.createEl("h2", { text: this.payload.queryText });
    title.addClass("ipa-title");

    if (!this.payload.entries.length) {
      contentEl.createEl("p", { text: "No dictionary result found." });
      return;
    }

    for (const entry of this.payload.entries) {
      const section = contentEl.createDiv({ cls: "ipa-entry" });
      section.createEl("h3", { text: entry.word });

      const ipaLine = section.createEl("p");
      ipaLine.addClass("ipa-phonetic");
      ipaLine.setText(entry.ipa || "IPA not found");

      if (entry.audioUrl) {
        const audioWrap = section.createDiv({ cls: "ipa-audio-wrap" });
        const audio = audioWrap.createEl("audio");
        audio.setAttr("controls", "true");
        audio.setAttr("src", entry.audioUrl);
      }

      if (!entry.definitions.length) {
        section.createEl("p", { text: "No English definitions found." });
        continue;
      }

      const list = section.createEl("ol");
      entry.definitions.forEach((line) => {
        list.createEl("li", { text: line });
      });
    }
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
        const selection = editor.getSelection();
        if (!selection || !selection.trim()) {
          new Notice("Select an English word first.");
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
    return [...new Set(matches)].slice(0, 8);
  }

  async lookupAndShowSelection(text) {
    const words = this.extractWords(text);
    if (!words.length) {
      new Notice("No English words found in selection.");
      return;
    }

    const entries = await this.lookupWords(words);

    if (!entries.length) {
      new Notice("No dictionary result found for selected text.");
      return;
    }

    new IpaResultModal(this.app, {
      queryText: words.length === 1 ? words[0] : `${words.join(" ")} (${words.length} words)`,
      entries,
    }).open();
  }

  async lookupWords(words) {
    const tasks = words.map((word) => this.lookupWord(word));
    const results = await Promise.all(tasks);
    return results.filter(Boolean);
  }

  async lookupWord(word) {
    try {
      const res = await requestUrl({
        url: `${DICTIONARY_API_BASE}${encodeURIComponent(word)}`,
        method: "GET",
      });

      if (res.status !== 200 || !Array.isArray(res.json) || !res.json.length) {
        return null;
      }

      return this.parseDictionaryResponse(word, res.json);
    } catch (err) {
      console.error("IPA Lookup error", err);
      return null;
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
