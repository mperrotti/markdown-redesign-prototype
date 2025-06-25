import React, { useState, useEffect, useRef } from "react";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import * as marked from "marked";
import shortid from "shortid";
import "./Doc.scss";
import Toolbar from "./Toolbar";

interface DocProps {
  initialData?: string;
}

const Doc = (props: DocProps) => {
  const [doc, setDoc] = useState<Record<string, string>>({});
  const [allLines, setAllLines] = useState<string[]>([]);
  // Track which block is in edit mode
  const [editingBlockIds, setEditingBlockIds] = useState<Set<string>>(
    new Set()
  );

  const docRef = useRef<HTMLDivElement>(null);
  const turndownService = useRef<any>();
  const isMounted = useRef(true);
  // Track last mouse click position for caret restoration
  const lastClickRef = useRef<{ x: number; y: number } | null>(null);

  // --- Turndown/Marked Setup ---
  if (!turndownService.current) {
    TurndownService.prototype.escape = (text: string) => text;
    turndownService.current = new TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
    });
    turndownService.current.use(gfm);
  }
  useEffect(() => {
    marked.marked.setOptions({ gfm: true, breaks: true });
  }, []);

  // --- Mount/Unmount ---
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // --- Document Initialization ---
  useEffect(() => {
    if (allLines.length === 0 && props.initialData) {
      // Split initialData into blocks by double newline OR before headings
      const blocks = splitIntoBlocks(props.initialData);
      const docList = blocks.map((block) => ({
        id: shortid.generate(),
        text: block,
      }));
      const docObj: Record<string, string> = {};
      docList.forEach((entry) => (docObj[entry.id] = entry.text));
      setDoc(docObj);
      setAllLines(docList.map((d) => d.id));
    }
  }, [props.initialData]);

  // --- Block splitting helper: split on double newlines OR before/after headings ---
  function splitIntoBlocks(text: string): string[] {
    // Normalize line endings
    text = text.replace(/\r\n?/g, "\n");
    // Split so that every heading is its own block, even if not surrounded by blank lines
    // 1. Split before every heading
    // 2. Split after every heading
    // 3. Split on double newlines
    // This ensures headings are always isolated
    const blocks: string[] = [];
    let buffer = "";
    const lines = text.split(/\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^#+\s/.test(line)) {
        if (buffer.trim()) blocks.push(buffer.trim());
        blocks.push(line.trim());
        buffer = "";
      } else if (line.trim() === "") {
        if (buffer.trim()) {
          blocks.push(buffer.trim());
          buffer = "";
        }
      } else {
        if (buffer) buffer += "\n";
        buffer += line;
      }
    }
    if (buffer.trim()) blocks.push(buffer.trim());
    return blocks.filter(Boolean);
  }

  // --- Block Editing, Caret, and Normalization (full legacy parity) ---
  useEffect(() => {
    const docEl = docRef.current;
    if (!docEl) return;

    // Remove all direct DOM manipulation from event handlers
    // All logic is now state-driven

    // Helper: Save current editing block's DOM content to doc state
    function saveCurrentEditingBlock() {
      if (editingBlockIds.size !== 1) return;
      const id = Array.from(editingBlockIds)[0];
      const blockEl = document.getElementById(id);
      if (blockEl) {
        const text = htmlToMarkdown(blockEl);
        console.log("[saveCurrentEditingBlock] Saving block", id, text); // Debug
        setDoc((prev) => ({ ...prev, [id]: text }));
      }
    }

    // Focus handler: set editing block and restore caret if needed
    function handleFocusOrSelect(e: Event) {
      const sel = window.getSelection();
      if (!sel || !sel.anchorNode) return;
      const anchorNode = sel.anchorNode;
      const element =
        anchorNode instanceof Element
          ? anchorNode
          : (anchorNode as ChildNode).parentElement;
      const block = element?.closest(".m2-block") as HTMLElement | null;
      if (!block) return;
      const id = block.id;
      if (!id) return;
      // Save previous editing block before switching
      if (!editingBlockIds.has(id)) {
        saveCurrentEditingBlock();
        setEditingBlockIds(new Set([id]));
        // Always restore caret to last click position if available (even on first click)
        setTimeout(() => {
          if (lastClickRef.current && block.contains(document.activeElement)) {
            const { x, y } = lastClickRef.current;
            let range: Range | null = null;
            if (
              typeof (document as any).caretPositionFromPoint === "function"
            ) {
              const pos = (document as any).caretPositionFromPoint(x, y);
              if (pos) {
                range = document.createRange();
                range.setStart(
                  pos.offsetNode,
                  Math.min(pos.offset, pos.offsetNode.textContent?.length || 0)
                );
                range.collapse(true);
              }
            } else if (
              typeof (document as any).caretRangeFromPoint === "function"
            ) {
              range = (document as any).caretRangeFromPoint(x, y);
            }
            if (range) {
              const sel2 = window.getSelection();
              if (sel2) {
                sel2.removeAllRanges();
                sel2.addRange(range);
              }
            }
          }
        }, 0);
      }
    }

    // MouseDown: record click position
    function handleMouseDown(e: MouseEvent) {
      // Save current editing block before switching on mouse click
      saveCurrentEditingBlock();
      lastClickRef.current = { x: e.clientX, y: e.clientY };
    }

    // TODO: get this to actually work when trying to blur the entire document
    // Blur handler: exit edit mode
    function handleBlur(e: FocusEvent) {
      const block = e.target as HTMLElement;
      if (!block || !block.classList.contains("m2-block")) return;
      saveCurrentEditingBlock();
      setEditingBlockIds(new Set());
    }

    // --- Enhanced ArrowUp/ArrowDown navigation between blocks ---
    function handleKeyDown(e: KeyboardEvent) {
      console.log("[handleKeyDown] Key pressed:", e.key, "Shift:", e.shiftKey);

      const sel = window.getSelection();
      if (!sel || !sel.anchorNode) {
        console.log("[handleKeyDown] No selection or anchor node");
        return;
      }

      const anchorNode = sel.anchorNode;
      const element =
        anchorNode instanceof Element
          ? anchorNode
          : (anchorNode as ChildNode).parentElement;
      const block = element?.closest(".m2-block") as HTMLElement | null;
      if (!block) {
        console.log("[handleKeyDown] No block element found");
        return;
      }

      const id = block.id;
      if (!id) {
        console.log("[handleKeyDown] No block ID found");
        return;
      }

      const blockMarkdown = htmlToMarkdown(block);
      console.log("[handleKeyDown] Block markdown:", blockMarkdown);

      let caretPos = 0;
      if (sel.anchorNode.nodeType === Node.TEXT_NODE) {
        let offset = sel.anchorOffset;
        let node = sel.anchorNode;
        let walker = document.createTreeWalker(
          block,
          NodeFilter.SHOW_TEXT,
          null
        );
        let total = 0;
        let found = false;
        while (walker.nextNode()) {
          if (walker.currentNode === node) {
            caretPos = total + offset;
            found = true;
            break;
          } else {
            total += walker.currentNode.textContent?.length || 0;
          }
        }
        if (!found) caretPos = 0;
      }
      console.log("[handleKeyDown] Caret position:", caretPos);

      if (e.key === "Enter" && !e.shiftKey) {
        console.log(
          "[handleKeyDown] Enter key pressed, checking if list block"
        );
        const isListBlock = /^(\s*)([-*+] |\d+\. |- \[[ xX]\] )/m.test(
          blockMarkdown
        );
        console.log("[handleKeyDown] Is list block:", isListBlock);
        if (isListBlock) {
          console.log("[handleKeyDown] Handling list block Enter");
          e.preventDefault();

          const blockEl = document.getElementById(id);
          if (!blockEl) {
            console.log("[handleKeyDown] Block element not found");
            return;
          }

          const selection = window.getSelection();
          if (!selection || !selection.rangeCount) {
            console.log("[handleKeyDown] No selection found");
            return;
          }

          const range = selection.getRangeAt(0);
          const caretPos = range.startOffset;
          console.log("[handleKeyDown] Caret position:", caretPos);

          // Get the current line's text content
          const currentSpan = range.startContainer.parentElement;
          if (!currentSpan || !currentSpan.hasAttribute("data-line")) {
            console.log("[handleKeyDown] Could not find current line");
            return;
          }

          const currentLine = currentSpan.getAttribute("data-line") || "";
          console.log("[handleKeyDown] Current line:", currentLine);

          // Find the current list item in the markdown
          const lines = blockMarkdown.split("\n");
          let currentLineIndex = -1;
          let currentLineContent = "";

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === currentLine.trim()) {
              currentLineIndex = i;
              currentLineContent = lines[i];
              break;
            }
          }

          if (currentLineIndex === -1) {
            console.log(
              "[handleKeyDown] Could not find current line in markdown"
            );
            return;
          }

          console.log(
            "[handleKeyDown] Found current line at index:",
            currentLineIndex
          );

          // Parse the current line
          const match = currentLineContent.match(
            /^(\s*)([-*+] |\d+\. |- \[[ xX]\] )(.*)/
          );
          if (!match) {
            console.log("[handleKeyDown] Could not parse current line");
            return;
          }

          const [, indent, marker, content] = match;
          const indentLevel = indent.length / 2;
          const trimmedContent = content.trim();

          // Calculate the caret position relative to the content
          const contentStart = currentLineContent.indexOf(trimmedContent);
          const offsetInContent = caretPos - contentStart;
          const isAtEnd = offsetInContent >= trimmedContent.length;

          console.log("[handleKeyDown] Current line details:", {
            indentLevel,
            marker,
            content: trimmedContent,
            offsetInContent,
            isAtEnd,
          });

          // Create the new markdown
          let newMarkdown = "";

          // Add all lines before the current line
          for (let i = 0; i < currentLineIndex; i++) {
            newMarkdown += lines[i] + "\n";
          }

          // Add the current line (split if needed)
          if (isAtEnd) {
            newMarkdown += currentLineContent + "\n";
            // Add a space after the marker and ensure it's preserved
            newMarkdown += indent + marker + "&nbsp;" + "\n";
          } else {
            const beforeCaret = trimmedContent.slice(0, offsetInContent);
            const afterCaret = trimmedContent.slice(offsetInContent);
            newMarkdown += indent + marker + beforeCaret + "\n";
            newMarkdown += indent + marker + afterCaret + "\n";
          }

          // Add all lines after the current line
          for (let i = currentLineIndex + 1; i < lines.length; i++) {
            newMarkdown += lines[i] + "\n";
          }

          // Remove trailing newline
          newMarkdown = newMarkdown.trimEnd();
          console.log("[handleKeyDown] New markdown:", newMarkdown);

          // Update the document
          setDoc((prev) => ({ ...prev, [id]: newMarkdown }));

          // Wait for the DOM to update
          requestAnimationFrame(() => {
            const newBlockEl = document.getElementById(id);
            if (!newBlockEl) {
              console.log(
                "[handleKeyDown] New block element not found after update"
              );
              return;
            }

            // Get all spans with data-line
            const spans = Array.from(
              newBlockEl.querySelectorAll("span[data-line]")
            );
            // The new line is always the one after the current line
            const newSpan = spans[currentLineIndex + 1];
            if (!newSpan) {
              console.log("[handleKeyDown] New span not found");
              return;
            }

            // Find the first text node in the new span
            let node = newSpan.firstChild;
            let markerLength = marker.length;
            if (node && node.nodeType === Node.TEXT_NODE) {
              // If the text node is too short, place caret at the end or start
              // Add 1 to markerLength to account for the space after marker
              const offset =
                node.textContent && node.textContent.length >= markerLength + 1
                  ? markerLength + 1
                  : node.textContent
                  ? node.textContent.length
                  : 0;
              const range = document.createRange();
              range.setStart(node, offset);
              range.collapse(true);
              const selection = window.getSelection();
              if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
              }
            } else {
              // Fallback: place caret at start of span
              (newSpan as HTMLElement).focus();
            }
          });

          return;
        }

        console.log(
          "[handleKeyDown] Not a list block, using default block split"
        );
        e.preventDefault();
        handleBlockSplit(block, blockMarkdown, caretPos);
        return;
      } else if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        // Insert a literal newline
        const id = Array.from(editingBlockIds)[0];
        if (id) {
          setDoc((prev) => ({
            ...prev,
            [id]: prev[id] + "\n",
          }));
        }
      } else if (e.key === "Backspace" && isCaretAtStartOfBlock(block, sel)) {
        // TODO: fix the problem where deleted content comes back after moving to a new block
        // --- Robust block join: merge with previous block if caret at start ---
        const idx = allLines.indexOf(id);
        if (idx > 0) {
          e.preventDefault();
          const prevId = allLines[idx - 1];
          const prevText = doc[prevId] || "";
          const currText = doc[id] || "";
          // Check if we're joining list items
          const isPrevList = /^(\s*)([-*+] |\d+\. |- \[.\] )/m.test(prevText);
          const isCurrList = /^(\s*)([-*+] |\d+\. |- \[.\] )/m.test(currText);
          if (isPrevList && isCurrList) {
            // Join list items with a newline
            const mergedText = prevText + "\n" + currText;
            const newDoc = { ...doc, [prevId]: mergedText };
            delete newDoc[id];
            const newAllLines = [...allLines];
            newAllLines.splice(idx, 1);
            setDoc(newDoc);
            setAllLines(newAllLines);
            setEditingBlockIds(new Set([prevId]));

            // Focus the previous block and place caret at join point
            requestAnimationFrame(() => {
              const prevBlock = document.getElementById(prevId);
              if (prevBlock) {
                prevBlock.focus();
                const sel2 = window.getSelection();
                if (sel2) {
                  sel2.removeAllRanges();
                  const range = document.createRange();
                  // Place caret at the join point (end of original prevText)
                  let remaining = prevText.length;
                  let found = false;
                  function walk(node: Node) {
                    if (found) return;
                    if (node.nodeType === Node.TEXT_NODE) {
                      const len = node.textContent?.length || 0;
                      if (remaining <= len) {
                        range.setStart(node, remaining);
                        found = true;
                      } else {
                        remaining -= len;
                      }
                    } else {
                      for (let i = 0; i < node.childNodes.length; i++) {
                        walk(node.childNodes[i]);
                        if (found) break;
                      }
                    }
                  }
                  walk(prevBlock);
                  if (!found) {
                    range.setStart(prevBlock, prevBlock.childNodes.length);
                  }
                  range.collapse(true);
                  sel2.addRange(range);
                }
              }
            });
          } else {
            // Merge current block into previous
            const mergedText = prevText + currText;
            const newDoc = { ...doc, [prevId]: mergedText };
            delete newDoc[id];
            const newAllLines = [...allLines];
            newAllLines.splice(idx, 1);
            setDoc(newDoc);
            setAllLines(newAllLines);
            setEditingBlockIds(new Set([prevId]));

            // Focus the previous block and place caret at join point
            requestAnimationFrame(() => {
              const prevBlock = document.getElementById(prevId);
              if (prevBlock) {
                prevBlock.focus();
                const sel2 = window.getSelection();
                if (sel2) {
                  sel2.removeAllRanges();
                  const range = document.createRange();
                  // Place caret at the join point (end of original prevText)
                  let remaining = prevText.length;
                  let found = false;
                  function walk(node: Node) {
                    if (found) return;
                    if (node.nodeType === Node.TEXT_NODE) {
                      const len = node.textContent?.length || 0;
                      if (remaining <= len) {
                        range.setStart(node, remaining);
                        found = true;
                      } else {
                        remaining -= len;
                      }
                    } else {
                      for (let i = 0; i < node.childNodes.length; i++) {
                        walk(node.childNodes[i]);
                        if (found) break;
                      }
                    }
                  }
                  walk(prevBlock);
                  if (!found) {
                    range.setStart(prevBlock, prevBlock.childNodes.length);
                  }
                  range.collapse(true);
                  sel2.addRange(range);
                }
              }
            });
          }
          return;
        }
      } else if (
        (e.key === "Backspace" || e.key === "Delete") &&
        (block.textContent === "" || block.textContent === "\u200B")
      ) {
        // --- Block joining logic, robust: focus previous or next block after deletion ---
        const idx = allLines.indexOf(id);
        console.log("[handleKeyDown] Deleting block", id, "at index", idx);
        e.preventDefault();
        let newAllLines = [...allLines];
        newAllLines.splice(idx, 1);
        setAllLines(newAllLines);
        setDoc((prev) => {
          const newDoc = { ...prev };
          delete newDoc[id];
          return newDoc;
        });

        setTimeout(() => {
          // Focus next block (at start) if it exists, otherwise previous block (at end)
          let focusId: string | null = null;
          let focusAtEnd = false;
          if (newAllLines.length > 0) {
            if (idx < newAllLines.length) {
              // There is a next block after the deleted one
              focusId = newAllLines[idx];
              focusAtEnd = false;
            } else if (idx - 1 >= 0) {
              // No next block, focus previous
              focusId = newAllLines[idx - 1];
              focusAtEnd = true;
            }
          }
          if (focusId) {
            setEditingBlockIds(new Set([focusId]));
            const focusBlock = document.getElementById(focusId);
            if (focusBlock) {
              // If block is empty, insert a zero-width space
              if (
                !focusBlock.textContent ||
                focusBlock.textContent.length === 0
              ) {
                focusBlock.innerText = "\u200B";
              }
              focusBlock.focus();
              const sel2 = window.getSelection();
              if (sel2) {
                sel2.removeAllRanges();
                const range = document.createRange();
                let node = focusBlock.firstChild;
                let offset = 0;
                if (node && node.nodeType === Node.TEXT_NODE) {
                  offset = node.textContent ? node.textContent.length : 0;
                } else if (node) {
                  offset = node.childNodes.length;
                }
                if (focusAtEnd) {
                  // Place caret at end
                  if (node && node.nodeType === Node.TEXT_NODE) {
                    range.setStart(
                      node,
                      Math.min(offset, node.textContent?.length || 0)
                    );
                  } else if (node) {
                    range.setStart(
                      node,
                      Math.min(offset, node.childNodes.length)
                    );
                  } else {
                    range.setStart(focusBlock, 0);
                  }
                } else {
                  // Place caret at start
                  if (node && node.nodeType === Node.TEXT_NODE) {
                    range.setStart(node, 0);
                  } else if (node) {
                    range.setStart(node, 0);
                  } else {
                    range.setStart(focusBlock, 0);
                  }
                }
                range.collapse(true);
                sel2.addRange(range);
              }
            } else {
              console.log(
                "[handleKeyDown] Focus block not found after deletion:",
                focusId
              );
            }
          } else {
            console.log("[handleKeyDown] No block to focus after deletion");
          }
        }, 0);
        return;
      } else if (e.key === "Backspace" && isCaretAtStartOfBlock(block, sel)) {
        // --- Robust block join: merge with previous block if caret at start ---
        const idx = allLines.indexOf(id);
        if (idx > 0) {
          e.preventDefault();
          const prevId = allLines[idx - 1];
          const prevText = doc[prevId] || "";
          const currText = doc[id] || "";
          // Merge current block into previous
          const mergedText = prevText + currText;
          const caretPos = prevText.length; // Caret should be right before joined text
          const newDoc = { ...doc, [prevId]: mergedText };
          delete newDoc[id];
          const newAllLines = [...allLines];
          newAllLines.splice(idx, 1);
          setDoc(newDoc);
          setAllLines(newAllLines);
          setEditingBlockIds(new Set([prevId]));

          setTimeout(() => {
            const prevBlock = document.getElementById(prevId);
            if (prevBlock) {
              prevBlock.focus();
              const sel2 = window.getSelection();
              if (sel2) {
                sel2.removeAllRanges();
                const range = document.createRange();
                // Place caret at the join point (end of original prevText)
                let node = prevBlock.firstChild;
                // Find the deepest last text node up to prevText.length
                let found = false;
                function walk(node: Node) {
                  if (found) return;
                  if (node.nodeType === Node.TEXT_NODE) {
                    const len = node.textContent?.length || 0;
                    if (caretPos <= len) {
                      found = true;
                      return { node, offset: caretPos };
                    } else {
                      return { node: null, offset: 0 };
                    }
                  }
                  let acc = 0;
                  for (let i = 0; i < node.childNodes.length; i++) {
                    const child = node.childNodes[i];
                    const len = child.textContent?.length || 0;
                    if (caretPos <= acc + len) {
                      return walk(child);
                    }
                    acc += len;
                  }
                  return { node: null, offset: 0 };
                }
                const caretTarget = walk(prevBlock);
                if (caretTarget?.node) {
                  range.setStart(caretTarget.node, caretTarget.offset);
                } else if (node && node.nodeType === Node.TEXT_NODE) {
                  range.setStart(
                    node,
                    Math.min(caretPos, node.textContent?.length || 0)
                  );
                } else if (node) {
                  range.setStart(node, 0);
                } else {
                  range.setStart(prevBlock, 0);
                }
                range.collapse(true);
                sel2.addRange(range);
              }
            }
          }, 0);
          return;
        }
      }
    }

    docEl.addEventListener("mousedown", handleMouseDown);
    docEl.addEventListener("focusin", handleFocusOrSelect);
    docEl.addEventListener("focusout", handleBlur);
    docEl.addEventListener("keydown", handleKeyDown);
    return () => {
      docEl.removeEventListener("mousedown", handleMouseDown);
      docEl.removeEventListener("focusin", handleFocusOrSelect);
      docEl.removeEventListener("focusout", handleBlur);
      docEl.removeEventListener("keydown", handleKeyDown);
    };
  }, [doc, allLines, editingBlockIds, props]); // Dependencies for the effect

  // --- Global selectionchange: reveal Markdown for all blocks with any selection ---
  useEffect(() => {
    function handleSelectionChange() {
      const sel = window.getSelection();
      if (!sel) return;
      if (sel.isCollapsed) {
        // Caret: reveal only the block under caret
        const anchorNode = sel.anchorNode;
        const element =
          anchorNode instanceof Element
            ? anchorNode
            : (anchorNode as ChildNode).parentElement;
        const block = element?.closest(".m2-block") as HTMLElement | null;
        if (block && block.id) {
          setEditingBlockIds(new Set([block.id]));
        }
      } else {
        // Selection: reveal all blocks touched by selection (using selection range)
        const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        if (!range) return;
        const blocks = Array.from(
          document.querySelectorAll<HTMLElement>(".m2-block")
        );
        const selectedIds = new Set<string>();
        blocks.forEach((block) => {
          // If any part of the block is touched by the selection range
          if (range.intersectsNode(block)) {
            selectedIds.add(block.id);
          }
        });
        if (selectedIds.size > 0) {
          setEditingBlockIds(selectedIds);
        }
      }
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  // --- Render blocks with virtualization ---
  const renderBlocks = () => {
    return allLines.map((id) => {
      const isEditing = editingBlockIds.has(id);
      if (isEditing) {
        // If block is a list, render as flat lines with <br> and &nbsp; in edit mode for test compatibility
        const isListBlock = /^(\s*)([-*+] |\d+\. |- \[[ xX]\] )/m.test(
          doc[id] || ""
        );
        let blockHtml: React.ReactNode;
        if (isListBlock) {
          // Render as flat lines with <br> and &nbsp; for indentation
          const lines = (doc[id] || "").split("\n");
          blockHtml = lines.map((line, i, arr) => {
            const leadingSpaces = line.match(/^\s+/)?.[0] || "";
            const rest = line.slice(leadingSpaces.length);
            // If this is a list marker with only a space, render &nbsp; after the marker
            const listMatch = rest.match(/^([-*+] |\d+\. |- \[[ xX]\] ) ?$/);
            const htmlLine =
              leadingSpaces.replace(/ /g, "&nbsp;") +
              (listMatch ? listMatch[1] + "&nbsp;" : rest);
            const safeHtmlLine = htmlLine.length === 0 ? "\u200B" : htmlLine;
            return i < arr.length - 1 ? (
              [
                <span
                  key={i}
                  dangerouslySetInnerHTML={{ __html: safeHtmlLine }}
                  data-line={line}
                />,
                <br key={i + "br"} />,
              ]
            ) : (
              <span
                key={i}
                dangerouslySetInnerHTML={{ __html: safeHtmlLine }}
                data-line={line}
              />
            );
          });
        } else {
          // Render markdown with <br> for newlines in edit mode, and preserve indentation
          const blockLines = (doc[id] || "\u200B").split("\n");
          blockHtml = blockLines.map((line, i, arr) => {
            // Replace leading spaces with &nbsp; for visual indentation
            const leadingSpaces = line.match(/^\s+/)?.[0] || "";
            const rest = line.slice(leadingSpaces.length);
            const htmlLine = leadingSpaces.replace(/ /g, "&nbsp;") + rest;
            // Add a zero-width space to empty lines to preserve them in contentEditable
            const safeHtmlLine = htmlLine.length === 0 ? "\u200B" : htmlLine;
            return i < arr.length - 1 ? (
              [
                <span
                  key={i}
                  dangerouslySetInnerHTML={{ __html: safeHtmlLine }}
                  data-line={line}
                />,
                <br key={i + "br"} />,
              ]
            ) : (
              <span
                key={i}
                dangerouslySetInnerHTML={{ __html: safeHtmlLine }}
                data-line={line}
              />
            );
          });
        }
        return (
          <div
            key={id}
            id={id}
            className="m2-block m2-edit-mode"
            contentEditable={true}
            suppressContentEditableWarning={true}
            style={{ borderLeft: "" }}
            onInput={(e) => {
              const blockEl = e.currentTarget;
              const markdown = blockEl.textContent || "";

              // Remove any extra spaces at the end of lines
              const cleanedMarkdown = markdown.replace(/\s+$/gm, "");

              setDoc((prev) => ({ ...prev, [id]: cleanedMarkdown }));
            }}
          >
            {blockHtml}
          </div>
        );
      } else {
        return (
          <div
            key={id}
            id={id}
            className="m2-block"
            tabIndex={0}
            style={{ borderLeft: undefined }}
            dangerouslySetInnerHTML={{ __html: getNodeForBlock(doc[id] || "") }}
          />
        );
      }
    });
  };

  // Helper function to handle block splitting
  function handleBlockSplit(
    block: HTMLElement,
    blockMarkdown: string,
    caretPos: number
  ) {
    const id = block.id;
    if (!id) return;

    // Split the markdown at caretPos
    const before = blockMarkdown.slice(0, caretPos);
    const after = blockMarkdown.slice(caretPos);

    // Use splitIntoBlocks for both before and after
    let beforeBlocks = splitIntoBlocks(before);
    let afterBlocks = splitIntoBlocks(after);

    // Guarantee a new block is always created
    if (afterBlocks.length === 0) afterBlocks = [""];
    if (beforeBlocks.length === 0) beforeBlocks = [""];

    const newIds = [
      id,
      ...Array(beforeBlocks.length - 1 + afterBlocks.length)
        .fill(null)
        .map(() => shortid.generate()),
    ];

    let docUpdate = { ...doc };
    let allBlockIds: string[] = [];

    // Assign before blocks
    for (let i = 0; i < beforeBlocks.length; i++) {
      docUpdate[newIds[i]] = beforeBlocks[i];
      allBlockIds.push(newIds[i]);
    }

    // Assign after blocks
    for (let i = 0; i < afterBlocks.length; i++) {
      docUpdate[newIds[beforeBlocks.length + i]] = afterBlocks[i];
      allBlockIds.push(newIds[beforeBlocks.length + i]);
    }

    let idx = allLines.indexOf(id);
    let newAllLines = [...allLines];
    newAllLines.splice(idx, 1, ...allBlockIds);

    setDoc(docUpdate);
    setAllLines(newAllLines);
    setEditingBlockIds(new Set([newIds[beforeBlocks.length]]));

    // Focus the new block after split
    requestAnimationFrame(() => {
      const newBlock = document.getElementById(newIds[beforeBlocks.length]);
      if (newBlock) {
        newBlock.focus();
        const sel2 = window.getSelection();
        if (sel2) {
          sel2.removeAllRanges();
          const range = document.createRange();
          const textNode = findFirstTextNode(newBlock);
          if (textNode) {
            range.setStart(textNode, 0);
          } else {
            range.setStart(newBlock, 0);
          }
          range.collapse(true);
          sel2.addRange(range);
        }
      }
    });
  }

  const handleBold = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const startContainer = range.startContainer;

    // Find the containing block element
    const blockEl = startContainer.parentElement?.closest(
      "[data-block-id]"
    ) as HTMLElement;
    if (!blockEl) return;

    const blockId = blockEl.getAttribute("data-block-id");
    if (!blockId) return;

    const blockContent = doc[blockId];
    if (!blockContent) return;

    // Get the selected text
    const selectedText = range.toString();
    if (!selectedText) return;

    // Get the start and end offsets relative to the block's content
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;

    // Create new content with markdown syntax
    const newContent =
      blockContent.slice(0, startOffset) +
      `**${selectedText}**` +
      blockContent.slice(endOffset);

    // Update the document
    setDoc((prev) => ({ ...prev, [blockId]: newContent }));

    // Restore focus and selection
    requestAnimationFrame(() => {
      const newBlockEl = document.getElementById(blockId);
      if (!newBlockEl) return;

      // Find the text node containing our selection
      const walker = document.createTreeWalker(
        newBlockEl,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node: Text | null = null;
      let currentOffset = 0;
      while ((node = walker.nextNode() as Text)) {
        const nodeLength = node.textContent?.length || 0;
        if (currentOffset + nodeLength > startOffset) {
          const range = document.createRange();
          const nodeStart = startOffset - currentOffset;
          const nodeEnd = endOffset - currentOffset;
          range.setStart(node, nodeStart);
          range.setEnd(node, nodeEnd);
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
          break;
        }
        currentOffset += nodeLength;
      }
    });
  };

  const handleItalic = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const startContainer = range.startContainer;

    // Find the containing block element
    const blockEl = startContainer.parentElement?.closest(
      "[data-block-id]"
    ) as HTMLElement;
    if (!blockEl) return;

    const blockId = blockEl.getAttribute("data-block-id");
    if (!blockId) return;

    const blockContent = doc[blockId];
    if (!blockContent) return;

    // Get the selected text
    const selectedText = range.toString();
    if (!selectedText) return;

    // Get the start and end offsets relative to the block's content
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;

    // Create new content with markdown syntax
    const newContent =
      blockContent.slice(0, startOffset) +
      `*${selectedText}*` +
      blockContent.slice(endOffset);

    // Update the document
    setDoc((prev) => ({ ...prev, [blockId]: newContent }));

    // Restore focus and selection
    requestAnimationFrame(() => {
      const newBlockEl = document.getElementById(blockId);
      if (!newBlockEl) return;

      // Find the text node containing our selection
      const walker = document.createTreeWalker(
        newBlockEl,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node: Text | null = null;
      let currentOffset = 0;
      while ((node = walker.nextNode() as Text)) {
        const nodeLength = node.textContent?.length || 0;
        if (currentOffset + nodeLength > startOffset) {
          const range = document.createRange();
          const nodeStart = startOffset - currentOffset;
          const nodeEnd = endOffset - currentOffset;
          range.setStart(node, nodeStart);
          range.setEnd(node, nodeEnd);
          const selection = window.getSelection();
          if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
          }
          break;
        }
        currentOffset += nodeLength;
      }
    });
  };

  return (
    <div className="m2-doc">
      <Toolbar onBold={handleBold} onItalic={handleItalic} />
      <div className="m2-doc-container">
        <div
          ref={docRef}
          id="m2-doc"
          className="m2-doc content"
          contentEditable={true}
          suppressContentEditableWarning={true}
        >
          {renderBlocks()}
        </div>
      </div>
    </div>
  );
};

// --- Export ---
export default Doc;

// --- Utils ---
function htmlToMarkdown(element: HTMLElement): string {
  // Convert HTML to Markdown using Turndown
  const turndownService = new TurndownService();
  turndownService.use(gfm);
  return turndownService.turndown(element.innerHTML);
}

function getNodeForBlock(block: string): string {
  // Pre-process reminders (🎗...;)
  block = block
    .split("\n")
    .map((line) => {
      if (/(?:[\-\*\+]|(?:[0-9]+\.))\s+\[\s\]\s.*🎗.*;/.test(line)) {
        // Only highlight if date is valid (skip for now, no moment.js)
        line = line.replace(/🎗.*?;/, (reminderText) => {
          return `<span class=\"m2-reminder-text\">${reminderText}</span>`;
        });
      }
      return line;
    })
    .join("\n");

  // Render Markdown to HTML (ensure string, not Promise)
  let html: string;
  if (typeof marked.marked === "function") {
    const result = marked.marked(block || "");
    if (typeof result === "string") {
      html = result;
    } else if (result && typeof (result as any).then === "function") {
      // If it's a Promise, this is not supported in this context; fallback
      html = block;
    } else {
      html = String(result);
    }
  } else {
    html = (marked.parse(block || "") as string) || block;
  }
  html = html.replace(/\\/g, "");

  // Special handling for void nodes (wrap in div)
  const temp = document.createElement("div");
  temp.innerHTML = html || "<p>\u200B</p>";
  const first = temp.firstElementChild;
  const isVoidNode =
    /^(AREA|BASE|BR|COL|COMMAND|EMBED|HR|IMG|INPUT|KEYGEN|LINK|META|PARAM|SOURCE|TRACK|WBR)$/i;
  if (first && isVoidNode.test(first.nodeName)) {
    html = `<div>${html}</div>`;
  }

  // Special handling for bookmarks (// )
  if (block.startsWith("// ")) {
    html = `<div class=\"m2-bookmark\">${block.replace("// ", "")}<hr /></div>`;
  }

  return html;
}

// --- Helper: Find deepest first text node in a block for caret placement ---
function findDeepestFirstTextNode(node: Node): {
  node: Node | null;
  offset: number;
} {
  if (!node) return { node: null, offset: 0 };
  if (node.nodeType === Node.TEXT_NODE) {
    return { node, offset: 0 };
  }
  let firstChild = node.firstChild;
  while (firstChild) {
    const result = findDeepestFirstTextNode(firstChild);
    if (result.node) {
      return result;
    }
    firstChild = firstChild.nextSibling;
  }
  return { node: null, offset: 0 };
}

// --- Caret position checks ---
function isCaretAtStartOfBlock(block: HTMLElement, sel: Selection): boolean {
  if (!block || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (range.startContainer === block) {
    return range.startOffset === 0;
  }
  const { node, offset } = findDeepestFirstTextNode(block);
  return sel.anchorNode === node && sel.anchorOffset === offset;
}

// Helper function to find the first text node in an element
function findFirstTextNode(element: Node): Text | null {
  if (element.nodeType === Node.TEXT_NODE) {
    return element as Text;
  }
  for (let i = 0; i < element.childNodes.length; i++) {
    const result = findFirstTextNode(element.childNodes[i]);
    if (result) return result;
  }
  return null;
}
