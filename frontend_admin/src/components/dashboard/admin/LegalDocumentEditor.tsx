"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import type { JSONContent } from "@tiptap/core";
import PublicIcon from "@/components/icons/PublicIcon";

type LegalDocumentEditorProps = {
  content: string;
  onChange: (html: string, json: JSONContent) => void;
  onAutoSave?: (html: string, json: JSONContent) => void | Promise<void>;
};

function parseContent(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (parsed?.type === "doc") return parsed as JSONContent;
  } catch {}
  return value || "<p></p>";
}

export default function LegalDocumentEditor({ content, onChange, onAutoSave }: LegalDocumentEditorProps) {
  const [linkUrl, setLinkUrl] = useState("");
  const [linkText, setLinkText] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [headingOpen, setHeadingOpen] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
    ],
    content: parseContent(content),
    editorProps: {
      attributes: {
        class: "policy-document-content mx-auto min-h-[56vh] w-full border border-[#E8EAF2] bg-white px-8 py-10 shadow-[0_2px_8px_rgba(16,26,60,0.04)] sm:px-12 sm:py-12 outline-none",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      const html = currentEditor.getHTML();
      const json = currentEditor.getJSON();
      onChange(html, json);
      setAutoSaveStatus("saving");
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(async () => {
        try {
          await onAutoSave?.(html, json);
          setAutoSaveStatus("saved");
        } catch {
          setAutoSaveStatus("error");
        }
      }, 1800);
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.getHTML() !== content && !(content.startsWith("{") && JSON.stringify(editor.getJSON()) === content)) {
      editor.commands.setContent(parseContent(content), { emitUpdate: false });
    }
  }, [content, editor]);

  useEffect(() => () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
  }, []);

  if (!editor) return <div className="min-h-[60vh] animate-pulse rounded-lg bg-white" />;

  const text = editor.getText();
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const characterCount = text.length;

  const toolButton = (label: string, active: boolean, action: () => void, symbol: ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
      className={`flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium leading-none transition ${active ? "bg-[#FFF0E4] text-[#E57218]" : "text-[#5F6980] hover:bg-[#F2F4F8] hover:text-[#172033]"}`}
    >
      {symbol}
    </button>
  );

  const insertLink = () => {
    let url = linkUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !url.startsWith("mailto:")) {
      url = url.includes("@") && !url.includes(".") ? `mailto:${url}` : `https://${url.replace(/^\/+/, "")}`;
    }
    const label = linkText.trim() || url.replace(/^https?:\/\//, "").replace(/^mailto:/, "");
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent({
        type: "text",
        text: label,
        marks: [{ type: "link", attrs: { href: url } }],
      }).run();
    } else {
      if (linkText.trim()) {
        editor.chain().focus().deleteSelection().insertContent({
          type: "text",
          text: linkText.trim(),
          marks: [{ type: "link", attrs: { href: url } }],
        }).run();
      } else {
        editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
      }
    }
    setLinkUrl("");
    setLinkText("");
    setLinkOpen(false);
  };

  return (
    <div className="min-w-0 rounded-xl border border-[#E4E7EF] bg-white shadow-[0_2px_8px_rgba(16,26,60,0.04)]">
      <div className="sticky top-2 z-20 flex min-h-12 w-full flex-wrap items-center justify-center gap-1 border-b border-[#E4E7EF] bg-white px-2 py-2 text-[#283554]">
        <div className="mx-auto flex w-full flex-wrap items-center justify-center gap-1 sm:w-max">
        <div className="flex shrink-0 items-center gap-0.5">
          {toolButton("Undo", false, () => editor.chain().focus().undo().run(), (
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4L3 8l4 4"/><path d="M3 8h8a5 5 0 015 5"/></svg>
          ))}
          {toolButton("Redo", false, () => editor.chain().focus().redo().run(), (
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current stroke-2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 4l4 4-4 4"/><path d="M17 8H9a5 5 0 00-5 5"/></svg>
          ))}
        </div>
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-[#E4E7EF]" />
        <div className="relative shrink-0">
          <button
            type="button"
            aria-label="Paragraph style"
            aria-haspopup="menu"
            aria-expanded={headingOpen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setHeadingOpen((open) => !open)}
            className="flex h-8 w-[138px] items-center justify-between gap-2 rounded-md border border-[#E4E7EF] bg-white px-2.5 text-xs font-medium text-[#283554] outline-none hover:border-[#CBD2DF] focus:border-[#F57E1F] focus:ring-2 focus:ring-[#F57E1F]/10"
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {editor.isActive("heading", { level: 1 }) ? "Heading 1" : editor.isActive("heading", { level: 2 }) ? "Heading 2" : editor.isActive("heading", { level: 3 }) ? "Heading 3" : "Paragraph"}
            </span>
            <svg viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 fill-none stroke-[#66718E] transition-transform ${headingOpen ? "rotate-180" : ""}`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8l4 4 4-4"/></svg>
          </button>
          {headingOpen && (
            <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-[138px] overflow-hidden rounded-md border border-[#E4E7EF] bg-white p-1 shadow-lg">
              {([
                ["p", "Paragraph"],
                ["h1", "Heading 1"],
                ["h2", "Heading 2"],
                ["h3", "Heading 3"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="menuitem"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const chain = editor.chain().focus();
                    if (value === "p") chain.setParagraph().run();
                    if (value === "h1") chain.toggleHeading({ level: 1 }).run();
                    if (value === "h2") chain.toggleHeading({ level: 2 }).run();
                    if (value === "h3") chain.toggleHeading({ level: 3 }).run();
                    setHeadingOpen(false);
                  }}
                  className="block h-8 w-full rounded px-2 text-left text-xs font-medium text-[#283554] hover:bg-[#FFF0E4] hover:text-[#E57218]"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-[#E4E7EF]" />
        <div className="flex shrink-0 items-center gap-0.5">
          {toolButton("Bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <span className="font-bold">B</span>)}
          {toolButton("Italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <span className="italic">I</span>)}
          {toolButton("Underline", editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), <span className="underline decoration-2 underline-offset-2">U</span>)}
          {toolButton("Strikethrough", editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), <span className="line-through">S</span>)}
        </div>
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-[#E4E7EF]" />
        <div className="flex shrink-0 items-center gap-0.5">
          {toolButton("Bullet list", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), (
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round"><circle cx="3" cy="5" r=".7" fill="currentColor" stroke="none"/><circle cx="3" cy="10" r=".7" fill="currentColor" stroke="none"/><circle cx="3" cy="15" r=".7" fill="currentColor" stroke="none"/><path d="M7 5h10M7 10h10M7 15h10"/></svg>
          ))}
          {toolButton("Numbered list", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), (
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round"><path d="M3 4h1v3M2.5 7h2M3 10h1.5c1 0 1 2 0 2H3.5l1 2H2"/><path d="M7 4h10M7 10h10M7 16h10"/></svg>
          ))}
        </div>
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-[#E4E7EF]" />
        <div className="flex shrink-0 items-center gap-0.5">
          {toolButton("Align left", editor.isActive({ textAlign: "left" }), () => editor.chain().focus().setTextAlign("left").run(), <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5h14M3 8h9M3 12h14M3 15h9"/></svg>)}
          {toolButton("Align center", editor.isActive({ textAlign: "center" }), () => editor.chain().focus().setTextAlign("center").run(), <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5h14M6 8h8M3 12h14M6 15h8"/></svg>)}
          {toolButton("Align right", editor.isActive({ textAlign: "right" }), () => editor.chain().focus().setTextAlign("right").run(), <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5h14M8 8h9M3 12h14M8 15h9"/></svg>)}
          {toolButton("Justify", editor.isActive({ textAlign: "justify" }), () => editor.chain().focus().setTextAlign("justify").run(), <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.5" strokeLinecap="round"><path d="M3 5h14M3 8h14M3 12h14M3 15h14"/></svg>)}
        </div>
        <label title="Text color" className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-[#5F6980] hover:bg-[#F2F4F8]">
          A<input aria-label="Text color" type="color" defaultValue="#283554" onChange={(event) => editor.chain().focus().setColor(event.target.value).run()} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" />
        </label>
        <div className="relative flex shrink-0 items-center gap-0.5 rounded-md p-0.5">
          <button type="button" title="Insert link" aria-label="Insert link" onMouseDown={(event) => event.preventDefault()} onClick={() => setLinkOpen((open) => !open)} className="flex h-8 min-w-8 items-center justify-center rounded-md text-[#5F6980] hover:bg-[#F2F4F8] hover:text-[#172033]">
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8.5 11.5l3-3" />
              <path d="M7.1 13.9l-1.3 1.3a3 3 0 01-4.2-4.2l3.1-3.1a3 3 0 014.2 0" />
              <path d="M12.9 6.1l1.3-1.3a3 3 0 014.2 4.2l-3.1 3.1a3 3 0 01-4.2 0" />
            </svg>
          </button>
          {linkOpen && (
            <div className="fixed left-1/2 top-1/2 z-[180] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#E8EAF2] bg-white p-4 shadow-[0_12px_32px_rgba(16,26,60,0.18)] sm:absolute sm:left-auto sm:right-0 sm:top-10 sm:w-72 sm:max-w-[calc(100vw-2rem)] sm:translate-x-0 sm:translate-y-0">
              <label htmlFor="legal-link-url" className="text-xs font-semibold text-[#283554]">Link URL</label>
              <input id="legal-link-url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://example.com" className="mt-2 h-9 w-full rounded-md border border-[#E8EAF2] px-2 text-xs outline-none focus:border-[#F57E1F]" />
              <label htmlFor="legal-link-text" className="mt-3 block text-xs font-semibold text-[#283554]">Link text</label>
              <input id="legal-link-text" value={linkText} onChange={(event) => setLinkText(event.target.value)} placeholder="Text displayed in document" className="mt-2 h-9 w-full rounded-md border border-[#E8EAF2] px-2 text-xs outline-none focus:border-[#F57E1F]" />
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => { setLinkOpen(false); setLinkUrl(""); setLinkText(""); }} className="h-9 rounded-md border border-[#E8EAF2] px-3 text-xs font-semibold text-[#283554]">Cancel</button>
                <button type="button" onClick={insertLink} disabled={!linkUrl.trim()} className="h-9 rounded-md bg-[#F57E1F] px-3 text-xs font-semibold text-white hover:bg-[#E57218] disabled:cursor-not-allowed disabled:opacity-50">Insert</button>
              </div>
            </div>
          )}
          {toolButton("Insert table", false, () => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(), <PublicIcon name="product" className="h-4 w-4" />)}
          {toolButton("Clear formatting", false, () => editor.chain().focus().unsetAllMarks().clearNodes().run(), <PublicIcon name="type" className="h-4 w-4" />)}
        </div>
        </div>
      </div>
      <div className="bg-[#F4F6FA] px-4 py-6 sm:px-7 sm:py-8">
        <EditorContent editor={editor} className="min-w-0 bg-white" />
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-x border-b border-[#E8EAF2] bg-[#FCFCFE] px-4 py-2 text-xs text-[#66718E]">
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${autoSaveStatus === "error" ? "bg-[#DC2626]" : autoSaveStatus === "saving" ? "bg-[#F59E0B]" : autoSaveStatus === "saved" ? "bg-[#10B981]" : "bg-[#CBD5E1]"}`} />
          {autoSaveStatus === "saving" ? "Saving draft…" : autoSaveStatus === "saved" ? "Draft saved" : autoSaveStatus === "error" ? "Draft not saved" : "Ready"}
        </span>
        <span className="tabular-nums">{wordCount} words <span className="mx-1 text-[#CBD5E1]">•</span> {characterCount} characters</span>
      </footer>
    </div>
  );
}
