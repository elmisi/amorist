import { useEffect, useRef, type ReactElement } from "react";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import {
  Editor,
  defaultValueCtx,
  editorViewOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";

export interface MarkdownEditorProps {
  markdown: string;
  onMarkdownChange(markdown: string): void;
  readOnly?: boolean;
}

export function MarkdownEditor(props: MarkdownEditorProps): ReactElement {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  );
}

function MilkdownEditorInner({
  markdown,
  onMarkdownChange,
  readOnly = false,
}: MarkdownEditorProps) {
  const initialMarkdown = useRef(markdown);
  const callbackRef = useRef(onMarkdownChange);
  const animationFrameRef = useRef<number | null>(null);
  const pendingMarkdownRef = useRef<string | null>(null);

  useEffect(() => {
    callbackRef.current = onMarkdownChange;
  }, [onMarkdownChange]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEditor((root) => {
    return Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialMarkdown.current);
        ctx.set(editorViewOptionsCtx, {
          editable: () => !readOnly,
        });
        ctx.get(listenerCtx).markdownUpdated((_ctx, nextMarkdown) => {
          pendingMarkdownRef.current = nextMarkdown;

          if (animationFrameRef.current !== null) {
            return;
          }

          animationFrameRef.current = requestAnimationFrame(() => {
            animationFrameRef.current = null;
            const pending = pendingMarkdownRef.current;
            pendingMarkdownRef.current = null;
            if (pending !== null) {
              callbackRef.current(pending);
            }
          });
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(listener);
  }, []);

  return (
    <div className="milkdown-shell">
      <Milkdown />
    </div>
  );
}
