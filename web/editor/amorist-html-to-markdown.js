(function () {
  const Internals = window.AmoristInternals || (window.AmoristInternals = {});

  // Elements removed entirely (content discarded).
  const STRIPPED = new Set(["SCRIPT", "STYLE", "HEAD", "META", "LINK", "TITLE", "NOSCRIPT"]);
  // Inline wrappers with no Markdown meaning: replace with their children.
  const UNWRAPPED = new Set(["SPAN", "FONT", "U", "SMALL", "ABBR", "TIME", "MARK"]);
  const REPRESENTABLE = new Set([
    "BODY", "P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER",
    "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "LI",
    "PRE", "CODE", "A", "IMG", "BR", "STRONG", "B", "EM", "I", "DEL", "STRIKE", "S",
    "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH",
    "SPAN", "FONT", "SMALL", "ABBR", "TIME",
  ]);

  function isStripped(tag) {
    return STRIPPED.has(tag);
  }
  function isUnwrapped(tag) {
    return UNWRAPPED.has(tag);
  }

  function cleanupMarkdown(md) {
    // Trailing whitespace is noise except in one case: two spaces after text are
    // a hard line break. Stripping indiscriminately would erase every <br> that
    // serializeBlocks just wrote, which is the whole point of the paste path.
    const output = [];
    let closing = null;
    let blanks = 0;
    let offset = 0;
    let inlineEnd = 0;
    for (const line of md.split("\n")) {
      const lineStart = offset, lineEnd = offset + line.length;
      offset = lineEnd + 1;
      if (closing) {
        output.push(line);
        if (closing.test(line)) closing = null;
        continue;
      }
      const fence = inlineEnd <= lineStart && line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*$`);
        output.push(line);
        blanks = 0;
        continue;
      }
      for (let cursor = Math.max(lineStart,inlineEnd); cursor < lineEnd;) {
        if (md[cursor] === "\\") { cursor += 2; continue; }
        const code = md[cursor] === "`" && Internals.TextUtils.codeSpanAt(md,cursor);
        if (code) { inlineEnd = code.end; cursor = code.end; }
        else cursor += 1;
      }
      if (inlineEnd > lineEnd) {
        output.push(line);
        blanks = 0;
        continue;
      }
      const cleaned = /\S {2,}$/.test(line)
        ? line.replace(/[ \t]*$/, "  ") : line.replace(/[ \t]+$/, "");
      blanks = cleaned ? 0 : blanks + 1;
      if (blanks <= 1) output.push(cleaned);
    }
    return output.join("\n").trim();
  }

  const INLINE_TAGS = new Set(["A", "B", "STRONG", "I", "EM", "CODE", "BR", "SUB", "SUP"]);

  function sanitize(root) {
    // Depth-first; mutate as we go. Work on a static list to avoid live-collection surprises.
    Array.from(root.childNodes).forEach((node) => {
      if (node.nodeType === 8 /* comment */) {
        node.remove();
        return;
      }
      if (node.nodeType !== 1 /* element */) return; // keep text nodes

      const tag = node.tagName;
      if (isStripped(tag)) {
        node.remove();
        return;
      }
      sanitize(node); // recurse first so children are clean before we unwrap
      if (tag === "INPUT" && node.getAttribute("type") !== "checkbox") {
        node.replaceWith(node.ownerDocument.createTextNode(node.getAttribute("value") || ""));
        return;
      }

      if (isUnwrapped(tag)) {
        node.replaceWith(...node.childNodes);
        return;
      }

      // Keep the only Markdown-representable attributes.  In particular an
      // image without alt/src is a silent paste loss.
      Array.from(node.attributes || []).forEach((attr) => {
        const allowed = (tag === "A" && (attr.name === "href" || attr.name === "title"))
          || (tag === "IMG" && (attr.name === "src" || attr.name === "alt" || attr.name === "title"))
          || (tag === "OL" && attr.name === "start")
          || (tag === "LI" && attr.name === "value")
          || (tag === "CODE" && attr.name === "class" && /^language-[A-Za-z0-9_+-]+$/.test(attr.value))
          || (tag === "INPUT" && node.getAttribute("type") === "checkbox" && (attr.name === "type" || attr.name === "checked"));
        if (!allowed) {
          node.removeAttribute(attr.name);
        }
      });
    });
  }

  // This converter owns its source output.  It must not route through the
  // editor renderer/serializer: a paste is a local replacement transaction,
  // not a temporary DOM document that can reformat the open file.
  function tableCellSource(cell) {
    const source=nodeToSource(cell).replace(/\n/g,"<br>");
    let output="";
    for(let cursor=0;cursor<source.length;) {
      if(source[cursor]==="\\" && cursor+1<source.length) {
        output+=source.slice(cursor,cursor+2);cursor+=2;continue;
      }
      const code=source[cursor]==="`" && Internals.TextUtils.codeSpanAt(source,cursor);
      if(code) {output+=source.slice(cursor,code.end);cursor=code.end;continue;}
      output+=(source[cursor]==="|"?"\\":"")+source[cursor++];
    }
    return output;
  }

  function nodeToSource(node) {
    if (node.nodeType === 3) return (node.textContent || "")
      .replace(/[\\`*_\[\]~#>!&]/g,char=>"\\"+char)
      .replace(/^([ \t]*)([-+])(?=[ \t])/gm,"$1\\$2")
      .replace(/^([ \t]*\d{1,9})([.)])(?=[ \t])/gm,"$1\\$2");
    if (node.nodeType !== 1) return "";
    const tag = node.tagName;
    if (tag === "PRE") {
      const text = Internals.TextUtils.normalize(node.textContent || "");
      const fence = Internals.TextUtils.codeFenceFor(text);
      const language = node.querySelector?.('code')?.getAttribute('class')?.match(/^language-([A-Za-z0-9_+-]+)$/)?.[1] || "";
      return `${fence}${language}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}\n\n`;
    }
    const children = () => Array.from(node.childNodes).map(nodeToSource).join("");
    if (/^H[1-6]$/.test(tag)) return "#".repeat(Number(tag.slice(1)))+" "+children().trim().replace(/\n/g," ")+"\n\n";
    if (tag === "BLOCKQUOTE") return children().trim().split("\n").map(line=>">"+(line?" "+line:"")).join("\n")+"\n\n";
    if (tag === "INPUT" && node.getAttribute("type") === "checkbox") return node.hasAttribute("checked")?"[x] ":"[ ] ";
    if (tag === "BR") return "\n";
    const format=marks=> {
      const content=children(), body=content.trim();
      if(!body) return content;
      const leading=(content.match(/^\s*/)||[""])[0], trailing=(content.match(/\s*$/)||[""])[0];
      return leading+marks+body+marks+trailing;
    };
    if (tag === "STRONG" || tag === "B") return format("**");
    if (tag === "EM" || tag === "I") return format("*");
    if (tag === "DEL" || tag === "STRIKE" || tag === "S") return format("~~");
    if (tag === "CODE") {
      const text=(node.textContent || "").replace(/\r\n|\r/g,"\n");
      if(!text) return "";
      const width=Math.max(0,...Array.from(text.matchAll(/`+/g),match=>match[0].length))+1;
      const fence="`".repeat(width);
      const normalized=text.replace(/\n/g," ");
      const padded=text.startsWith("`") || text.endsWith("`") || (normalized.startsWith(" ") && normalized.endsWith(" ") && /[^ ]/.test(normalized));
      return fence+(padded?" ":"")+text+(padded?" ":"")+fence;
    }
    const destination=value=>"<"+String(value).replace(/&/g,"&amp;").replace(/\\/g,"\\\\").replace(/[<>]/g,char=>"\\"+char).replace(/\r\n|\r|\n/g,"%0A")+">";
    const title=node.getAttribute("title");
    const titleSource=title===null?"":" \""+String(title).replace(/&/g,"&amp;").replace(/[\\"]/g,char=>"\\"+char).replace(/\r\n|\r|\n/g," ")+"\"";
    if (tag === "A") return `[${children()}](${destination(node.getAttribute("href") || "")}${titleSource})`;
    if (tag === "IMG") return `![${String(node.getAttribute("alt") || "").replace(/[\\[\]]/g,char=>"\\"+char)}](${destination(node.getAttribute("src") || "")}${titleSource})`;
    if (tag === "UL" || tag === "OL") {
      let number=Number.parseInt(node.getAttribute("start") || "1",10);
      if(!Number.isFinite(number)) number=1;
      const items=Array.from(node.children).filter(child=>child.tagName==="LI");
      const lines=items.map(item=> {
        const explicit=Number.parseInt(item.getAttribute("value") || "",10);
        if(Number.isFinite(explicit)) number=explicit;
        const marker=tag==="OL" ? `${number++}. ` : "- ";
        const content=Array.from(item.childNodes).map(nodeToSource).join("").trim();
        return content.split("\n").map((line,index)=>index===0 ? marker+line : line ? " ".repeat(marker.length)+line : "").join("\n");
      });
      return "\n"+lines.join("\n")+"\n\n";
    }
    if (tag === "LI") return `- ${children().trim()}\n`;
    if (tag === "TD" || tag === "TH") return children().trim();
    if (tag === "TR") return Array.from(node.children).map(nodeToSource).join(" | ") + "\n";
    if (tag === "TABLE") {
      const rows=Array.from(node.querySelectorAll("tr")).filter(row=>row.closest("table")===node);
      const cells=rows.map(row=>Array.from(row.children).filter(cell=>cell.tagName==="TD" || cell.tagName==="TH")
        .map(tableCellSource));
      const width=Math.max(0,...cells.map(row=>row.length));
      if(!width) return "";
      const line=row=>"| "+Array.from({length:width},(_,index)=>row[index]||"").join(" | ")+" |";
      const header=rows[0] && Array.from(rows[0].children).some(cell=>cell.tagName==="TH");
      const output=header?[line(cells.shift())]:[line(Array(width).fill(""))];
      output.push(line(Array(width).fill("---")),...cells.map(line));
      return output.join("\n")+"\n\n";
    }
    const block = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "PRE"]);
    const text = children();
    return block.has(tag) ? text + "\n\n" : text;
  }

  function convert(html, options = {}) {
    if (!html) return "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    const unsupported = Array.from(body.querySelectorAll("*")).some(node => {
      if (STRIPPED.has(node.tagName)) return false;
      if (node.tagName === "INPUT" && node.getAttribute("type") === "checkbox") return false;
      return !REPRESENTABLE.has(node.tagName)
        || ((node.tagName === "TD" || node.tagName === "TH")
          && (Number(node.getAttribute("rowspan") || 1) > 1 || Number(node.getAttribute("colspan") || 1) > 1));
    });
    sanitize(body);
    const md = Array.from(body.childNodes).map(nodeToSource).join("");
    if (unsupported && typeof options.onWarning === "function") {
      options.onWarning("Some pasted HTML structure is unsupported. Available text was kept; unsupported formatting was omitted.");
    }
    return cleanupMarkdown(md);
  }

  Internals.HtmlToMarkdown = {
    convert,
    _isStripped: isStripped,
    _isUnwrapped: isUnwrapped,
    _cleanupMarkdown: cleanupMarkdown,
    _nodeToSource: nodeToSource,
  };
})();
