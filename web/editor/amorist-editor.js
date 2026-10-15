(function () {
  const Internals = window.AmoristInternals || {};
  const DocumentModel = Internals.DocumentModel;
  const TransactionJournal = Internals.TransactionJournal;
  const HtmlToMarkdown = Internals.HtmlToMarkdown;
  const MarkdownCodec = Internals.MarkdownCodec;
  const TableCodec = Internals.TableCodec;
  const CLIPBOARD_TYPE = "application/x-amorist-markdown+json";
  const CARET_SENTINEL = "\u200b";
  if (!HtmlToMarkdown) throw new Error("AmoristHtmlToMarkdown must load before AmoristEditor.");
  if (!MarkdownCodec) throw new Error("AmoristMarkdownCodec must load before AmoristEditor.");

  function create(container, options) { return new AmoristEditor(container, options || {}); }

  function sourceLines(source) {
    const lines = [];
    let start = 0;
    const re = /\r\n|\r|\n/g;
    let match;
    while ((match = re.exec(source))) {
      lines.push({ start, end: match.index, ending: match[0] });
      start = re.lastIndex;
    }
    lines.push({ start, end: source.length, ending: "" });
    return lines;
  }

  function alignedScrollTop(currentScrollTop, caretTop, targetCaretTop) {
    return Math.max(0, currentScrollTop + caretTop - targetCaretTop);
  }

  function clampedLine(number, lineCount) {
    return Math.max(0, Math.min(Math.max(0, lineCount - 1), number));
  }

  function projectionLine(raw) {
    const heading = raw.match(/^ {0,3}(#{1,6})\s+/);
    if (heading) return { prefix: heading[0].length, text: raw.slice(heading[0].length), tag: `h${heading[1].length}` };
    const quote = raw.match(/^ {0,3}(?:>[ \t]?)+/);
    if (quote) return { prefix: quote[0].length, text: raw.slice(quote[0].length), tag: "blockquote",
      quoteDepth: (quote[0].match(/>/g) || []).length };
    const list = raw.match(/^(\s*)([-*+]|\d+[.)])\s+/);
    if (list) {
      const task = raw.slice(list[0].length).match(/^\[([ xX])\]\s+/);
      return {
        prefix: list[0].length + (task ? task[0].length : 0),
        text: raw.slice(list[0].length + (task ? task[0].length : 0)),
        tag: "div",
        list: /\d/.test(list[2]) ? "ordered" : "bullet",
        marker: list[2],
        indent: indentationColumns(list[1]),
        contentIndent: indentationColumns(list[0]),
        checked: task ? /x/i.test(task[1]) : null,
      };
    }
    if (/^ {0,3}(`{3,}|~{3,}).*$/.test(raw)) return { prefix: raw.length, text: "", tag: "pre", fence: true };
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) return { prefix: raw.length, text: "", tag: "hr", rule: true };
    return { prefix: 0, text: raw, tag: "div" };
  }

  function listContextAt(source, offset) {
    const start = lineStart(source, offset);
    const end = lineEnd(source, offset);
    const text = source.slice(start, end);
    const match = text.match(/^(\s*)([-*+]|\d+[.)])([ \t]+)(?:\[([ xX])\]([ \t]+))?/);
    if (!match) return null;
    return {
      kind: "list",
      start,
      end,
      indent: match[1],
      marker: match[2],
      spacing: match[3],
      task: match[4] !== undefined,
      taskSpacing: match[5] || " ",
      markerStart: start + match[1].length,
      contentStart: start + match[0].length,
    };
  }

  function structuralContextAt(source, offset) {
    const list = listContextAt(source, offset);
    if (list) return list;
    const start = lineStart(source, offset);
    const end = lineEnd(source, offset);
    const text = source.slice(start, end);
    const heading = text.match(/^( {0,3})(#{1,6})([ \t]+)/);
    const quote = text.match(/^( {0,3})((?:>[ \t]?)+)/);
    const match = heading || quote;
    if (!match) return null;
    return {
      kind: heading ? "heading" : "quote",
      start,
      end,
      indent: match[1],
      marker: match[2],
      spacing: match[3] || "",
      markerStart: start + match[1].length,
      contentStart: start + match[0].length,
    };
  }

  function continuedListPrefix(context) {
    let marker = context.marker;
    const ordered = marker.match(/^(\d+)([.)])$/);
    if (ordered) marker = String(Number(ordered[1]) + 1) + ordered[2];
    return context.indent + marker + context.spacing
      + (context.task ? "[ ]" + context.taskSpacing : "");
  }

  function continuedStructuralPrefix(context) {
    if (context.kind === "quote") return context.indent + context.marker + context.spacing;
    if (context.kind === "continuation") return context.indent;
    return continuedListPrefix(context);
  }

  function sameLineLayout(a, b) {
    return a.tag === b.tag && a.prefix === b.prefix && a.list === b.list
      && a.indent === b.indent && a.quoteDepth === b.quoteDepth
      && a.listContinuation === b.listContinuation && a.layoutPadding === b.layoutPadding
      && a.containerListPadding === b.containerListPadding
      && a.quoteList === b.quoteList
      && a.directListSignature === b.directListSignature
      && a.inlineSignature === b.inlineSignature
      && a.markerWidth === b.markerWidth && a.marker === b.marker
      && a.referenceDefinition === b.referenceDefinition
      && a.setextLevel === b.setextLevel
      && a.suffix === b.suffix
      && (typeof a.checked === "boolean") === (typeof b.checked === "boolean");
  }

  function indentationColumns(text) {
    let columns = 0;
    for (const char of text) columns += char === "\t" ? 4 - columns % 4 : 1;
    return columns;
  }

  function quotePrefix(raw, depth) {
    let offset = 0;
    for (let level = 0; level < depth; level += 1) {
      const marker = raw.slice(offset).match(/^ {0,3}>[ \t]?/);
      if (!marker) return null;
      offset += marker[0].length;
    }
    return raw.slice(0, offset);
  }

  function listContainerPrefix(raw, columns) {
    if (!columns) return "";
    const whitespace=(raw.match(/^[ \t]*/)||[""])[0];
    if(indentationColumns(whitespace)<columns) return raw.trim()?null:"";
    let consumed=0,offset=0;
    while(consumed<columns) {const char=whitespace[offset++];consumed+=char==='\t'?4-consumed%4:1;}
    return whitespace.slice(0,offset);
  }

  function inlineRowTokens(tokens, source, start, end) {
    const point=value=>Math.max(0,Math.min(end,value)-start);
    return tokens.filter(token=>token.end>start&&token.start<end&&token.type!=="break").map(token=>{
      if(token.type==="image"&&(token.start<start||token.end>end)) {
        const result={...token,type:token.start<start?"image-continuation":"image",start:point(token.start),end:point(token.end)};
        Object.defineProperty(result,"originalToken",{value:token});
        return result;
      }
      const result={...token,start:point(token.start),end:point(token.end)};
      Object.defineProperty(result,"originalToken",{value:token});
      if(token.contentStart!==undefined)result.contentStart=point(token.contentStart);
      if(token.contentEnd!==undefined)result.contentEnd=point(token.contentEnd);
      if(token.contentStart!==undefined&&token.contentEnd!==undefined) {
        result.openingMarkup=source.slice(token.start,token.contentStart);
        result.closingMarkup=source.slice(token.contentEnd,token.end);
        result.continuesBefore=token.contentStart<start;
        result.continuesAfter=token.contentEnd>end;
      }
      if(token.children)result.children=inlineRowTokens(token.children,source,start,end);
      if((token.type==="text"||token.type==="code")&&(token.start<start||token.end>end)) {
        result.text=source.slice(Math.max(start,token.contentStart??token.start),Math.min(end,token.contentEnd??token.end));
      }
      return result;
    });
  }

  class AmoristEditor {
    constructor(container, options) {
      if (!DocumentModel || !TransactionJournal) {
        throw new Error("AmoristDocumentModel must load before creating AmoristEditor.");
      }
      this.container = container;
      this.options = options;
      this.model = new DocumentModel(options.value || "");
      this.history = new TransactionJournal(100);
      this.sourceNodeRanges = new WeakMap();
      this.mode = "wysiwyg";
      this.inlineMode = null;
      this.isRendering = false;
      this.root = document.createElement("div");
      this.root.className = "amorist-editor";
      this.toolbar = document.createElement("div");
      this.toolbar.className = "amorist-editor-toolbar";
      this.surface = document.createElement("div");
      this.surface.className = "amorist-editor-surface";
      this.surface.contentEditable = "true";
      this.surface.spellcheck = options.spellcheck !== false;
      this.source = document.createElement("textarea");
      this.source.className = "amorist-editor-source";
      this.source.hidden = true;
      this.source.spellcheck = false;
      // C2 is defined over physical Markdown lines, not soft-wrapped display
      // fragments.  Horizontal scrolling is preferable to changing the line
      // identity used while comparing Source with WYSIWYG.
      this.source.wrap = "off";
      this.findBar = document.createElement("div");
      this.findBar.className = "amorist-editor-findbar";
      this.findBar.hidden = true;
      this.findInput = document.createElement("input");
      this.findInput.type = "text";
      this.findInput.className = "amorist-editor-findbar-input";
      this.findInput.placeholder = "Find...";
      this.findCount = document.createElement("span");
      this.findCount.className = "amorist-editor-findbar-count";
      const closeFind = document.createElement("button");
      closeFind.type = "button";
      closeFind.className = "amorist-editor-findbar-close";
      closeFind.textContent = "×";
      closeFind.title = "Close";
      closeFind.addEventListener("click", () => this.closeFindBar());
      this.findBar.append(this.findInput, this.findCount, closeFind);
      this.root.append(this.toolbar, this.findBar, this.surface, this.source);
      container.replaceChildren(this.root);
      this.buildToolbar();
      this.bind();
      this.render();
      this.installCurrentLine();
    }

    buildToolbar() {
      const actions = [["bold", "B"], ["italic", "I"], ["code", "</>"], ["link", "↗"],
        ["h1", "H1"], ["h2", "H2"], ["h3", "H3"], ["bullet", "•"],
        ["ordered", "1."], ["task", "☐"], ["quote", "❝"], ["codeblock", "{ }"], ["source", "Source"]];
      actions.forEach(([action, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.action = action;
        button.textContent = label;
        button.addEventListener("click", () => this.runAction(action));
        this.toolbar.append(button);
      });
    }

    bind() {
      this.surface.addEventListener("beforeinput", (event) => this.handleBeforeInput(event));
      for (const pane of [this.surface, this.source]) {
        pane.addEventListener("paste", event => this.handlePaste(event));
        pane.addEventListener("copy", event => this.handleCopy(event, false));
        pane.addEventListener("cut", event => this.handleCopy(event, true));
      }
      this.surface.addEventListener("keydown", (event) => this.handleKeyDown(event));
      this.surface.addEventListener("click", (event) => this.handleClick(event));
      this.source.addEventListener("input", () => this.handleSourceInput());
      this.source.addEventListener("beforeinput", (event) => {
        this.sourceBeforeInput = { start:this.model.rawOffset(this.source.selectionStart), end:this.model.rawOffset(this.source.selectionEnd),
          inputType:event.inputType, data:event.data, revision:this.model.revision };
      });
      this.source.addEventListener("keydown", (event) => this.handleKeyDown(event));
      this.findInput.addEventListener("input", () => this.performFind());
      this.findInput.addEventListener("keydown", (event) => this.handleFindKeyDown(event));
    }

    installCurrentLine() {
      this.currentLine = document.createElement("div");
      this.currentLine.className = "amorist-current-line";
      this.currentLine.contentEditable = "false";
      this.currentLine.setAttribute("aria-hidden", "true");
      this.currentLine.hidden = true;
      this.root.append(this.currentLine);
      this.currentLineEvents = new AbortController();
      const signal = this.currentLineEvents.signal;
      document.addEventListener("selectionchange", () => {
        const selection=window.getSelection();
        if(this.mode!=="wysiwyg"||!selection?.rangeCount) return;
        const range=selection.getRangeAt(0);
        if(this.surface.contains(range.startContainer)&&this.surface.contains(range.endContainer)) {
          this.toolbarSelection={start:this.rawPoint(range.startContainer,range.startOffset),
            end:this.rawPoint(range.endContainer,range.endOffset),
            direction:!selection.isCollapsed&&selection.anchorNode===range.endContainer&&selection.anchorOffset===range.endOffset?"backward":"forward",
            revision:this.model.revision};
        }
      }, {signal});
      this.windowFocused = true;
      this.scheduleCurrentLine = () => {
        if (this.currentLineFrame) return;
        this.currentLineFrame = requestAnimationFrame(() => { this.currentLineFrame = 0; this.drawCurrentLine(); });
      };
      for (const event of ["selectionchange", "select", "scroll", "input", "keyup", "pointerup", "focusin", "focusout"]) {
        document.addEventListener(event, this.scheduleCurrentLine, {capture:true, signal});
      }
      window.addEventListener("resize", this.scheduleCurrentLine, {signal});
      window.addEventListener("blur", () => {this.windowFocused=false; this.scheduleCurrentLine();}, {signal});
      window.addEventListener("focus", () => {this.windowFocused=true; this.scheduleCurrentLine();}, {signal});
      this.currentLineResize = new ResizeObserver(this.scheduleCurrentLine);
      this.currentLineResize.observe(this.root);
      this.currentLineDialogs = new MutationObserver(this.scheduleCurrentLine);
      this.currentLineDialogs.observe(document.body, {subtree:true, attributes:true, attributeFilter:["open"]});
    }

    drawCurrentLine() {
      this.currentLine.hidden = true;
      if (!this.settings?.highlightCurrentLine || !this.windowFocused || document.querySelector("dialog[open]")) return;
      let top, height, viewport, paintParent=this.root;
      if (this.mode === "source") {
        if (document.activeElement !== this.source) return;
        if (this.currentLineSource !== this.model.source) {
          this.currentLineSource = this.model.source;
          this.currentLineStarts = sourceLines(this.model.source).map(line=>line.start);
        }
        const active = this.source.selectionDirection === "backward" ? this.source.selectionStart : this.source.selectionEnd;
        const raw = this.model.rawOffset(active), starts = this.currentLineStarts;
        let lo=0, hi=starts.length;
        while (lo+1<hi) {const mid=(lo+hi)>>1; if(starts[mid]<=raw) lo=mid; else hi=mid;}
        const style=getComputedStyle(this.source), box=this.source.getBoundingClientRect();
        height=parseFloat(style.lineHeight);
        top=box.top+this.source.clientTop+(parseFloat(style.paddingTop)||0)+lo*height-this.source.scrollTop;
        viewport={left:box.left+this.source.clientLeft,right:box.left+this.source.clientLeft+this.source.clientWidth,
          top:box.top+this.source.clientTop,bottom:box.top+this.source.clientTop+this.source.clientHeight};
      } else {
        if (document.activeElement !== this.surface) return;
        const selection=window.getSelection();
        if (!selection?.focusNode || !this.surface.contains(selection.focusNode)) return;
        let node=selection.focusNode, offset=selection.focusOffset;
        const element=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
        let row=element.closest(".amorist-source-line");
        if(!row && node.nodeType===Node.ELEMENT_NODE) {
          // Select All and block-boundary ranges may end on the container,
          // rather than on a text node. Resolve only that adjacent subtree.
          const backward=offset>0;
          let candidate=node.childNodes[backward?offset-1:0];
          while(candidate && candidate.nodeType===Node.ELEMENT_NODE) {
            if(candidate===this.currentLine || candidate.matches('.amorist-wysiwyg-fence,.amorist-wysiwyg-setext-delimiter')) {
              candidate=backward?candidate.previousElementSibling:candidate.nextElementSibling; continue;
            }
            if(candidate.matches('.amorist-source-line')) {row=candidate; break;}
            candidate=backward?candidate.lastElementChild:candidate.firstElementChild;
          }
          if(row) {
            const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT);
            let text;
            while((text=walker.nextNode())) {
              if(!text.length || text.data==='\n') continue;
              node=text;offset=backward?text.length:0;
              if(!backward) break;
            }
          }
        }
        if(!row || row.getBoundingClientRect().height<1 || element.closest(".amorist-wysiwyg-fence,.amorist-wysiwyg-setext-delimiter")) return;
        const range=document.createRange(); range.setStart(node,offset); range.collapse(true);
        let rect=Array.from(range.getClientRects()).find(rect=>rect.height>0);
        if(!rect && node.nodeType===Node.TEXT_NODE && node.length) {
          const point=offset;
          range.setStart(node,point<node.length?point:previousCodeUnit(node.data,point));
          range.setEnd(node,point<node.length?nextCodeUnit(node.data,point):point);
          rect=Array.from(range.getClientRects()).find(rect=>rect.height>0);
        }
        const rowBox=row.getBoundingClientRect(), style=getComputedStyle(row);
        height=parseFloat(style.lineHeight);
        const contentTop=rowBox.top+row.clientTop+(parseFloat(style.paddingTop)||0);
        const line=rect?Math.max(0,Math.floor((rect.top+rect.height/2-contentTop)/height)):0;
        // Inline images make successive wrapped lines unevenly spaced. Keep
        // one text-line height, anchored to the actual caret's visual line.
        top=rect && row.querySelector('.amorist-image:not([hidden])')
          ? rect.top-(height-rect.height)/2 : contentTop+line*height;
        const block=row.closest(".amorist-wysiwyg-table-block,.amorist-wysiwyg-code-block") || this.surface;
        if(block!==this.surface) paintParent=block;
        const box=block.getBoundingClientRect();
        viewport={left:box.left+block.clientLeft,right:box.left+block.clientLeft+block.clientWidth,
          top:box.top+block.clientTop,bottom:box.top+block.clientTop+block.clientHeight};
        if(block===this.surface) {
          viewport.left+=parseFloat(getComputedStyle(this.surface).paddingLeft)||0;
          viewport.right-=parseFloat(getComputedStyle(this.surface).paddingRight)||0;
        }
      }
      const scroller=scrollViewportFor(this.mode==="source"?this.source:this.surface);
      if(scroller!==document.scrollingElement && scroller!==document.documentElement) {
        const box=scroller.getBoundingClientRect();
        viewport.top=Math.max(viewport.top,box.top+scroller.clientTop);
        viewport.bottom=Math.min(viewport.bottom,box.top+scroller.clientTop+scroller.clientHeight);
      }
      const toolbarBottom=this.toolbar.getBoundingClientRect().bottom;
      const clippedTop=Math.max(top,viewport.top,toolbarBottom,0), bottom=Math.min(top+height,viewport.bottom,window.innerHeight);
      const left=Math.max(0,viewport.left), right=Math.min(window.innerWidth,viewport.right);
      if(!Number.isFinite(top) || !Number.isFinite(height) || bottom<=clippedTop || right<=left) return;
      if(this.currentLine.parentElement!==paintParent) paintParent.append(this.currentLine);
      Object.assign(this.currentLine.style,{top:clippedTop+"px",left:left+"px",width:(right-left)+"px",height:(bottom-clippedTop)+"px"});
      this.currentLine.hidden=false;
    }

    applySettings(settings) {
      if (JSON.stringify(this.settings) === JSON.stringify(settings)) return;
      const anchor = this.mode === "source" ? this.sourceViewportAnchor() : this.wysiwygViewportAnchor();
      const scrolls = Array.from(this.surface.querySelectorAll('.amorist-wysiwyg-table-block')).map(block => ({
        block, left:block.scrollLeft, pinned:block.scrollWidth-block.clientWidth-block.scrollLeft<=1,
      }));
      this.settings = {...settings};
      this.root.classList.toggle("amorist-highlight-current-line", !!settings.highlightCurrentLine);
      this.root.style.setProperty('--amorist-base-font-size', settings.baseFontSize + 'px');
      // WebKit rounds fractional textarea line advances, while computedStyle
      // retains the fraction. Use integral pixels so caret and overlay agree.
      this.root.style.setProperty('--amorist-source-line-height', Math.round(settings.baseFontSize * 1.6) + 'px');
      this.root.style.setProperty('--amorist-table-scale', String(settings.tableScale));
      this.root.style.setProperty('--amorist-code-scale', String(settings.codeScale));
      this.root.style.setProperty('--amorist-current-line-color', settings.highlightColor);
      scrolls.forEach(({block})=>block.querySelectorAll(".amorist-wysiwyg-table-cell").forEach(cell=>{cell.style.paddingInlineEnd="0px";}));
      this.layoutTableBlocks(scrolls.map(item=>item.block));
      scrolls.forEach(({block,left,pinned})=> { const maximum=Math.max(0,block.scrollWidth-block.clientWidth); block.scrollLeft=pinned?maximum:Math.min(left,maximum); });
      if (this.mode === "source") this.restoreSourceViewportAnchor(anchor);
      else this.restoreWysiwygViewportAnchor(anchor);
      this.scheduleCurrentLine?.();
    }

    destroy() {
      this.currentLineEvents?.abort(); this.currentLineResize?.disconnect(); this.currentLineDialogs?.disconnect();
      if (this.currentLineFrame) cancelAnimationFrame(this.currentLineFrame);
      this.container.replaceChildren();
    }
    focus() { (this.mode === "source" ? this.source : this.surface).focus(); }
    getMarkdown() { return this.model.source; }
    getValue() { return this.model.source; }

    setMarkdown(markdown, options) {
      this.toolbarSelection=null;
      this.sourceBeforeInput = null;
      this.model = new DocumentModel(markdown || "");
      this.history = new TransactionJournal(100);
      this.sourceNodeRanges = new WeakMap();
      this.inlineMode = null;
      this.render();
      if (!options || !options.silent) this.emitChange();
    }

    buildProjection(source = this.model.source) {
      const lines = sourceLines(source);
      const rawLines = lines.map((line) => source.slice(line.start, line.end));
      const descriptors = lines.map((line, index) => ({
        ...line,
        index,
        raw: rawLines[index],
        projection: projectionLine(rawLines[index]),
        unitType: "line",
        unitStart: index,
        unitEnd: index,
        codeContent: false,
      }));

      let index = 0;
      if (rawLines[0] === "---") {
        const closing = rawLines.findIndex((line, at) => at > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
        if (closing > 0) {
          for (let at = 0; at <= closing; at += 1) {
            descriptors[at].unitType = "literal";
            descriptors[at].projection = { prefix: 0, text: descriptors[at].raw, tag: "div", literal: true };
          }
        }
      }
      const listContainers=[];
      while (index < descriptors.length) {
        if (descriptors[index].unitType === "literal") { index += 1; continue; }
        const descriptor=descriptors[index],columns=indentationColumns((descriptor.raw.match(/^[ \t]*/)||[""])[0]);
        const directQuote=descriptor.projection.tag==="blockquote"?descriptor.projection.quoteDepth:0;
        const directOuter=directQuote?quotePrefix(descriptor.raw,directQuote):"";
        const directList=directQuote?projectionLine(descriptor.raw.slice(directOuter.length)):descriptor.projection;
        const directFence=directList.list&&directList.text.match(/^ {0,3}(`{3,}|~{3,}).*$/);
        if(directFence){
          const markerWidth=typeof directList.checked==="boolean"?"max(1.4em, 24px)":`max(1.4em, ${directList.marker.length+1}ch)`;
          const owner={index,indent:directList.indent,contentIndent:directList.contentIndent,markerWidth,
            layoutPadding:`calc(${directQuote*11}px + ${directList.indent}ch + ${markerWidth})`,
            marker:directList.marker,list:directList.list,checked:directList.checked,quoteDepth:directQuote};
          const prefixFor=(raw,first=false)=>{
            const quote=directQuote?quotePrefix(raw,directQuote):"";if(quote===null)return null;
            const list=first?raw.slice(quote.length,quote.length+directList.prefix):listContainerPrefix(raw.slice(quote.length),owner.contentIndent);
            return list===null?null:quote+list;
          };
          const closing=new RegExp(`^ {0,3}\\${directFence[1][0]}{${directFence[1].length},}[ \\t]*$`);
          let end=index,closed=false;
          for(let next=index+1;next<descriptors.length;next++){
            const prefix=prefixFor(descriptors[next].raw);if(prefix===null)break;
            end=next;if(closing.test(descriptors[next].raw.slice(prefix.length))){closed=true;break;}
          }
          for(let row=index;row<=end;row++){
            const item=descriptors[row],prefix=prefixFor(item.raw,row===index)||"",content=row>index&&(!closed||row<end);
            Object.assign(item,{unitType:"code",unitStart:index,unitEnd:end,codeContent:content,listOwner:owner,
              containerPrefix:prefix,containerQuoteDepth:directQuote,containerQuoteBeforeList:!!directQuote,
              containerQuotePrefix:directQuote?quotePrefix(item.raw,directQuote):"",
              projection:content?{prefix:prefix.length,text:item.raw.slice(prefix.length),tag:"pre"}
                :{prefix:item.raw.length,text:"",tag:"pre",fence:true}});
          }
          descriptor.directListOwner=owner;
          descriptor.projection.directListSignature=JSON.stringify({marker:owner.marker,checked:owner.checked});
          if(!directQuote){
            while(listContainers.length&&listContainers.at(-1).indent>=directList.indent)listContainers.pop();
            listContainers.push(directList);
          }
          index=end+1;continue;
        }
        if(descriptor.projection.list) {
          while(listContainers.length&&listContainers.at(-1).indent>=descriptor.projection.indent) listContainers.pop();
          listContainers.push(descriptor.projection);
        } else if(descriptor.raw.trim()) {
          while(listContainers.length&&columns<listContainers.at(-1).contentIndent) listContainers.pop();
        }
        const owner=listContainers.findLast(item=>columns>=item.contentIndent),listIndent=owner?.contentIndent||0;
        const listPrefix=listContainerPrefix(descriptor.raw,listIndent)||"";
        const relative=descriptor.raw.slice(listPrefix.length);
        const quoteDepth=(!owner||columns-listIndent<=3)?projectionLine(relative).quoteDepth||0:0;
        const prefixFor=raw=>{
          const prefix=listContainerPrefix(raw,listIndent);if(prefix===null)return null;
          if(quoteDepth&&owner&&raw.trim()&&indentationColumns((raw.match(/^[ \t]*/)||[""])[0])-listIndent>3)return null;
          const quote=quoteDepth?quotePrefix(raw.slice(prefix.length),quoteDepth):"";
          return quote===null?null:prefix+quote;
        };
        const outerPrefix=prefixFor(descriptor.raw)||"";
        const opening=(!owner||columns-listIndent<=3)?descriptor.raw.slice(outerPrefix.length).match(/^ {0,3}(`{3,}|~{3,}).*$/):null;
        if (opening) {
          const marker = opening[1][0];
          const length = opening[1].length;
          let end = index;
          const closing = new RegExp(`^ {0,3}\\${marker}{${length},}\\s*$`);
          let hasClosingFence = false;
          for (let next = index + 1; next < descriptors.length; next += 1) {
            const prefix = prefixFor(descriptors[next].raw);
            if (prefix === null && descriptors[next].raw.trim()) break;
            end = next;
            if ((quoteDepth||!owner||indentationColumns((descriptors[next].raw.match(/^[ \t]*/)||[""])[0])-listIndent<=3)
                && closing.test(descriptors[next].raw.slice((prefix || "").length))) {
              hasClosingFence = true;
              break;
            }
          }
          for (let at = index; at <= end; at += 1) {
            Object.assign(descriptors[at], {
              unitType: "code",
              unitStart: index,
              unitEnd: end,
              codeContent: at > index && (!hasClosingFence || at < end),
              containerPrefix: prefixFor(descriptors[at].raw)||"",
              containerQuoteDepth: quoteDepth,
              containerQuotePrefix: (prefixFor(descriptors[at].raw)||"").slice((listContainerPrefix(descriptors[at].raw,listIndent)||"").length),
            });
            // Classify the containing block before interpreting its contents.
            // Markdown-looking text inside code is literal, including fences
            // shorter than the opening delimiter.
            descriptors[at].projection = descriptors[at].codeContent
              ? { prefix: descriptors[at].containerPrefix.length,
                  text: descriptors[at].raw.slice(descriptors[at].containerPrefix.length), tag: "pre" }
              : { prefix: descriptors[at].raw.length, text: "", tag: "pre", fence: true };
          }
          index = end + 1;
          continue;
        }
        const logicalRaw = descriptors[index].raw.slice(outerPrefix.length);
        const previous = descriptors[index - 1];
        const previousPrefix = quoteDepth && previous ? prefixFor(previous.raw) : null;
        const followsBlank = !previous || !previous.raw.trim()
          || (previousPrefix !== null && !previous.raw.slice(previousPrefix.length).trim());
        if (quoteDepth && indentationColumns((logicalRaw.match(/^[ \t]*/) || [""])[0]) >= 4
            && (followsBlank || previous.unitType === "code"&&!previous.listOwner?.quoteDepth)) {
          let end = index;
          for (let next = index + 1; next < descriptors.length; next += 1) {
            const prefix = prefixFor(descriptors[next].raw);
            if (prefix === null && descriptors[next].raw.trim()) break;
            const content = descriptors[next].raw.slice((prefix || "").length);
            if (!content.trim()) continue;
            if (indentationColumns((content.match(/^[ \t]*/) || [""])[0]) < 4) break;
            end = next;
          }
          for (let at = index; at <= end; at += 1) {
            const prefix = prefixFor(descriptors[at].raw)||"";
            Object.assign(descriptors[at], {
              unitType: "code", unitStart: index, unitEnd: end,
              codeContent: true, indentedCode: true,
              containerPrefix: prefix, containerQuoteDepth: quoteDepth,
              containerQuotePrefix: prefix.slice((listContainerPrefix(descriptors[at].raw,listIndent)||"").length),
              projection: {prefix: prefix.length, text: descriptors[at].raw.slice(prefix.length), tag: "pre"},
            });
          }
          index = end + 1;
          continue;
        }
        if (TableCodec && indentationColumns((rawLines[index].match(/^[ \t]*/) || [""])[0]) < 4
            && TableCodec.isTableStart(rawLines, index)) {
          const columns = TableCodec.splitTableRow(rawLines[index]).length;
          let end = index + 2;
          while (end < rawLines.length && TableCodec.looksLikeTableRow(rawLines[end], columns)) end += 1;
          end -= 1;
          for (let at = index; at <= end; at += 1) {
            Object.assign(descriptors[at], { unitType: "table", unitStart: index, unitEnd: end });
          }
          index = end + 1;
          continue;
        }
        index += 1;
      }
      const items = [];
      for (let at = 0; at < descriptors.length; at += 1) {
        const descriptor = descriptors[at];
        const projection = descriptor.projection;
        const leading = (descriptor.raw.match(/^[ \t]*/) || [""])[0];
        const columns = indentationColumns(leading);
        if (descriptor.unitType !== "line") {
          if(descriptor.directListOwner&&!descriptor.directListOwner.quoteDepth){
            while(items.length&&items.at(-1).indent>=descriptor.directListOwner.indent)items.pop();
            items.push(descriptor.directListOwner);continue;
          }
          const owner=items.findLast(item=>columns>=item.contentIndent);
          if(owner&&!descriptor.listOwner)descriptor.listOwner=owner;
          if (descriptor.index === descriptor.unitStart && items.length
              && columns < items[items.length - 1].contentIndent) items.length = 0;
          continue;
        }
        const parent = items.findLast((owner) => columns >= owner.contentIndent);
        const previous = descriptors[at - 1];
        // A list's marker indentation belongs to the container. Code is
        // recognized relative to its content column, before inline styling.
        const nestedFence = parent && columns - parent.contentIndent <= 3
          ? descriptor.raw.slice(leading.length).match(/^(`{3,}|~{3,}).*$/) : null;
        const nestedIndented = parent && columns >= parent.contentIndent + 4
          && previous && !previous.raw.trim();
        if (nestedFence || nestedIndented) {
          let end = at, closed = false;
          const closing = nestedFence
            ? new RegExp(`^\\${nestedFence[1][0]}{${nestedFence[1].length},}[ \\t]*$`) : null;
          for (let next = at + 1; next < descriptors.length; next += 1) {
            const candidate = descriptors[next];
            const whitespace = (candidate.raw.match(/^[ \t]*/) || [""])[0];
            const indent = indentationColumns(whitespace);
            if (candidate.raw.trim() && indent < parent.contentIndent) break;
            if (nestedFence) {
              end = next;
              if (indent - parent.contentIndent <= 3 && closing.test(candidate.raw.slice(whitespace.length))) {
                closed = true;
                break;
              }
            } else {
              if (!candidate.raw.trim()) continue;
              if (indent < parent.contentIndent + 4) break;
              end = next;
            }
          }
          for (let line = at; line <= end; line += 1) {
            const content = !nestedFence || (line > at && (!closed || line < end));
            Object.assign(descriptors[line], {
              unitType: "code", unitStart: at, unitEnd: end,
              codeContent: content, indentedCode: !nestedFence,
              projection: content
                ? {prefix: 0, text: descriptors[line].raw, tag: "pre"}
                : {prefix: descriptors[line].raw.length, text: "", tag: "pre", fence: true},
            });
          }
          at = end;
          continue;
        }
        if (columns >= 4 && !parent && (!previous || !previous.raw.trim() || previous.unitType === "code")) {
          let end = at;
          let next = at + 1;
          while (next < descriptors.length && descriptors[next].unitType === "line") {
            const raw = descriptors[next].raw;
            if (!raw.trim()) { next += 1; continue; }
            if (indentationColumns((raw.match(/^[ \t]*/) || [""])[0]) < 4) break;
            end = next; next += 1;
          }
          for (let line = at; line <= end; line += 1) {
            Object.assign(descriptors[line], { unitType: "code", unitStart: at, unitEnd: end,
              codeContent: true, indentedCode: true,
              projection: { prefix: 0, text: descriptors[line].raw, tag: "pre" } });
          }
          items.length = 0;
          at = end;
          continue;
        }
        if (projection.list) {
          while (items.length && items[items.length - 1].indent >= projection.indent) items.pop();
          const markerWidth = typeof projection.checked === "boolean"
            ? "max(1.4em, 24px)" : `max(1.4em, ${projection.marker.length + 1}ch)`;
          projection.markerWidth = markerWidth;
          projection.layoutPadding = `calc(${projection.indent}ch + ${markerWidth})`;
          const owner = { index: descriptor.index, indent: projection.indent,
            contentIndent: projection.contentIndent, markerWidth, layoutPadding: projection.layoutPadding };
          descriptor.listOwner = owner;
          items.push(owner);
          continue;
        }
        const ownerIndex = items.findLastIndex((owner) => columns >= owner.contentIndent);
        const nestedQuote = ownerIndex >= 0 ? projectionLine(descriptor.raw.slice(leading.length)) : null;
        if (nestedQuote?.tag === "blockquote") {
          items.length = ownerIndex + 1;
          const owner = items[ownerIndex];
          descriptor.listOwner = owner;
          descriptor.projection = {...nestedQuote, prefix: leading.length + nestedQuote.prefix,
            containerListPadding: owner.layoutPadding};
        } else if (ownerIndex >= 0 && projection.tag === "div" && !projection.rule && !projection.fence) {
          items.length = ownerIndex + 1;
          const owner = items[ownerIndex];
          descriptor.listOwner = owner;
          descriptor.projection = { prefix: leading.length, text: descriptor.raw.slice(leading.length),
            tag: "div", listContinuation: true, layoutPadding: owner.layoutPadding };
        } else if (descriptor.raw.trim()) items.length = 0;
      }
      const quotedItems=[];
      let quotedDepth=0;
      for(let quotedAt=0;quotedAt<descriptors.length;quotedAt++){
        const descriptor=descriptors[quotedAt];
        if(descriptor.directListOwner?.quoteDepth){
          const owner=descriptor.directListOwner;
          if(quotedDepth!==owner.quoteDepth)quotedItems.length=0;
          quotedDepth=owner.quoteDepth;
          while(quotedItems.length&&quotedItems.at(-1).indent>=owner.indent)quotedItems.pop();
          quotedItems.push(owner);quotedAt=descriptor.unitEnd;continue;
        }
        if(quotedItems.length){
          const outerPrefix=quotePrefix(descriptor.raw,quotedDepth);
          const inner=outerPrefix===null?null:descriptor.raw.slice(outerPrefix.length);
          const columns=inner===null?-1:indentationColumns((inner.match(/^[ \t]*/)||[""])[0]);
          const owner=quotedItems.findLast(item=>columns>=item.contentIndent);
          if(owner){
            const prefixFor=raw=>{
              const quote=quotePrefix(raw,quotedDepth);if(quote===null)return null;
              const list=listContainerPrefix(raw.slice(quote.length),owner.contentIndent);
              return list===null?null:quote+list;
            };
            const prefix=prefixFor(descriptor.raw),logical=descriptor.raw.slice(prefix.length);
            const opening=columns-owner.contentIndent<=3&&logical.match(/^ {0,3}(`{3,}|~{3,}).*$/);
            const previous=descriptors[quotedAt-1];
            const previousQuote=previous&&quotePrefix(previous.raw,quotedDepth);
            const blank=previousQuote!==null&&previousQuote!==undefined&&!previous.raw.slice(previousQuote.length).trim();
            const indented=!opening&&columns>=owner.contentIndent+4&&(blank||previous?.listOwner===owner&&previous.unitType==="code");
            if(opening||indented){
              const closing=opening&&new RegExp(`^ {0,3}\\${opening[1][0]}{${opening[1].length},}[ \\t]*$`);
              let end=quotedAt,closed=false;
              for(let next=quotedAt+1;next<descriptors.length;next++){
                const nextPrefix=prefixFor(descriptors[next].raw);if(nextPrefix===null)break;
                const content=descriptors[next].raw.slice(nextPrefix.length);
                if(indented){if(!content.trim())continue;if(indentationColumns((content.match(/^[ \t]*/)||[""])[0])<4)break;}
                end=next;
                if(opening&&closing.test(content)){closed=true;break;}
              }
              for(let row=quotedAt;row<=end;row++){
                const item=descriptors[row],container=prefixFor(item.raw)||"";
                const content=indented||row>quotedAt&&(!closed||row<end);
                Object.assign(item,{unitType:"code",unitStart:quotedAt,unitEnd:end,codeContent:content,
                  indentedCode:!!indented,listOwner:owner,containerQuoteBeforeList:true,containerPrefix:container,containerQuoteDepth:quotedDepth,
                  containerQuotePrefix:quotePrefix(item.raw,quotedDepth)||"",
                  projection:content?{prefix:container.length,text:item.raw.slice(container.length),tag:"pre"}
                    :{prefix:item.raw.length,text:"",tag:"pre",fence:true}});
              }
              quotedAt=end;continue;
            }
          }
        }
        const outer=descriptor.projection;
        if(descriptor.unitType!=="line"||outer.tag!=="blockquote") { quotedItems.length=0;quotedDepth=0;continue; }
        if(quotedDepth!==outer.quoteDepth)quotedItems.length=0;
        quotedDepth=outer.quoteDepth;
        if(!outer.text.trim())continue;
        const inner=projectionLine(outer.text);
        const whitespace=(outer.text.match(/^[ \t]*/)||[""])[0];
        const columns=indentationColumns(whitespace);
        let projection,owner;
        if(inner.list){
          while(quotedItems.length&&quotedItems.at(-1).indent>=inner.indent)quotedItems.pop();
          inner.markerWidth=typeof inner.checked==="boolean"?"max(1.4em, 24px)":`max(1.4em, ${inner.marker.length+1}ch)`;
          inner.layoutPadding=`calc(${outer.quoteDepth*11}px + ${inner.indent}ch + ${inner.markerWidth})`;
          owner={index:descriptor.index,indent:inner.indent,contentIndent:inner.contentIndent,layoutPadding:inner.layoutPadding,markerWidth:inner.markerWidth};
          quotedItems.push(owner);
          projection={...inner,prefix:outer.prefix+inner.prefix};
        }else{
          const at=quotedItems.findLastIndex(item=>columns>=item.contentIndent);
          if(at<0||inner.tag!=="div"||!outer.text.trim()){quotedItems.length=0;continue;}
          quotedItems.length=at+1;owner=quotedItems[at];
          projection={prefix:outer.prefix+whitespace.length,text:outer.text.slice(whitespace.length),tag:"div",listContinuation:true,layoutPadding:owner.layoutPadding};
        }
        descriptor.listOwner=owner;
        descriptor.projection={...projection,quoteDepth:outer.quoteDepth,quoteList:true,
          quoteContainerPrefix:descriptor.raw.slice(0,outer.prefix),containerListPadding:outer.containerListPadding};
      }
      const references = new Map();
      descriptors.references = references;
      const logicalStarts = [];
      let logicalSource = "";
      descriptors.forEach(descriptor => {
        logicalStarts.push(logicalSource.length);
        logicalSource += descriptor.projection.text + descriptor.ending;
      });
      for (let at = 0; at < descriptors.length; at++) {
        const descriptor = descriptors[at], previous = descriptors[at - 1];
        if (descriptor.unitType !== "line" || descriptor.projection.rule || descriptor.projection.fence) continue;
        // Definitions may start a paragraph, but cannot interrupt ordinary prose.
        if (previous && previous.unitType === "line" && previous.raw.trim()
            && !previous.projection.referenceDefinition && !descriptor.projection.list
            && previous.projection.tag === "div" && !previous.projection.rule) continue;
        const definition = MarkdownCodec.referenceDefinitionAt(logicalSource, logicalStarts[at]);
        if (!definition) continue;
        let last = at;
        while (last + 1 < descriptors.length && logicalStarts[last + 1] < definition.end) last++;
        const members = descriptors.slice(at, last + 1);
        if (members.some(member => member.unitType !== "line" || member.projection.rule || member.projection.fence
            || (member !== descriptor && member.projection.list)
            || (member.projection.quoteDepth || 0) !== (descriptor.projection.quoteDepth || 0))) continue;
        if (!references.has(definition.key)) references.set(definition.key, {href: definition.href, title: definition.title, rawDefinition: logicalSource.slice(logicalStarts[at],definition.end)});
        const opening=logicalStarts[at]+(descriptor.projection.text.match(/^ */)||[""])[0].length;
        const label=MarkdownCodec.referenceLabelAt(logicalSource,opening);
        const rawAt=offset=> {
          let index=at;
          while(index<last && logicalStarts[index+1]<=offset) index++;
          return descriptors[index].start+descriptors[index].projection.prefix+offset-logicalStarts[index];
        };
        const reference=references.get(definition.key);
        if(!Object.prototype.hasOwnProperty.call(reference,"destinationStart")) {
          Object.defineProperties(reference,{destinationStart:{value:rawAt(definition.destinationStart)},destinationEnd:{value:rawAt(definition.destinationEnd)}});
        }
        if(label) descriptor.referenceLabel={key:definition.key,start:rawAt(opening+1),end:rawAt(label.end-1)};
        members.forEach(member => { member.projection.referenceDefinition = true; });
        at = last;
      }
      for (let at = 1; at < descriptors.length; at += 1) {
        const delimiter = descriptors[at];
        if (delimiter.unitType !== "line" || delimiter.projection.list || !/^ {0,3}(?:=+|-+)[ \t]*$/.test(delimiter.raw)) continue;
        let first = at - 1;
        const eligible = (line) => line && line.unitType === "line" && !line.projection.referenceDefinition && line.raw.trim()
          && line.projection.tag === "div" && !line.projection.list && !line.projection.listContinuation;
        if (!eligible(descriptors[first])) continue;
        while (eligible(descriptors[first - 1])) first -= 1;
        const tag = delimiter.raw.trim()[0] === "=" ? "h1" : "h2";
        for (let line = first; line < at; line += 1) descriptors[line].projection.tag = tag;
        delimiter.projection = { prefix: delimiter.raw.length, text: "", tag: "div", setextDelimiter: true, setextLevel: tag };
      }
      for (const descriptor of descriptors) {
        const projection = descriptor.projection;
        if (descriptor.unitType !== "line" || !descriptor.ending || projection.fence || projection.rule || projection.referenceDefinition || projection.setextDelimiter || /^h[1-6]$/.test(projection.tag)) continue;
        const run = (descriptor.raw.match(/\\+$/) || [""])[0].length;
        if (run % 2 === 1 && projection.text.slice(0,-1).trim()) {
          projection.suffix = 1;
          projection.text = projection.text.slice(0,-1);
        }
      }
      const eligible=descriptor=>{
        const projection=descriptor.projection;
        if(descriptor.unitType!=="line"||projection.referenceDefinition||projection.rule||projection.setextDelimiter||!projection.text.trim())return false;
        if(/^h[1-6]$/.test(projection.tag))return projection.prefix===0;
        if(projection.tag==="blockquote"){
          const inner=projectionLine(projection.text);
          return inner.tag==="div"&&!inner.list&&!inner.fence&&!inner.rule;
        }
        return projection.tag==="div";
      };
      const scope=descriptor=>descriptor.projection.tag+":"+(descriptor.projection.quoteDepth||0)+":"+(descriptor.listOwner?.index??"root");
      for(let first=0;first<descriptors.length;first++) {
        if(!eligible(descriptors[first]))continue;
        let last=first;while(last+1<descriptors.length&&eligible(descriptors[last+1])&&scope(descriptors[last+1])===scope(descriptors[first]))last++;
        if(last>first) {
          const rows=descriptors.slice(first,last+1),starts=[];let text="";
          for(const row of rows){starts.push(text.length);text+=row.projection.text+(row.projection.suffix?row.raw.slice(-row.projection.suffix):"")+"\n";}
          const tokens=MarkdownCodec.tokenizeInline(text,0,text.length,0,false,false,references);
          const crosses=items=>items.some(token=>(token.type!=="text"&&token.type!=="break"&&starts.some(boundary=>boundary>token.start&&boundary<token.end))||(token.children&&crosses(token.children)));
          if(crosses(tokens)){
            const rawAt=offset=>{
              let low=0,high=rows.length;
              while(low<high){const mid=(low+high)>>>1;if(starts[mid]<=offset)low=mid+1;else high=mid;}
              const row=Math.max(0,low-1);
              return rows[row].start+rows[row].projection.prefix+offset-starts[row];
            };
            const links=items=>items.forEach(token=>{
              if(token.type==="image")Object.defineProperty(token,"sourceSpan",{value:{start:rawAt(token.start),end:rawAt(token.end)}});
              if((token.type==="link"||token.type==="image")&&!token.autolink){
                const destination=token.referenceKey?references.get(token.referenceKey):MarkdownCodec.linkDestinationAt(text,token.contentEnd+1);
                if(destination)Object.defineProperty(token,"sourceLink",{value:{
                  contentStart:rawAt(token.contentStart),contentEnd:rawAt(token.contentEnd),
                  destination:{...destination,destinationStart:token.referenceKey?destination.destinationStart:rawAt(destination.destinationStart),
                    destinationEnd:token.referenceKey?destination.destinationEnd:rawAt(destination.destinationEnd)}}});
              }
              if(token.children)links(token.children);
            });
            links(tokens);
            rows.forEach((row,index)=>{
            const trailing = starts[index]+row.projection.text.length;
            const inCode=items=>items.some(token=>(token.type==="code"&&token.contentStart<=trailing&&token.contentEnd>trailing)||(token.children&&inCode(token.children)));
            if(row.projection.suffix&&inCode(tokens)){
              row.projection.text+=row.raw.slice(-row.projection.suffix);
              row.projection.suffix=0;
            }
            row.projection.inlineTokens=inlineRowTokens(tokens,text,starts[index],starts[index]+row.projection.text.length);
            row.projection.inlineSignature=JSON.stringify(row.projection.inlineTokens);
            });
          }
        }
        first=last;
      }
      return descriptors;
    }

    editingContextAt(offset) {
      const descriptors = this.lineDescriptors;
      let low = 0;
      let high = descriptors.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (descriptors[mid].start <= offset) low = mid + 1;
        else high = mid;
      }
      const descriptor = descriptors[Math.max(0, low - 1)];
      if (descriptor && (descriptor.projection.rule || descriptor.projection.setextDelimiter)) return { kind: "separator", start: descriptor.start, end: descriptor.end };
      if (descriptor && descriptor.unitType === "table") return { kind: "table", start: descriptor.start, end: descriptor.end };
      if (descriptor && (descriptor.unitType === "code" || descriptor.unitType === "literal" || descriptor.projection.referenceDefinition)) {
        return { kind: "code", start: descriptor.start, end: descriptor.end,
          contentStart: descriptor.start, fence: descriptor.projection.fence,
          containerPrefix: descriptor.containerPrefix || "",
          indent: (descriptor.containerPrefix || "")
            + (descriptor.raw.slice((descriptor.containerPrefix || "").length).match(/^[ \t]*/) || [""])[0] };
      }
      if (descriptor) {
        const base=descriptor.start+descriptor.projection.prefix;
        const containsCode=(tokens)=>tokens.some(token=>token.type==="code"
          ? offset>=base+token.contentStart && offset<=base+token.contentEnd
          : token.children && containsCode(token.children));
        if(containsCode(descriptor.projection.inlineTokens||MarkdownCodec.tokenizeInline(descriptor.projection.text, 0, descriptor.projection.text.length, 0, false, false, this.lineDescriptors.references))) {
          const projection=descriptor.projection;
          const leading=(descriptor.raw.slice((projection.quoteContainerPrefix||"").length).match(/^[ \t]*/)||[""])[0];
          const indent=projection.tag==="blockquote" ? descriptor.raw.slice(0,projection.prefix)+(projection.text.match(/^[ \t]*/)||[""])[0]
            : projection.list ? (projection.quoteContainerPrefix||"")+leading+" ".repeat(Math.max(0,projection.contentIndent-indentationColumns(leading)))
            : projection.listContinuation ? descriptor.raw.slice(0,projection.prefix) : leading;
          return {kind:"code",start:descriptor.start,end:descriptor.end,contentStart:offset,fence:false,
            indent};
        }
      }
      if(descriptor?.projection.quoteList&&descriptor.projection.list){
        const outer=descriptor.projection.quoteContainerPrefix;
        const context=listContextAt(descriptor.raw.slice(outer.length),0);
        if(context)return {...context,start:descriptor.start,end:descriptor.end,
          indent:outer+context.indent,markerStart:descriptor.start+outer.length+context.markerStart,
          contentStart:descriptor.start+outer.length+context.contentStart};
      }
      if (descriptor?.projection.tag === "blockquote") {
        const indent=(descriptor.raw.match(/^[ \t]*/)||[""])[0];
        return {kind:"quote",start:descriptor.start,end:descriptor.end,indent,
          marker:descriptor.raw.slice(indent.length,descriptor.projection.prefix),spacing:"",
          markerStart:descriptor.start+indent.length,contentStart:descriptor.start+descriptor.projection.prefix};
      }
      if (descriptor && /^h[1-6]$/.test(descriptor.projection.tag)
          && !/^ {0,3}#{1,6}[ \t]+/.test(descriptor.raw)) {
        return { kind: "heading", start: descriptor.start, end: descriptor.end,
          contentStart: descriptor.start, markerStart: descriptor.start, indent: "", marker: "", spacing: "" };
      }
      if (descriptor && descriptor.projection.listContinuation) {
        return { kind: "continuation", start: descriptor.start, end: descriptor.end,
          markerStart: descriptor.start, contentStart: descriptor.start + descriptor.projection.prefix,
          indent: descriptor.raw.slice(0, descriptor.projection.prefix), marker: "", spacing: "" };
      }
      return structuralContextAt(this.model.source, offset);
    }

    render(rawSelection) {
      this.isRendering = true;
      this.source.value = this.model.display;
      this.lineDescriptors = this.buildProjection();
      this.rowNodes = new Array(this.lineDescriptors.length);
      const fragment = document.createDocumentFragment();
      const tableBlocks = [];
      let index = 0;
      while (index < this.lineDescriptors.length) {
        const descriptor = this.lineDescriptors[index];
        if (descriptor.unitType === "table") {
          const block = this.renderTableBlock(descriptor.unitStart, descriptor.unitEnd);
          tableBlocks.push(block);
          fragment.append(block);
          index = descriptor.unitEnd + 1;
        } else if (descriptor.unitType === "code") {
          fragment.append(this.renderCodeBlock(descriptor.unitStart, descriptor.unitEnd));
          index = descriptor.unitEnd + 1;
        } else {
          const row = this.renderSourceLine(descriptor);
          this.rowNodes[index] = row;
          fragment.append(row);
          index += 1;
        }
      }
      this.surface.replaceChildren(fragment);
      this.layoutTableBlocks(tableBlocks);
      this.isRendering = false;
      if (rawSelection) this.setSurfaceSelection(rawSelection.start, rawSelection.end);
    }

    renderSourceLine(descriptor) {
        const { raw, projection } = descriptor;
        const row = document.createElement("span");
        row.className = "amorist-source-line";
        this.updateRowMetadata(row, descriptor);
        if(projection.quoteList){
          row.classList.add("amorist-wysiwyg-quote-list");
          row.style.setProperty("--quote-depth",String(projection.quoteDepth));
          if(projection.containerListPadding)row.style.marginInlineStart=projection.containerListPadding;
        }
        if (projection.list) {
          row.classList.add("amorist-wysiwyg-list-item", `amorist-wysiwyg-${projection.list}`);
          row.dataset.marker = projection.list === "ordered" ? projection.marker : "•";
          row.style.setProperty("--list-content-indent", projection.layoutPadding);
          row.style.setProperty("--list-marker-width", projection.markerWidth);
        } else if (projection.listContinuation) {
          row.classList.add("amorist-wysiwyg-list-continuation");
          row.style.setProperty("--list-content-indent", projection.layoutPadding);
        } else if (/^h[1-6]$/.test(projection.tag)) {
          row.classList.add(`amorist-wysiwyg-${projection.tag}`);
        } else if (projection.tag === "blockquote") {
          row.classList.add("amorist-wysiwyg-quote");
          row.style.setProperty("--quote-depth", String(projection.quoteDepth || 1));
          if(projection.containerListPadding) row.style.marginInlineStart=projection.containerListPadding;
        } else if (projection.fence) {
          row.classList.add("amorist-wysiwyg-fence");
        } else if (projection.rule) {
          row.classList.add("amorist-wysiwyg-rule");
        }
        if (descriptor.unitType === "table") row.classList.add("amorist-wysiwyg-table");
        if (descriptor.projection.literal) {
          this.appendSourceText(row, raw, 0, raw.length);
        } else if (projection.referenceDefinition) {
          this.appendSourceText(row, projection.text, projection.prefix, raw.length);
        } else if (descriptor.codeContent) {
          row.classList.add("amorist-wysiwyg-code");
          this.appendSourceText(row, projection.text || CARET_SENTINEL, projection.prefix, raw.length);
        } else if (descriptor.unitType === "table") {
          this.renderTableRow(row, raw);
        } else if (typeof projection.checked === "boolean") {
          row.classList.add("amorist-wysiwyg-task");
          row.dataset.checked = String(projection.checked);
          row.innerHTML = '<span class="amorist-task-checkbox" contenteditable="false"></span><span class="amorist-task-content"></span>';
          this.renderInlineProjection(row.querySelector(".amorist-task-content"), projection.text, projection.prefix,projection.inlineTokens);
          if (!projection.text) {
            const content = row.querySelector(".amorist-task-content");
            content.classList.add("amorist-empty-caret");
            this.appendSourceText(content, CARET_SENTINEL, projection.prefix, projection.prefix);
          }
        } else if (projection.setextDelimiter) {
          row.classList.add("amorist-wysiwyg-setext-delimiter");
        } else if (projection.rule || projection.fence) {
          row.setAttribute("aria-label", projection.rule ? "Horizontal rule" : "Code fence");
        } else if (projection.text) {
          this.renderInlineProjection(row, projection.text, projection.prefix,projection.inlineTokens);
        } else if (projection.prefix) {
          // An empty rendered construct still needs a real DOM position after
          // its hidden Markdown marker.  Without it WebKit/Chromium place the
          // caret before the pseudo-marker and the next character is inserted
          // before "- ", "# ", "> ", and similar prefixes.
          const caret = document.createElement("span");
          caret.className = "amorist-empty-caret";
          this.appendSourceText(caret, CARET_SENTINEL, projection.prefix, projection.prefix);
          row.append(caret);
          if (!descriptor.ending) row.append(document.createElement("br"));
        } else {
          // A newline alone has no stable caret stop when entering the row
          // from a block below it. Keep empty physical rows navigable both ways.
          const caret = document.createElement("span");
          caret.className = "amorist-empty-caret";
          this.appendSourceText(caret, CARET_SENTINEL, 0, 0);
          row.append(caret);
        }
        // Keep the editable text stream aligned with physical source lines.
        // Block layout alone is invisible to TreeWalker-based selection APIs.
        if (!descriptor.ending && (projection.setextDelimiter || projection.fence || projection.rule)) {
          this.appendSourceText(row, CARET_SENTINEL, raw.length, raw.length);
        }
        if (descriptor.ending) this.appendSourceText(row, "\n", raw.length, raw.length + descriptor.ending.length);
        return row;
    }

    updateRowMetadata(row, descriptor) {
      row.dataset.sourceStart = String(descriptor.start);
      row.dataset.sourceEnd = String(descriptor.end);
      row.dataset.prefix = String(descriptor.projection.prefix);
      row.dataset.line = String(descriptor.index);
      row.dataset.endingLength = String(descriptor.ending.length);
    }

    renderTableBlock(start, end) {
      const block = document.createElement("div");
      block.className = "amorist-wysiwyg-block amorist-wysiwyg-table-block";
      block.dataset.unitStart = String(start);
      block.dataset.unitEnd = String(end);
      for (let index = start; index <= end; index += 1) {
        const row = this.renderSourceLine(this.lineDescriptors[index]);
        if (index === start + 1) row.classList.add("amorist-wysiwyg-table-delimiter");
        this.rowNodes[index] = row;
        block.append(row);
      }
      return block;
    }

    renderCodeBlock(start, end) {
      const block = document.createElement("div");
      block.className = "amorist-wysiwyg-block amorist-wysiwyg-code-block";
      if(this.lineDescriptors[start].listOwner) block.style.marginInlineStart=this.lineDescriptors[start].listOwner.layoutPadding;
      if (this.lineDescriptors[start].containerQuoteDepth) {
        block.classList.add("amorist-wysiwyg-quoted-code");
        block.style.setProperty("--quote-depth", String(this.lineDescriptors[start].containerQuoteDepth));
      }
      if(this.lineDescriptors[start].containerQuoteBeforeList){
        block.classList.add("amorist-wysiwyg-quote-list-code");
        block.style.marginInlineStart="0";
        block.style.setProperty("--list-content-indent",this.lineDescriptors[start].listOwner.layoutPadding);
      }
      const direct=this.lineDescriptors[start].directListOwner;
      if(direct){
        block.classList.add("amorist-wysiwyg-direct-list-code");
        block.dataset.marker=direct.list==="ordered"?direct.marker:"•";
        block.style.marginInlineStart="0";
        block.style.setProperty("--list-content-indent",direct.layoutPadding);
        block.style.setProperty("--list-marker-width",direct.markerWidth);
        if(typeof direct.checked==="boolean"){
          block.classList.add("amorist-wysiwyg-task");block.dataset.checked=String(direct.checked);
          const checkbox=document.createElement('span');checkbox.className='amorist-task-checkbox';checkbox.contentEditable='false';checkbox.dataset.taskLine=String(start);block.append(checkbox);
        }
      }
      block.dataset.unitStart = String(start);
      block.dataset.unitEnd = String(end);
      for (let index = start; index <= end; index += 1) {
        const row = this.renderSourceLine(this.lineDescriptors[index]);
        this.rowNodes[index] = row;
        block.append(row);
      }
      return block;
    }

    refreshLocalImages() {
      for(const atom of this.surface.querySelectorAll('.amorist-image-atom')) {
        const token=atom.imageToken;if(!token) continue;
        try {if(["http:","https:"].includes(new URL(token.href).protocol)) continue;}catch(error) {}
        atom.querySelectorAll('img').forEach(image=>image.remove());
        const fallback=atom.querySelector('.amorist-image-fallback');fallback.hidden=false;
        this.loadImage(atom,fallback,token);
      }
      this.scheduleCurrentLine?.();
    }

    async loadImage(atom,fallback,token) {
      const generation=(atom.imageGeneration||0)+1;atom.imageGeneration=generation;
      let url;
      try {url=new URL(token.href);} catch(error) {url=null;}
      if(!url || !["http:","https:"].includes(url.protocol)) {
        if(typeof this.options.resolveImage!=="function") return;
        atom.dataset.imageState="loading";
        try {
          const resolved=await this.options.resolveImage(token.href);
          if(!atom.isConnected || atom.imageGeneration!==generation) return;
          if(!resolved) {atom.dataset.imageState="failed";return;}
          url=new URL(resolved);
          if(!["amorist-image:","http:","https:"].includes(url.protocol)) throw new Error("Invalid image transport.");
        }catch(error) {if(atom.isConnected && atom.imageGeneration===generation) atom.dataset.imageState="failed";return;}
      }
      const image=document.createElement("img");image.className="amorist-image";image.hidden=true;
      image.alt=token.alt;image.referrerPolicy="no-referrer";image.decoding="async";
      if(token.title!==null && token.title!==undefined) image.title=token.title;
      atom.dataset.imageState="loading";atom.append(image);
      image.addEventListener("error",()=> {if(atom.isConnected && image.isConnected && atom.imageGeneration===generation) atom.dataset.imageState="failed";});
      image.addEventListener("load",()=> {
        if(!atom.isConnected || !image.isConnected || atom.imageGeneration!==generation || !image.naturalWidth) return;
        const selection=window.getSelection();
        let caret=null;
        if(this.mode==="wysiwyg" && document.activeElement===this.surface && selection?.focusNode
            && this.surface.contains(selection.focusNode)
            && selection.focusOffset<=(selection.focusNode.nodeType===Node.TEXT_NODE?selection.focusNode.length:selection.focusNode.childNodes.length)) {
          const range=document.createRange();range.setStart(selection.focusNode,selection.focusOffset);range.collapse(true);
          if(range.getBoundingClientRect().height) caret=range;
        }
        const scroller=scrollViewportFor(this.surface), before=caret?.getBoundingClientRect().top;
        const table=atom.closest(".amorist-wysiwyg-table-block");
        const left=table?.scrollLeft||0,maximum=table?Math.max(0,table.scrollWidth-table.clientWidth):0;
        atom.style.maxWidth="100%";image.style.maxWidth="100%";
        image.hidden=false;fallback.hidden=true;atom.dataset.imageState="loaded";
        if(table) {
          table.querySelectorAll('.amorist-wysiwyg-table-cell').forEach(cell=>{cell.style.paddingInlineEnd="0px";});
          this.layoutTableBlocks([table]);
          const nextMaximum=Math.max(0,table.scrollWidth-table.clientWidth);
          table.scrollLeft=maximum>1 && maximum-left<=1?nextMaximum:Math.min(left,nextMaximum);
        }
        if(caret && Number.isFinite(before)) scroller.scrollTop+=caret.getBoundingClientRect().top-before;
        this.scheduleCurrentLine?.();
      },{once:true});
      image.src=url.href;
    }

    renderInlineProjection(container, text, rawStart, projectedTokens) {
      // Ranges are relative to the physical row. Its sourceStart is refreshed
      // after an earlier edit, so untouched DOM nodes keep valid mappings.
      const append = (parent, tokens) => {
        for (const token of tokens) {
          if(token.type==="image-continuation") {
            const caret=document.createElement("span");caret.className="amorist-empty-caret";
            this.appendSourceText(caret,CARET_SENTINEL,rawStart+token.start,rawStart+token.end);
            parent.append(caret);continue;
          }
          if (token.type === "break") {
            parent.append(document.createElement("br"));
            continue;
          }
          if(token.type==="image") {
            const span=token.originalToken?.sourceSpan;
            const base=span?Number(container.closest('.amorist-source-line').dataset.sourceStart):0;
            const start=span?span.start-base:rawStart+token.start,end=span?span.end-base:rawStart+token.end;
            const boundary=point=> {
              const span=document.createElement("span");span.className="amorist-empty-caret amorist-image-boundary";
              this.appendSourceText(span,CARET_SENTINEL,point,point);return span;
            };
            const atom=document.createElement("span");atom.className="amorist-image-atom";atom.contentEditable="false";
            atom.dataset.rawStart=String(start);atom.dataset.rawEnd=String(end);atom.dataset.imageDestination=token.href;
            this.sourceNodeRanges.set(atom,{start,end});
            atom.imageToken={href:token.href,alt:token.alt,title:token.title};
            const fallback=document.createElement("span");fallback.className="amorist-image-fallback";
            this.appendSourceText(fallback,(token.alt?token.alt+" — ":"")+token.href,start,end);
            atom.append(fallback);parent.append(boundary(start),atom,boundary(end));
            this.loadImage(atom,fallback,token);continue;
          }
          if (token.type === "text" || token.type === "code") {
            const leaf = document.createElement(token.type === "code" ? "code" : "span");
            leaf.classList.add("amorist-inline-text");
            leaf.dataset.inlineStart = String(rawStart + (token.type === "code" ? token.contentStart : token.start));
            leaf.dataset.inlineEnd = String(rawStart + (token.type === "code" ? token.contentEnd : token.end));
            this.sourceNodeRanges.set(leaf, { start: rawStart + token.start, end: rawStart + token.end });
            this.appendSourceText(leaf, token.text, Number(leaf.dataset.inlineStart), Number(leaf.dataset.inlineEnd));
            parent.append(leaf);
            continue;
          }
          const tag = { em: "em", strong: "strong", delete: "del", link: "a", "strong-em": "em" }[token.type];
          const wrapper = document.createElement(tag);
          wrapper.dataset.rawStart = String(rawStart + token.start);
          wrapper.dataset.rawEnd = String(rawStart + token.end);
          this.sourceNodeRanges.set(wrapper, { start: rawStart + token.start, end: rawStart + token.end });
          if (token.type === "link") {
            const href = MarkdownCodec.safeLinkHref(token.href);
            if (href != null) wrapper.setAttribute("href", href);
            wrapper.dataset.linkDestination = token.href;
            wrapper.dataset.linkContentStart = String(rawStart+token.contentStart);
            if (token.title != null) wrapper.setAttribute("title", token.title);
            wrapper.setAttribute("target", "_blank");
            wrapper.setAttribute("rel", "noopener noreferrer");
          }
          if (token.type === "strong-em") {
            const strong = document.createElement("strong");
            append(strong, token.children); wrapper.append(strong);
          } else append(wrapper, token.children);
          if (token.type === "link" && !token.children.length) {
            const caret = document.createElement("span");
            caret.className = "amorist-empty-caret";
            const point = rawStart + token.contentStart;
            this.sourceNodeRanges.set(caret, {start: point, end: point});
            this.appendSourceText(caret, CARET_SENTINEL, point, point);
            wrapper.append(caret);
          }
          parent.append(wrapper);
        }
      };
      append(container, projectedTokens||MarkdownCodec.tokenizeInline(text, 0, text.length, 0, false, false, this.lineDescriptors.references));
    }

    renderTableRow(row, raw) {
      // Keep every source character in the editable text stream.  The visual
      // columns below are CSS layout only: unlike the former table formatter,
      // they never manufacture padding in the Markdown model.
      let cellStart = 0;
      const appendCell = (text, start) => {
        const cell = document.createElement("span");
        cell.className = "amorist-wysiwyg-table-cell";
        if (text) this.renderInlineProjection(cell, text, start);
        row.append(cell);
      };
      for (const index of TableCodec.tableDelimiters(raw)) {
        appendCell(raw.slice(cellStart, index), cellStart);
        const marker = document.createElement("span");
        marker.className = "amorist-wysiwyg-table-marker";
        this.sourceNodeRanges.set(marker, { start: index, end: index + 1 });
        this.appendSourceText(marker, "|", index, index + 1);
        row.append(marker);
        cellStart = index + 1;
      }
      appendCell(raw.slice(cellStart), cellStart);
    }

    layoutTableBlocks(blocks) {
      const measurements = blocks.map((block) => {
        const rows = Array.from(block.querySelectorAll(".amorist-wysiwyg-table"));
        const widths = [];
        const rowWidths = rows.map((row) => Array.from(row.querySelectorAll(".amorist-wysiwyg-table-cell")).map((cell, index) => {
          const width = cell.getBoundingClientRect().width;
          widths[index] = Math.max(widths[index] || 0, width);
          return width;
        }));
        return { rows, widths, rowWidths };
      });
      measurements.forEach(({ rows, widths, rowWidths }) => {
        rows.forEach((row, rowIndex) => {
          row.querySelectorAll(".amorist-wysiwyg-table-cell").forEach((cell, index) => {
            cell.style.paddingInlineEnd = `${Math.max(0, widths[index] - rowWidths[rowIndex][index])}px`;
          });
        });
      });
    }

    descriptorAtRaw(rawOffset, descriptors) {
      const lines = descriptors || this.lineDescriptors || [];
      if (!lines.length) return null;
      const offset = Math.max(0, Math.min(Number(rawOffset) || 0, this.model.source.length));
      let low = 0;
      let high = lines.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (lines[middle].start <= offset) low = middle;
        else high = middle - 1;
      }
      return lines[low];
    }

    patchProjection(beforeSource, beforeDescriptors, transaction, selection) {
      if (this.mode !== "wysiwyg") return;
      const nextDescriptors = this.buildProjection();
      const before = this.descriptorAtRaw(transaction.start, beforeDescriptors);
      const after = before && nextDescriptors[before.index];
      const removed = beforeSource.slice(transaction.start, transaction.end);
      const stableLine = before && after
        && beforeDescriptors.length === nextDescriptors.length
        && transaction.end <= before.end
        && !/[\r\n]/.test(removed)
        && !/[\r\n]/.test(transaction.replacement)
        && before.unitType === after.unitType
        && before.unitStart === after.unitStart
        && before.unitEnd === after.unitEnd;

      if (!stableLine) {
        this.render(selection);
        return;
      }

      this.lineDescriptors = nextDescriptors;
      this.rowNodes.forEach((row, index) => {
        if (row && nextDescriptors[index]) this.updateRowMetadata(row, nextDescriptors[index]);
      });

      let tableScroll = null;
      if (after.unitType === "table") {
        const oldBlock = this.rowNodes[after.index].closest(".amorist-wysiwyg-table-block");
        const oldMaximum = Math.max(0, oldBlock.scrollWidth - oldBlock.clientWidth);
        tableScroll = {
          left: oldBlock.scrollLeft,
          pinnedToEnd: oldMaximum - oldBlock.scrollLeft <= 1,
        };
        const block = this.renderTableBlock(after.unitStart, after.unitEnd);
        oldBlock.replaceWith(block);
        this.layoutTableBlocks([block]);
        tableScroll.block = block;
      } else if(after.unitType==="code"&&before.projection.directListSignature!==after.projection.directListSignature){
        const oldBlock=this.rowNodes[after.index].closest('.amorist-wysiwyg-code-block');
        const left=oldBlock.scrollLeft,block=this.renderCodeBlock(after.unitStart,after.unitEnd);
        oldBlock.replaceWith(block);block.scrollLeft=left;
      } else {
        const oldRow = this.rowNodes[after.index];
        const row = this.renderSourceLine(after);
        this.rowNodes[after.index] = row;
        oldRow.replaceWith(row);
      }
      if (!sameLineLayout(before.projection, after.projection)) {
        nextDescriptors.forEach((descriptor, index) => {
          if (index === after.index || descriptor.unitType !== "line"
              || !beforeDescriptors[index] || sameLineLayout(beforeDescriptors[index].projection, descriptor.projection)) return;
          const oldRow = this.rowNodes[index];
          if (!oldRow) return;
          const row = this.renderSourceLine(descriptor);
          oldRow.replaceWith(row);
          this.rowNodes[index] = row;
        });
      }
      const referenceSignature = (descriptor, references) => {
        if (!descriptor || descriptor.unitType === "code" || descriptor.unitType === "literal"
            || descriptor.projection.referenceDefinition) return "";
        const links = [];
        const visit = tokens => tokens.forEach(token => {
          if (token.referenceKey) links.push([token.start, token.end, token.referenceKey, token.href, token.title]);
          if (token.children) visit(token.children);
        });
        const text = descriptor.projection.text;
        visit(MarkdownCodec.tokenizeInline(text, 0, text.length, 0, false, false, references));
        return JSON.stringify(links);
      };
      const refreshedTables = new Set(after.unitType === "table" ? [after.unitStart] : []);
      const referencesChanged = JSON.stringify(Array.from(beforeDescriptors.references || []))
        !== JSON.stringify(Array.from(nextDescriptors.references || []));
      if (referencesChanged) nextDescriptors.forEach((descriptor, index) => {
        if (index === after.index || referenceSignature(beforeDescriptors[index], beforeDescriptors.references)
            === referenceSignature(descriptor, nextDescriptors.references)) return;
        if (descriptor.unitType === "table") {
          if (refreshedTables.has(descriptor.unitStart)) return;
          refreshedTables.add(descriptor.unitStart);
          const oldBlock = this.rowNodes[index].closest(".amorist-wysiwyg-table-block");
          const left = oldBlock.scrollLeft;
          const pinned = oldBlock.scrollWidth - oldBlock.clientWidth - left <= 1;
          const block = this.renderTableBlock(descriptor.unitStart, descriptor.unitEnd);
          oldBlock.replaceWith(block);
          this.layoutTableBlocks([block]);
          const maximum = Math.max(0, block.scrollWidth - block.clientWidth);
          block.scrollLeft = pinned ? maximum : Math.min(left, maximum);
        } else {
          const oldRow = this.rowNodes[index];
          const row = this.renderSourceLine(descriptor);
          oldRow.replaceWith(row);
          this.rowNodes[index] = row;
        }
      });
      this.setSurfaceSelection(selection.start, selection.end);
      if (tableScroll) {
        const maximum = Math.max(0, tableScroll.block.scrollWidth - tableScroll.block.clientWidth);
        tableScroll.block.scrollLeft = tableScroll.pinnedToEnd
          ? maximum
          : Math.min(tableScroll.left, maximum);
      }
    }

    selectionRaw() {
      if (this.mode === "source") return { start: this.model.rawOffset(this.source.selectionStart), end: this.model.rawOffset(this.source.selectionEnd) };
      if(this.toolbar.contains(document.activeElement)&&this.toolbarSelection?.revision===this.model.revision) {
        return {start:this.toolbarSelection.start,end:this.toolbarSelection.end};
      }
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return { start: 0, end: 0 };
      const range = selection.getRangeAt(0);
      if (!this.surface.contains(range.startContainer) || !this.surface.contains(range.endContainer)) {
        return { start: 0, end: 0 };
      }
      return { start: this.rawPoint(range.startContainer, range.startOffset), end: this.rawPoint(range.endContainer, range.endOffset) };
    }

    appendSourceText(parent, text, start, end) {
      const node = document.createTextNode(text);
      this.sourceNodeRanges.set(node, { start, end });
      parent.append(node);
      return node;
    }

    nodeSourceRange(node) {
      const direct = this.sourceNodeRanges.get(node);
      if (direct) return direct;
      let first = null, last = null;
      for (const child of node.childNodes) {
        const range = this.nodeSourceRange(child);
        if (range) { if (!first) first = range; last = range; }
      }
      return first ? { start: first.start, end: last.end } : null;
    }

    rawPoint(node, offset) {
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      const row = element.closest(".amorist-source-line");
      if (!row) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const right = node.childNodes[offset];
          const next = right && (right.matches?.(".amorist-source-line") ? right : right.querySelector?.(".amorist-source-line"));
          if (next) return Number(next.dataset.sourceStart);
        }
        return this.model.source.length;
      }
      const descriptor = this.lineDescriptors[Number(row.dataset.line)];
      const base = descriptor.start;
      const image=element.closest(".amorist-image-atom");
      if(image) {
        const range=this.sourceNodeRanges.get(image);
        const length=node.nodeType===Node.TEXT_NODE?node.length:node.childNodes.length;
        return base+(offset<=length/2?range.start:range.end);
      }
      if (node.nodeType === Node.TEXT_NODE) {
        const range = this.sourceNodeRanges.get(node);
        if (!range) throw new Error("Editable text has no source range");
        // A display newline represents the entire original CR/LF/CRLF boundary;
        // an empty-line sentinel represents a zero-width source boundary.
        const position = offset === node.length ? range.end : range.start + Math.min(offset, range.end - range.start);
        return base + position;
      }
      for (let index = offset; index < node.childNodes.length; index += 1) {
        const range = this.nodeSourceRange(node.childNodes[index]);
        if (range) return base + range.start;
      }
      for (let index = offset - 1; index >= 0; index -= 1) {
        const range = this.nodeSourceRange(node.childNodes[index]);
        if (range) return base + range.end;
      }
      return base + descriptor.projection.prefix;
    }

    setSurfaceSelection(start, end) {
      this.toolbarSelection={start,end,direction:"forward",revision:this.model.revision};
      this.surface.focus();
      if (start === 0 && end === this.model.source.length && end > 0) {
        this.selectSurfaceContents();
        return;
      }
      const point = (rawOffset) => {
        const descriptor = this.descriptorAtRaw(rawOffset);
        const row = descriptor ? this.rowNodes[descriptor.index] : null;
        if (!row) return { node: this.surface, offset: 0 };
        const relative = rawOffset - descriptor.start;
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        const candidates = [];
        let node;
        while ((node = walker.nextNode())) {
          if(node.parentElement.closest(".amorist-image-atom")) continue;
          const range = this.sourceNodeRanges.get(node);
          if (!range) throw new Error("Editable text has no source range");
          if (relative >= range.start && relative <= range.end) {
            const offset = relative === range.end ? node.length : Math.min(node.length, relative - range.start);
            return { node, offset };
          }
          candidates.push({ position: range.start, node, offset: 0 }, { position: range.end, node, offset: node.length });
        }
        const elements = row.querySelectorAll("*");
        for (const element of elements) {
          const range = this.sourceNodeRanges.get(element);
          if (!range || element.nodeType !== Node.ELEMENT_NODE) continue;
          const index = Array.prototype.indexOf.call(element.parentNode.childNodes, element);
          for (const [position, offset] of [[range.start, index], [range.end, index + 1]]) {
            const candidate = { position, node: element.parentNode, offset };
            if (relative === position) return candidate;
            candidates.push(candidate);
          }
        }
        // Hidden syntax cannot contain a visual caret. Snap to the closest
        // declared source boundary rather than guessing from rendered text.
        if (candidates.length) {
          return candidates.reduce((closest, candidate) =>
            Math.abs(candidate.position - relative) < Math.abs(closest.position - relative) ? candidate : closest);
        }
        return { node: row, offset: 0 };
      };
      const from = point(start); const to = point(end);
      const range = document.createRange();
      range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }

    selectSurfaceContents() {
      this.surface.focus();
      const range = document.createRange();
      range.selectNodeContents(this.surface);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }

    planEdit(gesture, selection) {
      let {start,end}=selection;
      let {replacement,boundaryState}=gesture;
      const beforeSource=this.model.source;
      let afterSelection=gesture.selectionAfter || {start:start+replacement.length,end:start+replacement.length};
      if(this.mode==="wysiwyg" && (this.model.automaticBreaks.length || boundaryState?.automaticBreaks.length)) {
        const nextSource=beforeSource.slice(0,start)+replacement+beforeSource.slice(end);
        const descriptors=this.buildProjection(nextSource);
        const state=boundaryState || this.model.boundaryStateAfterEdit(start,end,replacement);
        const changedEnd=start+replacement.length;
        const removed=state.automaticBreaks.filter(record=>{
          const next=record.marker+1+(nextSource.slice(record.marker+1,record.marker+3)==="\r\n"?2:1);
          const row=this.descriptorAtRaw(next,descriptors),projection=row?.projection;
          if(!row || row.start!==next || row.start>changedEnd || row.end<start) return false;
          return !row.raw.trim() || row.unitType!=="line" || projection.list || projection.tag!=="div" || projection.rule || projection.setextDelimiter;
        }).map(record=>record.marker).sort((a,b)=>a-b);
        if(removed.length) {
          const map=position=>position-removed.filter(marker=>marker<position).length;
          start=Math.min(start,removed[0]);
          replacement=nextSource.slice(start,changedEnd);
          for(const marker of removed.slice().reverse())replacement=replacement.slice(0,marker-start)+replacement.slice(marker-start+1);
          boundaryState={...state,automaticBreaks:state.automaticBreaks.filter(record=>!removed.includes(record.marker))
            .map(record=>({marker:map(record.marker),escapes:record.escapes.map(map)}))};
          afterSelection={...afterSelection,start:map(afterSelection.start),end:map(afterSelection.end)};
        }
      }
      const first=this.descriptorAtRaw(start),last=this.descriptorAtRaw(Math.max(start,end-1));
      return {start,end,replacement,boundaryState,selection:afterSelection,
        structure:{start:this.lineDescriptors[first.unitStart??first.index].start,end:this.lineDescriptors[last.unitEnd??last.index].end}};
    }

    apply(start, end, replacement, gesture, boundaryState, selectionAfter) {
      const beforeSource = this.model.source;
      const beforeDescriptors = this.lineDescriptors;
      const plan=this.planEdit({kind:gesture,replacement,boundaryState,selectionAfter},{start,end});
      const entry = this.model.transaction(plan.start, plan.end, plan.replacement, gesture, plan.boundaryState);
      if(selectionAfter)entry.selectionAfter=plan.selection;
      this.history.push(entry);
      this.patchProjection(beforeSource, beforeDescriptors, entry.forward, plan.selection);
      this.emitChange();
      return entry;
    }

    imageAtBoundary(offset,backward) {
      if(this.mode!=="wysiwyg") return null;
      const descriptor=this.descriptorAtRaw(offset);if(!descriptor) return null;
      let found=null;
      const projected=tokens=>tokens.forEach(token=>{
        const span=token.originalToken?.sourceSpan;
        if(span && offset===(backward?span.end:span.start))found={...span};
        if(token.children)projected(token.children);
      });
      projected(descriptor.projection.inlineTokens||[]);
      for(const {text,base} of this.clipboardInlineChunks(descriptor)) {
        const visit=tokens=>tokens.forEach(token=> {
          if(token.type==="image" && offset===base+(backward?token.end:token.start)) found={start:base+token.start,end:base+token.end};
          if(token.children) visit(token.children);
        });
        visit(MarkdownCodec.tokenizeInline(text,0,text.length,0,false,false,this.lineDescriptors.references));
      }
      return found;
    }

    handleBeforeInput(event) {
      if (this.isRendering || this.mode !== "wysiwyg") return;
      const selection = this.selectionRaw();
      const type = event.inputType;
      if(selection.start===selection.end && ["deleteContentBackward","deleteContentForward"].includes(type)) {
        const image=this.imageAtBoundary(selection.start,type==="deleteContentBackward");
        if(image) {event.preventDefault();this.apply(image.start,image.end,"","delete-image");return;}
      }
      if (type === "insertText" || type === "insertCompositionText") {
        event.preventDefault();
        const text = event.data || "";
        if (this.inlineMode && selection.start === selection.end) {
          const [open, close] = this.inlineMode.marks;
          if (this.model.source.slice(selection.start, selection.start + close.length) === close) {
            this.apply(selection.start, selection.end, text, "insert");
          } else {
            this.apply(selection.start, selection.end, open + text + close, `insert-${this.inlineMode.action}`);
            const caret = selection.start + open.length + text.length;
            this.setSurfaceSelection(caret, caret);
          }
        } else this.apply(selection.start, selection.end, text, "insert");
        return;
      }
      if (type === "insertParagraph" || type === "insertLineBreak") {
        const context = this.editingContextAt(selection.start);
        if (context && context.kind === "code") {
          event.preventDefault();
          this.apply(selection.start, selection.end,
            this.model.lineEndingAt(selection.start) + (context.fence ? context.containerPrefix || "" : context.indent), "code-enter");
          return;
        }
        if (context && (context.kind === "table" || context.kind === "separator")) {
          event.preventDefault(); this.apply(selection.start,selection.end,this.model.lineEndingAt(selection.start),`${context.kind}-enter`); return;
        }
        if (context && selection.start >= context.contentStart && selection.start <= context.end) {
          event.preventDefault();
          if (context.contentStart === context.end) {
            this.apply(context.markerStart, context.contentStart, "", context.kind === "list" ? "list-exit" : "block-exit");
          } else if (context.kind === "heading") {
            this.apply(selection.start, selection.end, this.model.lineEndingAt(selection.start), "block-enter");
          } else {
            this.apply(selection.start, selection.end, this.model.lineEndingAt(selection.start) + continuedStructuralPrefix(context), context.kind === "list" ? "list-enter" : "block-enter");
          }
          return;
        }
        event.preventDefault(); this.proseEnter(selection); return;
      }
      if (type === "deleteContentBackward") {
        const context = selection.start === selection.end
          ? this.editingContextAt(selection.start)
          : null;
        if (context && context.kind !== "code" && context.markerStart < context.contentStart && selection.start === context.contentStart) {
          event.preventDefault();
          this.apply(context.markerStart, context.contentStart, "", context.kind === "list" ? "list-backspace" : "block-backspace");
          return;
        }
        if (selection.start === selection.end && selection.start === lineStart(this.model.source,selection.start)) {
          const record = this.model.automaticBreaks.find(record => record.marker + 1 + (this.model.source.slice(record.marker+1,record.marker+3)==="\r\n"?2:1) === selection.start);
          if (record && (!context || context.kind !== "code")) {
            event.preventDefault(); this.joinAutomaticBoundary(record,selection.start); return;
          }
        }
        event.preventDefault(); const start = selection.start === selection.end ? previousCodeUnit(this.model.source, selection.start) : selection.start;
        this.apply(start, selection.end, "", "backspace"); return;
      }
      if (type === "deleteContentForward") {
        if(selection.start===selection.end) {
          const context=this.editingContextAt(selection.start);
          const record=this.model.automaticBreaks.find(record=>selection.start===record.marker || selection.start===record.marker+1);
          if(record && (!context || context.kind!=="code")) {
            const end=record.marker+1+(this.model.source.slice(record.marker+1,record.marker+3)==="\r\n"?2:1);
            event.preventDefault();this.joinAutomaticBoundary(record,end);return;
          }
        }
        event.preventDefault(); const end = selection.start === selection.end ? nextCodeUnit(this.model.source, selection.end) : selection.end;
        this.apply(selection.start, end, "", "delete");
      }
    }

    proseEnter(selection) {
      const source=this.model.source, descriptor=this.descriptorAtRaw(selection.start);
      let at=selection.start;
      if (selection.start===selection.end && descriptor.projection.suffix && at>=descriptor.end-descriptor.projection.suffix) at=descriptor.end;
      const end=selection.start===selection.end?at:Math.max(at,selection.end);
      const ending=this.model.lineEndingAt(at), start=lineStart(source,at), prefix=source.slice(start,at);
      if (!prefix.trim()) {
        const previous=this.model.automaticBreaks.find(record=>record.marker+1+(source.slice(record.marker+1,record.marker+3)==="\r\n"?2:1)===start);
        if (previous) {
          this.apply(previous.marker,end,source.slice(previous.marker+1,at)+ending,"paragraph-enter"); return;
        }
        this.apply(at,end,ending,"enter");return;
      }
      if (/[\r\n]/.test(source[at]||"")) {
        const owned=this.model.automaticBreaks.find(record=>record.marker===at-1);
        this.apply(owned?owned.marker:at,end,ending,"paragraph-enter");return;
      }
      if (/ {2,}$/.test(prefix)) { this.apply(at,end,ending,"enter");return; }
      const run=(prefix.match(/\\+$/)||[""])[0].length;
      const added=run%2===1?"\\\\":"\\", replacement=added+ending;
      const state=this.model.boundaryStateAfterEdit(at,end,replacement);
      state.automaticBreaks.push({marker:at+added.length-1,escapes:added.length===2?[at]:[]});
      this.apply(at,end,replacement,"prose-enter",state);
    }

    joinAutomaticBoundary(record,end) {
      const source=this.model.source, next=source[end]||"";
      const removeEscapes=!next || !/[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~\r\n]/.test(next);
      const positions=new Set([record.marker,...(removeEscapes?record.escapes:[])]);
      const start=Math.min(...positions);
      let replacement="";
      for(let at=start;at<record.marker;at+=1) if(!positions.has(at)) replacement+=source[at];
      this.apply(start,end,replacement,"join-automatic-boundary");
    }

    handleKeyDown(event) {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.shiftKey && this.mode === "wysiwyg" && event.key.toLowerCase() === "a") {
        event.preventDefault(); this.selectSurfaceContents(); return;
      }
      if(mod && event.shiftKey && event.key.toLowerCase()==="v") {
        this.plainPasteRequested=true;
        setTimeout(()=>{this.plainPasteRequested=false;},1000);
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); this.undo(); return; }
      if (mod && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) { event.preventDefault(); this.redo(); return; }
      if (mod && event.key.toLowerCase() === "f") { event.preventDefault(); this.openFindBar(); return; }
      // Safari can report a control character in key for Shift+Arrow while
      // retaining the physical arrow code. The atomic-image gesture is the same.
      const horizontalKey=["ArrowLeft","ArrowRight"].includes(event.code)?event.code:event.key;
      if(this.mode==="wysiwyg" && !mod && !event.altKey && ["ArrowLeft","ArrowRight"].includes(horizontalKey)) {
        const selection=this.selectionRaw(),direction=this.selectionDirection();
        if(selection.start===selection.end || event.shiftKey) {
          const active=direction==="backward"?selection.start:selection.end;
          const anchor=direction==="backward"?selection.end:selection.start;
          const image=this.imageAtBoundary(active,horizontalKey==="ArrowLeft");
          if(image) {
            event.preventDefault();const target=horizontalKey==="ArrowLeft"?image.start:image.end;
            if(event.shiftKey) this.restoreRawSelection({start:Math.min(anchor,target),end:Math.max(anchor,target),direction:target<anchor?"backward":"forward"});
            else this.setSurfaceSelection(target,target);
            this.scheduleCurrentLine?.();return;
          }
        }
      }
      if(this.mode==="wysiwyg" && !mod && !event.altKey && ["Backspace","Delete"].includes(event.key)) {
        const selection=this.selectionRaw(),image=selection.start===selection.end?this.imageAtBoundary(selection.start,event.key==="Backspace"):null;
        if(image) {event.preventDefault();this.apply(image.start,image.end,"","delete-image");return;}
      }
      if (this.mode === "wysiwyg" && event.key === "Backspace") {
        const selection = this.selectionRaw();
        const context = selection.start === selection.end
          ? this.editingContextAt(selection.start)
          : null;
        // WebKitGTK does not consistently follow this boundary keydown with a
        // deleteContentBackward beforeinput. Own the structural shortcut here;
        // ordinary Backspace is still handled by beforeinput on every engine.
        if (context && context.kind !== "code" && context.markerStart < context.contentStart && selection.start === context.contentStart) {
          event.preventDefault();
          this.apply(context.markerStart, context.contentStart, "", context.kind === "list" ? "list-backspace" : "block-backspace");
          return;
        }
      }
      if (event.key === "Tab" || event.code === "Tab") {
        event.preventDefault(); this.indentSelection(event.shiftKey); return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (!this.findBar.hidden) this.closeFindBar();
        else this.toolbar.querySelector("button")?.focus();
      }
    }

    selectionDirection() {
      if (this.mode === "source") return this.source.selectionDirection;
      if(this.toolbar.contains(document.activeElement)&&this.toolbarSelection?.revision===this.model.revision) return this.toolbarSelection.direction;
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || selection.isCollapsed) return "forward";
      const range = selection.getRangeAt(0);
      return selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset ? "backward" : "forward";
    }

    restoreRawSelection(selection) {
      if (this.mode === "source") {
        this.source.value = this.model.display;
        this.source.focus();
        this.source.setSelectionRange(this.model.displayOffset(selection.start), this.model.displayOffset(selection.end), selection.direction);
      } else {
        this.setSurfaceSelection(selection.start, selection.end);
        if (selection.direction === "backward") {
          const current = window.getSelection();
          const range = current.getRangeAt(0);
          const startNode = range.startContainer, startOffset = range.startOffset;
          const endNode = range.endContainer, endOffset = range.endOffset;
          current.collapse(endNode, endOffset);
          current.extend(startNode, startOffset);
          this.toolbarSelection={...selection,revision:this.model.revision};
        }
      }
    }

    indentSelection(outdent) {
      const beforeSelection = { ...this.selectionRaw(), direction: this.selectionDirection() };
      const source = this.model.source;
      const descriptors = this.mode === "source" ? this.buildProjection() : this.lineDescriptors;
      const first = this.descriptorAtRaw(beforeSelection.start, descriptors);
      const last = this.descriptorAtRaw(beforeSelection.end > beforeSelection.start ? beforeSelection.end - 1 : beforeSelection.end, descriptors);
      const ownerAt = (row) => row.unitType === "line" ? (row.projection.list ? row.index : row.listOwner?.index) : undefined;
      const firstOwner = ownerAt(first);
      if (!outdent && beforeSelection.start === beforeSelection.end && firstOwner === undefined) {
        const entry = this.apply(beforeSelection.start, beforeSelection.end, "  ", "indent");
        entry.selectionBefore = beforeSelection;
        entry.selectionAfter = { start: beforeSelection.start + 2, end: beforeSelection.end + 2, direction: beforeSelection.direction };
        this.restoreRawSelection(entry.selectionAfter); return;
      }
      let firstIndex = first.index, lastIndex = last.index;
      const quoteDepths=new Map();
      const subtreeRows=new Set();
      for (let index = first.index; index <= last.index; index += 1) {
        const ownerIndex = ownerAt(descriptors[index]);
        if (ownerIndex === undefined) continue;
        firstIndex = Math.min(firstIndex, ownerIndex);
        const owner = descriptors[ownerIndex];
        const depth=owner.projection.quoteList?owner.projection.quoteDepth:0;
        let end = ownerIndex;
        for (let next = ownerIndex + 1; next < descriptors.length; next += 1) {
          const row = descriptors[next];
          if (!row.raw.trim()) continue;
          const prefix=depth?quotePrefix(row.raw,depth):"";
          if(prefix===null)break;
          const inner=row.raw.slice(prefix.length);
          if(!inner.trim())continue;
          const columns = indentationColumns((inner.match(/^[ \t]*/) || [""])[0]);
          if (columns < owner.projection.contentIndent) break;
          end = next;
        }
        lastIndex = Math.max(lastIndex, end);
        for(let row=ownerIndex;row<=end;row++)subtreeRows.add(row);
        if(depth)for(let row=ownerIndex;row<=end;row++)quoteDepths.set(row,Math.min(quoteDepths.get(row)??Infinity,depth));
      }
      const edits = [];
      for (let index = firstIndex; index <= lastIndex; index += 1) {
        const row = descriptors[index];
        const depth=quoteDepths.get(index);
        const outer=depth?quotePrefix(row.raw,depth)
          :row.unitType==="code"&&!subtreeRows.has(index)?row.containerPrefix||""
          :row.projection.quoteContainerPrefix||"";
        const prefix=outer?.length||0;
        const removed = outdent ? (row.raw.slice(prefix).match(/^(?:\t| {1,2})/) || [""])[0].length : 0;
        const inserted = outdent ? "" : "  ";
        if (removed || inserted) edits.push({ start: row.start+prefix, removed, inserted });
      }
      if (!edits.length) return;
      const start = descriptors[firstIndex].start, end = descriptors[lastIndex].end;
      let replacement = source.slice(start, end);
      for (const edit of edits.slice().reverse()) {
        const at = edit.start - start;
        replacement = replacement.slice(0, at) + edit.inserted + replacement.slice(at + edit.removed);
      }
      const map = (position) => {
        let shift = 0;
        for (const edit of edits) {
          if (position < edit.start) break;
          if (position <= edit.start + edit.removed) return edit.start + shift + edit.inserted.length;
          shift += edit.inserted.length - edit.removed;
        }
        return position + shift;
      };
      const afterSelection = { start: map(beforeSelection.start), end: map(beforeSelection.end), direction: beforeSelection.direction };
      const boundaries=this.model.boundaryState();
      boundaries.automaticBreaks=boundaries.automaticBreaks.map(record=>({marker:map(record.marker),escapes:record.escapes.map(map)}));
      const entry = this.apply(start, end, replacement, outdent ? "outdent" : "indent", boundaries, afterSelection);
      entry.selectionBefore = beforeSelection;
      this.restoreRawSelection(entry.selectionAfter);
    }

    handleSourceInput() {
      // textarea has already converted CRLF to LF.  Map just the display range
      // it changed back to raw rather than accepting its value as authority.
      const old = this.model.display; const next = this.source.value;
      const intent=this.sourceBeforeInput;this.sourceBeforeInput=null;
      if(old===next) {
        if(intent && intent.revision===this.model.revision && intent.end>intent.start && String(intent.inputType||"").startsWith("insert")) {
          this.apply(intent.start,intent.end,this.model.source.slice(intent.start,intent.end),"source-replacement");
        }
        return;
      }
      let start = 0; while (start < old.length && old[start] === next[start]) start += 1;
      let oldEnd = old.length; let nextEnd = next.length;
      while (oldEnd > start && nextEnd > start && old[oldEnd - 1] === next[nextEnd - 1]) { oldEnd--; nextEnd--; }
      const rawStart = this.model.rawOffset(start); const rawEnd = this.model.rawOffset(oldEnd);
      const replacement = next.slice(start, nextEnd).replace(/\n/g, this.model.lineEndingAt(rawStart));
      this.apply(rawStart, rawEnd, replacement, "source");
      const caret = this.model.displayOffset(rawStart + replacement.length);
      this.source.focus(); this.source.setSelectionRange(caret, caret);
    }

    clipboardInlineChunks(descriptor) {
      if(descriptor.projection.referenceDefinition) return [];
      if(descriptor.unitType==="line") return [{text:descriptor.projection.text,base:descriptor.start+descriptor.projection.prefix}];
      if(descriptor.unitType!=="table") return [];
      const raw=descriptor.raw, boundaries=[-1,...TableCodec.tableDelimiters(raw),raw.length];
      return boundaries.slice(0,-1).map((at,index)=>({text:raw.slice(at+1,boundaries[index+1]),base:descriptor.start+at+1}));
    }

    clipboardFragment(selection) {
      const raw=this.model.source;
      if(this.mode==="source") return raw.slice(selection.start,selection.end);
      const first=this.descriptorAtRaw(selection.start), last=this.descriptorAtRaw(Math.max(selection.start,selection.end-1));
      let prefix="", suffix="";
      let body=raw.slice(selection.start,selection.end);
      if(first?.unitType==="code" && first.codeContent && last?.codeContent
          && first.unitStart===last.unitStart && first.unitEnd===last.unitEnd) {
        let codeBody=body;
        if(first.containerPrefix) {
          codeBody="";
          for(let index=first.index;index<=last.index;index+=1) {
            const descriptor=this.lineDescriptors[index];
            const start=Math.max(selection.start,descriptor.start+(descriptor.containerPrefix||"").length);
            const end=Math.min(selection.end,descriptor.end);
            if(end>start) codeBody+=raw.slice(start,end);
            if(selection.end>descriptor.end) codeBody+=raw.slice(descriptor.end,Math.min(selection.end,descriptor.end+descriptor.ending.length));
          }
        }
        const ending=this.model.lineEndingAt(selection.start), fence=Internals.TextUtils.codeFenceFor(codeBody);
        const opening=this.lineDescriptors[first.unitStart];
        const info=opening.projection.fence ? (opening.raw.slice((opening.containerPrefix||"").length).match(/^ {0,3}(?:`{3,}|~{3,})(.*)$/)?.[1] || "") : "";
        const fragment=fence+info+ending+codeBody+(/(?:\r\n|\r|\n)$/.test(codeBody)?"":ending)+fence;
        return first.containerQuoteDepth ? fragment.split(/(\r\n|\r|\n)/)
          .map((part,index)=>index%2===0 ? (first.containerQuotePrefix??first.containerPrefix??"")+part : part).join("") : fragment;
      }
      const codeAt=(descriptor,offset)=>{
        if(descriptor?.unitType!=="line")return null;
        const projection=descriptor.projection,point=offset-descriptor.start-projection.prefix;
        let found=null;
        const visit=tokens=>tokens.forEach(token=>{if(token.type==="code"&&point>=token.contentStart&&point<=token.contentEnd)found=token;if(token.children)visit(token.children);});
        visit(projection.inlineTokens||MarkdownCodec.tokenizeInline(projection.text,0,projection.text.length,0,false,false,this.lineDescriptors.references));return found;
      };
      const endDescriptor=this.descriptorAtRaw(selection.end),firstCode=codeAt(first,selection.start),lastCode=codeAt(endDescriptor,selection.end);
      const sameCode=firstCode&&lastCode&&((first===endDescriptor&&firstCode.start===lastCode.start&&firstCode.end===lastCode.end)
        ||(firstCode.originalToken&&firstCode.originalToken===lastCode.originalToken));
      if(sameCode) {
        let visible="";
        for(let index=first.index;index<=endDescriptor.index;index++){
          const row=this.lineDescriptors[index],start=Math.max(selection.start,row.start+row.projection.prefix),end=Math.min(selection.end,row.end);
          if(end>start)visible+=raw.slice(start,end);
          if(selection.end>row.end)visible+=raw.slice(row.end,Math.min(selection.end,row.end+row.ending.length));
        }
        const normalized=visible.replace(/\r\n|\r|\n/g," ");
        const width=Math.max(0,...Array.from(visible.matchAll(/`+/g),match=>match[0].length))+1,fence="`".repeat(width);
        const padded=normalized.startsWith('`')||normalized.endsWith('`')||(normalized.startsWith(' ')&&normalized.endsWith(' ')&&/[^ ]/.test(normalized));
        body=fence+(padded?' ':'')+body+(padded?' ':'')+fence;
      }
      if(first?.unitType==="line" && selection.start>=first.start+first.projection.prefix
          && first.projection.prefix && (first.projection.list || first.projection.tag==="blockquote" || /^h[1-6]$/.test(first.projection.tag))) {
        prefix=first.raw.slice(0,first.projection.prefix);
      }
      const edge=(descriptor,offset,opening)=> {
        if(!descriptor || descriptor.unitType!=="line" || descriptor.projection.referenceDefinition) return;
        const projection=descriptor.projection, base=descriptor.start+projection.prefix;
        const point=offset-base;
        const visit=tokens=>tokens.forEach(token=> {
          if(!token.children && token.type!=="code") return;
          if(sameCode&&token.type==="code")return;
          if(opening ? point<token.contentStart || point>=token.contentEnd : point<=token.contentStart || point>token.contentEnd) return;
          if(opening && (offset>base+token.start||token.continuesBefore)) prefix+=token.openingMarkup??projection.text.slice(token.start,token.contentStart);
          if(!opening && (offset<base+token.end||token.continuesAfter)) suffix=(token.closingMarkup??projection.text.slice(token.contentEnd,token.end))+suffix;
          if(token.children) visit(token.children);
        });
        visit(projection.inlineTokens||MarkdownCodec.tokenizeInline(projection.text,0,projection.text.length,0,false,false,this.lineDescriptors.references));
      };
      edge(first,selection.start,true); edge(last,selection.end,false);
      const fragment=prefix+body+suffix;
      const descriptors=this.buildProjection(fragment), needed=new Set();
      const references=this.lineDescriptors.references;
      const visit=tokens=>tokens.forEach(token=> {
        if(token.referenceKey && !descriptors.references.has(token.referenceKey)) needed.add(token.referenceKey);
        if(token.children) visit(token.children);
      });
      for(const descriptor of descriptors) {
        for(const {text} of this.clipboardInlineChunks(descriptor)) {
          visit(MarkdownCodec.tokenizeInline(text,0,text.length,0,false,false,references));
        }
      }
      const definitions=Array.from(needed,key=>references.get(key)?.rawDefinition).filter(Boolean);
      const ending=this.model.lineEndingAt(selection.start);
      return fragment+(definitions.length?ending+ending+definitions.join(ending):"");
    }

    isolateClipboardReferences(fragment) {
      if(!this.model.source) return fragment;
      const incoming=this.buildProjection(fragment), aliases=new Map(), edits=[];
      if(!incoming.references.size) return fragment;
      const reserved=new Set(this.buildProjection().references.keys());
      for(const match of this.model.source.matchAll(/\[([^\[\]]*)\]/g)) {
        const key=MarkdownCodec.referenceKey(match[1]); if(key) reserved.add(key);
      }
      for(const key of incoming.references.keys()) reserved.add(key);
      let serial=1;
      for(const key of incoming.references.keys()) {
        let alias;
        do {alias="amorist-copy-"+serial++;} while(reserved.has(alias));
        reserved.add(alias); aliases.set(key,alias);
      }
      for(const descriptor of incoming) {
        const definition=descriptor.referenceLabel;
        if(definition) edits.push({start:definition.start,end:definition.end,text:aliases.get(definition.key)});
        for(const {text:source,base} of this.clipboardInlineChunks(descriptor)) {
        const visit=tokens=>tokens.forEach(token=> {
          if(token.referenceKey && aliases.has(token.referenceKey)) {
            edits.push({start:base+token.start,end:base+token.end,
              text:(token.type==="image"?"!":"")+"["+source.slice(token.contentStart,token.contentEnd)+"]["+aliases.get(token.referenceKey)+"]"});
          } else if(token.children) visit(token.children);
        });
        visit(MarkdownCodec.tokenizeInline(source,0,source.length,0,false,false,incoming.references));
        }
      }
      for(const edit of edits.sort((a,b)=>b.start-a.start)) fragment=fragment.slice(0,edit.start)+edit.text+fragment.slice(edit.end);
      return fragment;
    }

    finishClipboardEdit(selection,replacement,gesture) {
      const before={...this.selectionRaw(),direction:this.selectionDirection()};
      const entry=this.apply(selection.start,selection.end,replacement,gesture);
      entry.selectionBefore=before;
      entry.selectionAfter={start:selection.start+replacement.length,end:selection.start+replacement.length,direction:"forward"};
      if(this.mode==="source") {
        this.sourceBeforeInput=null;
        this.source.value=this.model.display;
        const caret=this.model.displayOffset(selection.start+replacement.length);
        this.source.setSelectionRange(caret,caret);
      }
      this.scheduleCurrentLine?.();
    }

    clipboardCutSelection(selection) {
      if(this.mode!=="wysiwyg") return selection;
      const descriptor=this.descriptorAtRaw(selection.start);
      if(!descriptor || descriptor.unitType!=="line" || descriptor.projection.referenceDefinition || selection.end>descriptor.end) return selection;
      const text=descriptor.projection.text,base=descriptor.start+descriptor.projection.prefix,tokens=[];
      const collect=items=>items.forEach(token=> {tokens.push(token);if(token.children) collect(token.children);});
      collect(MarkdownCodec.tokenizeInline(text,0,text.length,0,false,false,this.lineDescriptors.references));
      let result={...selection},changed=true;
      while(changed) {
        changed=false;
        for(const token of tokens) {
          if(!["em","strong","strong-em","delete","code","link"].includes(token.type)) continue;
          if(result.start===base+token.contentStart && result.end===base+token.contentEnd
              && (result.start!==base+token.start || result.end!==base+token.end)) {
            result={start:base+token.start,end:base+token.end};changed=true;
          }
        }
      }
      return result;
    }

    clipboardCutReplacement(selection) {
      if(this.mode!=="wysiwyg") return "";
      let closing="", opening="";
      const first=this.descriptorAtRaw(selection.start), last=this.descriptorAtRaw(Math.max(selection.start,selection.end-1));
      const edge=(descriptor,startEdge)=> {
        if(!descriptor || descriptor.unitType!=="line" || descriptor.projection.referenceDefinition) return;
        const text=descriptor.projection.text,base=descriptor.start+descriptor.projection.prefix;
        const visit=tokens=>tokens.forEach(token=> {
          if(["em","strong","strong-em","delete","code","link"].includes(token.type)) {
            if(startEdge && selection.start>base+token.contentStart && selection.start<base+token.contentEnd
                && selection.end>=base+token.end) closing=text.slice(token.contentEnd,token.end)+closing;
            if(!startEdge && selection.end>base+token.contentStart && selection.end<base+token.contentEnd
                && selection.start<=base+token.start) opening+=text.slice(token.start,token.contentStart);
          }
          if(token.children) visit(token.children);
        });
        visit(MarkdownCodec.tokenizeInline(text,0,text.length,0,false,false,this.lineDescriptors.references));
      };
      edge(first,true);edge(last,false);
      return closing+opening;
    }

    clipboardDocumentUri() {
      let path=typeof this.options.documentPath==="function" ? this.options.documentPath() : this.options.documentPath;
      if(typeof path!=="string"||!path) return null;
      if(path.startsWith("\\\\?\\")) {
        path=path.slice(4);
        if(/^UNC\\/i.test(path))path="\\\\"+path.slice(4);
      }
      const encode=path=>path.split("/").map(encodeURIComponent).join("/");
      try {
        if(path.startsWith("\\\\")) {
          const normalized=path.slice(2).replace(/\\/g,"/"),slash=normalized.indexOf("/");
          if(slash<0)return null;
          return new URL("file://"+normalized.slice(0,slash)+"/"+encode(normalized.slice(slash+1))).href;
        }
        if(/^[a-z]:[\\/]/i.test(path)) return "file:///"+path.slice(0,2)+encode(path.slice(2).replace(/\\/g,"/"));
        return path.startsWith("/") ? "file://"+encode(path) : null;
      } catch(error) { return null; }
    }

    rebaseClipboardFragment(fragment, origin) {
      if(!origin)return fragment;
      const descriptors=this.buildProjection(fragment),edits=new Map();
      const add=destination=>{
        if(!destination||!destination.href||/^[a-z][a-z0-9+.-]*:/i.test(destination.href))return;
        try {
          const windows=/^file:\/\/\/([a-z]:\/)/i.test(origin)||!!new URL(origin).hostname;
          const href=new URL(windows ? destination.href : destination.href.replace(/\\/g,"%5C"),origin).href;
          if(!href.startsWith("file:"))return;
          const text=href.replace(/&/g,"&amp;").replace(/\\/g,"\\\\").replace(/[()<>]/g,"\\$&");
          edits.set(destination.destinationStart+":"+destination.destinationEnd,{start:destination.destinationStart,end:destination.destinationEnd,text});
        } catch(error) { /* Preserve destinations that cannot be resolved. */ }
      };
      for(const definition of descriptors.references.values())add(definition);
      for(const descriptor of descriptors) {
        const original=tokens=>tokens.forEach(token=>{
          if(!token.referenceKey)add(token.originalToken?.sourceLink?.destination);
          if(token.children)original(token.children);
        });
        original(descriptor.projection.inlineTokens||[]);
        for(const {text,base} of this.clipboardInlineChunks(descriptor)) {
          const visit=tokens=>tokens.forEach(token=>{
            if((token.type==="link"||token.type==="image")&&!token.referenceKey&&!token.autolink) {
              const destination=MarkdownCodec.linkDestinationAt(text,token.contentEnd+1);
              if(destination)add({...destination,destinationStart:base+destination.destinationStart,destinationEnd:base+destination.destinationEnd});
            }
            if(token.children)visit(token.children);
          });
          visit(MarkdownCodec.tokenizeInline(text,0,text.length,0,false,false,descriptors.references));
        }
      }
      for(const edit of Array.from(edits.values()).sort((a,b)=>b.start-a.start))fragment=fragment.slice(0,edit.start)+edit.text+fragment.slice(edit.end);
      return fragment;
    }

    handleCopy(event,cut) {
      const clipboard=event.clipboardData, selection=this.selectionRaw();
      if(!clipboard || selection.start===selection.end) return;
      const markdown=this.clipboardFragment(selection);
      event.preventDefault();
      try {
        clipboard.setData("text/plain",markdown);
      } catch(error) {
        this.options.onWarning?.("Could not copy to the clipboard. Your document was not changed.");
        return;
      }
      const base=this.clipboardDocumentUri(),semantic=this.rebaseClipboardFragment(markdown,base);
      const origin=semantic!==markdown ? base : null;
      const projected=this.buildProjection(semantic);
      const publicSource=projected.filter(row=>!row.projection.referenceDefinition).map(row=>row.raw+row.ending).join("");
      try {clipboard.setData("text/html",MarkdownCodec.renderMarkdown(publicSource,projected.references,true));} catch(error) { /* Plain Markdown remains available. */ }
      try {clipboard.setData(CLIPBOARD_TYPE,JSON.stringify(origin ? {schemaVersion:2,markdown,origin} : {schemaVersion:1,markdown}));} catch(error) { /* Some native clipboards reject custom types. */ }
      if(cut) {
        const span=this.clipboardCutSelection(selection);
        this.finishClipboardEdit(span,this.clipboardCutReplacement(span),"cut");
      }
    }

    handlePaste(event) {
      const clipboard=event.clipboardData; if(!clipboard) return;
      event.preventDefault();
      const selection=this.selectionRaw(), context=this.editingContextAt(selection.start);
      const plainOnly=this.mode==="source" || context?.kind==="code" || event.shiftKey || this.plainPasteRequested;
      this.plainPasteRequested=false;
      let replacement=null;
      let structured=false;
      if(!plainOnly) {
        try {
          const payload=JSON.parse(clipboard.getData(CLIPBOARD_TYPE));
          const legacy=payload&&payload.schemaVersion===1&&Object.keys(payload).length===2;
          const origin=payload&&payload.schemaVersion===2&&Object.keys(payload).length===3&&typeof payload.origin==="string"&&payload.origin.length<=65536 ? new URL(payload.origin) : null;
          const validOrigin=origin&&origin.protocol==="file:"&&!origin.search&&!origin.hash;
          if(payload && (legacy||validOrigin) && typeof payload.markdown==="string"
              && payload.markdown.length<=10*1024*1024) {
            const fragment=validOrigin&&origin.href!==this.clipboardDocumentUri() ? this.rebaseClipboardFragment(payload.markdown,origin.href) : payload.markdown;
            replacement=this.isolateClipboardReferences(fragment);structured=true;
          }
        } catch(error) { /* Invalid/unsupported internal data uses public clipboard formats. */ }
      }
      if(replacement===null) {
        const html=clipboard.getData("text/html"), plain=clipboard.getData("text/plain");
        replacement=plainOnly ? (plain || html) : html
          ? HtmlToMarkdown.convert(html, {onWarning: message => this.options.onWarning?.(message)})
            .replace(/\r\n|\r|\n/g,this.model.lineEndingAt(selection.start)) : plain;
        structured=!plainOnly && !!html;
      }
      if(!replacement) return;
      if(structured) replacement=this.structuredPasteReplacement(selection,String(replacement));
      this.finishClipboardEdit(selection,String(replacement),plainOnly?"paste-plain":"paste");
    }

    structuredPasteReplacement(selection, replacement) {
      const first=this.descriptorAtRaw(selection.start),last=this.descriptorAtRaw(selection.end);
      const plainRow=descriptor=>descriptor?.unitType==="line" && descriptor.projection.tag==="div"
        && !descriptor.projection.list && !descriptor.projection.listContinuation
        && !descriptor.projection.referenceDefinition
        && MarkdownCodec.tokenizeInline(descriptor.projection.text).every(token=>token.type==="text");
      if(!plainRow(first)||!plainRow(last)) return replacement;
      const blocks=MarkdownCodec.parseBlocks(replacement);
      if(!blocks.some(block=>block.type!=="paragraph") && blocks.length<2) return replacement;
      const separated=blocks.length>1 || blocks.some(block=>["quote","bulletList","orderedList","taskList"].includes(block.type));
      const needed=separated?2:1,ending=this.model.lineEndingAt(selection.start);
      const left=this.model.source.slice(first.start,selection.start),right=this.model.source.slice(selection.end,last.end);
      const count=value=>(value.match(/\r\n|\r|\n/g)||[]).length;
      if(left.trim()) replacement=ending.repeat(Math.max(0,needed-count(replacement.match(/^(?:\r\n|\r|\n)*/)[0])))+replacement;
      if(right.trim()) replacement+=ending.repeat(Math.max(0,needed-count(replacement.match(/(?:\r\n|\r|\n)*$/)[0])));
      return replacement;
    }

    editExistingLink(selection) {
      const request=found=>{
        const before=this.model.source,{destination}=found;
        return window.AmoristInternals.EditingPolicy.requestLink(destination.href).then(href=> {
          if(!href || !this.root.isConnected || this.model.source!==before) return;
          const escaped=href.replace(/&/g,"&amp;").replace(/\\/g,"\\\\").replace(/[()<>]/g,"\\$&").replace(/[ \t\r\n]/g,encodeURIComponent);
          if(found.automatic){
            const label=found.label.replace(/[\\`*_\[\]~<>!]/g,"\\$&");
            this.apply(found.base+found.automatic.start,found.base+found.automatic.end,`[${label}](${escaped})`,"link-destination");
          }else this.apply(found.base+destination.destinationStart,found.base+destination.destinationEnd,escaped,"link-destination");
        });
      };
      for(const descriptor of this.lineDescriptors){
        let found=null;
        const visit=tokens=>tokens.forEach(token=>{
          const link=token.originalToken?.sourceLink;
          if(token.type==="link"&&link&&selection.start>=link.contentStart&&selection.end<=link.contentEnd)found={destination:link.destination,base:0};
          if(token.children)visit(token.children);
        });
        visit(descriptor.projection.inlineTokens||[]);
        if(found)return request(found);
      }
      for(const descriptor of this.lineDescriptors) {
        for(const {text,base} of this.clipboardInlineChunks(descriptor)) {
          let found=null;
          const visit=tokens=>tokens.forEach(token=> {
            if(token.type==="link" && selection.start>=base+token.contentStart && selection.end<=base+token.contentEnd) {
              if(token.autolink) {
                found={destination:{href:token.href},base,automatic:token,
                  label:text.slice(token.contentStart,token.contentEnd)};
                return;
              }
              const destination=token.referenceKey ? this.lineDescriptors.references.get(token.referenceKey)
                : MarkdownCodec.linkDestinationAt(text,token.contentEnd+1);
              if(destination) found={destination,base:token.referenceKey?0:base};
            }
            if(token.children) visit(token.children);
          });
          visit(MarkdownCodec.tokenizeInline(text,0,text.length,0,false,false,this.lineDescriptors.references));
          if(!found) continue;
          return request(found);
        }
      }
      return null;
    }

    runAction(action) {
      if (action === "source") return this.mode === "source" ? this.showWysiwygMode() : this.showSourceMode();
      if (this.mode === "source") this.showWysiwygMode();
      const sel = this.selectionRaw();
      if(action==="link") {const pending=this.editExistingLink(sel);if(pending) return pending;}
      const selected = this.model.source.slice(sel.start, sel.end);
      const wraps = { bold: ["**", "**"], italic: ["*", "*"], code: ["`", "`"] };
      if (wraps[action] && selected) this.apply(sel.start, sel.end, wraps[action][0] + selected + wraps[action][1], action);
      else if (wraps[action]) this.toggleInlineMode(action, wraps[action], sel);
      else if (action === "link" && selected) {
        const before = this.model.source;
        return window.AmoristInternals.EditingPolicy.requestLink().then(href => {
          if (!href || !this.root.isConnected || this.model.source !== before) return;
          const label = selected.replace(/]/g, "\\]");
          this.apply(sel.start, sel.end, `[${label}](${String(href).trim().replace(/\)/g, "%29")})`, action);
        });
      }
      else if (/^h[1-6]$/.test(action)) {
        const requested = "#".repeat(Number(action[1])) + " ";
        this.applyLineTransform(sel, action, (lines) => {
          const allRequested = lines.every((text) => new RegExp(`^(\\s*)#{${Number(action[1])}}\\s+`).test(text));
          return lines.map((text) => {
            const heading = text.match(/^(\s*)(#{1,6})\s+/);
            const indent = heading ? heading[1] : (text.match(/^\s*/) || [""])[0];
            const body = heading ? text.slice(heading[0].length) : text.slice(indent.length);
            return indent + (allRequested ? "" : requested) + body;
          });
        });
      }
      else if (action === "bullet" || action === "ordered" || action === "task" || action === "quote") {
        const prefix = action === "ordered" ? "1. " : action === "task" ? "- [ ] " : action === "quote" ? "> " : "- ";
        const markerPattern = action === "quote" ? /^(\s*)>\s?/ : /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
        const requestedPattern = action === "bullet" ? /^(\s*)[-*+]\s+(?!\[[ xX]\]\s+)/
          : action === "ordered" ? /^(\s*)\d+[.)]\s+/
            : action === "task" ? /^(\s*)[-*+]\s+\[[ xX]\]\s+/
              : /^(\s*)>\s?/;
        this.applyLineTransform(sel, action, (lines) => {
          const allRequested = lines.every((text) => requestedPattern.test(text));
          return lines.map((text) => {
            const current = text.match(markerPattern);
            const indent = current ? current[1] : (text.match(/^\s*/) || [""])[0];
            const body = current ? text.slice(current[0].length) : text.slice(indent.length);
            return indent + (allRequested ? "" : prefix) + body;
          });
        });
      }
      else if (action === "codeblock") {
        const { start, end } = selectedLineRange(this.model.source, sel.start, sel.end);
        const body = this.model.source.slice(start, end);
        const ending = this.model.lineEndingAt(start);
        const fence = Internals.TextUtils.codeFenceFor(body);
        this.apply(start, end, fence + ending + body + ending + fence, action);
      }
    }

    navigateHeading(anchor) {
      if (anchor === "") {
        if (this.mode === "source") {
          this.source.focus();
          this.source.setSelectionRange(0, 0);
          this.source.scrollTop = 0;
        } else {
          this.surface.focus();
          this.setSurfaceSelection(0, 0);
          scrollViewportFor(this.surface).scrollTop = 0;
        }
        this.scheduleCurrentLine?.();
        return true;
      }
      const descriptors = this.mode === "source" ? this.buildProjection() : this.lineDescriptors;
      const used = new Set();
      const textOf = tokens => tokens.map(token => token.type === "image" ? token.alt
        : token.children ? textOf(token.children) : token.text || "").join("");
      for (let index = 0; index < descriptors.length; index++) {
        const descriptor = descriptors[index], projection = descriptor.projection;
        if (!/^h[1-6]$/.test(projection.tag)) continue;
        const text = textOf(MarkdownCodec.tokenizeInline(projection.text, 0, projection.text.length, 0, false, false, descriptors.references));
        const base = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/g, "-");
        let slug = base, duplicate = 0;
        while (used.has(slug)) slug = base + "-" + (++duplicate);
        used.add(slug);
        if (slug !== anchor) continue;
        const at = descriptor.start + projection.prefix;
        if (this.mode === "source") {
          this.source.focus();const displayAt = this.model.displayOffset(at);
          this.source.setSelectionRange(displayAt, displayAt);
          const style = getComputedStyle(this.source), height = parseFloat(style.lineHeight);
          this.source.scrollTop = Math.max(0, index * height - this.source.clientHeight / 2);
        } else {
          this.surface.focus();this.setSurfaceSelection(at, at);
          this.rowNodes[index]?.scrollIntoView({block:"center",inline:"nearest"});
        }
        this.scheduleCurrentLine?.();return true;
      }
      return false;
    }

    handleClick(event) {
      const link = event.target.closest("a[data-link-destination]");
      if (link && this.surface.contains(link)) {
        event.preventDefault();
        if ((event.ctrlKey || event.metaKey) && typeof this.options.onActivateLink === "function") {
          Promise.resolve().then(() => this.options.onActivateLink(link.dataset.linkDestination))
            .catch(error => this.options.onWarning?.(String(error.message || error)));
        }else if(!event.ctrlKey&&!event.metaKey){
          const descriptor=this.lineDescriptors[Number(link.closest('.amorist-source-line')?.dataset.line)];
          if(!descriptor)return;
          const at=descriptor.start+Number(link.dataset.linkContentStart);
          this.setSurfaceSelection(at,at);
          Promise.resolve(this.editExistingLink({start:at,end:at}))
            .catch(error=>this.options.onWarning?.(String(error.message||error)));
        }
        return;
      }
      const checkbox = event.target.closest(".amorist-task-checkbox");
      if (!checkbox) return;
      const block = checkbox.closest(".amorist-source-line")||this.rowNodes[Number(checkbox.dataset.taskLine)]; if (!block) return;
      const descriptor = this.lineDescriptors[Number(block.dataset.line)];
      if (!descriptor) return;
      const start = descriptor.start;
      const match = descriptor.raw.match(/\[([ xX])\]/);
      if (match) this.apply(start + match.index + 1, start + match.index + 2, /x/i.test(match[1]) ? " " : "x", "task-checkbox");
    }

    toggleInlineMode(action, marks, selection) {
      if (this.inlineMode && this.inlineMode.action === action) {
        const close = marks[1];
        this.inlineMode = null;
        const closeAt = this.model.source.indexOf(close, selection.start);
        if (selection.start === selection.end && closeAt >= selection.start && closeAt - selection.start <= close.length) {
          this.setSurfaceSelection(closeAt + close.length, closeAt + close.length);
        }
      } else this.inlineMode = { action, marks };
    }

    applyLineTransform(selection, gesture, transform) {
      const range = selectedLineRange(this.model.source, selection.start, selection.end);
      const replacement = transformPhysicalLines(this.model.source.slice(range.start, range.end), transform);
      this.apply(range.start, range.end, replacement, gesture);
    }

    showSourceMode() {
      if (this.mode === "source") return;
      const selection = this.selectionRaw();
      const anchor = this.wysiwygViewportAnchor();
      this.source.style.paddingTop = "";
      this.source.style.paddingBottom = "";
      this.source.value = this.model.display; this.surface.hidden = true; this.source.hidden = false; this.mode = "source";
      const at = this.model.displayOffset(selection.start); this.source.focus(); this.source.setSelectionRange(at, this.model.displayOffset(selection.end));
      this.restoreSourceViewportAnchor(anchor); this.updateSourceButton(); this.performFind();
    }

    showWysiwygMode() {
      if (this.mode === "wysiwyg") return;
      const start = this.model.rawOffset(this.source.selectionStart); const end = this.model.rawOffset(this.source.selectionEnd);
      const anchor = this.sourceViewportAnchor();
      this.source.style.paddingTop = "";
      this.source.style.paddingBottom = "";
      this.surface.style.paddingTop = "";
      this.surface.style.paddingBottom = "";
      try {
        // Render the arriving view before hiding the safe source view.  A view
        // failure must be an explicit fallback, never an empty editor.
        this.surface.hidden = false;
        this.render({ start, end });
        this.source.hidden = true;
        this.mode = "wysiwyg";
        this.restoreWysiwygViewportAnchor(anchor);
        this.updateSourceButton(); this.performFind();
      } catch (error) {
        this.isRendering = false;
        this.surface.hidden = true;
        this.source.hidden = false;
        this.mode = "source";
        this.source.value = this.model.display;
        const displayStart = this.model.displayOffset(start);
        this.source.focus(); this.source.setSelectionRange(displayStart, this.model.displayOffset(end));
        this.updateSourceButton();
        if (typeof this.options.onWarning === "function") {
          this.options.onWarning("WYSIWYG could not be rendered. Source view remains available; your text is unchanged.");
        }
        console.error("Amorist WYSIWYG render failed; Source view was kept visible.", error);
      }
    }

    sourceViewportAnchor() {
      const style = window.getComputedStyle(this.source);
      const lineHeight = parseFloat(style.lineHeight) || 21;
      const contentY = this.source.scrollTop + this.source.clientHeight / 2 - (parseFloat(style.paddingTop) || 0);
      const maximum = Math.max(0, this.source.scrollHeight - this.source.clientHeight);
      return {
        line: clampedLine(Math.floor(contentY / lineHeight), sourceLines(this.model.source).length),
        edge: maximum <= 1 ? "both" : (this.source.scrollTop <= 1 ? "start" : (this.source.scrollTop >= maximum - 1 ? "end" : null)),
      };
    }
    wysiwygViewportAnchor() {
      const scroller = scrollViewportFor(this.surface);
      const middle = scrollViewportMiddle(scroller);
      const rows = Array.from(this.surface.querySelectorAll(".amorist-source-line"));
      const row = rows.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.top <= middle && rect.bottom >= middle;
      }) || rows.reduce((nearest, candidate) => {
        if (!nearest) return candidate;
        const distance = (rect) => Math.abs((rect.top + rect.bottom) / 2 - middle);
        return distance(candidate.getBoundingClientRect()) < distance(nearest.getBoundingClientRect()) ? candidate : nearest;
      }, null);
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      return {
        line: row ? Number(row.dataset.line) : 0,
        edge: maximum <= 1 ? "both" : (scroller.scrollTop <= 1 ? "start" : (scroller.scrollTop >= maximum - 1 ? "end" : null)),
      };
    }
    restoreSourceViewportAnchor(anchor) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!this.root.isConnected) return;
          const style = window.getComputedStyle(this.source);
          const lineHeight = parseFloat(style.lineHeight) || 21;
          const padding = parseFloat(style.paddingTop) || 0;
          const wanted = padding + anchor.line * lineHeight + lineHeight / 2 - this.source.clientHeight / 2;
          const maximum = Math.max(0, this.source.scrollHeight - this.source.clientHeight);
          // The first and last viewport have no space on one side. Preserve the
          // edge in that case; never invent blank document padding to fake C2.
          this.source.scrollTop = anchor.edge === "start" ? 0
            : (anchor.edge === "end" ? maximum : Math.max(0, Math.min(maximum, wanted)));
        });
      });
    }
    restoreWysiwygViewportAnchor(anchor) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!this.root.isConnected) return;
          const row = this.surface.querySelector(`.amorist-source-line[data-line="${anchor.line}"]`);
          if (!row) return;
          const scroller = scrollViewportFor(this.surface);
          const targetY = scrollViewportMiddle(scroller);
          const rect = row.getBoundingClientRect();
          const wanted = scroller.scrollTop + (rect.top + rect.bottom) / 2 - targetY;
          const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          scroller.scrollTop = anchor.edge === "start" ? 0
            : (anchor.edge === "end" ? maximum : Math.max(0, Math.min(maximum, wanted)));
        });
      });
    }
    updateSourceButton() { const button = this.toolbar.querySelector('[data-action="source"]'); if (button) button.setAttribute("aria-pressed", String(this.mode === "source")); }
    undo() {
      const beforeSource = this.model.source;
      const beforeDescriptors = this.lineDescriptors;
      const entry = this.history.undo(this.model);
      if (!entry) return;
      const at = entry.forward.start;
      if (this.mode === "source") {
        this.source.value = this.model.display;
        const displayAt = this.model.displayOffset(at);
        this.source.setSelectionRange(displayAt, displayAt);
      } else this.patchProjection(beforeSource, beforeDescriptors, entry.inverse, { start: at, end: at });
      if (entry.selectionBefore) this.restoreRawSelection(entry.selectionBefore);
      this.emitChange();
    }
    redo() {
      const beforeSource = this.model.source;
      const beforeDescriptors = this.lineDescriptors;
      const entry = this.history.redo(this.model);
      if (!entry) return;
      const at = entry.forward.start + entry.forward.replacement.length;
      if (this.mode === "source") {
        this.source.value = this.model.display;
        const displayAt = this.model.displayOffset(at);
        this.source.setSelectionRange(displayAt, displayAt);
      } else this.patchProjection(beforeSource, beforeDescriptors, entry.forward, { start: at, end: at });
      if (entry.selectionAfter) this.restoreRawSelection(entry.selectionAfter);
      this.emitChange();
    }
    emitChange() { this.scheduleCurrentLine?.(); if (typeof this.options.onChange === "function") this.options.onChange(this.model.source); }
    openFindBar() { this.findBar.hidden = false; this.findInput.focus(); this.findInput.select(); this.performFind(); }
    closeFindBar() { this.findBar.hidden = true; this.findMatches = []; this.findIndex = -1; this.findCount.textContent = ""; this.focus(); }
    performFind() {
      const query = this.findInput.value.toLocaleLowerCase();
      this.findMatches = [];
      this.findIndex = -1;
      if (!query) { this.findCount.textContent = ""; return; }
      const haystack = this.model.display.toLocaleLowerCase();
      let at = 0;
      while ((at = haystack.indexOf(query, at)) >= 0) { this.findMatches.push(at); at += Math.max(1, query.length); }
      this.findIndex = this.findMatches.length ? 0 : -1;
      this.updateFindCount();
    }
    handleFindKeyDown(event) {
      if (event.key === "Escape") { event.preventDefault(); this.closeFindBar(); }
      else if (event.key === "Enter") { event.preventDefault(); this.findMove(event.shiftKey ? -1 : 1); }
    }
    findMove(step) {
      if (!this.findMatches.length) return;
      this.findIndex = (this.findIndex + step + this.findMatches.length) % this.findMatches.length;
      const start = this.findMatches[this.findIndex];
      const end = start + this.findInput.value.length;
      this.updateFindCount();
      if (this.mode === "source") { this.source.focus(); this.source.setSelectionRange(start, end); }
      else this.setSurfaceSelection(this.model.rawOffset(start), this.model.rawOffset(end));
    }
    updateFindCount() { this.findCount.textContent = this.findMatches.length ? `${this.findIndex + 1} of ${this.findMatches.length}` : "0 of 0"; }
  }

  function previousCodeUnit(source, at) { if (!at) return 0; if (source[at - 1] === "\n" && source[at - 2] === "\r") return at - 2; return at > 1 && source.charCodeAt(at - 1) >= 0xdc00 && source.charCodeAt(at - 1) <= 0xdfff ? at - 2 : at - 1; }
  function nextCodeUnit(source, at) { if (at >= source.length) return at; return source.charCodeAt(at) >= 0xd800 && source.charCodeAt(at) <= 0xdbff ? at + 2 : at + 1; }
  function lineStart(source, at) { return Math.max(source.lastIndexOf("\n", Math.max(0, at - 1)), source.lastIndexOf("\r", Math.max(0, at - 1))) + 1; }
  function lineEnd(source, at) { const match = source.slice(Math.max(0, at)).search(/\r\n|\r|\n/); return match < 0 ? source.length : Math.max(0, at) + match; }
  function selectedLineRange(source, start, end) {
    const first = lineStart(source, start);
    const anchor = end > start ? Math.max(start, end - 1) : start;
    return { start: first, end: lineEnd(source, anchor) };
  }
  function transformPhysicalLines(source, transform) {
    const lines = [];
    const endings = [];
    let cursor = 0;
    while (cursor < source.length) {
      const found = source.slice(cursor).match(/\r\n|\r|\n/);
      if (!found) { lines.push(source.slice(cursor)); endings.push(""); break; }
      const at = cursor + found.index;
      lines.push(source.slice(cursor, at)); endings.push(found[0]); cursor = at + found[0].length;
    }
    if (!lines.length) { lines.push(""); endings.push(""); }
    return transform(lines).map((line, index) => line + endings[index]).join("");
  }
  function midViewportLine(scrollTop, clientHeight, lineHeight) { return lineHeight > 0 ? Math.floor((scrollTop + clientHeight / 2) / lineHeight) : 0; }
  function centerScroll(anchorTop, clientHeight, scrollHeight) { return Math.max(0, Math.min(Math.max(0, scrollHeight - clientHeight), anchorTop - clientHeight / 2)); }
  function scrollViewportFor(element) {
    let candidate = element;
    while (candidate && candidate !== document.body && candidate !== document.documentElement) {
      const overflow = window.getComputedStyle(candidate).overflowY;
      if ((overflow === "auto" || overflow === "scroll")
        && candidate.scrollHeight > candidate.clientHeight + 1) return candidate;
      candidate = candidate.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  function scrollViewportMiddle(scroller) {
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      return window.innerHeight / 2;
    }
    const box = scroller.getBoundingClientRect();
    return box.top + scroller.clientHeight / 2;
  }
  Internals.MarkdownHistory = TransactionJournal;
  window.__editorTestHelpers = { midViewportLine, centerScroll, alignedScrollTop, clampedLine, projectionLine, selectedLineRange, transformPhysicalLines };
  window.AmoristEditor = { create };
})();
